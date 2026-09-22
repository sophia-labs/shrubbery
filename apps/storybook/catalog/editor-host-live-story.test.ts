/**
 * editor-host-live-story.test.ts — the rung B2 STORYBOOK ORGANISM proof.
 *
 * Lives under catalog/ so the storybook vitest include glob collects it. It is a
 * pure-logic assertion that the editor-host-live story is a REAL, probeable
 * organism: render() builds the connected <sh-editor-host> over a REAL Y.Doc, and
 * driving the REAL play() types into the LIVE collaborative editor — the live
 * host.liveEditor reflects it.
 *
 * NO MOCKS: the story's render() mounts the real host element + a real Y.Doc-backed
 * ProviderHandle; play() drives the real editor commands. Errors surface verbatim.
 *
 * Real-browser-only pixel positioning and OS-keymap keystrokes are registered here
 * and asserted by Storybook's Playwright runner; this file proves the organism and
 * story catalogue shape under happy-dom.
 */
import { describe, it, expect, afterEach } from 'vitest'

import * as EditorHostLiveStories from '../stories/editor-host-live.stories.js'
import type { StoryObj } from '@storybook/web-components'
import type { ShEditorHost } from '@shrubbery/runtime'

const {
  LiveHost,
  UndoKeystrokeAudit,
  OutlinerAffordanceAudit,
  OutlinerInteractionAudit,
  OutlinerDragDropGeometryAudit,
  OutlinerEscapeGateAudit,
  PlaceholderHost,
} = EditorHostLiveStories as unknown as {
  LiveHost: StoryObj
  UndoKeystrokeAudit: StoryObj
  OutlinerAffordanceAudit: StoryObj
  OutlinerInteractionAudit: StoryObj
  OutlinerDragDropGeometryAudit: StoryObj
  OutlinerEscapeGateAudit: StoryObj
  PlaceholderHost: StoryObj
}

// Each render() returns the `.main` container holding the keyed <sh-editor-host>.
const mounted: HTMLElement[] = []
function renderStory(story: StoryObj): HTMLElement {
  const el = (story.render as () => HTMLElement)()
  // Connect so the custom element upgrades + runs its update/mount lifecycle.
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

describe('rung B2 storybook organism — editor-host-live.stories.ts', () => {
  it('the story module default-exports a Meta and the LiveHost story', () => {
    expect(EditorHostLiveStories.default).toBeDefined()
    expect(LiveHost).toBeDefined()
  })

  it('LiveHost.render() returns a connected container carrying the real <sh-editor-host>', () => {
    const el = renderStory(LiveHost)
    expect(el).toBeInstanceOf(HTMLElement)
    expect(hostOf(el)).not.toBeNull()
  })

  it('LiveHost.play is a function', () => {
    expect(typeof LiveHost.play).toBe('function')
  })

  it('OutlinerAffordanceAudit is registered as the browser-only geometry audit', () => {
    expect(OutlinerAffordanceAudit).toBeDefined()
    expect(typeof OutlinerAffordanceAudit.render).toBe('function')
    expect(typeof OutlinerAffordanceAudit.play).toBe('function')
  })

  it('OutlinerInteractionAudit is registered as the browser-only interaction audit', () => {
    expect(OutlinerInteractionAudit).toBeDefined()
    expect(typeof OutlinerInteractionAudit.render).toBe('function')
    expect(typeof OutlinerInteractionAudit.play).toBe('function')
  })

  it('OutlinerDragDropGeometryAudit is registered as the browser-only drag/drop geometry audit', () => {
    expect(OutlinerDragDropGeometryAudit).toBeDefined()
    expect(typeof OutlinerDragDropGeometryAudit.render).toBe('function')
    expect(typeof OutlinerDragDropGeometryAudit.play).toBe('function')
  })

  it('OutlinerEscapeGateAudit is registered as the browser-only overlay Escape audit', () => {
    expect(OutlinerEscapeGateAudit).toBeDefined()
    expect(typeof OutlinerEscapeGateAudit.render).toBe('function')
    expect(typeof OutlinerEscapeGateAudit.play).toBe('function')
  })

  it('UndoKeystrokeAudit is registered as the browser-only keyboard audit', () => {
    expect(UndoKeystrokeAudit).toBeDefined()
    expect(typeof UndoKeystrokeAudit.render).toBe('function')
    expect(typeof UndoKeystrokeAudit.play).toBe('function')
  })

  it('driving the REAL play() types "Tlön Uqbar" into the LIVE host editor (probeable organism)', async () => {
    const el = renderStory(LiveHost)

    // Drive the actual story play() against the real rendered host — exactly what
    // Storybook's test-runner does, but in happy-dom against the live editor.
    await (LiveHost.play as (ctx: { canvasElement: HTMLElement }) => Promise<void>)({
      canvasElement: el,
    })

    // The LIVE host editor's document now contains the typed phrase.
    const host = hostOf(el)!
    expect(host.liveEditor).not.toBeNull()
    expect(host.liveEditor!.getText()).toContain('Tlön Uqbar')
    // The graduated live body is real ProseMirror, not the placeholder.
    expect(host.shadowRoot?.querySelector('.ProseMirror')).not.toBeNull()
    expect(host.shadowRoot?.querySelector('.placeholder')).toBeNull()
  })

  it('PlaceholderHost.render() returns the host in its honest placeholder state (no live body)', async () => {
    const el = renderStory(PlaceholderHost)
    const host = hostOf(el)!
    await host.updateComplete
    expect(host.liveEditor).toBeNull()
    expect(host.shadowRoot?.querySelector('.placeholder')).not.toBeNull()
    expect(host.shadowRoot?.querySelector('.ProseMirror')).toBeNull()
  })
})
