/**
 * REAL mn-ribbon test — the general, skin-aware segmented ribbon in BOTH skins.
 * NO MOCKS.
 *
 * Asserts: one segment per input, the active highlight, optional labels, the
 * `mn-ribbon-select` event payload (order/value/label), the segment tints route
 * to skin ACCENT ramp role tokens (the lift rebound them off garden's primary
 * ramp), and the host mirrors the ambient skin (square segments under Emporium).
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-ribbon.js'
import type { MnRibbon, MnRibbonSegment } from '../mn-ribbon.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']

const SEGMENTS: MnRibbonSegment[] = [
  { label: 'Perceive', title: 'observe' },
  { label: 'Refine', title: 'middle' },
  { label: 'Judge', title: 'review', value: 'judge' },
]

async function mount(skin: Skin, props: Partial<MnRibbon> = {}): Promise<MnRibbon> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-ribbon') as MnRibbon
  Object.assign(el, props)
  host.appendChild(el)
  await el.updateComplete
  return el
}

function styleText(el: HTMLElement): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
})

describe('mn-ribbon — renders segments (real element, both skins)', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] renders one segment per input`, async () => {
      const el = await mount(skin, { segments: SEGMENTS })
      expect(el.shadowRoot!.querySelectorAll('.segment').length).toBe(3)
    })

    it(`[skin=${skin}] renders NOTHING with no segments`, async () => {
      const el = await mount(skin, { segments: [] })
      expect(el.shadowRoot!.querySelector('.ribbon')).toBeNull()
    })

    it(`[skin=${skin}] active highlights the matching 1-based segment`, async () => {
      const el = await mount(skin, { segments: SEGMENTS, active: 2 })
      const segs = Array.from(el.shadowRoot!.querySelectorAll('.segment'))
      expect(segs[1].classList.contains('active')).toBe(true)
      expect(segs[0].classList.contains('active')).toBe(false)
    })

    it(`[skin=${skin}] showLabels renders the per-segment caption row`, async () => {
      const el = await mount(skin, { segments: SEGMENTS, showLabels: true })
      const labels = Array.from(el.shadowRoot!.querySelectorAll('.labels span')).map(
        (s) => s.textContent,
      )
      expect(labels).toEqual(['Perceive', 'Refine', 'Judge'])
    })

    it(`[skin=${skin}] clicking a segment emits mn-ribbon-select with order/value/label`, async () => {
      const el = await mount(skin, { segments: SEGMENTS })
      let detail: { order: number; value: unknown; label: string } | null = null
      el.addEventListener('mn-ribbon-select', (e) => {
        detail = (e as CustomEvent).detail
      })
      const segs = el.shadowRoot!.querySelectorAll('.segment')
      ;(segs[2] as HTMLButtonElement).click()
      expect(detail).toEqual({ order: 3, value: 'judge', label: 'Judge' })
      // a segment with no explicit value reports its 1-based order.
      ;(segs[0] as HTMLButtonElement).click()
      expect(detail).toEqual({ order: 1, value: 1, label: 'Perceive' })
    })
  }
})

describe('mn-ribbon — token-driven tints + structure', () => {
  it('segment tints come from inline styles routing to ACCENT ramp role tokens', async () => {
    const el = await mount('emporium', { segments: SEGMENTS })
    const fills = Array.from(el.shadowRoot!.querySelectorAll('.segment')).map((s) =>
      (s as HTMLElement).getAttribute('style'),
    )
    for (const f of fills) {
      expect(f).toMatch(/var\(--mn-color-(accent|surface-accent|border-accent)/)
      // the lift rebound the ramp off garden's --mn-color-primary-* tokens.
      expect(f).not.toMatch(/primary-\d/)
    }
  })

  const css = styleText(document.createElement('mn-ribbon'))
  it('carries a :host([data-skin=emporium]) structural rule (square segments)', () => {
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)\s*\.segment[\s\S]*border-radius:\s*0/)
  })
})

describe('mn-ribbon — skin-aware host mirroring', () => {
  it('emporium → mirrored data-skin; garden → none', async () => {
    const emp = await mount('emporium', { segments: SEGMENTS })
    const garden = await mount('garden', { segments: SEGMENTS })
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
  })
})
