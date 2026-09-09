// Cladding · Spec 0.2 F5 · narrow CLI adapter for portable receipt ingress.

import process from 'node:process';
import {readFileSync} from 'node:fs';

import {ingestPortableReceipt} from '../proof/ingest.js';
import {parsePortableReceiptYaml, type PortableReceipt} from '../proof/receipt.js';
import {evidenceOperations} from '../proof/trust.js';

/** CLI options intentionally contain no trust, key, or destination-path authority. */
export interface IngestReceiptCommandOptions {
  readonly cwd?: string;
  readonly json?: boolean;
}

/** Reads one portable receipt and delegates to the same create-only F5 kernel as MCP. */
export function runIngestReceiptCommand(receiptFile: string, options: IngestReceiptCommandOptions): ReturnType<typeof ingestPortableReceipt> {
  const cwd = options.cwd ?? process.cwd();
  let receiptYaml: string;
  try { receiptYaml = readFileSync(receiptFile, 'utf8'); } catch (error) {
    return report(options, {ok: false, code: 'INVALID_RECEIPT' as const, message: (error as Error).message, changed: false});
  }
  // Trust and expected digests are workspace facts, exactly as they are for
  // the MCP tool. Parsing here only builds the expected-digest context; the
  // kernel re-parses and stays the sole authority over what is stored.
  let receipt: PortableReceipt | undefined;
  try { receipt = parsePortableReceiptYaml(receiptYaml); } catch {
    receipt = undefined;
  }
  const evidence = evidenceOperations(cwd);
  const result = ingestPortableReceipt({
    cwd,
    receiptYaml,
    trustSnapshot: evidence.trustSnapshot,
    ...(receipt === undefined ? {} : {expected: evidence.expectedDigestContext(receipt)}),
  });
  return report(options, result);
}

/** One emission point so every refusal and every success speak on the same channel. */
function report(options: IngestReceiptCommandOptions, result: ReturnType<typeof ingestPortableReceipt>): ReturnType<typeof ingestPortableReceipt> {
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}
