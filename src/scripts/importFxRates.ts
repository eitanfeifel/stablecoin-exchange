import fs from "fs";
import path from "path";
import { pool } from "../db/client";

interface TreasuryRow {
  record_date: string;
  country_currency_desc: string; // e.g. "Mexico-Peso"
  exchange_rate: string;         // e.g. "18.344"
  effective_date: string;        // e.g. "2025-09-30"
}

interface TreasuryFile {
  data: TreasuryRow[];
}

// --- Load currency_mapping.json (ISO_CODE -> description) ---

type CodeToDesc = Record<string, string>;

// Both files are in src/data/, and this script is in src/scripts/
const mappingPath = path.join(__dirname, "../data/currency_mapping.json");
const codeToDesc: CodeToDesc = JSON.parse(
  fs.readFileSync(mappingPath, "utf8")
);

// Build desc -> ISO code map in memory
const descToCodeMap = new Map<string, string>();
for (const [code, desc] of Object.entries(codeToDesc)) {
  // e.g. code = "MXN", desc = "Mexico-Peso"
  descToCodeMap.set(desc, code); // key: "Mexico-Peso", value: "MXN"
}

// Simple, strict lookup: if it's not in the file, we error
function descToCode(desc: string): string {
  const code = descToCodeMap.get(desc);
  if (!code) {
    throw new Error(
      `Unknown currency description: "${desc}" – no entry in currency_mapping.json`
    );
  }
  return code; // always a real ISO code from the file
}

async function main() {
  // FXRates.json is also in src/data/, so same path structure
  const filePath = path.join(__dirname, "../data/FXRates.json");

  const parsed: TreasuryFile = JSON.parse(fs.readFileSync(filePath, "utf8"));

  // Keep only latest rate per currency description
  const latestByDesc = new Map<string, TreasuryRow>();
  for (const row of parsed.data) {
    const key = row.country_currency_desc; // "Mexico-Peso"
    const existing = latestByDesc.get(key);
    if (!existing || row.effective_date > existing.effective_date) {
      latestByDesc.set(key, row);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [desc, row] of latestByDesc.entries()) {
      const quoteCurrency = descToCode(desc); // <- ISO from mapping file only
      const rate = Number(row.exchange_rate);
      const asOf = row.effective_date;

      await client.query(
        `
        INSERT INTO fx_rates (base_currency, quote_currency, rate, as_of)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (base_currency, quote_currency)
        DO UPDATE SET
          rate = EXCLUDED.rate,
          as_of = EXCLUDED.as_of
        `,
        ["USD", quoteCurrency, rate, asOf]
      );
    }

    await client.query("COMMIT");
    console.log(`Imported ${latestByDesc.size} FX rates successfully.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error importing FX rates:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});