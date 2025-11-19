import express from 'express';
import cors from 'cors';
import { Connection, Client } from '@temporalio/client';
import { PaymentWorkflow, cancelPaymentSignal } from './workflows';
import { pool } from './db/client';

const app = express();
app.use(cors());
app.use(express.json());

// Temporal client singleton
let temporalClientPromise: Promise<Client> | null = null;

async function getTemporalClient(): Promise<Client> {
  if (!temporalClientPromise) {
    temporalClientPromise = (async () => {
      const connection = await Connection.connect({
        address: '127.0.0.1:7233',
        tls: false,
      });
      return new Client({ connection });
    })();
  }
  return temporalClientPromise;
}

// POST /payments -> start a PaymentWorkflow
app.post('/payments', async (req, res) => {
  try {
    const { amountUsd, destinationCurrency, paymentId } = req.body;

    if (typeof amountUsd !== 'number' || !destinationCurrency) {
      return res.status(400).json({
        error: 'amountUsd (number) and destinationCurrency (string) are required',
      });
    }

    const id: string =
      typeof paymentId === 'string' && paymentId.length > 0
        ? paymentId
        : `payment-${Date.now()}`;

    const client = await getTemporalClient();

    const handle = await client.workflow.start(PaymentWorkflow, {
      taskQueue: 'hello-world',
      workflowId: `payment-${id}`,
      args: [
        {
          paymentId: id,
          amountUsd,
          destinationCurrency,
        },
      ],
    });

    return res.status(202).json({
      message: 'Payment workflow started',
      paymentId: id,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    });
  } catch (err: any) {
    console.error('Error starting payment workflow:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /payments/:id -> return DB view of the payment
app.get('/payments/:id', async (req, res) => {
  const paymentId = req.params.id;

  try {
    // Top-level payment
    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [paymentId],
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];

    // Legs
    const [fundingRes, mintingRes, offrampRes, feesRes] = await Promise.all([
      pool.query('SELECT * FROM funding WHERE payment_id = $1', [paymentId]),
      pool.query('SELECT * FROM minting WHERE payment_id = $1', [paymentId]),
      pool.query('SELECT * FROM offramp WHERE payment_id = $1', [paymentId]),
      pool.query('SELECT * FROM fees WHERE payment_id = $1', [paymentId]),
    ]);

    return res.json({
      payment,
      funding: fundingRes.rows,
      minting: mintingRes.rows,
      offramp: offrampRes.rows,
      fees: feesRes.rows,
    });
  } catch (err: any) {
    console.error('Error fetching payment from DB:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /payments/:id/cancel -> send cancelPayment signal to workflow
app.post('/payments/:id/cancel', async (req, res) => {
  const paymentId = req.params.id;
  const { reason } = req.body || {};

  try {
    const client = await getTemporalClient();

    // Our PaymentWorkflow uses workflowId = `payment-${paymentId}`
    const workflowId = `payment-${paymentId}`;
    const handle = client.workflow.getHandle(workflowId);

    await handle.signal(cancelPaymentSignal, reason);

    return res.json({
      message: 'Cancel signal sent',
      paymentId,
      workflowId,
      reason: reason ?? null,
    });
  } catch (err: any) {
    console.error('Error sending cancel signal:', err);

    // If workflow doesn't exist or is closed, treat as 404
    if (err?.name === 'WorkflowNotFoundError') {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HTTP API listening on http://localhost:${PORT}`);
});



