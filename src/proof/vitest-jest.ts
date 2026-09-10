// Cladding · Spec 0.2 F5 · Vitest/Jest title-carrier adapter.

import {parse} from '@babel/parser';

import type {TestBinding} from './types.js';

/** A source-location error that blocks a malformed or unknown covers address. */
export interface TestBindingDiagnostic {
  readonly code: 'UNKNOWN_CRITERION';
  readonly criterion: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** The one result produced by the native Vitest/Jest source adapter. */
export interface TestBindingHarvest {
  readonly bindings: readonly TestBinding[];
  readonly diagnostics: readonly TestBindingDiagnostic[];
}

/** Input kept small so callers must supply compiler-owned known addresses. */
export interface VitestJestHarvestInput {
  readonly file: string;
  readonly source: string;
  /** Composite `F-id/AC-id` addresses from the current compiler view. */
  readonly knownCriteria: ReadonlySet<string>;
  readonly framework?: 'vitest' | 'jest';
}

const CARRIER = /^((?:\[covers:(F-[a-z0-9]+\/AC-[a-z0-9]+)\])+)/i;
const TOKEN = /\[covers:(F-[a-z0-9]+\/AC-[a-z0-9]+)\]/gi;

/**
 * Harvests only leading, consecutive title tokens. The AST walker owns only
 * program statements and literal suite callbacks, preventing helper-local
 * test calls from inventing selectors that the runner cannot reproduce.
 */
export function harvestVitestJestBindings(input: VitestJestHarvestInput): TestBindingHarvest {
  const sourceFile = parse(input.source, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
  const bindings: TestBinding[] = [];
  const diagnostics: TestBindingDiagnostic[] = [];
  const framework = input.framework ?? 'vitest';
  const harvestTest = (call: AstNode, suiteStack: readonly string[]): void => {
    const titleNode = call.arguments?.[0];
    if (!isStringLiteral(titleNode)) return;
    const title = titleNode.value;
    const match = CARRIER.exec(title);
    if (!match) return;

    const prefix = match[1];
    const criteria = [...prefix.matchAll(TOKEN)].map((token) => token[1]);
    const position = titleNode.loc?.start ?? {line: 1, column: 0};
    const selector = framework === 'vitest' && suiteStack.length > 0
      ? [...suiteStack, title].join(' > ')
      : title;
    for (const criterion of criteria) {
      if (!input.knownCriteria.has(criterion)) {
        diagnostics.push({
          code: 'UNKNOWN_CRITERION', criterion, file: input.file,
          line: position.line, column: position.column + 1,
        });
        continue;
      }
      bindings.push({criterion, framework, file: normalizePath(input.file), selector, carrier: 'title'});
    }
  };

  const visitStatements = (statements: readonly unknown[], suiteStack: readonly string[]): void => {
    for (const statement of statements) {
      const expression = expressionStatementCall(statement);
      if (!expression) continue;
      if (isSuiteCall(expression.callee)) {
        const titleNode = expression.arguments?.[0];
        const callback = expression.arguments?.[1];
        // A suite name or callback we cannot prove static owns no descendants.
        // This deliberately avoids harvesting tests from helpers, `.each`, or
        // dynamically constructed suites that JUnit cannot name exactly.
        if (!isStringLiteral(titleNode) || !isOwnedSuiteCallback(callback)) continue;
        visitStatements(callback.body.body, [...suiteStack, titleNode.value]);
        continue;
      }
      if (isTestCall(expression.callee)) harvestTest(expression, suiteStack);
    }
  };

  visitStatements(programStatements(sourceFile), []);
  return {
    bindings: bindings.sort(compareBinding),
    diagnostics: diagnostics.sort((left, right) => `${left.file}:${left.line}:${left.criterion}`.localeCompare(`${right.file}:${right.line}:${right.criterion}`)),
  };
}

interface AstNode {
  readonly type?: string;
  readonly callee?: unknown;
  readonly arguments?: readonly unknown[];
  readonly body?: unknown;
  readonly expression?: unknown;
  readonly value?: unknown;
  readonly loc?: {readonly start: {readonly line: number; readonly column: number}};
}

interface OwnedSuiteCallback extends AstNode {
  readonly body: {readonly type?: string; readonly body: readonly unknown[]};
}

function programStatements(sourceFile: unknown): readonly unknown[] {
  const program = sourceFile as {program?: {body?: unknown}};
  return Array.isArray(program.program?.body) ? program.program.body : [];
}

function expressionStatementCall(statement: unknown): AstNode | null {
  const node = statement as AstNode;
  if (node.type !== 'ExpressionStatement') return null;
  const expression = node.expression as AstNode | undefined;
  return expression?.type === 'CallExpression' ? expression : null;
}

function isStringLiteral(node: unknown): node is AstNode & {readonly value: string} {
  const candidate = node as AstNode;
  return candidate?.type === 'StringLiteral' && typeof candidate.value === 'string';
}

function isOwnedSuiteCallback(node: unknown): node is OwnedSuiteCallback {
  const candidate = node as AstNode;
  if (candidate?.type !== 'ArrowFunctionExpression' && candidate?.type !== 'FunctionExpression') {
    return false;
  }
  const body = candidate.body as AstNode | undefined;
  return body?.type === 'BlockStatement' && Array.isArray(body.body);
}

/** Derives the adapter's address set from the compiler's semantic nodes. */
export function knownCriteriaFromCompilerView(nodes: readonly {readonly address: string; readonly nodeType: string; readonly kind?: string}[]): ReadonlySet<string> {
  const addresses = nodes
    .filter((node) => node.nodeType === 'semantic' && node.kind === 'criterion' && node.address.startsWith('criterion:'))
    .map((node) => node.address.slice('criterion:'.length));
  return new Set(addresses);
}

function isTestCall(node: unknown): boolean {
  return isNamedRunnerCall(node, new Set(['it', 'test']));
}

function isSuiteCall(node: unknown): boolean {
  return isNamedRunnerCall(node, new Set(['describe', 'suite']));
}

function isNamedRunnerCall(node: unknown, roots: ReadonlySet<string>): boolean {
  let target = node as {type?: string; object?: unknown; property?: unknown; computed?: boolean; name?: string} | undefined;
  while (target?.type === 'MemberExpression') {
    const property = target.property as {type?: string; name?: string} | undefined;
    if (target.computed || property?.type !== 'Identifier' || !RUNNER_MODIFIERS.has(property.name ?? '')) {
      return false;
    }
    target = target.object as {type?: string; object?: unknown; property?: unknown; computed?: boolean; name?: string} | undefined;
  }
  return target?.type === 'Identifier' && roots.has(target.name ?? '');
}

const RUNNER_MODIFIERS: ReadonlySet<string> = new Set(['only', 'skip', 'concurrent']);

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function compareBinding(left: TestBinding, right: TestBinding): number {
  return `${left.criterion}\u0000${left.file}\u0000${left.selector}`.localeCompare(`${right.criterion}\u0000${right.file}\u0000${right.selector}`);
}
