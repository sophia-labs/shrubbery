/**
 * <sh-chat-panel> — REAL-DOM functional test (NO MOCKS).
 *
 * Mounts the actual relocated+scrubbed Lit custom element into the real
 * (happy-dom) document and drives it through real DOM events. The assertions
 * lock the load-bearing R5 invariants:
 *
 *   1. LIGHT DOM — `el.shadowRoot` is null (createRenderRoot(){return this}).
 *      The element renders its content into ITSELF.
 *   2. TOOL-CALL BADGES — all four states (pending/running/completed/error)
 *      render with the right `data-status`.
 *   3. COMPOSER → onSend — a real keydown (Enter) in the real Hoja/ProseMirror
 *      surface fires the onSend callback with canonical text and clears draft.
 *
 * Plus: dark mode is driven by the `theme` prop writing data-theme on the host
 * (NOT a themeStore); the adopted stylesheet lands on the host's root; and the
 * prose path sanitizes (a real <img onerror> is stripped end-to-end).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  collectWikiLinkReferences,
  parseComposerMarkdown,
  type HojaComposerDetail,
  type HojaEditor,
} from '@shrubbery/hoja'

import {
  ShChatPanel,
  type ChatComposerControlChangeDetail,
  type ChatEmptySuggestion,
  type ChatPromptOptionUseDetail,
  type ChatPromptSubmitDetail,
  type CodeCopyIntent,
} from '../chat-panel.js'
import type { ChatMessage } from '../types.js'

// Importing the module registers <sh-chat-panel>. Touch the class so the import
// is unmistakably load-bearing (and to assert the registration below).
void ShChatPanel

const DEFAULT_VIEWPORT_WIDTH = window.innerWidth

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

function composer(el: ShChatPanel): HojaEditor {
  const hoja = el.querySelector<HojaEditor>('hoja-editor[posture="composer"]')
  if (!hoja) throw new Error('Hoja composer not mounted')
  return hoja
}

function composerInput(el: ShChatPanel): HTMLElement {
  const input = composer(el).querySelector<HTMLElement>('.ProseMirror')
  if (!input) throw new Error('Hoja ProseMirror not mounted')
  return input
}

function detailFor(value: string): HojaComposerDetail {
  const json = parseComposerMarkdown(value)
  const references = collectWikiLinkReferences(json)
  const plainText = value.replace(/[*_`]/g, '')
  return {
    value,
    plainText,
    json,
    references,
    isEmpty: plainText.trim().length === 0 && references.length === 0,
  }
}

async function editComposer(el: ShChatPanel, value: string): Promise<HojaEditor> {
  const hoja = composer(el)
  hoja.onChange?.(detailFor(value))
  await settle(el)
  return hoja
}

function assistantMsg(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'hello',
    parts: [{ type: 'text', content: 'hello' }],
    isStreaming: false,
    toolCalls: [],
    createdAt: 0,
    ...partial,
  }
}

function setScrollMetrics(
  el: HTMLElement,
  opts: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: opts.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: opts.clientHeight })
  el.scrollTop = opts.scrollTop
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
  document.documentElement.removeAttribute('data-design')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DEFAULT_VIEWPORT_WIDTH })
})

describe('<sh-chat-panel> registration', () => {
  it('registers the custom element under the sh- prefix', () => {
    expect(customElements.get('sh-chat-panel')).toBe(ShChatPanel)
  })
})

describe('<sh-chat-panel> light DOM', () => {
  it('renders into LIGHT DOM — no shadowRoot', async () => {
    const el = mount()
    el.messages = [assistantMsg()]
    await settle(el)

    // The load-bearing createRenderRoot(){return this} invariant.
    expect(el.shadowRoot).toBeNull()
    // Content rendered into the element itself (not a shadow root).
    expect(el.querySelector('.messages-container')).not.toBeNull()
    expect(el.querySelector('hoja-editor[posture="composer"]')).not.toBeNull()
    expect(el.querySelector('.ProseMirror')).not.toBeNull()
    expect(el.querySelector('textarea.composer-textarea')).toBeNull()
  })

  it('adopts the shared stylesheet onto the host root', async () => {
    const el = mount()
    await settle(el)
    const root = el.getRootNode() as Document
    // The adopted sheet is the kernel's — assert at least one sheet carries a
    // sh-chat-panel rule (proves the rename took + adoptStyles ran).
    const text = root.adoptedStyleSheets
      .flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText))
      .join('\n')
    expect(text).toContain('sh-chat-panel')
    // And NOT the old selector — the scrub is complete.
    expect(text).not.toContain('mn-chat-panel')
  })

  it('mirrors 98 and Glass across the chat-host shadow boundary', async () => {
    document.documentElement.dataset.skin = '98'
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'open' })
    document.body.appendChild(host)
    const el = document.createElement('sh-chat-panel') as ShChatPanel
    root.appendChild(el)
    await settle(el)

    expect(el.dataset.skin).toBe('98')

    document.documentElement.dataset.skin = 'glass'
    await new Promise(resolve => setTimeout(resolve, 0))
    await settle(el)
    expect(el.dataset.skin).toBe('glass')

    document.documentElement.removeAttribute('data-skin')
    await new Promise(resolve => setTimeout(resolve, 0))
    await settle(el)
    expect(el.hasAttribute('data-skin')).toBe(false)
  })

  it('carries complete material selectors for chat controls and overlays', () => {
    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain("sh-chat-panel:is([data-skin='98'], [data-skin='glass']) .super-bar")
    expect(css).toContain('--mn-chat-control-bg')
    expect(css).toContain('--mn-window-backdrop-filter')
    expect(css).toContain('.chat-message-menu')
    expect(css).toContain('.prompt-card')
    expect(css).toContain('::-webkit-scrollbar-thumb')
  })
})

describe('<sh-chat-panel> tool-call badges', () => {
  const STATES: Array<ChatMessage['toolCalls'][number]['status']> = [
    'pending',
    'running',
    'completed',
    'error',
  ]

  for (const status of STATES) {
    it(`renders the ${status} badge`, async () => {
      const el = mount()
      el.messages = [
        assistantMsg({
          content: '',
          parts: [{ type: 'tool', toolCallId: 't1' }],
          toolCalls: [{ id: 't1', tool: 'search_documents', status, input: { q: 'x' }, output: 'r' }],
        }),
      ]
      await settle(el)

      const badge = el.querySelector(`.tool-status-icon[data-status="${status}"]`)
      expect(badge, `expected a ${status} badge`).not.toBeNull()
    })
  }

  it('renders all four badge states distinctly across four tool calls', async () => {
    const el = mount()
    el.messages = [
      assistantMsg({
        content: '',
        parts: STATES.map((_, i) => ({ type: 'tool', toolCallId: `t${i}` }) as const),
        toolCalls: STATES.map((status, i) => ({
          id: `t${i}`,
          tool: 'gate',
          status,
          input: null,
          output: null,
        })),
      }),
    ]
    await settle(el)

    for (const status of STATES) {
      expect(el.querySelector(`.tool-status-icon[data-status="${status}"]`)).not.toBeNull()
    }
  })

  it('renders expanded JSON tool input and output as structured blocks', async () => {
    const el = mount()
    el.messages = [
      assistantMsg({
        id: 'mToolJson',
        content: '',
        parts: [{ type: 'tool', toolCallId: 'remember-1' }],
        toolCalls: [
          {
            id: 'remember-1',
            tool: 'remember',
            status: 'completed',
            input: {
              content: 'durable memory',
              source_refs: [{ sourceKind: 'PlatformEvent', externalId: 'turn-1' }],
            },
            output: JSON.stringify({ blockId: 'memory-2', number: 2, source: 'local-memory-store' }),
          },
        ],
      }),
    ]
    await settle(el)

    ;(el.querySelector('.tool-call-header') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await settle(el)

    expect(el.querySelectorAll('.tool-data-block')).toHaveLength(2)
    expect(el.querySelector('.tool-data-label')?.textContent).toBe('Input')
    expect(el.querySelector('.tool-json')?.textContent).toContain('"source_refs"')
    expect(el.textContent).toContain('"blockId": "memory-2"')
  })

  it('lets instrumented hosts render tool details expanded by default', async () => {
    const el = mount()
    el.toolsExpandedByDefault = true
    el.messages = [
      assistantMsg({
        id: 'mToolDefaultOpen',
        content: '',
        parts: [{ type: 'tool', toolCallId: 'recall-1' }],
        toolCalls: [
          {
            id: 'recall-1',
            tool: 'recall',
            status: 'completed',
            input: { graphId: 'glosa' },
            output: JSON.stringify({ count: 1, memories: [{ content: 'orientation' }] }),
          },
        ],
      }),
    ]
    await settle(el)

    expect(el.querySelector('.tool-call')?.classList.contains('expanded')).toBe(true)
    expect(el.querySelectorAll('.tool-data-block')).toHaveLength(2)

    ;(el.querySelector('.tool-call-header') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    await settle(el)

    expect(el.querySelector('.tool-call')?.classList.contains('expanded')).toBe(false)
    expect(el.querySelectorAll('.tool-data-block')).toHaveLength(0)
  })
})

describe('<sh-chat-panel> Garden-style message autoscroll', () => {
  it('renders transcript parts as a labeled timeline with structured JSON', async () => {
    const el = mount()
    el.messages = [
      assistantMsg({
        id: 'mTranscript',
        content: 'voice and data',
        parts: [
          { type: 'text', content: '**learner-1** · agent' },
          { type: 'transcript', title: 'voice leaf 01', content: 'Hello from the stream.', tone: 'voice' },
          { type: 'transcript', title: 'data leaf 02', content: '{"count":1}', tone: 'data' },
        ],
      }),
    ]
    await settle(el)

    expect(Array.from(el.querySelectorAll('.transcript-title')).map((node) => node.textContent)).toEqual([
      'voice leaf 01',
      'data leaf 02',
    ])
    expect(el.querySelector('.transcript-part.voice')?.textContent).toContain('Hello from the stream.')
    expect(el.querySelector('.transcript-json')?.textContent).toContain('"count": 1')
    expect(el.querySelector('h3')).toBeNull()
  })

  it('keeps the log pinned to bottom when new messages arrive at the bottom', async () => {
    const el = mount()
    await settle(el)
    const area = el.querySelector('.messages-container') as HTMLElement
    setScrollMetrics(area, { scrollHeight: 1200, clientHeight: 400, scrollTop: 800 })

    el.messages = [assistantMsg({ id: 'mAutoscroll' })]
    await settle(el)

    expect(area.scrollTop).toBe(1200)
    expect(el.querySelector('.scroll-to-bottom')).toBeNull()
  })

  it('preserves scroll position and shows a new-message affordance when messages arrive while scrolled up', async () => {
    const el = mount()
    el.messages = [assistantMsg({ id: 'mFirst' })]
    await settle(el)
    const area = el.querySelector('.messages-container') as HTMLElement
    setScrollMetrics(area, { scrollHeight: 1200, clientHeight: 400, scrollTop: 100 })

    area.dispatchEvent(new Event('scroll', { bubbles: true }))
    await settle(el)

    el.messages = [assistantMsg({ id: 'mFirst' }), assistantMsg({ id: 'mSecond', content: 'new' })]
    await settle(el)

    expect(area.scrollTop).toBe(100)
    const button = el.querySelector('.scroll-to-bottom') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.classList.contains('has-new')).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('New messages - scroll to bottom')
  })

  it('pauses before an upward wheel scroll so a same-message streaming tick cannot snap back down', async () => {
    const el = mount()
    el.messages = [assistantMsg({ id: 'mStreaming', content: 'partial' })]
    await settle(el)
    const area = el.querySelector('.messages-container') as HTMLElement
    setScrollMetrics(area, { scrollHeight: 1200, clientHeight: 400, scrollTop: 800 })
    area.dispatchEvent(new Event('scroll', { bubbles: true }))

    // Wheel precedes the browser's asynchronous scroll event. A stream update
    // may land in between, so upward intent itself has to pause auto-scroll.
    area.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -24 }))
    setScrollMetrics(area, { scrollHeight: 1320, clientHeight: 400, scrollTop: 776 })
    el.messages = [assistantMsg({ id: 'mStreaming', content: 'partial plus another token', isStreaming: true })]
    await settle(el)

    expect(area.scrollTop).toBe(776)
    const button = el.querySelector('.scroll-to-bottom') as HTMLButtonElement
    expect(button.classList.contains('has-new')).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('New messages - scroll to bottom')
  })

  it('treats a small upward move inside the near-bottom band as an explicit pause', async () => {
    const el = mount()
    el.messages = [assistantMsg({ id: 'mNearBottom', content: 'partial' })]
    await settle(el)
    const area = el.querySelector('.messages-container') as HTMLElement
    setScrollMetrics(area, { scrollHeight: 1200, clientHeight: 400, scrollTop: 800 })
    area.dispatchEvent(new Event('scroll', { bubbles: true }))

    // Twenty pixels is inside the 50px resume threshold, but moving UP must
    // still win. The generous threshold applies only while returning downward.
    area.scrollTop = 780
    area.dispatchEvent(new Event('scroll', { bubbles: true }))
    await settle(el)
    setScrollMetrics(area, { scrollHeight: 1300, clientHeight: 400, scrollTop: 780 })
    el.messages = [assistantMsg({ id: 'mNearBottom', content: 'stream grew', isStreaming: true })]
    await settle(el)

    expect(area.scrollTop).toBe(780)
    expect(el.querySelector('.scroll-to-bottom')).not.toBeNull()
  })

  it('resumes pinning near the bottom and follows same-message streaming growth', async () => {
    const el = mount()
    el.messages = [assistantMsg({ id: 'mResume', content: 'partial' })]
    await settle(el)
    const area = el.querySelector('.messages-container') as HTMLElement
    setScrollMetrics(area, { scrollHeight: 1200, clientHeight: 400, scrollTop: 100 })
    area.dispatchEvent(new Event('scroll', { bubbles: true }))
    await settle(el)

    area.scrollTop = 790
    area.dispatchEvent(new Event('scroll', { bubbles: true }))
    await settle(el)
    setScrollMetrics(area, { scrollHeight: 1320, clientHeight: 400, scrollTop: 790 })
    el.messages = [assistantMsg({ id: 'mResume', content: 'partial plus another token', isStreaming: true })]
    await settle(el)

    expect(area.scrollTop).toBe(1320)
    expect(el.querySelector('.scroll-to-bottom')).toBeNull()
  })

  it('force-scrolls to bottom from the floating affordance and clears new-message state', async () => {
    const el = mount()
    el.messages = [assistantMsg({ id: 'mFirst' })]
    await settle(el)
    const area = el.querySelector('.messages-container') as HTMLElement
    setScrollMetrics(area, { scrollHeight: 1200, clientHeight: 400, scrollTop: 100 })
    Object.defineProperty(area, 'scrollTo', {
      configurable: true,
      value: ({ top }: { top: number }) => {
        area.scrollTop = top
      },
    })

    area.dispatchEvent(new Event('scroll', { bubbles: true }))
    await settle(el)
    el.messages = [assistantMsg({ id: 'mFirst' }), assistantMsg({ id: 'mSecond', content: 'new' })]
    await settle(el)

    const button = el.querySelector('.scroll-to-bottom') as HTMLButtonElement
    button.click()
    await settle(el)

    expect(area.scrollTop).toBe(1200)
    expect(el.querySelector('.scroll-to-bottom')).toBeNull()
  })
})

describe('<sh-chat-panel> contained transcript layout', () => {
  it('keeps one stable composer footer outside the only vertically scrolling panel slot', async () => {
    const el = mount()
    el.messages = Array.from({ length: 20 }, (_, index) => assistantMsg({
      id: `mLayout${index}`,
      content: `Transcript row ${index}`,
    }))
    await settle(el)

    const viewport = el.querySelector<HTMLElement>('[data-chat-viewport]')
    const transcript = el.querySelector<HTMLElement>('[data-chat-transcript]')
    const footer = el.querySelector<HTMLElement>('[data-chat-footer]')
    const send = footer?.querySelector<HTMLButtonElement>('.send-button')
    expect(viewport).not.toBeNull()
    expect(transcript?.parentElement).toBe(viewport)
    expect(footer?.parentElement).toBe(el)
    expect(viewport?.nextElementSibling).toBe(footer)
    expect(transcript?.contains(footer ?? null)).toBe(false)
    expect(footer?.getAttribute('role')).toBe('group')
    expect(footer?.getAttribute('aria-label')).toBe('Chat composer')

    // Scrolling the real transcript node cannot replace or move the composer
    // into the scroll subtree. The same buttons stay mounted as its footer.
    setScrollMetrics(transcript!, { scrollHeight: 2400, clientHeight: 400, scrollTop: 900 })
    transcript!.dispatchEvent(new Event('scroll', { bubbles: true }))
    await settle(el)
    expect(el.querySelector('[data-chat-footer]')).toBe(footer)
    expect(footer?.querySelector('.send-button')).toBe(send)

    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toMatch(/sh-chat-panel \.messages-wrapper\s*\{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*overflow: hidden;/s)
    expect(css).toMatch(/sh-chat-panel \.messages-container\s*\{[^}]*position: absolute;[^}]*inset: 0;[^}]*box-sizing: border-box;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/s)
    expect(css).toMatch(/sh-chat-panel \.composer\s*\{[^}]*position: relative;[^}]*flex: 0 0 auto;/s)
    expect(css).not.toMatch(/sh-chat-panel \.composer\s*\{[^}]*position: sticky;/s)
  })
})

describe('<sh-chat-panel> Garden-style streaming status hint', () => {
  it('shows Thinking before content, Running while a tool is active, and Responding once content streams', async () => {
    const el = mount()
    el.streaming = true
    el.messages = [assistantMsg({ id: 'mThinking', content: '', parts: [], isStreaming: true })]
    await settle(el)

    expect(el.querySelector('.status-streaming')?.textContent).toBe('Thinking...')

    el.messages = [
      assistantMsg({
        id: 'mTool',
        content: 'partial content',
        parts: [],
        isStreaming: true,
        toolCalls: [{ id: 't1', tool: 'search_documents', status: 'running', input: null, output: null }],
      }),
    ]
    await settle(el)
    expect(el.querySelector('.status-streaming')?.textContent).toBe('Running search_documents...')

    el.messages = [assistantMsg({ id: 'mReply', content: 'partial content', parts: [], isStreaming: true })]
    await settle(el)
    expect(el.querySelector('.status-streaming')?.textContent).toBe('Responding...')
  })

  it('adds elapsed seconds to the Thinking label after three seconds and clears when streaming ends', async () => {
    vi.useFakeTimers()
    const el = mount()
    el.streaming = true
    el.messages = [assistantMsg({ id: 'mTimed', content: '', parts: [], isStreaming: true })]
    await settle(el)

    expect(el.querySelector('.status-streaming')?.textContent).toBe('Thinking...')

    vi.advanceTimersByTime(3000)
    await settle(el)

    expect(el.querySelector('.status-streaming')?.textContent).toBe('Thinking... (3s)')

    el.streaming = false
    await settle(el)
    expect(el.querySelector('.status-streaming')).toBeNull()
  })
})

describe('<sh-chat-panel> composer → onSend', () => {
  it('renders the Garden-style session superbar and emits pure session intents', async () => {
    const el = mount()
    const actions: unknown[] = []
    el.sessionTitle = 'Research thread'
    el.activeSlot = 1
    el.slotSessions = [null, 'session-b', 'session-c']
    el.onSessionAction = async (action) => {
      actions.push(action)
    }
    await settle(el)

    expect(el.querySelector('.super-bar-sophia')?.textContent).toBe('Sophia')
    expect(el.querySelector('.super-bar-chat-title')?.textContent).toBe('Research thread')

    const slots = Array.from(el.querySelectorAll('.slot-indicator')) as HTMLButtonElement[]
    expect(slots.map((slot) => slot.textContent?.trim())).toEqual(['1', '2', '3'])
    expect(slots[0].classList.contains('filled')).toBe(false)
    expect(slots[1].classList.contains('active')).toBe(true)
    expect(slots[2].classList.contains('filled')).toBe(true)
    expect(slots[1].getAttribute('aria-label')).toBe('Current session slot 2')
    expect(slots[2].getAttribute('aria-label')).toBe('Filled session slot 3')

    ;(el.querySelector('.super-bar-identity') as HTMLButtonElement).click()
    slots[1].click()
    slots[2].click()
    await Promise.resolve()

    expect(actions).toEqual([{ type: 'open-history' }, { type: 'open-history' }, { type: 'slot', slot: 2 }])
  })

  it('gives the controlled conversation an editorial byline and a clearly named composer', async () => {
    const el = mount()
    el.assistantLabel = 'Sophia'
    el.messages = [
      assistantMsg({ id: 'assistant-note', content: 'Follow this thread.' }),
      {
        id: 'user-note',
        role: 'user',
        content: 'Where does it lead?',
        parts: [{ type: 'text', content: 'Where does it lead?' }],
        isStreaming: false,
        toolCalls: [],
        createdAt: 1,
      },
    ]
    await settle(el)

    expect(Array.from(el.querySelectorAll('.message-author')).map(node => node.textContent)).toEqual([
      'Sophia',
      'You',
    ])
    expect(Array.from(el.querySelectorAll('.message')).map(node => node.getAttribute('aria-label'))).toEqual([
      'Sophia message',
      'Your message',
    ])
    expect(el.querySelector('.composer-label')?.textContent).toBe('Write to Sophia')
    expect(el.querySelector('.composer-hint')?.textContent).toBe('Enter sends · Shift+Enter adds a line')
    expect(composerInput(el).getAttribute('aria-label')).toBe('Message Sophia')

    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain('sh-chat-panel .message-byline')
    expect(css).toContain("font-family: var(--mn-font-prose, Georgia, 'Times New Roman', serif)")
    expect(css).toContain('sh-chat-panel .message.assistant .message-author::before')
  })

  it('normalizes blank/default session titles to New chat in the superbar', async () => {
    const el = mount()
    el.sessionTitle = 'New session - 2026-06-23'
    await settle(el)
    expect(el.querySelector('.super-bar-chat-title')?.textContent).toBe('New chat')
  })

  it('renders Garden-style header actions through a pure host intent seam', async () => {
    const el = mount()
    const actions: string[] = []
    el.onHeaderAction = async (action) => {
      actions.push(action)
    }
    await settle(el)

    const saveEmpty = el.querySelector('.icon-button[aria-label="Save chat to Garden"]') as HTMLButtonElement
    expect(saveEmpty).not.toBeNull()
    expect(saveEmpty.disabled).toBe(true)
    expect(el.querySelector('.icon-button[aria-label="Stop generating"]')).toBeNull()

    ;(el.querySelector('.icon-button[aria-label="Refresh messages"]') as HTMLButtonElement).click()
    const expand = el.querySelector('.icon-button[aria-label="Expand conversation"]') as HTMLButtonElement
    expand.focus()
    expand.click()
    await Promise.resolve()
    expect(actions).toEqual(['refresh', 'popout'])

    // Presentation is controlled from outside, and Lit keeps the same header
    // button node/focus while reversing its action semantics.
    el.presentation = 'fullscreen'
    await settle(el)
    const restore = el.querySelector(
      '.icon-button[aria-label="Return conversation to sidebar"]',
    ) as HTMLButtonElement
    expect(restore).toBe(expand)
    expect(document.activeElement).toBe(expand)
    restore.click()
    await Promise.resolve()
    expect(actions).toEqual(['refresh', 'popout', 'restore'])

    actions.length = 0
    el.messages = [assistantMsg({ id: 'mHeader' })]
    el.streaming = true
    await settle(el)

    const save = el.querySelector('.icon-button[aria-label="Save chat to Garden"]') as HTMLButtonElement
    const stop = el.querySelector('.icon-button[aria-label="Stop generating"]') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    expect(stop).not.toBeNull()

    save.click()
    stop.click()
    await Promise.resolve()
    expect(actions).toEqual(['save-garden', 'stop'])
  })

  it('provides one adaptive compact chrome surface and 48px phone targets without forking the kernel', async () => {
    const el = mount()
    el.models = [{ id: 'gpt-5.2', label: 'GPT-5.2' }]
    el.onHeaderAction = () => undefined
    await settle(el)

    const chrome = el.querySelector('.chat-chrome')
    expect(chrome).not.toBeNull()
    expect(chrome?.querySelector('.super-bar')).not.toBeNull()
    expect(chrome?.querySelector('.header')).not.toBeNull()
    expect(chrome?.querySelector('.compact-actions-trigger')?.getAttribute('aria-haspopup')).toBe('menu')

    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain('@media (max-width: 600px)')
    expect(css).toContain('--sh-chat-compact-target: var(--mn-touch-target-size, 48px)')
    expect(css).toContain("grid-template-areas:\n          'identity status actions'\n          'model slots slots'")
    expect(css).toContain('padding: 10px 10px calc(10px + var(--mn-viewport-inset-bottom, env(safe-area-inset-bottom)))')
    expect(css).toContain('overscroll-behavior: contain')
  })

  it('keeps compact header actions host-controlled while presenting them as one reachable overflow menu', async () => {
    const el = mount()
    const actions: string[] = []
    el.onHeaderAction = action => { actions.push(action) }
    await settle(el)

    const trigger = el.querySelector('.compact-actions-trigger') as HTMLButtonElement
    trigger.click()
    await settle(el)

    const menu = el.querySelector('.header-actions-menu')
    expect(menu?.getAttribute('role')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const refresh = menu?.querySelector('[aria-label="Refresh messages"]') as HTMLButtonElement
    refresh.click()
    await Promise.resolve()
    await settle(el)

    expect(actions).toEqual(['refresh'])
    expect(el.querySelector('.header-actions-menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    trigger.click()
    await settle(el)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle(el)
    expect(el.querySelector('.header-actions-menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('renders the Garden-style grouped model picker and emits model-change intents before lock', async () => {
    const el = mount()
    const selected: string[] = []
    el.models = [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
      { id: 'kimi-k2.5', label: 'kimi-k2.5' },
      { id: 'qwen3-coder', label: 'Qwen3 Coder' },
    ]
    el.currentModel = 'gpt-5.2'
    el.onModelChange = (modelId) => {
      selected.push(modelId)
    }
    await settle(el)

    const trigger = el.querySelector('.model-selector-trigger') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger.disabled).toBe(false)
    expect(trigger.textContent?.replace(/\s+/g, ' ').trim()).toBe('GPT-5.2 v')

    trigger.click()
    await settle(el)

    const providers = Array.from(el.querySelectorAll('.model-picker-provider')) as HTMLButtonElement[]
    expect(providers.map((provider) => provider.textContent?.trim())).toEqual([
      'Anthropic',
      'OpenAI',
      'Google',
      'Moonshot',
      'Other',
    ])
    expect(providers[1].classList.contains('active')).toBe(true)
    expect(providers[1].classList.contains('has-selection')).toBe(true)

    providers[0].click()
    await settle(el)
    const models = Array.from(el.querySelectorAll('.model-picker-model')) as HTMLButtonElement[]
    expect(models.map((model) => model.textContent?.trim())).toEqual(['Claude Sonnet 4.6'])

    models[0].click()
    await Promise.resolve()
    await settle(el)

    expect(selected).toEqual(['claude-sonnet-4-6'])
    expect(el.querySelector('.model-picker')).toBeNull()
  })

  it('presents model choice as a modal sheet with a single semantic list and trapped focus', async () => {
    const previousWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const el = mount()
    el.models = [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
    ]
    el.currentModel = 'gpt-5.2'
    await settle(el)

    const trigger = el.querySelector('.model-selector-trigger') as HTMLButtonElement
    trigger.click()
    await settle(el)

    const sheet = el.querySelector('.model-picker-sheet') as HTMLElement
    expect(sheet.getAttribute('role')).toBe('dialog')
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(el.querySelector('.model-picker-backdrop')).not.toBeNull()
    expect(sheet.querySelector('.model-picker-models')?.getAttribute('role')).toBe('listbox')
    expect(sheet.querySelectorAll('[role="option"]')).toHaveLength(1)

    const close = sheet.querySelector('.model-picker-close') as HTMLButtonElement
    const model = sheet.querySelector('[data-model-id]') as HTMLButtonElement
    model.focus()
    model.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(close)

    close.click()
    await settle(el)
    expect(el.querySelector('.model-picker-sheet')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth })
  })

  it('uses Garden display-name overrides in the pure model picker', async () => {
    const el = mount()
    el.models = [{ id: 'kimi-k2.5', label: 'kimi-k2.5' }]
    el.currentModel = 'kimi-k2.5'
    await settle(el)

    const trigger = el.querySelector('.model-selector-trigger') as HTMLButtonElement
    expect(trigger.textContent?.replace(/\s+/g, ' ').trim()).toBe('Kimi K2.5 Thinking v')
  })

  it('locks the model picker after messages exist so mid-conversation switching cannot fire', async () => {
    const el = mount()
    const selected: string[] = []
    el.models = [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
    ]
    el.currentModel = 'gpt-5.2'
    el.messages = [assistantMsg({ id: 'mLocked' })]
    el.onModelChange = (modelId) => {
      selected.push(modelId)
    }
    await settle(el)

    const trigger = el.querySelector('.model-selector-trigger') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.classList.contains('locked')).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    trigger.click()
    await settle(el)

    expect(el.querySelector('.model-picker')).toBeNull()
    expect(selected).toEqual([])
  })

  it('dismisses the model picker on outside pointer/Escape and supports two-column arrow navigation', async () => {
    const el = mount()
    el.models = [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
    ]
    el.currentModel = 'gpt-5.2'
    await settle(el)

    const trigger = el.querySelector('.model-selector-trigger') as HTMLButtonElement
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await settle(el)
    expect(el.querySelector('.model-picker')).not.toBeNull()
    expect((document.activeElement as HTMLElement)?.dataset.modelProvider).toBe('OpenAI')

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect((document.activeElement as HTMLElement)?.dataset.modelId).toBe('gpt-5.2')

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle(el)
    expect(el.querySelector('.model-picker')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    trigger.click()
    await settle(el)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    await settle(el)
    expect(el.querySelector('.model-picker')).toBeNull()
  })

  it('renders Garden-style empty suggestions and uses one as an editable draft', async () => {
    const el = mount()
    const sent: string[] = []
    el.onSend = (text) => sent.push(text)
    await settle(el)

    expect(el.querySelector('.empty-eyebrow')?.textContent).toBe('A conversation with Sophia')
    expect(el.querySelector('.empty-title')?.textContent).toBe('What are you thinking about?')
    const buttons = Array.from(el.querySelectorAll('.suggestion-btn')) as HTMLButtonElement[]
    expect(buttons.map((btn) => btn.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '✎ ...help you write',
      '⌁ ...find what connects to this',
      '▤ ...summarize this document',
      '◎ ...map your workspace',
      '✦ ...explain how Garden works',
    ])

    buttons[2].click()
    await settle(el)
    await Promise.resolve()

    const hoja = composer(el)
    expect(hoja.value).toBe('Can you read this document and give me a summary of the key points?')
    expect(document.activeElement).toBe(composerInput(el))
    expect(sent).toEqual([])
  })

  it('lets hosts project specialized empty-state prompt starters without forking chat', async () => {
    const el = mount()
    const used: ChatEmptySuggestion[] = []
    el.emptyIcon = '⌕'
    el.emptyTitle = 'Start a research service run'
    el.emptyDescription = 'Choose a starting posture.'
    el.emptySuggestions = [
      {
        id: 'survey',
        icon: '◎',
        label: 'Survey a literature',
        prompt: 'Survey recent work on agent-native knowledge graphs.',
      },
      {
        id: 'compare',
        icon: '⇄',
        label: 'Compare sources',
        prompt: 'Compare these sources and identify the real disagreement.',
      },
    ]
    el.onSuggestionUse = (suggestion) => {
      used.push(suggestion)
    }
    await settle(el)

    expect(el.querySelector('.empty-icon')?.textContent).toBe('⌕')
    expect(el.querySelector('.empty-title')?.textContent).toBe('Start a research service run')
    expect(el.querySelector('.empty-description')?.textContent).toBe('Choose a starting posture.')

    const buttons = Array.from(el.querySelectorAll('.suggestion-btn')) as HTMLButtonElement[]
    expect(buttons.map((btn) => btn.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '◎ Survey a literature',
      '⇄ Compare sources',
    ])

    buttons[0].click()
    await settle(el)
    await Promise.resolve()

    expect(composer(el).value).toBe('Survey recent work on agent-native knowledge graphs.')
    expect(used.map((suggestion) => suggestion.id)).toEqual(['survey'])
  })

  it('renders controlled composer option groups and emits host-owned changes', async () => {
    const el = mount()
    const changes: ChatComposerControlChangeDetail[] = []
    el.assistantLabel = 'SRS'
    el.sessionTitle = 'Paper trail'
    el.composerPlaceholder = 'Ask SRS to investigate...'
    el.composerControls = [
      {
        id: 'depth',
        label: 'Depth',
        value: 'standard',
        options: [
          { id: 'quick', label: 'Quick' },
          { id: 'standard', label: 'Standard' },
          { id: 'deep', label: 'Deep', description: 'Spend more time gathering sources.' },
        ],
      },
    ]
    el.onComposerControlChange = (detail) => {
      changes.push(detail)
    }
    await settle(el)

    expect(el.querySelector('.super-bar-sophia')?.textContent).toBe('SRS')
    expect(el.querySelector('.super-bar-chat-title')?.textContent).toBe('Paper trail')
    expect(composer(el).placeholder).toBe('Ask SRS to investigate...')

    const group = el.querySelector('.composer-control-group[data-control-id="depth"]')
    expect(group?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Depth Quick Standard Deep')

    const options = Array.from(el.querySelectorAll('.composer-control-option')) as HTMLButtonElement[]
    expect(options.map((option) => option.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])

    options[2].click()
    await Promise.resolve()

    expect(changes).toHaveLength(1)
    expect(changes[0].controlId).toBe('depth')
    expect(changes[0].value).toBe('deep')
    expect(changes[0].option.description).toBe('Spend more time gathering sources.')
    // Controlled invariant: the kernel emits the intent; the host owns the value update.
    expect(el.composerControls[0].value).toBe('standard')
  })

  it('renders compose-mode prompt cards that reuse the main composer draft seam', async () => {
    const el = mount()
    const used: ChatPromptOptionUseDetail[] = []
    el.promptCards = [
      {
        id: 'starting-point',
        header: 'Starting point',
        question: 'Where should the investigation begin?',
        mode: 'compose',
        options: [
          {
            id: 'literature-review',
            label: 'Literature review',
            description: 'Survey the field and surface disagreements.',
            compose: 'I want a rigorous literature review on [topic].',
          },
          {
            id: 'weigh-evidence',
            label: 'Weigh evidence',
            description: 'Compare two options with explicit tradeoffs.',
            compose: 'Compare [option A] and [option B].',
          },
        ],
      },
    ]
    el.onPromptOptionUse = (detail) => {
      used.push(detail)
    }
    await settle(el)

    expect(el.querySelector('.prompt-card-kicker')?.textContent).toBe('Starting point')
    expect(el.querySelector('.prompt-card-question')?.textContent).toBe('Where should the investigation begin?')

    const option = el.querySelector<HTMLButtonElement>('[data-prompt-option="literature-review"]')!
    option.click()
    await settle(el)
    await Promise.resolve()

    expect(composer(el).value).toBe('I want a rigorous literature review on [topic].')
    expect(used.map((detail) => detail.promptId)).toEqual(['starting-point'])
    expect(used[0].value).toBe('I want a rigorous literature review on [topic].')
  })

  it('renders collect-mode prompt cards and emits answer summaries without owning removal', async () => {
    const el = mount()
    const submitted: ChatPromptSubmitDetail[] = []
    el.promptCards = [
      {
        id: 'calibration',
        header: 'Calibration',
        question: 'What should the research optimize for?',
        mode: 'collect',
        multi: true,
        freeformPlaceholder: 'Add a constraint...',
        submitLabel: 'Use these',
        options: [
          { id: 'recent', label: 'Recent sources', compose: 'Skew recent.' },
          { id: 'citation', label: 'Citable', compose: 'Prioritize precise citations.' },
        ],
      },
    ]
    el.onPromptSubmit = (detail) => {
      submitted.push(detail)
    }
    await settle(el)

    const recent = el.querySelector<HTMLButtonElement>('[data-prompt-option="recent"]')!
    const citation = el.querySelector<HTMLButtonElement>('[data-prompt-option="citation"]')!
    recent.click()
    citation.click()
    await settle(el)
    expect(recent.getAttribute('aria-pressed')).toBe('true')
    expect(citation.getAttribute('aria-pressed')).toBe('true')

    const freeform = el.querySelector<HTMLTextAreaElement>('.prompt-freeform-input')!
    freeform.value = 'Prefer primary sources.'
    freeform.dispatchEvent(new Event('input', { bubbles: true }))
    await settle(el)

    const submit = el.querySelector<HTMLButtonElement>('.prompt-submit')!
    expect(submit.disabled).toBe(false)
    submit.click()
    await Promise.resolve()

    expect(submitted).toHaveLength(1)
    expect(submitted[0].promptId).toBe('calibration')
    expect(submitted[0].answers).toEqual([
      'Skew recent.',
      'Prioritize precise citations.',
      'Prefer primary sources.',
    ])
    expect(submitted[0].summary).toBe(
      'Skew recent. Prioritize precise citations. Prefer primary sources.',
    )
    // Controlled invariant: the kernel emits the answers; the host owns prompt removal.
    expect(el.promptCards).toHaveLength(1)
  })

  it('accepts a host-projected draft and emits changes without owning persistence', async () => {
    const el = mount()
    const draftChanges: string[] = []
    el.draft = 'restored unsent text'
    el.onDraftChange = (draft) => draftChanges.push(draft)
    await settle(el)

    expect(composer(el).value).toBe('restored unsent text')
    expect(draftChanges).toEqual([])

    await editComposer(el, 'edited unsent text')

    expect(draftChanges).toEqual(['edited unsent text'])
  })

  it('fires onSend with the typed text on Enter and clears the draft', async () => {
    const el = mount()
    const sent: string[] = []
    const draftChanges: string[] = []
    el.onSend = (text) => sent.push(text)
    el.onDraftChange = (draft) => draftChanges.push(draft)
    await settle(el)

    // Drive the controlled Hoja change seam, then a real Enter keydown through
    // its actual ProseMirror surface.
    await editComposer(el, 'borges wrote the garden')
    composerInput(el).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await settle(el)

    expect(sent).toEqual(['borges wrote the garden'])
    expect(draftChanges).toEqual(['borges wrote the garden', ''])
    // Draft cleared after send.
    expect(composer(el).value).toBe('')
  })

  it('Shift+Enter does NOT send (newline)', async () => {
    const el = mount()
    const sent: string[] = []
    el.onSend = (text) => sent.push(text)
    await settle(el)

    await editComposer(el, 'line one')
    composerInput(el).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
    }))
    await settle(el)

    expect(sent).toEqual([])
  })

  it('uses one persistent Hoja scroller with a viewport-relative growth clamp', async () => {
    const el = mount()
    await settle(el)

    const hoja = composer(el)
    const input = composerInput(el)
    await editComposer(el, 'line one\nline two\nline three')
    expect(composer(el)).toBe(hoja)
    expect(composerInput(el)).toBe(input)
    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain('--hoja-composer-max-block-size: min(32dvh, 11.25rem)')
  })

  it('does NOT send when the host gates via sendDisabled', async () => {
    const el = mount()
    const sent: string[] = []
    el.onSend = (text) => sent.push(text)
    el.sendDisabled = true
    await settle(el)

    el.draft = 'should not send'
    await settle(el)
    composerInput(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle(el)

    expect(sent).toEqual([])
  })

  it('keeps the same Hoja and ProseMirror focused when clear empties the draft', async () => {
    const el = mount()
    await settle(el)

    const hoja = composer(el)
    const input = composerInput(el)
    await editComposer(el, 'expanded draft')
    ;(el.querySelector('.clear-button') as HTMLButtonElement).click()
    await settle(el)
    await Promise.resolve()

    expect(composer(el)).toBe(hoja)
    expect(composerInput(el)).toBe(input)
    expect(hoja.value).toBe('')
    expect(document.activeElement).toBe(input)
  })

  it('shows a Garden-style clear button only for non-empty drafts and clears without sending', async () => {
    const el = mount()
    const sent: string[] = []
    el.onSend = (text) => sent.push(text)
    await settle(el)

    expect(el.querySelector('.clear-button')).toBeNull()

    await editComposer(el, 'draft text')

    const clear = el.querySelector('.clear-button') as HTMLButtonElement
    expect(clear).not.toBeNull()
    expect(clear.getAttribute('aria-label')).toBe('Clear message')

    clear.click()
    await settle(el)

    expect(sent).toEqual([])
    expect(composer(el).value).toBe('')
    expect(el.querySelector('.clear-button')).toBeNull()
  })
})

describe('<sh-chat-panel> read-only is a HOST boolean, NOT inferred from the error string', () => {
  it('disables the composer + shows the read-only placeholder when readOnly=true (NO error set)', async () => {
    const el = mount()
    const actions: unknown[] = []
    el.readOnly = true
    el.onSessionAction = action => { actions.push(action) }
    // CRUCIALLY: no error string is set — the kernel no longer infers read-only
    // from `error.includes('read-only')`. The boolean alone drives it.
    expect(el.error).toBeNull()
    await settle(el)

    const hoja = composer(el)
    expect(hoja.disabled).toBe(true)
    expect(hoja.readOnly).toBe(true)
    expect(hoja.placeholder).toBe('This chat is read-only.')
    expect(el.querySelector('.connection-banner.readonly')?.textContent).toContain('This chat is read-only.')
    ;(el.querySelector('.banner-action') as HTMLButtonElement).click()
    expect(actions).toEqual([{ type: 'new' }])
  })

  it('does NOT go read-only when the error string merely contains "read-only" (no longer parsed)', async () => {
    const el = mount()
    el.error = 'This session is read-only because it expired.'
    await settle(el)

    // The error renders (banner), but the composer is NOT read-only-gated by it.
    expect(composer(el).disabled).toBe(false)
    expect(composer(el).placeholder).toBe('Press Enter to send')
  })
})

describe('<sh-chat-panel> controlled continuity states', () => {
  it('shows honest reconnecting/offline state without replacing the transcript or composer', async () => {
    const el = mount()
    const actions: unknown[] = []
    el.messages = [assistantMsg({ id: 'kept-message', content: 'Still here' })]
    el.draft = 'unfinished thought'
    el.onContinuityAction = action => { actions.push(action) }
    await settle(el)

    const message = el.querySelector('.message')
    const hoja = composer(el)
    const input = composerInput(el)

    el.connectionState = 'reconnecting'
    await settle(el)

    const reconnecting = el.querySelector('.connection-banner.continuity') as HTMLElement
    expect(reconnecting.dataset.state).toBe('reconnecting')
    expect(reconnecting.dataset.progress).toBe('true')
    expect(reconnecting.getAttribute('role')).toBe('status')
    expect(reconnecting.getAttribute('aria-busy')).toBe('true')
    expect(reconnecting.textContent).toContain('Your conversation is still here.')
    expect(el.querySelector('.message')).toBe(message)
    expect(composer(el)).toBe(hoja)
    expect(composerInput(el)).toBe(input)
    expect(hoja.value).toBe('unfinished thought')
    expect(hoja.disabled).toBe(true)

    el.connectionState = 'offline'
    await settle(el)

    const offline = el.querySelector('.connection-banner.continuity') as HTMLElement
    expect(offline.dataset.state).toBe('offline')
    expect(offline.textContent).toContain('You’re offline.')
    expect(hoja.placeholder).toBe('Reconnect to send a message.')
    ;(offline.querySelector('.banner-action') as HTMLButtonElement).click()
    expect(actions).toEqual([{ type: 'retry-connection' }])
    expect(el.querySelector('.message')).toBe(message)
    expect(composer(el)).toBe(hoja)
  })

  it('uses a quiet loading skeleton only before the first conversation is available', async () => {
    const el = mount()
    el.conversationState = 'loading'
    await settle(el)

    expect(el.querySelector('.connection-banner[data-state="loading"]')?.textContent).toContain('Opening your saved messages.')
    expect(el.querySelector('.conversation-loading')).not.toBeNull()
    expect(el.querySelector('.empty-suggestions')).toBeNull()
    expect(composer(el).disabled).toBe(true)
    expect(el.querySelector('.composer-hint')?.textContent).toBe('Available when the conversation is ready')

    el.messages = [assistantMsg({ id: 'loaded' })]
    await settle(el)
    expect(el.querySelector('.conversation-loading')).toBeNull()
    expect(el.querySelector('.message')).not.toBeNull()
  })

  it('renders conversation-load errors with a typed retry intent and keeps legacy errors compatible', async () => {
    const el = mount()
    const actions: unknown[] = []
    el.conversationState = 'error'
    el.error = 'The relay did not answer.'
    el.onContinuityAction = action => { actions.push(action) }
    await settle(el)

    const error = el.querySelector('.connection-banner[data-state="error"]') as HTMLElement
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.getAttribute('aria-live')).toBe('assertive')
    expect(error.textContent).toContain('The relay did not answer.')
    ;(error.querySelector('.banner-action') as HTMLButtonElement).click()
    expect(actions).toEqual([{ type: 'retry-load' }])

    el.conversationState = 'ready'
    await settle(el)
    expect(el.querySelector('.connection-banner.error')?.textContent).toContain('The relay did not answer.')
  })

  it('surfaces saving and failed delivery beside the same composer, then emits retry-send', async () => {
    const el = mount()
    const sent: string[] = []
    const actions: unknown[] = []
    el.draft = 'next message'
    el.onSend = text => { sent.push(text) }
    el.onContinuityAction = action => { actions.push(action) }
    await settle(el)

    const hoja = composer(el)
    el.sendState = 'saving'
    await settle(el)

    const saving = el.querySelector('.send-continuity') as HTMLElement
    expect(saving.dataset.state).toBe('saving')
    expect(saving.getAttribute('aria-busy')).toBe('true')
    expect(saving.textContent).toContain('Sending message…')
    expect(el.querySelector('.composer-hint')?.textContent).toBe('Sending…')
    expect(hoja.disabled).toBe(true)
    expect(hoja.value).toBe('next message')
    composerInput(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(sent).toEqual([])

    el.sendState = 'error'
    el.sendRecovery = 'resubmit'
    el.sendError = 'Delivery timed out.'
    await settle(el)

    const failed = el.querySelector('.send-continuity.error') as HTMLElement
    expect(failed.getAttribute('role')).toBe('alert')
    expect(failed.textContent).toContain('Delivery timed out.')
    expect(composer(el)).toBe(hoja)
    expect(hoja.disabled).toBe(false)
    expect(hoja.value).toBe('next message')
    ;(failed.querySelector('.send-retry') as HTMLButtonElement).click()
    expect(actions).toEqual([{ type: 'retry-send' }])
  })

  it('keeps an ambiguous draft and transcript in place and emits reconcile-turn, never retry-send', async () => {
    const el = mount()
    const actions: unknown[] = []
    el.messages = [assistantMsg({ id: 'kept-message', content: 'Still here' })]
    el.draft = 'possibly accepted message'
    el.sendState = 'uncertain'
    el.sendRecovery = 'reconcile'
    el.sendError = 'The response ended before message status was confirmed.'
    el.onContinuityAction = action => { actions.push(action) }
    await settle(el)

    const message = el.querySelector('.message')
    const hoja = composer(el)
    const uncertain = el.querySelector('.send-continuity.uncertain') as HTMLElement
    expect(uncertain.getAttribute('role')).toBe('alert')
    expect(uncertain.textContent).toContain('message status was confirmed')
    expect(hoja.value).toBe('possibly accepted message')
    expect(hoja.disabled).toBe(true)
    expect(el.querySelector('.composer-hint')?.textContent).toBe('Check status before sending again')
    expect(el.querySelector('.message')).toBe(message)
    expect(uncertain.querySelector('.send-retry')?.textContent).toContain('Check status')

    ;(uncertain.querySelector('.send-retry') as HTMLButtonElement).click()
    expect(actions).toEqual([{ type: 'reconcile-turn' }])
  })

  it('mirrors the shared continuity vocabulary and compact reachable retry targets in CSS', () => {
    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain(".connection-banner:is(.offline, .reconnecting)")
    expect(css).toContain("[data-progress='true'] .continuity-indicator::after")
    expect(css).toContain('sh-chat-panel .send-retry')
    expect(css).toContain('min-height: var(--sh-chat-compact-target)')
    expect(css).toContain('@media (max-width: 1024px)')
    expect(css).toContain('min-height: var(--mn-touch-target-size, 48px)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('<sh-chat-panel> dark mode (theme prop, NOT a store)', () => {
  it('writes data-theme=dark on the host when theme=dark', async () => {
    const el = mount()
    el.theme = 'dark'
    await settle(el)
    expect(el.dataset.theme).toBe('dark')
    expect(el.getAttribute('data-theme')).toBe('dark')
  })

  it('writes data-theme=light when theme=light', async () => {
    const el = mount()
    el.theme = 'light'
    await settle(el)
    expect(el.dataset.theme).toBe('light')
  })
})

describe('<sh-chat-panel> prose sanitization is WIRED at BOTH prose sites', () => {
  // The END-TO-END DOMPurify-strips-the-payload proof requires jsdom (DOMPurify
  // degrades under happy-dom — see sanitize.test.ts's per-file @vitest-environment
  // jsdom note; the panel's Lit functional tests need happy-dom). That proof
  // lives in compose.test.ts (R6, jsdom). Here — under the panel's real happy-dom
  // render — we prove the seam is WIRED: a REAL recording sanitizer (a plain
  // function, NOT a vi.fn mock) is invoked at BOTH prose call sites, and the
  // code-fence literal path is NOT routed through it.

  it('invokes sanitize() on prose-only content (PROSE SITE A)', async () => {
    const el = mount()
    const seen: string[] = []
    // A real function the kernel calls — records inputs, returns them verbatim.
    el.sanitize = (h) => {
      seen.push(h)
      return h
    }
    el.messages = [assistantMsg({ content: 'just prose, no fence', parts: [] })]
    await settle(el)

    expect(seen.length).toBeGreaterThanOrEqual(1)
    // marked wrapped the prose — proving the value flowed marked.parse -> sanitize.
    expect(seen[0]).toContain('just prose')
  })

  it('invokes sanitize() on the per-part text path AND skips the code fence (PROSE SITE B)', async () => {
    const el = mount()
    const seen: string[] = []
    el.sanitize = (h) => {
      seen.push(h)
      return h
    }
    // A code fence forces the parts[] loop branch (PROSE SITE B): prose around a
    // fence. The prose runs through sanitize; the fence does NOT.
    el.messages = [
      assistantMsg({ content: 'before text ```js\nconst a=1\n``` after text', parts: [] }),
    ]
    await settle(el)

    // Both prose runs ('before text ' and ' after text') were sanitized. Lit may
    // repeat a pure render while the nested light-DOM Hoja finishes upgrading,
    // so this asserts path coverage rather than a render-count accident.
    expect(seen.length).toBeGreaterThanOrEqual(2)
    const all = seen.join('\n')
    expect(all).toContain('before text')
    expect(all).toContain('after text')
    // The code-fence SOURCE never entered the sanitizer (it is Lit-text-escaped,
    // not unsafeHTML'd) — double-processing it would re-open injection.
    expect(all).not.toContain('const a=1')

    // And the fence rendered as escaped literal text in a <pre><code>.
    const code = el.querySelector('.code-block pre code')
    expect(code).not.toBeNull()
    expect(code!.textContent).toContain('const a=1')
  })
})

describe('<sh-chat-panel> message-action seam', () => {
  it('renders a Garden-style message context menu and routes selections through pure seams', async () => {
    const el = mount()
    const actions: Array<[string, string]> = []
    const codeCopies: CodeCopyIntent[] = []
    el.onMessageAction = async (id, action) => {
      actions.push([id, action])
      return { defaultHandled: action === 'copy', error: null }
    }
    el.onCodeCopy = async (intent) => {
      codeCopies.push(intent)
    }
    el.messages = [
      assistantMsg({
        id: 'mMenu',
        content: 'before\n```ts\nconst menu = true\n```\nafter',
        parts: [],
      }),
    ]
    await settle(el)

    const article = el.querySelector('.message.assistant') as HTMLElement
    const firstOpen = article.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 42,
        clientY: 55,
      }),
    )
    await settle(el)

    expect(firstOpen).toBe(false)
    const menu = el.querySelector('.chat-message-menu') as HTMLElement
    expect(menu).not.toBeNull()
    expect(menu.getAttribute('role')).toBe('menu')
    expect(menu.getAttribute('style')).toContain('left:42px')
    const menuLabels = Array.from(menu.querySelectorAll('.chat-menu-item')).map((item) =>
      item.textContent?.replace(/\s+/g, ' ').trim(),
    )
    expect(menuLabels).toEqual([
      '⧉ Copy message',
      '▤ Copy as Markdown',
      '</> Copy code block',
      '✦ Save to Garden',
      '↻ Regenerate response',
    ])

    ;(menu.querySelectorAll('.chat-menu-item')[2] as HTMLButtonElement).click()
    await Promise.resolve()
    await settle(el)
    expect(codeCopies).toEqual([
      {
        messageId: 'mMenu',
        codeBlockId: 'mMenu-menu-code-0',
        code: 'const menu = true',
        lang: 'ts',
      },
    ])
    expect(el.querySelector('.chat-message-menu')).toBeNull()

    article.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle(el)
    ;(el.querySelectorAll('.chat-menu-item')[3] as HTMLButtonElement).click()
    await Promise.resolve()
    await settle(el)

    article.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle(el)
    ;(el.querySelectorAll('.chat-menu-item')[4] as HTMLButtonElement).click()
    await Promise.resolve()
    await settle(el)

    expect(actions).toEqual([
      ['mMenu', 'save-garden'],
      ['mMenu', 'regenerate'],
    ])
  })

  it('renders Garden-style message timestamps from createdAt in the meta row', async () => {
    const el = mount()
    const createdAt = Date.UTC(2026, 5, 23, 14, 5)
    el.messages = [assistantMsg({ id: 'mTime', createdAt })]
    await settle(el)

    const expected = new Date(createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
    const time = el.querySelector('.message-time')
    expect(time).not.toBeNull()
    expect(time!.textContent).toBe(expected)
  })

  it('renders Garden-style code copy buttons and emits pure code-copy intents', async () => {
    const el = mount()
    const copies: CodeCopyIntent[] = []
    el.onCodeCopy = async (intent) => {
      copies.push(intent)
    }
    el.messages = [
      assistantMsg({
        id: 'mCode',
        content: 'before\n```ts\nconst answer = 42\n```\nafter',
        parts: [],
      }),
    ]
    await settle(el)

    const btn = el.querySelector('.code-copy-btn') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-label')).toBe('Copy code')
    expect(btn.textContent).toContain('Copy')

    btn.click()
    await Promise.resolve()
    await settle(el)

    expect(copies).toEqual([
      {
        messageId: 'mCode',
        codeBlockId: 'mCode-body-code-0',
        code: 'const answer = 42',
        lang: 'ts',
      },
    ])
    const copied = el.querySelector('.code-copy-btn') as HTMLButtonElement
    expect(copied.classList.contains('copied')).toBe(true)
    expect(copied.getAttribute('aria-label')).toBe('Copied')
    expect(copied.textContent).toContain('Copied')
  })

  it('fires onMessageAction(copy) from the copy button', async () => {
    const el = mount()
    const actions: Array<[string, string]> = []
    el.onMessageAction = (id, action) => {
      actions.push([id, action])
    }
    el.messages = [assistantMsg({ id: 'mX' })]
    await settle(el)

    const btn = el.querySelector('.message-action-btn[aria-label="Copy message"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    btn.click()
    expect(actions).toEqual([['mX', 'copy']])
  })

  it('shows Garden-style copied message state only after the host reports copy success', async () => {
    const el = mount()
    el.onMessageAction = async (id, action) => {
      if (id === 'mCopy' && action === 'copy') return { defaultHandled: true, error: null }
      return undefined
    }
    el.messages = [assistantMsg({ id: 'mCopy' })]
    await settle(el)

    const btn = el.querySelector('.message-action-btn[aria-label="Copy message"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    btn.click()
    await Promise.resolve()
    await settle(el)
    await settle(el)

    const copied = el.querySelector('.message-action-btn[aria-label="Copied"]') as HTMLButtonElement
    expect(copied).not.toBeNull()
    expect(copied.classList.contains('copied')).toBe(true)
    expect(copied.textContent).toContain('✓')
    const toast = el.querySelector('.copy-toast')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toBe('Copied to clipboard')
  })
})

describe('<sh-chat-panel> prose + state legibility', () => {
  it('renders every markdown mark inside the .markdown-content prose scope', async () => {
    const el = mount()
    const prose = [
      'A [link](https://example.test) and `inline` code.',
      '',
      '- first',
      '- second',
      '',
      '> quoted',
    ].join('\n')
    el.messages = [assistantMsg({ content: prose, parts: [{ type: 'text', content: prose }] })]
    await settle(el)

    // The prose CSS keys off .markdown-content, so every mark must land inside
    // it — not loose in .message-content.
    const scope = el.querySelector('.markdown-content')
    expect(scope).not.toBeNull()
    expect(scope!.querySelector('a[href="https://example.test"]')).not.toBeNull()
    expect(scope!.querySelector('code')).not.toBeNull()
    expect(scope!.querySelectorAll('ul > li').length).toBe(2)
    expect(scope!.querySelector('blockquote')).not.toBeNull()
  })

  it('keeps the fenced code well OUTSIDE .markdown-content so it never nests a second box', async () => {
    const el = mount()
    const withFence = ['before', '', '```ts', 'const x = 1', '```', '', 'after'].join('\n')
    el.messages = [assistantMsg({ content: withFence, parts: [{ type: 'text', content: withFence }] })]
    await settle(el)

    const block = el.querySelector('.code-block')
    expect(block).not.toBeNull()
    // The load-bearing sibling invariant: .code-block owns its own well, and
    // .markdown-content's pre/code rules must never reach inside it.
    expect(el.querySelector('.markdown-content .code-block')).toBeNull()
    expect(block!.querySelector('pre > code')).not.toBeNull()
    expect(block!.querySelector('.code-lang-badge')!.textContent!.trim()).toBe('ts')

    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain('sh-chat-panel .code-block pre')
  })

  it('answers the streaming bubble class it has always emitted', async () => {
    const el = mount()
    el.messages = [assistantMsg({ content: 'partial', isStreaming: true })]
    await settle(el)

    const bubble = el.querySelector('.message.assistant .message-bubble')
    expect(bubble).not.toBeNull()
    expect(bubble!.classList.contains('streaming')).toBe(true)

    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain('sh-chat-panel .message.assistant .message-bubble.streaming')
  })

  it('gives the scroll affordance a directional glyph that is hidden from the accessible name', async () => {
    const el = mount()
    el.messages = [assistantMsg()]
    await settle(el)
    const container = el.querySelector('.messages-container') as HTMLElement
    setScrollMetrics(container, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    container.dispatchEvent(new Event('scroll'))
    await settle(el)

    const fab = el.querySelector('.scroll-to-bottom') as HTMLButtonElement
    expect(fab).not.toBeNull()
    expect(fab.getAttribute('aria-label')).toBe('Scroll to bottom')
    const glyph = fab.querySelector('[aria-hidden="true"]')
    expect(glyph).not.toBeNull()
    expect(glyph!.textContent!.trim()).toBe('↓')
  })

  it('renders a failed turn as a bounded alert field, not a loose red word', async () => {
    const el = mount()
    el.messages = [assistantMsg({ error: 'The turn did not complete.' })]
    await settle(el)

    const field = el.querySelector('.message-error')
    expect(field).not.toBeNull()
    expect(field!.getAttribute('role')).toBe('alert')
    expect(field!.textContent).toContain('The turn did not complete.')

    // Precisely: the .message-error rule itself must draw a field (border +
    // background), not merely colour the text.
    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    const rule = /sh-chat-panel \.message-error \{([^}]*)\}/.exec(css)
    expect(rule, 'expected a .message-error rule').not.toBeNull()
    expect(rule![1]).toContain('border:')
    expect(rule![1]).toContain('background:')
    expect(rule![1]).toContain('--mn-color-danger-surface')
  })

  it('keeps message actions in the DOM and only visually quiet on hover-capable pointers', async () => {
    const el = mount()
    el.onMessageAction = () => undefined
    el.messages = [assistantMsg({ id: 'mQuiet' })]
    await settle(el)

    // Reachability must not depend on hover: the buttons stay rendered and
    // focusable; only their opacity is conditional.
    expect(el.querySelectorAll('.message-actions .message-action-btn').length).toBe(3)

    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toContain('@media (hover: hover) and (pointer: fine)')
    expect(css).toContain('sh-chat-panel .message:focus-within .message-actions')
  })

  it('shows a focus ring on every keyboard-reachable chat control', async () => {
    const el = mount()
    el.messages = [
      assistantMsg({
        content: '',
        parts: [{ type: 'tool', toolCallId: 't1' }, { type: 'reasoning', content: 'because' }],
        toolCalls: [{ id: 't1', tool: 'search_documents', status: 'completed', input: null, output: 'r' }],
      }),
    ]
    await settle(el)

    // Both disclosure headers opt into keyboard focus by role+tabindex...
    const toolHeader = el.querySelector('.tool-call-header') as HTMLElement
    const reasoningHeader = el.querySelector('.reasoning-header') as HTMLElement
    expect(toolHeader.getAttribute('tabindex')).toBe('0')
    expect(reasoningHeader.getAttribute('tabindex')).toBe('0')

    // ...so both must answer :focus-visible, along with the primary controls.
    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    for (const selector of [
      'sh-chat-panel .message-action-btn:focus-visible',
      'sh-chat-panel .tool-call-header:focus-visible',
      'sh-chat-panel .reasoning-header:focus-visible',
      'sh-chat-panel .send-button:focus-visible',
      'sh-chat-panel .clear-button:focus-visible',
      'sh-chat-panel .banner-action:focus-visible',
    ]) {
      expect(css, `missing focus ring for ${selector}`).toContain(selector)
    }
  })
})
