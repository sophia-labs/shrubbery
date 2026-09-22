#!/usr/bin/env bash
# probe-gardend-liveread.sh
#
# Stands up a REAL local gardend cell with a FRESH temp profile, seeds the real
# 275-triple GARDEN_DEFAULT :ux:config body into the cell's :ux:config NAMED
# graph, then reads it back over the loopback /mcp (rdf_dump + sparql CONSTRUCT)
# and asserts the round-trip matches. Kills gardend + cleans the temp profile on
# exit. This is the live-read recipe for the shell build step.
#
# Usage: bash probe-gardend-liveread.sh
set -euo pipefail

GARDEN_BIN="${GARDEN_BIN:-/Users/vera/dev/sophia/garden/src-tauri/target/debug/gardend}"
SEED_NT="/Users/vera/dev/sophia/shrubbery/packages/nucleus/src/workspace/__generated__/garden-default.ux.nt"
GRAPH_ID="shrubbery-probe"
UX_GRAPH="urn:mnemosyne:local:graph:${GRAPH_ID}:ux:config"

PROFILE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gardend-probe.XXXXXX")"
TOKEN="probe-$(uuidgen | tr 'A-Z' 'a-z' | tr -d '-')"
CHILD_PID=""

cleanup() {
  if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
    echo "[cleanup] killing gardend pid=$CHILD_PID"
    kill "$CHILD_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$CHILD_PID" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$CHILD_PID" 2>/dev/null || true
  fi
  if [[ -n "$PROFILE_DIR" && -d "$PROFILE_DIR" ]]; then
    echo "[cleanup] removing temp profile $PROFILE_DIR"
    rm -rf "$PROFILE_DIR"
  fi
}
trap cleanup EXIT

[[ -x "$GARDEN_BIN" ]] || { echo "FAIL: gardend not found/executable at $GARDEN_BIN"; exit 1; }
[[ -f "$SEED_NT" ]] || { echo "FAIL: seed not found at $SEED_NT"; exit 1; }

echo "[spawn] gardend=$GARDEN_BIN profile=$PROFILE_DIR"
GARDEN_PROFILE_DIR="$PROFILE_DIR" \
GARDEN_LOOPBACK_HOST="127.0.0.1" \
GARDEN_LOOPBACK_PORT="0" \
GARDEN_LOOPBACK_TOKEN="$TOKEN" \
  "$GARDEN_BIN" >"$PROFILE_DIR/gardend.stdout.log" 2>"$PROFILE_DIR/gardend.stderr.log" &
CHILD_PID=$!
echo "[spawn] pid=$CHILD_PID"

# --- discover loopback manifest (camelCase: port, apiUrl, mcpUrl, token) ---
MANIFEST="$PROFILE_DIR/loopback.json"
for _ in $(seq 1 100); do
  [[ -f "$MANIFEST" ]] && break
  kill -0 "$CHILD_PID" 2>/dev/null || { echo "FAIL: gardend exited early"; tail -40 "$PROFILE_DIR/gardend.stderr.log"; exit 1; }
  sleep 0.2
done
[[ -f "$MANIFEST" ]] || { echo "FAIL: no loopback.json after wait"; tail -40 "$PROFILE_DIR/gardend.stderr.log"; exit 1; }

read -r PORT API_URL MCP_URL MTOKEN < <(python3 - "$MANIFEST" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print(m["port"], m["apiUrl"], m["mcpUrl"], m["token"])
PY
)
echo "[manifest] port=$PORT apiUrl=$API_URL mcpUrl=$MCP_URL"

# --- wait for /health (unauthenticated) ---
for _ in $(seq 1 100); do
  curl -sf -m 2 "${API_URL%/}/health" >/dev/null 2>&1 && { echo "[health] OK"; break; }
  sleep 0.2
done
curl -sf -m 2 "${API_URL%/}/health" >/dev/null 2>&1 || { echo "FAIL: /health never green"; tail -40 "$PROFILE_DIR/gardend.stderr.log"; exit 1; }

AUTH=(-H "Authorization: Bearer $MTOKEN" -H "Origin: http://127.0.0.1" -H "Content-Type: application/json")
mcp() { # method, params-json -> raw response
  curl -s "${AUTH[@]}" -X POST "$MCP_URL" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"$1\",\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}"
}

# --- create the graph (RDF ops need an existing graph dir) ---
echo "[step] create_graph $GRAPH_ID"
mcp cg create_graph "{\"graph_id\":\"$GRAPH_ID\",\"title\":\"Shrubbery Probe\"}" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  ->", "error" if d.get("error") else "ok")'

# --- SEED: rdf_load the real .nt body into the :ux:config NAMED graph ---
echo "[step] rdf_load -> $UX_GRAPH"
SEED_BODY="$(python3 -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' "$SEED_NT")"
LOAD_ARGS="{\"graphId\":\"$GRAPH_ID\",\"data\":$SEED_BODY,\"format\":\"application/n-triples\",\"targetGraphIri\":\"$UX_GRAPH\"}"
mcp load rdf_load "$LOAD_ARGS" > "$PROFILE_DIR/load.json"
python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print("  ->","error:"+json.dumps(d["error"]) if d.get("error") else "ok result="+json.dumps(d.get("result",{}))[:300])' "$PROFILE_DIR/load.json"

# --- READ-BACK 1: rdf_dump the SAME named graph as n-triples ---
echo "[read] rdf_dump <- $UX_GRAPH"
DUMP_ARGS="{\"graphId\":\"$GRAPH_ID\",\"format\":\"application/n-triples\",\"sourceGraphIri\":\"$UX_GRAPH\"}"
mcp dump rdf_dump "$DUMP_ARGS" > "$PROFILE_DIR/dump.json"

# --- READ-BACK 2: sparql_query CONSTRUCT over the named graph (count) ---
echo "[read] sparql_query COUNT over GRAPH <$UX_GRAPH>"
SPARQL="SELECT (COUNT(*) AS ?n) WHERE { GRAPH <$UX_GRAPH> { ?s ?p ?o } }"
SQ_ARGS="{\"graphId\":\"$GRAPH_ID\",\"query\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$SPARQL")}"
mcp sq sparql_query "$SQ_ARGS" > "$PROFILE_DIR/sparql.json"

# --- COMPARE: counts must match the 275-triple seed ---
python3 - "$SEED_NT" "$PROFILE_DIR/dump.json" "$PROFILE_DIR/sparql.json" <<'PY'
import json,sys,re
seed_path, dump_path, sparql_path = sys.argv[1], sys.argv[2], sys.argv[3]

seed_triples = sum(1 for ln in open(seed_path) if ln.strip() and not ln.lstrip().startswith('#'))

def mcp_text(path):
    d=json.load(open(path))
    if d.get("error"): raise SystemExit(f"FAIL: MCP error in {path}: {json.dumps(d['error'])}")
    res=d.get("result",{})
    # MCP tools/call result: {content:[{type:text,text:...}], structuredContent?...}
    if isinstance(res,dict) and "content" in res:
        return "".join(c.get("text","") for c in res["content"] if c.get("type")=="text")
    return json.dumps(res)

dump_text = mcp_text(dump_path)
# rdf_dump returns a JSON envelope {data, format, mediaType, quadCount}. The
# AUTHORITATIVE triple count is the n-triples body line count, NOT the envelope
# `quadCount` (that field counts result-set quads incl. response machinery).
dump_count=None
try:
    dj=json.loads(dump_text)
    if isinstance(dj,dict):
        body=dj.get("data") or dj.get("dump") or ""
        dump_count=sum(1 for ln in body.splitlines() if ln.strip() and not ln.lstrip().startswith('#'))
except json.JSONDecodeError:
    dump_count=sum(1 for ln in dump_text.splitlines() if ln.strip() and not ln.lstrip().startswith('#'))

sparql_text=mcp_text(sparql_path)
# Read the COUNT result from the `?n` row binding (a typed integer literal),
# NOT the envelope `quadCount` (which double-counts response-set quads).
sj=json.loads(sparql_text)
sparql_count=None
for row in sj.get("rows",[]):
    val=row.get("n","")
    mm=re.search(r'"?(\d+)"?',val)
    if mm: sparql_count=int(mm.group(1)); break

print(f"[compare] seed triples = {seed_triples}")
print(f"[compare] rdf_dump count = {dump_count}")
print(f"[compare] sparql COUNT  = {sparql_count}")

ok = (seed_triples==275) and (dump_count==seed_triples) and (sparql_count==seed_triples)
print("SEED_CONFIRMED" if ok else "SEED_MISMATCH")
sys.exit(0 if ok else 2)
PY
echo "[done] round-trip complete"
