// Cladding · JUnit XML report parser (F-<hash>).
//
// WHY: an AC's `test_refs[]` today only have to *exist on disk* (UNTESTED_AC)
// — an empty file, a `test.skip`, or a failing test all satisfy the gate, so
// the traceability chain stops at "AC → named file", not "AC → observed pass".
// Parsing a standard JUnit XML run lets UNVERIFIED_AC close that gap.
//
// Parsing is pure + regex-based (no XML dependency), mirroring how the
// COVERAGE_DROP detector reads JaCoCo/Kover XML. JUnit XML is the de-facto
// CI test-result format emitted by vitest / jest / pytest / go-junit / etc.;
// the shape this reads (per-file `<testsuite>` / `<testcase classname>` with
// `<failure>` / `<error>` / `<skipped>` children) is what those runners produce.

/** Aggregate pass/fail/skip counts for one test file. */
export interface FileTestStatus {
  pass: number;
  fail: number;
  skip: number;
}

/** Parsed report keyed by normalized test-file path (a `<testcase classname>`). */
export type JUnitReport = Map<string, FileTestStatus>;

/** Strip `./`, normalize separators, drop a trailing slash — for path matching. */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

const ATTR = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

// A <testcase ...>…</testcase> or self-closed <testcase ... />.
const TESTCASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;

/**
 * Parse JUnit XML into per-file pass/fail/skip aggregates.
 *
 * A testcase counts as `fail` if its body carries a `<failure>`/`<error>`, as
 * `skip` if it carries `<skipped>`, else `pass`. The file is taken from the
 * testcase's `classname` (the runners above all set it to the source/test file
 * path); cases with no `classname` are ignored (nothing to anchor a test_ref to).
 */
export function parseJUnitReport(xml: string): JUnitReport {
  const out: JUnitReport = new Map();
  let m: RegExpExecArray | null;
  TESTCASE.lastIndex = 0;
  while ((m = TESTCASE.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[3] ?? '';
    const file = ATTR(attrs, 'classname');
    if (!file) continue;
    const key = normalize(file);
    const acc = out.get(key) ?? {pass: 0, fail: 0, skip: 0};
    if (/<(failure|error)\b/.test(body)) acc.fail += 1;
    else if (/<skipped\b/.test(body)) acc.skip += 1;
    else acc.pass += 1;
    out.set(key, acc);
  }
  return out;
}

/**
 * Look up a test_ref's file in the report, tolerant of relative-path framing
 * (the ref may be `tests/x.test.ts` while the report records `./tests/x.test.ts`
 * or an absolute-rooted variant). Matches on exact normalized equality or a
 * path-suffix relationship in either direction.
 */
export function lookupTestRef(report: JUnitReport, refPath: string): FileTestStatus | undefined {
  const ref = normalize(refPath);
  const direct = report.get(ref);
  if (direct) return direct;
  for (const [key, status] of report) {
    if (key === ref || key.endsWith(`/${ref}`) || ref.endsWith(`/${key}`)) return status;
  }
  return undefined;
}
