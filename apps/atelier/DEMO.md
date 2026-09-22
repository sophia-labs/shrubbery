# Atelier — the progressive-interface north-star demo

> *"Spin up a plain-text Sophia → ask it for interface → get progressively more
> interface."* The UI is never coded into existence — an agent **mints RDF** into
> the cell's `:ux:config`, the Shrubbery interpreter live-reads it, and the DOM
> grows. Website-as-RDF + agent-native, as one gesture.

The atelier is a plain Vite app (no framework) that boots the real render host
against a **minimal one-text-panel** `:ux:config` read LIVE from a real gardend
cell, with a chat panel alongside whose job is to GROW the canvas.

---

## Two ways to run it

### A. Local, infra-free (macOS, no choreograph) — the everyday path

The chat box is wired to a **deterministic** grow-driver (a fixed phrase→VerbSpec
catalog). It calls the SAME `grow()` the real agent will, so the loop is real:

```bash
pnpm --dir apps/atelier gardend:dev   # spawns + seeds a real gardend cell (graph atelier-dev), prints a grow curl
pnpm --dir apps/atelier dev           # vite on http://localhost:5181
```

Open `http://localhost:5181`, then in the chat type **"give me a top bar"**
(also: *"add a footer"*, *"add an app bar"*). The phrase → a real `add_root_region`
VerbSpec → `grow()` (catalog gate → spine gate → additive-delta guard) → `rdf_load`
into `:ux:config` → the 3s live-read re-renders → the canvas grows. No mocks: a
real cell, the real interpreter, real RDF.

`gardend:dev` also prints a copy-pasteable `curl` that writes the grow delta
out-of-band, so you can watch the DOM grow with **no UI action at all**.

### B. Real LLM via choreograph (Linux) — PROVEN 2026-06-22

A real OpenRouter LLM running in a choreograph sandbox calls `rdf_load` to grow
the same `:ux:config`. Demonstrated end-to-end: plain text → top bar → top+bottom
bar (`35 → 39 → 52` triples, `1 → 2 → 3` rooted regions), every grow driven by
`google/gemini-2.5-flash`.

The wire that worked:

```
real LLM → sandbox gate_call → orchestrator HostedMnemosyneProxy (service-auth)
         → gateway-shim → host gardend cell → rdf_load → :ux:config → live-read re-render
```

Reproduction topology (all dev-local, no cloud/terraform/ECR):

1. **Host gardend cell** bound on `0.0.0.0:<port>` with a fixed token, graph
   `atelier-dev` seeded with `minimalTextPanelConfig()` (see `src/cell/spawn-gardend.ts`).
2. **Gateway-shim** (~40 lines, `node:http`): rewrites `/g/<graphId>/mcp` →
   cell `/mcp`, forces `Origin: http://127.0.0.1` (the cell's allowlist key),
   streams both ways for SSE. Stands in for the real Sophia gateway.
3. **Isolated choreograph orchestrator** in a Linux VM (`pnpm dev:vm` is the
   foundation; a 2nd orchestrator needs `sudo systemd-run --scope -p Delegate=yes`
   for cgroup delegation, and its own `DATA_DIR`, so it never clobbers a sibling),
   configured for **service-auth**:
   - `MNEMOSYNE_TOOL_TRANSPORT=hosted-mcp-gate`
   - `MNEMOSYNE_GATEWAY_BASE_URL=http://<shim-host>:<shim-port>`
   - `MNEMOSYNE_SERVICE_TOKEN=<cell-token>`
   - `OPENROUTER_MODEL=google/gemini-2.5-flash`
4. **Drive a turn**: `POST /api/sessions` then `POST /api/sessions/:id/message`
   with internal-service auth (`x-internal-service` + `x-user-id`). The chat
   `/message` turn defaults `tool_mode: dynamic` → the agent gets the full cell
   tool surface (incl. `rdf_load`).

#### Why a gateway-shim (and not a bespoke MCP client)

The existing choreograph transport is **gateway-shaped**: in service-auth mode
(`resolveGatewayServiceAuth`) it dials `${gatewayBase}/g/{graphId}/mcp` with
`Authorization: Bearer <serviceToken>` and **no session mint**. So pointing
`gatewayBase` at a thin path-rewrite shim reaches a bare cell with **zero
choreograph code changes** — and exercises the *real* service-auth → gateway →
cell production path. (This corrects an earlier scoping that assumed a custom
`node:http` MCP client was required.)

#### Gotchas worth keeping

- **Legacy mode mints first.** `MNEMOSYNE_MCP_URL` + `MNEMOSYNE_API_TOKEN` alone
  → `createSession()` POSTs `/api/agent/session` (which a bare cell lacks) →
  `fetch failed`. Use service-auth instead.
- **Model interop.** `anthropic/*` models 400 ("Provider returned error") on the
  full ~76-tool cell schema surface (strict tool-schema validation upstream);
  `google/gemini-2.5-flash` (the choreograph default) tolerates it. The future
  curated `grow_interface` gate (one tool) sidesteps this.
- The sandbox is `--unshare-net`; the **orchestrator** (not the isolated worker)
  makes the cell HTTP call.

---

## What's proven vs. what's left

**Proven (on `main`):** the full editor + chat strangle, the grow engine
(`packages/runtime/src/grow/grow.ts` — closed `VerbSpec` union, catalog + spine +
additive gates), the deterministic LOCAL-N0 demo (path A), and the real-LLM grow
(path B). The **what** (interface grows from RDF) and the **who** (a real LLM)
are both demonstrated.

**Remaining wires (Shrubbery-Agent backlog):**

- **R3 — browser chat box → choreograph.** The `'hosted'` `ChatService` that
  fills `assembleChatServices(contract, scope, 'hosted', …)` (today the `'hosted'`
  branch throws). It slots into the EXACT SAME `turnDriver` seam path A uses, so
  *your typing in the browser* drives the real LLM. `ChatEvent` == choreograph's
  `SandboxEvent` verbatim, so garden's EventSource/reconnect machinery dissolves
  to a thin `fetch`+SSE client.
- **W2 — curated `grow_interface` gate.** A thin choreograph tool wrapping the
  IDENTICAL `grow()` (gates live ONCE in `packages/runtime/src/grow`). Replaces
  raw `rdf_load` so the security boundary is **by shape**, not by trust — the
  agent reshapes *which* panel docks *where*, never raw triples/SPARQL.
- **R-G5 — real gateway chat route** (net-new in `platform-next/gateway`). The
  gateway-shim becomes the real gateway; chat is loopback-only today.

**Cosmetic note from the demo:** the "bottom bar" rendered as a second *top*
toolbar row because the auto-created region inherited `order: 0` (top chrome).
The grow is correct (region created + rooted + rendered); only the placement is
the default region template's ordering.

> Durable design rationale lives in the `sophia-code-lab` graph (the north-star /
> ontology / decomposition / execution-plan docs) and the Shrubbery agent charter.
