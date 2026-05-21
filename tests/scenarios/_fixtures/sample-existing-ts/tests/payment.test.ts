// sample-existing-ts · tests · payment.test
//
// Placeholder test file — exists so the scan's test-location detector
// sees 'tests-dir' as a signal.

import {test, expect} from 'vitest';

import {processPayment} from '../src/lib/payment.js';

test('processPayment returns success for positive amount', async () => {
  const r = await processPayment({amount: 100, currency: 'KRW'});
  expect(r.status).toBe('success');
});
