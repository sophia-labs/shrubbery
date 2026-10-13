/**
 * <sh-chat-panel>: what the chat may do here, and what a turn changed (REAL DOM, NO MOCKS).
 *
 * The empowered workspace chat (design §10):
 *  1. the panel says, in the host's words, whether Sophia can change this workspace or only read it;
 *  2. under a reply that wrote, a "Changed in this turn" strip names each thing changed;
 *  3. each changed document links to its History (an artifact to its revisions); there is no undo button;
 *  4. a whole-document delete is shown apart, as gone with its history (Vera, 2026-10-05), and so is a wire;
 *  5. a written HTML artifact is previewed live under the reply that last changed it, by the host;
 *  6. a tool chip never opens a document by itself (the old "Open in sophia-cluster" guess is gone).
 */
import { html } from 'lit'
import { describe, expect, it } from 'vitest'
import { type ChatArtifactPreviewRequest, type ChatChangeIntent, ShChatPanel } from '../chat-panel.js'
import type { ChatMessage, ToolCall } from '../types.js'

void ShChatPanel

function mount(): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  document.body.appendChild(el)
  return el
}

let seq = 0
function tool(name: string, input: Record<string, unknown>, extra: Partial<ToolCall> = {}): ToolCall {
  seq += 1
  return { id: `${name}#${seq}`, tool: name, status: 'completed', input, output: '', metadata: null, ...extra }
}

function user(id: string, createdAt: number): ChatMessage {
  return { id, role: 'user', content: 'do it', parts: [{ type: 'text', content: 'do it' }], isStreaming: false, toolCalls: [], createdAt }
}

function reply(id: string, toolCalls: ToolCall[], createdAt = 2_000): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: 'Done.',
    parts: [...toolCalls.map(call => ({ type: 'tool' as const, toolCallId: call.id })), { type: 'text', content: 'Done.' }],
    isStreaming: false,
    toolCalls,
    createdAt,
  }
}

function rows(el: ShChatPanel, messageId?: string): HTMLElement[] {
  const scope = messageId ? el.querySelector(`[data-message-id="${messageId}"]`)! : el
  return Array.from(scope.querySelectorAll<HTMLElement>('.turn-change'))
}

describe('what the chat may do here', () => {
  it('says it in the host\'s words, and says nothing when the host has not said', async () => {
    const el = mount()
    await el.updateComplete
    expect(el.querySelector('.chat-access')).toBeNull()

    el.accessNote = { mode: 'write', label: 'Sophia can read and change this workspace, as you.', detail: 'Every change is kept in History.' }
    await el.updateComplete
    const line = el.querySelector<HTMLElement>('.chat-access')!
    expect(line.dataset.access).toBe('write')
    expect(line.textContent).toContain('Sophia can read and change this workspace, as you.')
    expect(line.textContent).toContain('Every change is kept in History.')

    el.accessNote = { mode: 'read', label: 'Read-only: you can view this workspace, so Sophia can read it but not change it.' }
    await el.updateComplete
    expect(el.querySelector<HTMLElement>('.chat-access')!.dataset.access).toBe('read')
    expect(el.querySelector('.chat-access')!.getAttribute('role')).toBe('note')
  })
})

describe('Changed in this turn', () => {
  it('is absent under a reply that only read', async () => {
    const el = mount()
    el.messages = [user('u1', 1_000), reply('a1', [tool('search_documents', { query: 'x' }), tool('read_document', { documentId: 'd' })])]
    await el.updateComplete
    expect(el.querySelector('.turn-changes')).toBeNull()
  })

  it('names each change, links documents to History and artifacts to revisions, and offers no undo', async () => {
    const el = mount()
    const intents: ChatChangeIntent[] = []
    el.onChangeAction = intent => { intents.push(intent) }
    el.messages = [
      user('u1', 1_000),
      reply('a1', [
        tool('write_document', { documentId: 'plan', title: 'The plan', content: 'x' }),
        tool('edit_block_text', { documentId: 'plan', blockId: 'b7', operations: [] }),
        tool('create_artifact_text', { artifact_id: 'board', filename: 'board.html', mime_type: 'text/html', text: '<p/>' }),
      ]),
    ]
    await el.updateComplete

    const strip = el.querySelector<HTMLElement>('.turn-changes')!
    expect(strip.querySelector('.turn-changes-title')!.textContent).toContain('Changed in this turn')
    expect(el.querySelector('.turn-change-undo, [data-action="undo"]')).toBeNull()
    expect(el.textContent).not.toMatch(/\bUndo\b/)

    const [plan, board] = rows(el)
    expect(plan.dataset.changeSubject).toBe('document')
    expect(plan.textContent).toContain('The plan')
    expect(plan.textContent).toContain('edited')

    plan.querySelector<HTMLButtonElement>('.turn-change-open')!.click()
    plan.querySelector<HTMLButtonElement>('.turn-change-history')!.click()
    expect(board.dataset.changeSubject).toBe('artifact')
    board.querySelector<HTMLButtonElement>('.turn-change-open')!.click()
    board.querySelector<HTMLButtonElement>('.turn-change-history')!.click()
    expect(board.querySelector('.turn-change-history')!.textContent).toContain('Revisions')

    expect(intents).toEqual([
      { type: 'open-document', documentId: 'plan', blockId: 'b7' },
      { type: 'open-history', documentId: 'plan', before: 1_000 },
      { type: 'open-artifact', artifactId: 'board' },
      { type: 'open-artifact', artifactId: 'board', revisions: true },
    ])
  })

  it('shows a whole-document delete apart: gone, with its history, and nothing to open', async () => {
    const el = mount()
    el.onChangeAction = () => undefined
    el.messages = [
      user('u1', 1_000),
      reply('a1', [
        tool('delete_blocks', { documentId: 'kept', blockIds: ['b1'] }),
        tool('delete_document', { documentId: 'gone' }),
        tool('delete', { type: 'wires', wireIds: ['w1'] }),
      ]),
    ]
    await el.updateComplete
    const [kept, gone, wire] = rows(el)

    expect(kept.dataset.removal).toBe('text')
    expect(kept.querySelector('.turn-change-history')).not.toBeNull()
    expect(kept.textContent).toContain('History')

    expect(gone.dataset.removal).toBe('document')
    expect(gone.classList.contains('removed')).toBe(true)
    expect(gone.querySelector('.turn-change-open')).toBeNull()
    expect(gone.querySelector('.turn-change-history')).toBeNull()
    expect(gone.textContent).toContain('deleted')
    expect(gone.textContent).toContain('Deleted with its history: it cannot be brought back from History.')

    // A wire is deleted as a person deletes it: an ordinary row, listed by its id, nothing to open.
    expect(wire.dataset.removal).toBe('wire')
    expect(wire.classList.contains('removed')).toBe(false)
    expect(wire.textContent).toContain('w1')
    expect(wire.textContent).toContain('deleted')
    expect(wire.querySelector('.turn-change-note')).toBeNull()
    expect(wire.querySelector('button')).toBeNull()
  })

  it('names what the backend did not, plainly, and counts refused writes apart', async () => {
    const el = mount()
    el.messages = [
      user('u1', 1_000),
      reply('a1', [
        tool('write_document', {}),
        tool('insert_blocks', { documentId: 'locked' }, { status: 'error', output: 'refused: viewer' }),
      ]),
    ]
    await el.updateComplete
    const [unnamed] = rows(el)
    expect(unnamed.textContent).toContain('a document')
    expect(unnamed.querySelector('button')).toBeNull()
    expect(el.querySelector('.turn-changes-refused')!.textContent).toContain('1 change was refused')
  })

  it('asks the host for a title it does not have, and uses it', async () => {
    const el = mount()
    el.changeTitle = (subject, id) => (subject === 'document' && id === 'plan' ? 'Q4 plan' : null)
    el.messages = [user('u1', 1_000), reply('a1', [tool('insert_blocks', { documentId: 'plan' })])]
    await el.updateComplete
    expect(rows(el)[0].textContent).toContain('Q4 plan')
  })

  it('is not drawn for a finished conversation shown alone', async () => {
    const el = mount()
    el.transcriptOnly = true
    el.messages = [user('u1', 1_000), reply('a1', [tool('write_document', { documentId: 'plan' })])]
    await el.updateComplete
    expect(el.querySelector('.turn-changes')).toBeNull()
  })
})

describe('a written HTML artifact, live in the chat', () => {
  it('is previewed by the host under the reply that last changed it, and only there', async () => {
    const el = mount()
    const asked: ChatArtifactPreviewRequest[] = []
    el.renderArtifactPreview = request => {
      asked.push(request)
      return html`<div class="host-preview" data-artifact=${request.artifactId}></div>`
    }
    el.messages = [
      user('u1', 1_000),
      reply('a1', [tool('create_artifact_text', { artifact_id: 'board', mime_type: 'text/html', filename: 'b.html', text: 'x' })]),
      user('u2', 3_000),
      reply('a2', [tool('write_artifact_text', { artifact_id: 'board', text: 'y' })], 4_000),
      user('u3', 5_000),
      reply('a3', [tool('create_artifact_text', { artifact_id: 'notes', mime_type: 'text/plain', filename: 'n.txt', text: 'z' })], 6_000),
    ]
    await el.updateComplete

    expect(el.querySelector('[data-message-id="a1"] .host-preview')).toBeNull()
    expect(el.querySelector('[data-message-id="a2"] .turn-artifact-preview .host-preview')).not.toBeNull()
    // A plain-text artifact is listed, not previewed.
    expect(el.querySelector('[data-message-id="a3"] .host-preview')).toBeNull()
    expect(asked.map(request => [request.artifactId, request.messageId, request.mediaType])).toEqual([
      ['board', 'a2', 'text/html'],
    ])
  })

  it('leaves the preview to a host that offers one: none, no frame', async () => {
    const el = mount()
    el.messages = [user('u1', 1_000), reply('a1', [tool('create_artifact_text', { artifact_id: 'board', mime_type: 'text/html', text: 'x' })])]
    await el.updateComplete
    expect(el.querySelector('.turn-artifact-preview')).toBeNull()
    expect(el.querySelector('iframe')).toBeNull()
  })

  it('asks the host about an artifact whose media type the turn did not say (the host reads it and can tell)', async () => {
    const el = mount()
    const asked: string[] = []
    el.renderArtifactPreview = request => { asked.push(`${request.artifactId}:${request.mediaType}`); return html`<i class="host-preview"></i>` }
    el.messages = [user('u1', 1_000), reply('a1', [tool('write_artifact_text', { artifact_id: 'unknown-type', text: 'x' })])]
    await el.updateComplete
    // The type was not said: the host is asked (it reads the artifact and knows), with no type.
    expect(asked).toEqual(['unknown-type:null'])
  })
})

describe('a tool chip', () => {
  it('never opens a document by itself, in any graph', async () => {
    const el = mount()
    el.onSurfaceAction = () => undefined
    el.messages = [
      user('u1', 1_000),
      reply('a1', [
        tool('write_document', { graphId: 'sophia-cluster' }, {
          output: JSON.stringify({ graphId: 'sophia-cluster', documentId: 'investigation-42', title: 'Cluster investigation' }),
        }),
      ]),
    ]
    await el.updateComplete
    expect(el.querySelector('.tool-document-link')).toBeNull()
    expect(el.textContent).not.toContain('Open in sophia-cluster')
  })
})
