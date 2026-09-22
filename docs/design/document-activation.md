# Document Activation — cache-first live document readiness

**Status:** implemented and verified against real Gardend + Chromium (2026-07-29).

## Decision

Near-instant document opening is feasible and conceptually congruent with Shrubbery, with one
important boundary:

- reuse Surface Activation's **code-owned priority and bounded-work discipline**;
- do **not** represent a live document as a retained query store;
- do **not** preload a document by opening an invisible WebSocket provider.

A document is durable, mutable CRDT authority. Its local hydration, live synchronization,
presence, and view attachment are different phases. The implemented sibling concept is
**Document Activation**:

1. **hydrate** a shell-owned `Y.Doc` from memory, user-scoped IndexedDB, or a prefetched Y.Doc
   update;
2. **connect** that same `Y.Doc` to its authoritative room;
3. **activate** a visible editor view as soon as the document has trustworthy renderable state,
   while live synchronization continues.

This can make a warm revisit, session restore, or successfully anticipated navigation feel
instant. On its own it cannot guarantee an instant first-ever open of an arbitrary document:
without a local snapshot or completed prefetch, the first authoritative room sync remains a real
network round-trip. The later Source Mirror integration closes that gap for a completely activated
graph by importing every manifest document, including documents never made visible.

## Evidence

### Previous Shrubbery path

Before this implementation, the Organism path was network-gated:

- `packages/runtime/src/collab/editor-room-pool.ts` calls `CrdtBackend.open()` with no prepared
  document on first acquisition.
- Both concrete backends create a fresh `Y.Doc`, connect a `WebsocketProvider`, and immediately
  publish local awareness presence:
  `apps/organism/src/cell/{loopback,gateway}-crdt-backend.ts`.
- `packages/runtime/src/editor-host.ts` did not mount the live editor until
  `provider.whenSynced` resolved.
- Releasing the last `EditorRoomPool` lease immediately destroys the provider. There is no idle
  document-state pool and no `y-indexeddb` dependency.

That behavior was correct for authoritative first load and visible presence, but made every
reopen pay another sync gate.

Shrubbery already has deterministic signals for intelligent preparation:

- `CenterPaneNavigationState.back` and `.forward`, persisted per graph in session storage;
- the current document in each center pane;
- pinned/recent activity in `HomeActivityStore`;
- pointer/focus intent in the file tree and document switcher.

### Garden already proves the deployment-specific mechanisms

The current Garden frontend contains three relevant precedents:

| Deployment/path | Existing mechanism | Consequence |
|---|---|---|
| Hosted/web | `frontend/src/lib/yjs-persistence.ts` + `workspace-coordinator.ts` create user/graph/document-scoped `y-indexeddb` persistence, give it a 200 ms head start, and attach the document store before WebSocket synchronization | previously opened content can render from local durable state while the room connects |
| Native/local | `frontend/src/native/native-local-runtime.ts` retains detached document channels for five minutes and hydrates new channels from persisted Y.Doc bytes | back/revisit avoids rebuilding document state |
| Authenticated boot | `frontend/src/stores/session-store.ts` + `app-shell.ts` keep a user-scoped last graph/document navigation hint and speculatively start it before session sync | the most likely boot document begins early without cross-user leakage |

Garden also clears user-scoped databases on logout and removes deleted/orphaned document caches
through `DocumentCacheManager`. Those are correctness requirements, not optional cleanup.

### Real-cell probes

The assessment used
`/Users/vera/dev/sophia/garden/src-tauri/target/debug/examples/gardend` against Shrubbery's real
loopback integration path:

- the valid `picker-live.integration.test.ts` room handshake completed in **105 ms** locally;
- authenticated `GET /documents/{graph}/{document}/blob` returned a **local-file** Y.Doc update
  that hydrated correctly into a fresh `Y.Doc` (about **190 ms** in the debug probe);
- after the initial document projection existed, a second live edit was present in a blob fetched
  100 ms later, before the 600 ms cold-projection debounce. Gardend persists the hot
  `update-v1.bin` authority before acknowledging/broadcasting a client update.

The numbers are diagnostic, not WAN performance claims. They show why snapshot fetching at click
time is not itself the fast path: the fetch must happen earlier or seed a persistent local cache.

Object existence precedes room attachment. Opening a document WebSocket is not
creation testimony and must not resurrect a deleted or never-created object.
`create_document` persists the document lifetime and a canonical, decodable
empty Y.Doc update before the state is exposed. The blob boundary also
normalizes the legacy zero-byte empty sentinel to that portable representation.
A genuinely missing object remains a miss; activation must never turn it into
an empty, editable “authoritative” document.

## Ownership model

The invisible store the Surface talks to is congruent, but it must sit in the CRDT shell rather
than the Surface broker:

```text
navigation intent ──> candidate policy ──> bounded hydration queue (max 1)
                                                │
                                                ▼
                           user / graph / document state pool
                    (encoded Y.Doc state + persistence, no socket/presence)
                                                │
visible hoja.document lease ────────────────────┼──> live room connection
                                                │       (socket + awareness)
                                                ▼
                                      visible EditorView
```

The identities and lifetimes are deliberately separate:

- **document state** may survive a view and a connection;
- **connection/presence** exists only for a visible or otherwise explicitly live document;
- **EditorView** remains pane-local, while concurrent panes on one document share one room handle.

This preserves `EditorRoomPool`'s current single-presence invariant without making a speculative
read look like a collaborator who is actively viewing the document.

## Landed implementation

The production path now consists of:

- `packages/nucleus/src/activation-scheduler.ts` — dependency-free bounded,
  priority-aware, `AbortSignal`-cancellable work shared by Surface and Document
  Activation policies;
- `apps/organism/src/cell/document-activation.ts` — count- and byte-bounded memory LRU +
  user/graph/document IndexedDB records, snapshot validation, live-state
  persistence, deletion/logout cleanup, navigation hints, and the one-task
  preparation policy;
- `RestClient.documentUpdate()` plus the local and hosted transports —
  authenticated binary `GET /documents/{graph}/{document}/blob`, with 404
  preserved as a cache miss;
- both CRDT backends — cache hydration begins before the visible provider
  connects, but background preparation never constructs a provider;
- `ProviderHandle.whenRenderable` and `renderSource` — render readiness is
  distinct from `whenSynced`;
- `sh-editor-host` — mounts proven cached content immediately, allows local
  editing under explicit IndexedDB durability testimony, replays Yjs updates
  into the same view, and converges after the room synchronizes;
- Organism shell intent wiring — authenticated boot hint, nearest center-pane
  history, sidebar hover/focus, document-switcher highlight, graph cancellation,
  deletion invalidation, and pruning owned by verified complete Source Mirror
  epoch imports rather than potentially stale sidebar projections.

The IndexedDB record carries explicit authority metadata. Only a successful
snapshot read or a document that has completed live sync is persisted as
trustworthy. Merely opening an empty database never makes an empty editor
renderable.

## The contract change

`ProviderHandle.whenSynced` previously meant both "safe to render" and "the
initial room handshake finished." Cache-first activation separates those
meanings.

The landed contract evolution is:

- add a `whenRenderable` gate (or an equivalent reactive readiness fact);
- add a `whenEditable` gate: a validated durable cache is sufficient local
  authority, even before a network handshake;
- retain `whenSynced` as the authoritative initial-room-sync testimony;
- mount `sh-editor-host` on `whenRenderable`, not blindly on `whenSynced`;
- resolve `whenRenderable` from a proven local snapshot/cache hit or from live sync, whichever
  first establishes trustworthy document state;
- persist every pre-sync Yjs transition locally and expose its
  `pending | durable` state;
- on a cache miss, continue to gate on live sync. Never infer that an empty IndexedDB database
  proves an empty authoritative document.

The shell needs metadata that distinguishes:

- an IndexedDB database that has completed at least one authoritative sync;
- a snapshot-prefetched database;
- a newly created, still-empty persistence database.

`CrdtBackend.open(room, doc)` still owns the synchronous provider handle. The
concrete backends create one `Y.Doc` and begin cache hydration. Before connecting,
they validate the cached document's opaque server incarnation and carry it into
the WebSocket upgrade. Because Yjs updates commute, cached and remote operations
safely merge into that same object after the identity fence passes. The Surface,
room pool, editor kernel, and persistence layer remain separate.

## What this revisits in the Surface Activation work

It revisits the **underlying scheduling capability**, not the retained-store semantics:

- `createAsyncStore()` remains the right envelope for refetchable snapshots and rollups. A live
  `Y.Doc` should not gain `refresh()` or stale-while-refresh semantics.
- `LayoutResourceBroker` should keep disposing the last visible durable provider lease. Adding
  generic `retainForMs` to all durable resources would accidentally retain sockets and presence.
- `SurfaceActivationQueue` now delegates to the dependency-free
  `ActivationScheduler`. Surface retains its four-task profile; document
  hydration uses a separate one-task profile and forwards its `AbortSignal` to
  authenticated snapshot I/O.

In other words, the shared primitive is **bounded, cancellable activation work**. Query-store
retention and document-state persistence remain separate policies above it.

## Candidate policy

Preparation should be conservative and evidence-driven:

1. **Visible/current** — highest priority; always connect.
2. **Direct intent** — pointer hover/focus or keyboard highlight sustained for roughly
   100–150 ms; hydrate immediately, cancel when intent moves.
3. **Navigation adjacency** — hydrate the nearest back/forward entry for each active pane from
   memory/IndexedDB or the single background snapshot lane; the next visible activation preempts it.
4. **Authenticated boot** — speculatively hydrate the last user-scoped graph/document hint, then
   let authoritative session state correct it.
5. **Recent activity (optional; not enabled in the landed policy)** — at most one additional
   high-confidence document under an idle, unmetered policy. Do not preload every recent or pinned
   document.

Policy limits:

- at most one background network hydration at a time;
- visible activation preempts/cancels speculative work;
- graph, auth-user, and session-scope changes cancel work and rotate the pool namespace;
- no speculative WebSocket, awareness publication, cell keepalive, or editable empty document;
- bound resident update count/bytes independently from persistent IndexedDB quota.

## Implementation sequence

1. **Cache-first warm opens** — complete
   - introduce the user/graph/document state pool and IndexedDB persistence;
   - add trustworthy-cache metadata and logout/delete/orphan cleanup;
   - split `whenRenderable` from `whenSynced`;
   - prove cached content mounts before a deliberately delayed real room sync and later converges.
2. **Boot and history preparation** — complete
   - add the user-scoped navigation hint;
   - hydrate current/back/forward candidates locally with a one-task cancellable queue.
3. **Intent snapshot prefetch** — complete
   - expose the authenticated document-blob read through the shell contract;
   - prefetch only on strong intent or one high-confidence boot/history candidate;
   - treat 404 as a miss and let visible room sync win.
4. **Deployment-specific warm channels** — deliberately held
   - consider a five-minute disconnected/local channel pool only for an in-process native provider
     with no remote presence cost;
   - do not enable hosted hidden-provider retention by default.

## Release-gate evidence

- **Zero speculative presence/socket:** the real-browser harness observes no
  `/hocuspocus/docs/` WebSocket while sidebar intent fetches and persists a
  snapshot.
- **Cached-before-sync:** a real cached TipTap document mounts with
  `data-document-activation="offline-clean"` while Chromium is offline.
- **Offline editing:** mirrored documents remain editable; each local transition
  reaches `data-document-durability="durable"` before renderer teardown.
- **Same-view convergence:** remote and independently cached local operations
  converge after reconnect without replacing the active Y.Doc.
- **Identity safety:** deletion quarantines offline work and a same-ID
  replacement is protected by a Gardend-issued incarnation fence.
- **Fallbacks:** deterministic tests cover miss, corrupt update, schema mismatch,
  snapshot 404, cancellation, tombstone deletion, and logout cleanup.
- **Room identity:** the existing center-pane/room-pool suites continue to prove
  one shared `ProviderHandle` with pane-local EditorViews.
- **Source/timing testimony:** `renderSource` distinguishes
  `memory | indexeddb | snapshot | live`; manager events carry render/sync
  elapsed time, prefetch outcome/bytes, cancellation, and cache failures.

The executable real-system proof is
`apps/organism/scripts/offline-sync-later-gardend-browser.mts`
(`pnpm --dir apps/organism test:offline-sync-browser`). The complete graph
authority and source-mirror boundary is specified in
`docs/design/offline-sync-later.md`. The broader source-aware mirror and
Meaningful Objects verdict is specified in
`docs/design/offline-distributed-truth-audit.md`.
