/**
 * chat-roundtrip.test.ts — the REAL no-mock chat ORGANISM (happy-dom, real DOM).
 *
 * Mounts a REAL <sh-chat-panel> wired (via the shell's mountChat) to the REAL
 * local ChatService + the REAL host-side ChatServiceStore. It simulates a real
 * composer keystroke + Enter, awaits the turn, and asserts the projected
 * ChatMessage[] rendered in the real LIGHT-DOM tree. This drives the REAL
 * projectEvents/finalize fold through the REAL element + the REAL store — no vi.fn.
 *
 * N0b NOTE: mountChat now injects the DETERMINISTIC GROW-DRIVER (the LOCAL-N0 swap
 * for the ECHO driver) — so the chat organism's behavior here is the grow-driver's:
 * a NON-phrase returns the friendly capability list (no cell write); the GROW path
 * (a demo phrase → real grow() → tool-call + ack) is proven against a REAL cell in
 * tests/atelier-demo.integration.test.ts (the demo loop needs the live :ux:config).
 *
 * INFRA-FREE on the no-match path: the grow-driver only calls grow() on a phrase
 * MATCH, so a non-matching turn never touches the (here-inert) contract — this
 * organism runs anywhere happy-dom does, exactly like before.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mountChat } from '../chat-main.js'
import type { ShChatPanel } from '@shrubbery/chat-kernel'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

/** Wait until a predicate holds (the store notifies the panel async during a turn). */
async function until(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function composerInput(panel: ShChatPanel): Promise<HTMLElement> {
  await panel.updateComplete
  const hoja = panel.querySelector('hoja-editor[posture="composer"]') as HTMLElement & {
    updateComplete: Promise<boolean>
  }
  await hoja.updateComplete
  const input = hoja.querySelector<HTMLElement>('.ProseMirror')
  if (!input) throw new Error('Hoja composer did not mount')
  return input
}

async function send(panel: ShChatPanel, text: string): Promise<void> {
  panel.draft = text
  const input = await composerInput(panel)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

describe('chat ORGANISM — real <sh-chat-panel> + real local ChatService round-trip', () => {
  it('a NON-phrase turn renders the user bubble + the grow-driver capability list (no cell write)', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const { panel } = await mountChat(host)
    await panel.updateComplete

    // It is the real light-DOM element (createRenderRoot(){return this}).
    expect(panel.shadowRoot).toBeNull()
    expect(await composerInput(panel)).not.toBeNull()

    // Simulate a REAL composer keystroke + Enter (the kernel's send path). A text
    // that matches NO grow phrase → the friendly capability list (no grow() call,
    // so the inert contract is never dereferenced — infra-free).
    await send(panel, 'hello atelier')

    // The store streams the turn; wait for the assistant reply to land + re-render.
    await until(() => {
      const bubbles = panel.querySelectorAll('.message')
      return bubbles.length >= 2
    })
    await panel.updateComplete

    // The user bubble + the assistant capability-list bubble both rendered.
    const userBubble = panel.querySelector('.message.user')
    const assistantBubble = panel.querySelector('.message.assistant')
    expect(userBubble?.textContent).toContain('hello atelier')
    expect(assistantBubble?.textContent).toContain('I can grow your interface')
    // It lists the demo phrases (the deterministic responder, not a mock).
    expect(assistantBubble?.textContent).toContain('give me a top bar')
  })

  it('clears the composer draft after send', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { panel } = await mountChat(host)
    await panel.updateComplete

    await send(panel, 'draft text')
    await panel.updateComplete

    // The kernel clears its own draft on send (the panel's send()).
    const hojaAfter = panel.querySelector('hoja-editor[posture="composer"]') as HTMLElement & { value: string }
    expect(hojaAfter.value).toBe('')
  })
})
