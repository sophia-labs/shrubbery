/**
 * editor-kernel-story.test.ts — the S6 STORYBOOK ORGANISM proof.
 *
 * Lives under catalog/ so the storybook vitest include glob (catalog test glob,
 * see ../vitest.config.ts) collects it. It is NOT a Storybook visual test — it is
 * a pure-logic assertion that the editor-kernel story is a REAL, probeable
 * organism:
 *
 *   - render() returns a REAL HTMLElement (the imperative host TipTap mounts into).
 *   - play is a FUNCTION.
 *   - Driving the REAL play() against the REAL rendered host types "Borges" into
 *     the LIVE kernel Editor and the live document reflects it.
 *
 * NO MOCKS: the story's render() builds a real createKernelEditor Editor under
 * happy-dom; play() drives the real editor commands. Errors surface verbatim.
 */
import { describe, it, expect, afterEach } from 'vitest'

import * as EditorKernelStories from '../stories/editor-kernel.stories.js'
import type { StoryObj } from '@storybook/web-components'
import type { Editor } from '@shrubbery/editor-kernel'

const { LiveEditor, WithWikiLinkSeams } = EditorKernelStories as unknown as {
  LiveEditor: StoryObj
  WithWikiLinkSeams: StoryObj
}

type EditorHost = HTMLElement & { __editor?: Editor }

// Track every editor we mount so we can destroy it (the story stashes the live
// instance on the host as __editor).
const mounted: EditorHost[] = []
function renderStory(story: StoryObj): EditorHost {
  const el = (story.render as () => EditorHost)()
  mounted.push(el)
  return el
}
afterEach(() => {
  for (const el of mounted) el.__editor?.destroy()
  mounted.length = 0
  document.body.innerHTML = ''
})

describe('S6 storybook organism — editor-kernel.stories.ts', () => {
  it('the story module default-exports a Meta and the LiveEditor story', () => {
    expect(EditorKernelStories.default).toBeDefined()
    expect(LiveEditor).toBeDefined()
  })

  it('LiveEditor.render() returns a REAL HTMLElement (the live editor host)', () => {
    const el = renderStory(LiveEditor)
    expect(el).toBeInstanceOf(HTMLElement)
    // The host actually carries a live kernel Editor (not a faked node).
    expect(el.__editor).toBeDefined()
    expect(typeof el.__editor!.getText).toBe('function')
    // TipTap mounted a real ProseMirror editor into the host's mount element.
    expect(el.querySelector('.ProseMirror')).toBeTruthy()
  })

  it('LiveEditor.play is a function', () => {
    expect(typeof LiveEditor.play).toBe('function')
  })

  it('driving the REAL play() types "Borges" into the LIVE editor', async () => {
    const el = renderStory(LiveEditor)
    document.body.appendChild(el)

    // Drive the actual story play() against the real rendered host — exactly what
    // Storybook's test-runner does, but in happy-dom against the live editor.
    await (LiveEditor.play as (ctx: { canvasElement: HTMLElement }) => Promise<void>)({
      canvasElement: el,
    })

    // The LIVE editor's document now contains the typed word.
    expect(el.__editor!.getText()).toContain('Borges')
  })

  it('WithWikiLinkSeams.render() also returns a live editor host (pure seams)', () => {
    const el = renderStory(WithWikiLinkSeams)
    expect(el).toBeInstanceOf(HTMLElement)
    expect(el.__editor).toBeDefined()
  })
})
