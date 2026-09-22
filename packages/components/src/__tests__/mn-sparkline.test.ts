/**
 * REAL mn-sparkline test — the general, skin-aware sparkline in BOTH skins. NO MOCKS.
 *
 * Asserts: the pure math (a polyline with N points over a band + a last-point
 * dot), < 2 finite points renders nothing (no faked baseline), the stroke routes
 * to a skin ROLE token per tone (so it recolors per skin — the lift rebound it
 * off garden's primary ramp), and the host mirrors the ambient skin.
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-sparkline.js'
import type { MnSparkline, MnSparklineTone } from '../mn-sparkline.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']
const TONES: MnSparklineTone[] = ['accent', 'success', 'warning', 'danger', 'muted']

async function mount(skin: Skin, props: Partial<MnSparkline> = {}): Promise<MnSparkline> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-sparkline') as MnSparkline
  Object.assign(el, props)
  host.appendChild(el)
  await el.updateComplete
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
})

describe('mn-sparkline — pure plotting (real SVG, both skins)', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] plots a polyline with one point per value + a last dot`, async () => {
      const el = await mount(skin, { values: [1, 4, 2, 8, 5] })
      const poly = el.shadowRoot!.querySelector('polyline') as SVGPolylineElement
      expect(poly).not.toBeNull()
      const pts = poly.getAttribute('points')!.trim().split(/\s+/)
      expect(pts.length).toBe(5)
      expect(el.shadowRoot!.querySelector('circle')).not.toBeNull()
    })

    it(`[skin=${skin}] renders NOTHING for < 2 finite points (no faked baseline)`, async () => {
      const el = await mount(skin, { values: [3] })
      expect(el.shadowRoot!.querySelector('svg')).toBeNull()
      const el2 = await mount(skin, { values: [NaN, Infinity] })
      expect(el2.shadowRoot!.querySelector('svg')).toBeNull()
    })

    it(`[skin=${skin}] honors width/height + hint`, async () => {
      const el = await mount(skin, { values: [1, 2], width: 120, height: 30, hint: 'tokens/run' })
      const svg = el.shadowRoot!.querySelector('svg')!
      expect(svg.getAttribute('width')).toBe('120')
      expect(svg.getAttribute('height')).toBe('30')
      expect(svg.getAttribute('aria-label')).toBe('tokens/run')
    })
  }
})

describe('mn-sparkline — token-driven stroke per tone (recolors per skin)', () => {
  for (const tone of TONES) {
    it(`tone=${tone} strokes with a skin role token (not a raw ramp)`, async () => {
      const el = await mount('emporium', { values: [1, 5, 3], tone })
      const stroke = el.shadowRoot!.querySelector('polyline')!.getAttribute('stroke')!
      expect(stroke).toMatch(/^var\(--mn-color-/)
      // the lift rebound the default off garden's --mn-color-primary-* ramp.
      expect(stroke).not.toMatch(/primary-5\d\d/)
    })
  }

  it('default tone is the ACCENT role token (purple in Emporium, fern in Garden)', async () => {
    const el = await mount('garden', { values: [1, 2, 3] })
    expect(el.shadowRoot!.querySelector('polyline')!.getAttribute('stroke')).toContain(
      'var(--mn-color-accent',
    )
  })
})

describe('mn-sparkline — skin-aware host mirroring', () => {
  it('emporium → mirrored data-skin; garden → none', async () => {
    const emp = await mount('emporium', { values: [1, 2] })
    const garden = await mount('garden', { values: [1, 2] })
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
  })
})
