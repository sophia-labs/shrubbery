# Fully Offline Distributed Truth and Meaningful Objects

**Status (2026-07-30):**

- **GO** — the replicated graph data plane is fully offline, cold-start,
  multi-client, and sync-later capable.
- **NO-GO** — the unqualified claim that *every* interesting behavior can
  execute with its ordinary semantics during an arbitrary partition.

The NO-GO is not an unfinished cache implementation. The functional audit
found no remaining replicated-data-plane blockers. It names two irreducibly
non-local boundaries: concurrent authorization changes and effects whose
implementation or inputs exist only outside the partition.

## 1. What is now a GO

A previously activated graph is a complete, identity-fenced local authority,
not a collection of opportunistic HTTP cache hits. While Gardend or the network
is unavailable, Shrubbery can cold-start and continue graph-native knowledge
work:

- read and query the complete mirrored source epoch;
- open every mirrored document, including one never previously made visible;
- edit document and workspace Y.Docs;
- create, rename, move, and delete documents, folders, artifacts, and wires;
- create/delete graph and document lifetimes using client-minted identities;
- append memories, events, valuations, and retractions with stable operation
  identity;
- edit versioned current-state objects and surface explicit conflicts;
- read original resource bytes and document history;
- execute source-derived local semantic retrieval;
- render pending operations as cold read-your-writes state;
- reconnect without reloading, retry transient delivery failures, and reconcile
  to canonical Gardend receipts;
- rebuild disposable RDF and other projections from the source ledger.

This is the useful product meaning of “full offline mode”: graph knowledge work
continues locally, is durable before network acknowledgement, and later
reconciles under explicit source and lifecycle rules.

Untyped raw SPARQL UPDATE remains an online administrative escape hatch. It is
not an offline authoring protocol because arbitrary updates do not carry a
stable source identity or a general reconciliation law. Product mutations use
typed source intents instead.

## 2. The Meaningful Object model

The mirror stores Meaningful Object authority, not Surface output:

```text
Meaningful Object
  identity
    user + graph + graph incarnation
    object identity + optional object incarnation
  source
    CRDT | event log | versioned current state | derived recipe/artifact
  operations
    client-stable operation/event IDs + observed base where required
  policy
    merge/fold/CAS/conflict strategy + observer membrane
  lifecycle
    create + delete/tombstone + recreate
  faces
    RDF + API object + blocks + semantic entries + UI
```

The source operation, object identity, and lifetime are durable. RDF, sidebar
rows, search indexes, and Surface components are reconstructible faces. This
keeps the core doctrine intact: merge one authoritative source and derive many
faces; never merge a projection as a second source of truth.

Two boundary invariants follow:

- opening a room or mounting a Surface never creates a Meaningful Object;
  authoritative lifecycle testimony must exist first, so a stale Surface
  cannot resurrect a deleted or imaginary object;
- “empty” is still source state. An untouched document is represented by a
  valid encoded empty Y.Doc update, never by zero bytes or absence that a
  client must guess how to interpret.

The complete source bundle currently covers:

- graph metadata;
- workspace and document Y.Doc state;
- current-state records and conflict/resolution testimony;
- event-log, memory, valuation, and retraction events;
- legacy RDF and valuation baselines;
- operation receipts and source registry;
- content-addressed original resources;
- document-history snapshots;
- semantic corpus and derived-capability metadata;
- the RDF projection snapshot as a disposable acceleration artifact.

## 3. Surface Activation and the invisible store

The invisible store is conceptually congruent with Shrubbery when responsibilities
stay separated:

```text
Surface intent
    |
    v
Surface Activation scheduler
    | foreground: make visible source usable
    | background: warm likely-next work and complete the graph mirror
    v
Source Mirror Store
    | complete manifest + epoch + graph incarnation
    | local source replicas and resources
    | durable lifecycle/mutation outboxes
    | local Oxigraph + semantic projection
    | conflict/recovery testimony
    v
Surface query/resource faces
```

Surface Activation expresses demand and priority. The Source Mirror owns
durability, completeness, convergence, retries, and identity fences. A Surface
may render an older complete epoch plus local pending intents immediately; it
does not gain authority to infer deletion from that stale projection. Absence
testimony comes only from importing a newly verified complete source epoch.
Likewise, attaching to a document route is a consequence of object existence,
not evidence that creates it.

The browser Oxigraph engine is proactively initialized while the app bundle is
available, and its WASM is emitted as a versioned build asset. Local SPARQL
SELECT, ASK, and CONSTRUCT therefore remain available during a later cell
partition.

## 4. Source-kind rules

### CRDT

Workspace and document Y.Docs merge updates. The local store persists complete
updates and document incarnations. Delete/recreate rotates the incarnation; an
old replica cannot enter the replacement lifetime. Unsynced deleted work is
quarantined as recovery rather than silently lost or resurrected.

### Event log

The client mints stable event identity before claiming local durability.
Replicas merge by event-set union and deterministically fold faces. Duplicate
delivery is idempotent.

### Current state

An edit carries the base version it observed. Divergent candidates do not race
by arrival order: they become an explicit conflict Meaningful Object unless a
declared executable reconciliation strategy resolves them. Resolution is
durable source testimony.

### Derived

Derived values are epoch-bound and locally rebuildable from mirrored source, or
are mirrored as invalidatable acceleration artifacts. They are never accepted
as independent authoring authority.

## 5. Lifecycle and delivery

Graph and document lifetime operations carry:

- a stable operation ID;
- the graph incarnation;
- a client-minted new incarnation for creation/recreation;
- an expected incarnation for destructive operations.

Exact retries resume. A different identity at the same human-readable ID
conflicts. Gateway graph deletion is fenced so a stale delete cannot erase a
replacement graph.

Product mutations follow this path:

```text
user/agent intent
  -> atomically persist typed source operation in IndexedDB
  -> immediately project mirror + outbox into active Surfaces
  -> return local acceptance
  -> background push
  -> retry transient failure with bounded backoff
  -> reconcile canonical receipt
  -> pull and atomically commit the next complete source epoch
```

The browser `online` lifecycle kicks graph and source outboxes immediately.
Retries continue while a durable pending intent lacks a receipt, including when
the first request races a waking or rotating cell.

The integrity boundary is now explicit rather than conventional:

- the manifest must be closed over every source payload member, not merely
  internally hash-consistent for whichever members happened to arrive;
- a source epoch binds graph incarnation, ledger revision, and the complete
  manifest hash, so a direct authoritative change cannot reuse an old epoch;
- authority revision rollback and same-epoch manifest equivocation are rejected
  without replacing the last verified local truth;
- every push returns exactly one graph-bound receipt per submitted operation,
  and each receipt digest is checked against the durable operation's canonical
  wire form;
- an accepted operation whose effect temporarily failed remains pending for
  repair instead of being mistaken for a semantic conflict;
- a transient first pull retries until proactive hydration produces a complete
  mirror.

## 6. Why the unqualified verdict is still NO-GO

### 6.1 Concurrent authorization

Consider two worlds that are byte-for-byte identical to the offline client:

1. the user still has write access;
2. an administrator revoked write access at the gateway after the partition.

No local algorithm can distinguish those worlds. It must either continue in
both or stop in both, so it cannot simultaneously promise autonomous work and
instant enforcement of unseen revocation.

The coherent policies are:

- **fail closed** when live authorization cannot be checked; or
- issue a **bounded signed offline capability**, accept local work within its
  scope/expiry, and reconcile later.

After revocation, rejected work remains recoverable local testimony. A signed
capability can bound risk; it cannot communicate a concurrent revocation
through a partition.

### 6.2 External effects and facts

A remote model, parser/OCR service, connector, web resource, or device cannot
execute or reveal new facts if neither its implementation nor its required
inputs exist locally.

For each such behavior the product must choose:

- bundle a local implementation and its model/resources;
- use a locally mirrored snapshot with explicit freshness;
- durably record an effect intent and defer execution until reconnection; or
- report the capability unavailable.

Meaningful Objects still help: the request, expected identity, local context,
later result, and rejection can all be durable objects. They do not make an
absent provider physically local.

## 7. Functional evidence

The top-level audit runs six independent real proofs. Every cell-backed child
must use one immutable Gardend executable with the same path and SHA-256.

### Browser distributed truth

- two persistent Chromium profiles and the same complete journey in two
  persistent WebKit profiles (the Tauri-relevant browser engine);
- one Node Yjs/WebSocket peer and MCP writer;
- a complete source mirror containing an untouched document;
- cold renderer restart while every `/cell/**` route is partitioned;
- concurrent offline edits and both reconnect orders;
- repeated reconnects and two hard Gardend deaths;
- delete/recreate races and recovery preservation;
- an offline sidebar rename that is durably queued, immediately visible,
  visible again after a cold restart, delivered on an `online` event without a
  reload, and witnessed in canonical Gardend RDF.

### Cross-engine IndexedDB atomicity

- real Chromium and WebKit IndexedDB transactions;
- deterministic abort at the transaction completion boundary used by quota and
  serialization failures;
- the previous complete mirror remains readable with no partial replacement;
- an aborted outbox write exposes no phantom durable intent;
- a later successful epoch survives a cold persistent-profile reopen.

### Source-authority distributed truth

- 19 explicit complete-manifest members in the exercised graph;
- registry inventory: 95 current-state, 3 event-log, and 5 derived classes;
- 14 accepted intents from two offline clients;
- arrival-order set equality and explicit current-state conflict;
- event, valuation, and retraction union/idempotence;
- client-minted graph/document incarnations and stale-lifetime rejection;
- lost-ack repair;
- destructive source/projection rebuild set equality;
- SIGKILL and cold same-disk hydration.

### Seeded multi-client chaos

- three deterministic seeds, each run against two independent graph
  authorities;
- five offline clients per authority and 35 source operations per graph;
- sequential and concurrent delivery schedules with identical logical truth;
- injected pre-accept failure, lost acknowledgement, partial receipt set, and
  bad receipt digest;
- cold manager reopen over durable outboxes after each fault;
- invalid mixed-batch prefix atomicity and atomic rejection of 1,001-operation
  batches;
- 60 shuffled duplicate batches across the three seeds with no revision
  advance;
- six final cold-hydration witnesses after SIGKILL;
- destructive rebuild and CRDT/event/valuation/current-state convergence in
  every campaign.

### Residual capability audit

- legacy Emporium/value/retraction routes have replay identity;
- original bytes and history are explicit manifest members;
- semantic search executes locally from the mirrored corpus;
- graph lifecycle exact retry and mismatch rejection pass;
- replicated-data-plane blocker list is empty;
- only the two fundamental non-local boundaries remain.

## 8. Running the gates

```sh
# Evidence-producing audit. Exits zero when all child harnesses execute and
# reports both the bounded and unqualified verdicts.
pnpm --dir apps/organism audit:offline-distributed-truth

# Release gate for the implemented replicated graph data-plane claim.
pnpm --dir apps/organism verify:offline-distributed-truth

# Focused engine/fault campaigns used by the umbrella gate.
pnpm --dir apps/organism test:offline-sync-webkit
pnpm --dir apps/organism test:source-mirror-idb-chaos
pnpm --dir apps/organism test:source-sync-chaos

# Deliberately stronger universal claim; currently exits non-zero because the
# two fundamental non-local boundaries exist.
pnpm --dir apps/organism verify:unqualified-offline
```

The output must contain:

```json
{
  "replicatedDataPlaneVerdict": "GO",
  "unqualifiedVerdict": "NO-GO",
  "boundedGo": { "verdict": "GO" }
}
```

The unqualified NO-GO should not be used to hide a replicated-data-plane
regression. Conversely, a data-plane GO must not be marketed as instantaneous
offline authority over ACL changes or unbundled external effects.
