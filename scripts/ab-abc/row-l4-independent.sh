#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-l4-independent.sh — the independent L4 cycle (S-D4)
#
# The positive half of row L0-6b. Same fixture, same replay, same `require`
# policy — one difference: the registered issuer who signs every claim is not the
# person the implementation is committed by. The completion must therefore be
# allowed, and the gate must label it `independent` rather than `self-certified`.
#
# What that label actually checks is worth saying plainly, because the row is
# also the evidence for the limit: cladding compares the issuer name against the
# committing author's `git user.name` as strings. A second name on the same
# person's machine reads as independent. The label records who signed under which
# name, not that two humans exist.
#
# Called by sidetable.ts as: bash row-l4-independent.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ABC_L4_POLICY=require ABC_L4_ISSUER="${ABC_L4_ISSUER:-alice}" \
  exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/row-l4.sh" "$@"
