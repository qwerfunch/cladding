// sample-existing-ts · api · index
//
// HTTP-facing entry points (here flattened to plain exports).

import {processPayment, refundPayment, type PaymentRequest, type PaymentResult} from '../lib/payment.js';
import {getLedger} from '../lib/ledger.js';

export const createPayment = async (req: PaymentRequest): Promise<PaymentResult> => {
  return processPayment(req);
};

export const cancelPayment = async (id: string): Promise<PaymentResult> => {
  return refundPayment(id);
};

export {getLedger};
