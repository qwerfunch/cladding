#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-l4.sh — the L4 replay row (L0-10)
#
# Replays the documented L4 recipe on a project that is still inside its cycle:
# confirm that a strict pre-push is honestly unresolved before any human receipt
# exists, sign the audit claim for every criterion and the feature-scoped UAT
# claim through a scripted pseudo-terminal, complete the feature, and confirm the
# gate then goes green. The signing prompts are interactive by design, so this
# row needs `expect`; without it the row records not-run rather than guessing.
#
# Three things the first run got wrong are fixed here:
#   · it ran on a project already completed at L2 and only then raised the level,
#     so the completion never published an L4 attestation row. The fixture is now
#     the in-progress one and `clad done` runs inside this row.
#   · it signed the audit claim for one criterion out of three, leaving the other
#     two unobserved.
#   · it passed `--criterion` to the UAT claim, which is feature-scoped and
#     refuses a criterion outright — so no UAT receipt existed at all.
#
# Called by sidetable.ts as: bash row-l4.sh <arm> <cwd> <artifact-dir>
#
# Two modes, chosen by ABC_L4_POLICY, because both questions need the identical
# replay and differ only in what the completion is allowed to do:
#   default   the documented L4 recipe — signing every claim earns a green gate
#             and a completed feature (row L0-10).
#   require   the same replay on a workspace whose `independence_policy` is
#             `require`, where the only signer is also the only author. The
#             completion must be REFUSED and must say who to ask instead
#             (row L0-6b); row-l4-require.sh is the entry point that sets it.
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
PREFIX="$ABC_ROOT/prefix-$ARM"
RECORD="$ABC_ROOT/sidetable/inprogress"

if [ "$ARM" != "C" ]; then
  echo "not applicable: assurance levels are a candidate surface"
  exit 0
fi
if ! command -v expect > /dev/null; then
  echo "not run: expect is not installed, and the signing prompts are interactive"
  exit 3
fi
if [ ! -f "$RECORD/C.feature" ]; then
  echo "no in-progress L4 fixture at $RECORD — re-run --bootstrap"
  exit 3
fi

export PATH="$PREFIX/bin:$PATH"
# The key directory is the row's own, never the caller's: an inherited
# CLADDING_KEYS_DIR would point at real signing keys, and the line below deletes
# whatever it names. The artifact directory also survives a re-run while the
# row's workspace does not, so a keypair left behind by the previous run would
# meet a trust registry that no longer lists it and the signing would fail for a
# harness reason. Both problems end the same way: this row's keys, regenerated
# per run, under this row's artifact directory.
export CLADDING_KEYS_DIR="$OUT/keys"
rm -rf "$CLADDING_KEYS_DIR"
mkdir -p "$CLADDING_KEYS_DIR"
echo "engine: $(command -v clad) $(clad --version)"

FEATURE="$(cat "$RECORD/C.feature")"
ISSUER="$(cd "$CWD" && git config user.name)"
POLICY="${ABC_L4_POLICY:-default}"
echo "feature $FEATURE, issuer $ISSUER, policy mode $POLICY"
grep -n 'assurance_level' "$CWD/spec.yaml" | head -1
# Printed in BOTH modes: `not-applicable` and a policy that never landed look
# identical from the outside, so the row shows the line it depends on rather
# than trusting that a mutation ran.
grep -n 'independence_policy' "$CWD/spec.yaml" | head -1 || echo "no independence_policy line — the project default (label) applies"
if [ "$POLICY" = "require" ] && ! grep -q 'independence_policy: require' "$CWD/spec.yaml"; then
  echo "the require mutation did not land in $CWD/spec.yaml — this row would measure the default policy"
  exit 2
fi

# The issuer name equals the committing author byte for byte, so the independence
# label reads `self-certified` — which is the honest label for this fixture and
# the condition the runbook records for reproducing it.
( cd "$CWD" && clad key create --issuer "$ISSUER" ) >> "$OUT/l4.log" 2>&1 || true

set +e
( cd "$CWD" && clad check --tier=pre-push --strict --json ) > "$OUT/l4-before-signing.json" 2>> "$OUT/l4.log"
BEFORE=$?
set -e
echo "strict pre-push BEFORE signing: exit $BEFORE (unresolved is the honest shape here)"

cat > "$OUT/sign.exp" <<'EXP'
#!/usr/bin/expect -f
set timeout 60
set claim [lindex $argv 0]
set feature [lindex $argv 1]
set dir [lindex $argv 2]
set issuer [lindex $argv 3]
set criterion [lindex $argv 4]
cd $dir
if {$criterion eq ""} {
  spawn clad signoff $feature --claim $claim --result pass --verified --issuer $issuer
} else {
  spawn clad signoff $feature --claim $claim --criterion $criterion --result pass --verified --issuer $issuer
}
expect -re "feature id.*: "
send "$feature\r"
expect eof
EXP
chmod +x "$OUT/sign.exp"

# An audit receipt is per criterion; a partial matrix stays unobserved, so every
# criterion in the feature is signed.
while read -r CRITERION; do
  [ -n "$CRITERION" ] || continue
  expect "$OUT/sign.exp" audit "$FEATURE" "$CWD" "$ISSUER" "$CRITERION" >> "$OUT/l4.log" 2>&1 || true
  echo "signed audit: $CRITERION"
done < "$RECORD/C.criteria"

# A UAT receipt is feature-scoped and refuses a criterion argument.
expect "$OUT/sign.exp" uat "$FEATURE" "$CWD" "$ISSUER" "" >> "$OUT/l4.log" 2>&1 || true
echo "signed uat: feature-scoped"

set +e
( cd "$CWD" && clad check --tier=pre-push --strict --json ) > "$OUT/l4-after-signing.json" 2>> "$OUT/l4.log"
AFTER_SIGN=$?
set -e
echo "strict pre-push AFTER signing, BEFORE completion: exit $AFTER_SIGN"

set +e
( cd "$CWD" && clad done "$FEATURE" ) > "$OUT/l4-done.txt" 2>&1
DONE_EXIT=$?
set -e
echo "completion exit: $DONE_EXIT"
cat "$OUT/l4-done.txt"
echo

if [ "$POLICY" = "require" ]; then
  # The whole row: a self-signed L4 cycle under `require` must not complete, and
  # the refusal must name the remedy rather than only the verdict. Both halves
  # are asserted here, so the row's own exit code carries the finding.
  PHRASE="Ask a registered issuer other than the implementation authors for a verified review"
  if [ "$DONE_EXIT" -eq 0 ]; then
    echo "FAIL: the completion succeeded under independence_policy: require with a self-signed receipt"
    exit 2
  fi
  if ! grep -qF "$PHRASE" "$OUT/l4-done.txt"; then
    echo "FAIL: the refusal does not name a registered issuer as the remedy"
    exit 2
  fi
  grep -oF "$PHRASE" "$OUT/l4-done.txt" | head -1
  echo "refused as required: completion exit $DONE_EXIT, remedy named"
  set +e
  ( cd "$CWD" && clad check --tier=pre-push --strict --json ) > "$OUT/l4-after-refusal.json" 2>> "$OUT/l4.log"
  AFTER_REFUSAL=$?
  set -e
  echo "strict pre-push AFTER the refusal: exit $AFTER_REFUSAL (the feature is still open)"
  exit 0
fi

set +e
( cd "$CWD" && clad check --tier=pre-push --strict --json ) > "$OUT/l4-after-done.json" 2>> "$OUT/l4.log"
AFTER=$?
set -e
echo "strict pre-push AFTER completion: exit $AFTER (0 is the row's expectation)"
node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const unresolved = (report.obligations ?? []).filter((o) => o.state !== "pass");
  process.stdout.write(`achieved ${report.achieved_assurance_level} of configured ${report.configured_assurance_level}; independence ${report.independence}\n`);
  process.stdout.write(unresolved.length === 0
    ? "every obligation passed\n"
    : `unresolved obligations: ${unresolved.map((o) => `${o.obligation}/${o.state}${o.reason ? `(${o.reason})` : ""}`).join(", ")}\n`);
' "$OUT/l4-after-done.json" || true
