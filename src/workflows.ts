import {
  proxyActivities,
  startChild,
  defineSignal,
  defineQuery,
  setHandler,
} from '@temporalio/workflow';

/**
 * Setup for proxy activities
 */
const {
  createFundingActivity,
  mintUsdcActivity,
  offrampActivity,
  createPaymentActivity,
  updatePaymentStatusActivity,
  compensateFundingActivity,
} = proxyActivities<{
  createFundingActivity(params: {
    paymentId: string;
    amountUsd: number;
    destinationCurrency: string;
  }): Promise<{ status: 'COMPLETED' | 'FAILED'; fundingId: string }>;

  mintUsdcActivity(params: {
    paymentId: string;
    amountUsd: number;
    destinationCurrency: string;
  }): Promise<{
    status: 'COMPLETED' | 'FAILED';
    usdcAmount: number;
    usdcRate: number;
  }>;

  offrampActivity(params: {
    paymentId: string;
    usdcAmount: number;
    destinationCurrency: string;
  }): Promise<{
    status: 'COMPLETED' | 'FAILED';
    localAmount: number;
    fxRate: number;
  }>;

  createPaymentActivity(params: {
    id: string;
    usdAmount: number;
    destinationCurrency: string;
    status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  }): Promise<any>;

  updatePaymentStatusActivity(params: {
    id: string;
    status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  }): Promise<any>;

  compensateFundingActivity(params: {
    fundingId: string;
  }): Promise<void>;
}>({
  startToCloseTimeout: '1 minute',
});

// Signal: external callers can request cancellation 
export const cancelPaymentSignal = defineSignal<[string?]>('cancelPayment');
//Query to check status of the payment 
export const paymentStatusQuery = defineQuery<{
  stage: string;
  cancelRequested: boolean;
}>('getStatus');


// Child workflow for Funding
export async function FundingWorkflow(input: {
  paymentId: string;
  amountUsd: number;
  destinationCurrency: string;
}): Promise<{
  status: 'COMPLETED' | 'FAILED';
  fundingId: string;
}> {
  const fundingResult = await createFundingActivity({
    paymentId: input.paymentId,
    amountUsd: input.amountUsd,
    destinationCurrency: input.destinationCurrency,
  });
  return fundingResult;
}

// Child workflow for Minting
export async function MintingWorkflow(input: {
  paymentId: string;
  amountUsd: number;
  destinationCurrency: string;
}): Promise<{
  status: 'COMPLETED' | 'FAILED';
  usdcAmount: number;
  usdcRate: number;
}> {
  const mintingResult = await mintUsdcActivity({
    paymentId: input.paymentId,
    amountUsd: input.amountUsd,
    destinationCurrency: input.destinationCurrency,
  });

  return mintingResult;
}

// Child workflow for Offramp
export async function OfframpWorkflow(input: {
  paymentId: string;
  usdcAmount: number;
  destinationCurrency: string;
}): Promise<{
  status: 'COMPLETED' | 'FAILED';
  localAmount: number;
  fxRate: number;
}> {
  const offrampResult = await offrampActivity({
    paymentId: input.paymentId,
    usdcAmount: input.usdcAmount,
    destinationCurrency: input.destinationCurrency,
  });

  return offrampResult;
}


/**
 * Main workflow of our transactions!
 * Starts each leg of the process, each being reliant on the successful
 * completion of its predeccesor
 */
export async function PaymentWorkflow(input: {
  paymentId: string;
  amountUsd: number;
  destinationCurrency: string;
}): Promise<string> {
  console.log('PaymentWorkflow started with:', input);

  // In-memory state for signals + queries
  let cancelRequested = false;
  let cancelReason: string | undefined;
  let stage = 'STARTING'; // will update as we move through the legs

  // Signal handler
  setHandler(cancelPaymentSignal, (reason?: string) => {
    cancelRequested = true;
    cancelReason = reason;
  });

  // Query handler
  setHandler(paymentStatusQuery, () => ({
    stage,
    cancelRequested,
  }));

  // 0) Create payment row as CREATED, then mark IN_PROGRESS
  stage = 'CREATING_PAYMENT';
  await createPaymentActivity({
    id: input.paymentId,
    usdAmount: input.amountUsd,
    destinationCurrency: input.destinationCurrency,
    status: 'CREATED',
  });

  stage = 'FUNDING_STARTING';
  await updatePaymentStatusActivity({
    id: input.paymentId,
    status: 'IN_PROGRESS',
  });

  // 1) Funding as a child workflow
  const fundingChild = await startChild(FundingWorkflow, {
    args: [input],
    workflowId: `funding-${input.paymentId}`,
  });

  stage = 'FUNDING_RUNNING';
  const fundingResult = await fundingChild.result();

  if (fundingResult.status === 'FAILED') {
    stage = 'FAILED_FUNDING';
    await updatePaymentStatusActivity({
      id: input.paymentId,
      status: 'FAILED',
    });

    return `Payment ${input.paymentId} FAILED during funding child workflow`;
  }

  // Check for cancellation after funding, before minting
  if (cancelRequested) {
    stage = 'CANCELLED_AFTER_FUNDING';
    await updatePaymentStatusActivity({
      id: input.paymentId,
      status: 'FAILED', // treating cancellation as a failed payment for now
    });

    const extra = cancelReason ? ` (reason: ${cancelReason})` : '';
    return `Payment ${input.paymentId} CANCELLED after funding${extra}`;
  }

  // 2) Minting as a child workflow
  stage = 'MINTING_STARTING';
  const mintChild = await startChild(MintingWorkflow, {
    args: [input],
    workflowId: `mint-${input.paymentId}`,
  });

  stage = 'MINTING_RUNNING';
  const mintingResult = await mintChild.result();
  console.log('Minting result:', mintingResult);

  if (mintingResult.status === 'FAILED') {
    stage = 'FAILED_MINTING';
    await compensateFundingActivity({ fundingId: fundingResult.fundingId });

    await updatePaymentStatusActivity({
      id: input.paymentId,
      status: 'FAILED',
    });

    return `Payment ${input.paymentId} FAILED during minting; funding COMPENSATED`;
  }

  // 3) Offramp as a child workflow
  stage = 'OFFRAMP_STARTING';
  const offrampChild = await startChild(OfframpWorkflow, {
    args: [
      {
        paymentId: input.paymentId,
        usdcAmount: mintingResult.usdcAmount,
        destinationCurrency: input.destinationCurrency,
      },
    ],
    workflowId: `offramp-${input.paymentId}`,
  });

  stage = 'OFFRAMP_RUNNING';
  const offrampResult = await offrampChild.result();
  console.log('Offramp result:', offrampResult);

  if (offrampResult.status === 'FAILED') {
    stage = 'FAILED_OFFRAMP';
    await compensateFundingActivity({ fundingId: fundingResult.fundingId });

    await updatePaymentStatusActivity({
      id: input.paymentId,
      status: 'FAILED',
    });

    return `Payment ${input.paymentId} FAILED during offramp; funding COMPENSATED`;
  }

  // Final: mark COMPLETED
  stage = 'COMPLETED';
  await updatePaymentStatusActivity({
    id: input.paymentId,
    status: 'COMPLETED',
  });

  return (
    `Payment ${input.paymentId} COMPLETED: ` +
    `${input.amountUsd} USD -> ${mintingResult.usdcAmount} USDC @ ${mintingResult.usdcRate}, ` +
    `then ${offrampResult.localAmount} ${input.destinationCurrency} @ ${offrampResult.fxRate}`
  );
}

