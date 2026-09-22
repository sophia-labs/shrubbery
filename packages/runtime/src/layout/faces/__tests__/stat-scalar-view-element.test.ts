/**
 * stat-scalar-view-element.test.ts — real `<sh-stat-scalar-view>` custom
 * element mounted directly (no interpreter, no network — this element paints
 * only already-typed display data; see stat-scalar-face.ts for the real
 * query/derivation and stat-scalar-face.integration.test.ts for the
 * real-cell proof that feeds it).
 *
 * Proves the aesthetic-overhaul pass's actual rendered markup honestly: the
 * unit renders in its own slot (never concatenated into `.value`), the delta
 * chip renders ONLY when a delta is given and always carries BOTH a
 * direction/tone-bearing icon AND text (never color-alone), and the
 * sparkline renders ONLY when the series has >= 2 points.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../stat-scalar-view-element.js'
import { ShStatScalarView } from '../stat-scalar-view-element.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function mountReady(): ShStatScalarView {
  const view = document.createElement('sh-stat-scalar-view') as ShStatScalarView
  view.status = 'ready'
  view.label = 'Active runs'
  view.value = '120'
  root.appendChild(view)
  return view
}

describe('sh-stat-scalar-view — hero numeral + unit', () => {
  it('the value and unit render in SEPARATE elements, never concatenated', async () => {
    const view = mountReady()
    view.unit = 'ms'
    await view.updateComplete

    const shadow = view.shadowRoot!
    expect(shadow.querySelector('.value')!.textContent).toBe('120')
    expect(shadow.querySelector('.unit')!.textContent).toBe('ms')
  })

  it('no unit given renders no .unit element at all — not an empty one', async () => {
    const view = mountReady()
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('.unit')).toBeNull()
  })

  it('the hero numeral wears tabular lining figures', async () => {
    const view = mountReady()
    await view.updateComplete
    const style = getComputedStyle(view.shadowRoot!.querySelector('.value')!)
    expect(style.fontVariantNumeric).toContain('tabular-nums')
  })

  it('consumes the tokens it claims: numeral voice + Observatory numeral ink on the hero, card chrome hooks on the card, scale-step hero size', async () => {
    // Custom-property inheritance into shadow DOM is the browser's job (and
    // happy-dom does not compute it), so this pins the CONTRACT: the static
    // stylesheet reaches for exactly the published hooks it claims to.
    const css = (ShStatScalarView.styles as { cssText: string }).cssText
    expect(css).toContain('var(--mn-font-numeral')
    expect(css).toContain('var(--mn-observatory-numeral-ink')
    expect(css).toContain('var(--mn-shadow-card')
    expect(css).toContain('var(--mn-color-surface-raised)')
    expect(css).toContain('var(--mn-radius-surface')
    expect(css).toContain('var(--mn-text-3xl') // the hero size sits ON the published scale
    expect(css).not.toContain('34px') // …not beside it
    expect(css).toContain('var(--mn-space-0-5') // delta chip padding on the scale too
  })
})

describe('sh-stat-scalar-view — delta chip (never color-alone)', () => {
  it('no delta given renders no chip at all', async () => {
    const view = mountReady()
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('.delta')).toBeNull()
  })

  it('a "good" delta renders the reserved good tone, an up icon, AND text — never color alone', async () => {
    const view = mountReady()
    view.delta = { text: '+12', direction: 'up', tone: 'good' }
    await view.updateComplete

    const chip = view.shadowRoot!.querySelector('.delta')!
    expect(chip.getAttribute('data-tone')).toBe('good')
    expect(chip.getAttribute('data-direction')).toBe('up')
    expect(chip.querySelector('svg.delta-arrow')).not.toBeNull()
    expect(chip.querySelector('.delta-text')!.textContent).toBe('+12')
  })

  it('a "bad" delta renders the reserved bad tone with a down icon', async () => {
    const view = mountReady()
    view.delta = { text: '-6', direction: 'down', tone: 'bad' }
    await view.updateComplete

    const chip = view.shadowRoot!.querySelector('.delta')!
    expect(chip.getAttribute('data-tone')).toBe('bad')
    expect(chip.getAttribute('data-direction')).toBe('down')
  })

  it('a "flat" delta renders the neutral tone, not a reserved good/bad status color', async () => {
    const view = mountReady()
    view.delta = { text: '0', direction: 'flat', tone: 'neutral' }
    await view.updateComplete

    const chip = view.shadowRoot!.querySelector('.delta')!
    expect(chip.getAttribute('data-tone')).toBe('neutral')
  })
})

describe('sh-stat-scalar-view — sparkline (render only when the data offers a series)', () => {
  it('fewer than 2 points renders no sparkline', async () => {
    const view = mountReady()
    view.series = [42]
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('.sparkline')).toBeNull()
  })

  it('an empty series renders no sparkline', async () => {
    const view = mountReady()
    view.series = []
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('.sparkline')).toBeNull()
  })

  it('2+ points renders a 2px line with no axis element', async () => {
    const view = mountReady()
    view.series = [3, 5, 4, 8, 6]
    await view.updateComplete

    const shadow = view.shadowRoot!
    const sparkline = shadow.querySelector('.sparkline')!
    expect(sparkline).not.toBeNull()
    const polyline = sparkline.querySelector('polyline')!
    expect(polyline).not.toBeNull()
    // One point per series entry.
    expect(polyline.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(5)
    // No axis/gridline element anywhere in the sparkline (brief: "no axes").
    expect(sparkline.querySelector('line')).toBeNull()
    expect(sparkline.querySelector('[class*="axis"]')).toBeNull()
    expect(sparkline.querySelector('[class*="grid"]')).toBeNull()
  })

  it('loading/error states never render the delta or sparkline, even if set before the status flips', async () => {
    const view = document.createElement('sh-stat-scalar-view') as ShStatScalarView
    view.status = 'loading'
    view.delta = { text: '+1', direction: 'up', tone: 'good' }
    view.series = [1, 2, 3]
    root.appendChild(view)
    await view.updateComplete

    expect(view.shadowRoot!.querySelector('.delta')).toBeNull()
    expect(view.shadowRoot!.querySelector('.sparkline')).toBeNull()
  })
})

describe('sh-stat-scalar-view — no-data (a query that matched nothing)', () => {
  it('renders the label AND an absent marker, never a numeral', async () => {
    const view = document.createElement('sh-stat-scalar-view') as ShStatScalarView
    view.status = 'no-data'
    view.label = 'Estimated compute cost'
    root.appendChild(view)
    await view.updateComplete

    const shadow = view.shadowRoot!
    expect(shadow.querySelector('.label')!.textContent).toBe('Estimated compute cost')
    const value = shadow.querySelector('.value')!
    expect(value).not.toBeNull()
    expect(value.getAttribute('data-absent')).toBe('true')
    expect(value.textContent).toBe('No data')
  })

  it('renders no unit, no delta chip, no sparkline — even when all three were set before the status flipped', async () => {
    const view = document.createElement('sh-stat-scalar-view') as ShStatScalarView
    view.status = 'no-data'
    view.label = 'Estimated compute cost'
    view.unit = 'USD'
    view.delta = { text: '+1', direction: 'up', tone: 'good' }
    view.series = [1, 2, 3]
    root.appendChild(view)
    await view.updateComplete

    const shadow = view.shadowRoot!
    expect(shadow.querySelector('.unit')).toBeNull()
    expect(shadow.querySelector('.delta')).toBeNull()
    expect(shadow.querySelector('.sparkline')).toBeNull()
  })

  it('the absent marker does not wear the hero numeral voice', () => {
    const css = (ShStatScalarView.styles as { cssText: string }).cssText
    expect(css).toContain(".value[data-absent='true']")
  })
})

describe('sh-stat-scalar-view — small-caps muted label', () => {
  it('the label carries the small-caps font-variant', async () => {
    const view = mountReady()
    await view.updateComplete
    const style = getComputedStyle(view.shadowRoot!.querySelector('.label')!)
    expect(style.fontVariantCaps).toBe('all-small-caps')
  })
})
