# Surface Unification — one layout system, one engine

**Status:** Stages A–C landed (`feat/surface-radical-overhaul`, 2026-07-21).
Surface Activation landed 2026-07-29. Stage D deferred (see §7).

**North star:** sophia-code-lab `the-surface-north-star-20260716` — the main pane is ONE forkable,
agent-composable layout-document of (Resource × Face) leaves.

## 1. What existed before (the seam this removes)

Two disjoint layout systems shared one screen:

1. **The workspace Surface** (canonical): `assembleWorkspaceSurface` derived a `LayoutDocument`
   from the `sux:` WorkspaceConfig spine and rendered it through `<sh-workspace-surface>` with
   BOUND faces — leaf values pushed through `WorkspaceSurfaceBindingStore` by `params.bindingId`.
2. **The legacy dashboard interpreter**: a SECOND `LayoutInterpreter` + query-backed `FaceRegistry`
   (`stat.scalar`, `chart.vega-lite`, `card.subject`, `sparql.bindings-table`, `sophia.home`) +
   `ResourceBroker` over `makeQueryBlockService(rest)`, mounted as ONE opaque `layout.dashboard`
   leaf via the `sh-layout-dashboard` host element (`layout-dashboard-mount.ts`), reading/writing
   `ux:layoutJson` on its own.

Both stacks already shared the underlying engine (`LayoutInterpreter`), but not the registry, the
broker, the divider chrome, or the document. The dashboard was a window nested inside a window.

## 2. Stage A — one face system

Query-backed **engine faces** are now first-class citizens of the workspace Surface:

- `packages/runtime/src/layout/fragment-face-set.ts` — the CLOSED catalogue
  (`createFragmentFaceRegistrations`, `createFragmentResourceAdapters`,
  `createFragmentFaceRegistry`, `FRAGMENT_GRID_COLLECTION_ADAPTER_ID`). Three consumers build from
  it and only it: the Surface element, splice validation, and the shell loader.
- `defineWorkspaceSurfaceElement(tag, catalogue, engine?)` accepts a
  `WorkspaceSurfaceEngineExtension`: full `FaceRegistration`s registered on the SAME sealed
  registry as the bound faces, plus adapters built ONCE over a **service resolver**. The element
  stays service-agnostic: each `WorkspaceSurfaceBuild` may carry `engineService` (the session's
  `QueryBlockService`, from `RenderWorkspaceOptions.fragments.queryService`); the resolver reads
  the CURRENT build's service at acquire time, so a session swap re-routes the next acquire with
  no re-registration. All query adapters are `derived`-shaped: their reactive snapshots may be
  retained briefly inside one Surface broker, but are never durable or shared across sessions.
- `WorkspaceSurfaceBindingStore` is scoped to the BOUND face-id set; engine leaves resolve through
  the broker and never need a `bindingId`.
- `LayoutSurfaceController` passes `gridCollectionResourceAdapterId` through to the interpreter,
  so collection-bound grids work inside the workspace Surface.
- Sealed-face posture unchanged: registry sealed at element construction; engine faces registered
  before `seal()`; `FaceRegistry`'s open-params allowlist and the broker's named-adapter
  discipline untouched.

With no service supplied, an engine leaf degrades to the face's own visible error state (or the
interpreter's `resource-unavailable` leaf) — never a blank pane.

## 3. Stage B — graph-authored subtrees, generalized

### 3.1 Vocabulary (the one addition)

- **Marker** (unchanged, verbatim): a region with `sux:renderedByComponent "sh-layout-dashboard"`
  declares "this region's subtree is a graph-authored layout fragment". Kept in
  `KNOWN_COMPONENTS`; `LAYOUT_DASHBOARD_COMPONENT` is now ONLY a marker — no custom element is
  registered under the tag anymore.
- **NEW, optional:** `sux:fragmentSurface <iri>` on the region — the SUBJECT whose
  `ux:layoutJson` literal (same `:ux:config` named graph) authors the subtree. Absent ⇒ the shell
  defaults to `urn:sophia:ux:surface:observatory-dashboard`.
  - TS: `RegionConfig.fragmentSurface?: string | null`.
  - Serialized as an IRI object, VERBATIM (never `iriFor`-minted, never localId-shortened);
    parse reads the raw IRI term. Round-trip pinned in `ux-rdf.test.ts`.
  - **Back-compat:** the deployed canary observatory seed carries no `sux:fragmentSurface` and
    keeps rendering identically via the default. **No canary re-seeding required.**

### 3.2 The splice (`packages/runtime/src/layout/fragment-splice.ts`)

`spliceFragmentDocument(fragment, regionId, registry)`:

1. Region-id grammar guard (`[A-Za-z0-9_-]+` — a `:` would make the encoding ambiguous).
2. `createValidatedLayoutDocument` against the fragment face catalogue (registration + grid
   eligibility + all structural invariants), plus the collection `itemFaceId` membership check
   `validate.ts` defers. Invalid ⇒ `{ok:false, reason}` — the caller renders an honest
   `invalid` leaf; the fragment NEVER reaches the assembled document.
3. Namespacing: every node id becomes `frag:{regionId}:{originalId}` (split children remapped;
   leaf/grid nodes carry no `nodes`-map references). The assembler never mints `frag:`-prefixed
   ids, and regions cannot collide with each other — collision-proof by construction.
4. Provenance: namespaced split id → ORIGINAL id map, consumed by ratio persistence.

### 3.3 Assembly (`render-workspace.ts`)

`RenderWorkspaceOptions.fragments: { queryService, regions, onFragmentChange }` where
`regions[regionId] = { surfaceIri, state: loading | error(error) | ready(doc) }`.
Any marker region (center or otherwise — `regionNode` routes every marker region through
`engineRegionRole`'s center classification) becomes:

- `ready` ⇒ the spliced subtree, nodes merged into the ONE workspace document; every fragment
  split records metadata `{kind:'fragment', regionId, surfaceIri, fragmentSplitId}`.
- `loading` / `error` / splice-`invalid` / no entry (`missing`) ⇒ one `layout.fragment-status`
  leaf (`[data-layout-fragment-status="…"]`) with the surface IRI and the honest reason. Never a
  blank pane. The rest of the workspace renders regardless.

## 4. Stage C — interaction + persistence through the engine

- Fragment dividers are ordinary Surface splits (policy: enabled, default 100–9900 bounds).
- The model mirrors fragments the way it mirrors `panelLayout`: `applyFragmentRatio` applies
  `set_ratio` — with the ORIGINAL split id — to the fragment's OWN document through
  `applyOperation`'s full invariants, updates the model-local live copy (so a mid-drag
  ResizeObserver rebuild re-splices dragged geometry), and emits `onFragmentChange
  {regionId, surfaceIri, doc, phase, source}`.
- **Persist-scope isolation (the invariant, with proof):** the emitted `doc` is the fragment
  document in original ids — it never contained a spine node, and spine drags return through the
  panel-layout path before the fragment branch can see them.
  `render-workspace-fragment.test.ts` pins BOTH directions: a fragment divider commit serializes
  with **no** `workspace-`/`frag:`/`center-` substring; a spine divider commit never reaches
  `onFragmentChange`.
- Shell (`apps/organism/src/cell/workspace-fragments.ts`, replacing `layout-dashboard-mount.ts`):
  `WorkspaceFragmentsController.optionsFor(config, session)` discovers marker regions
  (`fragmentRegionsOf` — `sux:fragmentSurface` or the default), loads each via the generalized
  `loadObservatoryLayoutDocument({surfaceIri})` over the session's Editor-eligible `RestClient`
  (all three production contracts), re-renders once per settle, holds the doc on BOTH change
  phases, and persists `commit` phases through `createLayoutPersister` → `observatory-layout-sink`
  (serialized DELETE+INSERT of the fragment's OWN literal). The canned observatory fallback now
  applies ONLY to the default surface; an unauthored non-default surface is an honest error.
- Deleted: `layout-dashboard-mount.ts`, the `sh-layout-dashboard` HOST ELEMENT, the
  `layout.dashboard` face, `RenderWorkspaceOptions.dashboard`, `WorkspaceDashboardOptions/Handle`.
  Kept: `observatory-layout-source/sink/layout-persister` as the fragment IO layer.

## 5. Surface Activation

**Surface Activation** is the code-owned lifecycle that turns a solved Surface structure into
live content without making the layout document a network scheduler.

It composes two existing Shrubbery ideas rather than introducing a second state ontology:

1. `ShrubberyStore<T>` remains the canonical reactive `idle | loading | ready | error` envelope.
   `createAsyncStore()` completes its common runtime behavior: concurrent-refresh dedupe,
   capture time, previous-read testimony, and stale-while-refresh/error continuity.
2. `LayoutResourceBroker` remains the keyed lease boundary. Ordinary derived adapters are still
   fresh per acquire. A derived adapter that declares `retainForMs` opts into a keyed background
   value—normally a `ShrubberyStore`—shared across concurrent leaves and retained for a bounded
   idle window. This is cache/execution policy, never durable domain identity.

The activation sequence is:

1. The interpreter stages sibling wrappers and face shells in document order.
2. A face observes the store immediately. A warm read paints synchronously; with no retained read,
   it paints an honest loading state.
3. `SurfaceActivationQueue` schedules refresh work under one broker-owned budget (four concurrent
   tasks by default). Visible work drains before background work; neither priority may exceed the
   cap.
4. Refresh publishes `loading` while retaining the prior read, then `ready` or `error`. The face
   therefore stays populated during revalidation.
5. The last visible lease starts the adapter's idle-retention window (60 seconds for query-backed
   faces). A revisit reuses the store. Surface/session teardown calls `clearRetained()`; active or
   still-computing values retire on their last release, so a detach race cannot repopulate the
   invisible store.

The workspace host treats a changed `engineService` identity as a hard resource-scope boundary:
it rotates the broker's retained namespace and remounts resource-bearing leaves, fixed-grid cells,
and collection bindings even when their graph-authored descriptors are byte-identical. A warm
snapshot can therefore cross a tab revisit, but never a session/auth-service swap.

This retained broker store is a bounded derived-value optimization, not a
durable offline mirror. A complete offline workspace needs a shell-owned,
source-aware mirror keyed by graph incarnation and Meaningful Object identity;
Surface Activation may express foreground/background demand to it but must not
invent convergence semantics. See
`docs/design/offline-distributed-truth-audit.md`.

`stat.scalar`, `chart.vega-lite`, `sparql.bindings-table`, `card.subject`,
`obs.evidence-chain`, and collection-query grids use this path. Split branches, fixed-grid cells,
and returned collection cells mount concurrently; the queue—not incidental tree traversal—sets
the backend pressure.

The lifecycle deliberately keeps two boundaries distinct:

- DOM shells and retained values become visible as activation proceeds.
- `reconcile()` / `workspaceSurfaceReady` still settle after the visible first refresh round, so
  existing callers that await content readiness keep their contract.

Inactive tabs remain lazy. Proactive background prewarming is a later policy decision; the
priority and retained-store seams now exist, but this slice does not silently spend bandwidth on
content the user has not activated.

Live documents deliberately do not use retained query stores. The cache-first sibling lifecycle
and the small scheduling capability it shares with Surface Activation are specified in
[`document-activation.md`](./document-activation.md).

### Honest costs / knowns

- Cold activation still pays the same total query cost; bounded concurrency shortens wall-clock
  latency and structural-first mounting removes the sequential visual reveal.
- Persist failures surface via `onPersistError` → `console.error` (the old mount's status line is
  gone; a UI-level surfacing slot is an open nicety). The optimistic in-memory layout is not
  reverted — durability, not the swap, is what a failed write loses.
- The old dashboard status header (loading/ok/fallback/error chrome line) is replaced by the
  per-region status LEAVES; the `fallback` case currently renders without a banner. If "canned
  fallback, not graph-authored" must stay user-visible, add a `fallbackNotice` to
  `WorkspaceFragmentState` — one render case, no engine change.
- Multi-client convergence of `ux:layoutJson` remains poll/last-writer-wins, exactly as before.

## 6. Proof map

| Invariant | Test |
|---|---|
| Engine faces mount through the ONE registry/broker/interpreter | `layout/__tests__/workspace-surface-engine-faces.test.ts` |
| Splice: namespacing bijection, validation, honest refusals | `layout/__tests__/fragment-splice.test.ts` |
| Spliced render, honest status leaves, persist-scope isolation (both directions) | `__tests__/render-workspace-fragment.test.ts` |
| Marker = config authority; honest missing state; no-marker ignores fragments | `__tests__/render-workspace-fragment-marker.test.ts` |
| `sux:fragmentSurface` verbatim round-trip; absent stays absent | nucleus `workspace/__tests__/ux-rdf.test.ts` |
| Shell load/persist-on-commit/uniqueness/default-only-fallback/session-reset | organism `cell/workspace-fragments.test.ts` |
| Graphs without markers render as before | entire pre-existing surface/organism suites, unmodified |
| Async-store dedupe + stale continuity + testimony | nucleus `reactive-store.test.ts` |
| Bounded/priority activation | runtime `layout/__tests__/surface-activation.test.ts` |
| Retained-derived sharing, eviction, and teardown races | runtime `layout/__tests__/resource-broker.test.ts` |
| Structural-first sibling mounting + warm collection reconciliation | runtime `layout/__tests__/layout-interpreter{,-grid}.test.ts` |

## 7. Stage D — the spine as a first-class LayoutDocument (deferred, deliberately)

The remaining asymmetry: fragments are LayoutDocuments; the SPINE is still derived from `sux:`
config + shell options on every build. Making the workspace's own spine a `ux:layoutJson` document
at workspace scope needs, concretely:

1. **A binding contract for graph-authored leaves.** Spine leaves are BOUND faces whose values
   (pane projections, panel options, editor hosts) exist only in the shell per render. A
   graph-authored spine document must name them by a STABLE public id vocabulary
   (`bindingId` ⇒ well-known slot names: `center-pane:primary`, `panel:chat`, …) with a shell-side
   resolver that maps slots → live bindings and degrades honestly for unknown slots.
2. **A merge discipline** between the document (authored geometry) and the shell's per-render
   option-driven structure (panels appear/disappear, collapse states, daily-note chrome). The
   Stage-C fragment mirror (`liveFragments`) generalizes, but every `assembleWorkspaceSurface`
   special case (rails, pane frames, daily header, collapse) must become either document content
   or a declared overlay.
3. **A config marker** (e.g. `sux:spineSurface` on the Workspace node) so every existing graph
   renders byte-identically without it — same back-compat posture as `sux:fragmentSurface`.
4. **Write-back scope rules**: which interactions persist to the spine document vs. remain
   session-ephemeral (today's panel widths live in shell prefs; a spine document would subsume
   them — a real product decision, not just plumbing).

None of this is speculative machinery worth building at 3am against the "byte-identical without
the marker" bar; A–C landed solid instead. The splice/mirror/persist seams above are exactly the
pieces D composes from.
