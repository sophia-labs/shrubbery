/**
 * How the real shell learns whether a graph's cell serves Files, and what the left tree's Files section looks like then.
 *
 * - Capability (CONTRACT-files §1): one `GET /api/capabilities`. No `files` advert (or not version 1): the pane and every
 *   way into it stay hidden. Nothing is probed.
 * - Incarnation (§7: `graphIncarnation: <from the read>`): only for a cell that advertises Files, one
 *   `GET /navigation/{g}/file-views?folderKey=root`. Never the offline mirror's `source_pull`, which one 50 MB file puts
 *   out of reach (§7.1). A failing read still serves Files (upload, rename, move, trash work) and is asked again on a
 *   later look, so a transient failure never becomes a mode in which positions are not saved.
 * - One discovery per (client, graph); an error is kept until `invalidate()` (a graph switch, a store change, a refresh).
 */
import type { FilePaneSection } from '@shrubbery/nucleus'
import type { FilesAdvert, FilesClient } from './files-contract.js'

export type FilesDiscoveryState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly advert: FilesAdvert; readonly graphIncarnation: string }
  | { readonly status: 'absent' }
  | { readonly status: 'error'; readonly message: string }

const LOADING: FilesDiscoveryState = Object.freeze({ status: 'loading' })
const ABSENT: FilesDiscoveryState = Object.freeze({ status: 'absent' })

export interface FilesDiscoveryOptions {
  /** How long a missing incarnation waits before a later look asks the file-views read again (default 10 s). */
  readonly incarnationRetryMs?: number
}

export class FilesDiscovery {
  private client: FilesClient | null = null
  private graphId = ''
  private current: FilesDiscoveryState = LOADING
  private generation = 0
  private incarnationAskedAt = 0
  private askingIncarnation = false
  private readonly incarnationRetryMs: number

  constructor(private readonly onChange: () => void, options: FilesDiscoveryOptions = {}) {
    this.incarnationRetryMs = Math.max(0, options.incarnationRetryMs ?? 10_000)
  }

  /** What is known for this graph through this client; starts the one discovery when nothing is known yet. */
  state(client: FilesClient, graphId: string): FilesDiscoveryState {
    if (client !== this.client || graphId !== this.graphId) {
      this.client = client
      this.graphId = graphId
      this.start()
    } else if (this.current.status === 'ready' && !this.current.graphIncarnation) {
      // A missing incarnation is a failed read, never a mode: a later look asks again (preferences must save).
      this.askIncarnationAgain()
    }
    return this.current
  }

  private askIncarnationAgain(): void {
    if (this.askingIncarnation || Date.now() - this.incarnationAskedAt < this.incarnationRetryMs) return
    const generation = this.generation
    const client = this.client!
    const graphId = this.graphId
    this.askingIncarnation = true
    this.incarnationAskedAt = Date.now()
    void client.readFileViews(graphId, { folderKey: 'root' }).then(read => {
      if (generation !== this.generation || this.current.status !== 'ready' || !read.graphIncarnation) return
      this.current = { ...this.current, graphIncarnation: read.graphIncarnation }
      this.onChange()
    }, () => { /* still missing; a later look asks again */ }).finally(() => { this.askingIncarnation = false })
  }

  /** Forget what is known; the next `state()` asks the cell again. */
  invalidate(): void {
    this.client = null
    this.graphId = ''
    this.generation += 1
    this.current = LOADING
  }

  private start(): void {
    const generation = ++this.generation
    const client = this.client!
    const graphId = this.graphId
    this.current = LOADING
    const settle = (next: FilesDiscoveryState) => {
      if (generation !== this.generation) return
      this.current = next
      this.onChange()
    }
    void (async () => {
      let advert: FilesAdvert | null
      try { advert = await client.capabilities(graphId) } catch (error) {
        settle({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        return
      }
      if (!advert) { settle(ABSENT); return }
      let graphIncarnation = ''
      this.incarnationAskedAt = Date.now()
      try { graphIncarnation = (await client.readFileViews(graphId, { folderKey: 'root' })).graphIncarnation } catch { /* asked again later */ }
      settle({ status: 'ready', advert, graphIncarnation })
    })()
  }
}

/** The id of the Files section's header action. */
export const FILES_SECTION_ACTION = 'open-files'

/**
 * The left tree is one tree (documents, files and folders together) with the Open Files action beside its header. When the
 * cell does not serve Files, the sections are returned untouched (the same array).
 */
export function filesSidebarSections<T extends FilePaneSection>(sections: readonly T[], visible: boolean): readonly T[] {
  if (!visible || !sections.some(section => section.id === 'tree')) return sections
  return sections.map(section => section.id !== 'tree' ? section : {
    ...section,
    action: { id: FILES_SECTION_ACTION, label: 'Open Files', icon: 'external-link' },
  })
}

/**
 * The deep link to an assertion of a file: `/files/<artifact>#evidence=<claim id>` (the form `datasheet_facts` hands out) or, inside the
 * app's own address, `?graph=<g>#evidence=<claim id>`. The artifact is optional: the kinds know which file an evidence id belongs to.
 */
export function parseEvidenceLink(location: Pick<Location, 'pathname' | 'hash'>): { readonly artifactId: string | null; readonly id: string } | null {
  const id = new URLSearchParams(location.hash.replace(/^#/, '')).get('evidence')?.trim()
  if (!id) return null
  const artifactId = /^\/files\/([^/]+)\/?$/.exec(location.pathname)?.[1]
  return { artifactId: artifactId ? decodeURIComponent(artifactId) : null, id }
}
