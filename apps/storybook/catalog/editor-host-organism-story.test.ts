/**
 * editor-host-organism-story.test.ts — the RUNG L2c STORYBOOK ORGANISM proof.
 *
 * Lives under catalog/ so the storybook vitest include glob collects it and the story's
 * play() actually RUNS in CI (happy-dom), not just exists. It proves the host-mount story
 * is a REAL, probeable organism: render() builds the connected <sh-editor-host> over a REAL
 * Y.Doc WITH the assembled kernelOptions (the shell's onWikiLinkClick/onWikiLinkDelete);
 * driving the REAL play() keeps the LIVE editor mounted and asserts the picker service
 * the host was wired with returns the REAL seeded candidates from the workspace.
 *
 * NO MOCKS on the load-bearing axis: real host element + real Y.Doc-backed ProviderHandle,
 * real assembleEditorServices/buildKernelOptions, real makeWikiLinkSearchService parsing
 * the cell's exact row shape. DEFERRED (labelled in the story): the Node-addon oxigraph
 * ENGINE does not run in a browser canvas, so the story hands the real adapter the cell's
 * exact rows; the engine that EXECUTES the query is proven in the vitest organism
 * (sh-editor-host-organism.test.ts) over the real oxigraph engine. Pixel positioning is the
 * test-storybook/Playwright rung.
 */
import { describe, it, expect, afterEach } from 'vitest'

import * as EditorHostOrganismStories from '../stories/editor-host-organism.stories.js'
import type { StoryObj } from '@storybook/web-components'
import type { ShEditorHost } from '@shrubbery/runtime'

const { HostOrganism } = EditorHostOrganismStories as unknown as { HostOrganism: StoryObj }

const mounted: HTMLElement[] = []
function renderStory(story: StoryObj): HTMLElement {
  const el = (story.render as () => HTMLElement)()
  document.body.appendChild(el)
  mounted.push(el)
  return el
}
const hostOf = (el: HTMLElement) => el.querySelector('#mn-editor-host') as ShEditorHost | null

afterEach(() => {
  for (const el of mounted) el.remove()
  mounted.length = 0
  document.body.innerHTML = ''
})

describe('rung L2c storybook organism — editor-host-organism.stories.ts', () => {
  it('the story module default-exports a Meta and the HostOrganism story', () => {
    expect(EditorHostOrganismStories.default).toBeDefined()
    expect(HostOrganism).toBeDefined()
    expect(typeof HostOrganism.play).toBe('function')
  })

  it('HostOrganism.render() returns a connected container carrying the real <sh-editor-host>', () => {
    const el = renderStory(HostOrganism)
    expect(el).toBeInstanceOf(HTMLElement)
    expect(hostOf(el)).not.toBeNull()
  })

  it('driving the REAL play() keeps the editor live and the picker returns REAL candidates from the workspace', async () => {
    const el = renderStory(HostOrganism)

    // Drive the actual story play() against the real rendered host — exactly what
    // Storybook's test-runner does, but in happy-dom against the live editor + the
    // assembled kernel slot. It throws if the live editor did not mount or the picker
    // does not return the real candidates — so a green here IS the organism proof.
    await (HostOrganism.play as (ctx: { canvasElement: HTMLElement }) => Promise<void>)({
      canvasElement: el,
    })

    const host = hostOf(el)!
    // The live body is real ProseMirror with the kernel slot populated (not placeholder).
    expect(host.liveEditor).not.toBeNull()
    expect(host.liveEditor!.getText()).toContain('[[arch')
    expect(host.shadowRoot?.querySelector('.ProseMirror')).not.toBeNull()
    expect(host.shadowRoot?.querySelector('.placeholder')).toBeNull()
  })
})
