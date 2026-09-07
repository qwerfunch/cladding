// Cladding · Spec 0.2 F11 · `clad relocate-generated` opt-in relocation CLI.
//
// Schema 0.2 names `spec/generated/` as the final home of the three generated
// projections. 0.10.0 forces nobody to move: this verb previews the move by
// default and only relocates under an explicit `--apply`, as one recoverable
// spec transaction. Schema migration (`clad migrate`) stays a separate step.

import process from 'node:process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {generatedDirectoryNoticeWrite, SpecEditError} from '../spec/edit.js';
import {
  generatedArtifactLayout,
  relocatableArtifactPaths,
  postRelocationArtifactPathMap,
  renderIrregular,
  type GeneratedArtifactLayout,
  type IrregularLocation,
} from '../spec/layout.js';
import {
  commitSpecTransactionFiles,
  readSpecTransactionBytes,
  recoverSpecTransaction,
  requiredRootSchema,
  withSpecWorkspaceLock,
  type TransactionFile,
} from '../spec/transaction.js';

/** What relocation would do to one generated projection. */
export type RelocationAction = 'move' | 'already-relocated' | 'absent' | 'conflict' | 'irregular';

/** One planned projection move. */
export interface RelocationArtifactPlan {
  /** Registry id of the projection. */
  readonly id: string;
  /** Where the projection is read today. */
  readonly from: string;
  /** Where relocation puts it. */
  readonly to: string;
  /** What `--apply` would do to it. */
  readonly action: RelocationAction;
  /** Known locations occupied by a directory or a link, when the action is irregular. */
  readonly irregular?: readonly IrregularLocation[];
}

/** The `.gitattributes` follow-up relocation performs after its journal commits. */
export interface RelocationGitAttributesPlan {
  /** The exact merge attribute line relocation retargets. */
  readonly line: string;
  /** Whether that line is present, already retargeted, or absent. */
  readonly action: 'retarget' | 'already-retargeted' | 'absent';
}

/** Options accepted by the relocation command. */
export interface RelocateGeneratedCommandOptions {
  /** Performs the move; without it the command only previews. */
  readonly apply?: boolean;
  /** Emits the deterministic plan for tooling. */
  readonly json?: boolean;
  /** Workspace root, retained for programmatic callers and tests. */
  readonly cwd?: string;
  /** Injects a crash after N journal replacements; tests only. */
  readonly faultAfterReplacementForTesting?: number;
}

/** Outcome retained for tests without requiring process spawning. */
export interface RelocateGeneratedCommandResult {
  /** Whether the request was supported and completed. */
  readonly ok: boolean;
  /** Rendered plan when one was built. */
  readonly output?: string;
  /** Whether the workspace changed. */
  readonly changed?: boolean;
  /** The deterministic plan behind the rendered output. */
  readonly plan?: readonly RelocationArtifactPlan[];
}

const INDEX_MERGE_ATTRIBUTE = `${relocatableArtifactPaths('generated-index').oldPath} merge=union`;
const RELOCATED_INDEX_MERGE_ATTRIBUTE = `${relocatableArtifactPaths('generated-index').newPath} merge=union`;

/** Builds the deterministic per-artifact plan from one layout probe. */
function relocationPlan(layout: GeneratedArtifactLayout): readonly RelocationArtifactPlan[] {
  return layout.artifacts.map((artifact) => ({
    id: artifact.id,
    from: artifact.resolvedPath ?? artifact.oldPath,
    to: artifact.newPath,
    // An obstruction outranks presence: `--apply` refuses while one stands, so
    // the preview must name it instead of promising a move.
    action: artifact.irregular.length > 0
      ? 'irregular'
      : artifact.presence === 'both'
        ? 'conflict'
        : artifact.presence === 'new'
          ? 'already-relocated'
          : artifact.presence === 'old'
            ? 'move'
            : 'absent',
    ...(artifact.irregular.length > 0 ? {irregular: artifact.irregular} : {}),
  }));
}

/** Reports the `.gitattributes` merge-attribute follow-up without touching it. */
function gitAttributesPlan(cwd: string): RelocationGitAttributesPlan {
  const path = join(cwd, '.gitattributes');
  if (!existsSync(path)) return {line: INDEX_MERGE_ATTRIBUTE, action: 'absent'};
  const lines = readFileSync(path, 'utf8').split('\n').map((line) => line.trim());
  if (lines.includes(RELOCATED_INDEX_MERGE_ATTRIBUTE)) return {line: RELOCATED_INDEX_MERGE_ATTRIBUTE, action: 'already-retargeted'};
  return {line: INDEX_MERGE_ATTRIBUTE, action: lines.includes(INDEX_MERGE_ATTRIBUTE) ? 'retarget' : 'absent'};
}

/** Retargets the index merge attribute after the journal has committed. */
function retargetGitAttributes(cwd: string): boolean {
  const path = join(cwd, '.gitattributes');
  if (!existsSync(path)) return false;
  const bytes = readFileSync(path, 'utf8');
  const lines = bytes.split('\n');
  let changed = false;
  const next = lines.map((line) => {
    if (line.trim() !== INDEX_MERGE_ATTRIBUTE) return line;
    changed = true;
    return RELOCATED_INDEX_MERGE_ATTRIBUTE;
  });
  if (changed) writeFileSync(path, next.join('\n'), 'utf8');
  return changed;
}

/** Renders the human-readable plan. */
function renderPlan(plan: readonly RelocationArtifactPlan[], attributes: RelocationGitAttributesPlan, applied: boolean): string {
  const rows = plan.map((entry) => {
    const detail = entry.action === 'move'
      ? `${entry.from} → ${entry.to}`
      : entry.action === 'already-relocated'
        ? `${entry.to} (already relocated)`
        : entry.action === 'absent'
          ? `${entry.from} (nothing to move)`
          : entry.action === 'irregular'
            ? `${renderIrregular(entry.irregular ?? [])} blocks relocation`
            : `${entry.from} and ${entry.to} both exist`;
    return `  ${entry.id}: ${detail}`;
  });
  const attributeLine = attributes.action === 'retarget'
    ? `  .gitattributes: \`${INDEX_MERGE_ATTRIBUTE}\` becomes \`${RELOCATED_INDEX_MERGE_ATTRIBUTE}\``
    : attributes.action === 'already-retargeted'
      ? `  .gitattributes: \`${RELOCATED_INDEX_MERGE_ATTRIBUTE}\` is already set`
      : '  .gitattributes: no index merge attribute to retarget';
  const moves = plan.filter((entry) => entry.action === 'move').length;
  // `--apply` refuses while any obstruction or conflict stands, so a preview
  // that found one must say what blocks the move instead of inviting a rerun
  // that would only fail — even when nothing else is pending.
  const blocked = blockedGuidance(plan);
  const lead = applied
    ? moves === 0
      ? 'Generated projections are already relocated; no files changed.'
      : `Relocated ${moves} generated ${moves === 1 ? 'projection' : 'projections'} in one recoverable transaction.`
    : blocked.length > 0
      ? `Relocation is blocked${moves === 0 ? '' : `; ${moves} pending ${moves === 1 ? 'move waits' : 'moves wait'} behind it`}. No files were changed.`
      : moves === 0
        ? 'Nothing to relocate. No files were changed.'
        : `Relocation would move ${moves} generated ${moves === 1 ? 'projection' : 'projections'}. No files were changed.`;
  const next = applied
    ? []
    : blocked.length > 0
      ? blocked
      : moves === 0
        ? []
        : ['Next: rerun with `clad relocate-generated --apply` to perform the move.'];
  return [lead, ...rows, attributeLine, ...next].join('\n') + '\n';
}

/**
 * Names every obstruction a preview found, in the words `--apply` would use.
 *
 * The preview and the refusal say the same thing, so an adopter reads one
 * sentence and one resolution wherever the block surfaces.
 */
function blockedGuidance(plan: readonly RelocationArtifactPlan[]): readonly string[] {
  const irregular = plan.flatMap((entry) => entry.irregular ?? []);
  const conflicts = plan.filter((entry) => entry.action === 'conflict');
  return [
    ...(irregular.length === 0 ? [] : [
      `Blocked: a generated projection may not be a directory or a symbolic link: ${renderIrregular(irregular)}. Remove it, then rerun.`,
    ]),
    ...(conflicts.length === 0 ? [] : [
      'Blocked: a generated projection exists at both of its known locations: '
      + `${conflicts.map((entry) => `${entry.id} (${entry.from} and ${entry.to})`).join('; ')}. `
      + 'Remove the copy you do not keep, then rerun.',
    ]),
  ];
}

/**
 * Runs `clad relocate-generated` as a preview or an explicit journaled move.
 *
 * @param options - Command-line options after Commander parsing.
 * @returns A small command result while rendering the requested public surface.
 * @see docs/design/spec-0.2/model-and-migration.md#d14--schema-migration
 * @see spec/features/spec-02-relocate-generated-0dafcf9d.yaml AC-b0a7992d
 * @since 0.10.0
 */
export function runRelocateGeneratedCommand(options: RelocateGeneratedCommandOptions): RelocateGeneratedCommandResult {
  const cwd = options.cwd ?? process.cwd();
  let recovered = false;
  try {
    recovered = recoverSpecTransaction(cwd);
    if (requiredRootSchema(cwd) !== '0.2') {
      return fail(options, 'unsupported_schema',
        'Relocation needs a schema 0.2 specification. Run `clad migrate --to 0.2` first; schema migration and relocation are separate steps.');
    }
  } catch (error) {
    return fail(options, 'relocation_failed', ordinaryFailure(error, recovered));
  }

  const layout = generatedArtifactLayout(cwd);
  const plan = relocationPlan(layout);
  const attributes = gitAttributesPlan(cwd);
  const conflicts = plan.filter((entry) => entry.action === 'conflict');
  const irregular = layout.artifacts.flatMap((artifact) => artifact.irregular);

  if (!options.apply) {
    const output = options.json
      ? `${JSON.stringify({ok: true, state: layout.state, artifacts: plan, gitattributes: attributes, writes: 0, ...(recovered ? {recovered: true} : {})}, null, 2)}\n`
      : renderPlan(plan, attributes, false);
    process.stdout.write(output);
    return {ok: true, changed: false, output, plan};
  }

  if (irregular.length > 0) {
    return fail(options, 'relocation_blocked',
      `A generated projection may not be a directory or a symbolic link: ${renderIrregular(irregular)}. No files were changed.`, layout.state, plan);
  }
  if (conflicts.length > 0) {
    const detail = conflicts.map((entry) => `${entry.id} (${entry.from} and ${entry.to})`).join('; ');
    return fail(options, 'relocation_conflict',
      `A generated projection exists at both of its known locations: ${detail}. Remove the copy you do not keep, then rerun. No files were changed.`,
      layout.state, plan);
  }

  try {
    const changed = applyRelocation(cwd, options.faultAfterReplacementForTesting);
    const retargeted = changed ? retargetGitAttributes(cwd) : false;
    const applied = relocationPlan(generatedArtifactLayout(cwd));
    const output = options.json
      ? `${JSON.stringify({
        ok: true, changed, state: generatedArtifactLayout(cwd).state, artifacts: applied,
        gitattributes: {...gitAttributesPlan(cwd), retargeted}, writes: changed ? plan.filter((entry) => entry.action === 'move').length : 0,
        ...(recovered ? {recovered: true} : {}),
      }, null, 2)}\n`
      : renderPlan(plan, gitAttributesPlan(cwd), true);
    process.stdout.write(output);
    return {ok: true, changed, output, plan};
  } catch (error) {
    return fail(options, 'relocation_failed', ordinaryFailure(error, recovered), layout.state, plan);
  }
}

/** Moves every pending projection and re-renders the notice in one journal. */
function applyRelocation(cwd: string, faultAfterReplacementForTesting?: number): boolean {
  return withSpecWorkspaceLock(cwd, () => {
    const layout = generatedArtifactLayout(cwd);
    if (layout.artifacts.some((artifact) => artifact.presence === 'both')) {
      throw new SpecEditError('INVALID_OPERATION', 'A generated projection exists at both of its known locations.');
    }
    const files: TransactionFile[] = [];
    for (const artifact of layout.pendingMoves) {
      const bytes = readSpecTransactionBytes(cwd, artifact.oldPath);
      if (bytes === null) continue;
      // No rename primitive exists: the move is one delete plus one create of
      // the same bytes inside a single journal, so a crash recovers both.
      files.push({path: artifact.oldPath, before: bytes, after: null});
      files.push({path: artifact.newPath, before: null, after: bytes});
    }
    // The notice states where the projections live once this journal commits,
    // so a second apply renders identical bytes and writes nothing.
    files.push(...generatedDirectoryNoticeWrite(cwd, postRelocationArtifactPathMap(layout)));
    if (files.length === 0) return false;
    commitSpecTransactionFiles(cwd, files, faultAfterReplacementForTesting);
    return true;
  });
}

/** Renders an ordinary, path-free failure sentence. */
function ordinaryFailure(error: unknown, recovered: boolean): string {
  const typed = error instanceof SpecEditError ? error : undefined;
  const lead = typed?.code === 'BUSY'
    ? 'A specification transaction is still committing; try again shortly.'
    : typed?.message ?? 'Relocation could not be prepared from the current workspace.';
  return recovered
    ? `${lead} Recovery restored prior bytes; this action made no additional changes.`
    : `${lead} No files were changed.`;
}

/** Writes one failure surface and marks the process failed. */
function fail(
  options: RelocateGeneratedCommandOptions,
  code: string,
  message: string,
  state?: string,
  plan?: readonly RelocationArtifactPlan[],
): RelocateGeneratedCommandResult {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      error: code, message, writes: 0,
      ...(state === undefined ? {} : {state}),
      ...(plan === undefined ? {} : {artifacts: plan}),
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exitCode = 1;
  return {ok: false, changed: false, ...(plan === undefined ? {} : {plan})};
}
