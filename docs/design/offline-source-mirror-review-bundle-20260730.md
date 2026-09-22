# Surface Activation and complete offline source mirror — review bundle

**Prepared:** 2026-07-30

**Decision:** `GO` for the replicated graph data plane

**Deployment status:** local commits only; no push, image publication, canary
change, or production mutation

This is the reviewer entry point for the cross-repository change that began as
an Observatory loading problem and ended with a complete, source-aware,
offline/sync-later graph mode.

The implementation does two related but deliberately separate things:

1. **Surface Activation** makes graph-authored Surfaces mount structurally,
   schedule bounded concurrent work, reuse retained derived stores, and avoid
   the old sequential visual reveal.
2. **Source Mirror and Document Activation** give those Surfaces a complete,
   durable, identity-fenced local authority that can cold-start and accept
   graph-native work while every cell route is unavailable.

The first is an execution and presentation lifecycle. The second is a
distributed source protocol. Keeping that line sharp is the central design
decision.

## 1. Exact commit bundle

Review these commits as one protocol change:

| Order | Repository / branch | Commit | Responsibility |
|---|---|---|---|
| 1 | Garden `feat/koch-morse-mo-pack` | `32fa25bf941bc1f76deb4ee88a87a73c2714410b` | authoritative source ledger, complete pull, typed push, rebuild, graph/document incarnation |
| 2 | platform-next `codex/park-platform-next-dirty-20260625` | `45645c876bd01a60d42f5f718a5d3c95557c31db` | hosted owner-claim identity, exact create repair, stale delete fencing |
| 3 | Shrubbery `feat/shrubbery-convergence-koch-20260729` | `72e9d74715873700160231e4213d2f5e6b65671b` | activation/store runtime, browser durability, offline mutation routing, complete functional harness |
| 4 | Shrubbery, following documentation commit | this document | review map and exact evidence ledger |

The commits are intentionally independent repository checkpoints. A local
Garden proof does not require platform-next, but a hosted offline graph
lifecycle does.

The pre-existing untracked
`platform-next/scripts/deploy-gardend-canary.sh` is not part of this bundle.

## 2. Why this exists

Observatory Surface leaves previously performed first-load work through an
incidental sequential traversal:

```text
solve layout
  -> mount one leaf
  -> await its first query
  -> mount the next leaf
  -> await its first query
  -> ...
```

That made the interface slow and visually unappealing even when total backend
work was reasonable. The immediate need was bounded lazy/background loading.

The deeper design question was where warmed data should live. Shrubbery
already had reactive stores and keyed resource brokers, but neither a Surface
nor a query-result cache should become source authority. Completing that
primitive exposed the larger offline requirement:

- retained query data is useful for fast revisits;
- document state needs durable local identity and per-edit persistence;
- a complete graph needs more than documents;
- Meaningful Objects need source-kind-specific merge rules;
- graph/document deletion and recreation need lifetime fences;
- retryable hosted graph creation crosses gateway state outside the cell.

The result is one coherent source architecture rather than a pile of endpoint
caches.

## 3. Conceptual model

```text
user/navigation intent
          |
          v
Surface Activation
  priority + cancellation + bounded concurrency
          |
          +---------------- retained derived store ----------------+
          |                  stale-while-refresh                    |
          |                                                         v
          |                                                     Surface faces
          v
Source Mirror runtime
  complete epoch + manifest + graph incarnation
  source members + resources + semantic corpus
  durable mutation/lifecycle outboxes
  pending/conflict/recovery testimony
          |
          +---------------- Document Activation -------------------+
          |                  Y.Doc + incarnation                    |
          |                  render/edit/sync gates                 |
          v                                                         v
typed at-least-once source transport                           live editor room
          |
          v
Gardend source authority
  operation ledger + CRDT/event/current-state laws
  authoritative graph/document lifetimes
  disposable RDF/semantic/workspace faces
          |
          v
platform-next hosted lifetime boundary
  owner claim + graph registry + cell identity
```

### Ownership boundaries

- A **Surface** declares demand and renders a face.
- A **retained derived store** owns temporary query execution state.
- **Surface Activation** owns scheduling and cancellation.
- **Document Activation** owns cached document state and live-edit readiness.
- The **Source Mirror** owns local completeness, durability, outboxes, and
  source identity.
- **Garden** owns canonical source acceptance, merge/conflict rules, and
  projection rebuild.
- **platform-next** owns hosted tenancy/ACL and graph registry identity.

No layer infers a durable object merely because a view opened.

## 4. Surface Activation

The shared dependency-free `ActivationScheduler` provides:

- a configurable concurrency bound;
- foreground-before-background priority;
- cancellation via `AbortSignal`;
- queue removal and safe task retirement.

The runtime's `SurfaceActivationQueue` uses that primitive with a default
four-task budget. The layout interpreter stages sibling wrappers first and
then activates content, so the Surface appears structurally as one composition
instead of sequentially growing leaf by leaf.

`ShrubberyStore<T>` now supports:

- concurrent refresh deduplication;
- explicit captured-at and prior-read testimony;
- stale-while-refresh continuity;
- stale data plus refresh-error continuity.

`LayoutResourceBroker` may retain an adapter result for an explicit bounded
idle interval. Query-backed faces use that path; live documents do not.
Retained state is invalidated when the injected engine/session identity
changes, and teardown prevents a detached task from repopulating a dead store.

Key files:

- `packages/nucleus/src/activation-scheduler.ts`
- `packages/nucleus/src/reactive-store.ts`
- `packages/runtime/src/layout/surface-activation.ts`
- `packages/runtime/src/layout/resource-store.ts`
- `packages/runtime/src/layout/resource-broker.ts`
- `packages/runtime/src/layout/layout-interpreter.ts`

## 5. Document Activation

Document Activation separates three facts that used to collapse into one:

- `whenRenderable`: trustworthy local or live state can paint;
- `whenEditable`: local edits have a durable IndexedDB path;
- `whenSynced`: the initial live room handshake completed.

A validated local snapshot can satisfy the first two while disconnected.
Opening a provider or an empty IndexedDB database cannot.

The document manager provides:

- user/graph/document-scoped IndexedDB records;
- count- and byte-bounded in-memory retention;
- Gardend-issued document incarnation validation;
- persistence of every disconnected Yjs transition;
- snapshot prefetch without speculative WebSocket/presence;
- boot, history, hover/focus, and switcher intent preparation;
- deletion quarantine for unsynced local work;
- logout, graph change, deletion, and complete-mirror pruning.

The complete Source Mirror imports all document bodies, including documents
the user never opened. Navigation history is therefore a prediction input,
not a completeness mechanism.

Key files:

- `apps/organism/src/cell/document-activation.ts`
- `apps/organism/src/cell/document-update-transport.test.ts`
- `packages/runtime/src/editor-host.ts`
- `packages/runtime/src/collab/live-editor.ts`
- `docs/design/document-activation.md`

## 6. Complete Source Mirror

The local source mirror is an atomic IndexedDB commit containing:

- graph metadata;
- workspace Y.Doc;
- every document Y.Doc and incarnation;
- current-state objects and conflicts;
- event, memory, valuation, and retraction sources;
- operation registry and receipts;
- original resource bytes;
- document history;
- semantic corpus and capability metadata;
- legacy RDF/value-store baselines;
- current RDF projection as an acceleration artifact.

Completeness is an explicit manifest fact. The client rejects:

- a bundle whose manifest omits an included payload member;
- missing, duplicated, or foreign members;
- member digest or manifest digest mismatch;
- wrong graph/source kind/incarnation;
- authority revision rollback;
- the same epoch paired with a different manifest.

The previous complete epoch remains readable until the next complete epoch
commits atomically.

The epoch is:

```text
graph-incarnation : source-ledger-revision : complete-manifest-hash
```

The manifest hash closes a real invalidation gap found by the deeper harness:
direct Garden document creation changed authoritative content while the source
ledger revision stayed unchanged. Without content binding, epoch-keyed query
and Surface faces could remain stale. Garden and Shrubbery now both enforce the
content-bound form.

Key files:

- `packages/source/src/mirror/source-mirror.ts`
- `packages/source/src/mirror/source-sync-transport.ts`
- `apps/organism/src/cell/source-mirror-indexeddb.ts`
- `apps/organism/src/cell/source-mirror-runtime.ts`

## 7. Local mutation and sync-later delivery

Recognized user and agent actions become typed source operations:

- graph metadata;
- graph and document lifetime;
- workspace/document Y.Doc updates;
- mediated CRDT commands;
- current-state candidates and resolutions;
- event-log, memory, valuation, and retraction events.

The acceptance path is:

```text
intent
  -> validate representable canonical operation
  -> persist operation atomically in IndexedDB
  -> project mirror + outbox into active UI
  -> return local acceptance
  -> background push
  -> validate exactly one content-bound receipt
  -> pull and atomically commit the next complete epoch
```

Every operation is canonicalized with the same serde defaults Garden uses.
Receipts must match graph, incarnation, operation ID, and operation digest.
Missing, duplicate, foreign, or content-mismatched receipts fail the push
without erasing the durable intent.

A temporary projection/effect failure after source acceptance remains pending
repair. It is not mislabeled as a semantic conflict. Runtime liveness covers
both pending pushes and a transient initial pull; an incomplete mirror keeps
retrying even when no mutation is pending.

Product read-your-writes is supplied by
`offline-workspace-overlay.ts`: pending typed operations are folded over the
last verified mirror and remain visible after a cold renderer restart.

Untyped SPARQL UPDATE stays online-only because arbitrary RDF deltas have no
general reconciliation law.

## 8. Meaningful Object source laws

| Source kind | Offline merge law |
|---|---|
| workspace/document CRDT | Yjs/yrs update merge, fenced by document lifetime |
| event log | stable event-ID set union and deterministic fold |
| memory/valuation/retraction | observer-aware stable event union |
| current state | observed-base candidates; explicit conflict or declared executable reconciliation |
| derived | epoch-bound rebuild from mirrored source or invalidatable artifact |
| lifecycle | client-minted incarnation + stable operation + expected old incarnation |

The durable object is its identity, source, operation history, reconciliation
policy, and lifetime. RDF, blocks, sidebar rows, semantic entries, and Surface
components are faces.

## 9. Garden authority

Garden adds:

- an atomic per-graph source ledger;
- MCP tools `source_pull`, `source_push`, and `source_rebuild`;
- complete source-bundle construction;
- content-bound operation receipts;
- source-kind-specific merge and conflict behavior;
- destructive projection replay from source;
- client-minted graph and document lifetimes;
- canonical non-zero empty Y.Doc state;
- source-gate serialization with existing room/CRDT paths;
- stable document incarnation sidecars;
- lifecycle testimony in REST, MCP, graph records, and tool catalogues.

The authoritative implementation is documented in Garden's
`docs/source-sync-offline-contract.md`.

## 10. Hosted gateway boundary

platform-next stores the offline create identity on the conditional owner
grant before cell creation:

- `graph_incarnation`;
- `created_by_operation_id`.

An exact retry resumes the claim and does not consume quota again. A different
lifetime at the same slug conflicts. Identity-bearing deletion validates the
owner grant and live cell incarnation, while an exact retry after full absence
returns the desired `204`.

The gateway behavior is documented in
`platform-next/docs/offline-graph-lifecycle.md`.

## 11. Failure matrix

| Fault | Proven result |
|---|---|
| network absent before first visible edit | cached document remains editable and durable |
| renderer closes while offline | cold reopen reads complete mirror and pending work |
| two independent browser clients diverge | both reconnect orders converge |
| Node Yjs and MCP write concurrently | source and document truth converge |
| request fails before acceptance | stable intent retries |
| acknowledgement is lost after acceptance | duplicate receipt repairs without duplicate effect |
| receipt is partial or has bad digest | client retains pending source and rejects acknowledgement |
| source effect temporarily fails | accepted intent remains repairable |
| invalid operation appears late in batch | no accepted prefix |
| batch exceeds 1,000 operations | atomic rejection |
| duplicate batch is shuffled and replayed | stable revision/idempotent truth |
| authoritative content changes at same ledger revision | manifest and epoch change |
| IndexedDB mirror transaction aborts | prior complete epoch remains; no partial exposure |
| IndexedDB outbox transaction aborts | no phantom durable intent |
| Gardend receives SIGKILL | cold disk hydration recovers accepted truth |
| graph/document is deleted and recreated at same ID | stale client is fenced; local work is recoverable |
| projections are destroyed | rebuild reproduces source and projection set |

## 12. Functional evidence

### Broad suites

- `@shrubbery/source`: 11 files passed; 152 tests passed; 10 explicitly
  skipped.
- `@shrubbery/organism`: 90 files passed; 533 tests passed.
- Organism TypeScript typecheck: clean.
- platform-next gateway: 148 tests passed.
- Garden source-sync focused tests: 9 passed.
- Garden document-incarnation focused tests: 2 passed.
- Garden release Gardend build: passed.

### Six-part distributed-truth gate

`verify:offline-distributed-truth` completed with
`replicatedDataPlaneVerdict: GO`:

1. full persistent Chromium journey;
2. the same full persistent WebKit journey;
3. real-cell source-authority proof;
4. three-seed five-client source chaos;
5. real Chromium and WebKit IndexedDB atomicity;
6. residual Meaningful Object/source capability audit.

Both browser engines exercised:

- two independent persistent profiles;
- cold renderer restart with every `/cell/**` route partitioned;
- a complete mirror containing a never-opened document;
- editing before network;
- concurrent Node Yjs and MCP writes;
- reconnect orders A→B and B→A;
- three reconnect-idempotence cycles;
- two hard Gardend restarts;
- presence isolation;
- delete/recreate and recovery boundaries;
- cold pending-product read-your-writes;
- canonical reconciliation;
- zero page errors.

The chaos campaign used seeds `11`, `29`, and `47`, five clients per authority,
and paired arrival schedules:

- 210 unique operations across six authorities;
- 24 injected before-accept/lost-ack/partial-receipt/bad-digest failures;
- 60 duplicate batches;
- invalid-prefix and oversize atomicity;
- current-state conflict plus event/valuation set union;
- CRDT merge, destructive rebuild, and six cold hydration witnesses.

The exact Gardend executable was:

```text
/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend
sha256 da328259bbd4495e84ad5e978f740ce2b1981c6130fa457074db008b9d75a3b3
```

## 13. Reproduction

From the Shrubbery worktree, with the Garden release binary available:

```sh
pnpm --dir packages/source test
pnpm --dir apps/organism test
pnpm --dir apps/organism typecheck
SHRUBBERY_TRUTH_PROGRESS=1 \
  pnpm --dir apps/organism verify:offline-distributed-truth
```

Focused proofs:

```sh
pnpm --dir apps/organism test:offline-sync-browser
pnpm --dir apps/organism test:offline-sync-webkit
pnpm --dir apps/organism test:source-sync-truth
pnpm --dir apps/organism test:source-sync-chaos
pnpm --dir apps/organism test:source-mirror-idb-chaos
```

Garden:

```sh
cargo test --manifest-path src-tauri/Cargo.toml \
  --no-default-features --features headless --lib source_sync
cargo test --manifest-path src-tauri/Cargo.toml \
  --no-default-features --features headless --lib document_incarnation_store
```

platform-next:

```sh
rustfmt --edition 2024 --check \
  gateway/src/acl.rs gateway/src/grants.rs gateway/src/routes.rs \
  gateway/tests/acl_tests.rs gateway/tests/common/mod.rs
cargo test --manifest-path gateway/Cargo.toml
```

The scoped `rustfmt` command is intentional: the platform branch already has
formatting drift in untouched `config.rs`, `error.rs`, and `ratelimit.rs`.
This bundle does not rewrite those unrelated files.

## 14. Suggested review order

1. Read this document and `offline-distributed-truth-audit.md`.
2. Review Garden's `SourceOperation`, ledger acceptance boundary, pull
   manifest construction, and rebuild.
3. Review Shrubbery's canonical operation digest and mirror validation against
   Garden's serde wire defaults.
4. Review IndexedDB transaction boundaries and previous-epoch preservation.
5. Review document/graph incarnation creation and destructive-operation gates.
6. Review platform-next's owner-claim crash boundary and exact-retry branches.
7. Review runtime cancellation/session rotation and absence/presence rules.
8. Run the focused source tests, then the six-part gate.

Highest-risk files:

- Garden `src-tauri/src/source_sync.rs`
- Shrubbery `packages/source/src/mirror/source-mirror.ts`
- Shrubbery `apps/organism/src/cell/document-activation.ts`
- Shrubbery `apps/organism/src/cell/source-mirror-runtime.ts`
- platform-next `gateway/src/routes.rs`

## 15. Scope and residual boundaries

The accepted scope is the replicated graph data plane:

- Meaningful Object sources and conflicts;
- graph metadata and lifecycle;
- workspace/document CRDT;
- original resources and history;
- local RDF and semantic retrieval;
- derived projections;
- typed pending product operations.

Two non-local facts remain outside that claim:

- a partitioned client cannot observe a concurrent gateway ACL revocation;
- an unbundled external model, parser, connector, web resource, or device
  cannot execute or reveal new facts while absent.

The product may fail closed, use bounded offline capabilities, queue an effect
intent, or bundle a local implementation. Those policy decisions do not change
the `GO` verdict for replicated graph truth.

Playwright WebKit gives strong engine-level evidence for the Tauri-relevant
browser family. The macOS Tauri WKWebView shell itself was not automated in
this campaign.

## 16. Review outcome sought

Review should answer:

1. Are the source-kind merge laws and lifecycle boundaries the intended
   product semantics?
2. Is the manifest/receipt integrity boundary strong enough to be a local
   authority?
3. Is the gateway owner claim the right hosted crash boundary?
4. Are the recovery/conflict testimonies legible enough for product UI?
5. Is this commit set ready to rebase onto the selected Garden, Shrubbery, and
   platform-next convergence lines?

No deployment follows automatically from approval. Rebase, immutable build,
canary selection, and rollout remain separately reviewed actions.
