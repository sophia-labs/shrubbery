#!/usr/bin/env bash
# Repeatable local Greenhouse stack supervisor.
#
# Starts or adopts:
#   - platform-next pn-gateway port-forward on :8088
#   - Choreograph VM API on :3456
#   - Greenhouse Vite app on :6020
# Then keeps a lightweight background monitor log.
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="${SOPHIA_ROOT:-/Users/vera/dev/sophia}"
SHRUBBERY_REPO="${SHRUBBERY_REPO:-$ROOT/shrubbery-vehicle-app}"
PLATFORM_NEXT_REPO="${PLATFORM_NEXT_REPO:-$ROOT/platform-next}"
DEFAULT_CHOREOGRAPH_REPO="$ROOT/choreograph"
if [[ -d "$ROOT/choreograph-learner-1" ]]; then
  DEFAULT_CHOREOGRAPH_REPO="$ROOT/choreograph-learner-1"
fi
CHOREOGRAPH_REPO="${CHOREOGRAPH_REPO:-$DEFAULT_CHOREOGRAPH_REPO}"
APP_DIR="$SHRUBBERY_REPO/apps/vehicle"

STATE_DIR="${GREENHOUSE_STACK_STATE_DIR:-$APP_DIR/.greenhouse-stack}"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

GATEWAY_PORT="${GREENHOUSE_GATEWAY_PORT:-8088}"
CHOREOGRAPH_PORT="${GREENHOUSE_CHOREOGRAPH_PORT:-3456}"
APP_PORT="${GREENHOUSE_APP_PORT:-6020}"

GATEWAY_URL="${GREENHOUSE_GATEWAY_URL:-http://127.0.0.1:$GATEWAY_PORT}"
CHOREOGRAPH_URL="${GREENHOUSE_CHOREOGRAPH_URL:-http://127.0.0.1:$CHOREOGRAPH_PORT}"
GREENHOUSE_URL="${GREENHOUSE_URL:-http://localhost:$APP_PORT}"

SERVICE_TOKEN="${MNEMOSYNE_SERVICE_TOKEN:-pn-service-dev-token}"
GRAPH_ID="${MNEMOSYNE_GRAPH_ID:-vehicle-local}"
TOOL_TRANSPORT="${MNEMOSYNE_TOOL_TRANSPORT:-hosted-mcp}"
OPENROUTER_MODEL_VALUE="${OPENROUTER_MODEL:-mock:done}"
LEARNER_MODEL="${LEARNER_1_MODEL:-deepseek-v4-pro}"
INTERNAL_SECRET="${GREENHOUSE_INTERNAL_SECRET:-dev-internal-secret}"
USER_ID="${GREENHOUSE_USER_ID:-vehicle-local-user}"
MONITOR_INTERVAL="${GREENHOUSE_MONITOR_INTERVAL:-20}"
GATEWAY_TMUX_SESSION="${GREENHOUSE_GATEWAY_TMUX_SESSION:-greenhouse-pn-gateway}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

say() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

pid_file() {
  printf '%s/%s.pid' "$PID_DIR" "$1"
}

log_file() {
  printf '%s/%s.log' "$LOG_DIR" "$1"
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

managed_pid() {
  local file
  file="$(pid_file "$1")"
  [[ -f "$file" ]] && cat "$file" || true
}

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

http_ok() {
  curl -sf -m 3 "$1" >/dev/null 2>&1
}

start_process() {
  local name="$1"
  local cwd="$2"
  shift 2
  local pid
  pid="$(managed_pid "$name")"
  if pid_alive "$pid"; then
    say "$name already managed as pid $pid"
    return 0
  fi
  rm -f "$(pid_file "$name")"
  say "starting $name"
  (
    cd "$cwd"
    nohup "$@" >>"$(log_file "$name")" 2>&1 &
    echo $! >"$(pid_file "$name")"
  )
}

wait_port() {
  local label="$1"
  local port="$2"
  local timeout="${3:-90}"
  local elapsed=0
  while (( elapsed < timeout )); do
    if port_listening "$port"; then
      say "$label listening on :$port"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  say "$label did not open :$port within ${timeout}s"
  return 1
}

wait_http() {
  local label="$1"
  local url="$2"
  local timeout="${3:-90}"
  local elapsed=0
  while (( elapsed < timeout )); do
    if http_ok "$url"; then
      say "$label ready at $url"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  say "$label did not become ready at $url within ${timeout}s"
  return 1
}

ensure_docker_desktop_context() {
  local context
  context="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "$context" != "docker-desktop" ]]; then
    say "switching kubectl context from '${context:-none}' to docker-desktop"
    kubectl config use-context docker-desktop >>"$(log_file platform)" 2>&1
  fi
  kubectl get nodes >/dev/null 2>&1
}

ensure_platform_gateway() {
  ensure_docker_desktop_context
  if ! kubectl -n platform-next get svc pn-gateway >/dev/null 2>&1; then
    say "platform-next pn-gateway service missing; running skaffold deploy"
    (
      cd "$PLATFORM_NEXT_REPO"
      ./scripts/dev-local.sh run
    ) >>"$(log_file platform)" 2>&1
  fi

  if port_listening "$GATEWAY_PORT"; then
    say "pn-gateway port-forward already listening on :$GATEWAY_PORT"
  else
    start_gateway_port_forward
  fi
}

start_gateway_port_forward() {
  if command -v tmux >/dev/null 2>&1; then
    tmux kill-session -t "$GATEWAY_TMUX_SESSION" >/dev/null 2>&1 || true
    rm -f "$(pid_file pn-gateway-port-forward)"
    say "starting pn-gateway-port-forward in tmux session $GATEWAY_TMUX_SESSION"
    tmux new-session -d -s "$GATEWAY_TMUX_SESSION" "bash '$SCRIPT_PATH' port-forward-loop"
    tmux display-message -p -t "$GATEWAY_TMUX_SESSION" '#{pane_pid}' >"$(pid_file pn-gateway-port-forward)" 2>/dev/null || true
    wait_port pn-gateway "$GATEWAY_PORT" 30 || true
    return 0
  fi

  start_process pn-gateway-port-forward "$APP_DIR" \
    bash "$SCRIPT_PATH" port-forward-loop
  wait_port pn-gateway "$GATEWAY_PORT" 30 || true
}

port_forward_loop() {
  set +e
  say "pn-gateway port-forward loop started on :$GATEWAY_PORT"
  while true; do
    ensure_docker_desktop_context || true
    if [[ -n "${TMUX:-}" ]]; then
      kubectl -n platform-next port-forward --address 0.0.0.0 svc/pn-gateway "$GATEWAY_PORT:80"
      result=$?
    else
      tail -f /dev/null | kubectl -n platform-next port-forward --address 0.0.0.0 svc/pn-gateway "$GATEWAY_PORT:80"
      result=$?
    fi
    if [[ "$result" -eq 0 ]]; then
      say "pn-gateway port-forward exited; restarting in 2s"
    else
      say "pn-gateway port-forward failed; restarting in 2s"
    fi
    sleep 2
  done
}

ensure_choreograph() {
  if http_ok "$CHOREOGRAPH_URL/health"; then
    say "Choreograph already healthy at $CHOREOGRAPH_URL"
  else
    start_process choreograph-vm "$CHOREOGRAPH_REPO" \
      env \
        MNEMOSYNE_SERVICE_TOKEN="$SERVICE_TOKEN" \
        MNEMOSYNE_GATEWAY_BASE_URL="http://host.lima.internal:$GATEWAY_PORT" \
        MNEMOSYNE_GRAPH_ID="$GRAPH_ID" \
        MNEMOSYNE_TOOL_TRANSPORT="$TOOL_TRANSPORT" \
        OPENROUTER_MODEL="$OPENROUTER_MODEL_VALUE" \
        LEARNER_1_MODEL="$LEARNER_MODEL" \
        pnpm dev:vm
    wait_http Choreograph "$CHOREOGRAPH_URL/health" 180 || true
  fi
}

ensure_greenhouse() {
  if http_ok "$GREENHOUSE_URL"; then
    say "Greenhouse already healthy at $GREENHOUSE_URL"
  else
    start_process greenhouse-vite "$APP_DIR" \
      pnpm dev -- --host localhost --port "$APP_PORT"
    wait_http Greenhouse "$GREENHOUSE_URL" 60 || true
  fi
}

agent_probe() {
  local json
  json="$(
    curl -sf -m 5 \
      -H "X-Internal-Service: $INTERNAL_SECRET" \
      -H "X-User-ID: $USER_ID" \
      "$CHOREOGRAPH_URL/api/agents?limit=100" 2>/dev/null || true
  )"
  if [[ -z "$json" ]]; then
    echo "agents: unavailable"
    return 0
  fi
  printf '%s' "$json" | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const agents = Array.isArray(data.agents) ? data.agents : [];
const learner = agents.find((agent) => {
  const fields = [agent.agentId, agent.handle, agent.workflowName, agent.agentType, agent.agentUri]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return fields.some((value) => value === "learner-1" || value.includes("learner-1"));
});
console.log(`agents: ${agents.length}${learner ? `; learner-1: ${learner.agentId || learner.handle || "present"}` : "; learner-1: missing"}`);
'
}

service_line() {
  local name="$1"
  local url="$2"
  local port="$3"
  local health="${4:-$url}"
  local pid
  pid="$(managed_pid "$name")"
  if http_ok "$health"; then
    printf '%-24s ok        %s%s\n' "$name" "$url" "${pid:+ managed-pid=$pid}"
  elif port_listening "$port"; then
    printf '%-24s listening %s%s\n' "$name" "$url" "${pid:+ managed-pid=$pid}"
  else
    printf '%-24s down      %s%s\n' "$name" "$url" "${pid:+ managed-pid=$pid}"
  fi
}

tcp_service_line() {
  local name="$1"
  local url="$2"
  local port="$3"
  local pid
  pid="$(managed_pid "$name")"
  if port_listening "$port"; then
    printf '%-24s listening %s%s\n' "$name" "$url" "${pid:+ managed-pid=$pid}"
  else
    printf '%-24s down      %s%s\n' "$name" "$url" "${pid:+ managed-pid=$pid}"
  fi
}

status() {
  say "Greenhouse stack status"
  tcp_service_line pn-gateway-port-forward "$GATEWAY_URL" "$GATEWAY_PORT"
  service_line choreograph-vm "$CHOREOGRAPH_URL" "$CHOREOGRAPH_PORT" "$CHOREOGRAPH_URL/health"
  service_line greenhouse-vite "$GREENHOUSE_URL" "$APP_PORT"
  agent_probe
  if kubectl -n platform-next get svc pn-gateway >/dev/null 2>&1; then
    kubectl -n platform-next get pods --no-headers 2>/dev/null | sed 's/^/platform-next: /' || true
  fi
}

repair_once() {
  if ! port_listening "$GATEWAY_PORT"; then
    say "repair: pn-gateway port-forward is down"
    ensure_platform_gateway || true
  fi
  if ! http_ok "$CHOREOGRAPH_URL/health"; then
    say "repair: Choreograph is down"
    ensure_choreograph || true
  fi
  if ! http_ok "$GREENHOUSE_URL"; then
    say "repair: Greenhouse dev server is down"
    ensure_greenhouse || true
  fi
}

start_monitor() {
  local pid
  pid="$(managed_pid monitor)"
  if pid_alive "$pid"; then
    say "monitor already managed as pid $pid"
    return 0
  fi
  rm -f "$(pid_file monitor)"
  say "starting monitor loop"
  nohup "$0" monitor-loop >>"$(log_file monitor)" 2>&1 &
  echo $! >"$(pid_file monitor)"
}

start_all() {
  ensure_platform_gateway
  ensure_choreograph
  ensure_greenhouse
  start_monitor
  status
}

monitor_loop() {
  set +e
  say "monitor loop started; interval ${MONITOR_INTERVAL}s"
  while true; do
    repair_once
    status || true
    sleep "$MONITOR_INTERVAL"
  done
}

stop_managed() {
  local names=(monitor greenhouse-vite choreograph-vm pn-gateway-port-forward)
  tmux kill-session -t "$GATEWAY_TMUX_SESSION" >/dev/null 2>&1 || true
  for name in "${names[@]}"; do
    local pid
    pid="$(managed_pid "$name")"
    if pid_alive "$pid"; then
      say "stopping $name pid $pid"
      pkill -P "$pid" >/dev/null 2>&1 || true
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$(pid_file "$name")"
  done
}

show_logs() {
  local name="${1:-monitor}"
  local file
  file="$(log_file "$name")"
  if [[ ! -f "$file" ]]; then
    say "no log file for $name at $file"
    return 1
  fi
  tail -n "${GREENHOUSE_LOG_LINES:-120}" "$file"
}

usage() {
  cat <<EOF
usage: $0 start|status|monitor|monitor-loop|logs [name]|stop

logs: monitor | platform | pn-gateway-port-forward | choreograph-vm | greenhouse-vite

Environment overrides:
  SOPHIA_ROOT=$ROOT
  GREENHOUSE_APP_PORT=$APP_PORT
  GREENHOUSE_CHOREOGRAPH_PORT=$CHOREOGRAPH_PORT
  GREENHOUSE_GATEWAY_PORT=$GATEWAY_PORT
  GREENHOUSE_MONITOR_INTERVAL=$MONITOR_INTERVAL
EOF
}

case "${1:-status}" in
  start) start_all ;;
  status) status ;;
  monitor) start_monitor ;;
  monitor-loop) monitor_loop ;;
  port-forward-loop) port_forward_loop ;;
  logs) show_logs "${2:-monitor}" ;;
  stop) stop_managed ;;
  *) usage; exit 2 ;;
esac
