// Cladding · core · post-mortem writer
//
// Phase 3.3 of the Iron Law backbone (ironclad-design 02-iron-law §2.5).
// After the drive loop records a `feature_rolled_back` event, this
// module writes a markdown file documenting the failure context — the
// feature id, the gate that failed last, the retry count, the
// checkpoint the rollback targets, and a maintainer-runnable recovery
// command. The Librarian agent persona is the authoring identity,
// matching the ironclad-design role split (Librarian owns SSoT health
// and history; specialists author code).
//
// File path: `.cladding/post-mortems/post-mortem-<F-id>-<ts>.md`.
// The ts segment is the rollback event's ISO-8601 timestamp with
// `:` and `.` replaced by `-` to stay filesystem-safe. Multiple
// rollbacks of the same feature produce multiple files — the audit
// trail does not overwrite.
//
// Phase 3.3 deliberately stops at file authoring. Hooking the post-
// mortem into the next agent dispatch's context is a v0.3.x+ follow-up
// that touches AgentContext shape; this patch keeps the surface
// minimal so the file is available on disk for a maintainer to read
// without requiring upstream changes to drive/agent.ts.

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Checkpoint} from './checkpoint.js';

/** Context the drive loop hands to the post-mortem writer on rollback. */
export interface PostMortemContext {
  /** F-NNN or F-<hash> the rollback targeted. */
  readonly featureId: string;
  /** Number of retries the loop attempted before exhausting the budget. */
  readonly retryCount: number;
  /** The stage label the most recent failure happened on, e.g. `stage_1.1`. */
  readonly lastFailedGate: string;
  /** The checkpoint the rollback targets, as returned by findLatestCheckpoint. */
  readonly checkpoint: Checkpoint;
  /** ISO 8601 timestamp the rollback event was recorded at. */
  readonly rolledBackAt: string;
}

/**
 * Sanitises an ISO 8601 timestamp for use as a filename segment.
 * `2026-05-20T12:34:56.789Z` → `2026-05-20T12-34-56-789Z`.
 */
function isoToFilenameSegment(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

/**
 * Writes the markdown post-mortem to `.cladding/post-mortems/` and
 * returns the absolute path. The directory is created on demand.
 * Authoring identity is `librarian` — matching the ironclad-design
 * role split where SSoT history belongs to that persona.
 */
export function writePostMortem(cwd: string, ctx: PostMortemContext): string {
  const dir = join(cwd, '.cladding', 'post-mortems');
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  const filename = `post-mortem-${ctx.featureId}-${isoToFilenameSegment(ctx.rolledBackAt)}.md`;
  const path = join(dir, filename);
  const head = ctx.checkpoint.gitHead
    ? `\`${ctx.checkpoint.gitHead.slice(0, 12)}\``
    : '_no git head pinned_';
  const recovery = ctx.checkpoint.gitHead
    ? `git checkout ${ctx.checkpoint.gitHead}`
    : 'restore spec.yaml manually from VCS history';
  const body =
    `# Post-mortem · ${ctx.featureId}\n` +
    '\n' +
    `_Authored by_ **librarian** · _Rolled back at_ \`${ctx.rolledBackAt}\`\n` +
    '\n' +
    '## What failed\n' +
    '\n' +
    `- Feature: \`${ctx.featureId}\`\n` +
    `- Last failed gate: \`${ctx.lastFailedGate}\`\n` +
    `- Retry attempts: ${ctx.retryCount} (budget exhausted)\n` +
    `- Halt class: \`RETRY_THRESHOLD\`\n` +
    '\n' +
    '## Checkpoint targeted by rollback\n' +
    '\n' +
    `- Pinned at: \`${ctx.checkpoint.timestamp}\`\n` +
    `- Git HEAD: ${head}\n` +
    `- Spec digest: \`${ctx.checkpoint.specDigest.slice(0, 12)}…\`\n` +
    '\n' +
    '## Recommended recovery\n' +
    '\n' +
    '```\n' +
    `${recovery}\n` +
    '```\n' +
    '\n' +
    `Then resume by calling the \`enter_work\` MCP tool with featureId: ${ctx.featureId} ` +
    `(or \`execute_drive\` with the parent scenario for a bundled retry).\n` +
    '\n' +
    '## Notes\n' +
    '\n' +
    '- This file is auto-generated. Append observations below the divider; do not edit above it.\n' +
    '\n' +
    '---\n';
  writeFileSync(path, body, 'utf8');
  return path;
}
