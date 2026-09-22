/**
 * Shell-owned runtime for the invisible source-aware store behind Surfaces.
 *
 * The durable protocol and mirror state machine live in @shrubbery/source.
 * This module supplies the deployment-specific pieces: authenticated MCP,
 * IndexedDB, a real local Oxigraph read engine, document-cache promotion, and
 * a RestClient that can continue read behavior after a cold network loss.
 */

import * as Oxigraph from 'oxigraph'
import type { Quad, Term } from 'oxigraph'
import * as Y from 'yjs'
import type { AuthProvider, RestClient } from '@shrubbery/nucleus'
import {
  inferQueryBlockQueryKind,
  makeQueryBlockService,
  type QueryBlockService,
} from '@shrubbery/runtime'
import {
  McpSourceSyncTransport,
  OfflineSemanticSearchIndex,
  GraphLifecycleManager,
  MemoryGraphLifecycleStorage,
  MemorySourceMirrorStorage,
  SourceMirrorManager,
  createProvisionalSourceBundle,
  buildResolveCurrentOperation,
  documentIdOf,
  type SourceBundle,
  type SourceOperation,
  type SourceOutboxRecord,
  type SourceMirrorState,
  type SourceSyncToolCaller,
  type OfflineSemanticSearchHit,
  type GraphLifecycleTransport,
  type GraphLifecycleStorage,
  type SourceMirrorStorage,
  type ResolveCurrentIntent,
  sourceOperationsForToolMutation,
} from '@shrubbery/source'
import {
  type DocumentActivationManager,
  type DocumentRemoteSnapshot,
} from './document-activation.js'
import { IndexedDbSourceMirrorStorage } from './source-mirror-indexeddb.js'
import {
  applyOfflineWorkspaceOverlay,
  offlineWorkspaceOverlay,
} from './offline-workspace-overlay.js'

interface MirrorEntry {
  readonly userId: string
  readonly graphId: string
  readonly manager: SourceMirrorManager
  opened: Promise<void> | null
  syncing: Promise<void> | null
}

interface SurfaceServiceEntry {
  readonly identity: string
  readonly service: QueryBlockService
}

export interface SourceMirrorRuntimeOptions {
  readonly liveRest: RestClient
  readonly caller: SourceSyncToolCaller
  readonly auth: AuthProvider
  readonly documentActivation: DocumentActivationManager
  readonly storage?: SourceMirrorStorage & GraphLifecycleStorage
  readonly graphLifecycleTransport?: GraphLifecycleTransport
}

class MemorySourceRuntimeStorage implements SourceMirrorStorage, GraphLifecycleStorage {
  private readonly mirror = new MemorySourceMirrorStorage()
  private readonly lifecycle = new MemoryGraphLifecycleStorage()

  readMirror: SourceMirrorStorage['readMirror'] = key => this.mirror.readMirror(key)
  commitMirror: SourceMirrorStorage['commitMirror'] = record => this.mirror.commitMirror(record)
  putOutbox: SourceMirrorStorage['putOutbox'] = record => this.mirror.putOutbox(record)
  listOutbox: SourceMirrorStorage['listOutbox'] = key => this.mirror.listOutbox(key)
  putGraphLifecycleIntent: GraphLifecycleStorage['putGraphLifecycleIntent'] =
    intent => this.lifecycle.putGraphLifecycleIntent(intent)
  listGraphLifecycleIntents: GraphLifecycleStorage['listGraphLifecycleIntents'] =
    userId => this.lifecycle.listGraphLifecycleIntents(userId)
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The resident `resolveCurrent`-candidate operation ids for one conflict,
 * read off the untyped wire `bundle.conflicts` the same defensive way
 * `contested-surface.ts`'s `objectKeyForConflict` and `source-object-
 * runtime.ts`'s `contestFromWire` already do (master §3 Slice 6). Kept
 * local rather than shared: each of those three call sites narrows exactly
 * the one or two fields it needs off the SAME untyped shape, matching this
 * codebase's own established pattern for this wire boundary (Ask A's typed
 * client-side `SourceConflict`/`SourceConflictCandidate` faces live in
 * `@shrubbery/runtime`'s `source-object-service.ts`, not `@shrubbery/source`
 * — D-4 — so importing them here would be a layering violation, not a
 * simplification).
 */
function knownCandidateOperationIdsFor(
  bundle: SourceBundle | undefined,
  conflictId: string,
): readonly string[] {
  if (!bundle) return []
  for (const candidate of bundle.conflicts) {
    if (!isRecord(candidate) || candidate.conflictId !== conflictId) continue
    const candidates = candidate.candidates
    if (!Array.isArray(candidates)) return []
    return candidates
      .filter(isRecord)
      .map(entry => entry.operationId)
      .filter((value): value is string => typeof value === 'string')
  }
  return []
}

class MirrorQueryEngine {
  private readonly stores = new Map<
    string,
    { readonly identity: string; readonly store: InstanceType<typeof Oxigraph.Store> }
  >()
  private initialization: Promise<void> | null = null

  /**
   * Oxigraph's Node entry point initializes its WASM synchronously, while its
   * browser entry point exposes an async default initializer. Keeping that
   * distinction here prevents Node tests from masking a cold browser failure.
   */
  prepare(): Promise<void> {
    if (!this.initialization) {
      const browserInitializer = (
        Oxigraph as unknown as { readonly default?: unknown }
      ).default
      this.initialization = typeof browserInitializer === 'function'
        ? Promise.resolve(
            (browserInitializer as () => Promise<unknown>)(),
          ).then(() => {})
        : Promise.resolve()
    }
    return this.initialization
  }

  async query(
    bundle: SourceBundle,
    outbox: ReturnType<SourceMirrorManager['outboxRecords']>,
    sparql: string,
  ): Promise<unknown> {
    await this.prepare()
    const overlay = offlineWorkspaceOverlay(bundle, outbox)
    const identity = `${bundle.epoch}\u001f${overlay.key}`
    let resident = this.stores.get(bundle.graphId)
    if (!resident || resident.identity !== identity) {
      const store = new Oxigraph.Store()
      store.load(bundle.projectionSnapshot.data, { format: 'application/n-quads' })
      applyOfflineWorkspaceOverlay(store, bundle.graphId, overlay)
      resident = { identity, store }
      this.stores.set(bundle.graphId, resident)
    }
    const kind = inferQueryBlockQueryKind(sparql)
    const result = resident.store.query(sparql)
    if (kind === 'ask') {
      if (typeof result !== 'boolean') {
        throw new Error('SourceMirror: ASK did not return a boolean')
      }
      return {
        resultType: 'boolean',
        variables: [],
        rows: [],
        boolean: result,
        graph: null,
        quadCount: resident.store.size,
      }
    }
    if (kind === 'select') {
      if (!Array.isArray(result) || result.some(row => !(row instanceof Map))) {
        throw new Error('SourceMirror: SELECT did not return solution mappings')
      }
      const solutions = result as Array<Map<string, Term>>
      const variables: string[] = []
      const rows = solutions.map(solution => {
        const row: Record<string, string> = {}
        for (const [variable, term] of solution) {
          if (!variables.includes(variable)) variables.push(variable)
          // RDF/JS Oxigraph term Display is the same boundary representation
          // emitted by Garden's Rust Oxigraph service: <iri>, _:blank, or a
          // quoted literal with optional language/datatype.
          row[variable] = term.toString()
        }
        return row
      })
      return {
        resultType: 'solutions',
        variables,
        rows,
        boolean: null,
        graph: null,
        quadCount: resident.store.size,
      }
    }
    if (!Array.isArray(result) || result.some(value => value instanceof Map)) {
      throw new Error(`SourceMirror: ${kind.toUpperCase()} did not return graph quads`)
    }
    const graph = (result as Quad[]).map(quad => `${quad.toString()} .\n`).join('')
    return {
      resultType: 'graph',
      variables: [],
      rows: [],
      boolean: null,
      graph,
      quadCount: resident.store.size,
      // QueryBlockService historically consumes `data`; retain it alongside
      // the exact Garden graph field so offline and online callers agree.
      data: graph,
      mediaType: 'application/n-quads',
    }
  }

  retire(graphId: string): void {
    this.stores.delete(graphId)
  }
}

/**
 * One registry per contract/auth lifetime. It starts from a committed mirror
 * synchronously with session activation, then performs flush→pull in the
 * background. Every successful epoch change creates a new Surface query
 * service identity, which is the runtime's retained-derived invalidation
 * boundary.
 */
export class SourceMirrorRuntime {
  readonly rest: RestClient
  private readonly storage: SourceMirrorStorage & GraphLifecycleStorage
  private readonly transport: McpSourceSyncTransport
  private readonly entries = new Map<string, MirrorEntry>()
  private readonly queryEngine = new MirrorQueryEngine()
  private readonly semanticIndexes = new Map<
    string,
    { readonly epoch: string; readonly index: OfflineSemanticSearchIndex }
  >()
  private readonly lifecycleManagers = new Map<string, GraphLifecycleManager>()
  private readonly observers = new Set<(graphId: string, state: SourceMirrorState) => void>()
  private readonly surfaceServices = new Map<string, SurfaceServiceEntry>()
  private readonly syncRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly syncRetryAttempts = new Map<string, number>()

  constructor(private readonly options: SourceMirrorRuntimeOptions) {
    this.storage = options.storage ?? (
      globalThis.indexedDB
        ? new IndexedDbSourceMirrorStorage(globalThis.indexedDB)
        : new MemorySourceRuntimeStorage()
    )
    this.transport = new McpSourceSyncTransport(options.caller)
    // Surface Activation warms the local query engine while the app shell is
    // available. A later graph partition must not discover an unfetched WASM
    // dependency at the moment the user first needs an offline projection.
    void this.queryEngine.prepare().catch(() => {
      // The exact initialization error is returned by the first local query;
      // construction remains non-blocking so live transport can still boot.
    })
    this.rest = {
      graphs: async () => {
        try {
          return await options.liveRest.graphs()
        } catch (error) {
          // Law VI, REVERSED filter (master §3 Slice 7, WS3 §4.6). A fenced
          // graph used to be dropped here — the exact opposite of the
          // product's own confess-absence doctrine. It now stays LISTED,
          // carrying a `lifetime` field the shell renders as "moved on
          // without you". Listed is not readable: `usableBundle`,
          // `toolsCall`'s fallthrough, and `surfaceQueryService`'s identity
          // tuple below all keep gating on `state.fenced`, unchanged.
          const graphs = [...this.entries.values()]
            .filter(entry => (
              entry.manager.get().complete
              && !this.locallyDeleted(
                entry.graphId,
                entry.manager.get().graphIncarnation,
              )
            ))
            .map(entry => {
              const state = entry.manager.get()
              const pendingTitle = [...entry.manager.outboxRecords()]
                .reverse()
                .find(record => (
                  record.operation.kind === 'graphMetadata'
                  && record.status !== 'conflict'
                  && record.status !== 'rejected-stale'
                  && typeof record.operation.title === 'string'
                ))?.operation.title
              const lifecycle = [...this.lifecycleManagers.values()]
                .flatMap(manager => manager.records())
                .find(intent => (
                  intent.kind === 'create'
                  && intent.graphId === entry.graphId
                  && intent.graphIncarnation === state.graphIncarnation
                ))
              return {
                graphId: entry.graphId,
                title: typeof pendingTitle === 'string'
                  ? pendingTitle
                  : lifecycle?.title
                    ?? entry.manager.bundle()?.graphMetadata?.title
                    ?? entry.graphId,
                offline: true,
                provisional: entry.manager.bundle()?.provisional === true,
                // `parkedDocuments` is honestly 0 here: this runtime has no
                // access to the document-activation recovery store — the
                // shell composes the real count (main.ts, master §5.4).
                // `parkedOperations` is the TOTAL undeliverable outbox
                // count (document-bearing + graph-scoped): both are real
                // stuck typed changes, and FB-8's copy ("unsent changes")
                // does not narrow to document-bearing ones alone.
                ...(state.fenced ? {
                  lifetime: {
                    kind: 'moved-on' as const,
                    previousIncarnation: state.graphIncarnation ?? '',
                    parkedOperations: state.parked + state.nonDocumentParked,
                    parkedDocuments: 0,
                  },
                } : {}),
              }
            })
          if (
            graphs.length > 0
            || this.entries.size > 0
            || [...this.lifecycleManagers.values()].some(manager => manager.records().length > 0)
          ) return graphs
          throw error
        }
      },
      query: async (graphId, sparql) => {
        const bundle = this.usableBundle(graphId)
        if (bundle) return this.queryEngine.query(
          bundle,
          this.entry(graphId).manager.outboxRecords(),
          sparql,
        )
        return options.liveRest.query(graphId, sparql)
      },
      // Raw SPARQL UPDATE has no source-kind reconciliation contract. It stays
      // an online-only administrative escape hatch; offline authoring uses
      // manager.enqueue() with a typed, stable source intent.
      update: (graphId, sparql) => options.liveRest.update(graphId, sparql),
      documentUpdate: async (graphId, documentId, request) => {
        const mirrored = this.documentSnapshot(graphId, documentId)
        if (mirrored) return mirrored.update
        if (!options.liveRest.documentUpdate) {
          throw new Error('SourceMirror: neither mirror nor live RestClient has documentUpdate')
        }
        return options.liveRest.documentUpdate(graphId, documentId, request)
      },
    }
  }

  subscribe(observer: (graphId: string, state: SourceMirrorState) => void): () => void {
    this.observers.add(observer)
    return () => this.observers.delete(observer)
  }

  graphLifecycle(): GraphLifecycleManager {
    if (!this.options.graphLifecycleTransport) {
      throw new Error('SourceMirrorRuntime: graph lifecycle transport is unavailable')
    }
    const userId = this.options.auth.userId().trim()
    if (!userId) throw new Error('SourceMirrorRuntime: userId is required')
    let manager = this.lifecycleManagers.get(userId)
    if (!manager) {
      manager = new GraphLifecycleManager({
        userId,
        storage: this.storage,
        transport: this.options.graphLifecycleTransport,
      })
      this.lifecycleManagers.set(userId, manager)
    }
    return manager
  }

  async openGraphLifecycle(): Promise<GraphLifecycleManager> {
    const manager = this.graphLifecycle()
    await manager.open()
    return manager
  }

  /**
   * Commit the empty source authority for a client-minted graph lifetime.
   * The lifecycle intent must be persisted first; callers can then navigate,
   * create documents, and cold-restart while the gateway is unreachable.
   */
  async provisionGraph(
    graphId: string,
    graphIncarnation: string,
  ): Promise<SourceMirrorManager> {
    const manager = await this.open(graphId)
    if (!manager.bundle()) {
      const workspace = new Y.Doc()
      const lifecycle = [...this.lifecycleManagers.values()]
        .flatMap(candidate => candidate.records())
        .find(intent => (
          intent.kind === 'create'
          && intent.graphId === graphId
          && intent.graphIncarnation === graphIncarnation
        ))
      const bundle = await createProvisionalSourceBundle({
        graphId,
        graphIncarnation,
        title: lifecycle?.title,
        workspaceUpdateBase64: encodeBase64(Y.encodeStateAsUpdate(workspace)),
      })
      await manager.bootstrap(bundle)
      await this.options.documentActivation.importCompleteMirror(
        this.options.auth.userId(),
        graphId,
        [],
      )
      this.publish(this.entry(graphId))
    } else if (manager.get().graphIncarnation !== graphIncarnation) {
      throw new Error(
        `SourceMirrorRuntime: graph ${graphId} already has incarnation ${manager.get().graphIncarnation}`,
      )
    }
    return manager
  }

  backgroundFlushGraphLifecycle(): void {
    if (!this.options.graphLifecycleTransport) return
    void this.openGraphLifecycle()
      .then(async manager => {
        const records = await manager.flush()
        const deleted = new Set(records
          .filter(intent => intent.kind === 'delete' && intent.status !== 'conflict')
          .map(intent => `${intent.graphId}\u001f${intent.graphIncarnation}`))
        for (const intent of records) {
          if (
            intent.kind === 'create'
            && intent.status === 'applied'
            && !deleted.has(`${intent.graphId}\u001f${intent.graphIncarnation}`)
          ) {
            this.backgroundSync(intent.graphId)
          } else if (intent.kind === 'delete' && intent.status === 'applied') {
            this.queryEngine.retire(intent.graphId)
            this.semanticIndexes.delete(intent.graphId)
            this.surfaceServices.delete(intent.graphId)
          }
        }
      })
      .catch(() => {
        // Durable records retain error/attempt testimony and will retry on the
        // next activation or online event.
      })
  }

  /**
   * Preserve the concrete MCP client's surface while routing recognized
   * product mutations through the durable source outbox. Reads and
   * administrative escape hatches continue to use the live client.
   */
  wrapMcpClient<T extends {
    toolsCall(name: string, args: Record<string, unknown>): Promise<unknown>
  }>(client: T): T {
    const runtime = this
    return new Proxy(client, {
      get(target, property, receiver) {
        if (property === 'toolsCall') {
          return (name: string, args: Record<string, unknown>): Promise<unknown> =>
            runtime.toolsCall(target, name, args)
        }
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  manager(graphId: string): SourceMirrorManager {
    return this.entry(graphId).manager
  }

  /** Open only local durability. This never waits for or initiates a network request. */
  async open(graphId: string): Promise<SourceMirrorManager> {
    const entry = this.entry(graphId)
    if (!entry.opened) {
      entry.opened = entry.manager.open().then(() => {
        this.publish(entry)
      })
    }
    await entry.opened
    return entry.manager
  }

  /**
   * Reconcile durable outbox receipts, pull a complete authority bundle, then
   * make every document available to Document Activation. A transport failure
   * leaves the last verified epoch usable; an identity conflict remains loud.
   */
  async sync(graphId: string): Promise<SourceMirrorManager> {
    const entry = this.entry(graphId)
    // A corrupt local epoch must never become authoritative, but it also must
    // not permanently prevent a clean authority pull from repairing the
    // mirror. `open()` has already published the exact local failure.
    try {
      await this.open(graphId)
    } catch {
      // Continue with an unfenced first pull. SourceMirrorManager discards the
      // invalid resident record before rejecting open().
    }
    if (!entry.syncing) {
      entry.syncing = (async () => {
        try {
          // A brand-new installation has no graph incarnation yet. There can
          // be no valid outbox records before a complete fenced mirror exists,
          // so its first synchronization is pull-only.
          const state = entry.manager.get()
          if (state.graphIncarnation && state.pending > 0) {
            await entry.manager.flush()
          }
          const bundle = await entry.manager.pull()
          await this.options.documentActivation.importCompleteMirror(
            entry.userId,
            entry.graphId,
            bundle.documents.map(document => ({
              documentId: document.documentId,
              incarnation: document.documentIncarnation,
              update: decodeBase64(document.updateBase64),
            })),
          )
          this.queryEngine.retire(entry.graphId)
          this.semanticIndexes.delete(entry.graphId)
        } finally {
          this.publish(entry)
        }
      })().finally(() => {
        entry.syncing = null
      })
    }
    await entry.syncing
    return entry.manager
  }

  /** Start sync without making the caller's visible activation wait for it. */
  backgroundSync(graphId: string): void {
    const scheduled = this.syncRetryTimers.get(graphId)
    if (scheduled) {
      clearTimeout(scheduled)
      this.syncRetryTimers.delete(graphId)
    }
    void this.sync(graphId)
      .then(() => {
        this.syncRetryAttempts.delete(graphId)
      })
      .catch(() => {
        // SourceMirrorState carries the exact failure. Pending intents require
        // delivery liveness as well as durable safety, so retry transient
        // failures with a bounded backoff until an authority receipt arrives.
        this.scheduleSyncRetry(graphId)
      })
  }

  private scheduleSyncRetry(graphId: string): void {
    if (this.syncRetryTimers.has(graphId)) return
    const entry = this.currentEntry(graphId)
    if (!entry) return
    const state = entry.manager.get()
    // A pending intent needs delivery liveness, and a first activation needs
    // hydration liveness. Previously only the former retried, so one transient
    // waking-cell failure could leave a brand-new proactive mirror empty until
    // some unrelated future activation. Once a complete idle mirror exists,
    // failed freshness pulls do not create an endless polling loop.
    if ((state.pending === 0 && state.complete) || state.fenced) return
    const attempt = (this.syncRetryAttempts.get(graphId) ?? 0) + 1
    this.syncRetryAttempts.set(graphId, attempt)
    const delayMs = Math.min(30_000, 250 * (2 ** Math.min(attempt - 1, 7)))
    const timer = setTimeout(() => {
      this.syncRetryTimers.delete(graphId)
      this.backgroundSync(graphId)
    }, delayMs)
    // Browser timers do not expose unref(); Node test/runtime timers do. A
    // durable retry should not keep a command-line process alive by itself.
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.syncRetryTimers.set(graphId, timer)
  }

  documentSnapshot(graphId: string, documentId: string): DocumentRemoteSnapshot | undefined {
    const document = this.usableBundle(graphId)?.documents.find(
      candidate => candidate.documentId === documentId,
    )
    return document
      ? {
          update: decodeBase64(document.updateBase64),
          incarnation: document.documentIncarnation,
        }
      : undefined
  }

  /**
   * Query the epoch-bound, source-derived semantic corpus without touching the
   * network. Undefined means no verified complete mirror is available; an
   * empty array is a valid offline search result.
   */
  semanticSearch(
    graphId: string,
    query: string,
    limit = 20,
  ): readonly OfflineSemanticSearchHit[] | undefined {
    const bundle = this.usableBundle(graphId)
    if (!bundle) return undefined
    let resident = this.semanticIndexes.get(graphId)
    if (!resident || resident.epoch !== bundle.epoch) {
      resident = {
        epoch: bundle.epoch,
        index: new OfflineSemanticSearchIndex(bundle.semanticCorpus ?? []),
      }
      this.semanticIndexes.set(graphId, resident)
    }
    return resident.index.search(query, limit)
  }

  /**
   * Author the client's resolution as a durable local intent, then deliver
   * in the background (master §3 Slice 6, WS2 §6.3) — local durability IS
   * the acceptance boundary, the same rule `toolsCall`'s own offline
   * mutation path already applies.
   */
  async resolveCurrent(
    graphId: string,
    intent: ResolveCurrentIntent,
  ): Promise<SourceOutboxRecord> {
    const manager = await this.open(graphId)
    const state = manager.get()
    if (!state.complete || state.fenced) {
      throw new Error('SourceMirror: a complete, unfenced local copy is required before you can resolve')
    }
    // Resident candidate ids, joined FRESH at call time (not cached from
    // whenever the menu was opened) — so `buildResolveCurrentOperation` can
    // enforce "chosenOperationId names a real candidate" against the
    // CURRENT epoch, catching a candidate set that changed underneath a
    // slow-clicking user here too, not only at the server (which would
    // report it as the unrelated-sounding `stale_sync_conflict`).
    const knownCandidateOperationIds = knownCandidateOperationIdsFor(manager.bundle(), intent.conflictId)
    const operation = buildResolveCurrentOperation(
      intent,
      `resolve:${this.randomUuid()}`,
      knownCandidateOperationIds,
    )
    const record = await manager.enqueue(operation)
    this.backgroundSync(graphId)
    return record
  }

  /**
   * Adopt this graph's new life (master §3 Slice 7, WS3 §4.3). The manager
   * marks every parked outbox row `rejected-stale` on disk FIRST — that is
   * what closes WS3 C3 and what makes the durable-fence rule (§2.1, C-D18)
   * survive a cold restart — and only then hydrates the new incarnation.
   * This wrapper finishes the job exactly the way `sync()` does: retire the
   * query engine and semantic index for this graph, then re-import every
   * document into Document Activation, which quarantines any document
   * still resident from the SUPERSEDED life through the existing
   * replacement path (document-activation.ts:1599-1611).
   */
  async adoptNewLife(graphId: string): Promise<SourceMirrorManager> {
    const entry = this.entry(graphId)
    await this.open(graphId)
    const bundle = await entry.manager.adoptNewLife()
    this.queryEngine.retire(entry.graphId)
    this.semanticIndexes.delete(entry.graphId)
    await this.options.documentActivation.importCompleteMirror(
      entry.userId,
      entry.graphId,
      bundle.documents.map(document => ({
        documentId: document.documentId,
        incarnation: document.documentIncarnation,
        update: decodeBase64(document.updateBase64),
      })),
    )
    return entry.manager
  }

  /**
   * Every operation this mirror can no longer deliver: `rejected-stale`, or
   * `pending`/`accepted` stamped with a superseded graph incarnation (WS3
   * C3) — the SAME undeliverable-row rule `SourceMirrorManager.publish()`
   * uses internally to derive `parked`/`nonDocumentParked`, exposed here as
   * rows rather than a count. The parked-work face's own join source
   * (master §3 Slice 8).
   */
  parkedOperations(graphId: string): readonly SourceOutboxRecord[] {
    const entry = this.currentEntry(graphId)
    if (!entry) return []
    const held = entry.manager.get().graphIncarnation
    return entry.manager.outboxRecords().filter(record => (
      record.status === 'rejected-stale'
      || (
        (record.status === 'pending' || record.status === 'accepted')
        && held !== null
        && record.graphIncarnation !== held
      )
    ))
  }

  /**
   * Outbox operation ids that touch THIS document. Only `documentUpdate`,
   * `documentLifecycle`, and document-scoped `crdtCommand` carry a
   * `documentId` — everything else is graph-scoped and reported separately
   * by `parkedOperations()`. `documentIncarnation` narrows `documentUpdate`
   * when present; a null incarnation matches by `documentId` alone (WS3
   * §4.5 — the recovery record's incarnation is a DOCUMENT incarnation,
   * distinct from the outbox row's GRAPH incarnation; joining on
   * "incarnation" bare would be a category error, so only `documentUpdate`
   * is narrowed by it at all).
   */
  parkedOperationIdsFor(
    key: { readonly graphId: string; readonly documentId: string },
    documentIncarnation: string | null,
  ): readonly string[] {
    return this.parkedOperations(key.graphId)
      .filter(record => documentIdOf(record.operation) === key.documentId)
      .filter(record => (
        documentIncarnation === null
        || record.operation.kind !== 'documentUpdate'
        || record.operation.documentIncarnation === documentIncarnation
      ))
      .map(record => record.operation.operationId)
  }

  private async toolsCall(
    live: { toolsCall(name: string, args: Record<string, unknown>): Promise<unknown> },
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const graphId = typeof args.graphId === 'string'
      ? args.graphId.trim()
      : typeof args.graph_id === 'string'
        ? args.graph_id.trim()
        : ''
    if (name === 'semantic_search' && graphId) {
      const query = typeof args.query === 'string' ? args.query : ''
      const requestedLimit = typeof args.limit === 'number' ? args.limit : 20
      const hits = this.semanticSearch(graphId, query, requestedLimit)
      if (hits) {
        return this.mcpEnvelope({
          graphId,
          query,
          source: 'offline-hybrid',
          hits,
          count: hits.length,
        })
      }
    }
    if (!graphId) return live.toolsCall(name, args)

    const manager = await this.open(graphId)
    if (name === 'source_pull'
      && manager.get().complete
      && !manager.get().fenced
      && manager.bundle()) {
      const outbox = manager.outboxRecords()
      this.backgroundSync(graphId)
      return this.mcpEnvelope({
        ...manager.bundle()!,
        mirrorEpoch: manager.get().epoch,
        localPendingOperations: outbox
          .filter(record => record.status === 'pending' || record.status === 'accepted')
          .map(record => record.operation),
        localOutbox: outbox.map(record => ({
          operationId: record.operation.operationId,
          status: record.status,
          attempts: record.attempts,
          error: record.error,
        })),
      })
    }
    if (!manager.get().complete || manager.get().fenced) {
      return live.toolsCall(name, args)
    }
    if (name === 'source_push') {
      const requestedIncarnation = typeof args.graphIncarnation === 'string'
        ? args.graphIncarnation.trim()
        : typeof args.graph_incarnation === 'string'
          ? args.graph_incarnation.trim()
          : ''
      if (requestedIncarnation !== manager.get().graphIncarnation) {
        throw new Error(
          `SourceMirror: stale graph incarnation ${requestedIncarnation || '(missing)'}; `
          + `local authority is ${manager.get().graphIncarnation}`,
        )
      }
      if (!Array.isArray(args.operations) || args.operations.length === 0) {
        throw new Error('SourceMirror: source_push operations must be a non-empty array')
      }
      const operations = args.operations.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`SourceMirror: source_push operations[${index}] must be an object`)
        }
        const operation = value as SourceOperation
        if (typeof operation.operationId !== 'string' || !operation.operationId.trim()) {
          throw new Error(
            `SourceMirror: source_push operations[${index}].operationId is required`,
          )
        }
        return operation
      })
      const before = new Set(manager.outboxRecords().map(
        record => record.operation.operationId,
      ))
      for (const operation of operations) await manager.enqueue(operation)
      // Local durability is the acceptance boundary. A partitioned Surface
      // must never wait for an eager delivery attempt before it can continue.
      this.backgroundSync(graphId)
      const records = manager.outboxRecords()
      return this.mcpEnvelope({
        ok: true,
        graphId,
        graphIncarnation: manager.get().graphIncarnation,
        revision: manager.bundle()?.revision ?? 0,
        offline: true,
        localAccepted: true,
        deliveryPending: true,
        receipts: operations.map(operation => {
          const record = records.find(
            candidate => candidate.operation.operationId === operation.operationId,
          )
          return record?.receipt ?? {
            operationId: operation.operationId,
            digest: 'local-unacknowledged',
            acceptedRevision: manager.bundle()?.revision ?? 0,
            status: 'accepted',
            duplicate: before.has(operation.operationId),
            outcome: { outcome: 'locally-queued' },
          }
        }),
      })
    }
    const requestedOperationId = typeof args.operationId === 'string'
      ? args.operationId.trim()
      : typeof args.operation_id === 'string'
        ? args.operation_id.trim()
        : typeof args.sourceOperationId === 'string'
          ? args.sourceOperationId.trim()
          : typeof args.source_operation_id === 'string'
            ? args.source_operation_id.trim()
        : ''
    const baseOperationId = requestedOperationId || `tool:${name}:${this.randomId()}`
    const routedArgs: Record<string, unknown> = { ...args }
    const existing = manager.outboxRecords().find(
      record => record.operation.operationId === baseOperationId,
    )?.operation
    if (name === 'create_document'
      && typeof routedArgs.documentIncarnation !== 'string'
      && typeof routedArgs.document_incarnation !== 'string') {
      const priorIncarnation = existing?.kind === 'documentLifecycle'
        && typeof existing.newDocumentIncarnation === 'string'
        ? existing.newDocumentIncarnation
        : undefined
      routedArgs.documentIncarnation = priorIncarnation ?? this.randomUuid()
    }
    if ((name === 'delete_document'
        || (name === 'delete'
          && String(routedArgs.type ?? '').toLowerCase().startsWith('document')))
      && typeof routedArgs.expectedDocumentIncarnation !== 'string'
      && typeof routedArgs.expected_document_incarnation !== 'string') {
      const documentId = typeof routedArgs.documentId === 'string'
        ? routedArgs.documentId
        : typeof routedArgs.document_id === 'string'
          ? routedArgs.document_id
          : typeof routedArgs.entityId === 'string'
            ? routedArgs.entityId
            : ''
      const expected = manager.bundle()?.documents.find(
        document => document.documentId === documentId,
      )?.documentIncarnation
      if (expected) routedArgs.expectedDocumentIncarnation = expected
    }
    const operations = sourceOperationsForToolMutation(
      name,
      routedArgs,
      (_toolName, index) => index === 0 ? baseOperationId : `${baseOperationId}:${index}`,
      {
        bundle: manager.bundle(),
        existingOperations: manager.outboxRecords().map(record => record.operation),
        now: Date.now(),
      },
    )
    if (!operations) return live.toolsCall(name, args)

    for (const operation of operations) await manager.enqueue(operation)
    for (const operation of operations) {
      if (operation.kind !== 'documentLifecycle'
        || (operation.action !== 'create' && operation.action !== 'recreate')
        || typeof operation.documentId !== 'string'
        || typeof operation.newDocumentIncarnation !== 'string') continue
      const provisional = new Y.Doc()
      try {
        await this.options.documentActivation.importMirrorDocument(
          this.options.auth.userId(),
          graphId,
          {
            documentId: operation.documentId,
            incarnation: operation.newDocumentIncarnation,
            update: Y.encodeStateAsUpdate(provisional),
          },
        )
      } finally {
        provisional.destroy()
      }
    }
    this.backgroundSync(graphId)
    return this.mcpEnvelope({
      success: true,
      graphId,
      sourceQueued: true,
      offline: true,
      deliveryPending: true,
      operationIds: operations.map(operation => operation.operationId),
    })
  }

  private mcpEnvelope(value: Record<string, unknown>): Record<string, unknown> {
    return {
      structuredContent: value,
      content: [{ type: 'text', text: JSON.stringify(value) }],
    }
  }

  private randomId(): string {
    return globalThis.crypto?.randomUUID?.()
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }

  private randomUuid(): string {
    const direct = globalThis.crypto?.randomUUID?.()
    if (direct) return direct
    const bytes = new Uint8Array(16)
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
    else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256)
      }
    }
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  /**
   * Stable within one mirror epoch and different across epochs. The Surface
   * host treats service identity as a hard resource scope boundary, clearing
   * retained derived stores before it reacquires query faces.
   */
  surfaceQueryService(graphId: string): QueryBlockService {
    const entry = this.entry(graphId)
    const state = entry.manager.get()
    const identity = JSON.stringify([
      entry.userId,
      graphId,
      state.epoch,
      state.fenced ? 'fenced' : state.complete ? 'complete' : 'live',
    ])
    const existing = this.surfaceServices.get(graphId)
    if (existing?.identity === identity) return existing.service
    const service = makeQueryBlockService(this.rest)
    this.surfaceServices.set(graphId, { identity, service })
    return service
  }

  /**
   * The mirror's current bundle, iff it is USABLE (MO object-face
   * integration spec, WS1 §5.2): `state.complete ∧ ¬state.fenced ∧
   * ¬locallyDeleted` — exactly `usableBundle`'s private rule, exposed
   * publicly so `SourceObjectService`'s mirror path (§6.2.2) never guesses
   * at a fenced or locally-deleted graph. No behaviour change.
   */
  bundleFor(graphId: string): SourceBundle | undefined {
    return this.usableBundle(graphId)
  }

  private usableBundle(graphId: string): SourceBundle | undefined {
    const entry = this.currentEntry(graphId)
    if (!entry) return undefined
    const state = entry.manager.get()
    if (!state.complete
      || state.fenced
      || this.locallyDeleted(graphId, state.graphIncarnation)) return undefined
    return entry.manager.bundle()
  }

  private locallyDeleted(graphId: string, graphIncarnation: string | null): boolean {
    if (!graphIncarnation) return false
    return [...this.lifecycleManagers.values()]
      .flatMap(manager => manager.records())
      .some(intent => (
        intent.kind === 'delete'
        && intent.status !== 'conflict'
        && intent.graphId === graphId
        && intent.graphIncarnation === graphIncarnation
      ))
  }

  private currentEntry(graphId: string): MirrorEntry | undefined {
    return this.entries.get(this.entryKey(this.options.auth.userId(), graphId))
  }

  private entry(graphId: string): MirrorEntry {
    const userId = this.options.auth.userId().trim()
    const normalizedGraph = graphId.trim()
    if (!userId || !normalizedGraph) {
      throw new Error('SourceMirrorRuntime: userId and graphId are required')
    }
    const key = this.entryKey(userId, normalizedGraph)
    let entry = this.entries.get(key)
    if (!entry) {
      const manager = new SourceMirrorManager({
        identity: { userId, graphId: normalizedGraph },
        storage: this.storage,
        transport: this.transport,
      })
      entry = { userId, graphId: normalizedGraph, manager, opened: null, syncing: null }
      manager.subscribe(() => this.publish(entry!))
      this.entries.set(key, entry)
    }
    return entry
  }

  private entryKey(userId: string, graphId: string): string {
    return JSON.stringify([userId, graphId])
  }

  private publish(entry: MirrorEntry): void {
    this.surfaceServices.delete(entry.graphId)
    const state = entry.manager.get()
    for (const observer of this.observers) observer(entry.graphId, state)
  }
}
