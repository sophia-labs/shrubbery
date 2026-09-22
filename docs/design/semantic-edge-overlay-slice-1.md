# Semantic Edge Overlay — Slice 1 (design spec)

> Status: recon-grade design, implementer-ready. Derived from a read-only catalogue
> of Garden's real cross-pane behavior (`apps/organism/src/main.ts` + `cell/`
> controllers + the runtime render host), synthesized into a first slice and
> adversarially critiqued for coherence against the actual files.

## Thesis

Garden already has a semantic graph connecting its panes — it's just trapped as
imperative event listeners in `main.ts` and implicit store subscriptions. This
slice lifts a small, coherent **selection hub** out of that imperative glue and
into `:ux:config` as typed, directed **RDF edges between face IDs**, read by a
generic reactive **edge-interpreter**. It proves: a hardcoded
`currentInspectorSelection = …; rerender()` coupling becomes **one triple**; an
agent adds or retargets a pane coupling by writing a triple, no deploy; and
`mn-relations` renders the live edge set as a visible overlay. It touches **no**
layout mutation, **no** surface-swap navigation, **no** wire machinery, **no**
CRDT.

## The honest two-tier model (the key finding)

Not every coupling lifts equally cleanly. The catalogue split the hub edges by
how separable the current code is:

- **Tier A — fully interpreter-installed.** A standalone select event already
  exists (`mn-comment-select`, `mn-graph-panel-node-select`), so the interpreter
  subscribes the source and installs the behavior with **zero shell glue**. These
  are the load-bearing proof that a triple installs behavior.
- **Tier B — shell-published.** The coupling is fused into imperative navigation
  (`handleSidebarNodeOpen`, `activateDocumentSurface` — a ~40-line surface swap
  the editor component never announces via any event). Here the edge governs the
  **reflect half** (the inspector subscribes because a `drivesSelection` edge
  targets it); the **publish half** is a one-line `bus.publish()` swap inside the
  retained handler. An honest partial lift, not a fabricated `onEditorActivate`
  event.

## The five slice edges

| From | Predicate | To | Tier | Replaces (by symbol) |
|---|---|---|---|---|
| `face:comments` | `drivesSelection` | `face:inspector` | A | `handleCommentSelect` — the `currentInspectorSelection {kind:'comment'}` stamp |
| `face:graph` | `reveals` | `face:editor` | A | `handleGraphPanelNodeSelect` → `focusGraphBlock(blockId)` |
| `face:comments` | `reveals` | `face:editor` | A | `handleCommentSelect` → `setActiveComment(id,{scroll:true})` |
| `face:sidebar` | `drivesSelection` | `face:inspector` | B | `handleSidebarNodeOpen` folder / `openArtifactFromSidebar` |
| `face:editor` | `drivesSelection` | `face:inspector` | B | `activateDocumentSurface` (nav orchestration untouched) |

## Predicate vocabulary (with runtime semantics)

- **`drivesSelection`** — PUSH. Source's select event → `normalize()` →
  `SelectedObject` → `bus.publish()`. Tier-A sources are interpreter-installed;
  Tier-B sources publish inline. The **reflect** side is installed once per target.
- **`reflects`** — PULL / permanent inspector feed. The interpreter computes
  `reflectTargets = {edge.to | predicate ∈ {drivesSelection, reflects}}` and
  subscribes each target face's `reflect()` to the bus **once** (the dedup fix).
- **`reveals`** — IMPERATIVE, non-layout-affecting, no surface swap, no bus write.
  On the source's select event, `normalize()` → reveal anchor → `to.reveal()`
  (block focus / comment scroll).

## The `:ux:config` triple shape

One edge (graph reveals into editor), N-Triples (the byte-stable seed form):

```
<…#GardenDefault>        <…#hasConfigEdge> <…#GardenDefault-edge-0> .
<…#GardenDefault-edge-0> <…rdf#type>       <…#ConfigEdge> .
<…#GardenDefault-edge-0> <…#atIndex>       "0"^^<…#integer> .
<…#GardenDefault-edge-0> <…#from>          <…#face:graph> .
<…#GardenDefault-edge-0> <…#to>            <…#face:editor> .
<…#GardenDefault-edge-0> <…#predicate>     "reveals" .
```

- Subject is a **minted IRI** (`GardenDefault-edge-0`), **never a blank node** —
  `rdf-model.ts` `Term` is `iri | literal` only, so a `_:e` reification is
  unserializable. Mirrors the existing `RootEntry`/`AppRootEntry` indexed-entry
  pattern exactly.
- `from`/`to` are face IRIs in a `sux:face:<id>` id-space (the colon is a legal
  IRI char; face nodes carry no `localId` triple, so `localId()`'s prefix-strip
  fallback applies deterministically).
- `predicate` is a plain **literal** so the interpreter switches on it with no
  ontology lookup. Tier A vs B is a **runtime** property of the source face
  (does a `FacePort.onSelect` exist), **not** encoded in the triple — one shape
  serves both.

## Codec change (`ux-rdf.ts` + `types.ts`)

1. `types.ts`: `interface ConfigEdge { from; to; predicate }` and
   `readonly edges?: readonly ConfigEdge[]` on `WorkspaceConfig`.
2. **Serialize** after the Panels loop, mirroring the `RootEntry` pattern:
   emit `hasConfigEdge` link + `ConfigEdge` type + `atIndex` + `from`/`to`
   (through `iriFor`) + `predicate` (as `L()` literal).
3. **Parse** after the `hasRootEntry` loop: gather `hasConfigEdge` subjects,
   read `from`/`to`/`predicate`, index by `atIndex`, filter holes.
4. Attach `...(edges.length ? { edges } : {})`. Extend the WP0.1 round-trip test
   (`GARDEN_DEFAULT → serialize → parse → deepEqual`) with an edges-bearing config.

## Selection bus (`packages/nucleus/src/selection-bus.ts`)

Reuses the `createWireModeController` shape (`let state` + `Set<subscriber>` +
`emit()`) over the `ReactiveSource<T>` contract. **Identity currency is the
existing `SelectedObject` discriminated union** (`selection.ts` — `graphId`,
`documentId`, `blockId?`, plus comment/folder/artifact variants), **not** an RDF
node IRI (confirmed: `mn-graph` `node.id` is a local join-key; panes speak bare
strings).

```ts
export interface SelectionBus extends ReactiveSource<SelectedObject | null> {
  publish(sel: SelectedObject | null): void
}
export function createSelectionBus(initial = null): SelectionBus {
  let state = initial
  const subs = new Set<(v) => void>()
  const emit = () => { for (const cb of subs) cb(state) }
  return { get: () => state, subscribe: cb => { subs.add(cb); return () => subs.delete(cb) },
           publish: sel => { state = sel; emit() } }
}
```

**Critical:** the bus does **not** replace `let currentInspectorSelection`. That
variable stays the reflected model store for the whole slice; `inspector.reflect`
is one *additional* writer. ~16 deferred handlers keep writing it directly —
behavior-preserving two-write-path.

## Edge-interpreter skeleton (`packages/runtime/src/edge-interpreter.ts`)

Lives **outside** `render-workspace.ts` (contractually subscription-free);
invoked from `main.ts` right after `renderWorkspace(config, …)`. Two-pass:
PASS 1 subscribes each distinct reflect-target **once** (the dedup fix); PASS 2
wires publish + reveal per edge; unknown predicates `default: break` (no-op).
Returns a disposer that MUST run before re-install on config reload (idempotence).

`FacePort` adapters wrap the real plug points: `face:inspector` → `reflect` writes
`currentInspectorSelection`; `face:comments`/`face:graph` → `onSelect` + `normalize`
(Tier A); `face:editor` → `reveal` calls `focusGraphBlock` / `setActiveComment`;
`face:sidebar` → Tier B, no `onSelect` (its handler publishes inline).

## Overlay rendering

Reuse `mn-relations` unchanged — project `config.edges` into `MnRelation[]`
(the **same** single source the interpreter consumes: interpreter installs
*behavior*, `mn-relations` renders the *diagram* — the "one model, two consumers"
split the codec already documents). Tint Tier-B edges via the `note` field
(zero-cost honesty affordance). Subscribe the overlay to the bus so the firing
edge highlights live; route `mn-relation-select` back through `bus.publish`.

## Migration path (behavior-preserving, re-anchor by symbol)

- **Phase 0 — scaffold, zero behavior change:** land codec `edges`,
  `createSelectionBus`, `edge-interpreter.ts`, the 5-edge seed, FacePort adapters;
  call `installEdgeInterpreter` after `renderWorkspace`; install `inspector.reflect`
  as a permanent bus subscriber writing `currentInspectorSelection`. Verify.
- **Phase 1 — Tier-A comments edges:** delete the two imperative writes in
  `handleCommentSelect` (inspector stamp + `setActiveComment`), leave it pushing
  detail into `commentSelectEmitter`; interpreter installs both.
- **Phase 2 — Tier-A graph→editor reveals:** remove `focusGraphBlock` from
  `handleGraphPanelNodeSelect` (keep history push + emitter); interpreter's
  `reveals` edge calls it via `editor.reveal`.
- **Phase 3 — Tier-B sidebar:** swap `currentInspectorSelection = {…}` for
  `bus.publish({…})` in the folder/artifact branches; retain folder toggle +
  `currentSidebarSelectedId`.
- **Phase 4 — Tier-B editor:** swap the stamp in `activateDocumentSurface` for
  `bus.publish(…)`; the ~40-line nav orchestration is untouched. **No** "sole
  writer" claim, **no** mirror deletion.

## Proof demo (no code deploy)

An agent appends **one** edge to the cell's `:ux:config`:
`graph —drivesSelection→ inspector`. Graph node-select is Tier A (already
subscribed for its `reveals` edge), so no new plumbing. On the next read the
interpreter adds `face:inspector` to the reflect set (still one subscription —
deduped) and installs a publish from the graph select. A coupling that didn't
exist before: **graph picks now both scroll the editor (pre-existing `reveals`)
and drive the inspector to the picked block.** All four faces reflect the single
triple; the `mn-relations` overlay grows a `Graph → Inspector` row instantly.
Flip side: change edge-0's predicate literal from `reveals` to a deferred value —
the interpreter no-ops it, graph picks stop scrolling the editor; change it back,
the scroll returns. One triple edit, behavior appears/disappears, zero rebuild.

## Deferred (explicitly out of slice 1)

`navigatesTo` (surface-swap: document switcher, center panes, tagLens, artifact,
chat, dailyNotes); layout predicates (`togglesPanel`, `opensInSplit`);
`annotates` (comment-insert → panel visibility, hover highlight); `refreshes`
(graph refresh → sidebar/wire re-read); generic `command`; the 16 non-edge
writers of `currentInspectorSelection`; `filters` (fold into `scopesTo` as an
edge modifier); URL/popstate reflects; chrome toggles; **all** wire machinery;
validateConfig referential integrity (from/to reference real faces); feedback-loop
echo guards; CRDT/multi-tab selection persistence; agent authorization.

## Risks (from the adversarial critique)

- **Tier-B honesty:** a triple edit on sidebar/editor retargets only the reflect
  half; the publish stays in the handler. Don't oversell these as fully-data.
- **Reflect dedup is load-bearing:** subscribe `inspector.reflect` once per target
  (PASS 1), never once per edge, or you get 3× rerender per publish.
- **`currentInspectorSelection` is NOT replaced:** 16 deferred handlers keep
  writing it; the reflect port is one added writer. Don't attempt deletion.
- **Citation drift:** `main.ts` is concurrently edited — anchor by symbol, not
  line (e.g. `1429/1442` are graph→sidebar, not sidebar→inspector).
- **Payload dialect:** Tier-A resolvers must read the right field —
  `graphNodeToSelected` branches on `node.kind` and reads `node.blockId`, never
  `node.id` (a local join-key).
- **`reveals` vs `navigatesTo`:** interpreter must no-op unknown predicates
  (`default: break`), never fall through to a default behavior.
- **`render-workspace.ts` is subscription-free by contract:** the interpreter and
  bus live in `main.ts`/a runtime sibling, never inside the render host.
- **Install idempotence:** `installEdgeInterpreter` runs on every config reload;
  the disposer MUST run before re-install or subscribers leak.
- **Null-fallback parity:** `main.ts` does `currentInspectorSelection ??
  activeDocumentSelection(…)`; the bus initial value / reflect must preserve it.
- **Acyclicity:** the inspector's outbound edges (`onRelationOpen` re-drives
  editor+comments) are deferred, so slice 1 stays acyclic — keep it that way
  until an echo guard exists.
