#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-profiles.sh — the named check profiles (S-C1)
#
# The candidate replaces "which tier of checks do I want" with "what am I about
# to do": finishing a feature, pushing, cutting a release. The row asks whether
# those names carry different obligations — in particular whether the release
# profile really refuses to certify a tree with uncommitted work on it, since a
# release proved against bytes nobody committed is a release proved against
# nothing — and what happens when a name nobody defined is asked for.
#
# The harness's own dependency symlink shows up as an untracked path in every
# checkout, so it is excluded from git's view first: the row is about the
# engine's clean-tree rule, not about how the fixture was assembled.
#
# Called by sidetable.ts as: bash row-profiles.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ ! -x "$PREFIX/bin/clad" ]; then
  echo "no engine at $PREFIX/bin/clad — the row cannot run"
  exit 3
fi
export PATH="$PREFIX/bin:$PATH"
cd "$CWD"
echo "engine: $(command -v clad) $(clad --version)"

# The symlink the harness makes, and the event log a run writes, are the
# harness's own footprint. Neither is the change a release would be certifying.
grep -qx 'node_modules' .git/info/exclude 2>/dev/null || echo 'node_modules' >> .git/info/exclude
echo "worktree at start: $(git status --porcelain | wc -l | tr -d ' ') changed paths"

profile() {
  local name="$1"
  set +e
  clad check --profile "$name" --json > "$OUT/profile-$name-$ARM.json" 2>"$OUT/profile-$name-$ARM.err"
  local code=$?
  set -e
  echo "profile $name exit: $code"
  echo "profile $name stderr: $(head -c 300 "$OUT/profile-$name-$ARM.err" | tr '\n' ' ')"
}

if [ "$ARM" != "C" ]; then
  # The released engine has tiers, not profiles. Recording what it says when a
  # profile is asked for IS the comparison: the surface is simply not there.
  profile completion
  echo "released engine knows --profile: $(grep -qi "unknown option" "$OUT/profile-completion-$ARM.err" && echo no || echo yes)"
  set +e
  clad check --tier=pre-push --json > "$OUT/tier-prepush-$ARM.json" 2>"$OUT/tier-prepush-$ARM.err"
  echo "tier pre-push exit: $?"
  set -e
  exit 0
fi

# 1 — completion, on the tree as the fixture left it.
profile completion

# 2 — release, against a tree the gate has just made dirty. A passing gate
#     rewrites the sealed record of what it verified, so the completion run
#     above is itself the uncommitted change the release profile must refuse.
echo "worktree before the first release attempt:"
git status --porcelain | sed 's/^/  porcelain: /' | head -20
profile release
echo "first release attempt names the commit stage: $(grep -qiE 'stage_1\.4|commit|uncommitted|clean' "$OUT/profile-release-$ARM.json" "$OUT/profile-release-$ARM.err" && echo yes || echo no)"

# 3 — the same profile once the work is committed.
git add -A
git -c user.name=abc-harness -c user.email=abc-harness@example.invalid commit --quiet -m 'chore: commit what the completion profile wrote' || true
echo "worktree before the second release attempt: $(git status --porcelain | wc -l | tr -d ' ') changed paths"
set +e
clad check --profile release --json > "$OUT/profile-release-clean-$ARM.json" 2>"$OUT/profile-release-clean-$ARM.err"
RELEASE_CLEAN=$?
set -e
echo "release on a committed tree exit: $RELEASE_CLEAN"
echo "release on a committed tree stderr: $(head -c 300 "$OUT/profile-release-clean-$ARM.err" | tr '\n' ' ')"

# 4 — a profile nobody defined.
set +e
clad check --profile bogus --json > "$OUT/profile-bogus-$ARM.json" 2>"$OUT/profile-bogus-$ARM.err"
BOGUS=$?
set -e
echo "profile bogus exit: $BOGUS"
echo "profile bogus said: $(cat "$OUT/profile-bogus-$ARM.err" "$OUT/profile-bogus-$ARM.json" 2>/dev/null | head -c 300 | tr '\n' ' ')"
