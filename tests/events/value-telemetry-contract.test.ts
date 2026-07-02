// Cladding · F-6ba22c5c AC-238a3658 — the closed reason enum + the 5 new
// EventType members. The point of the enum is that "silent" (surface fired
// nothing) is distinguishable from "broken" (emission unwired) from the ledger
// alone, so the SET of names is a contract, not an implementation detail.
//
// Two guards, one for each half of the contract:
//   - COMPILE-TIME (checked by `tsc --noEmit`): a Record<ImpactSkipReason,true>
//     literal errors if a member is missing OR extra, pinning the literal below
//     to the type. The `readonly EventType[]` assignment errors if any of the 5
//     new names is not a real EventType member.
//   - RUNTIME (this file, vitest): the literal names match the AC's 7-value set,
//     and recordEvent accepts + round-trips each of the 5 new types.

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {readEvents, recordEvent, type EventType, type ImpactSkipReason} from '../../src/events/log.js';

// Compile-time exhaustiveness: TS rejects this literal if ImpactSkipReason gains
// or loses a member, so the runtime assertion below is pinned to the type.
const REASONS: Record<ImpactSkipReason, true> = {
  not_write_tool: true,
  unwatched_path: true,
  no_spec: true,
  debounced: true,
  trivial_edit: true,
  owner_miss: true,
  spec_unreadable: true,
};

const NEW_EVENT_TYPES = [
  'impact_card_fired',
  'impact_card_skipped',
  'session_card_rendered',
  'prompt_suggestion_served',
  'working_set_served',
] as const;
// Compile-time: every name above must be a real EventType member.
const _newTypesAreEventTypes: readonly EventType[] = NEW_EVENT_TYPES;
void _newTypesAreEventTypes;

describe('F-6ba22c5c AC-238a3658 — closed reason enum + event types', () => {
  test('ImpactSkipReason is EXACTLY the closed 7-value set from the AC', () => {
    expect(Object.keys(REASONS).sort()).toEqual(
      [
        'debounced',
        'no_spec',
        'not_write_tool',
        'owner_miss',
        'spec_unreadable',
        'trivial_edit',
        'unwatched_path',
      ].sort(),
    );
  });

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-vt-contract-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('recordEvent accepts + round-trips all 5 new value-delivery EventTypes', () => {
    for (const t of NEW_EVENT_TYPES) recordEvent(dir, t, {probe: t});
    const seen = readEvents(dir).map((e) => e.type);
    for (const t of NEW_EVENT_TYPES) expect(seen).toContain(t);
    // exactly the 5 we wrote — no phantom types leaked in
    expect(seen.filter((t) => (NEW_EVENT_TYPES as readonly string[]).includes(t))).toHaveLength(5);
  });
});
