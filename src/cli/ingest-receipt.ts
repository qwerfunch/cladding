// Cladding · Spec 0.2 F5 · narrow CLI adapter for portable receipt ingress.

import process from 'node:process';
import {readFileSync} from 'node:fs';

import {ingestPortableReceipt} from '../proof/ingest.js';

/** CLI options intentionally contain no trust, key, or destination-path authority. */
export interface IngestReceiptCommandOptions {
  readonly cwd?: string;
  readonly json?: boolean;
}

/** Reads one portable receipt and delegates to the same create-only F5 kernel as MCP. */
export function runIngestReceiptCommand(receiptFile: string, options: IngestReceiptCommandOptions): ReturnType<typeof ingestPortableReceipt> {
  let receiptYaml: string;
  try { receiptYaml = readFileSync(receiptFile, 'utf8'); } catch (error) {
    const result = {ok: false, code: 'INVALID_RECEIPT' as const, message: (error as Error).message, changed: false};
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stderr.write(`${result.message}\n`);
    process.exitCode = 1;
    return result;
  }
  const result = ingestPortableReceipt({cwd: options.cwd ?? process.cwd(), receiptYaml});
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}
