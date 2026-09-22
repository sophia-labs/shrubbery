/**
 * object-card-view-element.test.ts — real `<sh-object-card-view>` custom
 * element mounted directly (WS1 §9 S3, master spec §3 Slice 2 "the healthy
 * card"). Fields are already-selected `ObjectCardField[]` (never re-queried
 * here — see card-object-face.ts / card-object-face.integration.test.ts for
 * the real read + field selection).
 *
 * Includes the structural `.mn-kind[data-kind=…]` proof (mirrors
 * `display-kind.test.ts`'s method: read `kind.css` from disk, assert a real
 * `matches()`) AND the stronger real-application proof this file's own header
 * (object-card-view-element.ts) calls out: the element attached to a real
 * `document.body` (not a detached fragment), asserting `getComputedStyle` on
 * an `identity`-kinded node INSIDE the shadow root actually resolves
 * `font-weight: 650` — attribute-matching alone cannot tell "styled" from
 * "inert markup that merely satisfies a selector."
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../object-card-view-element.js'
import { ShObjectCardView, type ObjectCardField } from '../object-card-view-element.js'

const KIND_CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../tokens/css/kind.css')

/** Every kind-scoped selector kind.css declares, read from disk (mirrors display-kind.test.ts's method). */
function kindCssSelectors(): readonly string[] {
  const css = readFileSync(KIND_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors: string[] = []
  for (const match of css.matchAll(/(?:^|\})([^{}]+)\{/g)) {
    const selector = match[1].trim()
    if (selector.includes('[data-kind=')) selectors.push(selector.replace(/::[a-z-]+$/, ''))
  }
  return selectors
}

function selectorFor(kind: string): string {
  const selector = kindCssSelectors().find((s) => s === `.mn-kind[data-kind="${kind}"]`)
  if (!selector) throw new Error(`kind.css declares no bare .mn-kind[data-kind="${kind}"] selector`)
  return selector
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function mountReady(overrides: Partial<ShObjectCardView> = {}): ShObjectCardView {
  const view = document.createElement('sh-object-card-view') as ShObjectCardView
  view.status = 'ready'
  view.objectKey = 'koch-morseBookmarkabc'
  view.vocab = 'koch-morse'
  view.className_ = 'Bookmark'
  view.objectId = 'abc'
  view.title = 'My Bookmark'
  view.provenance = 'mirror'
  view.epoch = 'inc-1:3:hash'
  Object.assign(view, overrides)
  root.appendChild(view)
  return view
}

describe('sh-object-card-view — data-kind selectors match kind.css, read from disk', () => {
  it('an identity-kinded node matches the real kind.css selector structurally', async () => {
    const view = mountReady()
    await view.updateComplete
    const node = view.shadowRoot!.querySelector('.class-line .mn-kind')!
    expect(node.matches(selectorFor('identity'))).toBe(true)
  })

  it('a testimony-kinded byline matches the real kind.css selector when a last writer is present', async () => {
    const view = mountReady({ lastWriter: 'offline-client' })
    await view.updateComplete
    const node = view.shadowRoot!.querySelector('.writer .mn-kind')!
    expect(node.matches(selectorFor('testimony'))).toBe(true)
  })

  it('an absent field (state kind) matches the real kind.css selector', async () => {
    const fields: readonly ObjectCardField[] = [{ label: 'x', fullLabel: 'x', value: '', kind: 'state', absent: true }]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const node = view.shadowRoot!.querySelector('dl.record .mn-kind')!
    expect(node.matches(selectorFor('state'))).toBe(true)
  })

  it('a metric field matches the real kind.css selector', async () => {
    const fields: readonly ObjectCardField[] = [{ label: 'x', fullLabel: 'x', value: '20', kind: 'metric' }]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const node = view.shadowRoot!.querySelector('dl.record .mn-kind')!
    expect(node.matches(selectorFor('metric'))).toBe(true)
  })

  it('a reference field matches the real kind.css selector', async () => {
    const fields: readonly ObjectCardField[] = [
      { label: 'x', fullLabel: 'x', value: 'https://x', kind: 'reference', href: 'https://x' },
    ]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const node = view.shadowRoot!.querySelector('dl.record .mn-kind')!
    expect(node.matches(selectorFor('reference'))).toBe(true)
  })

  it('a prose (nested) field matches the real kind.css selector', async () => {
    const fields: readonly ObjectCardField[] = [{ label: 'x', fullLabel: 'x', value: '[]', kind: 'prose', nested: true }]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const node = view.shadowRoot!.querySelector('dl.record .mn-kind')!
    expect(node.matches(selectorFor('prose'))).toBe(true)
  })
})

describe('sh-object-card-view — REAL application, not just matching markup (attached to a real document.body)', () => {
  it('font-weight: 650 (kind.css\'s own identity declaration) actually resolves via getComputedStyle inside the shadow root', async () => {
    const view = mountReady()
    expect(view.isConnected).toBe(true)
    expect(document.body.contains(view)).toBe(true)
    await view.updateComplete
    const node = view.shadowRoot!.querySelector('.class-line .mn-kind[data-kind="identity"]')!
    const style = getComputedStyle(node)
    expect(style.fontWeight).toBe('650')
  })
})

describe('sh-object-card-view — states', () => {
  it('loading renders the loading copy, no dl, no footer', async () => {
    const view = document.createElement('sh-object-card-view') as ShObjectCardView
    root.appendChild(view)
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('Loading…')
    expect(view.shadowRoot!.querySelector('dl.record')).toBeNull()
  })

  it('empty renders the honest absence copy naming the object/vocab/class, no dl', async () => {
    const view = document.createElement('sh-object-card-view') as ShObjectCardView
    view.status = 'empty'
    view.objectId = 'abc'
    view.vocab = 'koch-morse'
    view.className_ = 'Bookmark'
    root.appendChild(view)
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('No object abc in koch-morse.Bookmark for this graph.')
    expect(view.shadowRoot!.querySelector('dl.record')).toBeNull()
  })

  /**
   * Master §2.5's empty-selection locator (`{kind:'graph', graphId}`, no
   * `subjectIri`) resolves through this SAME `status:'empty'` path — the
   * contested split (Slice 5) mints this leaf on every render, including
   * before anything is selected. Distinguished from a real, named object
   * that genuinely does not exist (above) by `objectId`/`vocab`/
   * `className_` staying '' — never a new property, never a guess.
   */
  it('empty with NO objectId/vocab/className_ renders "Choose an object…", never "No object  in .  for this graph."', async () => {
    const view = document.createElement('sh-object-card-view') as ShObjectCardView
    view.status = 'empty'
    root.appendChild(view)
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('Choose an object to see what was proposed.')
    expect(view.shadowRoot!.textContent).not.toContain('No object')
    expect(view.shadowRoot!.querySelector('dl.record')).toBeNull()
  })

  it('error renders the underlying message verbatim', async () => {
    const view = document.createElement('sh-object-card-view') as ShObjectCardView
    view.status = 'error'
    view.error = 'cannot confirm graph incarnation'
    root.appendChild(view)
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('cannot confirm graph incarnation')
  })

  it('ready with an empty record renders the honest no-fields copy', async () => {
    const view = mountReady({ fields: [], shownOf: 0 })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('This object has no recorded fields.')
  })
})

describe('sh-object-card-view — record fields', () => {
  function fieldRow(view: ShObjectCardView, index: number): { dt: Element; dd: Element } {
    const dts = view.shadowRoot!.querySelectorAll('dl.record dt')
    const dds = view.shadowRoot!.querySelectorAll('dl.record dd')
    return { dt: dts[index], dd: dds[index] }
  }

  it('renders label/value pairs and reflects fullLabel via title=', async () => {
    const fields: readonly ObjectCardField[] = [
      { label: 'title', fullLabel: 'title', value: 'My Bookmark', kind: 'state' },
    ]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const { dt, dd } = fieldRow(view, 0)
    expect(dt.textContent).toBe('title')
    expect(dt.getAttribute('title')).toBe('title')
    expect(dd.textContent?.trim()).toBe('My Bookmark')
  })

  it('an absent field renders an em dash with the "No value recorded." title', async () => {
    const fields: readonly ObjectCardField[] = [
      { label: 'note', fullLabel: 'note', value: '', kind: 'state', absent: true },
    ]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const { dd } = fieldRow(view, 0)
    expect(dd.textContent?.trim()).toBe('—')
    expect(dd.querySelector('[title]')?.getAttribute('title')).toBe('No value recorded.')
  })

  it('a nested field renders the JSON-shown title and the JSON text', async () => {
    const fields: readonly ObjectCardField[] = [
      { label: 'tags', fullLabel: 'tags', value: '["a","b"]', kind: 'prose', nested: true },
    ]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const { dd } = fieldRow(view, 0)
    expect(dd.textContent).toContain('["a","b"]')
    expect(dd.querySelector('[title]')?.getAttribute('title')).toMatch(/structured value, shown as JSON/)
  })

  it('a reference field renders a real <a href> to exactly the field value', async () => {
    const fields: readonly ObjectCardField[] = [
      { label: 'url', fullLabel: 'url', value: 'https://example.test/x', kind: 'reference', href: 'https://example.test/x' },
    ]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const link = view.shadowRoot!.querySelector('dl.record a')!
    expect(link.getAttribute('href')).toBe('https://example.test/x')
  })

  it('a metric field renders its unit beside the value', async () => {
    const fields: readonly ObjectCardField[] = [
      { label: 'characterWpm', fullLabel: 'characterWpm', value: '20', kind: 'metric', unit: 'wpm' },
    ]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    const { dd } = fieldRow(view, 0)
    expect(dd.textContent?.trim()).toBe('20wpm')
  })

  it('truncation note shows "Showing N of M fields." when shownOf differs from the rendered count', async () => {
    const fields: readonly ObjectCardField[] = [{ label: 'a', fullLabel: 'a', value: '1', kind: 'metric' }]
    const view = mountReady({ fields, shownOf: 4 })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('Showing 1 of 4 fields.')
  })

  it('no truncation note when shownOf equals the rendered count', async () => {
    const fields: readonly ObjectCardField[] = [{ label: 'a', fullLabel: 'a', value: '1', kind: 'metric' }]
    const view = mountReady({ fields, shownOf: 1 })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).not.toContain('Showing')
  })
})

describe('sh-object-card-view — footer testimony', () => {
  it('strategy chip renders the known label with its title=', async () => {
    const view = mountReady({ reconciliationStrategy: 'producer-directed' })
    await view.updateComplete
    const chip = view.shadowRoot!.querySelector('.strategy .chip')!
    expect(chip.textContent).toBe('producer-directed')
    expect(chip.getAttribute('title')).toBe('How this class reconciles concurrent writes.')
  })

  it('strategy chip renders the honest-absence copy when unavailable', async () => {
    const view = mountReady({ reconciliationStrategy: '', unavailable: ['reconciliationStrategy'] })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('reconciliation not read')
  })

  it('version renders the first 8 hex chars, full hash in title=', async () => {
    const view = mountReady({ sourceVersion: 'abcdef0123456789' })
    await view.updateComplete
    const version = view.shadowRoot!.querySelector('.version')!
    expect(version.textContent).toBe('source abcdef01')
    expect(version.getAttribute('title')).toBe('abcdef0123456789')
  })

  it('version renders the honest-absence copy when unavailable', async () => {
    const view = mountReady({ sourceVersion: '', unavailable: ['sourceVersion'] })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('source version not read')
  })

  it('last writer known renders a testimony byline with the client id', async () => {
    const view = mountReady({ lastWriter: 'offline-client' })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('offline-client')
    const testimonyNode = view.shadowRoot!.querySelector('.writer .mn-kind[data-kind="testimony"]')
    expect(testimonyNode).not.toBeNull()
  })

  it('last writer absent renders the honest absence line — includes resolved heads and pre-Ask-A alike, same copy either way', async () => {
    const view = mountReady({ lastWriter: '' })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('Last writer not recorded by this cell.')
  })

  it('provenance mirror renders the epoch', async () => {
    const view = mountReady({ provenance: 'mirror', epoch: 'inc-1:3:hash' })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain('from the local mirror, epoch inc-1:3:hash')
  })

  it('provenance authority renders the live-projection copy AND the authority-path caveat', async () => {
    const view = mountReady({ provenance: 'authority-projection' })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).toContain("read live from the cell's projection")
    expect(view.shadowRoot!.textContent).toContain(
      'Source version, reconciliation strategy, and proposals are not available from this read.',
    )
  })

  it('the authority-path caveat does NOT render on the mirror path', async () => {
    const view = mountReady({ provenance: 'mirror' })
    await view.updateComplete
    expect(view.shadowRoot!.textContent).not.toContain('are not available from this read')
  })
})

describe('sh-object-card-view — data-provenance / data-attribution reflect on :host', () => {
  it('data-provenance reflects the current provenance', async () => {
    const view = mountReady({ provenance: 'mirror' })
    await view.updateComplete
    expect(view.dataset.provenance).toBe('mirror')
  })

  it('data-attribution reflects unrecorded by default (pre-Ask-A)', async () => {
    const view = mountReady()
    await view.updateComplete
    expect(view.dataset.attribution).toBe('unrecorded')
  })

  it('data-attribution reflects recorded when the flag is set', async () => {
    const view = mountReady({ attributionRecorded: true })
    await view.updateComplete
    expect(view.dataset.attribution).toBe('recorded')
  })
})
