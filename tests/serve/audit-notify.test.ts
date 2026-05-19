// Cladding · integration test — MCP server notifies clients on audit
// write (v0.2.25, F-074).
//
// Proves the full chain works end-to-end:
//   1. server + client paired over InMemoryTransport
//   2. client subscribes to `cladding://audit`
//   3. external code appends evidence via appendEvidence(cwd, ...)
//   4. server-side observer fires and calls sendResourceUpdated
//   5. client receives a notifications/resources/updated message
//   6. client re-reads the audit resource and sees the new entry
//
// This is the "live audit stream" capability the v0.2.25 release notes
// advertise. It also implicitly tests that the audit observer survives
// the server.connect() boundary — registration happens in buildServer.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ResourceUpdatedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvidence, clearAuditObserversForTesting} from '../../src/hitl/audit.js';
import {newEvidence} from '../../src/hitl/identity.js';
import {buildServer, RESOURCE_URIS} from '../../src/serve/server.js';

const MINIMAL_SPEC = `schema: "0.1"
project:
  name: probe
  language: typescript
features:
  - id: F-001
    title: alpha
    status: planned
    modules: []
    acceptance_criteria:
      - id: AC-001
        ears: ubiquitous
        text: probe
`;

describe('serve · audit live notification (F-074)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-audit-notify-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    clearAuditObserversForTesting();
  });
  afterEach(() => {
    clearAuditObserversForTesting();
    rmSync(dir, {recursive: true, force: true});
  });

  test('client subscribed to cladding://audit receives notification when evidence lands', async () => {
    const server = buildServer({cwd: dir, name: 'cladding-test', version: '0.0.0-test'});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      {name: 'cladding-test-client', version: '0.0.0-test'},
      {capabilities: {}},
    );

    // Hook a handler that records every resources/updated notification.
    const notifications: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      notifications.push(n.params.uri);
    });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      await client.subscribeResource({uri: RESOURCE_URIS.audit});

      // Append from outside the server boundary — this is the shape
      // a drive-loop iteration would produce in production.
      appendEvidence(
        dir,
        newEvidence({
          featureId: 'F-001',
          stage: 'agent:reviewer',
          identity: {author: 'llm', name: 'mcp-sampling:host:reviewer', timestamp: '2026-05-19T00:00:00Z'},
          kind: 'note',
          content: 'reviewer signed off',
        }),
      );

      // Allow the in-memory transport to flush the notification.
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(notifications).toContain(RESOURCE_URIS.audit);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('appendEvidence for a DIFFERENT cwd does NOT notify the server', async () => {
    const server = buildServer({cwd: dir, name: 'cladding-test', version: '0.0.0-test'});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      {name: 'cladding-test-client', version: '0.0.0-test'},
      {capabilities: {}},
    );
    const notifications: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      notifications.push(n.params.uri);
    });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      await client.subscribeResource({uri: RESOURCE_URIS.audit});

      const otherDir = mkdtempSync(join(tmpdir(), 'clad-audit-other-'));
      try {
        // Evidence written into a different project root must not
        // notify *this* server — observers filter by cwd.
        appendEvidence(
          otherDir,
          newEvidence({
            featureId: 'F-099',
            stage: 't',
            identity: {author: 'tool', name: 't', timestamp: '2026-05-19T00:00:00Z'},
            kind: 'note',
            content: '',
          }),
        );

        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(notifications).not.toContain(RESOURCE_URIS.audit);
      } finally {
        rmSync(otherDir, {recursive: true, force: true});
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('re-reading the audit resource after notification yields the new line', async () => {
    const server = buildServer({cwd: dir, name: 'cladding-test', version: '0.0.0-test'});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      {name: 'cladding-test-client', version: '0.0.0-test'},
      {capabilities: {}},
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      // Before any append: resource is empty.
      const before = await client.readResource({uri: RESOURCE_URIS.audit});
      const beforeText = (before.contents[0] as {text: string}).text;
      expect(beforeText).toBe('');

      appendEvidence(
        dir,
        newEvidence({
          featureId: 'F-001',
          stage: 'agent:specialists',
          identity: {author: 'llm', name: 'mcp-sampling:host:specialists', timestamp: '2026-05-19T00:00:00Z'},
          kind: 'note',
          content: 'specialist authored',
        }),
      );

      await new Promise<void>((resolve) => setImmediate(resolve));

      const after = await client.readResource({uri: RESOURCE_URIS.audit});
      const afterText = (after.contents[0] as {text: string}).text;
      expect(afterText).toContain('F-001');
      expect(afterText).toContain('specialist authored');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
