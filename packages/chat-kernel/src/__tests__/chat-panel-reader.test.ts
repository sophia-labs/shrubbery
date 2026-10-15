/**
 * <sh-chat-panel> — the three additive props the imported reader stands on
 * (REAL-DOM test, NO MOCKS).
 *
 *   messageActions   which message-level buttons exist (default: all, as always)
 *   headerActions    which header buttons exist (default: all, as always)
 *   transcriptOnly   a finished conversation shown alone: no chrome, no composer,
 *                    no per-message clock, no inert surface buttons, no
 *                    auto-scroll to the end, and "output not retained" on a tool
 *                    card that kept no output
 *
 * A half-wired button is a bug, so the host names the buttons it can honour and
 * the panel draws only those. Every default is what the panel drew before.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { ShChatPanel } from '../chat-panel.js'
import type { ChatMessage, ToolCall } from '../types.js'

void ShChatPanel

function mount(): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  document.body.appendChild(el)
  return el
}

function assistant(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'hello',
    parts: [{ type: 'text', content: 'hello' }],
    isStreaming: false,
    toolCalls: [],
    createdAt: Date.UTC(2026, 2, 3, 14, 5),
    ...partial,
  }
}

function user(partial: Partial<ChatMessage> = {}): ChatMessage {
  return assistant({ id: 'u1', role: 'user', content: 'question', parts: [{ type: 'text', content: 'question' }], ...partial })
}

function withTool(tool: ToolCall): ChatMessage {
  return assistant({ id: 'with-tool', content: '', parts: [{ type: 'tool', toolCallId: tool.id }], toolCalls: [tool] })
}

const labels = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map(node => node.getAttribute('aria-label'))

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('<sh-chat-panel> messageActions is an allowlist that defaults to everything', () => {
  it('offers read aloud, copy and regenerate on an assistant message when the host says nothing', async () => {
    const el = mount()
    el.messages = [assistant()]
    await el.updateComplete
    expect(labels(el, '.message-action-btn')).toEqual(['Read aloud', 'Copy message', 'Regenerate'])
  })

  it('offers only the actions the host lists', async () => {
    const el = mount()
    el.messageActions = ['copy']
    el.messages = [assistant()]
    await el.updateComplete
    expect(labels(el, '.message-action-btn')).toEqual(['Copy message'])
  })

  it('draws no action strip when nothing is allowed', async () => {
    const el = mount()
    el.messageActions = []
    el.messages = [assistant()]
    await el.updateComplete
    expect(el.querySelector('.message-actions')).toBeNull()
  })

  it('narrows the right-click menu the same way, without stray dividers', async () => {
    const el = mount()
    el.onMessageAction = () => undefined
    el.messageActions = ['copy']
    el.messages = [assistant()]
    await el.updateComplete
    el.querySelector('.message.assistant')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await el.updateComplete
    const menu = el.querySelector('.chat-message-menu') as HTMLElement
    expect(Array.from(menu.querySelectorAll('.chat-menu-item')).map(item => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '⧉ Copy message',
      '▤ Copy as Markdown',
    ])
    expect(menu.querySelector('.chat-menu-divider')).toBeNull()
  })

  it('keeps Save to Garden in the menu only when it is allowed', async () => {
    const el = mount()
    el.onMessageAction = () => undefined
    el.messageActions = ['copy', 'save-garden']
    el.messages = [assistant()]
    await el.updateComplete
    el.querySelector('.message.assistant')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await el.updateComplete
    const items = Array.from(el.querySelectorAll('.chat-menu-item')).map(item => item.textContent?.replace(/\s+/g, ' ').trim())
    expect(items).toEqual(['⧉ Copy message', '▤ Copy as Markdown', '✦ Save to Garden'])
  })
})

describe('<sh-chat-panel> "Branch from here" is drawn only where the host names it', () => {
  it('draws nothing under the person’s message when the host says nothing, or lists only the old actions (the hosted chat)', async () => {
    const el = mount()
    el.onMessageAction = () => undefined
    el.messages = [user(), assistant()]
    await el.updateComplete
    expect(el.querySelector('.message.user .message-actions')).toBeNull()
    el.messageActions = ['copy']
    await el.updateComplete
    expect(el.querySelector('.message.user .message-actions')).toBeNull()
    expect(labels(el, '.message-action-btn')).toEqual(['Copy message'])
  })

  it('offers it under the person’s messages when named, and says which message', async () => {
    const el = mount()
    const asked: [string, string][] = []
    el.onMessageAction = (id, action) => {
      asked.push([id, action])
    }
    el.messageActions = ['copy', 'branch']
    el.messages = [user(), assistant(), user({ id: 'u2', content: 'second', parts: [{ type: 'text', content: 'second' }] })]
    await el.updateComplete
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.message.user [data-message-branch]'))
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['Branch from here', 'Branch from here'])
    expect(labels(el, '.message.assistant .message-action-btn')).toEqual(['Copy message'])
    buttons[1]!.click()
    await el.updateComplete
    expect(asked).toEqual([['u2', 'branch']])
  })

  it('is not offered while a reply streams, nor in a transcript shown alone', async () => {
    const el = mount()
    el.onMessageAction = () => undefined
    el.messageActions = ['branch']
    el.messages = [user()]
    el.streaming = true
    await el.updateComplete
    expect(el.querySelector('[data-message-branch]')).toBeNull()
    el.streaming = false
    await el.updateComplete
    expect(el.querySelector('[data-message-branch]')).not.toBeNull()
    el.transcriptOnly = true
    await el.updateComplete
    expect(el.querySelector('[data-message-branch]')).toBeNull()
  })
})

describe('<sh-chat-panel> headerActions is an allowlist that defaults to everything', () => {
  it('draws every header button when the host says nothing', async () => {
    const el = mount()
    el.onHeaderAction = () => undefined
    el.messages = [assistant()]
    await el.updateComplete
    expect(labels(el, '.header-actions-wide .icon-button')).toEqual([
      'Save chat to Garden', 'Refresh messages', 'Expand conversation',
    ])
  })

  it('leaves out Save chat to Garden, in both the row and the menu, when the host cannot honour it', async () => {
    const el = mount()
    el.onHeaderAction = () => undefined
    el.headerActions = ['refresh', 'stop', 'popout', 'restore']
    el.messages = [assistant()]
    await el.updateComplete
    expect(labels(el, '.header-actions-wide .icon-button')).toEqual(['Refresh messages', 'Expand conversation'])
    ;(el.querySelector('.compact-actions-trigger') as HTMLButtonElement).click()
    await el.updateComplete
    expect(labels(el, '.header-actions-menu button')).toEqual(['Refresh messages', 'Expand conversation'])
  })

  it('draws no header cluster when nothing is allowed', async () => {
    const el = mount()
    el.onHeaderAction = () => undefined
    el.headerActions = []
    await el.updateComplete
    expect(el.querySelector('.header-right')).toBeNull()
  })
})

describe('<sh-chat-panel> transcriptOnly shows a finished conversation alone', () => {
  it('draws the transcript and nothing else: no chrome, no composer, no banner, no scroll button', async () => {
    const el = mount()
    el.transcriptOnly = true
    el.readOnly = true
    el.messages = [user(), assistant()]
    await el.updateComplete
    expect(el.querySelector('.messages-container')).not.toBeNull()
    expect(el.querySelectorAll('.message')).toHaveLength(2)
    for (const selector of ['.super-bar', '.header', '.composer', 'hoja-editor', '.connection-banner', '.scroll-to-bottom', '.slot-indicator']) {
      expect(el.querySelector(selector), selector).toBeNull()
    }
  })

  it('leaves the per-message clock to the host\'s own annotation', async () => {
    const el = mount()
    el.transcriptOnly = true
    el.formatModelAnnotation = message => (message.role === 'assistant' ? 'Mar 3, 2026, 2:05 PM · voice: Kimi K2.5 · source-recorded' : null)
    el.messages = [user(), assistant()]
    await el.updateComplete
    expect(el.querySelector('.message-time')).toBeNull()
    const notes = Array.from(el.querySelectorAll('.message-annotation')).map(node => node.textContent)
    expect(notes).toEqual(['Mar 3, 2026, 2:05 PM · voice: Kimi K2.5 · source-recorded'])
  })

  it('keeps the clock in an ordinary panel', async () => {
    const el = mount()
    el.messages = [assistant()]
    await el.updateComplete
    expect(el.querySelector('.message-time')).not.toBeNull()
  })

  it('reads from the top: appending messages never scrolls it to the end', async () => {
    const el = mount()
    el.transcriptOnly = true
    await el.updateComplete
    const area = el.querySelector('.messages-container') as HTMLElement
    Object.defineProperty(area, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(area, 'clientHeight', { configurable: true, value: 400 })
    area.scrollTop = 0
    el.messages = [assistant({ id: 'first' })]
    await el.updateComplete
    el.messages = [assistant({ id: 'first' }), assistant({ id: 'second' })]
    await el.updateComplete
    expect(area.scrollTop).toBe(0)
    expect(el.querySelector('.scroll-to-bottom')).toBeNull()
  })

  it('says so, plainly, when there is nothing to show', async () => {
    const el = mount()
    el.transcriptOnly = true
    await el.updateComplete
    expect(el.querySelector('.messages-container')?.textContent).toContain('This conversation has no messages to show.')
    expect(el.querySelector('.empty-suggestions')).toBeNull()
  })

  it('keeps copy but hides the buttons that would do nothing', async () => {
    const el = mount()
    el.transcriptOnly = true
    el.messageActions = ['copy']
    el.messages = [assistant()]
    await el.updateComplete
    expect(labels(el, '.message-action-btn')).toEqual(['Copy message'])
  })

  it('draws a surface result as an ordinary tool card, with no button that opens a document it cannot reach', async () => {
    const surface: ToolCall = {
      id: 's1', tool: 'surface', status: 'completed',
      output: JSON.stringify({ type: 'surface', actions: [{ document_id: 'd1', title: 'Doc', action: 'Open' }] }),
    }
    const garden: ToolCall = {
      id: 'g1', tool: 'mnemosyne_read_document', status: 'completed',
      output: JSON.stringify({ graphId: 'sophia-cluster', documentId: 'doc-1', title: 'Notes' }),
    }
    const ordinary = mount()
    ordinary.messages = [withTool(surface), assistant({ id: 'g', content: '', parts: [{ type: 'tool', toolCallId: 'g1' }], toolCalls: [garden] })]
    await ordinary.updateComplete
    expect(ordinary.querySelector('.surface-card')).not.toBeNull()
    // A tool chip never opens a document by itself (links come from `surface` and the Changed strip).
    expect(ordinary.querySelector('.tool-document-link')).toBeNull()

    const reader = mount()
    reader.transcriptOnly = true
    reader.messages = [withTool(surface), assistant({ id: 'g', content: '', parts: [{ type: 'tool', toolCallId: 'g1' }], toolCalls: [garden] })]
    await reader.updateComplete
    expect(reader.querySelector('.surface-card')).toBeNull()
    expect(reader.querySelector('.surface-action')).toBeNull()
    expect(reader.querySelector('.tool-document-link')).toBeNull()
    expect(reader.querySelectorAll('.tool-call')).toHaveLength(2)
  })

  it('says "Output not retained." on an expanded tool card that kept no output, and only there', async () => {
    const silent: ToolCall = { id: 't1', tool: 'bash', status: 'completed', input: { command: 'ls' }, output: null }
    const loud: ToolCall = { id: 't2', tool: 'bash', status: 'completed', input: { command: 'ls' }, output: 'a\nb' }

    const reader = mount()
    reader.transcriptOnly = true
    reader.messages = [withTool(silent)]
    await reader.updateComplete
    expect(reader.querySelector('.tool-output-missing')).toBeNull()
    ;(reader.querySelector('.tool-call-header') as HTMLElement).click()
    await reader.updateComplete
    expect(reader.querySelector('.tool-output-missing')?.textContent).toBe('Output not retained.')

    const kept = mount()
    kept.transcriptOnly = true
    kept.messages = [withTool(loud)]
    await kept.updateComplete
    ;(kept.querySelector('.tool-call-header') as HTMLElement).click()
    await kept.updateComplete
    expect(kept.querySelector('.tool-output-missing')).toBeNull()
    expect(kept.querySelector('.tool-output-text')?.textContent).toBe('a\nb')

    // A live chat's tool card that has not returned yet is not "not retained".
    const live = mount()
    live.messages = [withTool(silent)]
    await live.updateComplete
    ;(live.querySelector('.tool-call-header') as HTMLElement).click()
    await live.updateComplete
    expect(live.querySelector('.tool-output-missing')).toBeNull()
  })
})

describe('<sh-chat-panel> tool and reasoning headers work from the keyboard', () => {
  const press = (target: Element, key: string): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }

  it('opens a tool card on Enter and on Space, and leaves other keys alone', async () => {
    const el = mount()
    el.messages = [withTool({ id: 't1', tool: 'bash', status: 'completed', output: 'x' })]
    await el.updateComplete
    const header = el.querySelector('.tool-call-header') as HTMLElement
    press(header, 'a')
    await el.updateComplete
    expect(el.querySelector('.tool-call.expanded')).toBeNull()
    press(header, 'Enter')
    await el.updateComplete
    expect(el.querySelector('.tool-call.expanded')).not.toBeNull()
    press(header, ' ')
    await el.updateComplete
    expect(el.querySelector('.tool-call.expanded')).toBeNull()
  })

  it('opens a reasoning block on Enter', async () => {
    const el = mount()
    el.messages = [assistant({ parts: [{ type: 'reasoning', content: 'thinking it over' }], content: '' })]
    await el.updateComplete
    expect(el.querySelector('.reasoning-content')).toBeNull()
    press(el.querySelector('.reasoning-header')!, 'Enter')
    await el.updateComplete
    expect(el.querySelector('.reasoning-content')?.textContent).toContain('thinking it over')
  })
})

describe('<sh-chat-panel> the pieces the imported reader leans on', () => {
  it('draws Stop generating only while a reply is streaming, and only when the host allows it', async () => {
    const el = mount()
    el.onHeaderAction = () => undefined
    el.streaming = true
    el.messages = [assistant()]
    await el.updateComplete
    expect(labels(el, '.header-actions-wide .icon-button')).toEqual([
      'Save chat to Garden', 'Refresh messages', 'Stop generating', 'Expand conversation',
    ])

    el.headerActions = ['refresh', 'popout']
    await el.updateComplete
    expect(labels(el, '.header-actions-wide .icon-button')).toEqual(['Refresh messages', 'Expand conversation'])

    el.streaming = false
    el.headerActions = ['stop']
    await el.updateComplete
    // Nothing left to draw: no empty cluster, no menu trigger that opens onto nothing.
    expect(el.querySelector('.header-right')).toBeNull()
    expect(el.querySelector('.compact-actions-trigger')).toBeNull()
  })

  it('tells assistive technology whether a tool card or a reasoning block is open', async () => {
    const press = (target: Element): void => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    }
    const el = mount()
    el.messages = [
      assistant({
        content: '',
        parts: [{ type: 'tool', toolCallId: 't1' }, { type: 'reasoning', content: 'because' }],
        toolCalls: [{ id: 't1', tool: 'bash', status: 'completed', input: null, output: 'x' }],
      }),
    ]
    await el.updateComplete
    const tool = el.querySelector('.tool-call-header') as HTMLElement
    const reasoning = el.querySelector('.reasoning-header') as HTMLElement
    expect(tool.getAttribute('aria-expanded')).toBe('false')
    expect(reasoning.getAttribute('aria-expanded')).toBe('false')
    press(tool)
    press(reasoning)
    await el.updateComplete
    expect((el.querySelector('.tool-call-header') as HTMLElement).getAttribute('aria-expanded')).toBe('true')
    expect((el.querySelector('.reasoning-header') as HTMLElement).getAttribute('aria-expanded')).toBe('true')
  })

  it('names the person "You" and the other side with the host\'s own word, never with "Sophia" unless told to', async () => {
    const el = mount()
    el.transcriptOnly = true
    el.assistantLabel = 'Assistant'
    el.messages = [user(), assistant()]
    await el.updateComplete
    expect(Array.from(el.querySelectorAll('.message-author')).map(node => node.textContent)).toEqual(['You', 'Assistant'])
    expect(el.querySelector('.message.assistant')?.getAttribute('aria-label')).toBe('Assistant message')
    expect(el.textContent).not.toContain('Sophia')
  })

  it('says "Output not retained." on a failed tool card with no output, but not on one that never finished', async () => {
    const failed: ToolCall = { id: 'f1', tool: 'bash', status: 'error', input: { command: 'rm' }, output: null }
    const unfinished: ToolCall = { id: 'u1', tool: 'bash', status: 'pending', input: { command: 'ls' }, output: null }

    const errored = mount()
    errored.transcriptOnly = true
    errored.messages = [withTool(failed)]
    await errored.updateComplete
    ;(errored.querySelector('.tool-call-header') as HTMLElement).click()
    await errored.updateComplete
    expect(errored.querySelector('.tool-output-missing')?.textContent).toBe('Output not retained.')

    const pending = mount()
    pending.transcriptOnly = true
    pending.messages = [withTool(unfinished)]
    await pending.updateComplete
    ;(pending.querySelector('.tool-call-header') as HTMLElement).click()
    await pending.updateComplete
    expect(pending.querySelector('.tool-output-missing')).toBeNull()
  })
})

describe('<sh-chat-panel> the superbar never shows the label the app once minted for a first chat', () => {
  it('shows "organism-chat" as an untitled chat, leaves a real name alone, and keeps blank as a new chat', async () => {
    const el = mount()
    el.sessionTitle = 'organism-chat'
    await el.updateComplete
    expect(el.querySelector('.super-bar-chat-title')?.textContent).toBe('Untitled chat')
    el.sessionTitle = 'Deploy notes'
    await el.updateComplete
    expect(el.querySelector('.super-bar-chat-title')?.textContent).toBe('Deploy notes')
    el.sessionTitle = null
    await el.updateComplete
    expect(el.querySelector('.super-bar-chat-title')?.textContent).toBe('New chat')
  })
})
