-- TABLE: payments
-- Purpose: Master record for each payment request
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  usd_amount NUMERIC(18, 2) NOT NULL,
  destination_currency TEXT NOT NULL,
  status TEXT NOT NULL, -- CREATED, IN_PROGRESS, COMPLETED, FAILED
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE payments IS 'Master payment records tracking overall payment status';
COMMENT ON COLUMN payments.id IS 'Unique payment identifier (e.g., payment-abc123)';
COMMENT ON COLUMN payments.usd_amount IS 'Amount in USD that customer wants to send';
COMMENT ON COLUMN payments.destination_currency IS 'Target currency ISO code (MXN, EUR, etc.)';
COMMENT ON COLUMN payments.status IS 'Current payment state: CREATED, IN_PROGRESS, COMPLETED, FAILED';

-- TABLE: funding
-- Purpose: Leg 1 - Track receipt of USD from customer
CREATE TABLE IF NOT EXISTS funding (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  usd_amount NUMERIC(18, 2) NOT NULL,
  status TEXT NOT NULL, -- COMPLETED, FAILED, COMPENSATED
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_funding_payment_id ON funding(payment_id);

COMMENT ON TABLE funding IS 'Tracks customer USD funding transactions (Leg 1)';
COMMENT ON COLUMN funding.status IS 'COMPLETED, FAILED, or COMPENSATED (if payment rolled back)';

-- TABLE: minting
-- Purpose: Leg 2 - Track conversion of USD to USDC stablecoin
CREATE TABLE IF NOT EXISTS minting (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  usd_amount NUMERIC(18, 2) NOT NULL,
  usdc_amount NUMERIC(18, 6) NOT NULL,
  usdc_rate NUMERIC(18, 6) NOT NULL,
  status TEXT NOT NULL, -- COMPLETED, FAILED
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_minting_payment_id ON minting(payment_id);

COMMENT ON TABLE minting IS 'Tracks USD to USDC conversion (Leg 2)';
COMMENT ON COLUMN minting.usdc_rate IS 'Conversion rate, typically 1.0 (1 USD = 1 USDC)';

-- TABLE: offramp
-- Purpose: Leg 3 - Track conversion of USDC to destination currency
CREATE TABLE IF NOT EXISTS offramp (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  usdc_amount NUMERIC(18, 6) NOT NULL,
  local_amount NUMERIC(18, 2) NOT NULL,
  fx_rate NUMERIC(18, 6) NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL, -- COMPLETED, FAILED
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offramp_payment_id ON offramp(payment_id);

COMMENT ON TABLE offramp IS 'Tracks USDC to local currency conversion (Leg 3)';
COMMENT ON COLUMN offramp.fx_rate IS 'Exchange rate: local currency units per 1 USD';
COMMENT ON COLUMN offramp.local_amount IS 'Final amount in destination currency';

-- TABLE: fees
-- Purpose: Track all fees charged for each payment leg
CREATE TABLE IF NOT EXISTS fees (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  leg TEXT NOT NULL, -- FUNDING, MINTING, OFFRAMP
  amount NUMERIC(18, 6) NOT NULL,
  currency TEXT NOT NULL, -- USD or destination currency
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fees_payment_id ON fees(payment_id);

COMMENT ON TABLE fees IS 'Fee records for each payment leg';
COMMENT ON COLUMN fees.leg IS 'Which stage of payment: FUNDING, MINTING, or OFFRAMP';
COMMENT ON COLUMN fees.currency IS 'Currency of the fee (USD for FUNDING/MINTING, local for OFFRAMP)';

-- TABLE: fx_rates
-- Purpose: Store foreign exchange rates (imported from U.S. Treasury dataset)
CREATE TABLE IF NOT EXISTS fx_rates (
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate NUMERIC(18, 6) NOT NULL,
  as_of DATE NOT NULL,
  PRIMARY KEY (base_currency, quote_currency)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_quote ON fx_rates(quote_currency);

COMMENT ON TABLE fx_rates IS 'Foreign exchange rates imported from U.S. Treasury';
COMMENT ON COLUMN fx_rates.base_currency IS 'Always USD in this system';
COMMENT ON COLUMN fx_rates.quote_currency IS 'ISO currency code (MXN, EUR, JPY, etc.)';
COMMENT ON COLUMN fx_rates.rate IS 'How many units of quote currency per 1 USD';
COMMENT ON COLUMN fx_rates.as_of IS 'Date when this rate was effective';

-- TABLE: currencies (acts as a reference table)
-- Purpose: Store metadata about supported currencies
CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT,
  decimal_places INTEGER DEFAULT 2
);

COMMENT ON TABLE currencies IS 'Reference table for currency metadata';
COMMENT ON COLUMN currencies.code IS 'ISO 4217 currency code (MXN, EUR, etc.)';
COMMENT ON COLUMN currencies.decimal_places IS 'Number of decimal places for this currency';


-- Insert USD as base currency
INSERT INTO currencies (code, name, symbol, decimal_places)
VALUES ('USD', 'US Dollar', '$', 2)
ON CONFLICT (code) DO NOTHING;
