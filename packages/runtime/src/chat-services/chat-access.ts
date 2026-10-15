/**
 * What the chat panel says the chat may do in this workspace, worded from what the service knows
 * (`ChatService.access`). Pure: the kernel renders the note and gates nothing on it; the cell checks
 * every write against the person's live role whatever the note says.
 *
 * Vera, 2026-10-05: owners and editors get the writing chat; viewers get read-only chat, and the panel
 * says so. An older backend's chat only reads, and a conversation begun before the writing chat keeps
 * the powers it began with: each is said plainly, never more than the chat can do.
 */
import type { ChatAccessNote } from '@shrubbery/chat-kernel'
import type { ChatAccess } from './chat-service.js'

export function accessNoteFor(access: ChatAccess | null | undefined): ChatAccessNote | null {
  if (!access) return null
  if (access.basis === 'unavailable') {
    return { mode: 'read', label: access.reason?.trim() || 'Chat is not available on this Sophia.' }
  }
  if (access.mode === 'write') {
    return {
      mode: 'write',
      label: 'Sophia can read and change this workspace, as you.',
      detail: 'Edits are kept in each document’s History. Deleting a whole document deletes its history too.',
    }
  }
  if (access.basis === 'role' && access.role === 'viewer') {
    return { mode: 'read', label: 'Read-only: you can view this workspace, so Sophia can read it but not change it.' }
  }
  if (access.basis === 'conversation') {
    return {
      mode: 'read',
      label: 'This conversation can read this workspace but not change it.',
      detail: 'It began before Sophia could make changes. Start a new chat to let Sophia change things.',
    }
  }
  return { mode: 'read', label: 'Sophia can read and search this workspace, but not change it.' }
}
