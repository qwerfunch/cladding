// Cladding · scripts/ab-abc/budget.mjs — the campaign's cumulative spend ledger
//
// Kept as its own file rather than inline in run-cell.sh so the arithmetic that
// stops the campaign is readable and testable on its own. Two commands:
//
//   node budget.mjs check  <ledger.json> <cell-cap-usd>
//       exits 1 when this cell could carry the campaign past its cap. Run BEFORE
//       the host is spawned — a check after the fact stops nothing.
//
//   node budget.mjs record <ledger.json> <run.jsonl> <arm> <cell>
//       adds the host-reported cost of a finished run. Cost is the host's
//       list-price estimate for an OAuth session, not an amount billed.

import fs from 'node:fs';
import process from 'node:process';

const [, , command, ledgerPath, ...rest] = process.argv;
if (!command || !ledgerPath) throw new Error('usage: budget.mjs <check|record> <ledger.json> …');

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const usd = (n) => `$${n.toFixed(2)}`;

if (command === 'check') {
  const cellCap = Number(rest[0]);
  if (!Number.isFinite(cellCap)) throw new Error('check needs a numeric cell cap');
  if (ledger.spentUsd + cellCap > ledger.capUsd) {
    process.stderr.write(
      `budget stop: ${usd(ledger.spentUsd)} already spent, this cell is capped at ${usd(cellCap)}, campaign cap is ${usd(ledger.capUsd)}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`budget ok: ${usd(ledger.spentUsd)} spent of ${usd(ledger.capUsd)}\n`);
} else if (command === 'record') {
  const [runPath, arm, cell] = rest;
  let cost = null;
  for (const line of fs.readFileSync(runPath, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'result' && typeof event.total_cost_usd === 'number') cost = event.total_cost_usd;
    } catch {
      // a truncated tail is not a cost
    }
  }
  ledger.runs.push({arm, cell, at: new Date().toISOString(), costUsd: cost});
  if (cost !== null) ledger.spentUsd = Number((ledger.spentUsd + cost).toFixed(6));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  process.stdout.write(
    `cell cost ${cost === null ? 'unreported' : usd(cost)}; campaign total ${usd(ledger.spentUsd)} of ${usd(ledger.capUsd)}\n`,
  );
} else {
  throw new Error(`unknown command: ${command}`);
}
