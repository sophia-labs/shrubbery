/**
 * Visitor mode: a public Sophia (gardend public mode, `GET /self-host.json` `public`) opened without the
 * owner's key. Anyone reads the public workspaces; a person signed in with a Sophia account also writes, in the
 * one folder gardend opens to visitors (`visitorFolders`), their own documents and nobody else's.
 *
 * gardend decides every write (its fence: `visitor_fence.rs`). This module only keeps the shell from offering
 * what gardend would refuse: every document is view-only except the visitor's own inside the folder, a new
 * document lands in the folder with an id gardend gives it, and folders, uploads and other people's documents
 * are left alone. Who owns a document comes from gardend (`get_workspace` over the folder: a document row's
 * `createdBy`, written by gardend only): {@link ownedDocumentIds}.
 */

import type { SidebarActionDetail, SidebarNode, SidebarNodeDropDetail, SidebarSection } from '@shrubbery/runtime'

/** Where a signed-in account may write (gardend's `tools/list` `_meta["sophia.writeFence"]`). */
export interface VisitorFence {
  readonly graphId: string
  readonly folderId: string
  /** The account's public id (`acct-…`): what its documents carry as `createdBy`. */
  readonly account: string
  /** Its collaboration-presence name and colour, as gardend binds them. */
  readonly name: string
  readonly color: string
}

export interface VisitorState {
  readonly kind: 'anonymous' | 'account'
  /** `null` for an anonymous visitor, and for an account gardend gives no fence (an unverified email, a pause). */
  readonly fence: VisitorFence | null
  /** Where to send a person to sign in (the site's own page). */
  readonly signInUrl: string
}

/** The visitors' folders `/self-host.json` describes. */
export interface PublicVisitorFolder {
  readonly graphId: string
  readonly folderId: string
  readonly open: boolean
}

export function parseVisitorFences(meta: unknown): VisitorFence[] {
  if (!Array.isArray(meta)) return []
  const fences: VisitorFence[] = []
  for (const raw of meta) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const text = (key: string): string => (typeof entry[key] === 'string' ? (entry[key] as string).trim() : '')
    if (!text('graphId') || !text('folderId') || !text('account')) continue
    fences.push({
      graphId: text('graphId'),
      folderId: text('folderId'),
      account: text('account'),
      name: text('name') || 'Visitor',
      color: /^#[0-9a-f]{6}$/i.test(text('color')) ? text('color') : '#2563eb',
    })
  }
  return fences
}

type TokenStorage = Pick<Storage, 'getItem'>

/** The `exp` of a JWT, in milliseconds (no verification: gardend verifies it). */
function jwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * The ID token the site's sign-in left in this browser (`tokenStorageKey`: a JSON object with `id_token`, in
 * session or local storage), while it has more than a minute left.
 */
export function readAccountIdToken(
  storageKey: string | null | undefined,
  storages: readonly (TokenStorage | null)[],
  now: number = Date.now(),
): string | null {
  if (!storageKey) return null
  for (const storage of storages) {
    let raw: string | null = null
    try { raw = storage?.getItem(storageKey) ?? null } catch { raw = null }
    if (!raw) continue
    try {
      const tokens = JSON.parse(raw) as { id_token?: unknown }
      const token = typeof tokens.id_token === 'string' ? tokens.id_token.trim() : ''
      if (!token || token.split('.').length !== 3) continue
      const expires = jwtExpiryMs(token)
      if (expires !== null && expires - 60_000 <= now) continue
      return token
    } catch {
      continue
    }
  }
  return null
}

function findNode(nodes: readonly SidebarNode[], id: string): SidebarNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = node.children?.length ? findNode(node.children, id) : null
    if (child) return child
  }
  return null
}

export function sidebarNodeIn(sections: readonly SidebarSection[], id: string): SidebarNode | null {
  for (const section of sections) {
    const node = findNode(section.nodes ?? [], id)
    if (node) return node
  }
  return null
}

/** True when `parentId` is the fence's folder or a folder below it (by the tree the shell shows). */
export function parentInFence(
  sections: readonly SidebarSection[],
  parentId: string | null | undefined,
  fence: VisitorFence,
): boolean {
  let current = parentId ?? null
  for (let depth = 0; depth < 64 && current; depth += 1) {
    if (current === fence.folderId) return true
    current = sidebarNodeIn(sections, current)?.parentId ?? null
  }
  return false
}

/**
 * The documents gardend records as `account`'s, from a `get_workspace` answer (each document row carries
 * `extra.createdBy`).
 */
export function ownedDocumentIds(workspace: unknown, account: string): Set<string> {
  const owned = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const extra = record.extra as Record<string, unknown> | undefined
    const id = typeof record.id === 'string' ? record.id : typeof record.documentId === 'string' ? record.documentId : null
    const by = record.createdBy ?? (extra && typeof extra === 'object' ? extra.createdBy : undefined)
    if (id && by === account) owned.add(id)
    for (const child of Object.values(record)) if (child && typeof child === 'object') visit(child)
  }
  visit(workspace)
  return owned
}

/** The visitor's own document (`owned`, from gardend), inside its fence, in this workspace. */
export function visitorOwns(
  sections: readonly SidebarSection[],
  graphId: string,
  documentId: string,
  visitor: VisitorState | null,
  owned: ReadonlySet<string>,
): boolean {
  const fence = visitor?.fence
  if (!fence || fence.graphId !== graphId || !owned.has(documentId)) return false
  const node = sidebarNodeIn(sections, documentId)
  if (!node || node.kind !== 'document') return false
  return parentInFence(sections, node.parentId, fence)
}

/** What the editor may do with the open document, for a visitor. */
export function visitorDocumentAccess(
  sections: readonly SidebarSection[],
  graphId: string,
  documentId: string,
  visitor: VisitorState,
  folderLabel: string,
  owned: ReadonlySet<string>,
): { readonly readOnly: boolean; readonly makeEditable: false; readonly readOnlyLabel: string } {
  const own = visitorOwns(sections, graphId, documentId, visitor, owned)
  const label = visitor.fence
    ? visitor.fence.graphId === graphId
      ? `View only · you write your own notes in ${folderLabel}`
      : 'View only'
    : visitor.kind === 'account'
      ? 'View only'
      : `View only · sign in to write in ${folderLabel}`
  return { readOnly: !own, makeEditable: false, readOnlyLabel: label }
}

/**
 * Why the shell will not offer a sidebar action to this visitor, or `null` when it may (gardend still decides).
 * `new-document` is the shell's to redirect into the folder; it is never refused here for an account with a fence.
 */
export function visitorSidebarRefusal(
  detail: SidebarActionDetail,
  sections: readonly SidebarSection[],
  graphId: string,
  visitor: VisitorState,
  folderLabel: string,
  owned: ReadonlySet<string>,
): string | null {
  const own = (id: string | undefined): boolean => Boolean(id) && visitorOwns(sections, graphId, id!, visitor, owned)
  switch (detail.action) {
    case 'refresh':
      return null
    case 'new-document':
      if (visitor.fence && visitor.fence.graphId === graphId) return null
      return visitor.kind === 'anonymous'
        ? `Sign in with a Sophia account to write a note in ${folderLabel}.`
        : visitor.fence
          ? `Visitors write in ${folderLabel}, in the workspace ${visitor.fence.graphId}.`
          : 'Writing is not open to this account right now. Reading goes on.'
    case 'new-folder':
    case 'upload':
      return `Visitors write notes in ${folderLabel}; folders and files stay the owner's.`
    case 'node-menu':
    case 'rename':
    case 'move':
    case 'delete': {
      const ids = detail.nodeIds?.length ? detail.nodeIds : detail.nodeId ? [detail.nodeId] : []
      if (ids.length > 0 && ids.every(id => own(id))) return null
      return 'You can change only your own notes.'
    }
    default:
      return null
  }
}

/** A drag a visitor may make: its own document, onto a place inside its fence. */
export function visitorDropRefusal(
  detail: SidebarNodeDropDetail,
  sections: readonly SidebarSection[],
  graphId: string,
  visitor: VisitorState,
  targetParentId: string | null,
  owned: ReadonlySet<string>,
): string | null {
  if (!visitorOwns(sections, graphId, detail.sourceId, visitor, owned)) return 'You can move only your own notes.'
  if (!visitor.fence || !parentInFence(sections, targetParentId, visitor.fence)) {
    return 'Your notes stay in the visitors\' folder.'
  }
  return null
}
