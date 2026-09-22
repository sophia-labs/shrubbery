/**
 * subject-card-view-element.test.ts — real `<sh-subject-card-view>` custom
 * element mounted directly. Proves the aesthetic-overhaul pass's shared
 * typographic hierarchy with `stat.scalar`: small-caps muted field labels,
 * and tabular figures on numeric-looking field values, derived from the
 * REAL already-selected `SubjectCardField[]` (never re-queried here — see
 * card-subject-face.ts / card-subject-face.integration.test.ts for the real
 * `?p ?o` query and field selection).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../subject-card-view-element.js'
import { ShSubjectCardView } from '../subject-card-view-element.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function mountReady(): ShSubjectCardView {
  const view = document.createElement('sh-subject-card-view') as ShSubjectCardView
  view.status = 'ready'
  view.subjectIri = 'urn:x:subject'
  view.title = 'the-witness'
  root.appendChild(view)
  return view
}

describe('sh-subject-card-view — shared typographic hierarchy with stat.scalar', () => {
  it('field labels (dt) carry the same small-caps muted treatment as .label', async () => {
    const view = mountReady()
    view.fields = [{ label: 'urn:x#expectedSeq', value: '10' }]
    await view.updateComplete

    const dt = view.shadowRoot!.querySelector('dt')!
    const style = getComputedStyle(dt)
    expect(style.fontVariantCaps).toBe('all-small-caps')
  })

  it('a numeric-looking field value gets data-numeric + tabular figures', async () => {
    const view = mountReady()
    view.fields = [
      { label: 'urn:x#expectedSeq', value: '10' },
      { label: 'urn:x#witness', value: 'the-witness' },
    ]
    await view.updateComplete

    const dds = view.shadowRoot!.querySelectorAll('dd')
    expect(dds[0].hasAttribute('data-numeric')).toBe(true)
    expect(dds[1].hasAttribute('data-numeric')).toBe(false)
  })

  it('an empty field value ("—" placeholder) is never classified numeric', async () => {
    const view = mountReady()
    view.fields = [{ label: 'urn:x#missing', value: '' }]
    await view.updateComplete

    const dd = view.shadowRoot!.querySelector('dd')!
    expect(dd.hasAttribute('data-numeric')).toBe(false)
    expect(dd.textContent).toBe('—')
  })
})

describe('sh-subject-card-view — token consumption contract', () => {
  it('shares stat.scalar\'s card chrome hooks and sits on the published type scale', () => {
    const css = (ShSubjectCardView.styles as { cssText: string }).cssText
    expect(css).toContain('var(--mn-shadow-card')
    expect(css).toContain('var(--mn-color-surface-raised)')
    expect(css).toContain('var(--mn-radius-surface')
    expect(css).toContain('var(--mn-text-md') // the title size sits ON the published scale
    expect(css).not.toContain('17px') // …not beside it
  })
})
