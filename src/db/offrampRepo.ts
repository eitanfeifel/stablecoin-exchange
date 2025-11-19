import { pool } from "./client";
/**
 * Repository for managing offramp records in the database.
 * 
 * This module handles the final leg of the payment journey: converting USDC
 * stablecoin to the destination local currency (e.g., MXN, EUR, PHP) and
 * delivering it to the recipient.
 * 
 * The offramp process:
 * 1. Takes USDC tokens from the minting leg
 * 2. Applies the current FX rate (from Treasury data)
 * 3. Converts to local currency
 * 4. Delivers to the specified recipient
 */

/**
 * Represents the status of an offramp transaction.
 */
export type OfframpStatus = "COMPLETED" | "FAILED";

/**
 * Represents an offramp record from the database.
 */
export interface Offramp {
  id: string;
  payment_id: string;
  usdc_amount: string;
  local_amount: string;
  fx_rate: string;
  recipient: string;
  status: OfframpStatus;
  created_at: Date;
  updated_at: Date;
}


/**
 * Creates a new offramp record in the database.
 * 
 * This function inserts a new offramp transaction record, representing the
 * final leg where USDC is converted to local currency and delivered to
 * the recipient.
 */
export async function createOfframpRecord(params: {
  id: string;
  paymentId: string;
  usdcAmount: number;
  localAmount: number;
  fxRate: number;
  recipient: string;
  status: OfframpStatus;
}): Promise<Offramp> {
  const query = `
    INSERT INTO offramp (
      id,
      payment_id,
      usdc_amount,
      local_amount,
      fx_rate,
      recipient,
      status,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING *;
  `;

  const values = [
    params.id,
    params.paymentId,
    params.usdcAmount,
    params.localAmount,
    params.fxRate,
    params.recipient,
    params.status,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Updates the status of an existing offramp record.
 * 
 * This function is typically called when an offramp operation fails after
 * being initially recorded, or when retrying a failed delivery attempt.
 */
export async function updateOfframpStatus(params: {
  id: string;
  status: OfframpStatus;
}): Promise<Offramp> {
  const query = `
    UPDATE offramp
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const values = [params.id, params.status];

  const result = await pool.query(query, values);

  if (!result.rows[0]) {
    throw new Error(`Offramp record ${params.id} not found`);
  }

  return result.rows[0];
}

/**
 * Retrieves all offramp records for a specific payment.
 * 
 * Typically there's only one offramp record per payment, but this function
 * returns an array to handle edge cases where multiple delivery attempts
 * may have occurred.
 * 
 */
export async function getOfframpByPaymentId(
  paymentId: string
): Promise<Offramp[]> {
  const query = `
    SELECT * FROM offramp WHERE payment_id = $1 ORDER BY created_at DESC;
  `;

  const result = await pool.query(query, [paymentId]);
  return result.rows;
}

/**
 * Retrieves an offramp record by its unique identifier.
 * 
 */
export async function getOfframpById(id: string): Promise<Offramp | null> {
  const query = `
    SELECT * FROM offramp WHERE id = $1;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}