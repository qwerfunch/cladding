import {describe, it, expect} from 'vitest';
import {
  parseJUnitReport,
  lookupTestRef,
  isPathLike,
} from '../../src/stages/junit-report.js';
import {evaluateAcVerification} from '../../src/stages/detectors/unverified-ac.js';
import type {Spec} from '../../src/spec/types.js';

const specWith = (refs: string[], status = 'done'): Spec =>
  ({
    features: [
      {id: 'F-x', status, acceptance_criteria: [{id: 'AC-1', test_refs: refs}]},
    ],
  } as never);

// --- Multi-framework JUnit XML fixtures ------------------------------------

// pytest: testcase carries an explicit file= attribute.
const pytestXml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" tests="1" failures="0" skipped="0">
    <testcase classname="tests.test_foo" file="tests/test_foo.py" name="t"/>
  </testsuite>
</testsuites>`;

// Java/Kotlin: dotted FQCN classname, NO file attribute, NO slash.
const javaXml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="junit" tests="1" failures="0" skipped="0">
    <testcase classname="com.example.FooTest" name="ok"/>
  </testsuite>
</testsuites>`;

// jest: describe-title classname with spaces — no slash, no dot.
const jestXml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="jest" tests="1" failures="0" skipped="0">
    <testcase classname="MyComponent renders correctly" name="t"/>
  </testsuite>
</testsuites>`;

// vitest: path-like classname (the historical happy path).
const vitestPassXml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="vitest" tests="1" failures="0" skipped="0">
    <testcase classname="tests/foo.test.ts" name="x"/>
  </testsuite>
</testsuites>`;

const vitestFailXml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="vitest" tests="1" failures="1" skipped="0">
    <testcase classname="tests/foo.test.ts" name="x">
      <failure message="boom">stack</failure>
    </testcase>
  </testsuite>
</testsuites>`;

// ---------------------------------------------------------------------------

describe('file= attribute is the anchor (F-d980359c)', () => {
  it('[covers:F-d980359c/AC-23f0da78] finds a pytest testcase by its file= path with pass===1', () => {
    const report = parseJUnitReport(pytestXml);
    const status = lookupTestRef(report, 'tests/test_foo.py');
    expect(status).toBeDefined();
    expect(status!.pass).toBe(1);
  });
});

describe('dotted classname → slash-converted FQCN indexing (F-d980359c)', () => {
  it('[covers:F-d980359c/AC-07b10521] indexes a dotted FQCN under its slash-converted key', () => {
    const report = parseJUnitReport(javaXml);
    expect(report.has('com/example/FooTest')).toBe(true);
  });

  it('finds the FQCN by a suffix path with a file extension', () => {
    const report = parseJUnitReport(javaXml);
    const status = lookupTestRef(
      report,
      'src/test/kotlin/com/example/FooTest.kt',
    );
    expect(status).toBeDefined();
    expect(status!.pass).toBe(1);
  });
});

describe('extension-agnostic matching (F-d980359c)', () => {
  it('[covers:F-d980359c/AC-5daf7fc6] matches a ref WITH an extension against a key WITHOUT one (pytest)', () => {
    // key derived from classname `tests.test_foo` (no extension)
    const report = parseJUnitReport(pytestXml);
    const status = lookupTestRef(report, 'tests/test_foo.py');
    expect(status).toBeDefined();
    expect(status!.pass).toBe(1);
  });

  it('matches a FooTest.kt-bearing ref against a FooTest key', () => {
    const report = parseJUnitReport(javaXml);
    const status = lookupTestRef(report, 'FooTest.kt');
    expect(status).toBeDefined();
    expect(status!.pass).toBe(1);
  });
});

describe('confident-or-degrade on unmappable report (F-d980359c)', () => {
  it('classifies path-like vs non-path-like strings', () => {
    expect(isPathLike('MyComponent renders correctly')).toBe(false);
    expect(isPathLike('tests/foo.test.ts')).toBe(true);
    expect(isPathLike('com.example.FooTest')).toBe(true);
  });

  it('[covers:F-d980359c/AC-d47d2a88] degrades to an empty finding array on a jest describe-title report', () => {
    const report = parseJUnitReport(jestXml);
    const findings = evaluateAcVerification(
      specWith(['src/MyComponent.test.tsx']),
      report,
    );
    expect(findings).toHaveLength(0);
  });
});

describe('vitest regression guard (F-d980359c)', () => {
  it('[covers:F-d980359c/AC-dce7cb54] keeps a path-like classname pass working as before', () => {
    const report = parseJUnitReport(vitestPassXml);
    const status = lookupTestRef(report, 'tests/foo.test.ts');
    expect(status).toBeDefined();
    expect(status!.pass).toBe(1);
  });

  it('marks a testcase with a <failure> child as fail===1', () => {
    const report = parseJUnitReport(vitestFailXml);
    const status = lookupTestRef(report, 'tests/foo.test.ts');
    expect(status).toBeDefined();
    expect(status!.fail).toBe(1);
  });
});
