# Greenhouse / SRS Shrubberyification Worklog

Date: 2026-07-01
Branch: `vehicle-shrubbery-app`
Status: Greenhouse is now a Shrubbery app shell for the SRS/Vehicle/AgentWorld line. It is fixture-verified, can point at the local Choreograph stack, and treats workflows as first-class Meaningful Objects.

## Where This Work Is Tracked

Implementation is tracked in this repo:

- `SRS_SHRUBBERYIFICATION_SUMMARY.md` - the first SRS shrubberyification pass: research components, shared chat generalization, research skin, Storybook SRS stories, and the paper integration stub seam.
- `GREENHOUSE_SHRUBBERYIFICATION_SUMMARY.md` - this document: the Greenhouse continuation, where SRS becomes a real AgentWorld/workflow app shell rather than only a Storybook surface.
- `apps/vehicle/README.md` - operator/developer notes for running Greenhouse in fixture mode or against the local Choreograph/platform-next/Garden stack.
- `apps/vehicle/src/vehicle-app.ts` and `apps/vehicle/src/vehicle-service.ts` - the working implementation surface.

Coordination and concept history live in Mnemosyne graph `sophia-code-lab`:

- Folder: `Sophia Research Service (SRS)`
- Document: `vehicle-architecture-memo`
- Document: `greenhouse-design-20260620`
- Document: `shrubbery-frontend-decomposition`
- Document: `shrubbery-agent-charter-20260622`

The graph documents are planning/context. The repo docs above are the current implementation ledger.

## Relationship To SRS

The earlier SRS work made the research service Shrubbery-native without creating a one-off app:

- reusable research source and trace components;
- a generalized `sh-chat-panel`;
- the `research` skin;
- Storybook stories that demonstrate the SRS desk shape;
- a deliberately host-owned paper search adapter seam.

Greenhouse is the next layer: it uses that SRS workspace/chat posture as the shell for live AgentWorld rooms. It is named Greenhouse because the interface is now less a generic vehicle and more a cultivation environment for agents, workflows, prompts, traces, and graph-backed memory.

## What Greenhouse Adds

### App Shell

`apps/vehicle` is a real Vite/Lit app package in the Shrubbery workspace. It boots with `data-skin="greenhouse"` and composes:

- `mn-research-workspace` for the three-pane research IDE frame;
- `sh-chat-panel` for room conversation and inline tool use;
- `mn-research-run-trace` for AgentWorld/run activity;
- `sh-editor-host` for the embedded Garden document editor surface;
- `mn-graph-three` for interactive graph views.

The shell owns effects. Components stay backend-free and controlled.

### Greenhouse Skin

The new `greenhouse` skin extends the token system as a serious sans-serif research workspace:

- `packages/tokens/css/skin-greenhouse.css`
- `packages/tokens/src/index.ts`
- Storybook toolbar/catalog coverage

It is distinct from:

- `garden` - fern/Literata/local-first Garden feel;
- `emporium` - square, tight, purple vocabulary/product surface;
- `research` - SRS scholar-desk wireframe feel;
- `greenhouse` - AgentWorld IDE, dense workflow/agent operations, botanical but utilitarian.

### Agent IDE

The agent main pane now presents an agent as an editable operational object:

- baseball-card summary;
- model picker inspired by Garden chat controls;
- new conversation starter;
- embedded Garden document editor for the system prompt;
- save/promote prompt actions;
- right-pane agent graph and ontology journal.

System prompt changes and model changes are treated as agent ontology history, not just UI preference.

### Graph Viewer

`mn-graph-three` generalizes Garden's Three/WebGL graph stack into a Shrubbery component over the same `MnGraphNode` / `MnGraphEdge` substrate as `mn-graph`.

It supports:

- 2D flat mode;
- 3D sphere/orb mode;
- click selection;
- drag pan / orbit;
- wheel zoom;
- double-click reset;
- full-screen modal expansion.

The intent is that all graph views can share the same data contract while choosing the renderer that fits the task.

### Workflow IDE

Greenhouse now treats workflows as an IDE surface, not merely a sidebar grouping:

- sidebar `Workflow Grimoire`;
- workflows like `Do a chat turn`, `Read a book`, `Read a paper`, `Sophia Research Service`, `Paper Adapter Scout`, and `Compose a workflow`;
- `startWorkflow` preserves workflow identity instead of collapsing everything into ad-hoc runs;
- workflow ontology graph overlays `wf:Workflow`, `wf:Phase`, `wf:AgentNode`, `wf:WorkflowBinding`, `wf:Draft`, `wf:CompletenessGap`, `wf:RunStatistics`, and archetype nodes.

The main pane was reworked into a dense workflow object inspector:

- `Workflow Definition` hero with definition subject, source/identity kind, binding/draft chips, graph, metrics, and run command;
- readiness stage map: Definition, Draft, Binding, History;
- `Definition Authority` with `wf:name`, `wf:definitionSubject`, description, `wf:whenToUse`, store/identity contract, and seed lineage;
- `Workflow Readiness` from virtual `wf:Draft` / `wf:CompletenessGap`;
- `I/O Contract` from `wf:WorkflowBinding` with input/output JSON Schema;
- `Recent Runs` from `wf:RunStatistics`;
- `Eligible Agents`;
- `MO Object Index` that complements the right-pane graph.

This is grounded in Garden/Emporium's workflow Meaningful Object model, especially the live `/emporium/vocab/workflow` vocabulary where the pack is the catalog.

### Data Boundary

Fixture mode remains honest and explicit:

- AgentWorld, runs, events, workflows, prompt state, and bridge projection are in-memory fixture data.
- The fixture includes SRS-shaped tool events and workflow definitions so the UI can be developed without inventing a second app contract.

Fetch mode points at Choreograph:

- agents;
- runs;
- AgentWorld documents;
- event polling;
- system prompt save/promote;
- model changes;
- driver controls;
- workflow starts;
- cockpit session documents.

Fetch mode is the default. The app targets the local Choreograph VM at `http://127.0.0.1:3456` with documented local dev headers unless `?fixture=true` is passed. On boot, Greenhouse prefers `learner-1` when the live agent list contains it, then falls back to the first listed agent.

The local full-stack target is Choreograph plus platform-next/Garden via gateway MCP, documented in `apps/vehicle/README.md`.

Known local-only edges:

- bridge document mutation remains fixture-backed until the live document bridge endpoint lands;
- paper retrieval remains a stubbed integration seam at the SRS layer;
- some local history can be absent if the Choreograph persistence stack was not carrying prior conversation data.

## Human Factors / Ergonomics Pass

Greenhouse should be read as both an Agent IDE and a Workflow IDE.

The agent side answers:

- who is this agent;
- which model/prompt/tool world is it using;
- what has happened to it;
- how do I start or steer a conversation;
- what graph objects define it.

The workflow side answers:

- what is this workflow;
- where is its definition authority;
- is it runnable;
- what will it invoke;
- who can run it;
- what has happened recently;
- how does it sit in the workflow ontology.

The right pane is for graph exploration and history. The main pane is for operational judgment. Dense information is acceptable here because the user is steering repeated work, not reading marketing copy.

## Verification

Current focused verification:

```sh
pnpm --dir apps/vehicle typecheck
pnpm --dir apps/vehicle test:run
```

Both passed on 2026-07-01 after the workflow main-pane redesign:

- `tsc --noEmit` clean;
- 17 Vitest tests passed.

Recommended wider checks before merging this whole branch:

```sh
pnpm -r test:run
pnpm --dir apps/storybook build-storybook
```

## Next Work

- Wire the bridge tab to a live Garden document bridge endpoint.
- Replace SRS paper stubs with a host-owned paper adapter service that materializes the same source/run records.
- Add a graph document in `sophia-code-lab` for this Greenhouse implementation ledger if repo-to-graph mirroring becomes a recurring need.
- Promote more workflow definitions from fixture records into real Garden/Emporium workflow MO records.
- Add browser-level visual checks for the Greenhouse app once the dev server/story is stable.
