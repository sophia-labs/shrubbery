/**
 * Viewer mode: a hosted graph shared with this account as a Viewer.
 *
 * The gateway and gardend decide every write: gardend refuses write tools by role, and a Viewer's room socket
 * that would change a document is closed (4403) without changing it. This module only keeps the shell from
 * offering what they would refuse, the way visitor mode does for a public Sophia: every document opens
 * read-only with no Make Editable, the tree's write actions and drops are refused with a notice, boards open in
 * view mode, files stay unwritable, and a "View only" chip sits in the top bar.
 *
 * The Viewer's room sockets need a cell engine that knows Viewer rooms (`viewer-rooms-v1` in its `/health`
 * capabilities). Without it the gateway refuses the socket with `403 {"error":"viewer_rooms_unsupported"}`. A
 * browser never sees the status of a refused WebSocket, so the shell reads the same `/health` the gateway reads
 * and, when the capability is missing, says so in words instead of spinning.
 */

import { t } from '@shrubbery/nucleus'
import type { SidebarActionDetail } from '@shrubbery/runtime'

/** The capability a cell's `GET /health` carries when its rooms admit Viewers. */
export const VIEWER_ROOMS_CAPABILITY = 'viewer-rooms-v1'

/** The gateway's refusal code when a Viewer's socket reaches a cell without Viewer rooms. */
export const VIEWER_ROOMS_UNSUPPORTED = 'viewer_rooms_unsupported'

export type ViewerRoomsSupport = 'supported' | 'unsupported' | 'unknown'

/** What the editor may do with any document of a Viewer's graph: read it, never take it over. */
export function viewerDocumentAccess(): { readonly readOnly: true; readonly makeEditable: false; readonly readOnlyLabel: string } {
  return { readOnly: true, makeEditable: false, readOnlyLabel: t('sharing.viewOnly') }
}

/** Why the tree will not do this for a Viewer, or `null` when it may (refreshing only changes nothing). */
export function viewerSidebarRefusal(detail: Pick<SidebarActionDetail, 'action'>): string | null {
  return detail.action === 'refresh' ? null : t('sharing.viewerRefusal')
}

/** A Viewer moves nothing. */
export function viewerDropRefusal(): string {
  return t('sharing.viewerRefusal')
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * A cell's `/health` answer: `supported` when it names {@link VIEWER_ROOMS_CAPABILITY}, `unsupported` when it is
 * an `ok` answer without it (an older engine), `unknown` for anything else (we say nothing we do not know).
 */
export function viewerRoomsSupportFromHealth(health: unknown): ViewerRoomsSupport {
  const row = record(health)
  if (!row) return 'unknown'
  const capabilities = row.capabilities
  if (Array.isArray(capabilities) && capabilities.includes(VIEWER_ROOMS_CAPABILITY)) return 'supported'
  return row.status === 'ok' ? 'unsupported' : 'unknown'
}

/** Read the cell's `/health` through the gateway; a failed read is `unknown`, never a verdict. */
export async function probeViewerRooms(readHealth: () => Promise<unknown>): Promise<ViewerRoomsSupport> {
  try {
    return viewerRoomsSupportFromHealth(await readHealth())
  } catch {
    return 'unknown'
  }
}

/** True for the gateway's `403 {"error":"viewer_rooms_unsupported"}`, wherever an HTTP path surfaces it. */
export function isViewerRoomsUnsupported(error: unknown): boolean {
  const row = record(error)
  const status = typeof row?.status === 'number' ? row.status : null
  const body = typeof row?.responseBody === 'string' ? row.responseBody : ''
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (status !== null && status !== 403) return false
  return body.includes(VIEWER_ROOMS_UNSUPPORTED) || message.includes(VIEWER_ROOMS_UNSUPPORTED)
}

/** The words for that refusal, or `null` when `error` is something else. */
export function viewerRoomsMessage(error: unknown): string | null {
  return isViewerRoomsUnsupported(error) ? t('sharing.viewerRoomsUnsupported') : null
}
