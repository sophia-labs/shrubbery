/**
 * chat-kernel-prose-story.test.ts — makes the Chat/Kernel prose fixture REAL.
 *
 * Lives under catalog/ so the storybook vitest include glob collects it and the
 * ProseAndStates story's play() actually RUNS (happy-dom), rather than merely
 * existing as a declaration a human might never open.
 *
 * The story is the eyeball fixture for the chat panel's visual layer: every
 * markdown mark against the assistant's rule-gutter column AND inside the
 * accent-filled user bubble, plus a mid-stream turn, a failed turn, and a failed
 * tool call. Running its play() here means the fixture cannot silently stop
 * covering what it claims to cover.
 *
 * NO MOCKS: real ChatMessage render data driving the real <sh-chat-panel>.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { StoryObj } from '@storybook/web-components'

import * as ChatKernelStories from '../stories/chat-kernel.stories.js'

const { ProseAndStates, ProseAndStatesDark } = ChatKernelStories as unknown as {
  ProseAndStates: StoryObj
  ProseAndStatesDark: StoryObj
}

const mounted: HTMLElement[] = []

function renderStory(story: StoryObj): HTMLElement {
  const el = (story.render as () => HTMLElement)()
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function playOn(story: StoryObj, el: HTMLElement): Promise<void> {
  await (story.play as (ctx: { canvasElement: HTMLElement }) => Promise<void>)({
    canvasElement: el,
  })
}

afterEach(() => {
  for (const el of mounted) el.remove()
  mounted.length = 0
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('Chat/Kernel — ProseAndStates fixture', () => {
  it('exports both prose stories with runnable play functions', () => {
    expect(ProseAndStates).toBeDefined()
    expect(typeof ProseAndStates.play).toBe('function')
    expect(ProseAndStatesDark).toBeDefined()
    expect(typeof ProseAndStatesDark.play).toBe('function')
  })

  it('runs the light fixture play() against the real panel', async () => {
    const el = renderStory(ProseAndStates)
    await expect(playOn(ProseAndStates, el)).resolves.toBeUndefined()
  })

  it('runs the dark fixture play() against the real panel', async () => {
    const el = renderStory(ProseAndStatesDark)
    await expect(playOn(ProseAndStatesDark, el)).resolves.toBeUndefined()
  })

  it('puts the user bubble and the assistant column on stage together so inversion is eyeballable', async () => {
    const el = renderStory(ProseAndStates)
    await (el as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete

    // Both prose treatments must be present — the user bubble is the only place
    // the inverted mark rules apply, so a fixture without one proves nothing.
    expect(el.querySelector('.message.user .message-content .markdown-content a')).not.toBeNull()
    expect(el.querySelector('.message.assistant .message-content .markdown-content a')).not.toBeNull()
  })
})
