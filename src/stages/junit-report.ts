// Cladding · JUnit XML report parser (F-96700032 · multi-framework: F-d980359c).
//
// WHY: an AC's `test_refs[]` today only have to *exist on disk* (UNTESTED_AC)
// — an empty file, a `test.skip`, or a failing test all satisfy the gate, so
// the traceability chain stops at "AC → named file", not "AC → observed pass".
// Parsing a standard JUnit XML run lets UNVERIFIED_AC close that gap.
//
// Parsing is pure + regex-based (no XML dependency), mirroring how the
// COVERAGE_DROP detector reads JaCoCo/Kover XML. JUnit XML is the de-facto
// CI test-result format emitted by vitest / jest / pytest / go-junit / etc.
//
// Cross-framework matching (F-d980359c): the one thing that varies between
// emitters is how a testcase names its source — `classname` is a file path in
// vitest, a dotted module in pytest (`tests.test_foo`), and an FQCN in
// Java/Kotlin (`com.example.FooTest`); some emitters also (or only) carry a
// `file=` attribute. We index each testcase under EVERY path-shaped key we can
// derive (file attr, classname as-is, dot→slash conversion) and match test_refs
// extension-agnostically, so one parser covers all four families.

/** Aggregate pass/fail/skip counts for one test file. */
export interface FileTestStatus {
  pass: number;
  fail: number;
  skip: number;
}

/** One source-level testcase observation retained beside the legacy aggregates. */
export interface JUnitCaseObservation {
  /** The strongest path-shaped key emitted by the report, when present. */
  readonly file?: string;
  /** Every normalized path carrier supplied by file/classname attributes. */
  readonly files: readonly string[];
  /** Raw runner classname retained for exact-source diagnostics. */
  readonly className?: string;
  /** Exact runner testcase name. */
  readonly name: string;
  /**
   * Explicit source title when a non-JUnit current-run adapter provides one.
   * Parsed JUnit XML intentionally leaves this absent, so it remains exact-only.
   */
  readonly sourceTitle?: string;
  /** Error is kept distinct even though legacy aggregates count it as a fail. */
  readonly status: 'pass' | 'fail' | 'skip' | 'error';
}

/**
 * Parsed report keyed by every normalized path-shaped key a testcase yields.
 * The Map surface is intentionally unchanged for existing file-level callers;
 * F5 consumers use `cases` for exact binding joins.
 */
export interface JUnitReport extends Map<string, FileTestStatus> {
  readonly cases?: readonly JUnitCaseObservation[];
}

/** Strip `./`, normalize separators, drop a trailing slash — for path matching. */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Strip a single trailing file extension (`.ts`, `.py`, `.kt`, …) for ext-agnostic matching. */
function stripExt(p: string): string {
  return p.replace(/\.[A-Za-z0-9]+$/, '');
}

/**
 * Does a key look like a source path? True when it carries a separator (vitest)
 * or is a dotted identifier with no whitespace (a pytest module / FQCN). A
 * describe-title classname like `MyComponent renders` is NOT path-like — that
 * is the signal a report's classname convention cannot be mapped to files, on
 * which UNVERIFIED_AC degrades rather than flooding false "absent" findings.
 */
export function isPathLike(s: string): boolean {
  return s.includes('/') || (s.includes('.') && !/\s/.test(s));
}

const ATTR = (attrs: string, name: string): string | undefined => {
  const value = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return value ? decodeXmlEntities(value[1] ?? value[2] ?? '') : undefined;
};

// A <testcase ...>…</testcase> or self-closed <testcase ... />.
const TESTCASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;

/**
 * Every path-shaped key a testcase's attributes yield, most-confident first:
 *   1. `file=` attribute (pytest / go-junit-report v2 / modern vitest)
 *   2. `classname` as-is (vitest emits a file path; also a bare filename)
 *   3. dot→slash of a no-separator dotted classname (pytest module / Java FQCN)
 * A dotted classname keeps BOTH its as-is and converted forms so a bare
 * `foo.test.ts` (extension dots) and a real module `tests.test_foo` both match.
 */
function candidateKeys(attrs: string): string[] {
  const keys: string[] = [];
  const file = ATTR(attrs, 'file');
  if (file) keys.push(normalize(file));
  const classname = ATTR(attrs, 'classname');
  if (classname) {
    const norm = normalize(classname);
    keys.push(norm);
    if (!norm.includes('/') && norm.includes('.')) keys.push(norm.replace(/\./g, '/'));
  }
  return keys;
}

/**
 * Parse JUnit XML into per-file pass/fail/skip aggregates.
 *
 * A testcase counts as `fail` if its body carries a `<failure>`/`<error>`, as
 * `skip` if it carries `<skipped>`, else `pass`. Each testcase is indexed under
 * every key `candidateKeys` derives, all sharing ONE accumulator so the case is
 * counted exactly once; cases with no derivable key are ignored (nothing to
 * anchor a test_ref to). Real emitters name a file consistently across its
 * testcases, so the shared accumulator aggregates per file correctly.
 */
export function parseJUnitReport(xml: string): JUnitReport {
  const out = new Map<string, FileTestStatus>() as JUnitReport;
  const cases: JUnitCaseObservation[] = [];
  let m: RegExpExecArray | null;
  TESTCASE.lastIndex = 0;
  while ((m = TESTCASE.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[3] ?? '';
    const keys = candidateKeys(attrs);
    if (keys.length === 0) continue;
    const acc = out.get(keys[0]) ?? {pass: 0, fail: 0, skip: 0};
    const status = /<error\b/.test(body) ? 'error' : /<failure\b/.test(body) ? 'fail' : /<skipped\b/.test(body) ? 'skip' : 'pass';
    if (status === 'error' || status === 'fail') acc.fail += 1;
    else if (status === 'skip') acc.skip += 1;
    else acc.pass += 1;
    for (const key of keys) out.set(key, acc);
    const className = ATTR(attrs, 'classname');
    const name = ATTR(attrs, 'name') ?? '';
    cases.push({
      ...(keys[0] ? {file: keys[0]} : {}),
      files: Object.freeze([...new Set(keys)]),
      ...(className ? {className} : {}),
      name,
      status,
    });
  }
  Object.defineProperty(out, 'cases', {value: Object.freeze(cases), enumerable: false});
  return out;
}

/** Decodes the XML entities valid in attribute values, including numeric forms. */
function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:(amp|lt|gt|quot|apos)|#(x[0-9a-fA-F]+|[0-9]+));/g, (_match, named: string | undefined, numeric: string | undefined) => {
    if (named) return ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"} as Record<string, string>)[named]!;
    const numericValue = numeric!;
    const codePoint = numericValue.startsWith('x') ? Number.parseInt(numericValue.slice(1), 16) : Number.parseInt(numericValue, 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(codePoint);
  });
}

/**
 * Look up a test_ref's file in the report, tolerant of relative-path framing
 * AND of cross-framework naming (the report key may be a dotted-then-converted
 * module, the ref a real file path with an extension). Tries an exact
 * normalized hit first, then an extension-agnostic exact / path-suffix match in
 * either direction.
 */
export function lookupTestRef(report: JUnitReport, refPath: string): FileTestStatus | undefined {
  const norm = normalize(refPath);
  const direct = report.get(norm);
  if (direct) return direct;
  const ref = stripExt(norm);
  for (const [rawKey, status] of report) {
    const key = stripExt(rawKey);
    if (key === ref || key.endsWith(`/${ref}`) || ref.endsWith(`/${key}`)) return status;
  }
  return undefined;
}
