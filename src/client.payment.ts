import { Connection, Client } from '@temporalio/client';
import { PaymentWorkflow } from './workflows';
import { nanoid } from 'nanoid';

async function run() {
  const connection = await Connection.connect({
    address: '127.0.0.1:7233',
    tls: false,
  });

  const client = new Client({ connection });


  const paymentId = `test-payment-${nanoid()}`;  // unique business id
  const amountUsd = 137;                         // change this freely for now
  const destinationCurrency = "EUR";             // or "MXN", "GBP", etc.


  const handle = await client.workflow.start(PaymentWorkflow, {
    taskQueue: 'hello-world',
    workflowId: `payment-${paymentId}`, // now unique each run
    args: [{ paymentId, amountUsd, destinationCurrency }],
  });

  console.log(`Started PaymentWorkflow ${handle.workflowId}`);

  const result = await handle.result();
  console.log("Workflow result:", result);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
