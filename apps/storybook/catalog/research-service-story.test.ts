/**
 * research-service-story.test.ts - SRS as Shrubbery atom/molecule/organism/story.
 *
 * This guard keeps the SRS suite honest in Vitest, not only in the browser
 * runner. It proves the layered stories mount real custom elements:
 * - mn-research-source-chip atom;
 * - mn-research-source-card and mn-research-run-trace molecules;
 * - mn-research-workspace organism;
 * - complete story composed from workspace + chat/sidebar/source/canvas pieces.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { StoryObj } from '@storybook/web-components'

import * as ResearchServiceStories from '../stories/research-service.stories.js'
import type { ShChatPanel } from '@shrubbery/chat-kernel'
import type {
  MnResearchRunTrace,
  MnResearchWorkspace,
  MnZoteroSourceWorkbench,
} from '@shrubbery/components'

const {
  AtomsSourceChip,
  MoleculesSourceCard,
  MoleculesRunTrace,
  OrganismsWorkspace,
  StorySidebarChat,
  StoryPaperSourceWorkbench,
  StoryWorkflowWorkbench,
  StoryCompleteSurface,
} = ResearchServiceStories as unknown as Record<string, StoryObj>

const stories = [
  AtomsSourceChip,
  MoleculesSourceCard,
  MoleculesRunTrace,
  OrganismsWorkspace,
  StorySidebarChat,
  StoryPaperSourceWorkbench,
  StoryWorkflowWorkbench,
  StoryCompleteSurface,
]

const mounted: HTMLElement[] = []

function renderStory(story: StoryObj): HTMLElement {
  const el = (story.render as () => HTMLElement)()
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

async function play(story: StoryObj, el: HTMLElement): Promise<void> {
  await (story.play as (ctx: { canvasElement: HTMLElement }) => Promise<void>)({ canvasElement: el })
}

afterEach(() => {
  for (const el of mounted) el.remove()
  mounted.length = 0
  document.body.innerHTML = ''
})

describe('SRS Storybook surface - atom/molecule/organism/story', () => {
  it('default-exports meta and the expected layered story set', () => {
    expect(ResearchServiceStories.default).toBeDefined()
    for (const story of stories) {
      expect(story).toBeDefined()
      expect(typeof story.render).toBe('function')
      expect(typeof story.play).toBe('function')
    }
  })

  it('atom and molecule stories mount the new research components and play them', async () => {
    const atom = renderStory(AtomsSourceChip)
    await play(AtomsSourceChip, atom)
    expect(atom.querySelector('mn-research-source-chip')).not.toBeNull()

    const card = renderStory(MoleculesSourceCard)
    await play(MoleculesSourceCard, card)
    expect(card.querySelector('mn-research-source-card')).not.toBeNull()

    const trace = renderStory(MoleculesRunTrace)
    await play(MoleculesRunTrace, trace)
    const traceEl = trace.querySelector('mn-research-run-trace') as MnResearchRunTrace | null
    expect(traceEl?.steps.length).toBeGreaterThan(0)
  })

  it('organism story mounts mn-research-workspace and switches panes', async () => {
    const el = renderStory(OrganismsWorkspace)
    await play(OrganismsWorkspace, el)

    const workspace = el.querySelector('mn-research-workspace') as MnResearchWorkspace | null
    expect(workspace).not.toBeNull()
    expect(workspace!.mode).toBe('workflow')
    expect(el.querySelector('sh-chat-panel')).not.toBeNull()
    expect(el.querySelector('mn-sidebar-panel')).not.toBeNull()
  })

  it('sidebar chat story drives SRS controls, prompts, and composer send', async () => {
    const el = renderStory(StorySidebarChat)
    await play(StorySidebarChat, el)

    const chat = el as ShChatPanel
    expect(chat.messages.length).toBeGreaterThan(2)
    expect(chat.messages.some((msg) => msg.content.includes('Focus on wrappers'))).toBe(true)
  })

  it('source, workflow, and complete stories mount the reused Shrubbery pieces', async () => {
    const source = renderStory(StoryPaperSourceWorkbench)
    await play(StoryPaperSourceWorkbench, source)
    const sourceWorkbench = source.querySelector('mn-zotero-source-workbench') as MnZoteroSourceWorkbench | null
    expect(sourceWorkbench?.item?.key).toBe('paper-wrapper-survey')

    const workflow = renderStory(StoryWorkflowWorkbench)
    await play(StoryWorkflowWorkbench, workflow)
    expect(workflow.querySelector('mn-excalidraw-canvas')).not.toBeNull()

    const complete = renderStory(StoryCompleteSurface)
    await play(StoryCompleteSurface, complete)
    expect(complete.querySelector('mn-research-workspace')).not.toBeNull()
    expect(complete.querySelector('mn-research-source-card')).not.toBeNull()
    expect(complete.querySelector('sh-chat-panel')).not.toBeNull()
    expect(complete.querySelector('mn-zotero-source-workbench')).not.toBeNull()
  })
})
