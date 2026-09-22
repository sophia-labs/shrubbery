/**
 * chat-organism-story.test.ts — the C2c STORYBOOK ORGANISM proof.
 *
 * Lives under catalog/ so the storybook vitest include glob collects it and the
 * Chat/Organism story's play() actually RUNS in CI (happy-dom), not just exists.
 * It proves the chat-organism story is a REAL, probeable round-trip: render() mounts
 * a connected <sh-chat-panel> wired (via the real assembleChatServices + the story's
 * host-side store + buildChatKernelOptions) to the REAL local ChatService; the REAL
 * play() types into the LIVE composer + fires Enter, and asserts the user bubble +
 * the STREAMED assistant ECHO + the reconciled tool-call badge all rendered in the
 * real LIGHT-DOM tree — driving the REAL projectEvents/finalize fold, no vi.fn.
 *
 * NO MOCKS, INFRA-FREE: the local in-process ChatService (Map store + ECHO driver)
 * needs no gardend cell + no choreograph — a green here IS the organism proof.
 */
import { describe, it, expect, afterEach } from 'vitest'

import * as ChatOrganismStories from '../stories/chat-organism.stories.js'
import type { StoryObj } from '@storybook/web-components'

const { RealRoundTrip } = ChatOrganismStories as unknown as { RealRoundTrip: StoryObj }

/** Wait until a predicate holds (the host mounts async after createSession). */
async function until(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const mounted: HTMLElement[] = []
function renderStory(story: StoryObj): HTMLElement {
  const el = (story.render as () => HTMLElement)()
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

afterEach(() => {
  for (const el of mounted) el.remove()
  mounted.length = 0
  document.body.innerHTML = ''
})

describe('C2c storybook organism — chat-organism.stories.ts', () => {
  it('the story module default-exports a Meta and the RealRoundTrip story', () => {
    expect(ChatOrganismStories.default).toBeDefined()
    expect(RealRoundTrip).toBeDefined()
    expect(typeof RealRoundTrip.play).toBe('function')
  })

  it('RealRoundTrip.render() returns a connected container that mounts the real <sh-chat-host> + <sh-chat-panel>', async () => {
    const el = renderStory(RealRoundTrip)
    expect(el).toBeInstanceOf(HTMLElement)
    // C3: the host mounts ASYNC (after svc.createSession resolves) — the story now
    // mounts the reusable <sh-chat-host>, which owns + imperatively mounts the panel.
    await until(() => el.querySelector('#sh-chat-host') !== null)
    const host = el.querySelector('#sh-chat-host') as HTMLElement & { panel: HTMLElement | null }
    await until(() => host.panel !== null)
    // The panel is mounted imperatively into the host's SHADOW root (the stable
    // .chat-mount target) — reach it through the host's public `panel` getter (the
    // shadow root won't be pierced by a light-DOM querySelector on the container).
    expect(host.panel).not.toBeNull()
    expect(host.shadowRoot?.querySelector('sh-chat-panel')).toBe(host.panel)
  })

  it('driving the REAL play() streams a turn: user bubble + assistant ECHO render live in the real tree', async () => {
    const el = renderStory(RealRoundTrip)

    // Drive the actual story play() against the real rendered panel — exactly what
    // Storybook's test-runner does, but in happy-dom against the live element + the
    // assembled local ChatService. It throws if the fold did not render the user
    // bubble + the streamed assistant ECHO + the tool badge — so green IS the proof.
    await (RealRoundTrip.play as (ctx: { canvasElement: HTMLElement }) => Promise<void>)({
      canvasElement: el,
    })

    // The panel lives in the host's shadow root (the imperatively-mounted live node).
    const host = el.querySelector('#sh-chat-host') as HTMLElement & { panel: HTMLElement | null }
    const panel = host.panel as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.shadowRoot).toBeNull() // the panel itself is light DOM
    expect(panel.querySelector('.message.user')?.textContent).toContain('hello from storybook')
    expect(panel.querySelector('.message.assistant')?.textContent).toContain('You said: hello from storybook')
    expect(panel.querySelector('.tool-status-icon[data-status="completed"]')).not.toBeNull()
  })
})
