/** Visible-artifact lifetime, over Garden's byte read and existing workspace room.
 * Workspace metadata is only an invalidation hint, never executable content.
 */
import type * as Y from 'yjs'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import type { EditorRoomPool, EditorRoomLease } from './editor-room-pool.js'

export const ARTIFACT_TEXT_MAX_BYTES = 2_097_152
export interface ArtifactTextSnapshot {
  readonly graphId: string
  readonly graphIncarnation: string
  readonly artifactId: string
  readonly filename: string
  readonly mimeType: string
  readonly text: string
  readonly sizeBytes: number
  readonly contentHashSha256: string
}

export class ArtifactTextReadError extends Error {
  constructor(message: string, readonly invalidate: boolean = false) { super(message) }
}

export interface ArtifactPreviewState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly snapshot: ArtifactTextSnapshot | null
  readonly error?: string
}

export interface ArtifactLivePreviewOptions {
  readonly read: (signal: AbortSignal) => Promise<ArtifactTextSnapshot>
  readonly watch: (invalidate: () => void, unavailable: (message: string | null) => void) => () => void
  readonly onChange: (state: ArtifactPreviewState) => void
  readonly timeoutMs?: number
}

/** Serial/coalesced reads. Closing retires all callbacks, timers and leases. */
export class ArtifactLivePreview {
  private state: ArtifactPreviewState = { status: 'loading', snapshot: null }
  private closed = false
  private fenced = false
  private started = false
  private scheduled = false
  private pending = false
  private abort: AbortController | null = null
  private stop: (() => void) | null = null
  private incarnation: string | null = null
  private liveError: string | undefined

  constructor(private readonly options: ArtifactLivePreviewOptions) {}
  snapshot(): ArtifactPreviewState { return this.state }

  start(): void {
    if (this.started || this.closed) return
    this.started = true
    this.stop = this.options.watch(() => this.refresh(), error => {
      this.liveError = error ?? undefined
      if (!this.closed) this.publish({ ...this.state, error: this.liveError })
    })
    this.refresh()
  }

  refresh(): void {
    if (this.closed || this.fenced) return
    if (this.abort) { this.pending = true; return }
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.closed && !this.fenced) void this.load()
    })
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.pending = false
    this.abort?.abort()
    this.stop?.()
    this.stop = null
  }

  private publish(state: ArtifactPreviewState): void {
    if (this.closed) return
    this.state = state
    this.options.onChange(state)
  }

  private async load(): Promise<void> {
    const abort = new AbortController()
    this.abort = abort
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ArtifactTextReadError('Artifact refresh timed out or was cancelled.'))
      abort.signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => abort.abort(), this.options.timeoutMs ?? 15_000)
    })
    if (!this.state.snapshot) this.publish({ status: 'loading', snapshot: null })
    try {
      const snapshot = await Promise.race([this.options.read(abort.signal), aborted])
      if (this.closed) return
      if (this.incarnation && snapshot.graphIncarnation !== this.incarnation) {
        this.fenced = true
        this.pending = false
        this.stop?.()
        this.stop = null
        throw new ArtifactTextReadError('This workspace was replaced. Reopen the artifact from its current workspace.', true)
      }
      this.incarnation = snapshot.graphIncarnation
      // A hint that arrived during the read may describe newer bytes. Keep the
      // old committed surface until the one coalesced follow-up has settled.
      if (!this.pending) this.publish({ status: 'ready', snapshot, error: this.liveError })
    } catch (error) {
      if (this.closed) return
      const invalid = error instanceof ArtifactTextReadError && error.invalidate
      if (invalid || !this.pending) {
        const snapshot = invalid ? null : this.state.snapshot
        this.publish({ status: snapshot ? 'ready' : 'error', snapshot,
          error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      clearTimeout(timer)
      if (onAbort) abort.signal.removeEventListener('abort', onAbort)
      if (this.abort === abort) this.abort = null
      if (this.pending && !this.closed) { this.pending = false; this.refresh() }
    }
  }
}

let nextArtifactLease = 0

/** Read-only observation of one entry through the shared authenticated room. */
export function watchArtifactWorkspace(
  contract: Pick<ShrubberyContract, 'auth'>,
  pool: EditorRoomPool,
  graphId: string,
  artifactId: string,
  invalidate: () => void,
  unavailable: (message: string | null) => void,
): () => void {
  let closed = false
  let lease: EditorRoomLease | null = null
  let unobserve: (() => void) | null = null
  let unsubscribe: (() => void) | null = null
  void contract.auth.whenReady().then(() => {
    if (closed) return
    lease = pool.acquire({ kind: 'workspace', graphId }, `artifact-preview-${++nextArtifactLease}`)
    const provider = lease.provider
    const artifacts = (provider.doc as Y.Doc).getMap<Y.Map<unknown>>('artifacts')
    let signature = ''
    const changed = (): void => {
      const item = artifacts.get(artifactId)
      const next = item && typeof item.get === 'function'
        ? JSON.stringify([item.get('contentHashSha256'), item.get('contentOperationId'), item.get('updatedAt')])
        : 'absent'
      if (next === signature) return
      signature = next
      invalidate()
    }
    artifacts.observeDeep(changed)
    unobserve = () => artifacts.unobserveDeep(changed)
    let synchronized = false
    const lifecycle = (): void => {
      if (closed) return
      const state = provider.lifecycle.get()
      const ready = state.connection === 'connected' && state.synchronized
      if (ready && !synchronized) { unavailable(null); invalidate() } // Open/reconnect catches missed hints.
      if (!ready && synchronized) unavailable('Live updates disconnected. Showing the last read; reconnect or refresh to check for changes.')
      synchronized = ready
    }
    unsubscribe = provider.lifecycle.subscribe(lifecycle)
    changed()
    lifecycle()
  }).catch(error => {
    if (!closed) unavailable(`Live updates unavailable: ${error instanceof Error ? error.message : String(error)}`)
  })
  return () => {
    if (closed) return
    closed = true
    unobserve?.()
    unsubscribe?.()
    lease?.release()
  }
}
