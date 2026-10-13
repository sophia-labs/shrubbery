/**
 * room-mirror.ts — el Despacho S0: the ROOM MIRROR
 * (plans/2026-09-15-despacho-first-principles.md §3.2, §6 S0).
 *
 * Why this exists, measured 2026-09-15 against the Sirin `sophia-cluster`
 * cell: every fragment face query paid ~0.7–1.0 s of FIXED gateway→cell
 * latency (the SPARQL itself was trivial — `SELECT (1 AS ?x) WHERE {}` cost
 * the same as the whole-store count), and one chapter of the surface fires
 * six to eight of them. The shell already ships an in-browser Oxigraph and a
 * `SourceMirrorRuntime` over it, but that mirror is fed by `source_pull`,
 * which is WHOLE-GRAPH (a million quads for sophia-cluster) and paused for
 * oversized graphs since 8a538ff, so it never completes and every Surface
 * read falls through to the network. The mistake was never "no local store";
 * it was whole-graph mirroring for a room that needs four named graphs.
 *
 * What this does: for one graph session, `rdf_dump` a DECLARED list of named
 * graphs (`ROOM_MIRROR_GRAPHS` — small, projection-sized, regenerable from
 * the cell), load them into a fresh `Oxigraph.Store` under their own graph
 * names, persist the N-Triples per graph (IndexedDB when present) so the next
 * visit reads before the network answers, and expose a `QueryBlockService`
 * of the SAME shape `makeQueryBlockService(rest)` produces — so faces never
 * learn which backend they read from — that answers from the local store
 * when a query can be answered there and falls through to the live cell,
 * counted and visible, when it cannot.
 *
 * What it deliberately does NOT do: change the write path. A verb still
 * plans, dry-runs and applies through `emporium_write` at the gateway; this
 * module only re-dumps the graph that write targeted (`wrapVerbPort`), and
 * polls the room's graphs on a modest timer. Auth, admission, SHACL and the
 * journal stay at the cell. The mirror is a cache with a stamp on it.
 *
 * Routing rule (`routeLocally`): a query is answered locally iff the mirror
 * is ready AND every named graph the query mentions literally (`<urn:…>`)
 * is one of the mirrored graphs AND it names no graph by variable
 * (`GRAPH ?g`) or dataset clause (`FROM`). A query with no GRAPH clause at
 * all reads the default graph, which is empty on the cell and empty here —
 * parity, not a guess. Anything else goes to the cell, and the stamp says
 * how often that happened.
 */
import * as Oxigraph from 'oxigraph'
import type { Quad, Term } from 'oxigraph'
import type { RestClient } from '@shrubbery/nucleus'
import { inferQueryBlockQueryKind, makeQueryBlockService, type QueryBlockService } from '@shrubbery/runtime'
import type { CuentaVerbPort } from '@shrubbery/runtime'

/**
 * The named graphs a Despacho room needs, as suffixes under
 * `urn:mnemosyne:local:graph:{graphId}:`. Declared, not discovered: the room
 * mirrors projections it can regenerate from the cell, never `:projection:
 * semantic` (341 046 quads on sophia-cluster) nor the document projections —
 * those are Garden's, and the room links out to them.
 *
 *   projection:cuentas   — the beads and their Rendiciones (the campaign string)
 *   projection:correo    — the seats, letters, acks and runs of the Demi register
 *   projection:chamber   — the chamber's DomainOntology records (a class's shape
 *                          and subject rule, so a verb's records can be read
 *                          back locally, and a vocab's write_target resolved)
 *   migration:chronicle  — the movements of the cloud-3 crossing (story-as-data)
 */
export const ROOM_MIRROR_GRAPHS: readonly string[] = Object.freeze([
  'projection:cuentas',
  'projection:correo',
  'projection:chamber',
  'migration:chronicle',
])

/** Default re-dump cadence while a room is open. The dump is cheap by count and ~0.7 s by fixed cost, so once a minute per graph is honest and affordable. */
export const ROOM_MIRROR_POLL_MS = 60_000

export function roomGraphIri(graphId: string, suffix: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:${suffix}`
}

export function roomGraphIris(graphId: string): readonly string[] {
  return ROOM_MIRROR_GRAPHS.map((suffix) => roomGraphIri(graphId, suffix))
}

/** The `rdf_dump` seam: the organism's UNWRAPPED MCP caller satisfies it (`callTool('rdf_dump', …)` → the envelope). */
export interface RoomMirrorDumper {
  dump(graphId: string, sourceGraphIri: string): Promise<{ readonly data?: string } | undefined>
}

/** Build a dumper over an MCP caller of the `rawMcp` shape (both cell contracts expose one). */
export function mcpRoomMirrorDumper(caller: { callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> }): RoomMirrorDumper {
  return {
    async dump(graphId, sourceGraphIri) {
      const result = await caller.callTool('rdf_dump', { graphId, format: 'application/n-triples', sourceGraphIri })
      if (result && typeof result === 'object') return result as { readonly data?: string }
      if (typeof result === 'string') return JSON.parse(result) as { readonly data?: string }
      return undefined
    },
  }
}

export interface RoomMirrorGraphRecord {
  readonly graphIri: string
  /** N-Triples body exactly as the cell dumped it. */
  readonly nt: string
  readonly quadCount: number
  readonly syncedAt: number
  /** Cheap content digest of `nt` — a content change is what rotates the query service identity. */
  readonly digest: string
}

export interface RoomMirrorStorage {
  read(userId: string, graphId: string, graphIri: string): Promise<RoomMirrorGraphRecord | null>
  write(userId: string, graphId: string, record: RoomMirrorGraphRecord): Promise<void>
}

export class MemoryRoomMirrorStorage implements RoomMirrorStorage {
  private readonly records = new Map<string, RoomMirrorGraphRecord>()
  async read(userId: string, graphId: string, graphIri: string): Promise<RoomMirrorGraphRecord | null> {
    return this.records.get(JSON.stringify([userId, graphId, graphIri])) ?? null
  }
  async write(userId: string, graphId: string, record: RoomMirrorGraphRecord): Promise<void> {
    this.records.set(JSON.stringify([userId, graphId, record.graphIri]), record)
  }
}

const IDB_NAME = 'shrubbery-room-mirror-v1'
const IDB_STORE = 'graphs'

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** Per-graph N-Triples in IndexedDB, keyed by (user, graph, named graph). Nothing else is stored; the cell remains the truth. */
export class IndexedDbRoomMirrorStorage implements RoomMirrorStorage {
  private opened: Promise<IDBDatabase> | null = null
  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    if (!this.opened) {
      this.opened = new Promise((resolve, reject) => {
        const request = this.factory.open(IDB_NAME, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'key' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      })
    }
    return this.opened
  }

  async read(userId: string, graphId: string, graphIri: string): Promise<RoomMirrorGraphRecord | null> {
    const db = await this.open()
    const key = JSON.stringify([userId, graphId, graphIri])
    const row = await idbRequest(db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)) as
      | ({ readonly key: string } & RoomMirrorGraphRecord)
      | undefined
    if (!row) return null
    const { key: _key, ...record } = row
    return record
  }

  async write(userId: string, graphId: string, record: RoomMirrorGraphRecord): Promise<void> {
    const db = await this.open()
    const key = JSON.stringify([userId, graphId, record.graphIri])
    const transaction = db.transaction(IDB_STORE, 'readwrite')
    transaction.objectStore(IDB_STORE).put({ key, ...record })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'))
    })
  }
}

export type RoomMirrorStatus = 'absent' | 'restoring' | 'syncing' | 'ready' | 'error'

export interface RoomMirrorGraphState {
  readonly graphIri: string
  readonly quadCount: number
  readonly syncedAt: number | null
}

export interface RoomMirrorQueryStats {
  readonly count: number
  readonly totalMs: number
  readonly maxMs: number
}

export interface RoomMirrorState {
  readonly graphId: string
  readonly status: RoomMirrorStatus
  /** True while the store in use came from storage and no live dump has landed yet in this session. */
  readonly restored: boolean
  readonly syncedAt: number | null
  readonly lastSyncMs: number | null
  readonly quadCount: number
  readonly graphs: readonly RoomMirrorGraphState[]
  readonly error: string | null
  /** Reads answered from the local store vs. sent to the cell (this session). */
  readonly local: RoomMirrorQueryStats
  readonly remote: RoomMirrorQueryStats
  /** Rotates whenever the mirrored CONTENT changes; the shell's query-service identity follows it. */
  readonly epoch: string
}

export interface RoomMirrorOptions {
  readonly dumper: RoomMirrorDumper
  readonly liveRest: RestClient
  readonly userId: () => string
  readonly storage?: RoomMirrorStorage
  /** Called after any state change (status, sync, stats). The shell re-renders on it. */
  readonly onChange?: (graphId: string, state: RoomMirrorState) => void
  readonly pollMs?: number
  /** Override the graph list (tests). Production uses `roomGraphIris`. */
  readonly graphIrisFor?: (graphId: string) => readonly string[]
  readonly now?: () => number
}

interface RoomEntry {
  readonly graphId: string
  status: RoomMirrorStatus
  restored: boolean
  store: InstanceType<typeof Oxigraph.Store> | null
  records: Map<string, RoomMirrorGraphRecord>
  syncedAt: number | null
  lastSyncMs: number | null
  error: string | null
  local: { count: number; totalMs: number; maxMs: number }
  remote: { count: number; totalMs: number; maxMs: number }
  epoch: string
  opening: Promise<void> | null
  syncing: Promise<void> | null
  timer: ReturnType<typeof setInterval> | null
  service: { readonly identity: string; readonly service: QueryBlockService } | null
}

const GRAPH_VARIABLE = /\bGRAPH\s*\?/i
const DATASET_CLAUSE = /\bFROM\b/i
/**
 * Only the IRIs a `GRAPH <…>` clause names count as graphs. A bead's SUBJECT
 * (`…:projection:cuentas:cuenta:despacho`) lives under the same graph root and
 * must never be mistaken for an unmirrored graph — the first draft of this
 * rule did exactly that and sent every focused chapter query to the cell.
 */
const GRAPH_CLAUSE_IRI = /\bGRAPH\s*<([^>]+)>/gi
const LOCAL_ROOT_IRI = /<(urn:mnemosyne:local:graph:[^>]+)>/g

/**
 * Pure — exported for tests. The routing rule, in full:
 *
 *  1. `FROM` (a dataset clause) → the cell.
 *  2. Every `GRAPH <iri>` clause must name a mirrored graph, else → the cell.
 *  3. `GRAPH ?g` (every reading module — cuenta, seat, letter, the focus
 *     probe — reads in this card.subject-inherited shape) is answered locally
 *     ONLY when the query names at least one literal IRI the room OWNS — a
 *     subject or object minted under a mirrored graph's root, e.g.
 *     `…:projection:cuentas:cuenta:…` — and every other local-graph IRI it
 *     names is likewise owned or mirrored. A `GRAPH ?g` with no owned IRI
 *     (a whole-store count) → the cell.
 *
 * Rule 3 rests on a fact, not a hope, PROBED on the live Sirin sophia-cluster
 * cell 2026-09-15: every triple whose subject or object is under the cuentas /
 * correo / chronicle roots, and every triple carrying a cta: / cor: / mig:
 * predicate, lives in its own projection graph and nowhere else (cuentas
 * 2 068 / correo 30 216 / chronicle 40 by subject; zero in any other graph).
 * A chamber vocabulary's records are minted by `subject_rule` into its own
 * `write_target`, so this stays true by construction for chamber-written
 * projections; the source authority and the semantic index never write those
 * roots. Should another writer ever put room-rooted triples elsewhere, the
 * local answer would be a subset — which is why the rule is stated here and
 * the stamp counts what went where.
 */
export function routeLocally(sparql: string, mirroredGraphIris: ReadonlySet<string>): boolean {
  if (DATASET_CLAUSE.test(sparql)) return false
  for (const match of sparql.matchAll(GRAPH_CLAUSE_IRI)) {
    if (!mirroredGraphIris.has(match[1]!)) return false
  }
  if (!GRAPH_VARIABLE.test(sparql)) return true
  const roots = [...mirroredGraphIris].map((iri) => `${iri}:`)
  let owned = 0
  for (const match of sparql.matchAll(LOCAL_ROOT_IRI)) {
    const iri = match[1]!
    if (mirroredGraphIris.has(iri)) continue
    if (roots.some((root) => iri.startsWith(root))) { owned += 1; continue }
    return false
  }
  return owned > 0
}

/** FNV-1a over the text plus its length — a content identity, not a security hash. */
export function contentDigest(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length}:${hash.toString(16).padStart(8, '0')}`
}

function countTriples(nt: string): number {
  let count = 0
  for (const line of nt.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) count += 1
  }
  return count
}

let wasmReady: Promise<void> | null = null
/** Oxigraph's browser entry exposes an async initializer; the Node entry initializes synchronously (same distinction `source-mirror-runtime.ts` keeps). */
function prepareOxigraph(): Promise<void> {
  if (!wasmReady) {
    const init = (Oxigraph as unknown as { readonly default?: unknown }).default
    wasmReady = typeof init === 'function'
      ? Promise.resolve((init as () => Promise<unknown>)()).then(() => {})
      : Promise.resolve()
  }
  return wasmReady
}

function envelopeFromLocalQuery(store: InstanceType<typeof Oxigraph.Store>, sparql: string): unknown {
  const kind = inferQueryBlockQueryKind(sparql)
  const result = store.query(sparql)
  if (kind === 'ask') {
    if (typeof result !== 'boolean') throw new Error('RoomMirror: ASK did not return a boolean')
    return { resultType: 'boolean', variables: [], rows: [], boolean: result, graph: null, quadCount: store.size }
  }
  if (kind === 'select') {
    if (!Array.isArray(result) || result.some((row) => !(row instanceof Map))) {
      throw new Error('RoomMirror: SELECT did not return solution mappings')
    }
    const variables: string[] = []
    const rows = (result as Array<Map<string, Term>>).map((solution) => {
      const row: Record<string, string> = {}
      for (const [variable, term] of solution) {
        if (!variables.includes(variable)) variables.push(variable)
        // RDF/JS Oxigraph term Display is the same boundary representation the
        // cell's Rust Oxigraph emits: <iri>, _:blank, or a quoted literal.
        row[variable] = term.toString()
      }
      return row
    })
    return { resultType: 'solutions', variables, rows, boolean: null, graph: null, quadCount: store.size }
  }
  if (!Array.isArray(result) || result.some((value) => value instanceof Map)) {
    throw new Error(`RoomMirror: ${kind.toUpperCase()} did not return graph quads`)
  }
  const graph = (result as Quad[]).map((quad) => `${quad.toString()} .\n`).join('')
  return { resultType: 'graph', variables: [], rows: [], boolean: null, graph, quadCount: store.size, data: graph, mediaType: 'application/n-quads' }
}

export class RoomMirror {
  private readonly entries = new Map<string, RoomEntry>()
  private readonly storage: RoomMirrorStorage
  private readonly now: () => number

  constructor(private readonly options: RoomMirrorOptions) {
    this.storage = options.storage ?? (globalThis.indexedDB ? new IndexedDbRoomMirrorStorage(globalThis.indexedDB) : new MemoryRoomMirrorStorage())
    this.now = options.now ?? (() => Date.now())
    void prepareOxigraph().catch(() => {
      // The exact initialization error is surfaced by the first sync; construction stays non-blocking.
    })
  }

  graphIrisFor(graphId: string): readonly string[] {
    return this.options.graphIrisFor ? this.options.graphIrisFor(graphId) : roomGraphIris(graphId)
  }

  state(graphId: string): RoomMirrorState {
    const entry = this.entries.get(graphId)
    if (!entry) {
      return { graphId, status: 'absent', restored: false, syncedAt: null, lastSyncMs: null, quadCount: 0, graphs: [], error: null, local: { count: 0, totalMs: 0, maxMs: 0 }, remote: { count: 0, totalMs: 0, maxMs: 0 }, epoch: '' }
    }
    return this.snapshot(entry)
  }

  private snapshot(entry: RoomEntry): RoomMirrorState {
    const graphs = this.graphIrisFor(entry.graphId).map((graphIri) => {
      const record = entry.records.get(graphIri)
      return { graphIri, quadCount: record?.quadCount ?? 0, syncedAt: record?.syncedAt ?? null }
    })
    return {
      graphId: entry.graphId,
      status: entry.status,
      restored: entry.restored,
      syncedAt: entry.syncedAt,
      lastSyncMs: entry.lastSyncMs,
      quadCount: entry.store?.size ?? 0,
      graphs,
      error: entry.error,
      local: { ...entry.local },
      remote: { ...entry.remote },
      epoch: entry.epoch,
    }
  }

  private entry(graphId: string): RoomEntry {
    let entry = this.entries.get(graphId)
    if (!entry) {
      entry = {
        graphId, status: 'absent', restored: false, store: null, records: new Map(), syncedAt: null, lastSyncMs: null, error: null,
        local: { count: 0, totalMs: 0, maxMs: 0 }, remote: { count: 0, totalMs: 0, maxMs: 0 }, epoch: '', opening: null, syncing: null, timer: null, service: null,
      }
      this.entries.set(graphId, entry)
    }
    return entry
  }

  private publish(entry: RoomEntry): void {
    this.options.onChange?.(entry.graphId, this.snapshot(entry))
  }

  /**
   * Idempotent: restore from storage (render immediately, marked as restored),
   * then dump live in the background, then poll. Safe to call on every render
   * pass; only the first call per graph does anything.
   */
  ensureOpen(graphId: string): Promise<void> {
    const entry = this.entry(graphId)
    if (entry.opening) return entry.opening
    entry.status = 'restoring'
    this.publish(entry)
    entry.opening = (async () => {
      try {
        const userId = this.options.userId()
        const restored = new Map<string, RoomMirrorGraphRecord>()
        for (const graphIri of this.graphIrisFor(graphId)) {
          const record = await this.storage.read(userId, graphId, graphIri).catch(() => null)
          if (record) restored.set(graphIri, record)
        }
        if (restored.size === this.graphIrisFor(graphId).length) {
          await this.install(entry, restored, { restored: true, syncMs: null })
        }
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error)
      }
      await this.sync(graphId)
      if (!entry.timer) {
        const pollMs = this.options.pollMs ?? ROOM_MIRROR_POLL_MS
        if (pollMs > 0) entry.timer = setInterval(() => { void this.sync(graphId) }, pollMs)
      }
    })()
    return entry.opening
  }

  /** Dump every room graph (or just `graphIris`) from the cell and swap the store. Concurrent calls coalesce. */
  sync(graphId: string, graphIris?: readonly string[]): Promise<void> {
    const entry = this.entry(graphId)
    if (entry.syncing) return entry.syncing
    entry.status = 'syncing'
    entry.error = null
    this.publish(entry)
    const started = this.now()
    entry.syncing = (async () => {
      try {
        await prepareOxigraph()
        const userId = this.options.userId()
        const targets = graphIris ?? this.graphIrisFor(graphId)
        const dumped = await Promise.all(targets.map(async (graphIri) => {
          const envelope = await this.options.dumper.dump(graphId, graphIri)
          const nt = typeof envelope?.data === 'string' ? envelope.data : ''
          const record: RoomMirrorGraphRecord = { graphIri, nt, quadCount: countTriples(nt), syncedAt: this.now(), digest: contentDigest(nt) }
          return record
        }))
        const next = new Map(entry.records)
        for (const record of dumped) next.set(record.graphIri, record)
        await this.install(entry, next, { restored: false, syncMs: this.now() - started })
        for (const record of dumped) await this.storage.write(userId, graphId, record).catch(() => {})
      } catch (error) {
        entry.status = entry.store ? 'ready' : 'error'
        entry.error = error instanceof Error ? error.message : String(error)
        this.publish(entry)
      } finally {
        entry.syncing = null
      }
    })()
    return entry.syncing
  }

  private async install(entry: RoomEntry, records: Map<string, RoomMirrorGraphRecord>, meta: { readonly restored: boolean; readonly syncMs: number | null }): Promise<void> {
    await prepareOxigraph()
    const store = new Oxigraph.Store()
    for (const record of records.values()) {
      if (!record.nt.trim()) continue
      store.load(record.nt, { format: 'application/n-triples', to_graph_name: Oxigraph.namedNode(record.graphIri) })
    }
    const epoch = [...records.values()].map((record) => `${record.graphIri}=${record.digest}`).sort().join('|')
    entry.store = store
    entry.records = records
    entry.status = 'ready'
    entry.restored = meta.restored
    entry.syncedAt = Math.max(...[...records.values()].map((record) => record.syncedAt), 0) || null
    if (meta.syncMs !== null) entry.lastSyncMs = meta.syncMs
    entry.epoch = epoch
    this.publish(entry)
  }

  /** After a write the room knows about: re-dump the graph it targeted (if mirrored), awaiting the swap so the caller's next read is fresh. */
  async touched(graphId: string, sourceGraphIri: string): Promise<boolean> {
    if (!this.graphIrisFor(graphId).includes(sourceGraphIri)) return false
    await this.sync(graphId, [sourceGraphIri])
    return true
  }

  close(graphId: string): void {
    const entry = this.entries.get(graphId)
    if (!entry) return
    if (entry.timer) clearInterval(entry.timer)
    this.entries.delete(graphId)
  }

  /** Stop every poll and drop every store — the session that owned this mirror is over. Storage is kept for the next visit. */
  closeAll(): void {
    for (const graphId of [...this.entries.keys()]) this.close(graphId)
  }

  /**
   * The mirror's own resolution of a vocab's write target, read from the
   * mirrored chamber (`chm:contractJson.write_target`); falls back to the
   * emporium's convention `projection:<vocab>`.
   */
  writeTargetGraphIri(graphId: string, vocab: string): string {
    const entry = this.entries.get(graphId)
    const fallback = roomGraphIri(graphId, `projection:${vocab}`)
    if (!entry?.store) return fallback
    try {
      const chamber = roomGraphIri(graphId, 'projection:chamber')
      const rows = entry.store.query(
        `SELECT ?json WHERE { GRAPH <${chamber}> { ?s <http://mnemosyne.dev/chamber#ontologyName> "${vocab.replace(/["\\]/g, '')}" ; <http://mnemosyne.dev/chamber#status> "active" ; <http://mnemosyne.dev/chamber#contractJson> ?json } } LIMIT 1`,
      ) as Array<Map<string, Term>>
      const json = rows[0]?.get('json')?.value
      if (!json) return fallback
      const target = (JSON.parse(json) as { write_target?: string }).write_target
      return typeof target === 'string' && target ? roomGraphIri(graphId, target) : fallback
    } catch {
      return fallback
    }
  }

  /**
   * The verb seam, wrapped: an `emporium_write` that is NOT a dry run and
   * came back ok re-dumps the graph it targeted BEFORE the result returns to
   * the executor, so the face's re-read after a word sees the new Rendición.
   * Every other call passes through untouched.
   */
  wrapVerbPort(port: CuentaVerbPort, graphId: string): CuentaVerbPort {
    return {
      callTool: async (name, args) => {
        const result = await port.callTool(name, args)
        if (name !== 'emporium_write') return result
        if (args.dryRun === true || args.dry_run === true) return result
        const vocab = typeof args.vocab === 'string' ? args.vocab : null
        if (!vocab) return result
        const ok = result && typeof result === 'object' && (result as { ok?: unknown }).ok === true
        if (!ok) return result
        await this.touched(graphId, this.writeTargetGraphIri(graphId, vocab)).catch(() => false)
        return result
      },
    }
  }

  /**
   * The `QueryBlockService` for a graph once its mirror is ready, else null
   * (the shell then falls back to its existing service). One identity per
   * mirrored CONTENT: the shell treats an identity change as a resource
   * boundary, so a poll that dumps identical bytes rotates nothing, and a
   * real change rotates exactly once.
   */
  queryService(graphId: string): QueryBlockService | null {
    const entry = this.entries.get(graphId)
    if (!entry || !entry.store || entry.status === 'error') return null
    const identity = `${this.options.userId()}\u001f${graphId}\u001f${entry.epoch}`
    if (entry.service?.identity === identity) return entry.service.service
    const mirrored = new Set(this.graphIrisFor(graphId))
    const live = this.options.liveRest
    const self = this
    const roomRest: RestClient = {
      graphs: () => live.graphs(),
      update: (g, sparql) => live.update(g, sparql),
      ...(live.documentUpdate ? { documentUpdate: (g: string, d: string, o?: { readonly signal?: AbortSignal }) => live.documentUpdate!(g, d, o) } : {}),
      async query(queryGraphId, sparql) {
        const current = self.entries.get(graphId)
        const store = queryGraphId === graphId ? current?.store : null
        const started = self.now()
        if (store && routeLocally(sparql, mirrored)) {
          try {
            return envelopeFromLocalQuery(store, sparql)
          } finally {
            record(current!, 'local', self.now() - started)
          }
        }
        try {
          return await live.query(queryGraphId, sparql)
        } finally {
          if (current) record(current, 'remote', self.now() - started)
        }
      },
    }
    const service = makeQueryBlockService(roomRest)
    entry.service = { identity, service }
    return service

    function record(target: RoomEntry, lane: 'local' | 'remote', ms: number): void {
      const stats = target[lane]
      stats.count += 1
      stats.totalMs += ms
      if (ms > stats.maxMs) stats.maxMs = ms
      self.publish(target)
    }
  }
}

/** One line of honest text for the stamp — exported for tests. */
export function roomMirrorStampText(state: RoomMirrorState, now: number = Date.now()): string {
  const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n)
  const ago = (at: number | null) => {
    if (at === null) return 'never'
    const seconds = Math.max(0, Math.round((now - at) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.round(seconds / 60)
    return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
  }
  const reads = `reads: ${fmt(state.local.count)} local${state.local.count ? ` (avg ${(state.local.totalMs / Math.max(1, state.local.count)).toFixed(1)} ms)` : ''} · ${fmt(state.remote.count)} to the cell${state.remote.count ? ` (avg ${Math.round(state.remote.totalMs / Math.max(1, state.remote.count))} ms)` : ''}`
  switch (state.status) {
    case 'absent': return 'room mirror: off — every read goes to the cell'
    case 'restoring': return 'room mirror: restoring from this browser…'
    case 'syncing': return `room mirror: syncing ${state.graphs.length} graphs from the cell… · ${reads}`
    case 'error': return `room mirror: ${state.error ?? 'failed'} — reads go to the cell · ${reads}`
    case 'ready':
      return `room mirror: ${state.restored ? 'restored from this browser' : 'synced'} ${ago(state.syncedAt)} · ${state.graphs.length} graphs · ${fmt(state.quadCount)} quads${state.lastSyncMs !== null ? ` · sync ${(state.lastSyncMs / 1000).toFixed(1)} s` : ''} · ${reads}`
  }
}

const STAMP_STYLE_ID = 'room-mirror-stamp-style'
const STAMP_STYLE = `
.room-mirror-stamp{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;padding:.3rem .8rem;font:12px/1.4 var(--mn-font-mono, ui-monospace, monospace);color:var(--mn-color-text-muted,#5b5f66);background:var(--mn-color-surface-sunken,rgba(0,0,0,.035));border-bottom:1px solid var(--mn-color-border-subtle,rgba(0,0,0,.08))}
.room-mirror-stamp[data-status="ready"] .room-mirror-dot{color:var(--mn-color-status-good,#3a7d5c)}
.room-mirror-stamp[data-status="syncing"] .room-mirror-dot,.room-mirror-stamp[data-status="restoring"] .room-mirror-dot{color:var(--mn-color-status-warning,#b8860b)}
.room-mirror-stamp[data-status="error"] .room-mirror-dot,.room-mirror-stamp[data-status="absent"] .room-mirror-dot{color:var(--mn-color-status-critical,#a33)}
.room-mirror-stamp button{font:inherit;padding:.1rem .5rem;border:1px solid currentColor;border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.room-mirror-stamp button:disabled{opacity:.5;cursor:default}
`

export interface RoomMirrorStamp {
  /** Idempotent; call on every render pass. `null` state hides the stamp. */
  sync(state: RoomMirrorState | null, onResync: (() => void) | null): void
  readonly element: HTMLElement
}

/**
 * The visible, honest stamp: a `DisplayKind=state` strip prepended inside
 * the shell's render host as an UNMANAGED sibling (Lit leaves nodes it did
 * not create alone — the same idiom the Observatory freshness governor uses).
 */
export function createRoomMirrorStamp(hostEl: HTMLElement): RoomMirrorStamp {
  const doc = hostEl.ownerDocument ?? document
  if (!doc.getElementById(STAMP_STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STAMP_STYLE_ID
    style.textContent = STAMP_STYLE
    doc.head.appendChild(style)
  }
  const element = doc.createElement('div')
  element.className = 'room-mirror-stamp'
  element.setAttribute('data-kind', 'state')
  element.setAttribute('data-room-mirror', '')
  element.hidden = true
  const dot = doc.createElement('span')
  dot.className = 'room-mirror-dot'
  dot.textContent = '●'
  const text = doc.createElement('span')
  text.setAttribute('data-room-mirror-text', '')
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = 'Re-sync'
  let resync: (() => void) | null = null
  button.addEventListener('click', () => resync?.())
  element.append(dot, text, button)
  return {
    element,
    sync(state, onResync) {
      resync = onResync
      if (!state) {
        element.hidden = true
        if (element.parentElement) element.remove()
        return
      }
      if (!element.parentElement) hostEl.prepend(element)
      element.hidden = false
      element.setAttribute('data-status', state.status)
      element.setAttribute('data-epoch', state.epoch)
      text.textContent = roomMirrorStampText(state)
      button.disabled = state.status === 'syncing' || state.status === 'restoring' || onResync === null
    },
  }
}
