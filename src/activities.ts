import { createPayment, updatePaymentStatus } from "./db/paymentsRepo";
import { createFundingRecord, updateFundingStatus } from "./db/fundingRepo";
import { createMintingRecord } from "./db/mintingRepo";
import { createOfframpRecord } from "./db/offrampRepo";
import { createFeeRecord } from "./db/feesRepo";
import { getFxRate } from "./db/fxRepo";
import { nanoid } from "nanoid";

/**
 * Generate a unique funding id, and record each transcation
 * (This includes a transaction fee of .03$)
 */
export async function createFundingActivity(params: {
  paymentId: string;
  amountUsd: number;
  destinationCurrency: string;
}): Promise<{ status: "COMPLETED" | "FAILED"; fundingId: string }> {
  console.log("createFundingActivity called with:", params);

  const fundingId = nanoid();
  const status: "COMPLETED" | "FAILED" = "COMPLETED";

  // Insert funding row
  await createFundingRecord({
    id: fundingId,
    paymentId: params.paymentId,
    usdAmount: params.amountUsd,
    status,
  });

  // Insert fee row for this leg
  const feeId = nanoid();
  const feeAmount = 0.30; // sample fee amt
  const feeCurrency = "USD";

  await createFeeRecord({
    id: feeId,
    paymentId: params.paymentId,
    leg: "FUNDING",
    amount: feeAmount,
    currency: feeCurrency,
  });

  return { status, fundingId };
}

/*
*Triggered after a failed payment transaction and user needs to 
* be compensated for failure
* Keeps record of the compensation  
*/ 
export async function compensateFundingActivity(params: {
  fundingId: string;
}): Promise<void> {
  console.log("compensateFundingActivity called with:", params);

  await updateFundingStatus({
    id: params.fundingId,
    status: "COMPENSATED",
  });
}

/*
*Conversion of USD to USDC Set as stable 1:1 for now
*records minting transaction and sets a .05$ fee
*/ 

export async function mintUsdcActivity(params: {
  paymentId: string;
  amountUsd: number;
  destinationCurrency: string;
}): Promise<{
  status: "COMPLETED" | "FAILED";
  usdcAmount: number;
  usdcRate: number;
}> {
  console.log("mintUsdcActivity called with:", params);

  const willFail = params.paymentId.includes("fail-mint");

  const usdcRate = 1;
  const usdcAmount = willFail ? 0 : params.amountUsd * usdcRate;
  const status: "COMPLETED" | "FAILED" = willFail ? "FAILED" : "COMPLETED";

  const mintingId = nanoid();

  await createMintingRecord({
    id: mintingId,
    paymentId: params.paymentId,
    usdAmount: params.amountUsd,
    usdcAmount,
    usdcRate,
    status,
  });

  // Only charge fee on successful mint
  if (status === "COMPLETED") {
    const feeId = nanoid();
    const feeAmount = 0.05; // $0.05 minting fee for demo
    const feeCurrency = "USD";

    await createFeeRecord({
      id: feeId,
      paymentId: params.paymentId,
      leg: "MINTING",
      amount: feeAmount,
      currency: feeCurrency,
    });
  }

  return {
    status,
    usdcAmount,
    usdcRate,
  };
}

/**
 * 
 * Looks up the FX rate for a given currency 
 * Converts the USDC to that currency
 * records the transaction and charges .5% fee
 */
export async function offrampActivity(params: {
  paymentId: string;
  usdcAmount: number;
  destinationCurrency: string; // ISO code like "MXN", "EUR"
}): Promise<{
  status: "COMPLETED" | "FAILED";
  localAmount: number;
  fxRate: number;
}> {
  console.log("offrampActivity called with:", params);

  // 1) Look up FX rate in fx_rates (populated by import:fx)
  const fx = await getFxRate("USD", params.destinationCurrency);

  if (!fx) {
    console.warn(
      `No FX rate found for USD -> ${params.destinationCurrency}; marking offramp FAILED`
    );

    // Record a failed offramp leg so the DB view is consistent
    const offrampId = nanoid();
    await createOfframpRecord({
      id: offrampId,
      paymentId: params.paymentId,
      usdcAmount: params.usdcAmount,
      localAmount: 0,
      fxRate: 0,
      recipient: "unknown",
      status: "FAILED",
    });

    // No fee charged on failure
    return {
      status: "FAILED",
      localAmount: 0,
      fxRate: 0,
    };
  }

  const fxRate = fx.rate; // local per 1 USD
  const localAmount = params.usdcAmount * fxRate; // assuming USDC ~ USD 1:1

  // 2) Insert successful offramp leg
  const offrampId = nanoid();
  await createOfframpRecord({
    id: offrampId,
    paymentId: params.paymentId,
    usdcAmount: params.usdcAmount,
    localAmount,
    fxRate,
    recipient: "demo-recipient", // could be input later
    status: "COMPLETED",
  });

  // 3) Insert an OFFRAMP fee (example: 0.5% of localAmount)
  const feeId = nanoid();
  const feeAmount = Number((localAmount * 0.005).toFixed(2)); // 0.5%
  const feeCurrency = params.destinationCurrency;

  await createFeeRecord({
    id: feeId,
    paymentId: params.paymentId,
    leg: "OFFRAMP",
    amount: feeAmount,
    currency: feeCurrency,
  });

  return {
    status: "COMPLETED",
    localAmount,
    fxRate,
  };
}

/**
 * 
 *Creates a record of the general payment transaction
 *Starts the overall workflow!
 */
export async function createPaymentActivity(params: {
  id: string;
  usdAmount: number;
  destinationCurrency: string;
  status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
}) {
  return await createPayment(params);
}

/**
 * Updates payment status throughout workflow
 */

export async function updatePaymentStatusActivity(params: {
  id: string;
  status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
}) {
  return await updatePaymentStatus(params);
}