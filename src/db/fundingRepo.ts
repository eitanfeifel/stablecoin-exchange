import { pool } from "./client";
/**
 * Repository for managing funding records in the database.
 * 
 * This module handles the first leg of the payment journey: receiving USD
 * from the customer. Each funding record tracks whether the customer's money
 * was successfully received, failed, or compensated (refunded) if the payment
 * was cancelled.
 * 
 */

/**
 * Represents the status of a funding transaction.
 */
export type FundingStatus = "COMPLETED" | "FAILED" | "COMPENSATED";

/**
 * Represents a funding record from the database.
 */
export interface Funding {
  id: string;
  payment_id: string;
  usd_amount: string;
  status: FundingStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Creates a new funding record in the database.
 * 
 * This function inserts a new funding transaction record, representing the
 * first leg of the payment workflow where USD is received from the customer.

 */
export async function createFundingRecord(params: {
  id: string;
  paymentId: string;
  usdAmount: number;
  status: FundingStatus;
}): Promise<Funding> {
  const query = `
    INSERT INTO funding (id, payment_id, usd_amount, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *;
  `;

  const values = [params.id, params.paymentId, params.usdAmount, params.status];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Updates the status of an existing funding record.
 * 
 * This function is called when:
 * - A funding transaction fails
 * - A payment is cancelled and funds need to be marked as COMPENSATED (refunded)
 */
export async function updateFundingStatus(params: {
  id: string;
  status: FundingStatus;
}): Promise<Funding> {
  const query = `
    UPDATE funding
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const values = [params.id, params.status];

  const result = await pool.query(query, values);

  if (!result.rows[0]) {
    throw new Error(`Funding record ${params.id} not found`);
  }

  return result.rows[0];
}

/**
 * Retrieves all funding records for a specific payment.
 * 
 * Typically there's only one funding record per payment, but this function
 * returns an array to handle edge cases where multiple funding attempts
 * may have occurred.
 */
export async function getFundingByPaymentId(
  paymentId: string
): Promise<Funding[]> {
  const query = `
    SELECT * FROM funding WHERE payment_id = $1 ORDER BY created_at DESC;
  `;

  const result = await pool.query(query, [paymentId]);
  return result.rows;
}

/**
 * Retrieves a funding record by its unique identifier.
 */
export async function getFundingById(id: string): Promise<Funding | null> {
  const query = `
    SELECT * FROM funding WHERE id = $1;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}