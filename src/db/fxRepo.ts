import { pool } from "./client";

export interface FxRateRow {
  rate: number;
  asOf: Date;
}

export async function getFxRate(
  base: string,
  quote: string
): Promise<FxRateRow | null> {
  const res = await pool.query(
    `SELECT rate, as_of FROM fx_rates WHERE base_currency = $1 AND quote_currency = $2`,
    [base, quote]
  );

  if (res.rowCount === 0) return null;

  return {
    rate: Number(res.rows[0].rate),
    asOf: res.rows[0].as_of,
  };
}