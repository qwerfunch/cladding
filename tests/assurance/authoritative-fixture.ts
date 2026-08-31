// Cladding · F6 test-only authority facade.

import {vi} from 'vitest';

import * as gate from '../../src/assurance/run-authority.js';
import {mintWorkspaceAttestationV3, type AttestationV3Input, type AuthoritativeAttestationV3} from '../../src/assurance/attestation.js';
import {verdictAuthorizesFeature, type AssuranceVerdict} from '../../src/assurance/kernel.js';

// Writer/retention tests need small deterministic v3 fixtures without running
// a full project toolchain. This Vitest-only facade augments the read-only
// runCheckStages predicate for selected in-memory objects; it is outside src/
// and therefore cannot be bundled or invoked by product code to mint authority.
const fixtureVerdicts = new WeakSet<object>();
const productionAuthority = gate.hasRunCheckStagesAuthority;

vi.spyOn(gate, 'hasRunCheckStagesAuthority').mockImplementation((verdict, feature, inputSha256, seal, profileIdentity) =>
  productionAuthority(verdict, feature, inputSha256, seal, profileIdentity)
    || (fixtureVerdicts.has(verdict) && verdictAuthorizesFeature(verdict, feature, inputSha256)),
);

/** Marks one reducer object for a test fixture while preserving its scope binding. */
export function authoritativeFixtureVerdict<T extends AssuranceVerdict>(verdict: T): T {
  fixtureVerdicts.add(verdict);
  return verdict;
}

/** Mints a pre-authorized fixture row for writer tests; never ships in product code. */
export function mintAuthoritativeFixtureV3(input: AttestationV3Input): AuthoritativeAttestationV3 | undefined {
  return mintWorkspaceAttestationV3(input);
}
