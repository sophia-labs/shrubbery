/**
 * REAL mn-badge test — the general, skin-aware status badge in BOTH skins. NO MOCKS.
 *
 * Asserts: state tones apply (routing to role tokens), the interactive mode
 * renders a real <button> and emits `mn-badge-action`, the spin/settle motion
 * classes apply, the shipped CSS is token-driven (no hardcoded terracotta), and
 * the badge mirrors the ambient skin onto its host.
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-badge.js'
import type {
  FiletypeKey,
  MnBadge,
  MnBadgeSize,
  MnBadgeState,
  MnBadgeVariant,
} from '../mn-badge.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']
const STATES: MnBadgeState[] = ['neutral', 'active', 'success', 'warning', 'danger']
const VARIANTS: MnBadgeVariant[] = ['default', 'primary', 'success', 'warning', 'danger', 'info']
const SIZES: MnBadgeSize[] = ['sm', 'md', 'lg']
const FILETYPES: FiletypeKey[] = ['pdf', 'epub', 'docx', 'html', 'md', 'txt']

async function mount(skin: Skin, props: Partial<MnBadge> = {}): Promise<MnBadge> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-badge') as MnBadge
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
  document.documentElement.removeAttribute('data-theme')
})

describe('mn-badge — renders state + content (real element, both skins)', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] applies each state class`, async () => {
      for (const state of STATES) {
        const el = await mount(skin, { state, label: state, glyph: '●' })
        const badge = el.shadowRoot!.querySelector('.badge')!
        if (state === 'neutral') {
          expect(badge.classList.contains('neutral')).toBe(false)
        } else {
          expect(badge.classList.contains(state)).toBe(true)
        }
        expect(badge.classList.contains('badge')).toBe(true)
        expect(badge.classList.contains('size-md')).toBe(true)
        expect(badge.classList.contains('variant-default')).toBe(true)
        expect(badge.textContent).toContain(state)
        expect(el.getAttribute('state')).toBe(state) // reflected
      }
    })

    it(`[skin=${skin}] renders the leading glyph`, async () => {
      const el = await mount(skin, { glyph: '✓', label: 'ok' })
      expect(el.shadowRoot!.querySelector('.glyph')!.textContent).toBe('✓')
    })

    it(`[skin=${skin}] spin + settle add the motion classes`, async () => {
      const el = await mount(skin, { spin: true, settle: true, label: 'x' })
      const badge = el.shadowRoot!.querySelector('.badge')!
      expect(badge.classList.contains('spin')).toBe(true)
      expect(badge.classList.contains('settle')).toBe(true)
    })
  }
})

describe('mn-badge — Garden core API compatibility', () => {
  it('defaults to variant=default and size=md', async () => {
    const el = await mount('garden', { label: 'New' })
    const badge = el.shadowRoot!.querySelector('.badge')!
    expect(el.variant).toBe('default')
    expect(el.size).toBe('md')
    expect(badge.classList.contains('variant-default')).toBe(true)
    expect(badge.classList.contains('size-md')).toBe(true)
  })

  for (const variant of VARIANTS) {
    it(`renders Garden variant=${variant}`, async () => {
      const el = await mount('garden', { variant, label: variant })
      const badge = el.shadowRoot!.querySelector('.badge')!
      expect(el.getAttribute('variant')).toBe(variant)
      expect(badge.classList.contains(`variant-${variant}`)).toBe(true)
    })
  }

  for (const size of SIZES) {
    it(`renders Garden size=${size}`, async () => {
      const el = await mount('garden', { size, label: size })
      const badge = el.shadowRoot!.querySelector('.badge')!
      expect(el.getAttribute('size')).toBe(size)
      expect(badge.classList.contains(`size-${size}`)).toBe(true)
    })
  }

  it('reflects pill and outline attributes', async () => {
    const el = await mount('garden', { pill: true, outline: true, label: 'GCAL' })
    const badge = el.shadowRoot!.querySelector('.badge')!
    expect(el.hasAttribute('pill')).toBe(true)
    expect(el.hasAttribute('outline')).toBe(true)
    expect(badge.classList.contains('outline')).toBe(true)
  })

  for (const filetype of FILETYPES) {
    it(`renders Garden filetype=${filetype}`, async () => {
      const el = await mount('garden', { variant: 'filetype', filetype, label: filetype })
      const badge = el.shadowRoot!.querySelector('.badge')!
      expect(badge.classList.contains('variant-filetype')).toBe(true)
      expect(badge.classList.contains(`filetype-${filetype}`)).toBe(true)
    })
  }

  it('renders slotted Garden badge content', async () => {
    const el = document.createElement('mn-badge') as MnBadge
    el.variant = 'primary'
    el.size = 'sm'
    el.pill = true
    el.append('42')
    document.body.appendChild(el)
    await el.updateComplete

    const badge = el.shadowRoot!.querySelector('.badge')!
    const slot = el.shadowRoot!.querySelector('slot')!
    expect(slot.assignedNodes().map((node) => node.textContent).join('').trim()).toBe('42')
    expect(el.textContent?.trim()).toBe('42')
    expect(badge.classList.contains('variant-primary')).toBe(true)
    expect(badge.classList.contains('size-sm')).toBe(true)
    expect(el.hasAttribute('pill')).toBe(true)
  })
})

describe('mn-badge — interactive mode (real button + event)', () => {
  it('non-interactive renders a <span>, no button', async () => {
    const el = await mount('garden', { label: 'static' })
    expect(el.shadowRoot!.querySelector('button.badge')).toBeNull()
    expect(el.shadowRoot!.querySelector('span.badge')).not.toBeNull()
  })

  for (const skin of SKINS) {
    it(`[skin=${skin}] interactive renders a <button> that emits mn-badge-action`, async () => {
      const el = await mount(skin, { interactive: true, label: 'verify', glyph: '○' })
      const btn = el.shadowRoot!.querySelector('button.badge') as HTMLButtonElement
      expect(btn).not.toBeNull()
      let fired = false
      el.addEventListener('mn-badge-action', () => (fired = true))
      btn.click()
      expect(fired).toBe(true)
    })
  }
})

describe('mn-badge — token-driven (NO hardcoded terracotta in the shipped CSS)', () => {
  const css = styleText(document.createElement('mn-badge'))

  it('the danger state routes through the danger ROLE token', () => {
    expect(css).toMatch(/\.danger[\s\S]*var\(--mn-color-danger/)
    expect(css.toLowerCase()).not.toContain('#b3401f') // the old wf literal
  })

  it('active routes through the accent role token', () => {
    expect(css).toMatch(/\.active[\s\S]*var\(--mn-color-(text-)?accent/)
  })

  it('Garden variants and filetypes route through role tokens', () => {
    expect(css).toMatch(/\.variant-primary[\s\S]*var\(--mn-color-accent/)
    expect(css).toMatch(/\.variant-filetype\.filetype-pdf[\s\S]*var\(--mn-color-filetype-pdf/)
  })

  it('carries a :host([data-skin=emporium]) structural rule', () => {
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)/)
  })
})

describe('mn-badge — skin-aware host mirroring', () => {
  it('emporium → mirrored data-skin; garden → none', async () => {
    const emp = await mount('emporium', { label: 'p' })
    const garden = await mount('garden', { label: 'g' })
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
  })
})
