/**
 * REAL mn-chip test — the general, skin-aware chip in BOTH skins. NO MOCKS.
 *
 * Mounts the REAL @customElement and asserts: props render (glyph/label/tone/
 * dashed/hint), the default slot overrides `label`, the chip is token-driven (the
 * shipped shadow CSS routes color through the skin ROLE tokens, NOT hardcoded
 * hexes — the lift's whole point), and it mirrors the ambient skin onto its host
 * so :host([data-skin=emporium]) lights up (square shoulders in both skins).
 *
 * happy-dom carries no paint engine, so (like the chrome tests) the COMPUTED
 * recolor is asserted in the Storybook/Playwright pass; here we assert the
 * real-DOM WIRING + the shipped CSS source + the skin-awareness, deterministically.
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-chip.js'
import type { MnChip, MnTone } from '../mn-chip.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']
const TONES: MnTone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'muted']

async function mount(skin: Skin, props: Partial<MnChip> = {}): Promise<MnChip> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-chip') as MnChip
  Object.assign(el, props)
  host.appendChild(el)
  await el.updateComplete
  return el
}

/** The real shipped shadow CSS (CSSResult cssText off the constructor). */
function styleText(el: HTMLElement): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
  document.documentElement.removeAttribute('data-theme')
})

describe('mn-chip — renders props (real element, both skins)', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] renders the label + leading glyph`, async () => {
      const el = await mount(skin, { label: 'tokens', glyph: '◆' })
      const chip = el.shadowRoot!.querySelector('.chip')!
      expect(chip.textContent).toContain('tokens')
      expect(el.shadowRoot!.querySelector('.glyph')!.textContent).toBe('◆')
    })

    it(`[skin=${skin}] applies the tone class per tone (routes to a role token)`, async () => {
      for (const tone of TONES) {
        const el = await mount(skin, { tone, label: tone })
        const chip = el.shadowRoot!.querySelector('.chip')!
        // neutral carries no tone class (it IS the default surface).
        if (tone === 'neutral') expect(chip.classList.contains('tone-neutral')).toBe(false)
        else expect(chip.classList.contains(`tone-${tone}`)).toBe(true)
      }
    })

    it(`[skin=${skin}] the default slot overrides the label prop`, async () => {
      const host = document.createElement('div')
      if (skin !== 'garden') host.setAttribute('data-skin', skin)
      document.body.appendChild(host)
      const el = document.createElement('mn-chip') as MnChip
      el.label = 'ignored'
      el.textContent = 'slotted'
      host.appendChild(el)
      await el.updateComplete
      const slot = el.shadowRoot!.querySelector('slot') as HTMLSlotElement
      const assigned = slot.assignedNodes({ flatten: true }).map((n) => n.textContent).join('')
      expect(assigned).toContain('slotted')
    })

    it(`[skin=${skin}] dashed adds the dashed class`, async () => {
      const el = await mount(skin, { dashed: true, label: 'replay' })
      expect(el.shadowRoot!.querySelector('.chip')!.classList.contains('dashed')).toBe(true)
    })

    it(`[skin=${skin}] hint sets the title attribute`, async () => {
      const el = await mount(skin, { label: 'x', hint: 'a hint' })
      expect(el.shadowRoot!.querySelector('.chip')!.getAttribute('title')).toBe('a hint')
    })
  }
})

describe('mn-chip — token-driven (NO hardcoded color in the shipped CSS)', () => {
  const css = styleText(document.createElement('mn-chip'))

  it('routes the surface/text/border through skin role tokens, not raw ramps', () => {
    expect(css).toMatch(/var\(--mn-color-surface-raised/)
    expect(css).toMatch(/var\(--mn-color-text-secondary/)
    expect(css).toMatch(/var\(--mn-color-border-subtle/)
    expect(css).toMatch(/var\(--mn-radius-full/)
  })

  it('the accent tone consumes the ACCENT role token (recolors per skin for free)', () => {
    expect(css).toMatch(/\.tone-accent[\s\S]*var\(--mn-color-(text-)?accent/)
  })

  it('the danger tone consumes the DANGER role token (the old terracotta literal is gone)', () => {
    expect(css).toMatch(/\.tone-danger[\s\S]*var\(--mn-color-danger/)
    // the wf-chip hardcoded terracotta hex must NOT survive the lift.
    expect(css.toLowerCase()).not.toContain('#b3401f')
  })

  it('carries a :host([data-skin=emporium]) structural rule (square shoulders)', () => {
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)/)
    expect(css).toMatch(/var\(--mn-radius-surface/)
  })
})

describe('mn-chip — skin-aware: mirrors ambient skin onto the host', () => {
  it('emporium host → data-skin mirrored; garden host → no data-skin', async () => {
    const emp = await mount('emporium', { label: 'p' })
    const garden = await mount('garden', { label: 'g' })
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
    expect(emp.resolvedSkin).toBe('emporium')
    expect(garden.resolvedSkin).toBe('')
  })
})
