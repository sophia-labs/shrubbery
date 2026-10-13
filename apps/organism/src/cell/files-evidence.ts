/**
 * What the kinds found in the files of a place, for the Files surfaces (plans/2026-10-08-datasheets-in-sophia.md §2, §3).
 *
 * One batched SPARQL query per visible place, built from the registered kinds (`files-kinds/registry.ts`), every pattern inside
 * `GRAPH ?g { ... }`. A cell without the records (or without the tool) answers with no rows and every file renders as before.
 * This module is the loading: asking, polling while something reads, noticing a read that ended. What a kind looks like and what
 * it says is the kind's.
 */
import type { FileEvidence, ReadState } from '@shrubbery/nucleus'
import { FILE_KINDS, evidenceQuery, readEvidence, type FileKind } from './files-kinds/index.js'

export { evidenceQuery, readEvidence }

/** Progress from outside the graph (slice 5's gateway status route): merged over what the records say. */
export interface ReadStatus {
  readonly state: ReadState
  readonly page?: number
  readonly pages?: number
  readonly error?: string
}

export interface FilesEvidenceDeps {
  /** A cell tool by name, as its JSON value (`FilesClient.tool`). */
  readonly tool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** The kinds to ask for; the registered ones by default. */
  readonly kinds?: readonly FileKind[]
  /** The hook for the reading's own progress; absent until the read job exists. */
  readonly readStatus?: (graphId: string, artifactIds: readonly string[]) => Promise<Readonly<Record<string, ReadStatus>>>
  readonly onChange: () => void
  /** Called once per file whose read finished or failed while this session watched. */
  readonly onTransition?: (artifactId: string, now: FileEvidence, was: ReadState) => void
  /** Poll while something is being read; the idle refresh finds imports that landed meanwhile. */
  readonly activeMs?: number
  readonly idleMs?: number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const ACTIVE = new Set<ReadState>(['queued', 'reading'])

export class FilesEvidence {
  private graphId = ''
  private ids: readonly string[] = []
  private key = ''
  private known = new Map<string, FileEvidence>()
  private generation = 0
  private timer: unknown = null
  private disposed = false

  constructor(private readonly deps: FilesEvidenceDeps) {}

  get(artifactId: string): FileEvidence | undefined { return this.known.get(artifactId) }

  /** Whether any file of the place is waiting or being read. */
  get active(): boolean { return [...this.known.values()].some(e => ACTIVE.has(e.state)) }

  /** The place now shows these artifacts (PDFs). A place already read is not asked again until its refresh. */
  sync(graphId: string, artifactIds: readonly string[]): void {
    const ids = [...artifactIds].sort()
    const key = `${graphId}|${ids.join(',')}`
    if (key === this.key) return
    this.key = key
    this.graphId = graphId
    this.ids = ids
    // Evidence of files no longer shown is dropped; the rest stays on screen while the new query runs.
    for (const id of [...this.known.keys()]) if (!ids.includes(id)) this.known.delete(id)
    void this.load()
  }

  /** Ask again now (after an upload or an import the shell knows of). */
  refresh(): void { void this.load() }

  dispose(): void { this.disposed = true; this.stopTimer() }

  private stopTimer(): void {
    if (this.timer !== null) { (this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer); this.timer = null }
  }

  private schedule(): void {
    this.stopTimer()
    if (this.disposed || !this.ids.length) return
    const ms = this.active ? this.deps.activeMs ?? 3000 : this.deps.idleMs ?? 30000
    this.timer = (this.deps.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t)))(() => { this.timer = null; void this.load() }, ms)
  }

  private async load(): Promise<void> {
    const generation = ++this.generation
    const { graphId, ids } = this
    if (!ids.length) {
      if (this.known.size) { this.known.clear(); this.deps.onChange() }
      return
    }
    let next = new Map<string, FileEvidence>()
    try {
      const result = await this.deps.tool('sparql_query', { graphId, query: evidenceQuery(this.deps.kinds ?? FILE_KINDS, ids) })
      const rows = Array.isArray(result.rows) ? result.rows as Record<string, unknown>[] : []
      next = readEvidence(this.deps.kinds ?? FILE_KINDS, rows)
    } catch {
      // A cell without the records or the tool: every file renders as it did. Asked again at the idle refresh.
      if (generation === this.generation) this.schedule()
      return
    }
    if (this.deps.readStatus) {
      try {
        const status = await this.deps.readStatus(graphId, ids)
        for (const [id, s] of Object.entries(status)) {
          const was = next.get(id)
          next.set(id, { ...(was ?? EMPTY), state: s.state,
            ...(s.state === 'reading' && s.pages ? { progress: { page: s.page ?? 0, pages: s.pages } } : {}),
            ...(s.error ? { error: s.error } : {}) })
        }
      } catch { /* the records stand alone */ }
    }
    if (this.disposed || generation !== this.generation) return
    const before = this.known
    this.known = next
    let changed = before.size !== next.size
    for (const [id, e] of next) {
      const was = before.get(id)
      if (!was || JSON.stringify(was) !== JSON.stringify(e)) changed = true
      if (was && ACTIVE.has(was.state) && (e.state === 'read' || e.state === 'failed')) this.deps.onTransition?.(id, e, was.state)
    }
    if (changed) this.deps.onChange()
    this.schedule()
  }
}

const EMPTY: FileEvidence = Object.freeze({
  kind: '', title: '', subtitle: [], values: [], state: 'read' as ReadState, doneBadge: '', summary: '', cells: [], lookable: false,
})
