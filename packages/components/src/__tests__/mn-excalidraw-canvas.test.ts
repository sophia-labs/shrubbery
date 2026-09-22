/**
 * REAL component test - mn-excalidraw-canvas controlled scene workbench.
 *
 * The element renders caller-owned scene state and emits composed intents. It
 * does not mount the drawing runtime, persist artifact revisions, project scene
 * elements, or mutate graph wires by itself.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '../mn-excalidraw-canvas.js'
import type {
  MnExcalidrawCanvas,
  MnSceneCanvasIntentDetail,
  MnSceneElementIntentDetail,
  MnSceneNodeLinkPickDetail,
  MnScenePredicateChangeDetail,
} from '../mn-excalidraw-canvas.js'
import type { MnNodeLinkPickDetail } from '../mn-node-link-picker.js'

async function mount(setup?: (el: MnExcalidrawCanvas) => void): Promise<MnExcalidrawCanvas> {
  const el = document.createElement('mn-excalidraw-canvas') as MnExcalidrawCanvas
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

function sr(el: MnExcalidrawCanvas): ShadowRoot {
  return el.shadowRoot!
}

function button(el: MnExcalidrawCanvas, action: string): HTMLButtonElement {
  return sr(el).querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!
}

describe('mn-excalidraw-canvas - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-excalidraw-canvas')).toBeDefined()
  })

  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders loading and error states from controlled props', async () => {
    const el = await mount(node => {
      node.title = 'Sketch'
      node.status = 'loading'
    })

    expect(sr(el).querySelector('mn-loading')).not.toBeNull()
    expect(sr(el).textContent).toContain('Sketch')

    el.status = 'error'
    el.error = 'surface unavailable'
    await el.updateComplete

    const empty = sr(el).querySelector('mn-empty-state')!
    expect(empty.getAttribute('title')).toBe('Scene canvas failed')
    expect(empty.getAttribute('description')).toBe('surface unavailable')
  })

  it('renders projection, wire summary, selected element, and diagnostics', async () => {
    const el = await mount(node => {
      node.status = 'ready'
      node.graphId = 'graph-a'
      node.artifactId = 'artifact-scene'
      node.projection = {
        anchors: 2,
        arrows: 3,
        wireCandidates: 1,
        diagnostics: 1,
        searchText: 'roadmap sketch',
      }
      node.wireSummary = {
        missing: 1,
        hydratable: 2,
        created: 4,
        hydrated: 5,
        lastMessage: 'Synced four wires',
      }
      node.selectedElement = {
        id: 'element-a',
        type: 'rectangle',
        label: 'Roadmap',
        linkKind: 'document',
        linkTargetId: 'doc-roadmap',
        linkTitle: 'Roadmap Document',
        predicate: 'supports',
      }
      node.predicateOptions = [
        { value: 'supports', label: 'supports' },
        { value: 'critiques', label: 'critiques' },
      ]
      node.diagnostics = [
        { code: 'link-target-missing', message: 'Linked target is missing', severity: 'error', sceneElementId: 'element-a' },
      ]
    })

    const text = sr(el).textContent ?? ''
    expect(text).toContain('2')
    expect(text).toContain('anchors')
    expect(text).toContain('roadmap sketch')
    expect(text).toContain('Hydratable wires')
    expect(text).toContain('Roadmap Document')
    expect(sr(el).querySelector('[data-selected-element-id="element-a"]')).not.toBeNull()
    expect(sr(el).querySelector('[data-diagnostic-code="link-target-missing"]')?.textContent).toContain('Linked target is missing')
  })

  it('emits toolbar intents with graph and artifact context', async () => {
    const el = await mount(node => {
      node.status = 'ready'
      node.graphId = 'graph-a'
      node.artifactId = 'artifact-scene'
      node.wireSummary = { missing: 1, hydratable: 1 }
    })
    const events: Record<string, MnSceneCanvasIntentDetail[]> = {
      'mn-excalidraw-reload': [],
      'mn-excalidraw-refresh-projection': [],
      'mn-excalidraw-refresh-link-titles': [],
      'mn-excalidraw-sync-wires': [],
      'mn-excalidraw-hydrate-wires': [],
      'mn-excalidraw-save': [],
    }
    for (const name of Object.keys(events)) {
      el.addEventListener(name, event => {
        events[name].push((event as CustomEvent<MnSceneCanvasIntentDetail>).detail)
      })
    }

    button(el, 'reload').click()
    button(el, 'refresh-projection').click()
    button(el, 'refresh-link-titles').click()
    button(el, 'sync-wires').click()
    button(el, 'hydrate-wires').click()
    button(el, 'save').click()

    for (const details of Object.values(events)) {
      expect(details).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-scene' }])
    }
  })

  it('emits selected-element and predicate-change intents', async () => {
    const el = await mount(node => {
      node.status = 'ready'
      node.graphId = 'graph-a'
      node.artifactId = 'artifact-scene'
      node.selectedElement = {
        id: 'element-a',
        label: 'Node',
        linkTargetId: 'doc-a',
        linkTitle: 'Document A',
        canRecreateTarget: true,
      }
      node.predicateOptions = [
        { value: 'supports', label: 'supports' },
        { value: 'critiques', label: 'critiques' },
      ]
    })
    const links: MnSceneElementIntentDetail[] = []
    const opens: MnSceneElementIntentDetail[] = []
    const recreates: MnSceneElementIntentDetail[] = []
    const removes: MnSceneElementIntentDetail[] = []
    const predicateChanges: MnScenePredicateChangeDetail[] = []
    el.addEventListener('mn-excalidraw-link-selected', event => {
      links.push((event as CustomEvent<MnSceneElementIntentDetail>).detail)
    })
    el.addEventListener('mn-excalidraw-open-selected-link', event => {
      opens.push((event as CustomEvent<MnSceneElementIntentDetail>).detail)
    })
    el.addEventListener('mn-excalidraw-recreate-target', event => {
      recreates.push((event as CustomEvent<MnSceneElementIntentDetail>).detail)
    })
    el.addEventListener('mn-excalidraw-remove-selected-link', event => {
      removes.push((event as CustomEvent<MnSceneElementIntentDetail>).detail)
    })
    el.addEventListener('mn-excalidraw-predicate-change', event => {
      predicateChanges.push((event as CustomEvent<MnScenePredicateChangeDetail>).detail)
    })

    button(el, 'link-selected').click()
    button(el, 'open-selected-link').click()
    button(el, 'recreate-target').click()
    button(el, 'remove-link').click()
    const select = sr(el).querySelector<HTMLSelectElement>('.predicate')!
    select.value = 'critiques'
    select.dispatchEvent(new Event('change', { bubbles: true, composed: true }))

    const detail = { graphId: 'graph-a', artifactId: 'artifact-scene', elementId: 'element-a' }
    expect(links).toEqual([detail])
    expect(opens).toEqual([detail])
    expect(recreates).toEqual([detail])
    expect(removes).toEqual([detail])
    expect(predicateChanges).toEqual([{ ...detail, predicate: 'critiques' }])
  })

  it('re-emits node-link picker selections with scene context', async () => {
    const el = await mount(node => {
      node.status = 'ready'
      node.graphId = 'graph-a'
      node.artifactId = 'artifact-scene'
      node.selectedElement = { id: 'element-a', label: 'Node' }
      node.nodeLinkPickerOpen = true
      node.linkCandidates = [
        { kind: 'document', id: 'doc-a', title: 'Document A', iconName: 'file-text' },
        { kind: 'artifact', id: 'artifact-a', title: 'Artifact A', mimeType: 'image/png', iconName: 'package' },
      ]
    })
    const picks: MnSceneNodeLinkPickDetail[] = []
    const closes: MnSceneElementIntentDetail[] = []
    el.addEventListener('mn-excalidraw-node-link-pick', event => {
      picks.push((event as CustomEvent<MnSceneNodeLinkPickDetail>).detail)
    })
    el.addEventListener('mn-excalidraw-node-link-picker-close', event => {
      closes.push((event as CustomEvent<MnSceneElementIntentDetail>).detail)
    })

    const picker = sr(el).querySelector('mn-node-link-picker')!
    picker.dispatchEvent(new CustomEvent<MnNodeLinkPickDetail>('mn-node-link-pick', {
      detail: {
        kind: 'artifact',
        id: 'artifact-a',
        title: 'Artifact A',
        mimeType: 'image/png',
      },
      bubbles: true,
      composed: true,
    }))
    picker.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))

    expect(picks).toEqual([
      {
        graphId: 'graph-a',
        artifactId: 'artifact-scene',
        elementId: 'element-a',
        kind: 'artifact',
        id: 'artifact-a',
        title: 'Artifact A',
        mimeType: 'image/png',
      },
    ])
    expect(closes).toEqual([{ graphId: 'graph-a', artifactId: 'artifact-scene', elementId: 'element-a' }])
  })
})
