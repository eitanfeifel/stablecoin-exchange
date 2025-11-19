import { pool } from "./client";
/**
 * Repository for managing minting records in the database.
 * 
 * This module handles the second leg of the payment journey: converting USD
 * to USDC (USD Coin) stablecoin. The minting process takes the received USD
 * and creates an equivalent amount of blockchain-based USDC tokens.
 * 
 * The conversion rate is typically 1:1 (1 USD = 1 USDC), but the rate is
 * tracked explicitly to handle any edge cases or fees.
 * 
 */

export type MintingStatus = "COMPLETED" | "FAILED";

/**
 * Represents a minting record from the database.
 */
export interface Minting {
  id: string;
  payment_id: string;
  usd_amount: string;
  usdc_amount: string;
  usdc_rate: string;
  status: MintingStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Creates a new minting record in the database.
 * 
 * This function inserts a new minting transaction record, representing the
 * conversion of USD to USDC stablecoin (second leg of payment workflow).
 * 
 * The conversion rate is typically 1:1, meaning:
 * - Input: 100 USD
 * - Rate: 1.0
 * - Output: 100 USDC
 */
export async function createMintingRecord(params: {
  id: string;
  paymentId: string;
  usdAmount: number;
  usdcAmount: number;
  usdcRate: number;
  status: MintingStatus;
}): Promise<Minting> {
  const query = `
    INSERT INTO minting (
      id,
      payment_id,
      usd_amount,
      usdc_amount,
      usdc_rate,
      status,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING *;
  `;

  const values = [
    params.id,
    params.paymentId,
    params.usdAmount,
    params.usdcAmount,
    params.usdcRate,
    params.status,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Updates the status of an existing minting record.
 * 
 * This function is typically called when a minting operation fails after
 * being initially recorded, or when retrying a failed minting attempt.
 * 
 */
export async function updateMintingStatus(params: {
  id: string;
  status: MintingStatus;
}): Promise<Minting> {
  const query = `
    UPDATE minting
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const values = [params.id, params.status];

  const result = await pool.query(query, values);

  if (!result.rows[0]) {
    throw new Error(`Minting record ${params.id} not found`);
  }

  return result.rows[0];
}

/**
 * Retrieves all minting records for a specific payment.
 * 
 * Typically there's only one minting record per payment, but this function
 * returns an array to handle edge cases where multiple minting attempts
 * may have occurred (e.g., retries after failures).
 * 
 */
export async function getMintingByPaymentId(
  paymentId: string
): Promise<Minting[]> {
  const query = `
    SELECT * FROM minting WHERE payment_id = $1 ORDER BY created_at DESC;
  `;

  const result = await pool.query(query, [paymentId]);
  return result.rows;
}

/**
 * Retrieves a minting record by its unique identifier.
 */
export async function getMintingById(id: string): Promise<Minting | null> {
  const query = `
    SELECT * FROM minting WHERE id = $1;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}