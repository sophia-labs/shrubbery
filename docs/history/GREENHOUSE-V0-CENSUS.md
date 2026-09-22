# Greenhouse v0 — Census of Record

Archived 2026-07-04 with thanks. This document enumerates every capability in the Greenhouse v0 Lit shell (`apps/vehicle`). It is the complete backlog from which Greenhouse v1 will be built. 138 raw survey items were deduplicated to **118 unique capabilities** across five stances; 20 exact duplicates (same backend seam reported twice by parallel surveyors) were collapsed to the richer entry.

Governing narrative: `/Users/vera/dev/sophia/plans/greenhouse-ergonomics-grand-narrative-20260704.md`

---

## Deduplication notes

The following pairs/groups were merged (one item absorbed into the other):

- `Activity tab` → **Now rail pane**
- `Tools tab` → **Tools rail pane**
- `Comments tab` → **Notes rail pane**
- `World tab` → **State rail pane**
- `Cockpit tab` → **Cockpit rail pane**
- `Bridge tab` → **Bridge rail pane**
- `Prompt tab` → **Prompt rail pane**
- `Schema tab` → **Schema rail pane**
- `Debug tab` → **Debug rail pane**
- `Agent model picker` (×2) → single entry
- `Chat role control` → **Composer role selector**
- `Chat visibility control` → **Composer visibility selector**
- `Save Prompt button` → **Save Prompt**
- `Promote Graph button` → **Promote Graph**
- `System Prompt editor host` → **System Prompt editor**
- `Send cockpit input button` + `Cockpit Send cockpit input` → **Send cockpit input**
- `Bridge Replace text button` → **Bridge Replace text**
- `Bridge Split block button` → **Bridge Split block**
- `Room workspace tabs` → **Right rail tab bar**
- `Main pane header controls` → dropped (fully covered by Agent top tab + Workflow top tab + Chat top tab + Refresh top button)

---

## Room — 40 items

Presence, floor, driver lease, and turn surface.

| Name | Kind | What it does | Service seam | Data mode | v1 slice |
|------|------|-------------|--------------|-----------|----------|
| Chat top tab | control | Switches main pane to chat panel | sets `mainPane='chat'`; `projectVehicleChatMessages` | both | room chat |
| Chat panel screen | screen | Full chat panel: messages, tools, composer, prompt cards, model picker, send | `postMessage` → `POST /api/agents/{id}/world/messages`; `pollAgentWorld` | both | room chat |
| sh-chat-panel integration | component | Wires AgentWorld conversation to the Shrubbery chat panel with streaming state, suggestions, model picker, send/refresh callbacks | `projectVehicleChatMessages` + `postMessage` / `pollAgentWorld` / `setAgentModel` | both | room chat surface |
| Message rendering projection | component | Converts AgentWorld conversation records to `ChatMessage` objects; marks local-author/user-role as user, all others as assistant with author/role headers | `projectVehicleChatMessages` in `chat-projection.ts:57` | both | chat transcript projection |
| Streaming indicator | control | Marks the chat panel streaming when any projected message has a running or pending tool call; inferred from event-derived tool status, no direct token stream | computed in `vehicle-app.ts:2972`; tool status from `chat-projection.ts:264` | both | live turn status |
| Composer send | command | Posts composer text to AgentWorld with author, role, visibility, and optional reviewed context override; slash-prefixed text is intercepted as a room command | `POST /api/agents/{id}/world/messages` | both | room message compose |
| Composer role selector | control | Lets the sender choose role stamped on outgoing messages: User, Codex, or System | `onComposerControlChange`; consumed by `postMessage` | both | message metadata controls |
| Composer visibility selector | control | Lets the sender choose agent-visible vs human-only for outgoing messages | `onComposerControlChange`; consumed by `postMessage` | both | message metadata controls |
| Empty suggestion: Claim driver | control | Stages `/driver claim` from the empty chat state | `EMPTY_SUGGESTIONS`; `claimDriver` service | both | driver lease controls |
| Empty suggestion: Steer | control | Stages a steering command template in the composer | `EMPTY_SUGGESTIONS`; `steer` service | both | driver steering |
| New Conversation section | pane | Collects an objective/latest message; offers Preview or reviewed-turn start; debounces context preview refresh at 350 ms unless dirty edits exist | `previewTurnContext` + `postMessage` with context override | both | reviewed turn launch |
| Start Reviewed Turn button | command | Sends a message with edited system prompt, latest message, packet, and turn prompt as `contextPreview`; validates packet JSON before sending | `POST /api/agents/{id}/world/messages` | both | reviewed turn launch |
| Open agent node | command | Loads AgentWorld, selected run/workflow state, supplemental surfaces, events, and turn context preview; resets cursor/events and forces workspace mode to source | `readAgentWorld` → `GET /api/agents/{id}/world` | both | agent room load |
| Driver Claim button | command | Claims the AgentWorld driver lease for the configured client (Agent screen) | `claimDriver(false)` → `POST /api/agents/{id}/world/driver` | both | driver control |
| Driver Release button | command | Releases the current AgentWorld driver lease (Agent screen) | `claimDriver(true)` → `POST /api/agents/{id}/world/driver` | both | driver control |
| /driver claim | command | Claims the driver lease via slash command; alias `/claim` also accepted | `claimDriver(false)` → `POST /api/agents/{id}/world/driver` | both | driver lease controls |
| /driver release | command | Releases the driver lease via slash command; alias `/release` also accepted | `claimDriver(true)` → `POST /api/agents/{id}/world/driver` | both | driver lease controls |
| Sidebar Claim button | control | Claims the driver lease from the lobby footer | `claimDriver(false)` → `POST /api/agents/{id}/world/driver` | both | driver lease controls |
| Sidebar Release button | control | Releases the driver lease from the lobby footer | `claimDriver(true)` → `POST /api/agents/{id}/world/driver` | both | driver lease controls |
| /steer TEXT | command | Queues a steering command for the current AgentWorld driver; empty text is ignored | `steer` → `POST /api/agents/{id}/world/steer` | both | driver steering |
| /world | command | Selects the State rail tab with AgentWorld status fields | `ROOM_TABS` lookup | both | world state inspector |
| Poll world timer | service-method | Periodically fetches new AgentWorld events (default 5 s, min 1 s) and refreshes supplemental surfaces when activity arrives | `pollAgentWorld` → `GET /api/agents/{id}/world/events?cursor=` | both | live event polling |
| State rail pane | pane | Shows current AgentWorld status summary: schema, lifecycle, runtime, session, run, sandbox, graph, summary | `readAgentWorld` → `GET /api/agents/{id}/world` | both | world state inspector |
| Agent screen presence strip | screen | Summarizes the selected agent's lifecycle, model, driver, graph, run, session, and update metadata in the Agent main pane | `readAgentWorld` / `listAgents` | both | agent presence header |
| /bridge | command | Selects the Bridge rail tab | `ROOM_TABS` lookup; `readBridgeProjection` | **fixture-only** | document bridge prototype |
| Bridge rail pane | pane | Local document bridge projection: document metadata, unsupported nodes, selectable lines, TipTap JSON | **fixture**: `readBridgeProjection` / `applyBridgeOperation`; **live**: throws (no HTTP bridge endpoint) | **fixture-only** | document bridge prototype |
| Bridge Replace text | control | Appends `[edited]` to the selected editable bridge line via `replace-block-text`; disabled unless selected line support is `editable-text` | **fixture**: `applyBridgeOperation`; **live**: throws | **fixture-only** | document bridge editing |
| Bridge Split block | control | Splits selected editable text block at its UTF-16 midpoint into a new block id ending in `-split`; repeated splits can collide | **fixture**: `applyBridgeOperation`; **live**: throws | **fixture-only** | document bridge editing |
| listAgents | service-method | Lists agent records with lifecycle, model, graph, run, and session bindings | Fetch `GET /api/agents?limit={n}`; fixture returns all seeded agents (ignores limit) | both | agent roster |
| readAgentWorld | service-method | Reads the AgentWorld document plus visible packet, session, and run context | Fetch `GET /api/agents/{id}/world`; fixture ignores agentId and returns one shared world | both | agent room |
| postMessage | service-method | Adds a world conversation message and may trigger an agent turn; fixture fabricates queued/tool/completed events and an agent acknowledgement | Fetch `POST /api/agents/{id}/world/messages` | both | room conversation |
| claimDriver | service-method | Claims or releases the driver lease; fixture increments epoch on claim | Fetch `POST /api/agents/{id}/world/driver` body `{clientId, action}` | both | driver control |
| steer | service-method | Submits a steering command; `commandId` is optional | Fetch `POST /api/agents/{id}/world/steer` body `{clientId, text, commandId?}` | both | driver steering |
| readVehicleSession | service-method | Reads a cockpit session document and projects it into panes, driver lease, transcript, and presence | Fetch `GET /api/agent-sessions/{sessionId}` then `projectVehicleSession`; fixture ignores sessionId | both | cockpit session |
| submitCockpitInput | service-method | Claims cockpit driver, sends steer command, refreshes session; fixture rejects if driver holder differs | Fetch `POST /api/agent-sessions/{id}/driver` → `POST /api/agent-sessions/{id}/steer` → `GET /api/agent-sessions/{id}` | both | cockpit input |
| projectVehicleSession | service-method | Projects raw agent-session document payload into the cockpit `VehicleSession` shape; reads session, document, driverLease, view.panes, prompts.system, runtime, and transcript | local projection helper (`vehicle-service.ts:1371`) | live | cockpit session reader |
| projectVehicleChatMessages | service-method | Projects AgentWorld conversation messages and turn events into chat-kernel `ChatMessage` objects; anchors tool groups to assistant messages by turnId and timestamp | `chat-projection.ts:57`; consumes `VehicleAgentWorldResponse` + events | both | chat transcript projection |
| readBridgeProjection | service-method | Reads a projected editable Garden document bridge view | **FIXTURE ONLY** (`projectGardenDocument`); **live throws** — no Choreograph HTTP bridge endpoint exists | **fixture-only** | drop until real bridge endpoint |
| applyBridgeOperation | service-method | Applies bridge edit operations (replace/insert/delete text, split/join, block ops, set attrs); fixture increments revision and emits `vehicle.bridge.mutated` | **FIXTURE ONLY**; **live throws** | **fixture-only** | drop until real bridge endpoint |
| projectGardenDocument | service-method | Projects a fixture `GardenDocument` into `BridgeProjection` lines and TipTap JSON; marks paragraphs/headings/list items/blockquote/codeBlock as editable-text; images, math, footnotes, links, breaks = command-only; tables/query blocks = opaque | local fixture helper (`vehicle-service.ts:2209`) | **fixture-only** | bridge projection prototype |

---

## Bench — 16 items

Turn inspection, evidence, journal, and annotation.

| Name | Kind | What it does | Service seam | Data mode | v1 slice |
|------|------|-------------|--------------|-----------|----------|
| Preview button | command | Refreshes the turn context preview for the current objective/message | `previewTurnContext` → `POST /api/agents/{id}/world/turn-preview` | both | turn context review |
| Context Preview section | pane | Displays and edits latest message, preview digests, agent-visible packet JSON, and full turn prompt; dirty edits suppress non-forced refreshes | `previewTurnContext`; `VehicleTurnPreviewResponse` | both | turn context review |
| Refresh Context button | command | Forces context preview recomputation from current state | `refreshTurnContextPreview(true)` → `POST /api/agents/{id}/world/turn-preview` | both | turn context review |
| Agent journal trace slot | pane | Shows projected and event-derived agent ontology facts in reverse-chronological order; displayed in trace slot when Agent tab is active | `agentJournalItems()` projection (`vehicle-service.ts:743`) | both | agent journal |
| Workflow journal trace slot | pane | Shows workflow/run/session/prompt/tool/model/conversation/control facts filtered from the agent journal; displayed in trace slot when Workflow tab is active | `agentJournalItems()` projection (`vehicle-service.ts:743`) | both | workflow journal |
| Now rail pane | pane | Lists AgentWorld activity events and renders the selected event payload; selection initialized to latest item after polling | `renderActivity` / `renderActivityDetail`; events from `pollAgentWorld` | both | activity timeline |
| Notes rail pane | pane | Shows Codex collaborator comments from `worldDoc.codex.comments`; empty state shown when no comments exist | `postComment` / `readAgentWorld` | both | collaborator notes |
| Generic trace panel | pane | Renders AgentWorld events as `mn-research-run-trace` steps; step selection opens the Now rail detail | `traceSteps()` from `pollAgentWorld` | both | event trace |
| Workflow trace detail pane | pane | Shows selected event raw payload; includes a canned steer-pause command | `steer` → `POST /api/agents/{id}/world/steer` | both | trace detail |
| Inline tool use projection | component | Groups turn tool events and transcript events into inline chat tool calls and transcript parts attached to the matching assistant message, or a synthetic tool message | `projectToolGroups`/`attachToolGroup` in `chat-projection.ts:123`; events from `pollAgentWorld` | both | turn tool timeline |
| Event trace component | component | Renders AgentWorld events as `mn-research-run-trace` steps; step selection sets `roomTab=activity` and `workspaceMode=source` | `renderTrace` / `traceSteps`; events from `pollAgentWorld` | both | event trace |
| /activity | command | Selects the Now rail tab and returns workspace to source mode (internal id=`activity`, label=`Now`) | `ROOM_TABS` lookup | static | rail navigation |
| /comments | command | Selects the Notes rail tab (internal id=`comments`, label=`Notes`) | `ROOM_TABS` lookup | both | collaborator notes |
| /comment TEXT | command | Posts a human-only collaborator comment into AgentWorld and switches the rail to Notes | `postComment` → `POST /api/agents/{id}/world/comments` | both | collaborator comments |
| pollAgentWorld | service-method | Polls AgentWorld events after a cursor; returns refreshed world plus events and `nextCursor` | Fetch `GET /api/agents/{id}/world/events?cursor={cursor}`; fixture filters in-memory events by seq | both | room event stream |
| postComment | service-method | Adds a codex/comment note; fixture appends under `worldDoc.codex.comments` and emits `control.steered` | Fetch `POST /api/agents/{id}/world/comments` | both | room comments |

---

## Constitution — 19 items

Agent identity, toolbelt, prompts, and schema.

| Name | Kind | What it does | Service seam | Data mode | v1 slice |
|------|------|-------------|--------------|-----------|----------|
| Agents sidebar list | component | Shows all known agents with lifecycle/status badges, model/graph status text; clicking an agent loads AgentWorld and resets events/cursor | `listAgents` → `GET /api/agents?limit=` | both | agent registry |
| Agent screen | screen | Presents agent identity/presence, new conversation controls, turn context preview, and system prompt editor; journals appear in the trace slot | `readAgentWorld` → `GET /api/agents/{id}/world` | both | agent console |
| Agent identity strip | component | Displays lifecycle tone (running→live, paused→held, else→dormant), agent name, selected model, driver, graph, run/session, and updated/event metadata | `buildAgentPresence()` / `renderPresenceStrip()` | both | agent identity |
| Agent model picker | control | Lets the user open provider/model choices and change the selected agent model; Escape closes; provider inferred from known prefixes when saving; shows observed attribution from latest `agent.model.changed` event when available | `changeAgentModel()` → `POST /api/agents/{id}/world/model` | both | model selection |
| Tools rail pane | pane | Displays toolbelt manifest, mode, MCP profile, counts, and per-tool state/access/risk/description; falls back to compact JSON when name or description is missing | `readAgentWorld` / `pollAgentWorld` | both | toolbelt inspector |
| Prompt rail pane | pane | Renders each top-level AgentWorld prompt record as formatted JSON; read-only (editing is on the Agent screen) | `worldDoc.prompts` from `readAgentWorld` | both | prompt inspection |
| Schema rail pane | pane | Renders each top-level AgentWorld schema record as formatted JSON; no validation UI | `worldDoc.schemas` from `readAgentWorld` | both | schema inspection |
| System Prompt editor | component | Embeds `sh-editor-host` with a local Y.Doc provider seeded from current prompt text; dirty tracking compares editor text to world prompt | `createPromptEditorProvider` / `syncPromptEditor` | both | system prompt editor |
| Context Preview editor | component | Shows and edits the agent-visible packet JSON and turn prompt before sending a reviewed room turn; invalid packet JSON blocks send and marks context dirty | `currentTurnContextOverride` / `previewTurnContext` → `POST /api/agents/{id}/world/turn-preview` | both | turn context review |
| Agent Network workspace pane | pane | Shows a 2D/3D graph of agent, model, prompt, graph, run, session, tools, conversation, driver, and journal nodes; node clicks reveal evidence fields; locally projected from AgentWorld + events | `agentGraph()` / `renderAgentGraphPane()` in `vehicle-app.ts:3064` | both | agent ontology graph |
| Save Prompt | command | Saves non-empty system prompt text to AgentWorld; rejects empty prompts client-side and fixture-side; refreshes preview/world state after save | `saveSystemPrompt()` → `POST /api/agents/{id}/world/prompts/system` | both | system prompt editing |
| Promote Graph | command | Promotes current system prompt to the selected graph binding; live endpoint may persist graph-level promotion; fixture only emits an event | `promoteSystemPrompt()` → `POST /api/agents/{id}/world/prompts/system/promote?graph_id=` | both | prompt promotion |
| /tools | command | Selects the Tools rail tab | `ROOM_TABS` lookup | both | toolbelt view |
| /prompt | command | Selects the Prompt rail tab (JSON view, distinct from Agent screen editable prompt) | `ROOM_TABS` lookup | both | prompt inspection |
| /schema | command | Selects the Schema rail tab | `ROOM_TABS` lookup | both | schema inspection |
| previewTurnContext | service-method | Builds a preview of the next turn prompt and visible packet; fixture synthesizes locally and does not call an agent | Fetch `POST /api/agents/{id}/world/turn-preview`; fixture assembles prompt, packet, constraints, tools, digests | both | turn preview |
| saveSystemPrompt | service-method | Saves the editable system prompt; fixture rejects empty trimmed prompts, updates `effectivePromptDigest`, emits `agent.prompt.system.updated` | Fetch `POST /api/agents/{id}/world/prompts/system` | both | prompt editing |
| promoteSystemPrompt | service-method | Promotes system prompt to graph-backed binding; fixture ignores graphId, only records an event and does not persist to Mnemosyne | Fetch `POST /api/agents/{id}/world/prompts/system/promote?graph_id={id}` (omitted when blank or `-`) | both | prompt promotion |
| setAgentModel | service-method | Changes model/provider for the agent, session, and world status; fixture rejects empty model, infers provider when absent, emits `agent.model.changed` | Fetch `POST /api/agents/{id}/world/model` | both | model selection |

---

## Dispatch — 20 items

Workflow orchestration, runs, sessions, cockpit.

| Name | Kind | What it does | Service seam | Data mode | v1 slice |
|------|------|-------------|--------------|-----------|----------|
| Workflow Grimoire sidebar tree | component | Groups workflows with nested agent and run children, counts, badges, and expanded selected state; live service falls back to projecting workflows from agents/runs if `/api/workflows` fails | joins `listWorkflows` / `listRuns` / `listAgents` | both | workflow library |
| Runs sidebar list | component | Shows recent workflow runs with status badges, graph IDs, and token counts | `listRuns` → `GET /api/workflows/runs?limit=` | both | run registry |
| Open workflow node | command | Selects a workflow and opens its active run or first agent in workflow mode; if no local agents or runs, only sets status text | local projection from lobby service lists | both | workflow navigation |
| Open run node | command | Loads a run's agent session and opens the associated agent in workflow mode; uses first returned agent | `listRunAgents` → `GET /api/workflows/runs/{runId}/agents` | both | run navigation |
| Workflow IDE screen | screen | Shows workflow definition overview, readiness, run action, and workflow cards; combines live endpoint data with projected runtime ontology | `listWorkflows` / `listRuns` / `listAgents` | both | workflow IDE |
| Workflow Run Workflow button | command | Starts the selected workflow with the provided objective; live requires a graph binding; fixture creates a synthetic running run | `startWorkflow` → `POST /api/workflows/run` | both | workflow execution |
| Workflow Ontology workspace pane | pane | Shows a 2D/3D workflow ontology graph with node evidence and contract/shape gate summary; merges selected workflow definition facts into runtime AgentWorld ontology | `workflowOntology()` / `renderWorkflowOntologyPane()` | both | workflow ontology graph |
| New Conversation reviewed turn controls | control | Collects a fresh objective, previews turn context, and sends the reviewed context as a message; posts through `postMessage` with `contextPreview`, not `/api/workflows/run` | `previewTurnContext` + `postMessage` → `POST /api/agents/{id}/world/messages` | both | reviewed room turn |
| Workflow trace detail Steer pause | control | Queues a canned steering command asking the agent to pause after the next tool call and summarize; lives in the workflow detail pane, not the chat rail | `steer` → `POST /api/agents/{id}/world/steer` | both | workflow steering |
| Cockpit rail pane | pane | Renders the active Choreograph session, driver, panes, transcript, pending control queue, and a one-click cockpit input action; live requires an active session id | `GET /api/agent-sessions/{id}`; `POST /api/agent-sessions/{id}/driver` and `/steer` | both | live session cockpit |
| Send cockpit input | control | Claims the active session driver and sends fixed steering text (`"inspect the current Greenhouse room"`), then refreshes session and world state; no freeform input field exists | `submitCockpitInput` → `POST /api/agent-sessions/{id}/driver` + `/steer` + `GET /api/agent-sessions/{id}` | both | session control input |
| Empty suggestion: Start fresh | control | Stages a `/new` command for reopening the current objective in a clean conversation room | `EMPTY_SUGGESTIONS`; handled by `/new` | both | start conversation affordances |
| /new OBJECTIVE | command | Starts a fresh workflow-backed conversation; if no objective supplied, synthesizes a continuation from the agent display name | `startConversation` → `POST /api/workflows/run`; fixture resolves or creates a workflow record | both | conversation run creation |
| /cockpit | command | Selects the Cockpit rail tab for the active Choreograph agent session | `ROOM_TABS` lookup; `readVehicleSession` | both | session cockpit |
| listWorkflows | service-method | Lists workflow definitions and derived readiness metadata; silently falls back to derived records when `/api/workflows` fails | Fetch `GET /api/workflows?limit={n}` (fallback: `GET /api/agents` + `GET /api/workflows/runs`); fixture projects from local state | both | workflow catalog |
| listRuns | service-method | Lists workflow run summaries | Fetch `GET /api/workflows/runs?limit={n}`; fixture ignores limit | both | run history |
| listRunAgents | service-method | Lists agent-session summaries attached to a workflow run; fixture falls back to first run/agent when runId unknown | Fetch `GET /api/workflows/runs/{runId}/agents` | both | run detail |
| startWorkflow | service-method | Starts a workflow run from a selected workflow and objective; live requires `workflow.graphIds[0]` or `agent.graphId` | Fetch `POST /api/workflows/run` body `{workflow_name, graph_id, workflow_args:{objective}}` | both | workflow launch |
| startConversation | service-method | Starts a workflow-backed conversation from an existing agent and objective; derives `workflow_name` from `workflowName`/`agentType`/`handle`/`agentId` and throws if none exists | Fetch `POST /api/workflows/run` (same endpoint as `startWorkflow`, different request shape) | both | conversation launch |
| VehicleService interface | service-method | Defines the backend contract consumed by the Lit shell; both `FetchVehicleService` and `FixtureVehicleService` implement every method | `vehicle-service.ts:37` | both | backend contract |

---

## Chrome — 23 items

Shell, navigation, configuration, and diagnostics.

| Name | Kind | What it does | Service seam | Data mode | v1 slice |
|------|------|-------------|--------------|-----------|----------|
| Greenhouse workspace shell | screen | Hosts the entire app: header actions, sidebar, main pane, source/workspace detail, workflow trace detail, and trace slots | `readVehicleConfig` / `createVehicleService`; `mn-research-workspace` | both | app shell |
| Top connection pill | component | Shows current service provenance and driver lease in the header; live text notes bridge editing remains local until an HTTP bridge endpoint exists | `driver()` reads `worldDoc.control.driverLease`; `connectionLabel()` / `connectionDetail()` | both | connection status |
| Agent top tab | control | Switches main pane to the Agent screen | sets `mainPane='agent'`; data loaded through `readAgentWorld` | both | agent room |
| Workflow top tab | control | Switches main pane to the Workflow IDE screen | sets `mainPane='workflow'`; data from `listWorkflows` | both | workflow IDE |
| Refresh top button | control | Refreshes lobby lists without changing the active pane; does not call `pollWorld()` unlike `/refresh` | `refreshLobby()` → `listAgents` / `listWorkflows` / `listRuns` | both | refresh controls |
| Workspace/Trace mode toggle | control | Switches the workspace component between source/workspace detail and workflow/trace detail modes; labels are inverted from internal names (`sourceLabel='Workspace'`, `workflowLabel='Trace'`) | `@mn-research-workspace-mode-change` → `workspaceMode` | static | workspace layout |
| Sidebar lobby | pane | Lists workflows, agents, and runs; supports find/search; opens the selected node | `sidebarSections()` / `onSidebarNode`; search behavior is inside `mn-sidebar-panel` | both | lobby browser |
| Lobby status footer | component | Displays loading, error, status, and provenance text below the sidebar; errors overwrite status | assigned by lobby/open/poll/commands | both | status footer |
| renderMainPane router | component | Chooses between Agent screen, Workflow IDE screen, and chat panel based on `mainPane` | `renderMainPane()` in `vehicle-app.ts:3536` | static | main pane routing |
| Right rail tab bar | control | Displays and selects room rail subtabs: Now, Tools, Notes, State, Cockpit, Bridge, Prompt, Schema, Debug; Cockpit/Bridge/Prompt/Schema/Debug styled as low-frequency tabs | `ROOM_TAB_LABELS` / `renderRoomPane` | static | room rail navigation |
| renderActiveTab router | component | Dispatches the selected room workspace tab to its specific renderer or world fields; shows `No AgentWorld selected` when world is absent | `renderActiveTab()` in `vehicle-app.ts:3610` | both | room inspector |
| Graph dimension toggle | control | Switches agent/workflow graph rendering between 2D and 3D; state shared by both panes | `agentGraphDimension` buttons | static | graph controls |
| Window-level keybindings | control | No window-level keyboard shortcuts are registered; only component-level key handling exists (Escape closes model picker; prompt editor listens to keyup) | none | static | **drop** |
| Room slash commands | command | Parses leading-slash input and dispatches to: `/help`, pane/tab switches, `/refresh`, `/new`, `/comment`, `/driver`, `/steer`; everything else is sent as a message | `send()` → `handleCommand()` | both | command palette |
| Prompt card: Greenhouse room commands | control | Offers compose-mode shortcuts for `/refresh`, `/comment`, and `/steer`; callbacks set status only; execution goes through composer send | `PROMPT_CARDS`; `onPromptOptionUse` / `onPromptSubmit` | static | command palette prompts |
| /help | command | Shows the implemented room command list in the status line; note: omits `/refresh` despite supporting it | `handleCommand` | static | room command help |
| /refresh | command | Refreshes lobby data and polls AgentWorld events; also refreshes cockpit/bridge surfaces when fresh events arrive | `refreshLobby` + `pollAgentWorld` → `GET /api/agents/{id}/world/events` | both | refresh and sync |
| /agent | command | Switches main pane to the Agent screen | `handleCommand` | static | navigation commands |
| /chat | command | Switches main pane back to the chat screen | `handleCommand` | static | navigation commands |
| /debug | command | Selects the Debug rail tab with service/config/cursor/control/status diagnostics | `ROOM_TABS` lookup | both | debug diagnostics |
| Debug rail pane | pane | Shows runtime diagnostics: service base URL/mode, selected ids, cursor/event counts, provenance, supplemental status, raw control JSON, and status JSON | `renderDebug` in `vehicle-app.ts:4554` | both | debug diagnostics |
| readVehicleConfig | service-method | Builds service config from query params and Vite env; defaults live mode to local Choreograph on port 3456; supports `fixture=true`, `baseUrl`, `author`/`client`/`role`/`poll` params, bearer token, internal service secret | local config reader (`vehicle-service.ts:111`) | static | app boot config |
| createVehicleService | service-method | Selects `FixtureVehicleService` or `FetchVehicleService` from config; fetch mode trims trailing slash from `baseUrl` | local factory (`vehicle-service.ts:144`) | both | app boot config |

---

## Service contract of record

All `VehicleService` methods, with endpoints and fixture-only gaps flagged.

| Method | Endpoint | Fixture-only? |
|--------|----------|--------------|
| `readVehicleConfig` | local config reader — no HTTP | — |
| `createVehicleService` | local factory — no HTTP | — |
| `listAgents` | `GET /api/agents?limit={n}` | — |
| `listWorkflows` | `GET /api/workflows?limit={n}` (fallback: `GET /api/agents` + `GET /api/workflows/runs`) | — |
| `listRuns` | `GET /api/workflows/runs?limit={n}` | — |
| `listRunAgents` | `GET /api/workflows/runs/{runId}/agents` | — |
| `readAgentWorld` | `GET /api/agents/{agentId}/world` | — |
| `previewTurnContext` | `POST /api/agents/{agentId}/world/turn-preview` | — |
| `pollAgentWorld` | `GET /api/agents/{agentId}/world/events?cursor={cursor}` | — |
| `postMessage` | `POST /api/agents/{agentId}/world/messages` | — |
| `postComment` | `POST /api/agents/{agentId}/world/comments` | — |
| `saveSystemPrompt` | `POST /api/agents/{agentId}/world/prompts/system` | — |
| `promoteSystemPrompt` | `POST /api/agents/{agentId}/world/prompts/system/promote?graph_id={id}` | — |
| `setAgentModel` | `POST /api/agents/{agentId}/world/model` | — |
| `claimDriver` | `POST /api/agents/{agentId}/world/driver` | — |
| `steer` | `POST /api/agents/{agentId}/world/steer` | — |
| `startWorkflow` | `POST /api/workflows/run` | — |
| `startConversation` | `POST /api/workflows/run` (different request shape) | — |
| `readVehicleSession` | `GET /api/agent-sessions/{sessionId}` | — |
| `submitCockpitInput` | `POST /api/agent-sessions/{id}/driver` → `POST /api/agent-sessions/{id}/steer` → `GET /api/agent-sessions/{id}` | — |
| `projectVehicleSession` | local projection helper — no HTTP | — |
| `projectVehicleChatMessages` | local projection helper — no HTTP | — |
| **`readBridgeProjection`** | **⚠ FIXTURE ONLY — no Choreograph HTTP bridge endpoint** | **yes** |
| **`applyBridgeOperation`** | **⚠ FIXTURE ONLY — no Choreograph HTTP bridge endpoint** | **yes** |
| **`projectGardenDocument`** | **⚠ FIXTURE ONLY — local bridge projection helper only** | **yes** |

Bridge is the only backend gap. Three methods (`readBridgeProjection`, `applyBridgeOperation`, `projectGardenDocument`) plus four UI items (`Bridge rail pane`, `Bridge Replace text`, `Bridge Split block`, `/bridge`) have no live path. v1's perfectly-complete rule will either require a real HTTP bridge endpoint or drop these items from the first slice.

---

## Suggested v1 slice ordering

Grouped by phase. Items marked **⚠ backend** require a live Choreograph endpoint that does not yet exist or has not been confirmed reachable in development.

### Phase 1 — Room foundation (presence, floor, turn)

| Slice | Items | Backend work |
|-------|-------|-------------|
| **S1 · App shell + lobby** | Greenhouse workspace shell, Sidebar lobby, Lobby status footer, renderMainPane router, Right rail tab bar, renderActiveTab router, Workspace/Trace mode toggle, readVehicleConfig, createVehicleService | none (config + chrome) |
| **S2 · Agent roster + room load** | Agents sidebar list, listAgents, Open agent node, readAgentWorld, Agent screen, Agent screen presence strip, State rail pane | `GET /api/agents`, `GET /api/agents/{id}/world` |
| **S3 · Room chat surface** | Chat top tab, Chat panel screen, sh-chat-panel integration, Message rendering projection, Composer send, Composer role selector, Composer visibility selector, postMessage, projectVehicleChatMessages | `POST /api/agents/{id}/world/messages` |
| **S4 · Live event polling** | Poll world timer, pollAgentWorld, Now rail pane, Event trace component, Generic trace panel, Inline tool use projection, Streaming indicator | `GET /api/agents/{id}/world/events` |
| **S5 · Driver lease** | Driver Claim button, Driver Release button, Sidebar Claim button, Sidebar Release button, /driver claim, /driver release, Empty suggestion: Claim driver, claimDriver | `POST /api/agents/{id}/world/driver` |
| **S6 · Steering** | /steer TEXT, Empty suggestion: Steer, steer | `POST /api/agents/{id}/world/steer` |

### Phase 2 — Bench (turn inspection and annotation)

| Slice | Items | Backend work |
|-------|-------|-------------|
| **S7 · Turn context review** | Preview button, Context Preview section, Refresh Context button, Context Preview editor, previewTurnContext | `POST /api/agents/{id}/world/turn-preview` |
| **S8 · Reviewed turn launch** | New Conversation section, Start Reviewed Turn button | reuses `postMessage` |
| **S9 · Turn tool timeline** | Agent journal trace slot, Workflow journal trace slot, Workflow trace detail pane | reuses `pollAgentWorld` projection |
| **S10 · Collaborator notes** | Notes rail pane, /comment TEXT, /comments, postComment | `POST /api/agents/{id}/world/comments` |

### Phase 3 — Constitution (agent identity, config, schema)

| Slice | Items | Backend work |
|-------|-------|-------------|
| **S11 · Agent identity + model** | Agent screen, Agent identity strip, Agent model picker, setAgentModel, Tools rail pane, /tools | `POST /api/agents/{id}/world/model`; toolbelt from `readAgentWorld` |
| **S12 · System prompt editing** | System Prompt editor, Save Prompt, saveSystemPrompt, Prompt rail pane, /prompt | `POST /api/agents/{id}/world/prompts/system` |
| **S13 · Prompt promotion + schema** | Promote Graph, promoteSystemPrompt, Schema rail pane, /schema | `POST /api/agents/{id}/world/prompts/system/promote` |
| **S14 · Ontology graph** | Agent Network workspace pane, Graph dimension toggle | reuses `readAgentWorld` + events |

### Phase 4 — Dispatch (workflow orchestration)

| Slice | Items | Backend work |
|-------|-------|-------------|
| **S15 · Workflow catalog + navigation** | Workflow Grimoire sidebar tree, Runs sidebar list, Open workflow node, Open run node, Workflow IDE screen, listWorkflows, listRuns, listRunAgents | ⚠ `GET /api/workflows`, `GET /api/workflows/runs`, `GET /api/workflows/runs/{id}/agents` |
| **S16 · Workflow execution** | Workflow Run Workflow button, startWorkflow, /new OBJECTIVE, startConversation, Empty suggestion: Start fresh | ⚠ `POST /api/workflows/run` |
| **S17 · Workflow inspection** | Workflow Ontology workspace pane, Workflow journal trace slot, Workflow trace detail pane, Workflow trace detail Steer pause, New Conversation reviewed turn controls | ⚠ reuses workflow + steer |
| **S18 · Cockpit session** | Cockpit rail pane, Send cockpit input, /cockpit, readVehicleSession, submitCockpitInput, projectVehicleSession | ⚠ `GET /api/agent-sessions/{id}`, `POST /api/agent-sessions/{id}/driver`, `POST /api/agent-sessions/{id}/steer` — requires active Choreograph session |

### Phase 5 — Chrome polish (as needed)

| Slice | Items | Backend work |
|-------|-------|-------------|
| **S19 · Navigation + commands** | Agent/Workflow/Chat top tabs, Refresh top button, Top connection pill, Room slash commands, Prompt card: Greenhouse room commands, /help, /refresh, /agent, /chat | none |
| **S20 · Debug + diagnostics** | Debug rail pane, /debug, readVehicleConfig (polish), createVehicleService (polish) | none |

### Deferred / drop

| Slice | Items | Reason |
|-------|-------|--------|
| **Bridge (deferred)** | Bridge rail pane, Bridge Replace text, Bridge Split block, /bridge, readBridgeProjection, applyBridgeOperation, projectGardenDocument | No live HTTP bridge endpoint in Choreograph; keep fixture code as the design sketch, rebuild against a real endpoint when available |
| **Window-level keybindings** | Window-level keybindings | Nothing to build; the capability does not exist in v0 |
