// Cladding · Vitest/Jest proof adapter tests.

import {describe, expect, test} from 'vitest';

import {reduceTestBindings} from '../../src/proof/bindings.js';
import {harvestVitestJestBindings} from '../../src/proof/vitest-jest.js';
import {parseJUnitReport} from '../../src/stages/junit-report.js';

describe('Vitest/Jest covers adapter', () => {
  test('C01 harvests consecutive leading title carriers for multiple criteria', () => {
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/example.test.ts',
      source: [
        'it(\'[covers:F-aaaaaaaa/AC-bbbbbbbb][covers:F-aaaaaaaa/AC-cccccccc] does the work\', () => {});',
      ].join('\n'),
      knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb', 'F-aaaaaaaa/AC-cccccccc']),
    });
    expect(harvested.bindings).toEqual([
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-bbbbbbbb', selector: '[covers:F-aaaaaaaa/AC-bbbbbbbb][covers:F-aaaaaaaa/AC-cccccccc] does the work', carrier: 'title'}),
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-cccccccc', selector: '[covers:F-aaaaaaaa/AC-bbbbbbbb][covers:F-aaaaaaaa/AC-cccccccc] does the work', carrier: 'title'}),
    ]);
    expect(harvested.diagnostics).toEqual([]);
  });

  test('C02 ignores bare IDs, organic mentions, comments, and non-leading title text', () => {
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/example.test.ts',
      source: [
        'it(\' [covers:F-aaaaaaaa/AC-bbbbbbbb] has leading whitespace\', () => {});',
        'it(\'organic F-aaaaaaaa/AC-bbbbbbbb mention\', () => {});',
        '// [covers:F-aaaaaaaa/AC-bbbbbbbb] comment',
      ].join('\n'),
      knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb']),
    });
    expect(harvested).toEqual({bindings: [], diagnostics: []});
  });

  test('C03 rejects a leading carrier for an unknown composite criterion', () => {
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/example.test.ts', source: 'it(\'[covers:F-aaaaaaaa/AC-deadbeef] unknown\', () => {});',
      knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb']),
    });
    expect(harvested.diagnostics).toEqual([expect.objectContaining({code: 'UNKNOWN_CRITERION', criterion: 'F-aaaaaaaa/AC-deadbeef'})]);
  });

  test('round-trips nested and doubly nested Vitest selectors exactly once', () => {
    const nestedTitle = '[covers:F-aaaaaaaa/AC-bbbbbbbb] nested';
    const doublyNestedTitle = '[covers:F-aaaaaaaa/AC-cccccccc] doubly & nested';
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/nested.test.ts',
      source: [
        "describe.only('outer & suite', () => {",
        `  test.concurrent(${JSON.stringify(nestedTitle)}, () => {});`,
        "  suite.concurrent('inner > suite', () => {",
        `    it.only(${JSON.stringify(doublyNestedTitle)}, () => {});`,
        '  });',
        '});',
      ].join('\n'),
      knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb', 'F-aaaaaaaa/AC-cccccccc']),
    });
    expect(harvested.bindings).toEqual([
      expect.objectContaining({
        criterion: 'F-aaaaaaaa/AC-bbbbbbbb',
        selector: `outer & suite > ${nestedTitle}`,
      }),
      expect.objectContaining({
        criterion: 'F-aaaaaaaa/AC-cccccccc',
        selector: `outer & suite > inner > suite > ${doublyNestedTitle}`,
      }),
    ]);
    expect(harvested.bindings).toHaveLength(2);
    const report = parseJUnitReport([
      '<testsuite>',
      '<testcase file="tests/proof/nested.test.ts" name="outer &amp; suite &#62; [covers:F-aaaaaaaa/AC-bbbbbbbb] nested"/>',
      '<testcase file="tests/proof/nested.test.ts" name="outer &amp; suite &#62; inner &#62; suite &#62; [covers:F-aaaaaaaa/AC-cccccccc] doubly &amp; nested"/>',
      '</testsuite>',
    ].join(''));
    expect(reduceTestBindings(harvested.bindings, report)).toEqual([
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-bbbbbbbb', state: 'verified', pass: 1}),
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-cccccccc', state: 'verified', pass: 1}),
    ]);
  });

  test('does not match same-file related selector prefixes or suffixes', () => {
    const title = '[covers:F-aaaaaaaa/AC-bbbbbbbb] exact leaf';
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/exact-name.test.ts',
      source: `describe('outer', () => { test(${JSON.stringify(title)}, () => {}); });`,
      knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb']),
    });
    const report = parseJUnitReport([
      '<testsuite>',
      `<testcase file="tests/proof/exact-name.test.ts" name="outer > ${title} suffix"/>`,
      `<testcase file="tests/proof/exact-name.test.ts" name="unrelated > outer > ${title}"/>`,
      '</testsuite>',
    ].join(''));
    expect(reduceTestBindings(harvested.bindings, report)).toEqual([
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-bbbbbbbb', state: 'unverified', matched: 0}),
    ]);
  });

  test('fails closed for dynamic, unsupported, and non-owned suite descendants', () => {
    const criterion = 'F-aaaaaaaa/AC-bbbbbbbb';
    const title = `[covers:${criterion}] must not be inferred`;
    const safeTitle = `[covers:${criterion}] safely owned`;
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/suite-safety.test.ts',
      source: [
        "const dynamic = 'dynamic';",
        `describe(dynamic, () => { test(${JSON.stringify(title)}, () => {}); });`,
        `describe('expression body', () => test(${JSON.stringify(title)}, () => {}));`,
        `describe.each(['unsupported'])('unsupported', () => { test(${JSON.stringify(title)}, () => {}); });`,
        `function helper() { test(${JSON.stringify(title)}, () => {}); }`,
        'helper();',
        "suite.skip('safe', () => {",
        `  it.concurrent(${JSON.stringify(safeTitle)}, () => {});`,
        '});',
      ].join('\n'),
      knownCriteria: new Set([criterion]),
    });
    expect(harvested).toEqual({
      bindings: [expect.objectContaining({criterion, selector: `safe > ${safeTitle}`})],
      diagnostics: [],
    });
  });

  test('keeps Jest suite descendants on the committed leaf-only selector', () => {
    const title = '[covers:F-aaaaaaaa/AC-bbbbbbbb] Jest leaf';
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/jest-nested.test.ts',
      source: `describe('Jest suite', () => { test(${JSON.stringify(title)}, () => {}); });`,
      knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb']),
      framework: 'jest',
    });
    expect(harvested.bindings).toEqual([
      expect.objectContaining({framework: 'jest', selector: title}),
    ]);
    const report = parseJUnitReport([
      '<testsuite>',
      `<testcase file="tests/proof/jest-nested.test.ts" name="${title}"/>`,
      `<testcase file="tests/proof/jest-nested.test.ts" name="Jest suite > ${title}"/>`,
      '</testsuite>',
    ].join(''));
    expect(reduceTestBindings(harvested.bindings, report)).toEqual([
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-bbbbbbbb', state: 'verified', pass: 1}),
    ]);
  });

  function bindingCases() {
    const harvested = harvestVitestJestBindings({
      file: 'tests/proof/example.test.ts',
      source: [
        "it('[covers:F-aaaaaaaa/AC-bbbbbbbb] failure', () => {});",
        "it('[covers:F-aaaaaaaa/AC-cccccccc] skipped', () => {});",
        "it('[covers:F-aaaaaaaa/AC-dddddddd] passing', () => {});",
      ].join('\n'),
      knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb', 'F-aaaaaaaa/AC-cccccccc', 'F-aaaaaaaa/AC-dddddddd']),
    });
    const report = parseJUnitReport([
      '<testsuite>',
      '<testcase file="tests/proof/example.test.ts" name="[covers:F-aaaaaaaa/AC-bbbbbbbb] failure"><failure/></testcase>',
      '<testcase file="tests/proof/example.test.ts" name="[covers:F-aaaaaaaa/AC-cccccccc] skipped"><skipped/></testcase>',
      '<testcase file="tests/proof/example.test.ts" name="[covers:F-aaaaaaaa/AC-dddddddd] passing"/>',
      '<testcase file="tests/proof/example.test.ts" name="unrelated pass"/>',
      '</testsuite>',
    ].join(''));
    return reduceTestBindings(harvested.bindings, report);
  }

  test('C04 never counts an unrelated same-file pass as a bound observation', () => {
    expect(bindingCases().find((result) => result.criterion === 'F-aaaaaaaa/AC-cccccccc')).toMatchObject({state: 'unverified', skip: 1, pass: 0});
  });

  test('C05 reduces a skipped-only bound case as unverified', () => {
    expect(bindingCases().find((result) => result.criterion === 'F-aaaaaaaa/AC-cccccccc')).toMatchObject({state: 'unverified', skip: 1});
  });

  test('C06 gives an exact bound failure precedence over positive observations', () => {
    const cases = bindingCases();
    expect(cases.find((result) => result.criterion === 'F-aaaaaaaa/AC-bbbbbbbb')).toMatchObject({state: 'failed', fail: 1});
    expect(cases.find((result) => result.criterion === 'F-aaaaaaaa/AC-dddddddd')).toMatchObject({state: 'verified', pass: 1});
  });

  test('round-trips captured Vitest and Jest JUnit attributes with XML entities and every path carrier', () => {
    const vitestTitle = '[covers:F-aaaaaaaa/AC-bbbbbbbb] vitest & > "quotes"';
    const jestTitle = "[covers:F-aaaaaaaa/AC-cccccccc] jest & > 'quotes'";
    const vitest = harvestVitestJestBindings({file: 'tests/proof/vitest-shape.test.ts', source: `it(${JSON.stringify(vitestTitle)}, () => {});`, knownCriteria: new Set(['F-aaaaaaaa/AC-bbbbbbbb'])});
    const jest = harvestVitestJestBindings({file: 'tests/proof/jest-shape.test.ts', source: `test(${JSON.stringify(jestTitle)}, () => {});`, knownCriteria: new Set(['F-aaaaaaaa/AC-cccccccc']), framework: 'jest'});
    const report = parseJUnitReport([
      '<testcase file="tests/proof/vitest-shape.test.ts" classname="spec.vitest-shape" name="[covers:F-aaaaaaaa/AC-bbbbbbbb] vitest &amp; &#62; &quot;quotes&quot;"/>',
      '<testcase classname="tests/proof/jest-shape.test.ts" name="[covers:F-aaaaaaaa/AC-cccccccc] jest &#38; &#x3e; &apos;quotes&apos;"/>',
    ].join(''));
    expect(reduceTestBindings([...vitest.bindings, ...jest.bindings], report)).toEqual([
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-bbbbbbbb', state: 'verified'}),
      expect.objectContaining({criterion: 'F-aaaaaaaa/AC-cccccccc', state: 'verified'}),
    ]);
    expect(report.cases?.[0]?.files).toContain('tests/proof/vitest-shape.test.ts');
    expect(report.cases?.[1]?.files).toContain('tests/proof/jest-shape.test.ts');
  });
});
