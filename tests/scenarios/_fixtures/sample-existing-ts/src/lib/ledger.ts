// sample-existing-ts · lib · ledger
//
// In-memory ledger for query/audit purposes.

import {logInfo} from '../util/log.js';

interface LedgerEntry {
  readonly id: string;
  readonly amount: number;
  readonly timestamp: number;
}

const STORE: LedgerEntry[] = [];

export const appendLedger = (entry: LedgerEntry): void => {
  STORE.push(entry);
  logInfo(`ledger += ${entry.id}`);
};

export const getLedger = (filters: {readonly minAmount?: number} = {}): readonly LedgerEntry[] => {
  const min = filters.minAmount ?? 0;
  return STORE.filter((e) => e.amount >= min);
};
