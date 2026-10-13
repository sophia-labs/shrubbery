/**
 * A conversation that picked up an earlier one, inside the real <sh-chat-panel>
 * (NO MOCKS). The window is exactly what was sent, read-only, in the voice marks
 * the record names; the seam is dated and names the new voice. Each test names
 * the defect it guards: an assistant that sounds like Sophia when it was someone
 * else, a window that can be regenerated, a seam that hides where the text went.
 */
import type { HojaEditor } from '@shrubbery/hoja'
import { afterEach, describe, expect, it } from 'vitest'

import { ShChatPanel } from '../chat-panel.js'
import type { ChatMessage, ChatSeam, ChatSeamAction } from '../types.js'
import { unrecordedVoiceMark, voiceMarkFromId } from '../voice-roster.js'
import { voiceRoster } from './fixtures/voice-roster.js'

void ShChatPanel

function mount(): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  document.body.appendChild(el)
  return el
}

async function settle(el: ShChatPanel): Promise<void> {
  await el.updateComplete
  const hoja = el.querySelector<HojaEditor>('hoja-editor')
  if (hoja) {
    await hoja.updateComplete
    await Promise.resolve()
    await hoja.updateComplete
  }
  await el.updateComplete
}

function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'content'>): ChatMessage {
  return {
    parts: [{ type: 'text', content: partial.content }],
    isStreaming: false,
    toolCalls: [],
    createdAt: Date.UTC(2026, 7, 2, 15, 0),
    ...partial,
  }
}

const ROSTER = voiceRoster()

/** The window that was sent: a user turn, an assistant whose model the source
 * recorded, and one whose model it did not. */
function windowMessages(): ChatMessage[] {
  return [
    message({ id: 'w1', role: 'user', content: 'What is a monad?', origin: 'window' }),
    message({
      id: 'w2',
      role: 'assistant',
      content: 'A monad is a design pattern.',
      origin: 'window',
      voice: voiceMarkFromId('moonshotai/kimi-k2.5', 'source-recorded', ROSTER),
    }),
    message({
      id: 'w3',
      role: 'assistant',
      content: 'And another thing.',
      origin: 'window',
      voice: unrecordedVoiceMark(),
    }),
  ]
}

function seam(partial: Partial<ChatSeam> = {}): ChatSeam {
  return {
    omittedCount: 212,
    originalTitle: 'Monads, again',
    pickedUpAt: '2026-09-28T19:30:00.000Z',
    voiceLabel: 'Kimi K2.6',
    providerNotice: 'Continuing sends this conversation to Moonshot through OpenRouter.',
    ...partial,
  }
}

function liveReply(): ChatMessage {
  return message({
    id: 'l1',
    role: 'assistant',
    content: 'Picking this up.',
    createdAt: Date.UTC(2026, 8, 28, 19, 31),
    voice: voiceMarkFromId('moonshotai/kimi-k2.6', 'live', ROSTER),
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the window and the seam', () => {
  it('shows the count above the window, the window in its own voice, then the dated seam, then this conversation', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = [
      ...windowMessages(),
      message({ id: 'l0', role: 'user', content: 'So where were we?', createdAt: Date.UTC(2026, 8, 28, 19, 30) }),
      liveReply(),
    ]
    await settle(el)

    const container = el.querySelector<HTMLElement>('.messages-container')!
    const order = Array.from(container.children).map(child => {
      if (child.classList.contains('window-note')) return 'note'
      if (child.hasAttribute('data-seam')) return 'seam'
      if (child.classList.contains('message')) {
        return `${child.classList.contains('window') ? 'window' : 'live'}-${child.classList.contains('user') ? 'user' : 'assistant'}`
      }
      return child.className
    })
    expect(order).toEqual([
      'note',
      'window-user',
      'window-assistant',
      'window-assistant',
      'seam',
      'live-user',
      'live-assistant',
    ])
  })

  it('says how many earlier messages were left out and offers the original', async () => {
    const el = mount()
    const actions: ChatSeamAction[] = []
    el.seam = seam({ omittedCount: 212 })
    el.onSeamAction = action => actions.push(action)
    el.messages = windowMessages()
    await settle(el)

    const note = el.querySelector<HTMLElement>('.window-note')!
    expect(squash(note.textContent)).toBe('212 earlier messages not included · open the original')
    expect(note.dataset.windowOmitted).toBe('212')
    note.querySelector<HTMLButtonElement>('.window-open-original')!.click()
    expect(actions).toEqual([{ type: 'open-original' }])
  })

  it('does not offer an original it cannot open', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = windowMessages()
    await settle(el)
    const note = el.querySelector<HTMLElement>('.window-note')!
    expect(squash(note.textContent)).toBe('212 earlier messages not included')
    expect(note.querySelector('button')).toBeNull()
  })

  it('counts honestly in the singular and when nothing was left out', async () => {
    const el = mount()
    el.messages = windowMessages()
    el.seam = seam({ omittedCount: 1 })
    await settle(el)
    expect(squash(el.querySelector('.window-note')?.textContent)).toBe('1 earlier message not included')

    el.seam = seam({ omittedCount: 0 })
    await settle(el)
    expect(squash(el.querySelector('.window-note')?.textContent)).toBe('The whole conversation is included')
  })

  it('words the seam as: — date · picked up with Voice —, with the provider notice under it', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = windowMessages()
    await settle(el)

    const date = new Date('2026-09-28T19:30:00.000Z').toLocaleDateString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    const node = el.querySelector<HTMLElement>('[data-seam]')!
    expect(node.querySelector('.seam-line')?.textContent).toBe(`— ${date} · picked up with Kimi K2.6 —`)
    expect(node.querySelector('.seam-notice')?.textContent).toBe(
      'Continuing sends this conversation to Moonshot through OpenRouter.',
    )
  })

  it('leaves the date out rather than printing a blank one when the time is unreadable', async () => {
    const el = mount()
    el.seam = seam({ pickedUpAt: 'not a time', providerNotice: null })
    el.messages = windowMessages()
    await settle(el)
    const node = el.querySelector<HTMLElement>('[data-seam]')!
    expect(node.querySelector('.seam-line')?.textContent).toBe('— picked up with Kimi K2.6 —')
    expect(node.querySelector('.seam-notice')).toBeNull()
  })

  it('renders the seam even before the person has said anything, and never the empty state', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = windowMessages()
    await settle(el)
    expect(el.querySelector('[data-seam]')).not.toBeNull()
    expect(el.querySelector('.empty-state')).toBeNull()

    const bare = mount()
    bare.seam = seam()
    bare.messages = []
    await settle(bare)
    expect(bare.querySelector('[data-seam]')).not.toBeNull()
    expect(bare.querySelector('.empty-state')).toBeNull()
  })

  it('renders an ordinary conversation exactly as before when there is no seam', async () => {
    const el = mount()
    el.messages = [liveReply()]
    await settle(el)
    expect(el.querySelector('.window-note')).toBeNull()
    expect(el.querySelector('[data-seam]')).toBeNull()
  })
})

describe('the window is quiet, read-only, and names nobody', () => {
  it('calls the earlier assistant an earlier assistant, never the current one', async () => {
    const el = mount()
    el.assistantLabel = 'Sophia'
    el.seam = seam()
    el.messages = [...windowMessages(), liveReply()]
    await settle(el)

    const carried = Array.from(el.querySelectorAll('.message.window .message-author')).map(node => node.textContent)
    expect(carried).toEqual(['You', 'Earlier assistant', 'Earlier assistant'])
    const live = Array.from(el.querySelectorAll('.message:not(.window) .message-author')).map(node => node.textContent)
    expect(live).toEqual(['Sophia'])
    const labels = Array.from(el.querySelectorAll('.message.window')).map(node => node.getAttribute('aria-label'))
    expect(labels).toEqual(['Your message', 'Earlier assistant message', 'Earlier assistant message'])
  })

  it('marks each assistant with the voice the record names, and says so when it names none', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = [...windowMessages(), liveReply()]
    await settle(el)

    const marks = Array.from(el.querySelectorAll<HTMLElement>('.message-voice'))
    expect(marks.map(mark => mark.textContent)).toEqual([
      'voice: Kimi K2.5 · source-recorded',
      'voice not recorded',
      'voice: Kimi K2.6',
    ])
    expect(marks.map(mark => mark.dataset.voiceBasis)).toEqual(['source-recorded', 'unrecorded', 'live'])
    expect(marks[0].title).toBe('moonshotai/kimi-k2.5')
    expect(marks[1].title).toBe('The source did not record which model answered.')
  })

  it('never puts a voice mark on the person’s own message', async () => {
    const el = mount()
    el.messages = [
      message({
        id: 'u1',
        role: 'user',
        content: 'hola',
        voice: voiceMarkFromId('moonshotai/kimi-k2.6', 'live', ROSTER),
      }),
    ]
    await settle(el)
    expect(el.querySelector('.message-voice')).toBeNull()
  })

  it('lets a window message be copied but not read aloud or regenerated', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = [...windowMessages(), liveReply()]
    await settle(el)

    const carried = el.querySelector<HTMLElement>('.message.assistant.window')!
    const carriedActions = Array.from(carried.querySelectorAll('.message-action-btn')).map(button =>
      button.getAttribute('aria-label'),
    )
    expect(carriedActions).toEqual(['Copy message'])
    const live = el.querySelector<HTMLElement>('.message.assistant:not(.window)')!
    const liveActions = Array.from(live.querySelectorAll('.message-action-btn')).map(button =>
      button.getAttribute('aria-label'),
    )
    expect(liveActions).toEqual(['Read aloud', 'Copy message', 'Regenerate'])
  })

  it('does not offer regenerate from the context menu of a window message', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = windowMessages()
    el.onMessageAction = () => undefined
    await settle(el)

    const carried = el.querySelector<HTMLElement>('.message.assistant.window')!
    carried.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    await settle(el)
    const items = Array.from(el.querySelectorAll('.chat-menu-item')).map(item => squash(item.textContent))
    expect(items.some(item => item.includes('Regenerate'))).toBe(false)
    expect(items.some(item => item.includes('Copy message'))).toBe(true)
  })

  it('sends a window message’s prose through the panel’s sanitize seam, like any other message', async () => {
    // An old conversation is untrusted text. Whether the seam NEUTRALIZES a payload is proven under
    // jsdom, in chat-panel-xss.test.ts ("… from an earlier conversation carried in a window"):
    // happy-dom degrades DOMPurify, so a payload assertion here would be a false proof. What this
    // file can honestly hold is that a carried message's prose takes the sanitized path (marked ->
    // sanitize -> the markdown block), the same one a live message takes, with nothing beside it.
    const el = mount()
    const passed: string[] = []
    el.sanitize = html => {
      passed.push(html)
      return html
    }
    el.seam = seam()
    el.messages = [
      message({
        id: 'w-marked',
        role: 'assistant',
        content: 'an **old** answer',
        origin: 'window',
        voice: unrecordedVoiceMark(),
      }),
    ]
    await settle(el)

    expect(passed.some(html => html.includes('<strong>old</strong>'))).toBe(true)
    const carried = el.querySelector<HTMLElement>('.message.assistant.window')!
    expect(carried.querySelector('.markdown-content strong')?.textContent).toBe('old')
  })

  it('shows the date and time of an old message, and no time at all when it was never recorded', async () => {
    const el = mount()
    el.seam = seam()
    el.messages = [
      message({ id: 'w-dated', role: 'user', content: 'dated', origin: 'window', createdAt: Date.UTC(2026, 7, 2, 15, 0) }),
      message({ id: 'w-undated', role: 'user', content: 'undated', origin: 'window', createdAt: 0 }),
    ]
    await settle(el)
    const times = Array.from(el.querySelectorAll('.message.window')).map(node =>
      node.querySelector('.message-time')?.textContent ?? null,
    )
    const expected = new Date(Date.UTC(2026, 7, 2, 15, 0)).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    expect(times).toEqual([expected, null])
  })
})

describe('the voice of a continued conversation is fixed at the seam', () => {
  it('locks the picker as soon as there is a seam, before the first message', async () => {
    const el = mount()
    el.models = ROSTER
    el.currentModel = 'moonshotai/kimi-k2.6'
    el.seam = seam()
    el.messages = windowMessages()
    await settle(el)

    const trigger = el.querySelector<HTMLButtonElement>('.model-selector-trigger')!
    expect(trigger.disabled).toBe(true)
    expect(squash(trigger.textContent)).toContain('Kimi K2.6')
  })

  it('does not count window messages as this conversation having begun', async () => {
    const el = mount()
    el.models = ROSTER
    el.currentModel = 'moonshotai/kimi-k2.6'
    el.messages = windowMessages()
    await settle(el)
    // No seam, only window-flagged messages: nothing has been said HERE yet.
    expect(el.querySelector<HTMLButtonElement>('.model-selector-trigger')!.disabled).toBe(false)
  })
})
