# Greenhouse Shrubbery App

Greenhouse ports the most advanced `vehicle` AgentWorld room shape into a real
Shrubbery browser shell.

It follows the SRS shrubberyification boundary:

- the app owns Choreograph/AgentWorld service effects;
- `@shrubbery/components` owns controlled visual pieces;
- `@shrubbery/chat-kernel` owns chat rendering and composer intent;
- the `greenhouse` skin gives the app its sans-serif, serious research workspace posture.

## What Is Ported

- Lobby: agents/runs list, refresh, open selected agent, open first run agent.
- Room header: agent, graph, lifecycle/model/driver summary.
- Shared chat: AgentWorld conversation messages rendered through `sh-chat-panel`.
- Agent screen: baseball-card agent info, new conversation start, real Garden
  document editor host for the system prompt, and a right-pane agent graph.
- Agent graph: `mn-graph-three`, the Garden-derived Three/WebGL flat network
  viewer over Shrubbery's shared `MnGraphNode`/`MnGraphEdge` substrate. It supports
  click selection, drag-to-pan, wheel zoom, double-click reset, and optional
  full-screen modal expansion.
- Workflow IDE: a sidebar `Workflow Grimoire` plus a main-pane workflow object
  inspector for workflow definitions such as `Do a chat turn`, `Read a book`,
  `Read a paper`, `Sophia Research Service`, `Paper Adapter Scout`, and
  `Compose a workflow`.
- Workflow main pane: definition authority, readiness from virtual `wf:Draft`,
  `wf:WorkflowBinding` I/O contract, recent run statistics, eligible agents,
  seed lineage, and an MO object index that complements the right-pane graph.
- Composer controls: host-owned role and visibility selectors.
- Commands: `/help`, `/refresh`, `/activity`, `/world`, `/tools`, `/prompt`,
  `/schema`, `/comments`, `/debug`, `/new`, `/comment`, `/driver claim`,
  `/driver release`, and `/steer`.
- AgentWorld panes: activity, world, tools, prompt, schema, comments, debug.
- Cockpit pane: reads Choreograph's live `/api/agent-sessions/:id` document
  when fetch mode is pointed at a local/full stack, including run identity,
  workflow/model/runtime metadata, transcript, driver lease, and queued steering;
  fixture mode keeps the same view model in memory.
- Bridge pane: local projection/mutation fixture for the TipTap/Garden document
  bridge. It is intentionally labeled local-only until a matching live bridge
  endpoint exists.
- Trace: Choreograph events projected into `mn-research-run-trace`.
- Branch behavior: `conversation.message.created` events surface
  `authorId/role/text` in the trace, matching `feat/world-watch-attribution`.
- Service seam: fetch implementation mirrors Vehicle's Choreograph endpoints;
  fixture implementation gives local, mutable room behavior with no backend.

## Tracking

The implementation ledger for this line lives at the repo root:

- `SRS_SHRUBBERYIFICATION_SUMMARY.md` - SRS frontend/kernel shrubberyification.
- `GREENHOUSE_SHRUBBERYIFICATION_SUMMARY.md` - Greenhouse as the AgentWorld and
  workflow IDE continuation of the SRS/Vehicle work.

Planning/context docs also live in Mnemosyne graph `sophia-code-lab`, especially
the `Sophia Research Service (SRS)` folder, `vehicle-architecture-memo`, and
`greenhouse-design-20260620`.

## Run

```sh
pnpm --dir apps/vehicle dev
```

Default mode is live local Choreograph mode. With the standard VM stack running,
just open the app and Greenhouse targets `http://127.0.0.1:3456` with the local
dev internal-service headers:

```text
http://localhost:6020/
```

To force a custom Choreograph server:

```text
http://localhost:6020/?baseUrl=http://127.0.0.1:3456&internalServiceSecret=dev-internal-secret&userId=vehicle-local-user
```

Offline fixture mode is now explicit:

```text
http://localhost:6020/?fixture=true
```

On boot, Greenhouse opens `learner-1` when the live agent list contains it, then
falls back to the first listed agent.

Supported query params:

- `baseUrl`
- `fixture=true|false`
- `bearerToken`
- `internalServiceSecret`
- `userId`
- `clientId`
- `authorId`
- `role`
- `pollMs`

## Local Full-Stack Smoke

This is the stack used for live-mode development:

```sh
# platform-next, on docker-desktop only
kubectl config use-context docker-desktop
kubectl -n platform-next port-forward svc/pn-gateway 8088:80

# Choreograph VM
pnpm --dir /Users/vera/dev/sophia/choreograph dev:vm
```

Or use the repeatable Greenhouse supervisor:

```sh
pnpm --dir apps/vehicle stack:start
pnpm --dir apps/vehicle stack:status
pnpm --dir apps/vehicle stack:logs
pnpm --dir apps/vehicle stack:stop
```

The supervisor starts or adopts the `pn-gateway` port-forward on `:8088`,
Choreograph on `:3456`, and the Greenhouse Vite app on `:6020`. It writes logs
and pid files under `apps/vehicle/.greenhouse-stack/`, which is intentionally
gitignored.

The Choreograph VM must be configured with:

```sh
MNEMOSYNE_SERVICE_TOKEN=pn-service-dev-token
MNEMOSYNE_GATEWAY_BASE_URL=http://host.lima.internal:8088
MNEMOSYNE_GRAPH_ID=vehicle-local
MNEMOSYNE_TOOL_TRANSPORT=hosted-mcp
OPENROUTER_MODEL=mock:done
```

With that stack running, the default app URL reads real Choreograph agents, runs,
AgentWorld docs, and cockpit session documents. The seeded `vehicle-local` graph
is served by platform-next/Garden through `/g/vehicle-local/mcp`.

## Verify

```sh
pnpm --dir apps/vehicle typecheck
pnpm --dir apps/vehicle test:run
pnpm --dir apps/vehicle build
```

## Still Local-Only

The Rust TUI, Neovim plugin, and real Y.Doc/TipTap bridge mutation path are not
served by this Shrubbery app yet. The system prompt uses a real in-process
`sh-editor-host` document surface, but save/promote still drains into the
AgentWorld prompt service. The bridge tab remains a deliberate fixture-backed
prototype of the editor projection so the UI shape can converge before the live
document bridge contract is introduced.

Paper retrieval is also still a host-owned SRS integration stub. Greenhouse can
render the source/tool/run records the SRS layer projects, but it should not grow
a component-local arXiv/Paperpile/Paperclip client.
