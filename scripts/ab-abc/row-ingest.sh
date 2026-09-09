#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-ingest.sh — ingesting a portable receipt (S-D5)
#
# A receipt is portable: signed once, on one machine, and carried into the
# workspace it talks about. This row asks what `clad ingest-receipt` does with
# four of them, and reads the verdict the verb records for each — assurance
# verified | asserted | invalid, plus the reason — because an exit code alone
# cannot tell "accepted" from "kept, pending". Each pass targets a DIFFERENT
# criterion, so no receipt's answer can be borrowed from another's evidence:
#
#   control     criterion 1's own valid receipt, taken out of the workspace and
#               put straight back through the verb. Without this pass a refusal
#               and a verb that verifies nothing at all look identical, and the
#               right reading of the other three depends on which one it is.
#   idempotent  the same valid receipt a second time — create-only, no overwrite.
#   tampered    criterion 2's receipt with one character of its signature flipped,
#               and it is the ONLY receipt that criterion has.
#   stranger    criterion 3 signed by `mallory`, an issuer registered in a second
#               workspace and unknown to this one's committed registry.
#
# Called by sidetable.ts as: bash row-ingest.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
RECORD="$ABC_ROOT/sidetable/inprogress"

if [ "$ARM" != "C" ]; then
  echo "not applicable: portable receipts are a 0.2 surface"
  exit 0
fi
if ! command -v expect > /dev/null; then
  echo "not run: expect is not installed, and signing needs a terminal"
  exit 3
fi
if [ ! -f "$RECORD/C.criteria" ]; then
  echo "no in-progress fixture record at $RECORD — re-run --bootstrap"
  exit 3
fi

export PATH="$ABC_ROOT/prefix-C/bin:$PATH"
echo "engine: $(command -v clad) $(clad --version)"

FEATURE="$(cat "$RECORD/C.feature")"
AC1="$(sed -n '1p' "$RECORD/C.criteria")"
AC2="$(sed -n '2p' "$RECORD/C.criteria")"
AC3="$(sed -n '3p' "$RECORD/C.criteria")"
echo "feature $FEATURE; criteria $AC1 (control), $AC2 (tampered), $AC3 (stranger)"

cat > "$OUT/ingest-sign.exp" <<'EXP'
#!/usr/bin/expect -f
set timeout 60
set feature [lindex $argv 0]
set dir [lindex $argv 1]
set issuer [lindex $argv 2]
set criterion [lindex $argv 3]
cd $dir
spawn clad signoff $feature --claim audit --criterion $criterion --result pass --verified --issuer $issuer
expect -re "feature id.*: "
send "$feature\r"
expect eof
EXP

# Whether the workspace's human obligations are settled at all. On a fixture
# still inside its cycle this is project-scoped rather than per criterion, so it
# is a background reading, not the row's verdict.
audit_states() {
  local label="$1"
  ( cd "$CWD" && clad check --profile push --strict --json ) > "$OUT/gate-$label.json" 2>> "$OUT/ingest.log"
  local gate=$?
  node -e '
    const fs = require("node:fs");
    const [path, label, gate] = process.argv.slice(1);
    const report = JSON.parse(fs.readFileSync(path, "utf8"));
    const audit = (report.obligations ?? []).filter((o) => o.obligation === "stage_4.1");
    const shown = audit
      .map((o) => `${String(o.subject).split("/").pop()}=${o.state}${o.reason ? `(${o.reason})` : ""}`)
      .sort()
      .join(", ");
    process.stdout.write(`${label}: gate exit ${gate}; audit ${shown || "(no audit obligation)"}\n`);
  ' "$OUT/gate-$label.json" "$label" "$gate"
}

# What the VERB says about the receipt it just took, which is a finer answer than
# its exit code: assurance verified|asserted|invalid, and the reason.
verdict_of() {
  node -e '
    const fs = require("node:fs");
    const [path, label] = process.argv.slice(1);
    const result = JSON.parse(fs.readFileSync(path, "utf8"));
    const v = result.verification ?? {};
    process.stdout.write(`${label} verdict: assurance ${v.assurance ?? "(none)"}, currentness ${v.currentness ?? "(none)"}, reason ${v.reason ?? "(none)"}\n`);
  ' "$1" "$2"
}

receipts() { find "$CWD/spec/evidence" -name '*.yaml' 2> /dev/null | wc -l | tr -d ' '; }
receipt_for() { find "$CWD/spec/evidence" -name '*.yaml' -newer "$1" 2> /dev/null | head -1; }

export CLADDING_KEYS_DIR="$OUT/keys"
rm -rf "$CLADDING_KEYS_DIR"
( cd "$CWD" && clad key create --issuer alice ) >> "$OUT/ingest.log" 2>&1
echo "issuer alice registered: exit $?"
# On a fixture still inside its cycle the audit obligation is project-scoped, so
# these lines say whether the workspace's human evidence is settled at all —
# they are not a per-criterion verdict, and the row does not read them as one.
audit_states baseline

# ── 1. control: a valid receipt, removed and put back through the verb ──────
touch "$OUT/.mark1"
expect "$OUT/ingest-sign.exp" "$FEATURE" "$CWD" alice "$AC1" >> "$OUT/ingest.log" 2>&1
R1="$(receipt_for "$OUT/.mark1")"
if [ -z "$R1" ]; then
  echo "FAIL: signing $AC1 left no receipt — the row has nothing to ingest"
  exit 2
fi
echo "receipt for $AC1 written: ${R1#"$CWD/"} ($(wc -c < "$R1" | tr -d ' ') bytes)"
audit_states signed
cp "$R1" "$OUT/valid.yaml"
rm -f "$R1"
audit_states removed
( cd "$CWD" && clad ingest-receipt "$OUT/valid.yaml" --json ) > "$OUT/ingest-control.json" 2>&1
echo "control ingest exit: $?"
verdict_of "$OUT/ingest-control.json" control
head -c 220 "$OUT/ingest-control.json" | tr -s '\n' ' '
echo
audit_states reingested

# ── 2. the same receipt again ───────────────────────────────────────────────
BEFORE_COUNT="$(receipts)"
( cd "$CWD" && clad ingest-receipt "$OUT/valid.yaml" --json ) > "$OUT/ingest-again.json" 2>&1
echo "second ingest of the same receipt exit: $?"
verdict_of "$OUT/ingest-again.json" second-ingest
head -c 220 "$OUT/ingest-again.json" | tr -s '\n' ' '
echo
echo "receipt files $BEFORE_COUNT → $(receipts)"

# ── 3. tampered: the only receipt criterion 2 has ───────────────────────────
touch "$OUT/.mark2"
expect "$OUT/ingest-sign.exp" "$FEATURE" "$CWD" alice "$AC2" >> "$OUT/ingest.log" 2>&1
R2="$(receipt_for "$OUT/.mark2")"
if [ -z "$R2" ]; then
  echo "FAIL: signing $AC2 left no receipt"
  exit 2
fi
cp "$R2" "$OUT/tampered.yaml"
rm -f "$R2"
python3 - "$OUT/tampered.yaml" <<'TAMPER' || exit 2
import json, sys
path = sys.argv[1]
receipt = json.load(open(path))
proof = receipt['issuer_proof']
# One character of the signature, and nothing else: a structural edit would test
# the parser instead of the signature.
receipt['issuer_proof'] = proof[:3] + ('B' if proof[3] != 'B' else 'C') + proof[4:]
open(path, 'w').write(json.dumps(receipt, separators=(',', ':'), sort_keys=True))
print(f'tampered one character of the {len(proof)}-character issuer_proof, nothing else')
TAMPER
( cd "$CWD" && clad ingest-receipt "$OUT/tampered.yaml" --json ) > "$OUT/ingest-tampered.json" 2>&1
echo "tampered ingest exit: $?"
verdict_of "$OUT/ingest-tampered.json" tampered
head -c 220 "$OUT/ingest-tampered.json" | tr -s '\n' ' '
echo
audit_states tampered

# ── 4. a stranger's signature on criterion 3 ────────────────────────────────
STRANGER="$CWD/.stranger"
rm -rf "$STRANGER"
mkdir -p "$STRANGER"
rsync -a --exclude node_modules --exclude .stranger "$CWD/" "$STRANGER/" >> "$OUT/ingest.log" 2>&1
rm -rf "$STRANGER/spec/evidence"
(
  export CLADDING_KEYS_DIR="$OUT/stranger-keys"
  rm -rf "$CLADDING_KEYS_DIR"
  cd "$STRANGER" && clad key create --issuer mallory
) >> "$OUT/ingest.log" 2>&1
CLADDING_KEYS_DIR="$OUT/stranger-keys" expect "$OUT/ingest-sign.exp" "$FEATURE" "$STRANGER" mallory "$AC3" >> "$OUT/ingest.log" 2>&1
FOREIGN="$(find "$STRANGER/spec/evidence" -name '*.yaml' | head -1)"
if [ -z "$FOREIGN" ]; then
  echo "FAIL: the stranger workspace produced no receipt"
  exit 2
fi
cp "$FOREIGN" "$OUT/foreign.yaml"
if grep -q 'mallory' "$CWD/spec/trust/issuers.yaml"; then
  echo "WARNING: mallory is registered here too — the row would measure nothing"
else
  echo "this workspace's registry does not carry mallory"
fi
( cd "$CWD" && clad ingest-receipt "$OUT/foreign.yaml" --json ) > "$OUT/ingest-foreign.json" 2>&1
echo "foreign-issuer ingest exit: $?"
verdict_of "$OUT/ingest-foreign.json" foreign
head -c 220 "$OUT/ingest-foreign.json" | tr -s '\n' ' '
echo
audit_states foreign
echo "receipt files at the end: $(receipts)"
rm -rf "$STRANGER"
