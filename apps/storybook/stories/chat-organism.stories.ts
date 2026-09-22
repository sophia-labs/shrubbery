/**
 * Chat ORGANISM — the REAL round-trip on stage (C2c → C3).
 *
 * Where chat-kernel.stories.ts (LivePanel) mounts the PURE kernel with a CANNED
 * host reply (a static assistant message appended in onSend), THIS story mounts the
 * REAL Class-B chat host <sh-chat-host> (packages/runtime/src/chat-host/) wired to
 * the REAL local ChatService. The host owns the host-side ChatServiceStore + the
 * buildChatKernelOptions bind-on-tick loop + the imperatively-held <sh-chat-panel>,
 * folding the REAL turn events through the REAL projectEvents/finalize.
 *
 * C3: the ~80-line duplicated store this story used to carry is GONE — the lifted
 * <sh-chat-host> is the single reusable host, so the story is now the SAME minimal
 * shell the atelier app is (assemble → createSession → mountChatHost). That also
 * means the C3.0 fixes (session hydration + a single user-message-append owner)
 * apply here too — no divergent duplicate to keep in sync.
 *
 * NO MOCKS, INFRA-FREE: assembleChatServices(contract, scope, 'local') returns the
 * real makeLocalChatService (a Map-backed InProcessChatStore + the ECHO turnDriver
 * emitting real ChatEvent[]). The contract/scope are inert on the local path. So
 * the full organism — composer keystroke → onSend → store.send → svc.startTurn →
 * for-await(events) re-fold accumulated array via projectEvents → finalize → the
 * panel re-renders the conversation live — runs anywhere Storybook does, with no
 * gardend cell and no choreograph.
 *
 * play() types + fires Enter and asserts the user bubble + the streamed assistant
 * ECHO + the tool-call badge all land in the real LIGHT-DOM tree — proving the fold,
 * not a canned string.
 */
import type { Meta, StoryObj } from '@storybook/web-components'

import { html, render } from 'lit'
import { ShChatPanel } from '@shrubbery/chat-kernel'
import { assembleChatServices, mountChatHost, type ShChatHost } from '@shrubbery/runtime'
import type { EditorScope, ShrubberyContract } from '@shrubbery/nucleus'

// Touch the class so the import (which registers <sh-chat-panel>) is load-bearing.
void ShChatPanel

const meta: Meta = {
  title: 'Chat/Organism',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

/** Mount the REAL organism: real ChatService + the REAL <sh-chat-host> (which owns
 * the store) + the real <sh-chat-panel> the host mounts internally. */
function mountOrganism(): HTMLElement {
  const host = document.createElement('div')
  host.style.height = '100vh'

  // The contract is inert on the local path (never dereferenced) — a minimal
  // object that satisfies the param type without faking any backend.
  const contract = {} as ShrubberyContract
  const scope = (): EditorScope => ({
    centerMode: 'document',
    graphId: 'storybook-organism',
    documentId: null,
    app: undefined,
  })

  const svc = assembleChatServices(contract, scope, 'local')

  // SHELL POLICY: create the session, then mount the ONE live host. createSession
  // is async; mount once it resolves (the host hydrates the empty session, then is
  // ready to send). Wrapped in a real `.main` element child (not a trailing bare
  // child-binding) so a later spine grow re-renders the wrapper, host node survives.
  void svc.createSession({ title: 'storybook-organism' }).then((session) => {
    render(html`<div class="main" style="height:100vh">${mountChatHost(svc, session.id)}</div>`, host)
  })
  return host
}

/** Wait until a predicate holds (the store streams the turn asynchronously). */
async function until(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

export const RealRoundTrip: Story = {
  render: () => mountOrganism(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    // Wait for the async session bind to mount the host + its panel.
    await until(() => canvasElement.querySelector('#sh-chat-host') !== null)
    const chatHost = canvasElement.querySelector('#sh-chat-host') as ShChatHost
    await chatHost.updateComplete
    await until(() => chatHost.panel !== null)
    const panel = chatHost.panel as ShChatPanel
    await panel.updateComplete

    // LIGHT DOM invariant — the panel renders into itself.
    if (panel.shadowRoot) throw new Error('RealRoundTrip.play: expected LIGHT DOM')

    // Wait for the composer (hydration of the empty session enables it).
    await until(() => panel.querySelector('hoja-editor[posture="composer"]') !== null)
    panel.draft = 'hello from storybook'
    await panel.updateComplete
    const hoja = panel.querySelector('hoja-editor[posture="composer"]') as HTMLElement & {
      updateComplete: Promise<boolean>
    }
    await hoja.updateComplete
    const input = hoja.querySelector('.ProseMirror') as HTMLElement

    // Drive the REAL composer: type + a real Enter keydown fires the round-trip.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    // The store streams the turn through the REAL projectEvents; the panel re-renders
    // the user bubble + the assistant ECHO bubble live (not a canned string).
    await until(() => panel.querySelectorAll('.message').length >= 2)
    await panel.updateComplete

    const userBubble = panel.querySelector('.message.user')
    const assistantBubble = panel.querySelector('.message.assistant')
    if (!userBubble?.textContent?.includes('hello from storybook')) {
      throw new Error('RealRoundTrip.play: user bubble did not render')
    }
    if (!assistantBubble?.textContent?.includes('You said: hello from storybook')) {
      throw new Error('RealRoundTrip.play: assistant ECHO did not render (the fold failed)')
    }

    // The tool_call/tool_result demo pair from the ECHO driver reconciled to a
    // completed badge — proving the accumulated-array fold (not per-event).
    await until(() => panel.querySelector('.tool-status-icon[data-status="completed"]') !== null)
  },
}
