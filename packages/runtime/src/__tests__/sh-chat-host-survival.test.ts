/**
 * sh-chat-host-survival.test.ts — the NO-MOCK mount-once + hydration proof (C3).
 *
 * The chat analog of sh-editor-host-branch-switch.test.ts: <sh-chat-host> mounts
 * ONCE and SURVIVES an interface-grow re-render (the whole point of the chat host —
 * grow_interface mutates the surrounding spine while the conversation + in-flight
 * stream + composer draft stay live) WITHOUT remount/blank/data-loss. Plus the two
 * C3.0 finding fixes proven structurally: session-switch HYDRATION (FIX 1) and a
 * SINGLE user-message-append owner (FIX 2).
 *
 * NO MOCKS: every function under test is production — the REAL local ChatService
 * (echo driver = a real ChatEvent producer), the REAL <sh-chat-panel> (real
 * projectEvents/finalize fold), the REAL <sh-chat-host> mounted through the REAL
 * mountChatHost keyed() helper into ONE connected container (so Lit reconciles,
 * never re-creates). The "in-flight" driver is a REAL controllable async generator
 * gated on a manually-resolved promise — a real iterable, not a vi.fn.
 *
 * HONEST CAVEAT: happy-dom has no layout engine; any pixel/positioning concern is
 * Playwright territory, DEFERRED. The survival/identity/hydration/streaming
 * SEMANTICS are all provable structurally in happy-dom over the real organism.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { html, render, nothing, type TemplateResult } from 'lit'
import type {
  ChatEvent,
  HojaComposerDetail,
  SurfaceActionIntent,
} from '@shrubbery/chat-kernel'
import {
  CHAT_CODE_COPY_EVENT,
  CHAT_HEADER_ACTION_EVENT,
  CHAT_MESSAGE_ACTION_EVENT,
  CHAT_SESSION_ACTION_EVENT,
  makeLocalChatService,
  mountChatHost,
  type ChatCodeCopyDetail,
  type ChatHeaderActionDetail,
  type ChatMessageActionDetail,
  type ChatPresentation,
  type ChatSessionActionDetail,
  type TurnDriver,
} from '../index.js'
import type { ShChatHost } from '../index.js'

const chatHost = (c: HTMLElement) => c.querySelector('#sh-chat-host') as ShChatHost | null
/** The live <sh-chat-panel> the host mounted imperatively (light-DOM element). */
const panelOf = (h: ShChatHost | null) => h?.panel ?? null
/** The rendered message bubbles in the panel's real light-DOM tree. */
const bubbles = (h: ShChatHost | null) =>
  Array.from(panelOf(h)?.querySelectorAll('.message') ?? [])
const userBubbles = (h: ShChatHost | null) =>
  Array.from(panelOf(h)?.querySelectorAll('.message.user') ?? [])
const assistantBubble = (h: ShChatHost | null) =>
  (panelOf(h)?.querySelector('.message.assistant') as HTMLElement | null) ?? null

/** A connected container so <sh-chat-host> upgrades + runs its update cycle. */
function connectedContainer(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  window.sessionStorage.clear()
})

/**
 * Render a workspace frame with the chat host at a FIXED FINAL template slot (the
 * mount-once placement rule), behind a variable-length `regions` array so an
 * interface-grow (adding a region) is a REAL re-render that shifts the array length
 * but NOT the keyed host index. `grow` adds a sibling region BEFORE the host.
 */
function renderFrame(
  container: HTMLElement,
  opts: {
    service: ReturnType<typeof makeLocalChatService>
    sessionId: string | null
    grow?: boolean
    onCodeCopy?: (detail: ChatCodeCopyDetail) => void
    onHeaderAction?: (detail: ChatHeaderActionDetail) => void
    onSessionAction?: (detail: ChatSessionActionDetail) => void
    onSurfaceAction?: (action: SurfaceActionIntent) => void
    onMessageAction?: (detail: ChatMessageActionDetail) => void
    presentation?: ChatPresentation
  },
): TemplateResult {
  const {
    service,
    sessionId,
    grow,
    onCodeCopy,
    onHeaderAction,
    onSessionAction,
    onSurfaceAction,
    onMessageAction,
    presentation,
  } = opts
  // The variable-length spine: interface-grow ADDS a region (length 1 → 2). The
  // host sits AFTER it, as the fixed-final ${} binding (mount.ts's placement rule).
  const regions: TemplateResult[] = [html`<div class="region" data-region="a">A</div>`]
  if (grow) regions.push(html`<div class="region" data-region="b">B (grown)</div>`)
  const tpl = html`
    <div class="main">
      ${regions}
      ${mountChatHost(service, sessionId, {
        onCodeCopy,
        onHeaderAction,
        onSessionAction,
        onSurfaceAction,
        onMessageAction,
        presentation,
      }) as unknown as typeof nothing}
    </div>
  `
  render(tpl, container)
  return tpl
}

/** Render + settle the host's update cycle + drain microtasks (the async hydrate +
 * the imperative panel mount + the async turn fold all need microtask drains). */
async function settle(container: HTMLElement): Promise<void> {
  const h = chatHost(container)
  if (!h) return
  await h.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

/** Wait until a predicate holds (the store notifies the panel async during a turn). */
async function until(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Drive a real turn through the panel's composer (the kernel's send path). */
function sendViaComposer(h: ShChatHost, text: string): void {
  const hoja = composerOf(h)
  const detail = composerDetail(text)
  hoja.onChange?.(detail)
  hoja.onSubmit?.(detail)
}

type TestHojaComposer = HTMLElement & {
  value: string
  onChange?: (detail: HojaComposerDetail) => void
  onSubmit?: (detail: HojaComposerDetail) => void
  updateComplete: Promise<boolean>
}

function composerDetail(value: string): HojaComposerDetail {
  const plainText = value.replace(/[*_`]/g, '')
  return {
    value,
    plainText,
    json: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        ...(plainText ? { content: [{ type: 'text', text: plainText }] } : {}),
      }],
    },
    references: [],
    isEmpty: plainText.trim().length === 0,
  }
}

function composerOf(h: ShChatHost): TestHojaComposer {
  return panelOf(h)!.querySelector('hoja-editor[posture="composer"]') as TestHojaComposer
}

async function typeDraft(h: ShChatHost, text: string): Promise<void> {
  const hoja = composerOf(h)
  hoja.onChange?.(composerDetail(text))
  await panelOf(h)!.updateComplete
  await hoja.updateComplete
}

describe('C3 — <sh-chat-host> mounts once + survives interface-grow + hydrates (no mocks)', () => {
  it('THEME CONTINUITY: follows the ambient root theme without remounting the live panel', async () => {
    document.documentElement.dataset.theme = 'light'
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 'theme continuity' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: s.id })
    await settle(container)
    const host = chatHost(container)!
    const panel = panelOf(host)!
    expect(panel.theme).toBe('light')

    document.documentElement.dataset.theme = 'dark'
    await until(() => panel.theme === 'dark')

    expect(chatHost(container)).toBe(host)
    expect(panelOf(host)).toBe(panel)
  })

  it('ROUND-TRIP: a real turn renders the user bubble + the echo assistant reply + tool pair', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 't' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: s.id })
    await settle(container)
    const h = chatHost(container)!
    expect(h).not.toBeNull()
    expect(panelOf(h)).not.toBeNull()

    sendViaComposer(h, 'hi')
    await until(() => bubbles(h).length >= 2)

    expect(userBubbles(h)[0]?.textContent).toContain('hi')
    expect(assistantBubble(h)?.textContent).toContain('You said: hi')
    // The tool_call/tool_result demo pair folded through the real projectEvents.
    await until(() => panelOf(h)!.querySelector('.tool-status-icon[data-status="completed"]') !== null)
    expect(panelOf(h)!.querySelector('.tool-call-name')?.textContent).toContain('echo.inspect')
  })

  it('SURVIVAL: an interface-grow re-render keeps the host + panel + conversation (no remount/blank)', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 't' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: s.id })
    await settle(container)
    const host0 = chatHost(container)!
    const panel0 = panelOf(host0)
    sendViaComposer(host0, 'before grow')
    await until(() => bubbles(host0).length >= 2)
    const msgCountBefore = bubbles(host0).length

    // THE ADVERSARIAL GATE: a REAL interface-grow re-render (a region appears,
    // mainBody length 1→2) into the SAME container.
    renderFrame(container, { service: svc, sessionId: s.id, grow: true })
    await settle(container)
    const host1 = chatHost(container)!

    // The grow actually happened (the new region is in the DOM).
    expect(container.querySelector('[data-region="b"]')).not.toBeNull()
    // PROOF: same host DOM node, same imperatively-mounted panel, conversation held.
    expect(host1).toBe(host0)
    expect(panelOf(host1)).toBe(panel0)
    expect(bubbles(host1).length).toBe(msgCountBefore)
    expect(userBubbles(host1)[0]?.textContent).toContain('before grow')
    expect(assistantBubble(host1)?.textContent).toContain('You said: before grow')
  })

  it('IN-FLIGHT SURVIVAL: a streaming turn survives an interface-grow + completes into the SAME panel', async () => {
    // A REAL controllable driver: it yields turn_start + one delta, then PAUSES on a
    // manually-resolved gate promise, then yields the rest + done. Not a mock — a real
    // async generator we drive deterministically.
    let releaseRest: () => void = () => {}
    const restGate = new Promise<void>((res) => {
      releaseRest = res
    })
    const gatedDriver: TurnDriver = async function* (userText: string): AsyncIterable<ChatEvent> {
      yield { type: 'turn_start', turn: 0 }
      yield { type: 'text', content: 'partial…' }
      await restGate // PAUSE mid-stream
      yield { type: 'text', content: ` done for ${userText}` }
      yield { type: 'done', output: `partial… done for ${userText}` }
    }
    const svc = makeLocalChatService({ turnDriver: gatedDriver })
    const s = await svc.createSession({ title: 't' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: s.id })
    await settle(container)
    const host0 = chatHost(container)!
    const panel0 = panelOf(host0)

    sendViaComposer(host0, 'X')
    // Let the first delta land — streaming is true, partial text rendered.
    await until(() => host0.store?.getState().streaming === true)
    await until(() => assistantBubble(host0)?.textContent?.includes('partial…') ?? false)
    expect(host0.store!.getState().streaming).toBe(true)

    // Interface-grow MID-STREAM.
    renderFrame(container, { service: svc, sessionId: s.id, grow: true })
    await settle(container)
    const host1 = chatHost(container)!
    expect(host1).toBe(host0)
    expect(panelOf(host1)).toBe(panel0)
    // Still streaming into the SAME panel after the grow.
    expect(host1.store!.getState().streaming).toBe(true)

    // Release the rest of the stream — it completes into the SAME panel.
    releaseRest()
    await until(() => host1.store?.getState().streaming === false)
    expect(assistantBubble(host1)?.textContent).toContain('done for X')
  })

  it('DRAFT SURVIVAL: a composer draft survives an interface-grow (not lost)', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 't' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: s.id })
    await settle(container)
    const host0 = chatHost(container)!
    const hoja0 = composerOf(host0)
    // Type a draft (do NOT send).
    await typeDraft(host0, 'an unsent draft')

    // Interface-grow.
    renderFrame(container, { service: svc, sessionId: s.id, grow: true })
    await settle(container)
    const host1 = chatHost(container)!
    expect(host1).toBe(host0)
    // The SAME panel survived → the composer draft is intact (the panel was never
    // re-created, so its private draft state held).
    const hoja1 = composerOf(host1)
    expect(hoja1).toBe(hoja0)
    expect(hoja1.value).toBe('an unsent draft')
  })

  it('DRAFT PERSISTENCE: per-session drafts persist with the Garden-compatible key', async () => {
    const svc = makeLocalChatService()
    const a = await svc.createSession({ title: 'A' })
    const b = await svc.createSession({ title: 'B' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)
    let h = chatHost(container)!
    await typeDraft(h, 'draft for A')

    expect(window.sessionStorage.getItem(`garden:chat:draft:${a.id}`)).toBe('draft for A')

    renderFrame(container, { service: svc, sessionId: b.id })
    await settle(container)
    h = chatHost(container)!
    expect(composerOf(h).value).toBe('')

    await typeDraft(h, 'draft for B')
    expect(window.sessionStorage.getItem(`garden:chat:draft:${b.id}`)).toBe('draft for B')

    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)
    h = chatHost(container)!
    expect(composerOf(h).value).toBe('draft for A')

    ;(panelOf(h)!.querySelector('.clear-button') as HTMLButtonElement).click()
    await panelOf(h)!.updateComplete
    expect(composerOf(h).value).toBe('')
    expect(window.sessionStorage.getItem(`garden:chat:draft:${a.id}`)).toBeNull()
    expect(window.sessionStorage.getItem(`garden:chat:draft:${b.id}`)).toBe('draft for B')
  })

  it('RICH DRAFT SIDECAR: restores marks and resolved wikilink identity beside canonical text', async () => {
    const svc = makeLocalChatService()
    const a = await svc.createSession({ title: 'Rich A' })
    const b = await svc.createSession({ title: 'Rich B' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)
    const host = chatHost(container)!
    const canonical = '**Read** [[Workspace B Only]]'
    const rich: HojaComposerDetail = {
      value: canonical,
      plainText: 'Read [[Workspace B Only]]',
      json: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            {
              type: 'wikilink',
              attrs: {
                label: 'Workspace B Only',
                targetDocId: 'workspace-b-note',
                targetGraphId: 'browser-harness-b',
                targetBlockId: null,
                blockPreview: 'Document',
              },
            },
          ],
        }],
      },
      references: [{
        label: 'Workspace B Only',
        targetDocId: 'workspace-b-note',
        targetGraphId: 'browser-harness-b',
        targetBlockId: null,
        blockPreview: 'Document',
      }],
      isEmpty: false,
    }
    composerOf(host).onChange?.(rich)
    await panelOf(host)!.updateComplete

    expect(window.sessionStorage.getItem(`garden:chat:draft:${a.id}`)).toBe(canonical)
    expect(JSON.parse(
      window.sessionStorage.getItem(`garden:chat:draft:hoja:v1:${a.id}`)!,
    ).references[0]).toMatchObject({
      targetDocId: 'workspace-b-note',
      targetGraphId: 'browser-harness-b',
    })

    renderFrame(container, { service: svc, sessionId: b.id })
    await settle(container)
    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)

    expect(chatHost(container)).toBe(host)
    expect(composerOf(host).value).toBe(canonical)
    expect(panelOf(host)!.draftDetail?.references[0]).toMatchObject({
      label: 'Workspace B Only',
      targetDocId: 'workspace-b-note',
      targetGraphId: 'browser-harness-b',
    })
  })

  it('SESSION-SWITCH HYDRATION (FIX 1): switching back to a prior session re-shows its conversation', async () => {
    const svc = makeLocalChatService()
    const a = await svc.createSession({ title: 'A' })
    const b = await svc.createSession({ title: 'B' })
    const container = connectedContainer()

    // Session A — run a turn so it has messages.
    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)
    let h = chatHost(container)!
    sendViaComposer(h, 'in A')
    await until(() => bubbles(h).length >= 2)
    expect(assistantBubble(h)?.textContent).toContain('You said: in A')

    // Switch to B (prop change) — run a different turn.
    renderFrame(container, { service: svc, sessionId: b.id })
    await settle(container)
    h = chatHost(container)!
    // B started blank (hydrate of an empty session).
    await until(() => bubbles(h).length === 0 || assistantBubble(h) === null)
    sendViaComposer(h, 'in B')
    await until(() => assistantBubble(h)?.textContent?.includes('You said: in B') ?? false)

    // Switch BACK to A — FIX 1: A's prior conversation RE-HYDRATES (not blank).
    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)
    h = chatHost(container)!
    await until(() => assistantBubble(h)?.textContent?.includes('You said: in A') ?? false)
    expect(userBubbles(h)[0]?.textContent).toContain('in A')
    expect(assistantBubble(h)?.textContent).not.toContain('in B')
  })

  it('SESSION-SWITCH STALE GUARD (FIX 1): a fast A→B→A switch renders only the last switch', async () => {
    const svc = makeLocalChatService()
    const a = await svc.createSession({ title: 'A' })
    const b = await svc.createSession({ title: 'B' })
    const container = connectedContainer()

    // Seed both sessions with distinct turns via the host on each.
    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)
    sendViaComposer(chatHost(container)!, 'msg A')
    await until(() => assistantBubble(chatHost(container))?.textContent?.includes('msg A') ?? false)

    renderFrame(container, { service: svc, sessionId: b.id })
    await settle(container)
    sendViaComposer(chatHost(container)!, 'msg B')
    await until(() => assistantBubble(chatHost(container))?.textContent?.includes('msg B') ?? false)

    // Fast switch A→B→A WITHOUT settling between — the store's monotonic token must
    // ensure only the last (A) hydrate wins.
    const store = chatHost(container)!.store!
    store.setSession(a.id)
    store.setSession(b.id)
    store.setSession(a.id)
    await until(() => store.getState().messages.some((m) => m.content.includes('msg A')))
    // The last switch was A → A's messages render, NOT B's.
    expect(store.getState().messages.some((m) => m.content.includes('msg A'))).toBe(true)
    expect(store.getState().messages.some((m) => m.content.includes('msg B'))).toBe(false)
  })

  it('SESSION HISTORY DRAWER: lists, selects, renames, and deletes real service sessions without remounting chat', async () => {
    const svc = makeLocalChatService()
    const a = await svc.createSession({ title: 'Alpha' })
    const b = await svc.createSession({ title: 'Beta' })
    const c = await svc.createSession({ title: 'Gamma' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: a.id })
    await settle(container)
    const host0 = chatHost(container)!
    const panel0 = panelOf(host0)
    expect(panel0?.querySelector('.super-bar-chat-title')?.textContent).toBe('Alpha')
    expect(typeof panel0?.onSessionAction).toBe('function')

    await panel0!.onSessionAction?.({ type: 'open-history' })
    await until(() => host0.shadowRoot!.querySelector('[data-chat-history-drawer]') !== null)
    await settle(container)

    const drawer = host0.shadowRoot!.querySelector('[data-chat-history-drawer]')
    expect(drawer).not.toBeNull()
    const rowText = Array.from(host0.shadowRoot!.querySelectorAll('[data-chat-history-row]')).map(
      (row) => row.textContent ?? '',
    )
    expect(rowText.join('|')).toContain('Alpha')
    expect(rowText.join('|')).toContain('Beta')
    expect(rowText.join('|')).toContain('Gamma')

    ;(host0.shadowRoot!.querySelector(`[data-chat-history-select="${b.id}"]`) as HTMLButtonElement).click()
    await until(() => host0.store?.getState().sessionId === b.id)
    await settle(container)

    expect(host0.shadowRoot!.querySelector('[data-chat-history-drawer]')).toBeNull()
    expect(panelOf(host0)).toBe(panel0)
    await until(() => panelOf(host0)?.querySelector('.super-bar-chat-title')?.textContent === 'Beta')

    await panel0!.onSessionAction?.({ type: 'open-history' })
    await until(() => host0.shadowRoot!.querySelector('[data-chat-history-drawer]') !== null)
    await settle(container)
    ;(host0.shadowRoot!.querySelector(`[data-chat-history-rename="${b.id}"]`) as HTMLButtonElement).click()
    await settle(container)
    const input = host0.shadowRoot!.querySelector('[data-chat-history-rename-input]') as HTMLInputElement
    input.value = 'Renamed Beta'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    ;(host0.shadowRoot!.querySelector('[data-chat-history-rename-save]') as HTMLButtonElement).click()
    await until(() => panelOf(host0)?.querySelector('.super-bar-chat-title')?.textContent === 'Renamed Beta')
    expect((await svc.hydrateSession(b.id)).session.title).toBe('Renamed Beta')

    ;(host0.shadowRoot!.querySelector(`[data-chat-history-delete="${c.id}"]`) as HTMLButtonElement).click()
    await settle(container)
    await expect(svc.hydrateSession(c.id)).rejects.toThrow(`InProcessChatStore: no session ${c.id}`)
    const remainingText = Array.from(host0.shadowRoot!.querySelectorAll('[data-chat-history-row]')).map(
      (row) => row.textContent ?? '',
    )
    expect(remainingText.join('|')).not.toContain('Gamma')
    expect(panelOf(host0)).toBe(panel0)
  })

  it('SESSION CHROME KEYBOARD: traps the drawer, closes on Escape with focus return, and creates a new active chat', async () => {
    const svc = makeLocalChatService()
    const initial = await svc.createSession({ title: 'Initial' })
    const container = connectedContainer()
    renderFrame(container, { service: svc, sessionId: initial.id })
    await settle(container)

    const host = chatHost(container)!
    const panel = panelOf(host)!
    const opener = panel.querySelector('.super-bar-identity') as HTMLButtonElement
    opener.focus()
    opener.click()
    await until(() => host.shadowRoot!.querySelector('[data-chat-history-drawer]') !== null)
    await settle(container)

    const drawer = host.shadowRoot!.querySelector('[data-chat-history-drawer]') as HTMLElement
    expect(host.shadowRoot!.activeElement).toBe(drawer)
    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    await settle(container)
    expect(host.shadowRoot!.querySelector('[data-chat-history-drawer]')).toBeNull()
    expect(host.shadowRoot!.activeElement).toBe(opener)

    const panelIdentity = panelOf(host)
    await panel.onSessionAction?.({ type: 'new' })
    await until(() => host.store?.getState().sessionId !== initial.id)
    expect(host.store?.getState().sessionId).toBeTruthy()
    expect(panelOf(host)).toBe(panelIdentity)
  })

  it('SINGLE-APPEND OWNER (FIX 2): the live user-message id EQUALS hydrateSession’s, exactly one bubble', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 't' })
    const container = connectedContainer()

    renderFrame(container, { service: svc, sessionId: s.id })
    await settle(container)
    const h = chatHost(container)!
    sendViaComposer(h, 'unique text')
    await until(() => assistantBubble(h)?.textContent?.includes('You said: unique text') ?? false)

    // The live projector's user message id.
    const liveUserMsgs = h.store!.getState().messages.filter((m) => m.role === 'user')
    expect(liveUserMsgs.length).toBe(1) // exactly ONE bubble (no double-append)
    const liveId = liveUserMsgs[0].id

    // The service's persisted user message id (hydrateSession).
    const { messages: persisted } = await svc.hydrateSession(s.id)
    const persistedUserMsgs = persisted.filter((m) => m.role === 'user')
    expect(persistedUserMsgs.length).toBe(1)

    // FIX 2 PROOF: ONE owner → the live id EQUALS the persisted id (pre-fix this
    // FAILED: the store minted uuid A while the service minted uuid B).
    expect(liveId).toBe(persistedUserMsgs[0].id)
  })

  it('MESSAGE ACTION: copy uses the host clipboard seam and emits composed action detail', async () => {
    const previousClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
    const writes: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          writes.push(text)
        },
      },
    })

    try {
      const svc = makeLocalChatService()
      const s = await svc.createSession({ title: 'message-actions' })
      const container = connectedContainer()

      let callbackDetail: ChatMessageActionDetail | null = null
      let eventDetail: ChatMessageActionDetail | null = null
      container.addEventListener(
        CHAT_MESSAGE_ACTION_EVENT,
        ((event: CustomEvent<ChatMessageActionDetail>) => {
          eventDetail = event.detail
        }) as EventListener,
      )

      renderFrame(container, {
        service: svc,
        sessionId: s.id,
        onMessageAction: (detail) => {
          callbackDetail = detail
        },
      })
      await settle(container)
      const h = chatHost(container)!

      sendViaComposer(h, 'copy me')
      await until(() => assistantBubble(h)?.textContent?.includes('You said: copy me') ?? false)
      const assistant = h.store!.getState().messages.find((msg) => msg.role === 'assistant')!

      const copyButton = panelOf(h)!.querySelector(
        '.message.assistant .message-action-btn[aria-label="Copy message"]',
      ) as HTMLButtonElement | null
      expect(copyButton).not.toBeNull()
      copyButton!.click()

      await until(() => writes.length === 1 && eventDetail !== null && callbackDetail !== null)
      expect(writes).toEqual([assistant.content])
      expect(eventDetail).toEqual({
        messageId: assistant.id,
        action: 'copy',
        message: assistant,
        defaultHandled: true,
        error: null,
      })
      expect(callbackDetail).toEqual(eventDetail)

      await until(() => copyButton!.getAttribute('aria-label') === 'Copied')
      expect(copyButton!.classList.contains('copied')).toBe(true)
      await until(() => panelOf(h)!.querySelector('.copy-toast') !== null)
      expect(panelOf(h)!.querySelector('.copy-toast')?.textContent).toBe('Copied to clipboard')
    } finally {
      if (previousClipboard) {
        Object.defineProperty(window.navigator, 'clipboard', previousClipboard)
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard')
      }
    }
  })

  it('MESSAGE CONTEXT MENU: copy routes through the host clipboard seam', async () => {
    const previousClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
    const writes: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          writes.push(text)
        },
      },
    })

    try {
      const svc = makeLocalChatService()
      const s = await svc.createSession({ title: 'message-context-menu' })
      const container = connectedContainer()

      let eventDetail: ChatMessageActionDetail | null = null
      container.addEventListener(
        CHAT_MESSAGE_ACTION_EVENT,
        ((event: CustomEvent<ChatMessageActionDetail>) => {
          eventDetail = event.detail
        }) as EventListener,
      )

      renderFrame(container, { service: svc, sessionId: s.id })
      await settle(container)
      const h = chatHost(container)!

      sendViaComposer(h, 'menu copy')
      await until(() => assistantBubble(h)?.textContent?.includes('You said: menu copy') ?? false)
      const assistant = h.store!.getState().messages.find((msg) => msg.role === 'assistant')!
      const article = panelOf(h)!.querySelector('.message.assistant') as HTMLElement
      article.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 18 }))
      await until(() => panelOf(h)!.querySelector('.chat-message-menu') !== null)

      const copyItem = panelOf(h)!.querySelector('.chat-menu-item') as HTMLButtonElement
      expect(copyItem.textContent?.replace(/\s+/g, ' ').trim()).toBe('⧉ Copy message')
      copyItem.click()

      await until(() => writes.length === 1 && eventDetail !== null)
      expect(writes).toEqual([assistant.content])
      expect(eventDetail).toEqual({
        messageId: assistant.id,
        action: 'copy',
        message: assistant,
        defaultHandled: true,
        error: null,
      })
      expect(panelOf(h)!.querySelector('.chat-message-menu')).toBeNull()
    } finally {
      if (previousClipboard) {
        Object.defineProperty(window.navigator, 'clipboard', previousClipboard)
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard')
      }
    }
  })

  it('CODE COPY: host writes fenced code blocks to clipboard and emits composed detail', async () => {
    const previousClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
    const writes: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          writes.push(text)
        },
      },
    })

    try {
      const code = 'const shrubbery = true'
      const codeDriver: TurnDriver = async function* (): AsyncIterable<ChatEvent> {
        const output = `Here is code:\n\`\`\`ts\n${code}\n\`\`\``
        yield { type: 'turn_start', turn: 0 }
        yield { type: 'text', content: output }
        yield { type: 'done', output }
      }
      const svc = makeLocalChatService({ turnDriver: codeDriver })
      const s = await svc.createSession({ title: 'code-copy' })
      const container = connectedContainer()

      let callbackDetail: ChatCodeCopyDetail | null = null
      let eventDetail: ChatCodeCopyDetail | null = null
      container.addEventListener(
        CHAT_CODE_COPY_EVENT,
        ((event: CustomEvent<ChatCodeCopyDetail>) => {
          eventDetail = event.detail
        }) as EventListener,
      )

      renderFrame(container, {
        service: svc,
        sessionId: s.id,
        onCodeCopy: (detail) => {
          callbackDetail = detail
        },
      })
      await settle(container)
      const h = chatHost(container)!

      sendViaComposer(h, 'show code')
      await until(() => panelOf(h)!.querySelector('.code-copy-btn') !== null)
      const assistant = h.store!.getState().messages.find((msg) => msg.role === 'assistant')!

      const copyButton = panelOf(h)!.querySelector('.message.assistant .code-copy-btn') as HTMLButtonElement | null
      expect(copyButton).not.toBeNull()
      copyButton!.click()

      await until(() => writes.length === 1 && eventDetail !== null && callbackDetail !== null)
      expect(writes).toEqual([code])
      expect(eventDetail).toEqual({
        messageId: assistant.id,
        codeBlockId: `${assistant.id}-part-0-code-0`,
        code,
        lang: 'ts',
        defaultHandled: true,
        error: null,
      })
      expect(callbackDetail).toEqual(eventDetail)

      await until(() => copyButton!.getAttribute('aria-label') === 'Copied')
      expect(copyButton!.classList.contains('copied')).toBe(true)
    } finally {
      if (previousClipboard) {
        Object.defineProperty(window.navigator, 'clipboard', previousClipboard)
      } else {
        Reflect.deleteProperty(window.navigator, 'clipboard')
      }
    }
  })

  it('HEADER ACTIONS: header buttons dispatch shell-visible action details with session context', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 'header-actions' })
    const container = connectedContainer()

    const callbackDetails: ChatHeaderActionDetail[] = []
    const eventDetails: ChatHeaderActionDetail[] = []
    container.addEventListener(
      CHAT_HEADER_ACTION_EVENT,
      ((event: CustomEvent<ChatHeaderActionDetail>) => {
        eventDetails.push(event.detail)
      }) as EventListener,
    )

    renderFrame(container, {
      service: svc,
      sessionId: s.id,
      onHeaderAction: (detail) => {
        callbackDetails.push(detail)
      },
    })
    await settle(container)
    const h = chatHost(container)!

    const saveEmpty = panelOf(h)!.querySelector(
      '.icon-button[aria-label="Save chat to Garden"]',
    ) as HTMLButtonElement
    expect(saveEmpty).not.toBeNull()
    expect(saveEmpty.disabled).toBe(true)

    sendViaComposer(h, 'header context')
    await until(() => assistantBubble(h)?.textContent?.includes('You said: header context') ?? false)

    const save = panelOf(h)!.querySelector(
      '.icon-button[aria-label="Save chat to Garden"]',
    ) as HTMLButtonElement
    const refresh = panelOf(h)!.querySelector(
      '.icon-button[aria-label="Refresh messages"]',
    ) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    save.click()
    refresh.click()

    await until(() => eventDetails.length === 2 && callbackDetails.length === 2)
    expect(eventDetails.map((detail) => detail.action)).toEqual(['save-garden', 'refresh'])
    expect(callbackDetails).toEqual(eventDetails)
    expect(eventDetails[0].sessionId).toBe(s.id)
    expect(eventDetails[0].messages.some((msg) => msg.content.includes('header context'))).toBe(true)
    expect(eventDetails[0].defaultHandled).toBe(false)
    expect(eventDetails[1].defaultHandled).toBe(true)
    expect(eventDetails[1].error).toBeNull()
  })

  it('FULLSCREEN ESCAPE: inner overlays consume Escape before the host requests restore', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 'fullscreen-escape' })
    const container = connectedContainer()
    const details: ChatHeaderActionDetail[] = []

    renderFrame(container, {
      service: svc,
      sessionId: s.id,
      presentation: 'fullscreen',
      onHeaderAction: detail => details.push(detail),
    })
    await settle(container)
    const host = chatHost(container)!
    const panel = panelOf(host)!
    const trigger = panel.querySelector('.compact-actions-trigger') as HTMLButtonElement

    trigger.click()
    await panel.updateComplete
    expect(panel.querySelector('.header-actions-menu')).not.toBeNull()
    trigger.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    await Promise.resolve()
    await panel.updateComplete
    expect(panel.querySelector('.header-actions-menu')).toBeNull()
    expect(details).toEqual([])

    // With no inner surface left to consume it, Escape emits the controlled
    // restore intent but still does not remount either live node itself.
    trigger.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    await until(() => details.length === 1)
    expect(details[0].action).toBe('restore')
    expect(details[0].defaultHandled).toBe(false)
    expect(chatHost(container)).toBe(host)
    expect(panelOf(host)).toBe(panel)
  })

  it('SESSION SUPERBAR: empty slot click creates/binds a new session through the host seam', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 'Slot A' })
    const container = connectedContainer()

    let callbackDetail: ChatSessionActionDetail | null = null
    let eventDetail: ChatSessionActionDetail | null = null
    container.addEventListener(
      CHAT_SESSION_ACTION_EVENT,
      ((event: CustomEvent<ChatSessionActionDetail>) => {
        eventDetail = event.detail
      }) as EventListener,
    )

    renderFrame(container, {
      service: svc,
      sessionId: s.id,
      onSessionAction: (detail) => {
        callbackDetail = detail
      },
    })
    await settle(container)
    const h = chatHost(container)!
    await until(() => panelOf(h)!.querySelector('.super-bar-chat-title')?.textContent === 'Slot A')

    const slots = Array.from(panelOf(h)!.querySelectorAll('.slot-indicator')) as HTMLButtonElement[]
    expect(slots.map((slot) => slot.textContent?.trim())).toEqual(['1', '2', '3'])
    expect(slots[0].classList.contains('active')).toBe(true)
    expect(svc.slotSessions()).toEqual([s.id, null, null])

    slots[1].click()
    await until(() => eventDetail !== null && callbackDetail !== null)
    await until(() => h.store!.getState().sessionId !== s.id)

    const nextSessionId = h.store!.getState().sessionId
    expect(nextSessionId).toBeTruthy()
    expect(svc.activeSlot).toBe(1)
    expect(svc.slotSessions()).toEqual([s.id, nextSessionId, null])
    expect(eventDetail).toEqual({
      action: { type: 'slot', slot: 1 },
      sessionId: nextSessionId,
      sessionTitle: null,
      activeSlot: 1,
      slotSessions: [s.id, nextSessionId, null],
      defaultHandled: true,
      error: null,
    })
    expect(callbackDetail).toEqual(eventDetail)
    await until(() => (panelOf(h)!.querySelectorAll('.slot-indicator')[1] as HTMLButtonElement).classList.contains('active'))
  })

  it('MESSAGE ACTION: regenerate bridges to Garden-compatible host events', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 'message-actions' })
    const container = connectedContainer()

    let actionDetail: ChatMessageActionDetail | null = null
    let regenerateDetail: { messageId: string; message: unknown } | null = null
    container.addEventListener(
      CHAT_MESSAGE_ACTION_EVENT,
      ((event: CustomEvent<ChatMessageActionDetail>) => {
        actionDetail = event.detail
      }) as EventListener,
    )
    container.addEventListener(
      'mn-regenerate-message',
      ((event: CustomEvent<{ messageId: string; message: unknown }>) => {
        regenerateDetail = event.detail
      }) as EventListener,
    )

    renderFrame(container, { service: svc, sessionId: s.id })
    await settle(container)
    const h = chatHost(container)!

    sendViaComposer(h, 'again')
    await until(() => assistantBubble(h)?.textContent?.includes('You said: again') ?? false)
    const assistant = h.store!.getState().messages.find((msg) => msg.role === 'assistant')!

    const regenerateButton = panelOf(h)!.querySelector(
      '.message.assistant .message-action-btn[aria-label="Regenerate"]',
    ) as HTMLButtonElement | null
    expect(regenerateButton).not.toBeNull()
    regenerateButton!.click()

    await until(() => actionDetail !== null && regenerateDetail !== null)
    expect(regenerateDetail).toEqual({ messageId: assistant.id, message: assistant })
    expect(actionDetail).toEqual({
      messageId: assistant.id,
      action: 'regenerate',
      message: assistant,
      defaultHandled: true,
      error: null,
    })
  })

  it('SURFACE ACTION: a real surface tool result clicks through the host shell seam', async () => {
    const surface = {
      type: 'surface',
      actions: [
        {
          document_id: 'doc-target',
          title: 'Target document',
          action: 'Open document',
          block_id: 'block-target',
        },
      ],
    }
    const surfaceDriver: TurnDriver = async function* (): AsyncIterable<ChatEvent> {
      yield { type: 'turn_start', turn: 0 }
      yield { type: 'tool_call', gate: 'surface', args: { query: 'target' } }
      yield { type: 'tool_result', gate: 'surface', result: JSON.stringify(surface), is_error: false }
      yield { type: 'done', output: 'Surface ready.' }
    }
    const svc = makeLocalChatService({ turnDriver: surfaceDriver })
    const s = await svc.createSession({ title: 'surface' })
    const container = connectedContainer()

    let callbackAction: SurfaceActionIntent | null = null
    let eventAction: SurfaceActionIntent | null = null
    container.addEventListener('mn-chat-surface-action', ((event: CustomEvent<SurfaceActionIntent>) => {
      eventAction = event.detail
    }) as EventListener)

    renderFrame(container, {
      service: svc,
      sessionId: s.id,
      onSurfaceAction: (action) => {
        callbackAction = action
      },
    })
    await settle(container)
    const h = chatHost(container)!

    sendViaComposer(h, 'find target')
    await until(() => panelOf(h)!.querySelector('.surface-action') !== null)

    const actionButton = panelOf(h)!.querySelector('.surface-action') as HTMLButtonElement
    actionButton.click()

    expect(callbackAction).toEqual({
      documentId: 'doc-target',
      title: 'Target document',
      action: 'Open document',
      blockId: 'block-target',
    })
    expect(eventAction).toEqual(callbackAction)
  })
})
