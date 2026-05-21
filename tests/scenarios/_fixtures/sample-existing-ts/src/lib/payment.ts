// sample-existing-ts · lib · payment
//
// Core payment-processing logic used by the api layer.

import {newUuid} from '../util/uuid.js';
import {logInfo} from '../util/log.js';

export interface PaymentRequest {
  readonly amount: number;
  readonly currency: string;
}

export interface PaymentResult {
  readonly id: string;
  readonly status: 'success' | 'failed';
}

export const processPayment = async (req: PaymentRequest): Promise<PaymentResult> => {
  if (req.amount <= 0) {
    return {id: newUuid(), status: 'failed'};
  }
  logInfo(`processing payment ${req.amount} ${req.currency}`);
  return {id: newUuid(), status: 'success'};
};

export const refundPayment = async (id: string): Promise<PaymentResult> => {
  logInfo(`refunding ${id}`);
  return {id, status: 'success'};
};
