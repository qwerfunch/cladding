#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-key.sh — the issuer key lifetime row (S-D1)
#
# 0.10.0 signs receipts with a file-held Ed25519 issuer key whose public half is
# committed to the workspace's own trust registry. Four things have to be true
# before any receipt row below can be believed, and this row asks all four in one
# pass: the private key never lands in the workspace and is readable only by its
# owner, the registry gains exactly one issuer, `key list` says this machine
# holds that key, and registering the same issuer twice is refused rather than
# silently overwriting the first registration.
#
# The comparison arm is the absence of the surface: 0.9.4 has no `key` verb at
# all, so arm B records the unknown-command answer rather than skipping.
#
# Called by sidetable.ts as: bash row-key.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
export PATH="$ABC_ROOT/prefix-$ARM/bin:$PATH"
echo "engine: $(command -v clad) $(clad --version 2>&1)"

if [ "$ARM" != "C" ]; then
  # Recorded, not skipped: "no such verb" is this row's B-side answer.
  ( cd "$CWD" && clad key list ) > "$OUT/key-b.txt" 2>&1
  echo "B key list exit: $?"
  head -c 300 "$OUT/key-b.txt"
  echo
  echo "not applicable: the issuer trust registry is a 0.2 surface"
  exit 0
fi

# The row's own key directory, never the caller's — the real ~/.cladding/keys
# must not be read, written, or removed by a table row.
export CLADDING_KEYS_DIR="$OUT/keys"
rm -rf "$CLADDING_KEYS_DIR"

ISSUER="alice"
( cd "$CWD" && clad key create --issuer "$ISSUER" --json ) > "$OUT/key-create.json" 2> "$OUT/key-create.err"
echo "key create exit: $?"
head -c 400 "$OUT/key-create.json"
echo

if [ ! -d "$CLADDING_KEYS_DIR" ]; then
  echo "FAIL: the key directory $CLADDING_KEYS_DIR was not created"
  exit 2
fi
echo "keys dir mode: $(stat -f '%Lp' "$CLADDING_KEYS_DIR")"
for f in "$CLADDING_KEYS_DIR"/*; do
  [ -f "$f" ] || continue
  echo "key file $(basename "$f") mode: $(stat -f '%Lp' "$f")"
done
echo "private key material inside the workspace: $(find "$CWD" -name '*.key' -o -name '*.pem' | wc -l | tr -d ' ') files"

REG="$CWD/spec/trust/issuers.yaml"
if [ ! -f "$REG" ]; then
  echo "FAIL: no committed trust registry at spec/trust/issuers.yaml"
  exit 2
fi
echo "registry issuers: $(grep -c '^  - issuer:' "$REG" | tr -d ' ')"
grep -n 'issuer:\|issuer_key_id\|spki_der' "$REG" | head -5

( cd "$CWD" && clad key list ) > "$OUT/key-list.txt" 2>&1
echo "key list exit: $?"
cat "$OUT/key-list.txt"

# Re-registering the same issuer must be refused: a second key under one name
# would make every earlier receipt ambiguous.
( cd "$CWD" && clad key create --issuer "$ISSUER" ) > "$OUT/key-recreate.txt" 2>&1
RE=$?
echo "second key create for the same issuer exit: $RE"
head -c 300 "$OUT/key-recreate.txt"
echo
if [ "$RE" -eq 0 ]; then
  echo "FAIL: the second registration of the same issuer succeeded"
  exit 2
fi
echo "registry issuers after the refusal: $(grep -c '^  - issuer:' "$REG" | tr -d ' ')"
