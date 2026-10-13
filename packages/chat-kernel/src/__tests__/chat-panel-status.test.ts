/**
 * The busy label is honest about what the turn is waiting for (NO MOCKS: the real
 * <sh-chat-panel> in a real happy-dom document).
 *
 * Defect guarded (F-step-zero D6, seen live): the reply text was complete on screen
 * and the header still counted "Thinking... (3s)", "Thinking... (4s)" while the host
 * finished closing the turn. Once the reply is in, the only thing left to wait for is
 * the end of the turn, and that is what the label says.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShChatPanel } from '../chat-panel.js'
import type { ChatMessage } from '../types.js'

void ShChatPanel

function mount(): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  document.body.appendChild(el)
  return el
}

async function settle(el: ShChatPanel): Promise<void> {
  await el.updateComplete
  await Promise.resolve()
  await el.updateComplete
}

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  const content = partial.content ?? ''
  return {
    content,
    parts: content ? [{ type: 'text', content }] : [],
    isStreaming: false,
    toolCalls: [],
    createdAt: 1,
    ...partial,
  }
}

const status = (el: ShChatPanel): string | null => el.querySelector('.status-streaming')?.textContent ?? null

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('the busy label once the reply text is complete', () => {
  it('says the turn is finishing, not that the model is thinking', async () => {
    const el = mount()
    el.streaming = true
    el.messages = [
      message({ id: 'u1', role: 'user', content: 'Say that again.' }),
      message({ id: 'a1', role: 'assistant', content: 'Read and search workspace.', isStreaming: false }),
    ]
    await settle(el)
    expect(status(el)).toBe('Finishing...')
  })

  it('does not go back to counting seconds of thinking however long the close takes', async () => {
    vi.useFakeTimers()
    const el = mount()
    el.streaming = true
    el.messages = [
      message({ id: 'u1', role: 'user', content: 'Say that again.' }),
      message({ id: 'a1', role: 'assistant', content: 'Read and search workspace.' }),
    ]
    await settle(el)
    vi.advanceTimersByTime(5_000)
    await settle(el)
    expect(status(el)).toBe('Finishing...')
    el.streaming = false
    await settle(el)
    expect(status(el)).toBeNull()
  })

  it('still says Responding while the reply is arriving', async () => {
    const el = mount()
    el.streaming = true
    el.messages = [
      message({ id: 'u1', role: 'user', content: 'Q' }),
      message({ id: 'a1', role: 'assistant', content: 'Read', isStreaming: true }),
    ]
    await settle(el)
    expect(status(el)).toBe('Responding...')
  })
})

describe('the busy label before there is a reply', () => {
  it('says Thinking while a follow-up is being sent, though the previous answer is the last thing on screen', async () => {
    const el = mount()
    el.streaming = true
    el.sendState = 'saving'
    el.messages = [
      message({ id: 'u1', role: 'user', content: 'First question' }),
      message({ id: 'a1', role: 'assistant', content: 'First answer.' }),
    ]
    await settle(el)
    expect(status(el)).toBe('Thinking...')
  })

  it('says Thinking when the last thing on screen is the person’s own message', async () => {
    const el = mount()
    el.streaming = true
    el.messages = [
      message({ id: 'u1', role: 'user', content: 'First question' }),
      message({ id: 'a1', role: 'assistant', content: 'First answer.' }),
      message({ id: 'u2', role: 'user', content: 'Second question' }),
    ]
    await settle(el)
    expect(status(el)).toBe('Thinking...')
  })

  it('does not take an earlier conversation’s message for this turn’s reply', async () => {
    const el = mount()
    el.streaming = true
    el.messages = [
      message({ id: 'w1', role: 'assistant', content: 'Said elsewhere, long ago.', origin: 'window' }),
    ]
    await settle(el)
    expect(status(el)).toBe('Thinking...')
  })

  it('says Running while a tool runs', async () => {
    const el = mount()
    el.streaming = true
    el.messages = [
      message({
        id: 'a1',
        role: 'assistant',
        content: 'Checking.',
        isStreaming: true,
        toolCalls: [{ id: 't1', tool: 'read_document', status: 'running', input: null, output: null }],
      }),
    ]
    await settle(el)
    expect(status(el)).toBe('Running read_document...')
  })
})
