#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-mcp-signoff.sh — a verified sign-off asked for
# over MCP by a client that cannot ask a human (S-D7)
#
# The CLI degrades a headless `--verified` run to HUMAN_REQUIRED (row S-D2). The
# same promise has to hold on the other surface, and for the same reason: a host
# asks for a verified receipt through an elicitation form, and a client with no
# elicitation support cannot show one. The driver here deliberately advertises no
# elicitation capability, so a receipt produced anyway would be a receipt no
# human ever saw.
#
# Arm B records the comparison the honest way: 0.9.4 has no such tool, which the
# row shows by listing the catalogue rather than by asserting an absence.
#
# Called by sidetable.ts as: bash row-mcp-signoff.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORD="$ABC_ROOT/sidetable/inprogress"
BIN="$ABC_ROOT/prefix-$ARM/bin/clad"

export PATH="$ABC_ROOT/prefix-$ARM/bin:$PATH"
export CLADDING_KEYS_DIR="$OUT/keys"
echo "engine: $BIN $("$BIN" --version 2>&1)"

# Arm B: the catalogue is the whole answer.
if [ "$ARM" != "C" ]; then
  printf '[{"type": "tools/list"}]\n' > "$OUT/list.calls.json"
  node "$HARNESS/mcp-client.mjs" --cwd "$CWD" --server "$BIN serve" \
    --calls "$OUT/list.calls.json" --out "$OUT/list-b.json" > /dev/null 2>> "$OUT/mcp.log"
  node -e '
    const fs = require("node:fs");
    const results = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const listed = results.find((entry) => entry.type === "tools/list");
    const names = (listed?.result?.tools ?? []).map((tool) => tool.name);
    process.stdout.write(`tools advertised: ${names.length}\n`);
    process.stdout.write(`clad_signoff in the catalogue: ${names.includes("clad_signoff") ? "yes" : "no"}\n`);
  ' "$OUT/list-b.json"
  echo "not applicable: signing over MCP is a 0.2 surface"
  exit 0
fi

FEATURE="$(cat "$RECORD/C.feature")"
CRITERION="$(head -1 "$RECORD/C.criteria")"
echo "feature $FEATURE, criterion $CRITERION"

rm -rf "$CLADDING_KEYS_DIR"
( cd "$CWD" && clad key create --issuer alice ) >> "$OUT/mcp.log" 2>&1
echo "issuer alice registered: exit $?"

node -e '
  const fs = require("node:fs");
  const [out, feature, criterion] = process.argv.slice(1);
  fs.writeFileSync(out, `${JSON.stringify([
    {type: "tools/list"},
    {type: "tool", name: "clad_signoff", args: {feature, claim: "audit", criterion, result: "pass", verified: true, issuer: "alice"}},
  ], null, 2)}\n`);
' "$OUT/signoff.calls.json" "$FEATURE" "$CRITERION"

node "$HARNESS/mcp-client.mjs" --cwd "$CWD" --server "$BIN serve" \
  --calls "$OUT/signoff.calls.json" --out "$OUT/signoff.mcp.json" > /dev/null 2>> "$OUT/mcp.log"
echo "driver exit: $?"

node -e '
  const fs = require("node:fs");
  const results = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const listed = results.find((entry) => entry.type === "tools/list");
  const names = (listed?.result?.tools ?? []).map((tool) => tool.name);
  process.stdout.write(`tools advertised: ${names.length}\n`);
  process.stdout.write(`clad_signoff in the catalogue: ${names.includes("clad_signoff") ? "yes" : "no"}\n`);
  const call = results.find((entry) => entry.type === "tool" && entry.name === "clad_signoff");
  const structured = call?.result?.structuredContent;
  const text = call?.result?.content?.[0]?.text ?? "";
  const code = structured?.code ?? (text.match(/HUMAN_REQUIRED/) ? "HUMAN_REQUIRED" : "(none)");
  process.stdout.write(`clad_signoff code: ${code}\n`);
  process.stdout.write(`clad_signoff isError: ${call?.result?.isError === true}\n`);
  process.stdout.write(`clad_signoff said: ${(structured?.message ?? text).slice(0, 240).replace(/\s+/g, " ")}\n`);
' "$OUT/signoff.mcp.json"

echo "receipts written by the elicitation-less client: $(find "$CWD/spec/evidence" -name '*.yaml' 2> /dev/null | wc -l | tr -d ' ')"
