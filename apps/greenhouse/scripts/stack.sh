#!/usr/bin/env bash
# Greenhouse-owned local stack entrypoint.
#
# The underlying supervisor still lives with the legacy vehicle shell while the
# live Choreograph stack is shared, but Greenhouse owns this command surface.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="$REPO_DIR/apps/vehicle/scripts/greenhouse-live-stack.sh"
COMMAND="${1:-start}"

if [[ ! -x "$SUPERVISOR" && ! -f "$SUPERVISOR" ]]; then
  echo "greenhouse stack: missing supervisor at $SUPERVISOR" >&2
  exit 1
fi

exec bash "$SUPERVISOR" "$COMMAND"
