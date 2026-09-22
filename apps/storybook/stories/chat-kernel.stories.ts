/**
 * Chat Kernel — the LIVE pure <sh-chat-panel> organism.
 *
 * Mounts the REAL @shrubbery/chat-kernel custom element (relocated + scrubbed from
 * garden's mn-chat-panel: stores/EventSource/billing/cognito/themeStore stripped,
 * replaced with ChatKernelOptions PURE callbacks). The element renders into LIGHT
 * DOM (createRenderRoot(){return this}) and adopts its stylesheet onto the host
 * root.
 *
 * NO MOCKS: messages are real ChatMessage render data (the projector's output
 * shape); the composer onSend is a real callback the story wires (it appends the
 * user's text + a canned assistant reply to the live element's `messages`), so the
 * organism is probeable end-to-end. `play()` drives the REAL Hoja surface and
 * fires a REAL Enter keydown, then asserts the live DOM reflects the new message —
 * exactly the R5 composer→onSend invariant, on stage.
 */
import type { Meta, StoryObj } from '@storybook/web-components'

import {
  ShChatPanel,
  type ChatMessage,
  type ChatTheme,
} from '@shrubbery/chat-kernel'

// Touch the class so the import (which registers <sh-chat-panel>) is load-bearing.
void ShChatPanel

const meta: Meta = {
  title: 'Chat/Kernel',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

function assistant(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content,
    parts: [{ type: 'text', content }],
    isStreaming: false,
    toolCalls: [],
    createdAt: Date.now(),
    ...extra,
  }
}

function user(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    parts: [{ type: 'text', content }],
    isStreaming: false,
    toolCalls: [],
    createdAt: Date.now(),
  }
}

/** Seed messages exercising prose, a code fence (PROSE SITE B + escaped fence),
 * reasoning, and all four tool-call badge states. */
function seedMessages(): ChatMessage[] {
  return [
    user('Show me the tool-call states and a code block.'),
    assistant('Here is some **markdown** prose and a fence:\n\n```ts\nconst garden = "forking paths"\n```\n\nAnd the four tool states below.', {
      parts: [
        { type: 'reasoning', content: 'Thinking about how to demonstrate the states…' },
        { type: 'text', content: 'Here is some **markdown** prose and a fence:\n\n```ts\nconst garden = "forking paths"\n```' },
        { type: 'tool', toolCallId: 'p' },
        { type: 'tool', toolCallId: 'r' },
        { type: 'tool', toolCallId: 'c' },
        { type: 'tool', toolCallId: 'e' },
      ],
      toolCalls: [
        { id: 'p', tool: 'pending_gate', status: 'pending', input: { q: 'x' }, output: null },
        { id: 'r', tool: 'running_gate', status: 'running', input: { q: 'y' }, output: null },
        { id: 'c', tool: 'search_documents', status: 'completed', input: { q: 'borges' }, output: 'found 3' },
        { id: 'e', tool: 'failing_gate', status: 'error', input: null, output: 'boom' },
      ],
    }),
  ]
}

/** Mount a REAL <sh-chat-panel>, wire its PURE callbacks, and seed render data.
 * onSend is a real host callback: it appends the user's message + a canned reply
 * to the live element's `messages` (the host owns transport — the kernel only
 * emits the intent). */
function mountPanel(theme: ChatTheme): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  el.style.height = '100vh'
  el.theme = theme
  el.messages = seedMessages()
  el.models = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
  ]
  el.currentModel = 'claude-opus-4-6'

  // PURE host seams — real callbacks, never a backend import.
  el.onSend = (text: string) => {
    el.messages = [...el.messages, user(text), assistant(`You said: "${text}". (canned host reply)`)]
  }
  el.onMessageAction = (id, action) => {
    // A host would copy/read/regenerate here; the story just records via title.
    el.title = `last action: ${action} on ${id}`
  }
  el.onSurfaceAction = (a) => {
    el.title = `surface: ${a.title}`
  }
  el.onModelChange = (m) => {
    el.currentModel = m
  }
  return el
}

export const LivePanel: Story = {
  render: () => mountPanel('light'),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const el = (canvasElement.querySelector('sh-chat-panel') ??
      canvasElement.closest('sh-chat-panel') ??
      (canvasElement as unknown)) as ShChatPanel
    await el.updateComplete

    // LIGHT DOM invariant — the element renders into itself, no shadow root.
    if (el.shadowRoot) throw new Error('LivePanel.play: expected LIGHT DOM (no shadowRoot)')

    // All four tool-call badge states are on stage.
    for (const status of ['pending', 'running', 'completed', 'error']) {
      if (!el.querySelector(`.tool-status-icon[data-status="${status}"]`)) {
        throw new Error(`LivePanel.play: missing ${status} tool-call badge`)
      }
    }

    // Drive the REAL composer: type + real Enter keydown fires onSend.
    el.draft = 'the library of Babel'
    await el.updateComplete
    const hoja = el.querySelector('hoja-editor[posture="composer"]') as HTMLElement & {
      updateComplete: Promise<boolean>
    }
    if (!hoja) throw new Error('LivePanel.play: no Hoja composer')
    await hoja.updateComplete
    const input = hoja.querySelector('.ProseMirror') as HTMLElement
    if (!input) throw new Error('LivePanel.play: no Hoja ProseMirror')
    const before = el.messages.length
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await el.updateComplete

    if (el.messages.length <= before) {
      throw new Error('LivePanel.play: onSend did not append the new message')
    }
  },
}

/** Every prose mark and message state the panel styles, on one stage.
 *
 * This is the eyeball fixture for the visual layer: link, emphasis, ordered and
 * unordered lists, blockquote, rule, GFM table, inline code and a fenced block —
 * rendered once against the assistant's rule-gutter column and once inside the
 * accent-filled user bubble, where every mark has to invert. Plus the states
 * that are hard to catch in a normal session: a turn mid-stream, and a turn
 * that failed. Real render data, no mocks. */
const PROSE = [
  'A [link](https://example.test) sits in a sentence, with **strong** and *emphatic* runs,',
  'plus a bit of `inline_code` that should read as a chip.',
  '',
  '1. an ordered step',
  '2. a second step',
  '   - a nested aside',
  '',
  '> A quoted line, which should carry a rule in the accent hue.',
  '',
  '| face | role |',
  '| --- | --- |',
  '| prose | reading |',
  '| utility | metadata |',
  '',
  '---',
  '',
  '```ts',
  'const garden = "forking paths"',
  '```',
].join('\n')

function proseMessages(): ChatMessage[] {
  return [
    user(PROSE),
    assistant(PROSE),
    assistant('Still arriving — the margin rule should be lit.', { isStreaming: true }),
    assistant('This turn did not complete.', {
      error: 'The model stopped before finishing this turn.',
    }),
    assistant('', {
      parts: [{ type: 'tool', toolCallId: 'e' }],
      toolCalls: [
        { id: 'e', tool: 'failing_gate', status: 'error', input: { q: 'z' }, output: 'boom: gate refused' },
      ],
    }),
  ]
}

function mountProsePanel(theme: ChatTheme): ShChatPanel {
  const el = mountPanel(theme)
  el.messages = proseMessages()
  return el
}

export const ProseAndStates: Story = {
  render: () => mountProsePanel('light'),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const el = (canvasElement.querySelector('sh-chat-panel') ??
      (canvasElement as unknown)) as ShChatPanel
    await el.updateComplete

    const scope = el.querySelector('.markdown-content')
    if (!scope) throw new Error('ProseAndStates.play: no .markdown-content prose scope')
    for (const selector of ['a[href]', 'strong', 'em', 'ol > li', 'blockquote', 'table th', 'hr', 'code']) {
      if (!scope.querySelector(selector)) {
        throw new Error(`ProseAndStates.play: prose scope is missing ${selector}`)
      }
    }

    // The fenced well must stay OUTSIDE the prose scope, or the prose pre/code
    // rules reach inside it and draw a box within a box.
    if (!el.querySelector('.code-block pre > code')) {
      throw new Error('ProseAndStates.play: no fenced code well')
    }
    if (el.querySelector('.markdown-content .code-block')) {
      throw new Error('ProseAndStates.play: fenced well nested inside the prose scope')
    }

    if (!el.querySelector('.message-bubble.streaming')) {
      throw new Error('ProseAndStates.play: no streaming bubble on stage')
    }
    if (!el.querySelector('.message-error[role="alert"]')) {
      throw new Error('ProseAndStates.play: no message-error field on stage')
    }
    if (!el.querySelector('.tool-call.error .tool-call-error')) {
      throw new Error('ProseAndStates.play: no tool-call error field on stage')
    }
  },
}

export const ProseAndStatesDark: Story = {
  render: () => mountProsePanel('dark'),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const el = (canvasElement.querySelector('sh-chat-panel') ??
      (canvasElement as unknown)) as ShChatPanel
    await el.updateComplete
    if (el.dataset.theme !== 'dark') {
      throw new Error(`ProseAndStatesDark.play: expected data-theme="dark", got ${el.dataset.theme}`)
    }
  },
}

export const DarkPanel: Story = {
  render: () => mountPanel('dark'),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const el = (canvasElement.querySelector('sh-chat-panel') ??
      (canvasElement as unknown)) as ShChatPanel
    await el.updateComplete
    if (el.dataset.theme !== 'dark') {
      throw new Error(`DarkPanel.play: expected data-theme="dark", got ${el.dataset.theme}`)
    }
  },
}
