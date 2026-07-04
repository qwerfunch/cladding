// Cladding · report · SARIF 2.1.0 emitter (F-f6cc5e5a)
//
// SARIF (the OASIS static-analysis interchange standard) is what GitHub
// code-scanning ingests natively (`github/codeql-action/upload-sarif`) and what
// editor viewers read, so projecting cladding's drift findings into it surfaces
// every finding inline on the PR diff and in the Security tab — no new analysis,
// just a faithful re-projection of what the detectors already found.
//
// The mapping (near 1:1 with a drift finding) HARVESTS the parked PR #201
// decisions where sound: ruleId = detector name; level error→"error",
// warn→"warning"; physicalLocation built from path (+ line). It DIVERGES per
// this feature's AC-46e8c26f: exactly one result per error|warn finding (info
// is excluded), and a present-path location always carries a region (line
// defaults to 1) so a code-scanning UI can anchor the annotation.
//
// DETERMINISM: a pure function with no clock/PRNG — the same findings always
// serialize to byte-identical SARIF. Results are sorted; rules are deduped into
// tool.driver.rules. Per the SARIF spec, the optional invocation/timestamp
// fields are intentionally omitted.
//
// Layer: `report` is foundation-tier and must not import stage runners
// (spec/architecture.yaml). The finding shape is declared LOCALLY (structurally
// a supertype of stages' DriftFinding) so no cross-layer import is needed — the
// CLI runs the detectors and passes their findings in.
//
// @see https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
// @see https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning

const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const INFORMATION_URI = 'https://github.com/qwerfunch/cladding';

/**
 * The finding fields this emitter reads. Declared locally (not imported from
 * stages) to keep `report` a pure foundation layer; a stages `DriftFinding` is
 * structurally assignable to this — the CLI passes real findings straight in.
 */
export interface SarifFinding {
  readonly detector: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly path?: string;
  readonly line?: number;
  readonly message: string;
}

type SarifLevel = 'error' | 'warning';

/** Only error|warn findings become results; info is excluded (AC-46e8c26f). */
const LEVEL_OF: Readonly<Record<'error' | 'warn', SarifLevel>> = {
  error: 'error',
  warn: 'warning',
};

interface SarifLocation {
  readonly physicalLocation: {
    readonly artifactLocation: {readonly uri: string};
    readonly region: {readonly startLine: number};
  };
}

interface SarifResult {
  readonly ruleId: string;
  readonly level: SarifLevel;
  readonly message: {readonly text: string};
  readonly locations?: readonly SarifLocation[];
}

interface SarifRule {
  readonly id: string;
  readonly name: string;
  readonly shortDescription: {readonly text: string};
}

/** physicalLocation from a finding's path; line defaults to 1 (SARIF is 1-based). */
function locationOf(path: string, line?: number): readonly SarifLocation[] {
  return [
    {
      physicalLocation: {
        artifactLocation: {uri: path},
        region: {startLine: typeof line === 'number' && line > 0 ? line : 1},
      },
    },
  ];
}

/**
 * Converts drift findings to a SARIF 2.1.0 log. One result per error|warn
 * finding (info excluded); ruleId = detector name; rules deduped into
 * tool.driver.rules; physicalLocation present only when the finding carries a
 * path. Results are sorted for byte-stable output.
 */
export function toSarif(findings: readonly SarifFinding[]): unknown {
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const f of findings) {
    if (f.severity === 'info') continue;
    const level = LEVEL_OF[f.severity];
    if (!rules.has(f.detector)) {
      rules.set(f.detector, {
        id: f.detector,
        name: f.detector,
        shortDescription: {text: `cladding drift detector ${f.detector}`},
      });
    }
    results.push({
      ruleId: f.detector,
      level,
      message: {text: f.message},
      ...(f.path ? {locations: locationOf(f.path, f.line)} : {}),
    });
  }

  results.sort((a, b) => {
    const byRule = a.ruleId.localeCompare(b.ruleId);
    if (byRule !== 0) return byRule;
    const ap = a.locations?.[0]?.physicalLocation.artifactLocation.uri ?? '';
    const bp = b.locations?.[0]?.physicalLocation.artifactLocation.uri ?? '';
    if (ap !== bp) return ap.localeCompare(bp);
    const al = a.locations?.[0]?.physicalLocation.region.startLine ?? 0;
    const bl = b.locations?.[0]?.physicalLocation.region.startLine ?? 0;
    if (al !== bl) return al - bl;
    return a.message.text.localeCompare(b.message.text);
  });

  const driverRules = [...rules.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'cladding',
            informationUri: INFORMATION_URI,
            rules: driverRules,
          },
        },
        results,
      },
    ],
  };
}
