# sample-existing-ts

A small TypeScript project simulating an existing B2B 결제 처리 codebase
that wants to adopt cladding governance.

## Install

```
npm install
```

## Usage

```ts
import {createPayment} from './src/api/index';
const result = await createPayment({amount: 1000, currency: 'KRW'});
```

## API

- `createPayment(req)` — submit a payment request
- `refundPayment(id)` — refund an existing payment
- `getLedger(filters)` — query the ledger

This fixture exists to test cladding's existing-adoption onboarding
path; the code below is intentionally lightweight.
