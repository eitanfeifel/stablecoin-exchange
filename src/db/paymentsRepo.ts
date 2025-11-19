import { pool } from "./client";

/**
 * Repository for managing payment records in the database.
 * 
 * This module provides data access functions for the `payments` table, which
 * stores the master record for each cross-border payment transaction.
 * 
 * Each payment goes through multiple stages (funding, minting, offramp) tracked
 * in separate tables, but this table maintains the overall payment status.
 * 
 */

export type PaymentStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface Payment {
  id: string;
  usd_amount: string; // PostgreSQL returns NUMERIC as string
  destination_currency: string;
  status: PaymentStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create a new payment record
 */
export async function createPayment(params: {
  id: string;
  usdAmount: number;
  destinationCurrency: string;
  status: PaymentStatus;
}): Promise<Payment> {
  const query = `
    INSERT INTO payments (id, usd_amount, destination_currency, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *;
  `;

  const values = [
    params.id,
    params.usdAmount,
    params.destinationCurrency,
    params.status,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Update payment status
 */
export async function updatePaymentStatus(params: {
  id: string;
  status: PaymentStatus;
}): Promise<Payment> {
  const query = `
    UPDATE payments
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const values = [params.id, params.status];

  const result = await pool.query(query, values);
  
  if (!result.rows[0]) {
    throw new Error(`Payment ${params.id} not found`);
  }
  
  return result.rows[0];
}

/**
 * Get payment by ID
 */
export async function getPaymentById(id: string): Promise<Payment | null> {
  const query = `
    SELECT * FROM payments WHERE id = $1;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

/**
 * Get all payments (for debugging)
 */
export async function getAllPayments(): Promise<Payment[]> {
  const query = `
    SELECT * FROM payments ORDER BY created_at DESC;
  `;

  const result = await pool.query(query);
  return result.rows;
}