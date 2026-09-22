/**
 * RENDER-SMOKE — the chrome bars render REAL lucide SVG icons, not emoji.
 *
 * NO MOCKS: mounts the REAL <mn-top-bar> + <mn-app-bar> custom elements into the
 * (happy-dom) document and inspects their REAL shadow DOM. Proves the icon port
 * landed end-to-end:
 *   (a) the theme / skin / settings (and search/clear) actions render an <svg>,
 *   (b) NO emoji codepoint (☀️🌙👁⚙🌱⧉⌕✕◆) survives in the rendered output.
 *
 * This is the guard that the top-bar EMOJI became real icons — and that the
 * Shadow-DOM iconStyles rule (stroke: currentColor) ships with each component.
 */
import { render } from 'lit'
import { describe, it, expect, afterEach, vi } from 'vitest'
import '../mn-top-bar.js'
import '../mn-app-bar.js'
import { icon } from '../icons.js'
import type { MnTopBar } from '../mn-top-bar.js'
import type { MnAppBar, MnCrumb } from '../mn-app-bar.js'

// The emoji literals that were hardcoded in the bars before the icon port.
const EMOJI = ['☀️', '🌙', '👁', '⚙', '🌱', '⧉', '⌕', '✕', '◆']

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** All text rendered inside a shadow root (emoji would show up here as text). */
function shadowText(root: ShadowRoot): string {
  return root.textContent ?? ''
}

/** A button identified by the start of its aria-label, from a shadow root. */
function btnByLabel(root: ShadowRoot, label: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('.action-btn')).find(
    (el) => el.getAttribute('aria-label')?.startsWith(label),
  )
  return b as HTMLButtonElement
}

describe('render-smoke — icon vocabulary', () => {
  it('renders the home route glyph as a real SVG without an unknown-icon warning', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    document.body.appendChild(host)

    render(icon('home'), host)

    expect(host.querySelector('svg')).not.toBeNull()
    expect(warning).not.toHaveBeenCalled()
  })
})

describe('render-smoke — mn-top-bar renders icons, no emoji', () => {
  it('theme/skin/settings + masthead + switcher render <svg>, never emoji', async () => {
    const el = document.createElement('mn-top-bar') as MnTopBar
    // Slice 10: the switcher is config-derived (no hardcoded tab list), so a
    // direct mount must supply fixture tabs to exercise the switcher glyphs.
    el.apps = [
      { id: 'garden', label: 'Garden', icon: 'sprout' },
      { id: 'choreograph', label: 'Choreograph', icon: 'layers' },
    ]
    document.body.appendChild(el)
    await el.updateComplete
    const root = el.shadowRoot!

    // (a) the chrome action buttons each carry an inline <svg>.
    expect(btnByLabel(root, 'Toggle theme').querySelector('svg')).not.toBeNull()
    expect(btnByLabel(root, 'Visual style').querySelector('svg')).not.toBeNull()
    expect(btnByLabel(root, 'Settings').querySelector('svg')).not.toBeNull()

    // masthead brand glyph + both switcher tab glyphs are svgs too.
    expect(root.querySelector('.masthead-icon svg')).not.toBeNull()
    const switcherSvgs = root.querySelectorAll('.switcher-icon svg')
    expect(switcherSvgs.length).toBe(2)

    // There are at least 5 icons total (theme, skin, settings, masthead, 2 tabs).
    expect(root.querySelectorAll('svg').length).toBeGreaterThanOrEqual(5)

    // (b) NO emoji codepoint remains anywhere in the rendered output.
    const text = shadowText(root)
    for (const e of EMOJI) {
      expect(text.includes(e), `emoji ${e} should be gone`).toBe(false)
    }
  })

  it('the theme button shows the moon icon when isDark (still an svg, no emoji)', async () => {
    const el = document.createElement('mn-top-bar') as MnTopBar
    el.isDark = true
    document.body.appendChild(el)
    await el.updateComplete
    const root = el.shadowRoot!
    expect(btnByLabel(root, 'Toggle theme').querySelector('svg')).not.toBeNull()
    for (const e of EMOJI) expect(shadowText(root).includes(e)).toBe(false)
  })

  it('the component ships the iconStyles rule (stroke: currentColor) in shadow CSS', async () => {
    const el = document.createElement('mn-top-bar') as MnTopBar
    const styles = (el.constructor as { styles?: unknown }).styles
    const list = Array.isArray(styles) ? styles : styles ? [styles] : []
    const css = list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
    expect(css).toMatch(/\.mn-icon/)
    expect(css).toMatch(/stroke:\s*currentColor/)
  })
})

describe('render-smoke — mn-app-bar renders icons, no emoji', () => {
  it('theme/skin/settings + search + masthead render <svg>, never emoji', async () => {
    const el = document.createElement('mn-app-bar') as MnAppBar
    el.query = 'x' // forces the clear (✕→x icon) button to render
    document.body.appendChild(el)
    await el.updateComplete
    const root = el.shadowRoot!

    // (a) chrome action buttons carry svgs.
    expect(btnByLabel(root, 'Toggle theme').querySelector('svg')).not.toBeNull()
    expect(btnByLabel(root, 'Visual style').querySelector('svg')).not.toBeNull()
    expect(btnByLabel(root, 'Settings').querySelector('svg')).not.toBeNull()

    // search glyph, clear button, and masthead glyph are svgs.
    expect(root.querySelector('.search-glyph svg')).not.toBeNull()
    expect(root.querySelector('.search-clear svg')).not.toBeNull()
    expect(root.querySelector('.masthead-glyph svg')).not.toBeNull()

    expect(root.querySelectorAll('svg').length).toBeGreaterThanOrEqual(6)

    // (b) NO emoji codepoint remains.
    const text = shadowText(root)
    for (const e of EMOJI) {
      expect(text.includes(e), `emoji ${e} should be gone`).toBe(false)
    }
  })

  it('a non-icon glyph string still renders as literal text (back-compat)', async () => {
    const el = document.createElement('mn-app-bar') as MnAppBar
    el.glyph = '⬡' // not a registered icon name → literal text fallback
    document.body.appendChild(el)
    await el.updateComplete
    const glyph = el.shadowRoot!.querySelector('.masthead-glyph')!
    expect(glyph.textContent?.trim()).toBe('⬡')
    expect(glyph.querySelector('svg')).toBeNull()
  })

  it('renders crumbs + icons together without any emoji', async () => {
    const el = document.createElement('mn-app-bar') as MnAppBar
    const crumbs: MnCrumb[] = [{ label: 'Emporium', id: 'root' }, { label: 'AgentNode' }]
    el.crumbs = crumbs
    document.body.appendChild(el)
    await el.updateComplete
    const root = el.shadowRoot!
    expect(root.querySelectorAll('.crumb').length).toBe(2)
    for (const e of EMOJI) expect(shadowText(root).includes(e)).toBe(false)
  })

  it('the component ships the iconStyles rule (stroke: currentColor) in shadow CSS', async () => {
    const el = document.createElement('mn-app-bar') as MnAppBar
    const styles = (el.constructor as { styles?: unknown }).styles
    const list = Array.isArray(styles) ? styles : styles ? [styles] : []
    const css = list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
    expect(css).toMatch(/\.mn-icon/)
    expect(css).toMatch(/stroke:\s*currentColor/)
  })
})
