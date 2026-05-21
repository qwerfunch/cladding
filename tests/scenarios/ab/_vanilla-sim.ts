// Cladding · scenarios · ab · vanilla simulator (v0.3.47, F-4db939)
//
// "Smart vanilla Claude Code" session simulator. Each session is a
// pre-curated file set that a senior developer working with plain
// Claude Code (no cladding plugin, no SSoT artifacts) would plausibly
// produce on the same intent.
//
// Rationale for hand-curation (acknowledged in docs/ab-evaluation/README.md):
// running real Claude Code sessions in test is non-deterministic and
// out of scope for v0.3.47. The trade-off is bias risk — we counter
// by writing vanilla code at SENIOR quality (proper directory split,
// executable handlers, real tests) so the comparison stays fair.
// cladding's value should not depend on vanilla being underwritten.

import {writeUnderCwd} from '../_helpers.js';

/** One stage's worth of files. */
export type FileSet = ReadonlyMap<string, string>;

export interface VanillaSession {
  readonly intent: string;
  readonly m1Files: FileSet;
  readonly m2Files: FileSet;
}

export function applyFileSet(cwd: string, files: FileSet): void {
  for (const [rel, body] of files) {
    writeUnderCwd(cwd, rel, body);
  }
}

// ──────────────────────────────────────────────────────────────────
// Session 1 — Payment SaaS for B2B (greenfield)
// ──────────────────────────────────────────────────────────────────

const PAYMENT_PKG_JSON = `{
  "name": "payment-saas",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^5.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
`;

const PAYMENT_TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
`;

const PAYMENT_README_MD = `# Payment SaaS for B2B

A B2B payment gateway service that integrates Stripe and Toss for
multi-PG support, with retry and webhook handling.

## Install

\`\`\`bash
npm install
\`\`\`

## Usage

\`\`\`ts
import {handlePayment} from './src/api/payment.js';

const r = await handlePayment({
  merchantId: 'M-001',
  amount: 10_000,
  currency: 'KRW',
  pg: 'toss',
});
\`\`\`

## API

### POST /payment

Charges a B2B merchant. Body: \`{merchantId, amount, currency, pg}\`.
Returns \`{transactionId, status}\`.

### POST /refund (M2)

Refunds a previous transaction by id.

## Architecture

Code is split into:

- \`src/api/\` — HTTP handlers (express)
- \`src/lib/\` — PG client wrappers
- \`src/util/\` — logging, helpers

PG clients hide network details behind a unified interface.
`;

const PAYMENT_API_PAYMENT_TS = `// payment-saas · api · payment
//
// HTTP entrypoint for B2B payment authorization. Validates input,
// delegates to the PG client, returns a transaction id.

import {z} from 'zod';

import {chargeViaPg, type PgName} from '../lib/pg.js';
import {log} from '../util/log.js';

const RequestSchema = z.object({
  merchantId: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.enum(['KRW', 'USD']),
  pg: z.enum(['stripe', 'toss']),
});

export interface PaymentResult {
  readonly transactionId: string;
  readonly status: 'success' | 'declined';
}

export async function handlePayment(input: unknown): Promise<PaymentResult> {
  const parsed = RequestSchema.parse(input);
  log('payment.requested', {merchantId: parsed.merchantId, amount: parsed.amount});
  const r = await chargeViaPg(parsed.pg as PgName, {
    amount: parsed.amount,
    currency: parsed.currency,
    merchantId: parsed.merchantId,
  });
  log('payment.completed', {transactionId: r.transactionId, status: r.status});
  return r;
}
`;

const PAYMENT_LIB_PG_TS = `// payment-saas · lib · pg
//
// Unified PG client interface. Two backends: stripe + toss.

import {log} from '../util/log.js';

export type PgName = 'stripe' | 'toss';

export interface ChargeInput {
  readonly merchantId: string;
  readonly amount: number;
  readonly currency: 'KRW' | 'USD';
}

export interface ChargeResult {
  readonly transactionId: string;
  readonly status: 'success' | 'declined';
}

export async function chargeViaPg(pg: PgName, input: ChargeInput): Promise<ChargeResult> {
  log('pg.charge', {pg, merchantId: input.merchantId});
  // In a real implementation, dispatch to the matching SDK.
  // Here we return a synthetic id so the handler chain stays exercisable.
  const transactionId = \`tx_\${pg}_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\`;
  return {transactionId, status: 'success'};
}
`;

const PAYMENT_UTIL_LOG_TS = `// payment-saas · util · log
//
// Tiny logger wrapper — easy to swap for pino/winston later.

export function log(event: string, fields: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({t: new Date().toISOString(), event, ...fields}));
}
`;

const PAYMENT_TEST_PAYMENT_TS = `import {test, expect} from 'vitest';
import {handlePayment} from '../src/api/payment.js';

test('handlePayment authorizes a valid B2B request', async () => {
  const r = await handlePayment({
    merchantId: 'M-001',
    amount: 10_000,
    currency: 'KRW',
    pg: 'toss',
  });
  expect(r.status).toBe('success');
  expect(r.transactionId).toMatch(/^tx_toss_/);
});

test('handlePayment rejects invalid amount', async () => {
  await expect(
    handlePayment({merchantId: 'M-001', amount: -1, currency: 'KRW', pg: 'toss'}),
  ).rejects.toThrow();
});
`;

const PAYMENT_API_REFUND_TS = `// payment-saas · api · refund (added at M2)
//
// HTTP entrypoint for B2B refund. Validates the original transaction
// id and dispatches a reverse charge through the same PG.

import {z} from 'zod';

import {refundViaPg, type PgName} from '../lib/pg-refund.js';
import {log} from '../util/log.js';

const RequestSchema = z.object({
  transactionId: z.string().min(1),
  amount: z.number().int().positive().optional(), // optional = full refund
  pg: z.enum(['stripe', 'toss']),
});

export interface RefundResult {
  readonly refundId: string;
  readonly status: 'success' | 'failed';
}

export async function handleRefund(input: unknown): Promise<RefundResult> {
  const parsed = RequestSchema.parse(input);
  log('refund.requested', {transactionId: parsed.transactionId});
  const r = await refundViaPg(parsed.pg as PgName, {
    transactionId: parsed.transactionId,
    amount: parsed.amount,
  });
  log('refund.completed', {refundId: r.refundId, status: r.status});
  return r;
}
`;

const PAYMENT_LIB_PG_REFUND_TS = `// payment-saas · lib · pg-refund (M2)
//
// Reverse-charge implementation. Same PG abstraction as charge.

import {log} from '../util/log.js';

export type PgName = 'stripe' | 'toss';

export interface RefundInput {
  readonly transactionId: string;
  readonly amount?: number;
}

export interface RefundResult {
  readonly refundId: string;
  readonly status: 'success' | 'failed';
}

export async function refundViaPg(pg: PgName, input: RefundInput): Promise<RefundResult> {
  log('pg.refund', {pg, transactionId: input.transactionId});
  const refundId = \`rf_\${pg}_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\`;
  return {refundId, status: 'success'};
}
`;

const PAYMENT_TEST_REFUND_TS = `import {test, expect} from 'vitest';
import {handleRefund} from '../src/api/refund.js';

test('handleRefund issues a refund for a valid transaction', async () => {
  const r = await handleRefund({transactionId: 'tx_toss_xxx', pg: 'toss'});
  expect(r.status).toBe('success');
  expect(r.refundId).toMatch(/^rf_toss_/);
});

test('handleRefund rejects empty transaction id', async () => {
  await expect(handleRefund({transactionId: '', pg: 'toss'})).rejects.toThrow();
});
`;

const PAYMENT_GITIGNORE = `node_modules/
dist/
*.log
.env
`;

export const VANILLA_PAYMENT_SAAS_SESSION: VanillaSession = {
  intent: '결제 SaaS for B2B Stripe Toss 지원',
  m1Files: new Map<string, string>([
    ['package.json', PAYMENT_PKG_JSON],
    ['tsconfig.json', PAYMENT_TSCONFIG_JSON],
    ['README.md', PAYMENT_README_MD],
    ['.gitignore', PAYMENT_GITIGNORE],
    ['src/api/payment.ts', PAYMENT_API_PAYMENT_TS],
    ['src/lib/pg.ts', PAYMENT_LIB_PG_TS],
    ['src/util/log.ts', PAYMENT_UTIL_LOG_TS],
    ['tests/payment.test.ts', PAYMENT_TEST_PAYMENT_TS],
  ]),
  m2Files: new Map<string, string>([
    ['src/api/refund.ts', PAYMENT_API_REFUND_TS],
    ['src/lib/pg-refund.ts', PAYMENT_LIB_PG_REFUND_TS],
    ['tests/refund.test.ts', PAYMENT_TEST_REFUND_TS],
  ]),
};

// ──────────────────────────────────────────────────────────────────
// Session 2 — Existing TS adoption
// ──────────────────────────────────────────────────────────────────
//
// Vanilla flow starts from the same `sample-existing-ts` fixture
// (8 source files). M1 here is "developer reads the code and
// improves the README"; M2 is "developer adds a refund feature".
// No spec/, no capabilities, no architecture.yaml — vanilla Claude
// Code wouldn't think to produce them.

const EXISTING_README_M1 = `# sample-existing-ts

A small TypeScript service handling payments + auth + ledger.

## Modules

- \`src/api/\` — HTTP entrypoints (index, health, auth)
- \`src/lib/\` — Business logic (payment, ledger)
- \`src/util/\` — Helpers (log, uuid)

## Install

\`\`\`bash
npm install
\`\`\`

## Usage

The HTTP service exposes \`/health\`, \`/auth/login\`, and \`/payment\`.

\`\`\`ts
import {processPayment} from './src/lib/payment.js';

const r = await processPayment({amount: 100, currency: 'KRW'});
\`\`\`

## Testing

\`npm test\` runs vitest.
`;

const EXISTING_API_REFUND_M2 = `// sample-existing-ts · api · refund (added at M2 — vanilla)
//
// New refund endpoint. Validates input, calls into lib/refund, logs.

import {processRefund} from '../lib/refund.js';
import {log} from '../util/log.js';

export interface RefundInput {
  readonly transactionId: string;
  readonly amount?: number;
}

export async function handleRefund(input: RefundInput): Promise<{status: 'ok' | 'fail'}> {
  log('refund.requested', input);
  const r = await processRefund(input);
  return {status: r.ok ? 'ok' : 'fail'};
}
`;

const EXISTING_LIB_REFUND_M2 = `// sample-existing-ts · lib · refund (M2)

export interface ProcessRefundInput {
  readonly transactionId: string;
  readonly amount?: number;
}

export async function processRefund(input: ProcessRefundInput): Promise<{ok: boolean}> {
  if (!input.transactionId) return {ok: false};
  // Stub PG call.
  return {ok: true};
}
`;

const EXISTING_TEST_REFUND_M2 = `import {test, expect} from 'vitest';
import {handleRefund} from '../src/api/refund.js';

test('handleRefund accepts a valid transaction id', async () => {
  const r = await handleRefund({transactionId: 'tx_001'});
  expect(r.status).toBe('ok');
});

test('handleRefund fails empty transaction id', async () => {
  const r = await handleRefund({transactionId: ''});
  expect(r.status).toBe('fail');
});
`;

export const VANILLA_EXISTING_ADOPTION_SESSION: VanillaSession = {
  intent: '이 프로젝트 분석해서 환불 기능 추가',
  m1Files: new Map<string, string>([
    // M1 = ReadME improvement (vanilla developer's first move on an unfamiliar codebase).
    ['README.md', EXISTING_README_M1],
  ]),
  m2Files: new Map<string, string>([
    ['src/api/refund.ts', EXISTING_API_REFUND_M2],
    ['src/lib/refund.ts', EXISTING_LIB_REFUND_M2],
    ['tests/refund.test.ts', EXISTING_TEST_REFUND_M2],
  ]),
};
