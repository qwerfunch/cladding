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
//   - RUNTIME (this file, vitest): the literal names match the AC's 9-value set,
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
  // F-35954d19 — the mini working-set push card's session governor.
  dedup: true,
  ledger_exhausted: true,
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
  test('[covers:F-6ba22c5c/AC-2712ade0] emitted impact-card skip reasons stay in the closed ImpactSkipReason vocabulary', () => {
    expect(Object.keys(REASONS).sort()).toEqual(
      [
        'debounced',
        'dedup',
        'ledger_exhausted',
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

  test('[covers:F-6ba22c5c/AC-238a3658] EventType declares impact_card_fired', () => {
    const event: EventType = 'impact_card_fired';
    recordEvent(dir, event, {probe: event});
    expect(readEvents(dir).map((e) => e.type)).toContain(event);
  });

  test('[covers:F-6ba22c5c/AC-93b89336] EventType declares impact_card_skipped', () => {
    const event: EventType = 'impact_card_skipped';
    recordEvent(dir, event, {probe: event});
    expect(readEvents(dir).map((e) => e.type)).toContain(event);
  });

  test('[covers:F-6ba22c5c/AC-f0c4df75] EventType declares session_card_rendered', () => {
    const event: EventType = 'session_card_rendered';
    recordEvent(dir, event, {probe: event});
    expect(readEvents(dir).map((e) => e.type)).toContain(event);
  });

  test('[covers:F-6ba22c5c/AC-298fb2b3] EventType declares prompt_suggestion_served', () => {
    const event: EventType = 'prompt_suggestion_served';
    recordEvent(dir, event, {probe: event});
    expect(readEvents(dir).map((e) => e.type)).toContain(event);
  });

  test('[covers:F-6ba22c5c/AC-74b24595] EventType declares working_set_served', () => {
    const event: EventType = 'working_set_served';
    recordEvent(dir, event, {probe: event});
    expect(readEvents(dir).map((e) => e.type)).toContain(event);
  });
});
