/**
 * What the chat panel says the chat may do here, from what the service knows (pure, NO MOCKS).
 *
 * Vera, 2026-10-05: owners and editors get the writing chat; viewers get read-only chat, and the panel
 * says so. An older backend's chat only reads, and an older conversation keeps the powers it began with:
 * the panel says each of those plainly, never more than the chat can do.
 */
import { describe, expect, it } from 'vitest'
import { accessNoteFor } from '../chat-access.js'

describe('accessNoteFor', () => {
  it('says nothing while nothing is known', () => {
    expect(accessNoteFor(null)).toBeNull()
  })

  it('an owner or editor with the writing chat: Sophia can read and change this workspace, as them', () => {
    for (const role of ['owner', 'editor'] as const) {
      const note = accessNoteFor({ mode: 'write', basis: 'role', role })!
      expect(note.mode).toBe('write')
      expect(note.label).toBe('Sophia can read and change this workspace, as you.')
      expect(note.detail).toBe('Edits are kept in each document’s History. Deleting a whole document deletes its history too.')
    }
    expect(accessNoteFor({ mode: 'write', basis: 'conversation', role: 'editor' })!.mode).toBe('write')
  })

  it('a viewer: read-only, and the panel says so', () => {
    expect(accessNoteFor({ mode: 'read', basis: 'role', role: 'viewer' })).toEqual({
      mode: 'read',
      label: 'Read-only: you can view this workspace, so Sophia can read it but not change it.',
    })
  })

  it('a reader-only backend: Sophia reads and searches, and says it does not change', () => {
    expect(accessNoteFor({ mode: 'read', basis: 'backend', role: 'editor' })).toEqual({
      mode: 'read',
      label: 'Sophia can read and search this workspace, but not change it.',
    })
  })

  it('a chat that cannot run here: the host\'s reason, in its words', () => {
    const reason = 'Chat needs Node.js 22.19 or newer, and there is no node on gardend\'s PATH.'
    expect(accessNoteFor({ mode: 'read', basis: 'unavailable', role: 'owner', reason })).toEqual({ mode: 'read', label: reason })
    expect(accessNoteFor({ mode: 'read', basis: 'unavailable', role: null })).toEqual({
      mode: 'read',
      label: 'Chat is not available on this Sophia.',
    })
  })

  it('an older conversation: it reads only, and a new chat can change things', () => {
    expect(accessNoteFor({ mode: 'read', basis: 'conversation', role: 'owner' })).toEqual({
      mode: 'read',
      label: 'This conversation can read this workspace but not change it.',
      detail: 'It began before Sophia could make changes. Start a new chat to let Sophia change things.',
    })
  })
})
