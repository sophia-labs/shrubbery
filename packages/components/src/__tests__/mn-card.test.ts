/**
 * REAL mn-card test — the general, skin-aware catalogue card in BOTH skins. NO MOCKS.
 *
 * Asserts: the three slots (header / default body / footer) render, an empty
 * header/footer collapses (no faked chrome), interactive mode is a real
 * role=button + tabindex that emits `mn-card-activate` on click AND keyboard
 * Enter/Space, the shipped CSS is token-driven, and the host mirrors the ambient
 * skin (stronger frame rule under Emporium).
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-card.js'
import type { MnCard } from '../mn-card.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']

function styleText(el: HTMLElement): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
}

/** Mount a card with arbitrary light-DOM children (slots) under a skin host. */
async function mountHtml(skin: Skin, inner: string, attrs = ''): Promise<MnCard> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  host.innerHTML = `<mn-card ${attrs}>${inner}</mn-card>`
  document.body.appendChild(host)
  const el = host.querySelector('mn-card') as MnCard
  await el.updateComplete
  // allow the slotchange handlers (which requestUpdate) to flush.
  await new Promise((r) => setTimeout(r, 0))
  await el.updateComplete
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
})

describe('mn-card — slots render + empty header/footer collapse (both skins)', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] renders header / body / footer slot content`, async () => {
      const el = await mountHtml(
        skin,
        `<span slot="header">Title</span>Body text<span slot="footer">Foot</span>`,
      )
      const header = el.shadowRoot!.querySelector('.header')!
      const footer = el.shadowRoot!.querySelector('.footer')!
      expect(header.classList.contains('empty')).toBe(false)
      expect(footer.classList.contains('empty')).toBe(false)
      // body default slot has the text.
      const bodySlot = el.shadowRoot!.querySelector('.body slot') as HTMLSlotElement
      const bodyText = bodySlot
        .assignedNodes({ flatten: true })
        .map((n) => n.textContent)
        .join('')
      expect(bodyText).toContain('Body text')
    })

    it(`[skin=${skin}] collapses header + footer when nothing is slotted`, async () => {
      const el = await mountHtml(skin, `just a body`)
      expect(el.shadowRoot!.querySelector('.header')!.classList.contains('empty')).toBe(true)
      expect(el.shadowRoot!.querySelector('.footer')!.classList.contains('empty')).toBe(true)
    })
  }
})

describe('mn-card — interactive surface (real button semantics + event)', () => {
  it('non-interactive has no role/tabindex and is not a button', async () => {
    const el = await mountHtml('garden', `body`)
    const card = el.shadowRoot!.querySelector('.card')!
    expect(card.getAttribute('role')).toBeNull()
    expect(card.classList.contains('interactive')).toBe(false)
  })

  for (const skin of SKINS) {
    it(`[skin=${skin}] interactive is role=button + tabindex and emits on click`, async () => {
      const el = await mountHtml(skin, `body`, `interactive label="Open mn-top-bar"`)
      const card = el.shadowRoot!.querySelector('.card') as HTMLElement
      expect(card.getAttribute('role')).toBe('button')
      expect(card.getAttribute('tabindex')).toBe('0')
      expect(card.getAttribute('aria-label')).toBe('Open mn-top-bar')
      let n = 0
      el.addEventListener('mn-card-activate', () => n++)
      card.click()
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      // a non-activating key does nothing.
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      expect(n).toBe(3)
    })
  }
})

describe('mn-card — token-driven + skin-aware', () => {
  const css = styleText(document.createElement('mn-card'))

  it('routes border/radius/surface through role tokens (no hardcoded chrome)', () => {
    expect(css).toMatch(/var\(--mn-color-border-default/)
    expect(css).toMatch(/var\(--mn-radius-surface/)
    expect(css).toMatch(/var\(--mn-color-surface-base/)
  })

  it('Emporium uses the stronger FRAME rule (sophia figure-ground)', () => {
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)\s*\.card[\s\S]*var\(--mn-rule-frame/)
  })

  it('mirrors the ambient skin onto the host', async () => {
    const emp = await mountHtml('emporium', `b`)
    const garden = await mountHtml('garden', `b`)
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
  })
})
