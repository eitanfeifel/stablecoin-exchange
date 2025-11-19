import { strict as assert } from 'assert';
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

async function createPayment(amountUsd: number, destinationCurrency: string) {
  const res = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountUsd, destinationCurrency }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createPayment failed: ${res.status} ${body}`);
  }

  return (await res.json()) as {
    message: string;
    paymentId: string;
    workflowId: string;
    runId: string;
  };
}

// New helper: returns null if payment not found yet (404)
async function getPaymentOrNull(paymentId: string) {
  const res = await fetch(`${API_BASE}/payments/${paymentId}`);

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`getPayment failed: ${res.status} ${body}`);
  }

  return (await res.json()) as {
    payment: any;
    funding: any[];
    minting: any[];
    offramp: any[];
    fees: any[];
  };
}

// If you still want a "hard" version you can keep this:
async function getPayment(paymentId: string) {
  const result = await getPaymentOrNull(paymentId);
  if (!result) {
    throw new Error(`getPayment failed: payment ${paymentId} not found`);
  }
  return result;
}

async function cancelPayment(paymentId: string, reason?: string) {
  const res = await fetch(`${API_BASE}/payments/${paymentId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`cancelPayment failed: ${res.status} ${body}`);
  }

  return (await res.json()) as any;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll /payments/:id until payment.status === expectedStatus or timeout
async function waitForPaymentStatus(
  paymentId: string,
  expectedStatus: string,
  maxAttempts = 15,
  delayMs = 1000,
) {
  for (let i = 0; i < maxAttempts; i++) {
    const snapshot = await getPaymentOrNull(paymentId);

    // If payment row doesn't exist yet, keep waiting
    if (!snapshot) {
      await sleep(delayMs);
      continue;
    }

    const { payment } = snapshot;
    if (payment.status === expectedStatus) {
      return payment;
    }

    await sleep(delayMs);
  }
  throw new Error(
    `Payment ${paymentId} did not reach status ${expectedStatus} within timeout`,
  );
}

describe('Payment workflow E2E', function () {
  // Give Mocha a bit more time, these are async end-to-end tests
  this.timeout(25000);

  /**
   * 1) Basic payment test
   */
  it('basicPaymentTest: completes successfully', async () => {
    const createRes = await createPayment(100, 'MXN');
    const paymentId = createRes.paymentId;

    const paymentRow = await waitForPaymentStatus(paymentId, 'COMPLETED');
    assert.equal(paymentRow.status, 'COMPLETED');

    const { funding, minting, offramp, fees } = await getPayment(paymentId);

    assert.equal(funding.length, 1);
    assert.equal(funding[0].status, 'COMPLETED');

    assert.equal(minting.length, 1);
    assert.equal(minting[0].status, 'COMPLETED');

    assert.equal(offramp.length, 1);
    assert.equal(offramp[0].status, 'COMPLETED');

    // Expect three fees: one per leg
    assert.equal(fees.length, 3);
    const legs = fees.map((f) => f.leg).sort();
    assert.deepEqual(legs, ['FUNDING', 'MINTING', 'OFFRAMP'].sort());
  });

  /**
   * 2) Cancel payment test
   */
  it('cancelPaymentTest: can cancel after funding', async () => {
    const createRes = await createPayment(100, 'MXN');
    const paymentId = createRes.paymentId;

    await cancelPayment(paymentId, 'test-cancel');

    const paymentRow = await waitForPaymentStatus(paymentId, 'FAILED');
    assert.equal(paymentRow.status, 'FAILED');

    const { funding, minting, offramp } = await getPayment(paymentId);

    assert.ok(funding.length >= 1);
    // optional: console.log({ minting, offramp });
  });

  /**
   * 3) Offramp FX failure test
   */
  it('offrampFxFailureTest: missing FX rate triggers failure + compensation', async () => {
    // Destination currency *must* be one you didn't seed in fx_rates
    const createRes = await createPayment(100, 'ABX');
    const paymentId = createRes.paymentId;

    const paymentRow = await waitForPaymentStatus(paymentId, 'FAILED');
    assert.equal(paymentRow.status, 'FAILED');

    const { funding, minting, offramp } = await getPayment(paymentId);

    assert.equal(funding.length, 1);
    assert.equal(funding[0].status, 'COMPENSATED');

    assert.equal(minting.length, 1);
    assert.equal(minting[0].status, 'COMPLETED');

    assert.equal(offramp.length, 1);
    assert.equal(offramp[0].status, 'FAILED');
  });
});
