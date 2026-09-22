# Offline, sync-later graph mode

**Status:** implemented and functionally verified `GO` for the replicated graph
data plane (2026-07-30), including Chromium and WebKit.

This document describes the product capability. The stronger universal claim
that an isolated client can observe concurrent ACL changes or execute an
unbundled remote provider remains `NO-GO`; see
[`offline-distributed-truth-audit.md`](./offline-distributed-truth-audit.md).

## Claim

After one complete graph activation, Shrubbery can cold-start without Gardend
or gateway access, continue graph-native knowledge work, and synchronize later.

“Complete activation” is an explicit protocol fact:

- the graph incarnation and source epoch are known;
- every manifest member is locally durable;
- the manifest is closed over every source payload member;
- the manifest hash and member digests validate;
- workspace and document bodies, original resources, history, and semantic
  source material are present;
- the entire commit is atomic, so a quota/crash failure leaves the previous
  complete epoch usable.

This is broader than a document cache. It includes the Meaningful Object sources
behind workspace structure, documents, graph metadata, current-state objects,
events, memory, valuations, retractions, resources, history, and rebuildable
derived faces.

## Runtime architecture

```text
                        Surface Activation
                    demand, priority, prewarming
                               |
                               v
  +----------------------------------------------------------+
  | Source Mirror                                            |
  | complete epoch + manifest + graph incarnation            |
  | source replicas + resource bytes + operation receipts    |
  | durable mutation and lifecycle outboxes                  |
  +-------------------------+--------------------------------+
                            |
            +---------------+----------------+
            |                                |
            v                                v
  local Oxigraph/semantic faces       Document Activation
  mirror + pending-intent overlay     document incarnation cache
            |                         editable Y.Doc + recovery
            +---------------+----------------+
                            |
                            v
                         Surfaces
```

The durable store owns source truth. Surfaces consume query/resource faces and
subscribe to availability, freshness, pending, conflict, and durability state.
A Surface is never deletion authority; absence is applied only when a newly
verified complete mirror import omits the object.

Surface attachment is not object creation. A document room may open only after
the document's Meaningful Object lifetime exists, and an untouched document is
stored and transported as a valid encoded empty Y.Doc update. This prevents
both stale-Surface resurrection and the ambiguity of treating missing or
zero-byte state as authoritative emptiness.

## Activation and reads

Opening a graph performs two independent actions:

1. open the last atomically committed local source mirror without waiting for
   network;
2. start background flush-then-pull reconciliation.

If the mirror is complete and identity-valid, REST/SPARQL reads use the local
engine immediately. The engine applies pending source operations over the
mirrored workspace Y.Doc, projects only touched subjects into a disposable
Oxigraph store, and returns Garden-compatible SELECT, ASK, or CONSTRUCT
envelopes.

The Oxigraph browser WASM is proactively initialized while the packaged app
shell is available. Vite excludes it from dependency prebundling so the sibling
WASM URL remains valid, and production builds emit it as a versioned asset.

Semantic retrieval is similarly epoch-bound and local. A complete mirror can
therefore power the document switcher and other Surfaces without waiting for a
cell.

## Local mutation path

Recognized product mutations are translated into typed source operations:

- graph metadata;
- document lifecycle;
- workspace/document updates and mediated CRDT commands;
- current-state candidates and resolutions;
- event-log, memory, valuation, and retraction events.

The mutation boundary is:

1. require a complete graph-incarnation-fenced mirror;
2. mint or reuse a stable operation ID;
3. atomically persist the operation in IndexedDB;
4. return local acceptance immediately;
5. notify Surfaces so mirror + outbox becomes visible read-your-writes state;
6. push in the background;
7. reconcile stable receipts and pull the next complete epoch.

Receipts are content-bound: the client canonicalizes the exact typed operation
using Gardend's wire defaults and rejects missing, foreign, duplicated, or
digest-mismatched acknowledgements. The source epoch is likewise
content-bound—`graph incarnation + source revision + complete manifest hash`—
so an authoritative document/resource change invalidates epoch-derived faces
even when it did not originate in the source-operation ledger.

Local acceptance does not await a doomed network request. Direct `source_push`
uses the same path and returns `localAccepted`/`deliveryPending` testimony.

Untyped SPARQL UPDATE stays online-only. Arbitrary RDF deltas have no universal
merge policy and must not bypass the source ledger.

## Reconnect and delivery liveness

IndexedDB durability prevents loss, but durability alone is not sync-later
liveness. The runtime also:

- kicks graph-lifecycle and source outboxes on the browser `online` event;
- retries transient pending-intent failures with bounded exponential backoff;
- retries a transient first pull until proactive activation has a complete
  mirror;
- coalesces concurrent sync attempts per graph;
- stops retrying once no pending receipt remains or identity becomes stale;
- leaves conflict/rejection testimony explicit.

This covers the real race where the first reconnect request reaches a waking or
rotating cell and receives a transient transport failure.

## Document Activation

Document bodies have an additional live-editing lifecycle:

- a locally valid snapshot makes the document renderable and editable before a
  room handshake;
- every disconnected Yjs transition reaches IndexedDB durability;
- live synchronization merges into the same Y.Doc;
- a Gardend-issued document incarnation fences delete/recreate;
- deletion wins, while unsynced local work moves to a recovery record;
- a same-ID replacement never receives quarantined operations automatically.

`whenRenderable`, `whenEditable`, and `whenSynced` are separate facts. Cached
state can satisfy the first two while disconnected; only the live room satisfies
the third.

The complete source mirror imports every document into Document Activation.
An untouched document is therefore available after a cold offline renderer
restart; user navigation history is no longer the completeness mechanism.

## Graph and object lifecycle

Graph creation/deletion and document creation/recreation use client-minted
incarnations and stable operation IDs. Exact retries resume. Mismatched identity
conflicts. Destructive operations include the expected incarnation so a stale
client cannot delete a replacement lifetime.

Workspace namespace changes, body authority, tombstones, projection, and
receipts are effects of the lifecycle source operation rather than unrelated
best-effort calls.

## Distributed-truth proof

Run:

```sh
pnpm --dir apps/organism test:offline-sync-browser
pnpm --dir apps/organism test:offline-sync-webkit
```

The harness uses:

- two independent persistent profiles in Chromium, then the same full journey
  in WebKit (the relevant engine family for macOS Tauri/WKWebView);
- one Node Yjs/WebSocket peer;
- MCP agent writes;
- a real release Gardend binary and retained disk profile;
- random loopback ports/tokens across process restarts;
- per-browser partitions of every `/cell/**` HTTP and WebSocket route.

It asserts:

| Dimension | Functional witness |
|---|---|
| Complete mirror | a never-opened server document is durable in both profiles and survives cold offline restart |
| Cold renderer | browser contexts are destroyed/recreated while partitioned; no live JS object carries state |
| Local durability | TipTap text/formatting and independent Y.Map changes are durable before teardown |
| Concurrency | two offline browsers, a live Node peer, and MCP converge |
| Delivery order | A→B and B→A reconnects plus repeated idempotence cycles |
| Presence | disconnected clients disappear from awareness without losing local editability |
| Process truth | merged state survives two hard Gardend deaths |
| Identity | snapshot/delete/recreate races never pair one incarnation with another lifetime’s bytes |
| Recovery | delete wins and offline edits remain inspectable |
| Product mutation | offline sidebar rename reaches the outbox and active Surface |
| Cold read-your-writes | the renamed title survives a second cold offline renderer |
| Sync later | an `online` event, without page reload, yields an applied receipt and canonical RDF witness |

The report records the exact Gardend path and SHA-256. The umbrella audit
requires all child proofs to agree on that executable:

```sh
pnpm --dir apps/organism audit:offline-distributed-truth
pnpm --dir apps/organism verify:offline-distributed-truth
```

The umbrella gate additionally runs real cross-engine IndexedDB abort/cold-open
testing and a three-seed, five-client-per-authority source-sync chaos campaign
covering lost/invalid acknowledgements, invalid-batch atomicity, shuffled
duplicate replay, concurrent arrival, destructive rebuild, and SIGKILL
hydration.

## Deployment boundary

The desktop/Tauri app bundle is local. The browser harness keeps the Vite app
shell reachable while partitioning the cell, which models that deployment.
A separately hosted web product also needs ordinary offline app-shell asset
caching; the graph mirror cannot boot JavaScript that was never installed.

Hosted gateway compatibility must preserve:

- graph incarnation in create/read/delete control-plane contracts;
- `x-document-incarnation` on document snapshots;
- `document_incarnation` on WebSocket upgrades;
- identity-bearing mismatch responses;
- source pull/push/rebuild and stable operation receipts.

If those facts are unavailable, Shrubbery reports an unfenced/stale conflict
instead of uploading local state across an unknown lifetime.

## What “full” does not mean

The implemented GO does not claim that a partitioned client can:

- learn that an administrator concurrently revoked access;
- fetch a never-mirrored external fact;
- invoke a remote model/parser/connector with no local replacement.

Those actions can fail closed, use bounded signed offline capabilities, execute
locally when their resources are installed, or remain durable deferred intents.
They are not failures of graph synchronization.
