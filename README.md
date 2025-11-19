
# Infinite Payments - Cross-Border Payment System

A payment processing system that handles cross-border payments using **Temporal workflows**, **USDC stablecoin**, and real-time **FX rates from U.S. Treasury**.

## Project Overview
Sample usage:

1. **Customer in US** wants to send $100 to someone in Mexico
2. System receives $100 USD (+ $0.30 funding fee)
3. Converts to USDC stablecoin (+ $0.05 minting fee)
4. Converts USDC → MXN using live FX rate (+ 0.5% offramp fee)
5. **Recipient in Mexico** receives ~1,825 MXN

The **Temporal workflow** ensures that if anything fails (bank error, missing FX rate, etc.), the system can gracefully recover or compensate the user.

---

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP POST /payments
       ↓
┌─────────────────────┐
│   Express API       │ ← REST endpoints (port 3000)
│   (server.ts)       │
└──────┬──────────────┘
       │ Start workflow
       ↓
┌─────────────────────┐
│  Temporal Server    │ ← Orchestration engine (port 7233)
│                     │
└──────┬──────────────┘
       │ Dispatch tasks
       ↓
┌─────────────────────┐
│   Temporal Worker   │ ← Executes workflows & activities
│   (worker.ts)       │
│                     │
│   ┌─────────────┐   │
│   │ Workflows   │   │ ← Orchestration logic
│   └─────────────┘   │
│   ┌─────────────┐   │
│   │ Activities  │   │ ← Business logic
│   └─────────────┘   │
└──────┬──────────────┘
       │ Database calls
       ↓
┌─────────────────────┐
│   PostgreSQL        │ ← Data storage (port 5432)
│   (temporal_payments)│
└─────────────────────┘
```

### **Payment Flow (3-Leg Journey)**

```
Payment Created
    ↓
┌─────────────────────┐
│  LEG 1: FUNDING     │ ← Receive USD from customer
│  Fee: $0.30         │
└─────────────────────┘
    ↓ Success
┌─────────────────────┐
│  LEG 2: MINTING     │ ← Convert USD → USDC (1:1)
│  Fee: $0.05         │
└─────────────────────┘
    ↓ Success
┌─────────────────────┐
│  LEG 3: OFFRAMP     │ ← Convert USDC → MXN (using FX rate)
│  Fee: 0.5%          │
└─────────────────────┘
    ↓ Success
Payment Completed (checkmark)

If any leg fails → Compensation (refund customer)
```

---

## Quick Start

### **Prerequisites**

- **Node.js 22+** (specified in `.nvmrc`)
- **PostgreSQL** (running locally)
- **Temporal Server** (install via Homebrew/CLI or Docker)

### **1. Clone & Install**

```bash
git clone <your-repo-url>
cd infinite-payments
npm install
```

### 2. Configure Database (CRITICAL STEP)

**IMPORTANT: You must set your PostgreSQL password before running the application!**

Copy the example config and update with your PostgreSQL password:

 edit `src/db/dgConfig.ts`:

```typescript
export const DB_CONFIG = {
  user: "postgres",
  host: "localhost",
  database: "temporal_payments",
  password: "YOUR_PASSWORD_HERE", // CHANGE THIS!
  port: 5432,
};
```

### **3. Create Database**

```bash
# Create the database
createdb temporal_payments

# Or using psql:
psql -U postgres
CREATE DATABASE temporal_payments;
\q
```

### **4. Initialize Database Schema**

```bash
# Create all tables and import FX rates
npm run db:setup
```

This runs:
1. `schema.sql` → Creates tables (`payments`, `funding`, `minting`, `offramp`, `fees`, `fx_rates`)
2. `importFxRates.ts` → Imports 167 currency exchange rates from U.S. Treasury data

### **5. Start Temporal Server**

#### **Option A: CLI (Recommended for development)**

```bash
temporal server start-dev
```

#### **Option B: Docker**

```bash
docker run -p 7233:7233 -p 8233:8233 temporalio/auto-setup:latest
```

Access Temporal UI at: http://localhost:8233

### **6. Start the Application**

You need **3 terminals** running simultaneously:

#### **Terminal 1: Start Temporal Worker**

```bash
npm run start
```

Output:
```
Worker connection established
```

#### **Terminal 2: Start API Server**

```bash
npm run api
```

Output:
```
HTTP API listening on http://localhost:3000
```

#### **Terminal 3: Create a Payment**

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amountUsd": 100,
    "destinationCurrency": "MXN"
  }'
```

Response:
```json
{
  "message": "Payment workflow started",
  "paymentId": "payment-1234567890",
  "workflowId": "payment-payment-1234567890",
  "runId": "abc123..."
}
```

#### **Check Payment Status**

```bash
curl http://localhost:3000/payments/payment-1234567890
```

Response:
```json
{
  "payment": {
    "id": "payment-1234567890",
    "usd_amount": "100.00",
    "destination_currency": "MXN",
    "status": "COMPLETED"
  },
  "funding": [{ "status": "COMPLETED", "usd_amount": "100.00" }],
  "minting": [{ "status": "COMPLETED", "usdc_amount": "100.000000" }],
  "offramp": [{ "status": "COMPLETED", "local_amount": "1834.40", "fx_rate": "18.344" }],
  "fees": [
    { "leg": "FUNDING", "amount": "0.30", "currency": "USD" },
    { "leg": "MINTING", "amount": "0.05", "currency": "USD" },
    { "leg": "OFFRAMP", "amount": "9.17", "currency": "MXN" }
  ]
}
```

### **7. Run Tests**

```bash
npm test
```

Runs end-to-end tests:
- ✅ Basic payment completion
- ✅ Payment cancellation
- ✅ Offramp failure with compensation

---

## Database Schema

### **Tables Overview**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `payments` | Master payment record | `id`, `usd_amount`, `destination_currency`, `status` |
| `funding` | Leg 1: USD receipt | `payment_id`, `usd_amount`, `status` |
| `minting` | Leg 2: USDC creation | `payment_id`, `usdc_amount`, `usdc_rate`, `status` |
| `offramp` | Leg 3: Local currency conversion | `payment_id`, `local_amount`, `fx_rate`, `status` |
| `fees` | Fee tracking per leg | `payment_id`, `leg`, `amount`, `currency` |
| `fx_rates` | Exchange rates (from Treasury) | `base_currency`, `quote_currency`, `rate`, `as_of` |

### **Schema Diagram**

```
payments (1) ──┬──> (M) funding
               ├──> (M) minting
               ├──> (M) offramp
               └──> (M) fees

fx_rates (standalone)
```

### **Key Design Decisions**

#### **1. Separate Tables Per Leg**
- Why: Each leg has different fields (e.g., usdc_amount only in minting)
- Benefit: Clear schema, easy to query individual legs
- Trade-off: More joins, but better for auditing

#### **2. Status Tracking at Multiple Levels**
- payments.status - Overall payment state
- funding.status, minting.status, offramp.status - Individual leg states
- Why: Granular visibility for troubleshooting

#### **3. Fees in Separate Table**
- Why: Multiple fees per payment (funding, minting, offramp)
- Benefit: Easy to calculate total fees, different currencies

#### **4. FX Rates Table**
- Why: Real-time rates from U.S. Treasury
- Benefit: Audit trail (know exact rate used for each payment)
- Primary Key: (base_currency, quote_currency) ensures one rate per pair

---

## Design Decisions

### **Why Temporal?**

Traditional approach (without Temporal):
```typescript
await step1();
await step2();  // ← What if server crashes here?
await step3();  // ← Lost progress, need to replay everything
```

With Temporal:
```typescript
await step1();  // ✅ Completed, state saved
await step2();  // ❌ Server crashes
// Temporal automatically resumes from step2 when server restarts!
await step3();  // ✅ Continues where it left off
```

**Benefits:**
- Reliability: Survives server crashes, network failures
- Visibility: See workflow state in Temporal UI
- Compensation: Built-in saga pattern for rollbacks
- Signals & Queries: External control and monitoring

### **Why Child Workflows?**

Each payment leg is a **separate child workflow**:

```typescript
FundingWorkflow  → Encapsulates funding logic
MintingWorkflow  → Encapsulates minting logic
OfframpWorkflow  → Encapsulates offramp logic
```

**Benefits:**
- Modularity: Each leg is independent, reusable
- Monitoring: Each shows up separately in Temporal UI
- Testing: Test each leg in isolation
- Parallel Execution: Could process multiple payments simultaneously

### **Why Repository Pattern?**

Separate data access layer (`*Repo.ts` files):

**Without Repos:**
```typescript
// SQL scattered everywhere
await pool.query("SELECT * FROM payments WHERE id = $1", [id]);
```

**With Repos:**
```typescript
// Clean, reusable, testable
const payment = await getPaymentById(id);
```

**Benefits:**
- Separation of Concerns: Business logic separate from SQL
- Reusability: Same query used across codebase
- Testability: Mock repos in tests
- Easy to Change: Switch databases without changing business logic

### **Why USDC as Bridge Currency?**

```
USD → USDC → Local Currency
```

Instead of direct USD → Local conversion:

**Benefits:**
- Blockchain Settlement: USDC can settle on-chain (fast, cheap)
- Liquidity: USDC widely available on exchanges
- Stability: Pegged 1:1 to USD (low volatility)
- Global Rails: Works across borders without traditional banking

### **Compensation Strategy (Saga Pattern)**

When a leg fails, we **compensate** (rollback) previous legs:

```
Funding ✅ → Minting ❌
             ↓
         Compensate Funding (refund customer)
```

**Implementation:**
```typescript
if (mintingResult.status === 'FAILED') {
  await compensateFundingActivity({ fundingId });  // Refund
  await updatePaymentStatusActivity({ status: 'FAILED' });
  return "Payment FAILED; funding COMPENSATED";
}
```

**Why not database transactions?**
- Cannot use DB transactions across distributed services (funding might be external bank API)
- Saga pattern handles long-running, distributed transactions

---

## API Endpoints

### POST /payments
Create a new payment and start workflow execution.

**Request:**
```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amountUsd": 100,
    "destinationCurrency": "MXN"
  }'
```

**Response (202 Accepted):**
```json
{
  "message": "Payment workflow started",
  "paymentId": "payment-1234567890",
  "workflowId": "payment-payment-1234567890",
  "runId": "abc123..."
}
```

### GET /payments/:id
Retrieve payment details including all legs and fees.

**Request:**
```bash
curl http://localhost:3000/payments/payment-1234567890
```

**Response (200 OK):**
```json
{
  "payment": {
    "id": "payment-1234567890",
    "usd_amount": "100.00",
    "destination_currency": "MXN",
    "status": "COMPLETED"
  },
  "funding": [{ "status": "COMPLETED", "usd_amount": "100.00" }],
  "minting": [{ "status": "COMPLETED", "usdc_amount": "100.000000" }],
  "offramp": [{ "status": "COMPLETED", "local_amount": "1834.40" }],
  "fees": [
    { "leg": "FUNDING", "amount": "0.30", "currency": "USD" },
    { "leg": "MINTING", "amount": "0.05", "currency": "USD" },
    { "leg": "OFFRAMP", "amount": "9.17", "currency": "MXN" }
  ]
}
```

### POST /payments/:id/cancel
Send cancellation signal to running workflow.

**Request:**
```bash
curl -X POST http://localhost:3000/payments/payment-1234567890/cancel \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Customer requested refund" }'
```

**Response (200 OK):**
```json
{
  "message": "Cancel signal sent",
  "paymentId": "payment-1234567890",
  "workflowId": "payment-payment-1234567890",
  "reason": "Customer requested refund"
}
```

---

## Testing

Run the test suite:

```bash
npm test
```

Tests include:
- Basic payment flow (funding -> minting -> offramp)
- Payment cancellation with compensation
- Offramp failure handling (missing FX rate)

---

## Project Structure

```
infinite-payments/
├── src/
│   ├── activities.ts           # Business logic for each payment step
│   ├── workflows.ts            # Temporal workflow orchestration
│   ├── worker.ts               # Temporal worker (executes workflows)
│   ├── server.ts               # Express API server
│   ├── db/
│   │   ├── client.ts           # PostgreSQL connection
│   │   ├── constants.ts        # Database credentials (gitignored)
│   │   ├── constants.example.ts # Template for credentials
│   │   ├── schema.sql          # Database schema
│   │   ├── paymentsRepo.ts     # Payment data access
│   │   ├── fundingRepo.ts      # Funding data access
│   │   ├── mintingRepo.ts      # Minting data access
│   │   ├── offrampRepo.ts      # Offramp data access
│   │   ├── feesRepo.ts         # Fees data access
│   │   └── fxRepo.ts           # FX rates data access
│   ├── data/
│   │   ├── FXRates.json        # Treasury FX rates data
│   │   └── currency_mapping.json # Currency code mappings
│   ├── scripts/
│   │   └── importFxRates.ts    # Import FX rates to database
│   └── mocha/
│       └── paymentTest.test.ts # End-to-end tests
├── package.json
├── tsconfig.json
└── README.md
```

---

## Temporal Patterns Used

### 1. Child Workflows
Each payment leg runs as a separate child workflow:
- `FundingWorkflow` - Handles USD receipt
- `MintingWorkflow` - Handles USDC conversion
- `OfframpWorkflow` - Handles local currency delivery

### 2. Signals
External cancellation via `cancelPaymentSignal`:
```typescript
// Send signal from API
await workflowHandle.signal(cancelPaymentSignal, "reason");

// Handle in workflow
setHandler(cancelPaymentSignal, (reason) => {
  cancelRequested = true;
});
```

### 3. Queries
Check workflow status without modifying state:
```typescript
// Query from external code
const status = await workflowHandle.query(paymentStatusQuery);

// Returns: { stage: "MINTING_RUNNING", cancelRequested: false }
```

### 4. Saga Pattern (Compensation)
Automatic rollback on failure:
```typescript
if (mintingResult.status === 'FAILED') {
  // Compensate (refund) the funding leg
  await compensateFundingActivity({ fundingId });
  await updatePaymentStatusActivity({ status: 'FAILED' });
}
```

---

=======
# stablecoin-exchange
Cross-border payment system with Temporal workflows, USDC, and real-time FX rates. Implements saga pattern, child workflows, and distributed transaction handling.
>>>>>>> 0ee15a23fbe81d06c1cdd9a8ba255a4b601f94bf
