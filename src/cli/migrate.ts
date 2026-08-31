// Cladding · Spec 0.2 F2 · read-only migration-preview CLI adapter.

import process from 'node:process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {previewSchema02Migration} from '../spec/compiler/migration-preview.js';
import {applyLocalSchemaMigration, migrationPreviewDigest, readSpecTransactionRecoveryReceipt, recoverSpecTransaction, type MigrationResolutionPayload, SpecEditError} from '../spec/edit.js';
import {requiredRootSchema} from '../spec/transaction.js';

/** Options accepted by the public migration preview command. */
export interface MigrateCommandOptions {
  /** The requested target schema. */
  readonly to?: string;
  /** Explicitly applies a fully resolved schema proposal through the F4 journal. */
  readonly apply?: boolean;
  /** JSON file containing explicit human confirmations for a preview. */
  readonly resolutions?: string;
  /** Exposes deterministic internal proposal data for tooling. */
  readonly json?: boolean;
  /** Workspace root, retained for programmatic callers and tests. */
  readonly cwd?: string;
}

/** Outcome retained for tests without requiring process spawning. */
export interface MigrateCommandResult {
  /** Whether the request is supported by this read-only release boundary. */
  readonly ok: boolean;
  /** Deterministic preview when one was built. */
  readonly output?: string;
  /** Whether a journaled migration operation changed the workspace. */
  readonly changed?: boolean;
}

/**
 * Runs `clad migrate --to 0.2` as a preview or explicit journaled apply.
 *
 * @param options - Command-line options after Commander parsing.
 * @returns A small command result while rendering the requested public surface.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 */
export function runMigrateCommand(options: MigrateCommandOptions): MigrateCommandResult {
  if (options.to !== '0.2') {
    const message = 'Migration preview currently supports only schema 0.2. Use `clad migrate --to 0.2`.';
    writeMigrateOutput(options, {error: 'unsupported_target', message}, message);
    process.exitCode = 1;
    return {ok: false};
  }
  const cwd = options.cwd ?? process.cwd();
  try {
    // Surface a corrupt pending receipt even when the user has not supplied
    // resolutions yet; otherwise a no-resolution early return masks recovery.
    const recovered = recoverSpecTransaction(cwd);
    return runMigrateAfterRecovery(options, cwd, recovered);
  } catch (error) {
    writeMigrateFailure(options, cwd, error, false);
    process.exitCode = 1;
    return {ok: false};
  }
}

/** Continues one public migration flow after recording whether recovery restored bytes. */
function runMigrateAfterRecovery(options: MigrateCommandOptions, cwd: string, recovered: boolean): MigrateCommandResult {
  if (options.apply) {
    let migrated: boolean;
    try {
      migrated = isMigratedWorkspace(cwd);
    } catch (error) {
      writeMigrateFailure(options, cwd, error, recovered);
      process.exitCode = 1;
      return {ok: false};
    }
    if (migrated) {
      try {
        const result = applyLocalSchemaMigration(cwd, {previewDigest: '0'.repeat(64), confirmed: []});
        const message = recovered
          ? 'Schema migration is already applied. Recovery restored prior bytes; this action made no additional changes.'
          : 'Schema migration is already applied; no files changed.';
        if (options.json) process.stdout.write(`${JSON.stringify({ok: true, ...result, ...(recovered ? {recovered: true} : {})}, null, 2)}\n`);
        else process.stdout.write(`${message}\n`);
        return {ok: true, changed: result.changed};
      } catch (error) {
        writeMigrateFailure(options, cwd, error, recovered);
        process.exitCode = 1;
        return {ok: false};
      }
    }
    if (!options.resolutions) {
      const message = recovered
        ? 'Migration decisions still need explicit confirmation. Recovery restored prior bytes; this action made no additional changes.'
        : 'Migration decisions still need explicit confirmation. No files were changed.';
      writeMigrateOutput(options, {error: 'migration_unresolved', message, writes: 0}, message, recovered);
      process.exitCode = 1;
      return {ok: false};
    }
    try {
      const resolutions = JSON.parse(readFileSync(options.resolutions, 'utf8')) as MigrationResolutionPayload;
      if (!resolutions || typeof resolutions !== 'object' || !Array.isArray(resolutions.confirmed) || typeof resolutions.previewDigest !== 'string' || Object.keys(resolutions).some((key) => key !== 'previewDigest' && key !== 'confirmed')) {
        throw new Error('resolution file must contain exactly previewDigest and confirmed decisions from the reviewed preview');
      }
      const result = applyLocalSchemaMigration(cwd, resolutions);
      const message = result.changed
        ? 'Schema migration was applied as one recoverable workspace transaction.'
        : recovered
          ? 'Schema migration is already applied. Recovery restored prior bytes; this action made no additional changes.'
          : 'Schema migration is already applied; no files changed.';
      if (options.json) process.stdout.write(`${JSON.stringify({ok: true, ...result, ...(recovered ? {recovered: true} : {})}, null, 2)}\n`);
      else process.stdout.write(`${message}\n`);
      return {ok: true, changed: result.changed};
    } catch (error) {
      writeMigrateFailure(options, cwd, error, recovered);
      process.exitCode = 1;
      return {ok: false};
    }
  }
  try {
    const preview = previewSchema02Migration(cwd);
    const digest = migrationPreviewDigest(preview);
    const output = `${JSON.stringify({...preview, previewDigest: digest, ...(recovered ? {recovered: true} : {})}, null, 2)}\n`;
    if (options.json) {
      process.stdout.write(output);
    } else {
      process.stdout.write(
        `Migration preview is ready. ${preview.requiredResolution.length} decisions still need review. Review digest: ${digest}. ${recovered ? 'Recovery restored prior bytes; this action made no additional changes.' : 'No files were changed.'}\n` +
        'Next: review and export the decisions, then rerun with `clad migrate --to 0.2 --apply --resolutions <file>`.\n',
      );
    }
    return {ok: true, output};
  } catch {
    const message = recovered
      ? 'Migration preview could not be prepared from the current specification. Recovery restored prior bytes; this action made no additional changes.'
      : 'Migration preview could not be prepared from the current specification. No files were changed.';
    writeMigrateOutput(options, {error: 'migration_preview_failed', message, writes: 0}, message, recovered);
    process.exitCode = 1;
    return {ok: false};
  }
}

/** Renders migration failures without leaking paths or implementation diagnostics to the normal shell. */
function writeMigrateFailure(options: MigrateCommandOptions, cwd: string, error: unknown, recovered: boolean): void {
  const typed = error instanceof SpecEditError ? error : undefined;
  const code = typed?.code ?? 'MIGRATION_APPLY_FAILED';
  let ordinaryMessage = 'Migration could not be applied.';
  if (code === 'MIGRATION_UNRESOLVED') ordinaryMessage = 'Migration decisions are incomplete or ambiguous.';
  if (code === 'RECOVERY_FAILED') {
    const guidance = migrationRecoveryGuidance(cwd);
    if (guidance === undefined) ordinaryMessage = 'A prior migration needs recovery before it can continue.';
    else ordinaryMessage = `A prior migration needs recovery before it can continue. Restore only the recorded migration paths with: ${guidance}`;
  }
  const message = recovered
    ? `${ordinaryMessage} Recovery restored prior bytes; this action made no additional changes.`
    : `${ordinaryMessage} No files were changed.`;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      error: 'migration_apply_failed', code,
      message: recovered ? message : (error as Error).message,
      ...(recovered ? {details: (error as Error).message, recovered: true} : {}), writes: 0,
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
}

/** Returns narrowly scoped recovery guidance only from a syntactically durable transaction receipt. */
function migrationRecoveryGuidance(cwd: string): string | undefined {
  try {
    const receipt = readSpecTransactionRecoveryReceipt(cwd);
    if (!receipt?.head || receipt.paths.length === 0) return undefined;
    return `git restore --source=${shellQuote(receipt.head)} -- ${receipt.paths.map(shellQuote).join(' ')}`;
  } catch {
    return undefined;
  }
}

/** Quotes a single displayed argv token without ever interpolating raw path bytes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isMigratedWorkspace(cwd: string): boolean {
  return requiredRootSchema(cwd) === '0.2'
    && existsSync(join(cwd, 'spec/generated/migration-baseline-0.1-to-0.2.yaml'));
}

function writeMigrateOutput(options: MigrateCommandOptions, payload: Record<string, unknown>, message: string, recovered = false): void {
  if (options.json) process.stdout.write(`${JSON.stringify({...payload, ...(recovered ? {recovered: true} : {})}, null, 2)}\n`);
  else process.stderr.write(`${message}\n`);
}
