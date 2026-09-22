#!/usr/bin/env bash
#
# Standalone test for the destination-validation logic in action.yml.
#
# action.yml is a composite GitHub Action, so its run: block cannot be invoked
# directly here. This script REPLICATES the exact validation sequence (steps 2-3
# of the run: block: canonicalize, require strictly-below-workspace, reject
# symlinked path components) as a function and asserts it accepts a normal nested
# destination and rejects the traversal/root/symlink attacks the review found.
#
# Keep validate_destination() byte-aligned with action.yml. Run:
#   bash scripts/test-action-destination.sh   # exit 0 = pass
set -euo pipefail

# The action runs on Ubuntu, where GNU realpath provides -m (missing paths are
# allowed) and -s (do not resolve symlinks). Keep the validation below identical
# while allowing this focused harness to run on macOS's BSD realpath as well.
if ! realpath -ms / >/dev/null 2>&1; then
  realpath() {
    if [[ "$#" -eq 2 && ( "$1" == "-m" || "$1" == "-ms" ) ]]; then
      python3 - "$1" "$2" <<'PY'
import os
import sys

option, path = sys.argv[1:]
canonical = os.path.abspath(path) if option == "-ms" else os.path.realpath(path)
print(canonical)
PY
      return
    fi
    command realpath "$@"
  }
fi

# --- Extracted validation: mirrors action.yml steps 2-3. -------------------
# Consumes GITHUB_WORKSPACE and SHRUBBERY_ACTION_DESTINATION from the env.
# Exits 0 if the destination is a safe, strictly-below, non-symlinked target;
# non-zero (with a diagnostic on stderr) otherwise.
validate_destination() {
  local workspace workspace_lexical destination probe
  workspace="$(realpath -m "$GITHUB_WORKSPACE")"
  workspace_lexical="$(realpath -ms "$GITHUB_WORKSPACE")"
  destination="$(realpath -m "$SHRUBBERY_ACTION_DESTINATION")"

  if [[ "$destination" == "$workspace" ]]; then
    echo "reject: destination == workspace root" >&2
    return 1
  fi
  case "$destination" in
    "$workspace"/*) ;;
    *)
      echo "reject: destination not below workspace" >&2
      return 1
      ;;
  esac

  probe="$(realpath -ms "$SHRUBBERY_ACTION_DESTINATION")"
  while :; do
    [[ "$probe" == "$workspace_lexical" ]] && break
    if [[ -L "$probe" ]]; then
      echo "reject: symlinked path component: $probe" >&2
      return 1
    fi
    [[ "$probe" == "/" || "$probe" == "." ]] && break
    probe="$(dirname "$probe")"
  done
  return 0
}
# ---------------------------------------------------------------------------

fail=0

# Assert validate_destination REJECTS the given destination (non-zero exit).
assert_reject() {
  local label="$1" dest="$2"
  if GITHUB_WORKSPACE="$WS" SHRUBBERY_ACTION_DESTINATION="$dest" \
      validate_destination >/dev/null 2>&1; then
    echo "FAIL (should REJECT): $label  [$dest]"
    fail=1
  else
    echo "ok   reject: $label"
  fi
}

# Assert validate_destination ACCEPTS the given destination (zero exit).
assert_accept() {
  local label="$1" dest="$2"
  if GITHUB_WORKSPACE="$WS" SHRUBBERY_ACTION_DESTINATION="$dest" \
      validate_destination >/dev/null 2>&1; then
    echo "ok   accept: $label"
  else
    echo "FAIL (should ACCEPT): $label  [$dest]"
    fail=1
  fi
}

# Sandbox: a fake workspace plus an out-of-tree directory for symlink targets.
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
WS="$ROOT/workspace"
OUTSIDE="$ROOT/outside"
mkdir -p "$WS" "$OUTSIDE"

# A symlinked parent whose target stays INSIDE the workspace (canonicalization
# alone would pass it; the explicit symlink walk must still reject it).
mkdir -p "$WS/realdir"
ln -s "$WS/realdir" "$WS/linkdir"

# A symlinked parent whose target ESCAPES the workspace.
ln -s "$OUTSIDE" "$WS/escape"

# Symlinked leaf destinations exercise the destructive case directly: without
# checking the leaf, canonicalization makes rm -rf target the link's referent.
mkdir -p "$WS/leaf-target"
ln -s "$WS/leaf-target" "$WS/leaf-inside"
ln -s "$OUTSIDE" "$WS/leaf-escape"

# This alias catches a subtler boundary-ordering bug: resolving it before the
# symlink test makes the parent appear to be the workspace and ends the walk.
ln -s "$WS" "$WS/workspace-alias"

# --- Rejections -------------------------------------------------------------
assert_reject "destination == workspace root"      "$WS"
assert_reject "trailing-slash workspace root"      "$WS/"
assert_reject ".. traversal escaping workspace"    "$WS/sub/../.."
assert_reject ".. traversal back to workspace"     "$WS/sub/.."
assert_reject "sibling outside workspace"          "$OUTSIDE/dest"
assert_reject "symlinked parent (target inside)"   "$WS/linkdir/dest"
assert_reject "symlinked parent (target escapes)"  "$WS/escape/dest"
assert_reject "symlinked parent targets workspace" "$WS/workspace-alias/dest"
assert_reject "symlinked leaf (target inside)"     "$WS/leaf-inside"
assert_reject "symlinked leaf with trailing slash" "$WS/leaf-inside/"
assert_reject "symlinked leaf (target escapes)"    "$WS/leaf-escape"

# Whitespace paths must not smuggle a bad target past validation. A space-only
# destination canonicalizes (relative to cwd) outside the workspace -> reject.
assert_reject "whitespace-only path"               "   "
assert_reject "whitespace root with trailing slash" "$WS/  /.."

# --- Acceptances ------------------------------------------------------------
assert_accept "normal nested destination"          "$WS/vendor/shrubbery"
assert_accept "nested destination with spaces"     "$WS/a b/shrubbery source"
assert_accept "deep nested destination"            "$WS/a/b/c/d/shrubbery"

if [[ "$fail" -ne 0 ]]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
