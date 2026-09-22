#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${GREENHOUSE_BASE_URL:-http://127.0.0.1:3456}"
CLIENT_ID="${GREENHOUSE_CLIENT_ID:-vehicle-web}"
AUTHOR_ID="${GREENHOUSE_AUTHOR_ID:-vera}"
STACK_COMMAND="pnpm --dir apps/greenhouse stack:start"
AUTH_HEADERS=(-H "Accept: application/json" -H "X-Internal-Service: dev-internal-secret" -H "X-User-ID: vehicle-local-user")
JSON_HEADERS=("${AUTH_HEADERS[@]}" -H "Content-Type: application/json")
TMP_DIR="$(mktemp -d)"
CLAIMED_BY_SMOKE=0
ENCODED_AGENT_ID=""

cleanup() {
  local status=$?
  if [[ "$CLAIMED_BY_SMOKE" == "1" && -n "$ENCODED_AGENT_ID" ]]; then
    curl -fsS \
      "${JSON_HEADERS[@]}" \
      -X POST \
      -d "{\"clientId\":\"$CLIENT_ID\",\"action\":\"release\"}" \
      "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world/driver" >/dev/null || true
  fi
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "greenhouse smoke: jq is required to assert live response shapes."
  exit 1
fi

if ! curl -fsS "${AUTH_HEADERS[@]}" "$BASE_URL/api/agents?limit=100" -o "$TMP_DIR/agents.json"; then
  echo "GREENHOUSE SMOKE: STACK DARK — nothing was verified"
  echo "greenhouse smoke: start it with: $STACK_COMMAND"
  exit 2
fi

jq -e '.agents | type == "array" and (. | length >= 0) and (. as $agents | $agents | type == "array") and (. != null)' \
  "$TMP_DIR/agents.json" >/dev/null
jq -e '.count | type == "number"' "$TMP_DIR/agents.json" >/dev/null

AGENT_ID="$(
  jq -r '
    (.agents[]? | select((.handle // .label // .agentId // .agent_id // .id) == "learner-1") | (.agentId // .agent_id // .id // .handle)) //
    (.agents[0]? | (.agentId // .agent_id // .id // .handle)) //
    empty
  ' "$TMP_DIR/agents.json" | head -n 1
)"

if [[ -z "$AGENT_ID" ]]; then
  echo "GREENHOUSE SMOKE: EMPTY AGENT ROSTER — nothing was verified"
  exit 2
fi

ENCODED_AGENT_ID="$(
  AGENT_ID="$AGENT_ID" node -e 'process.stdout.write(encodeURIComponent(process.env.AGENT_ID || ""))'
)"

curl -fsS "${AUTH_HEADERS[@]}" "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world" -o "$TMP_DIR/world.json"
jq -e '.worldDoc | type == "object"' "$TMP_DIR/world.json" >/dev/null
jq -e '.agent | type == "object"' "$TMP_DIR/world.json" >/dev/null
jq -e '.worldDoc.control | type == "object"' "$TMP_DIR/world.json" >/dev/null
jq -e '.worldDoc.conversation | type == "object"' "$TMP_DIR/world.json" >/dev/null

GRAPH_ID="$(jq -r '.worldDoc.status.graphId // .worldDoc.agent.graphId // .session.graphId // .run.graphId // .agent.graphId // empty' "$TMP_DIR/world.json")"
WORKFLOW_NAME="$(jq -r '.worldDoc.agent.workflowName // .session.workflowName // .agent.workflowName // empty' "$TMP_DIR/world.json")"
CONVERSATION_NOTE="using the active conversation"

if [[ -n "$GRAPH_ID" && -n "$WORKFLOW_NAME" ]]; then
  RUN_PAYLOAD="$(
    jq -cn \
      --arg workflow_name "$WORKFLOW_NAME" \
      --arg graph_id "$GRAPH_ID" \
      --arg objective "greenhouse smoke turn $(date +%s)" \
      '{workflow_name:$workflow_name, graph_id:$graph_id, workflow_args:{objective:$objective}}'
  )"
  if curl -fsS "${JSON_HEADERS[@]}" -X POST -d "$RUN_PAYLOAD" "$BASE_URL/api/workflows/run" -o "$TMP_DIR/run.json"; then
    RUN_ID="$(jq -r '.runId // .run_id // empty' "$TMP_DIR/run.json")"
    if [[ -n "$RUN_ID" ]]; then
      CONVERSATION_NOTE="created dedicated smoke run $RUN_ID"
      for _ in $(seq 1 20); do
        curl -fsS "${AUTH_HEADERS[@]}" "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world" -o "$TMP_DIR/world.json" || true
        ACTIVE_RUN_ID="$(jq -r '.run.runId // .worldDoc.status.activeRunId // empty' "$TMP_DIR/world.json")"
        [[ "$ACTIVE_RUN_ID" == "$RUN_ID" ]] && break
        sleep 0.5
      done
    fi
  else
    CONVERSATION_NOTE="using the active conversation; workflow run creation was not accepted"
  fi
else
  CONVERSATION_NOTE="using the active conversation; workflow identity was not advertised"
fi

echo "greenhouse smoke: $CONVERSATION_NOTE."

INITIAL_HOLDER="$(jq -r '.worldDoc.control.driverLease | if type == "object" then (.clientId // .holder // "") else "" end' "$TMP_DIR/world.json")"
if [[ -n "$INITIAL_HOLDER" ]]; then
  echo "greenhouse smoke: floor cycle skipped because $INITIAL_HOLDER already holds the controls."
fi

curl -fsS "${AUTH_HEADERS[@]}" "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world/events?cursor=-1" -o "$TMP_DIR/events.json"
jq -e '.worldDoc | type == "object"' "$TMP_DIR/events.json" >/dev/null
jq -e '.events | type == "array"' "$TMP_DIR/events.json" >/dev/null
jq -e '.nextCursor | type == "number"' "$TMP_DIR/events.json" >/dev/null

if [[ -z "$INITIAL_HOLDER" ]]; then
  CLAIMED_BY_SMOKE=1
  curl -fsS \
    "${JSON_HEADERS[@]}" \
    -X POST \
    -d "{\"clientId\":\"$CLIENT_ID\",\"action\":\"claim\"}" \
    "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world/driver" \
    -o "$TMP_DIR/claim.json"
  jq -e --arg client_id "$CLIENT_ID" '
    .document.control.driverLease
    | type == "object" and ((.clientId // .holder) == $client_id)
  ' "$TMP_DIR/claim.json" >/dev/null

  curl -fsS "${AUTH_HEADERS[@]}" "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world" -o "$TMP_DIR/claimed-world.json"
  jq -e --arg client_id "$CLIENT_ID" '
    .worldDoc.control.driverLease
    | type == "object" and ((.clientId // .holder) == $client_id)
  ' "$TMP_DIR/claimed-world.json" >/dev/null

  curl -fsS \
    "${JSON_HEADERS[@]}" \
    -X POST \
    -d "{\"clientId\":\"$CLIENT_ID\",\"action\":\"release\"}" \
    "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world/driver" \
    -o "$TMP_DIR/release.json"
  CLAIMED_BY_SMOKE=0
  jq -e '.document.control.driverLease == null' "$TMP_DIR/release.json" >/dev/null

  curl -fsS "${AUTH_HEADERS[@]}" "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world" -o "$TMP_DIR/released-world.json"
  jq -e '.worldDoc.control.driverLease == null' "$TMP_DIR/released-world.json" >/dev/null
fi

MESSAGE_TEXT="greenhouse smoke turn $(date +%s)"
MESSAGE_PAYLOAD="$(
  jq -cn \
    --arg author_id "$AUTHOR_ID" \
    --arg text "$MESSAGE_TEXT" \
    '{authorId:$author_id, role:"user", visibility:"agent-visible", text:$text, autoTurn:true}'
)"

curl -fsS \
  "${JSON_HEADERS[@]}" \
  -X POST \
  -d "$MESSAGE_PAYLOAD" \
  "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world/messages" \
  -o "$TMP_DIR/send.json"

jq -e --arg author_id "$AUTHOR_ID" --arg text "$MESSAGE_TEXT" '
  .message
  | type == "object"
  and (.id | type == "string" and length > 0)
  and (.authorId == $author_id)
  and (.role == "user")
  and (.text == $text)
  and (.createdAt | type == "number")
' "$TMP_DIR/send.json" >/dev/null

SENT_AT="$(jq -r '.message.createdAt' "$TMP_DIR/send.json")"
REPLY_FOUND=0
REPLY_TEXT_FILE="$TMP_DIR/reply.txt"

for _ in $(seq 1 30); do
  curl -fsS "${AUTH_HEADERS[@]}" "$BASE_URL/api/agents/$ENCODED_AGENT_ID/world" -o "$TMP_DIR/reply-world.json"
  if jq -e --arg author_id "$AUTHOR_ID" --argjson sent_at "$SENT_AT" '
    .worldDoc.conversation.messages[]?
    | select(.role == "agent")
    | select((.authorId // "") != $author_id)
    | select((.id | type == "string" and length > 0) and (.authorId | type == "string" and length > 0))
    | select(.text | type == "string" and length > 0)
    | select((.createdAt | type == "number") and (.createdAt >= $sent_at))
  ' "$TMP_DIR/reply-world.json" >/dev/null; then
    REPLY_FOUND=1
    break
  fi
  sleep 1
done

if [[ "$REPLY_FOUND" != "1" ]]; then
  echo "greenhouse smoke: message was accepted, but no attributed agent reply appeared within 30s."
  exit 1
fi

jq -r --arg author_id "$AUTHOR_ID" --argjson sent_at "$SENT_AT" '
  [
    .worldDoc.conversation.messages[]?
    | select(.role == "agent")
    | select((.authorId // "") != $author_id)
    | select((.id | type == "string" and length > 0) and (.authorId | type == "string" and length > 0))
    | select(.text | type == "string" and length > 0)
    | select((.createdAt | type == "number") and (.createdAt >= $sent_at))
  ]
  | sort_by(.createdAt)
  | last
  | .text
' "$TMP_DIR/reply-world.json" > "$REPLY_TEXT_FILE"

pnpm --dir packages/nucleus exec tsx -e '
  import { readFileSync } from "node:fs"
  import { buildTurnAccount } from "@shrubbery/nucleus"

  const file = process.argv.at(-1)
  if (!file) throw new Error("reply text file argument was missing")
  const account = buildTurnAccount(readFileSync(file, "utf8"))
  if (typeof account.reply !== "string" || account.reply.length === 0) {
    throw new Error("turn account reply was empty")
  }
  if (!Array.isArray(account.conduct)) {
    throw new Error("turn account conduct was not an array")
  }
' "$REPLY_TEXT_FILE"

echo "greenhouse smoke: live endpoints, floor exchange, and attributed turn reply passed for agent $AGENT_ID."
