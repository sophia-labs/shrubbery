import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-zotero-source-workbench.js'
import type {
  MnZoteroSourceAnnotation,
  MnZoteroSourceIncomingWire,
  MnZoteroSourceItem,
  MnZoteroSourceOpenDocumentDetail,
  MnZoteroSourceOpenTagDetail,
  MnZoteroSourceOpenZoteroDetail,
  MnZoteroSourcePromoteAnnotationDetail,
  MnZoteroSourceWorkbench,
} from '../mn-zotero-source-workbench.js'

const item: MnZoteroSourceItem = {
  key: 'A1',
  title: 'Situated Cognition',
  creatorSummary: 'Brown et al.',
  year: '1989',
  itemType: 'journalArticle',
  abstractNote: 'Learning and cognition are fundamentally situated.',
  tags: ['Cognition', 'Practice', 'cognition'],
}

const annotations: readonly MnZoteroSourceAnnotation[] = [
  {
    key: 'ann-1',
    kind: 'highlight',
    text: 'Knowledge is situated.',
    comment: 'Core claim.',
    color: '#facc15',
    page: '42',
  },
]

const incomingWires: readonly MnZoteroSourceIncomingWire[] = [
  {
    id: 'wire-1',
    predicateLabel: 'quotes from',
    otherDocumentId: 'doc-reading',
    otherTitle: 'Reading Notes',
    otherSnippet: 'This note grounds a learning claim.',
  },
]

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnZoteroSourceWorkbench) => void): Promise<MnZoteroSourceWorkbench> {
  const el = document.createElement('mn-zotero-source-workbench') as MnZoteroSourceWorkbench
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-zotero-source-workbench', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders controlled source, annotation, wire, and rail data', async () => {
    const el = await mount(panel => {
      panel.artifactId = 'zot-A1'
      panel.graphId = 'graph-a'
      panel.item = item
      panel.annotations = annotations
      panel.incomingWires = incomingWires
    })

    expect(customElements.get('mn-zotero-source-workbench')).toBeDefined()
    expect(sr(el).querySelector('[data-zotero-source-workbench]')).not.toBeNull()
    expect(sr(el).querySelector('h1')?.textContent).toBe('Situated Cognition')
    expect(sr(el).querySelector('.byline')?.textContent?.trim()).toBe('Brown et al. - 1989 - A1')
    expect(sr(el).querySelector<HTMLAnchorElement>('[data-zotero-open]')?.href).toBe('zotero://select/library/items/A1')
    expect(sr(el).querySelector('[data-zotero-annotation] .quote')?.textContent).toBe('Knowledge is situated.')
    expect(sr(el).querySelector('[data-zotero-annotation] .note')?.textContent).toBe('Core claim.')
    expect(sr(el).querySelector('[data-zotero-incoming] .snip')?.textContent).toBe('This note grounds a learning claim.')
    expect(Array.from(sr(el).querySelectorAll('[data-zotero-tag]')).map(tag => tag.textContent?.trim())).toEqual([
      '#Cognition',
      '#Practice',
    ])
    expect(sr(el).querySelector('.abstract')?.textContent).toBe('Learning and cognition are fundamentally situated.')
    expect(sr(el).querySelector('[data-zotero-type]')?.textContent).toBe('journalArticle')
  })

  it('emits open, reload, tag, document, and promotion intents without owning side effects', async () => {
    const el = await mount(panel => {
      panel.artifactId = 'zot-A1'
      panel.graphId = 'graph-a'
      panel.item = item
      panel.annotations = annotations
      panel.incomingWires = incomingWires
    })
    const openedZotero: MnZoteroSourceOpenZoteroDetail[] = []
    const reloads: unknown[] = []
    const tags: MnZoteroSourceOpenTagDetail[] = []
    const documents: MnZoteroSourceOpenDocumentDetail[] = []
    const promotions: MnZoteroSourcePromoteAnnotationDetail[] = []
    el.addEventListener('mn-zotero-source-open-zotero', event => {
      openedZotero.push((event as CustomEvent<MnZoteroSourceOpenZoteroDetail>).detail)
    })
    el.addEventListener('mn-zotero-source-reload', event => {
      reloads.push((event as CustomEvent).detail)
    })
    el.addEventListener('mn-zotero-source-open-tag', event => {
      tags.push((event as CustomEvent<MnZoteroSourceOpenTagDetail>).detail)
    })
    el.addEventListener('mn-zotero-source-open-document', event => {
      documents.push((event as CustomEvent<MnZoteroSourceOpenDocumentDetail>).detail)
    })
    el.addEventListener('mn-zotero-source-promote-annotation', event => {
      promotions.push((event as CustomEvent<MnZoteroSourcePromoteAnnotationDetail>).detail)
    })

    sr(el).querySelector<HTMLAnchorElement>('[data-zotero-open]')!.click()
    sr(el).querySelectorAll<HTMLButtonElement>('[data-zotero-reload]')[0]!.click()
    sr(el).querySelector<HTMLButtonElement>('[data-zotero-tag-name="Cognition"]')!.click()
    sr(el).querySelector<HTMLButtonElement>('[data-zotero-incoming]')!.click()
    sr(el).querySelector<HTMLButtonElement>('[data-zotero-promote]')!.click()

    expect(openedZotero).toEqual([
      { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', url: 'zotero://select/library/items/A1' },
    ])
    expect(reloads).toEqual([{ artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a' }])
    expect(tags).toEqual([
      { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', tag: 'Cognition', normalizedTag: 'cognition' },
    ])
    expect(documents).toEqual([
      { artifactId: 'zot-A1', zoteroKey: 'A1', graphId: 'graph-a', documentId: 'doc-reading', wire: incomingWires[0] },
    ])
    expect(promotions).toEqual([
      {
        artifactId: 'zot-A1',
        zoteroKey: 'A1',
        graphId: 'graph-a',
        annotation: annotations[0],
        annotationKey: 'ann-1',
        citation: 'Brown et al. (1989)',
      },
    ])
  })

  it('renders loading, error, empty, and promoted states from controlled props', async () => {
    const el = await mount(panel => {
      panel.artifactId = 'zot-A1'
      panel.item = { key: 'A1', label: 'Fallback Label', itemType: 'book' }
      panel.loading = true
      panel.error = 'Could not reach Zotero.'
      panel.annotations = annotations
      panel.promotedAnnotationKeys = new Set(['ann-1'])
    })

    expect(sr(el).querySelector('h1')?.textContent).toBe('Fallback Label')
    expect(sr(el).querySelector('[data-zotero-loading]')?.textContent).toBe('Resolving from Zotero...')
    expect(sr(el).querySelector('[data-zotero-error]')?.textContent).toBe('Could not reach Zotero.')
    expect(sr(el).querySelector('[data-zotero-promote]')).toBeNull()
    expect(sr(el).querySelector('.promoted')?.textContent).toContain('Promoted')
    expect(sr(el).querySelector('section:nth-of-type(2) .empty')?.textContent).toContain('Nothing cites this source yet')
  })
})
