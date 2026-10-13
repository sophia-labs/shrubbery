/**
 * The organism shell's half of the empowered workspace chat (design §10; the Choreograph contract in
 * `private-notes/2026-10-05-empowered-chat/RETURN.md` §4). Pure functions and one port; main.ts wires them.
 *
 *  - `chatContextRefs`: what the person has open, as the chat's per-turn `contextRefs` (the active
 *    document first, which the model reads as "this document"; then its focused block as `doc#block`;
 *    then the other open documents; or an open artifact).
 *  - `workspaceRoleOf`: the person's role on the bound graph, from the gateway's graph list.
 *  - `snapshotBefore`: the History version to stand at when a change link says "before this turn".
 *  - `makeChatArtifactPreviewPort`: the chat's live HTML preview over the shell's own artifact read and
 *    workspace-room watch (the same `ArtifactLivePreview` the center pane uses).
 */
import type { ChatArtifactPreviewPort, ChatArtifactPreviewView, ChatWorkspaceRole } from '@shrubbery/runtime'
import { ArtifactLivePreview, type ArtifactPreviewState, type ArtifactTextSnapshot } from './artifact-live-preview.js'

/** An id the chat may name: letters, digits, `-`, `_` (the cell's own id grammar). */
const ID = /^[A-Za-z0-9_-]{1,128}$/

export interface OpenInShell {
  /** The document in the active pane. */
  readonly activeDocumentId: string | null
  /** The block the editor's cursor is in, in that document. */
  readonly activeBlockId?: string | null
  /** Every document open in a pane (the active one included, in any order). */
  readonly openDocumentIds?: readonly string[]
  /** The artifact open in the center, when one is. */
  readonly artifactId?: string | null
}

/** What the person has open, as references a turn may carry ("this document" is the first). */
export function chatContextRefs(open: OpenInShell): string[] {
  const refs: string[] = []
  const add = (ref: string): void => {
    if (!refs.includes(ref)) refs.push(ref)
  }
  const active = open.activeDocumentId && ID.test(open.activeDocumentId) ? open.activeDocumentId : null
  if (active) {
    add(active)
    if (open.activeBlockId && ID.test(open.activeBlockId)) add(`${active}#${open.activeBlockId}`)
  } else if (open.artifactId && ID.test(open.artifactId)) {
    add(open.artifactId)
  }
  for (const id of open.openDocumentIds ?? []) if (ID.test(id)) add(id)
  return refs
}

/** The person's role on a graph, as the gateway's graph list reports it; null when it does not say. */
export function workspaceRoleOf(
  graphs: readonly { readonly graphId: string; readonly role?: string | null }[],
  graphId: string | null | undefined,
): ChatWorkspaceRole | null {
  const role = graphs.find(graph => graph.graphId === graphId)?.role
  return role === 'owner' || role === 'editor' || role === 'viewer' ? role : null
}

function timeOf(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return Date.parse(value)
}

/** The newest History version taken before `before` (ms), or null. */
export function snapshotBefore(
  snapshots: readonly { readonly id: string; readonly createdAt: string | number | Date }[],
  before: number | null | undefined,
): string | null {
  if (typeof before !== 'number' || !Number.isFinite(before)) return null
  let best: { id: string; at: number } | null = null
  for (const snapshot of snapshots) {
    const at = timeOf(snapshot.createdAt)
    if (!Number.isFinite(at) || at >= before) continue
    if (!best || at > best.at) best = { id: snapshot.id, at }
  }
  return best?.id ?? null
}

export interface ChatArtifactPreviewSource {
  /** The graph the chat is bound to (the artifact's). */
  readonly graphId: () => string
  /** Read the artifact's committed HTML (`fetchArtifactText`). */
  readonly read: (artifactId: string, signal: AbortSignal) => Promise<ArtifactTextSnapshot>
  /** Watch the workspace room for the artifact's content changing (`watchArtifactWorkspace`). */
  readonly watch: (artifactId: string, invalidate: () => void, unavailable: (message: string | null) => void) => () => void
  /** The media type the shell already knows for an artifact (its sidebar node), if any. */
  readonly knownMimeType?: (artifactId: string) => string | null | undefined
  /** Hand the artifact's bytes to the person. */
  readonly download?: (artifactId: string) => void
}

function isHtml(mimeType: string | null | undefined): boolean {
  return (mimeType ?? '').split(';', 1)[0]!.trim().toLowerCase() === 'text/html'
}

function viewOf(graphId: string, state: ArtifactPreviewState): ChatArtifactPreviewView {
  const snapshot = state.snapshot
  return {
    status: state.status,
    graphId: snapshot?.graphId ?? graphId,
    title: snapshot?.filename ?? null,
    mimeType: snapshot?.mimeType ?? null,
    html: snapshot ? snapshot.text : null,
    identity: snapshot ? `${snapshot.graphIncarnation}:${snapshot.contentHashSha256}` : null,
    ...(state.error ? { error: state.error } : {}),
  }
}

/**
 * The chat's live HTML preview: each open preview is its own `ArtifactLivePreview` (serial, coalesced
 * reads; fenced against a replaced workspace), invalidated by the shared workspace room. An artifact the
 * shell already knows is not HTML is said to be so without a read, and the chat hides it.
 */
export function makeChatArtifactPreviewPort(source: ChatArtifactPreviewSource): ChatArtifactPreviewPort {
  return {
    open(artifactId, onChange) {
      const graphId = source.graphId()
      const known = source.knownMimeType?.(artifactId)
      if (known && !isHtml(known)) {
        onChange({ status: 'ready', graphId, title: null, mimeType: known, html: null, identity: null })
        return { refresh: () => undefined, close: () => undefined }
      }
      let closed = false
      const preview = new ArtifactLivePreview({
        read: signal => source.read(artifactId, signal),
        watch: (invalidate, unavailable) => source.watch(artifactId, invalidate, unavailable),
        onChange: state => {
          if (!closed) onChange(viewOf(graphId, state))
        },
      })
      onChange(viewOf(graphId, preview.snapshot()))
      preview.start()
      return {
        refresh: () => preview.refresh(),
        close: () => {
          closed = true
          preview.dispose()
        },
      }
    },
    ...(source.download ? { download: (artifactId: string) => source.download!(artifactId) } : {}),
  }
}
