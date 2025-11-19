import { pool } from "./client";

export async function createFeeRecord(params: {
  id: string;
  paymentId: string;
  leg: string;        // 'FUNDING' | 'MINTING' | 'OFFRAMP'
  amount: number;
  currency: string;
}) {
  const query = `
    INSERT INTO fees (
      id,
      payment_id,
      leg,
      amount,
      currency,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *;
  `;

  const values = [
    params.id,
    params.paymentId,
    params.leg,
    params.amount,
    params.currency,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}
