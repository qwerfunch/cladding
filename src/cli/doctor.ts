// Cladding · `clad doctor` — events.log.jsonl health summary
//
// Reads `<cwd>/.cladding/events.log.jsonl` and renders a human-readable
// triage of LLM dispatcher fallbacks (sentinel-miss events introduced
// in v0.3.39, F-65814a). The plain-text surface fits a single screen:
// one `pulse` summary line, a phase × cause × fallback breakdown
// table, and the top-N missed sentinels with counts. `--json` emits
// the structured {@link SentinelMissSummary} + {@link EventCounts}
// shapes verbatim so MCP clients or follow-up tooling can consume the
// same view machine-readably.
//
// Why a separate verb instead of folding into `clad check`: the check
// flow is a gate runner whose exit code matters (CI consumes it).
// Doctor is observability — exits 0 unless the log file is corrupt —
// so it stays a peer surface that adopters reach for diagnostics, not
// a gate.

import {existsSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

import {readEvents, type Event} from '../events/log.js';
import {attestedFeatureCount, readAttestation} from '../spec/attestation.js';
import {pulse} from '../ui/pulse.js';
import {
  summarizeEvents,
  summarizeSentinelMisses,
  type SentinelMissSummary,
  type EventCounts,
} from '../core/telemetry-summary.js';

export interface DoctorCommandOptions {
  readonly cwd?: string;
  /** Emit raw {@link DoctorReport} JSON instead of the formatted text. */
  readonly json?: boolean;
}

/** Wire format for `clad doctor --json`. Stable; new fields are additive. */
export interface DoctorReport {
  readonly cwd: string;
  readonly events: EventCounts;
  readonly sentinelMiss: SentinelMissSummary;
  /** F-95a096 — the governance ledger 0.6.0 writes, summarized for operators. */
  readonly governance: GovernanceSummary;
}

export interface GovernanceSummary {
  readonly gateRuns: number;
  readonly lastGate: {readonly tier?: string; readonly strict?: boolean; readonly worst?: number} | null;
  readonly doneAttempts: number;
  readonly doneRejected: number;
  readonly stopBlocked: number;
  readonly unresolvedStopBlock: boolean;
  readonly attestation: {readonly present: boolean; readonly entries: number};
}

function summarizeGovernance(cwd: string, events: readonly Event[]): GovernanceSummary {
  const gateRuns = events.filter((e) => e.type === 'gate_run');
  const dones = events.filter((e) => e.type === 'done_attempted');
  const last = gateRuns.at(-1)?.payload;
  const attested = readAttestation(cwd);
  return {
    gateRuns: gateRuns.length,
    lastGate: last ? {tier: last.tier as string, strict: last.strict as boolean, worst: last.worst as number} : null,
    doneAttempts: dones.length,
    doneRejected: dones.filter((e) => e.payload.kept !== true).length,
    stopBlocked: events.filter((e) => e.type === 'stop_blocked').length,
    unresolvedStopBlock: existsSync(join(cwd, '.cladding', 'stop-block.json')),
    attestation: {present: attested !== null, entries: attested === null ? 0 : attestedFeatureCount(attested)},
  };
}

/**
 * Handler for `clad doctor`. Returns nothing; calls `process.exit(0)`
 * on success and `process.exit(1)` only when the events log file
 * exists but cannot be parsed. A missing log file is a healthy
 * greenfield workspace, not an error — adopters that never ran
 * anything cladding-aware should see a friendly note instead of a
 * stack trace.
 */
export function runDoctorCommand(opts: DoctorCommandOptions = {}): void {
  const cwd = opts.cwd ?? '.';
  let events;
  try {
    events = readEvents(cwd);
  } catch (err) {
    pulse('fail', 'doctor', (err as Error).message);
    process.exit(1);
    return;
  }

  const eventCounts = summarizeEvents(events);
  const sentinelMiss = summarizeSentinelMisses(events);
  const governance = summarizeGovernance(cwd, events);
  const report: DoctorReport = {cwd, events: eventCounts, sentinelMiss, governance};

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
    return;
  }

  if (eventCounts.total === 0) {
    pulse(
      'note',
      'doctor',
      'no events recorded yet — run `clad init --scan` or a stage to populate .cladding/events.log.jsonl',
    );
    process.exit(0);
    return;
  }

  renderTextReport(report);
  process.exit(0);
}

function renderTextReport(report: DoctorReport): void {
  const {events, sentinelMiss} = report;
  const summaryDetail = sentinelMiss.total === 0
    ? `${events.total} events · 0 sentinel-miss (host is healthy)`
    : `${events.total} events · ${sentinelMiss.total} sentinel-miss`;
  pulse(sentinelMiss.total === 0 ? 'pass' : 'note', 'doctor', summaryDetail);

  // Event-type breakdown — one line, comma-separated. Skips zero
  // counts so the output stays compact on greenfield workspaces.
  const typeLine = Object.entries(events.byType)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${type}=${n}`)
    .join('  ');
  if (typeLine.length > 0) {
    process.stdout.write(`Events:  ${typeLine}\n`);
  }

  // F-95a096 — the governance ledger, readable without parsing JSONL by hand.
  // Rendered before the sentinel-miss early return: gate/done/stop state is
  // worth a glance even when the dispatcher is perfectly healthy.
  process.stdout.write('\nGovernance (lifecycle ledger)\n');
  const g = report.governance;
  const lastGate = g.lastGate
    ? `${g.lastGate.tier} strict=${g.lastGate.strict} → ${g.lastGate.worst === 0 ? 'GREEN' : 'RED'}`
    : 'never recorded';
  process.stdout.write(`  gate runs: ${g.gateRuns}  (last: ${lastGate})\n`);
  process.stdout.write(`  done attempts: ${g.doneAttempts}  rejected by the gate: ${g.doneRejected}\n`);
  process.stdout.write(`  stop blocks: ${g.stopBlocked}${g.unresolvedStopBlock ? '  ⚠ UNRESOLVED stop-block pending' : ''}\n`);
  process.stdout.write(
    g.attestation.present
      ? `  attestation: ${g.attestation.entries} feature(s) stamped (spec/attestation.yaml)\n`
      : '  attestation: none — run `clad check --tier=pre-push --strict` GREEN once to stamp\n',
  );

  if (sentinelMiss.total === 0) {
    return;
  }

  process.stdout.write('\n');
  process.stdout.write('Sentinel-miss breakdown\n');
  process.stdout.write(`  by phase    : ${formatCounts(sentinelMiss.byPhase)}\n`);
  process.stdout.write(`  by cause    : ${formatCounts(sentinelMiss.byCause)}\n`);
  process.stdout.write(`  by fallback : ${formatCounts(sentinelMiss.byFallback)}\n`);

  if (sentinelMiss.topMissedSections.length > 0) {
    process.stdout.write('\nTop missed sentinels\n');
    for (const entry of sentinelMiss.topMissedSections) {
      process.stdout.write(`  ${entry.count.toString().padStart(4)} × ${entry.name}\n`);
    }
  }

  if (sentinelMiss.recentErrors.length > 0) {
    process.stdout.write('\nRecent dispatcher errors (most recent first)\n');
    for (const e of sentinelMiss.recentErrors) {
      process.stdout.write(`  · ${e}\n`);
    }
  }

  process.stdout.write('\n');
  process.stdout.write('Tune your host: raise max_tokens, switch model, or check MCP transport health.\n');
}

function formatCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return '(none)';
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}=${n}`)
    .join('  ');
}
