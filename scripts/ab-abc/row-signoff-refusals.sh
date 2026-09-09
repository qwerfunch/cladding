#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-signoff-refusals.sh — the four refusal paths of a
# verified sign-off (S-D2)
#
# A verified receipt is the only evidence 0.10.0 will call human. That claim is
# worth exactly as much as the paths that refuse to produce one, so this row
# drives all four in a row and shows what each left behind:
#
#   1 no terminal          a headless `--verified` run cannot ask anyone, so it
#                          must degrade to HUMAN_REQUIRED and write no receipt.
#   2 the wrong feature id  the prompt asks the human to re-type the id; typing
#                          another feature's id must refuse, not sign.
#   3 an unregistered issuer  a name with no entry in the committed registry
#                          cannot sign, whatever the terminal says.
#   4 no --verified        the asserted path still records history — it is
#                          allowed, and it must not leave a receipt behind.
#
# The evidence directory is inspected after every path, because "was refused"
# and "was refused but wrote the receipt anyway" read identically in stdout.
#
# Called by sidetable.ts as: bash row-signoff-refusals.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
RECORD="$ABC_ROOT/sidetable/inprogress"

if [ "$ARM" != "C" ]; then
  echo "not applicable: verified receipts are a 0.2 surface"
  exit 0
fi
if ! command -v expect > /dev/null; then
  echo "not run: expect is not installed, and path 2 needs a terminal to type into"
  exit 3
fi
if [ ! -f "$RECORD/C.feature" ]; then
  echo "no in-progress fixture record at $RECORD — re-run --bootstrap"
  exit 3
fi

export PATH="$ABC_ROOT/prefix-C/bin:$PATH"
export CLADDING_KEYS_DIR="$OUT/keys"
rm -rf "$CLADDING_KEYS_DIR"
echo "engine: $(command -v clad) $(clad --version)"

FEATURE="$(cat "$RECORD/C.feature")"
CRITERION="$(head -1 "$RECORD/C.criteria")"
echo "feature $FEATURE, criterion $CRITERION"

# Counts receipt files, so a refusal that wrote one is visible.
receipts() {
  find "$CWD/spec/evidence" -name '*.yaml' 2> /dev/null | wc -l | tr -d ' '
}
echo "receipts before anything: $(receipts)"

( cd "$CWD" && clad key create --issuer alice --json ) > "$OUT/key.json" 2>&1
echo "issuer alice registered: exit $?"

# 1 — no terminal at all.
( cd "$CWD" && clad signoff "$FEATURE" --claim audit --criterion "$CRITERION" --result pass \
    --verified --issuer alice --json < /dev/null ) > "$OUT/no-tty.json" 2> "$OUT/no-tty.err"
echo "no-tty exit: $?"
grep -o 'HUMAN_REQUIRED' "$OUT/no-tty.json" | head -1 || echo "no HUMAN_REQUIRED in the headless result"
head -c 300 "$OUT/no-tty.json"
echo
echo "receipts after the headless attempt: $(receipts)"

# 2 — a terminal, and the wrong id typed into it.
cat > "$OUT/wrong-id.exp" <<'EXP'
#!/usr/bin/expect -f
set timeout 60
set feature [lindex $argv 0]
set dir [lindex $argv 1]
set criterion [lindex $argv 2]
cd $dir
spawn clad signoff $feature --claim audit --criterion $criterion --result pass --verified --issuer alice
expect -re "feature id.*: "
send "F-00000000\r"
expect eof
catch wait result
exit [lindex $result 3]
EXP
expect "$OUT/wrong-id.exp" "$FEATURE" "$CWD" "$CRITERION" > "$OUT/wrong-id.txt" 2>&1
echo "wrong-id exit: $?"
# The interactive path prints prose rather than a JSON code, so the refusal is
# pinned on the sentence the human actually reads.
if grep -qF "needs a human to re-enter the feature id" "$OUT/wrong-id.txt"; then
  echo "wrong-id refusal: a human must re-enter the feature id — only asserted history was recorded"
else
  echo "wrong-id: NO refusal sentence in the transcript"
fi
tail -c 300 "$OUT/wrong-id.txt"
echo
echo "receipts after the mistyped confirmation: $(receipts)"

# 3 — an issuer the committed registry does not carry.
cat > "$OUT/unregistered.exp" <<'EXP'
#!/usr/bin/expect -f
set timeout 60
set feature [lindex $argv 0]
set dir [lindex $argv 1]
set criterion [lindex $argv 2]
cd $dir
spawn clad signoff $feature --claim audit --criterion $criterion --result pass --verified --issuer mallory
expect {
  -re "feature id.*: " { send "$feature\r"; exp_continue }
  eof
}
catch wait result
exit [lindex $result 3]
EXP
expect "$OUT/unregistered.exp" "$FEATURE" "$CWD" "$CRITERION" > "$OUT/unregistered.txt" 2>&1
echo "unregistered-issuer exit: $?"
if grep -qF "is not registered in spec/trust/issuers.yaml" "$OUT/unregistered.txt"; then
  echo "unregistered-issuer refusal: mallory is not registered in spec/trust/issuers.yaml"
else
  echo "unregistered-issuer: NO registry refusal in the transcript"
fi
tail -c 300 "$OUT/unregistered.txt"
echo
echo "receipts after the unregistered issuer: $(receipts)"

# 4 — the asserted path, which is allowed and must stay history-only.
( cd "$CWD" && clad signoff "$FEATURE" --claim audit --criterion "$CRITERION" --result pass --json ) \
  > "$OUT/asserted.json" 2> "$OUT/asserted.err"
echo "asserted exit: $?"
head -c 300 "$OUT/asserted.json"
echo
echo "receipts after the asserted sign-off: $(receipts)"
echo "audit-log signoff events: $(grep -c 'signoff' "$CWD/.cladding/audit.log.jsonl" 2> /dev/null || echo 0)"
