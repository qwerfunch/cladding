// Cladding · scripts/gen-xl-spec.ts — generate a 100-feature enterprise SaaS spec
//
// Used by the XL A/B/C cell (experiments/ab-test-v0.1.0/results/04-xl/).
// Emits three flavours of the same catalogue:
//   - --out=<dir>/spec.yaml          monolith (used by vanilla + harness)
//   - --out=<dir>/spec/features/     sharded F-NNN.yaml (used by cladding)
//   - --out=<dir>/spec/04-xl-saas.md markdown brief (used as the natural-language brief)
//
// 10 domains × 10 features = 100. Status distribution: 70 done / 20 in_progress / 10 planned.

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

import {stringify} from 'yaml';

interface Domain {
  readonly name: string;
  readonly prefix: string;
  readonly verbs: readonly string[];
}

const DOMAINS: readonly Domain[] = [
  {name: 'auth', prefix: 'auth', verbs: ['register', 'login', 'logout', 'refresh-token', 'reset-password', 'verify-email', 'enable-2fa', 'disable-2fa', 'list-sessions', 'revoke-session']},
  {name: 'users', prefix: 'user', verbs: ['create', 'read', 'update', 'delete', 'invite', 'list', 'search', 'export-pii', 'merge', 'soft-delete']},
  {name: 'orgs', prefix: 'org', verbs: ['create', 'rename', 'transfer-owner', 'add-member', 'remove-member', 'list-members', 'list-roles', 'set-role', 'delete', 'export-data']},
  {name: 'billing', prefix: 'billing', verbs: ['attach-card', 'detach-card', 'list-cards', 'set-default-card', 'create-customer', 'tax-id', 'address', 'currency', 'preview-charge', 'reconcile']},
  {name: 'invoicing', prefix: 'invoice', verbs: ['create', 'finalize', 'send', 'void', 'pay', 'refund', 'list', 'detail', 'download-pdf', 'apply-credit']},
  {name: 'subscriptions', prefix: 'sub', verbs: ['create', 'cancel', 'reactivate', 'upgrade', 'downgrade', 'pause', 'resume', 'list-items', 'usage-record', 'preview-proration']},
  {name: 'webhooks', prefix: 'webhook', verbs: ['create-endpoint', 'list-endpoints', 'delete-endpoint', 'rotate-secret', 'replay-event', 'list-deliveries', 'retry-policy', 'pause-endpoint', 'verify-signature', 'introspect']},
  {name: 'audit', prefix: 'audit', verbs: ['record-event', 'list-events', 'filter-by-actor', 'filter-by-resource', 'retention-policy', 'export', 'redact', 'tamper-seal', 'replay-window', 'search']},
  {name: 'admin', prefix: 'admin', verbs: ['impersonate', 'feature-flag', 'maintenance-mode', 'reindex-search', 'flush-cache', 'list-incidents', 'declare-incident', 'resolve-incident', 'rotate-key', 'audit-trail']},
  {name: 'search', prefix: 'search', verbs: ['index-document', 'query', 'autocomplete', 'facet', 'reindex', 'list-indices', 'delete-index', 'sync-status', 'analyzer-config', 'highlight']},
];

function statusFor(index: number): 'done' | 'in_progress' | 'planned' {
  if (index % 10 < 7) return 'done';
  if (index % 10 < 9) return 'in_progress';
  return 'planned';
}

function earsFor(verb: string): {ears: string; text: string} {
  if (verb.startsWith('list') || verb.startsWith('detail') || verb.startsWith('introspect')) {
    return {ears: 'event', text: `When the client queries the ${verb} endpoint, the system shall return the records in stable order.`};
  }
  if (verb.startsWith('delete') || verb.startsWith('cancel') || verb.startsWith('void') || verb.startsWith('revoke')) {
    return {ears: 'event', text: `When the client invokes ${verb}, the system shall remove or invalidate the target resource and emit an audit event.`};
  }
  return {ears: 'event', text: `When the client invokes ${verb}, the system shall persist the requested change and return the resulting entity.`};
}

interface Feature {
  id: string;
  title: string;
  status: string;
  modules: string[];
  depends_on?: string[];
  acceptance_criteria: Array<{id: string; ears: string; text: string; test_refs?: string[]}>;
}

const features: Feature[] = [];
let acCounter = 1;
DOMAINS.forEach((dom, di) => {
  dom.verbs.forEach((verb, vi) => {
    const idx = di * 10 + vi;
    const id = `F-${String(idx + 1).padStart(3, '0')}`;
    const title = `${dom.name}/${verb}`;
    const status = statusFor(idx);
    const modules = [`src/${dom.name}/${verb.replace(/-/g, '_')}.ts`];
    const acCount = (idx % 3) + 1;
    const acs = Array.from({length: acCount}, () => {
      const {ears, text} = earsFor(verb);
      const ac = {
        id: `AC-${String(acCounter).padStart(3, '0')}`,
        ears,
        text,
        test_refs: [`tests/${dom.name}/${verb}.test.ts`],
      };
      acCounter++;
      return ac;
    });
    features.push({id, title, status, modules, acceptance_criteria: acs});
  });
});

const masterMetadata = {
  schema: '0.1',
  project: {name: 'enterprise-saas', language: 'typescript'},
};

function emitMonolith(outDir: string): void {
  mkdirSync(outDir, {recursive: true});
  const monolith = {...masterMetadata, features};
  writeFileSync(join(outDir, 'spec.yaml'), stringify(monolith));
}

function emitSharded(outDir: string): void {
  const featuresDir = join(outDir, 'spec', 'features');
  mkdirSync(featuresDir, {recursive: true});
  writeFileSync(join(outDir, 'spec.yaml'), stringify(masterMetadata));
  for (const f of features) {
    writeFileSync(join(featuresDir, `${f.id}.yaml`), stringify(f));
  }
}

function emitMarkdownBrief(path: string): void {
  const lines: string[] = [
    '# Sample 04 — Enterprise SaaS backend (XL)',
    '',
    `100 features across 10 domains. Total ACs: ${features.reduce((s, f) => s + f.acceptance_criteria.length, 0)}.`,
    '',
    `Status distribution: ${features.filter((f) => f.status === 'done').length} done · ${features.filter((f) => f.status === 'in_progress').length} in_progress · ${features.filter((f) => f.status === 'planned').length} planned.`,
    '',
    '## Domains',
    '',
  ];
  for (const dom of DOMAINS) {
    lines.push(`### ${dom.name}`);
    for (const verb of dom.verbs) lines.push(`- ${dom.name}/${verb}`);
    lines.push('');
  }
  writeFileSync(path, lines.join('\n'));
}

const mode = process.argv[2];
const outDir = process.argv[3];
if (!mode || !outDir) {
  console.error('usage: tsx scripts/gen-xl-spec.ts <monolith|sharded|brief> <out-dir-or-path>');
  process.exit(2);
}
if (mode === 'monolith') {
  emitMonolith(outDir);
  console.log(`✓ wrote monolith spec.yaml to ${outDir}`);
} else if (mode === 'sharded') {
  emitSharded(outDir);
  console.log(`✓ wrote sharded spec to ${outDir}`);
} else if (mode === 'brief') {
  emitMarkdownBrief(outDir);
  console.log(`✓ wrote markdown brief to ${outDir}`);
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}
