// Cladding · MCP efficacy boundary for Spec 0.2 (F-0a29d024).

import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ToolListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import {afterEach, describe, expect, test} from 'vitest';

import {refineOnboarding, resolveOnboardingReview} from '../../../src/cli/clarify.js';
import {prepareHostClarify, prepareHostInit, renderHostDraft} from '../../../src/cli/host-onboarding.js';
import {runInit} from '../../../src/cli/init.js';
import {clearAuditObserversForTesting} from '../../../src/hitl/audit.js';
import {buildServer, TOOL_NAMES} from '../../../src/serve/server.js';
import {
  loadValidationManifest,
  summarizeHostSmoke,
  TASK_PROFILE_TOOLS,
  validateSpec02,
} from '../../../scripts/spec-0.2-validate.js';

const draft = {
  mode: 'greenfield',
  project_context: {
    why: 'Make design changes auditable.',
    problem: 'Design evidence is easy to overclaim.',
    purpose: 'Validate Spec 0.2 before runtime cutover.',
  },
  capabilities: [
    {id: 'design', title: 'Design', summary: 'Compile design requirements.', surface: 'feature'},
    {id: 'proof', title: 'Proof', summary: 'Preserve evidence boundaries.', surface: 'platform'},
    {id: 'transport', title: 'Transport', summary: 'Expose bounded tools.', surface: 'infrastructure'},
  ],
  architecture: {layers: [{name: 'core', forbidden_imports: ['transport']}]},
  scenarios: [{slug: 'design-cycle', title: 'Design cycle', flow: 'A maintainer validates and accepts a design change.'}],
  questions: [],
} as const;

function payload(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent as Record<string, unknown>;
  }
  const content = result.content as Array<{type: string; text: string}>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('Spec 0.2 MCP validation', () => {
  const temporary: string[] = [];

  afterEach(() => {
    for (const path of temporary.splice(0)) rmSync(path, {recursive: true, force: true});
    clearAuditObserversForTesting();
  });

  test('[covers:F-0a29d024/AC-bd12a73c] separates MCP conformance efficacy and adoption without vacuous success', async () => {
    const report = await validateSpec02(process.cwd());
    const checks = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
    expect(checks['mcp-wire-catalog']).toBe('pass');
    expect(checks['mcp-reference-host-spec-02-e2e']).toBe('not_run');
    expect(checks['mcp-adoption']).not.toBe('pass');
    expect(checks['live-host-token-ab']).toBe('not_run');
    if (report.mcp.host_smoke !== null) {
      expect(report.mcp.host_smoke.scope).toBe('legacy-read-surface');
    }
    expect(loadValidationManifest(process.cwd()).mcp_scenarios).toHaveLength(12);

    const dir = mkdtempSync(join(tmpdir(), 'clad-spec-02-host-smoke-'));
    temporary.push(dir);
    expect(summarizeHostSmoke(dir)).toBeNull();
    const auditDir = join(dir, '.cladding', 'audit');
    mkdirSync(auditDir, {recursive: true});
    writeFileSync(
      join(auditDir, 'host-smoke-fixture.json'),
      JSON.stringify({
        hosts: {
          codex: {
            grade: 'verified',
            surfaces: [{evidence: 'tokens used 1,234'}],
          },
        },
      }),
    );
    expect(summarizeHostSmoke(dir)).toEqual({
      file: join('.cladding', 'audit', 'host-smoke-fixture.json'),
      hosts_verified: ['codex'],
      hosts_failed: [],
      provider_reported_tokens: {codex: [1234]},
      scope: 'legacy-read-surface',
    });
  });

  test('negotiates dynamic tool discovery and emits list-changed after bootstrap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-spec-02-mcp-'));
    temporary.push(dir);
    const server = buildServer({
      cwd: dir,
      name: 'cladding-spec-02-mcp-test',
      version: '0.0.0-test',
      onboarding: {
        renderDraft: (value) => renderHostDraft(value as Parameters<typeof renderHostDraft>[0]),
        prepareInit: ({cwd, mode, intent}) => prepareHostInit(cwd, mode, intent),
        initialize: runInit,
        prepareClarify: (answer, {cwd}) => prepareHostClarify(cwd, answer),
        clarify: refineOnboarding,
        resolveReview: (targets, {cwd}) => resolveOnboardingReview(targets, {cwd}),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'spec-02-mcp-test', version: '0.0.0-test'});
    let listChanged = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      listChanged++;
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
      expect((await client.listTools()).tools).toHaveLength(3);
      const prepared = payload(await client.callTool({
        name: 'clad_prepare_init',
        arguments: {mode: 'idea', intent: 'Spec 0.2 validation project'},
      }));
      const result = await client.callTool({
        name: 'clad_init',
        arguments: {
          token: prepared.token,
          confirmation: prepared.approvalChallenge,
          draft,
        },
      });
      expect(result.isError).not.toBe(true);
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(true);
      expect((await client.listTools()).tools.map((tool) => tool.name).sort())
        .toEqual([...TOOL_NAMES].sort());
      expect(listChanged).toBeGreaterThan(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('classifies every shipped tool while keeping the task-scoped catalog a challenger', async () => {
    const classified = new Set(Object.values(TASK_PROFILE_TOOLS).flat());
    expect([...classified].sort()).toEqual([...TOOL_NAMES].sort());
    const report = await validateSpec02(process.cwd());
    expect(report.mcp.task_profile_reduction_ratio).toBeGreaterThanOrEqual(0.2);
    expect(report.checks.find((check) => check.id === 'mcp-task-profile-challenger')?.status)
      .toBe('inconclusive');
  });
});
