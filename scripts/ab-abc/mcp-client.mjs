// Cladding · scripts/ab-abc/mcp-client.mjs — generic MCP stdio client driver
//
// Speaks JSON-RPC over stdio to any cladding engine (an arm's `serve.cjs`
// launcher, or a bare `clad serve`) and prints one JSON array of results. The
// A/B/C side-tables use it wherever a row must exercise the MCP surface rather
// than the CLI — tool catalogues, `clad_create_feature`, `clad_get_graph`.
//
// Usage:
//   node mcp-client.mjs --cwd <dir> --server "<command> [args...]" \
//                       --calls <calls.json> [--out <results.json>]
//
// calls.json is an array of:
//   {"type": "tools/list"} | {"type": "resources/list"} | {"type": "prompts/list"}
//   {"type": "readResource", "uri": "..."}
//   {"type": "tool", "name": "clad_list_features", "args": {...}}
//
// The SDK is loaded from the cladding repo checkout (client side only — it never
// touches the arm under test). Override with ABC_SDK_ROOT.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SDK_ROOT = process.env.ABC_SDK_ROOT ?? '/Users/qwerfunch/Developer/work/cladding';
const sdk = (rel) => path.join(SDK_ROOT, 'node_modules/@modelcontextprotocol/sdk/dist/esm', rel);

const {Client} = await import(sdk('client/index.js'));
const {StdioClientTransport} = await import(sdk('client/stdio.js'));

/** Parses `--flag value` pairs; throws on an unknown or missing argument. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined) {
      throw new Error(`bad argument near "${key}" — expected --flag value pairs`);
    }
    out[key.slice(2)] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
for (const required of ['cwd', 'server', 'calls']) {
  if (!args[required]) throw new Error(`missing --${required}`);
}

const calls = JSON.parse(fs.readFileSync(args.calls, 'utf8'));
if (!Array.isArray(calls)) throw new Error(`${args.calls} must hold a JSON array of calls`);

// The server command is one shell-free string: first token is the executable.
const serverTokens = args.server.trim().split(/\s+/);
const command = serverTokens[0];
const commandArgs = serverTokens.slice(1);
if (commandArgs.length === 0) commandArgs.push('serve');

const transport = new StdioClientTransport({
  command,
  args: commandArgs,
  cwd: args.cwd,
  env: {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    ...(process.env.CLADDING_KEYS_DIR ? {CLADDING_KEYS_DIR: process.env.CLADDING_KEYS_DIR} : {}),
  },
  stderr: 'pipe',
});

const client = new Client({name: 'abc-sidetable-driver', version: '0.0.0-abc'});
const results = [];

try {
  await client.connect(transport);
  results.push({type: 'connected', serverInfo: client.getServerVersion?.() ?? null});

  for (const call of calls) {
    try {
      if (call.type === 'tools/list') {
        results.push({type: call.type, result: await client.listTools()});
      } else if (call.type === 'resources/list') {
        results.push({type: call.type, result: await client.listResources()});
      } else if (call.type === 'prompts/list') {
        results.push({type: call.type, result: await client.listPrompts()});
      } else if (call.type === 'readResource') {
        results.push({type: call.type, uri: call.uri, result: await client.readResource({uri: call.uri})});
      } else if (call.type === 'tool') {
        const result = await client.callTool({name: call.name, arguments: call.args ?? {}});
        results.push({type: call.type, name: call.name, result});
      } else {
        results.push({type: call.type, error: 'unknown call type'});
      }
    } catch (error) {
      // A tool that refuses is data, not a driver crash — the side-table rows
      // that expect a refusal read this shape.
      results.push({type: call.type, name: call.name ?? null, error: String(error?.stack ?? error)});
    }
  }
} catch (error) {
  results.push({type: 'fatal', error: String(error?.stack ?? error)});
} finally {
  try {
    await client.close();
  } catch {
    // closing a already-dead transport is not a result
  }
}

const rendered = `${JSON.stringify(results, null, 2)}\n`;
if (args.out) fs.writeFileSync(args.out, rendered);
else process.stdout.write(rendered);
