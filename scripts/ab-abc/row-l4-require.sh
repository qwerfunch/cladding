#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-l4-require.sh — the refused L4 cycle (L0-6b)
#
# The counterpart to L0-10. Same fixture, same signing recipe, one difference:
# the workspace declares `independence_policy: require`, and the issuer who signs
# every claim is the same person the implementation is committed by. At L4 the
# receipts exist and are labelled `self-certified`, which is precisely what
# `require` refuses — so the completion must be turned down, and the refusal must
# say who to ask instead of only saying no.
#
# L0-6 records the other half of the same policy: at L2 the kernel labels a
# completed cycle `not-applicable`, because that profile asks for no human review
# at all, and `require` has nothing to refuse. Together the two rows say what the
# policy means at each level rather than leaving the L2 pass looking like a hole.
#
# Called by sidetable.ts as: bash row-l4-require.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ABC_L4_POLICY=require exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/row-l4.sh" "$@"
