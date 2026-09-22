/**
 * REAL skin-aware chrome test — mn-top-bar + mn-bottom-bar across the global skins × themes.
 *
 * NO MOCKS. Mounts the REAL @customElements inside a real host element that
 * carries [data-skin] / [data-theme] (the @shrubbery/tokens applies-attribute
 * surface), and asserts the chrome reflects the AMBIENT skin/theme onto its own
 * host and renders DIFFERENTLY per skin.
 *
 * WHAT THIS LAYER CAN / CANNOT ASSERT
 * ───────────────────────────────────
 * happy-dom does NOT resolve the CSS var() cascade across attribute selectors
 * (it carries no layout/paint engine). So this test does NOT measure computed
 * row heights / colors — those COMPUTED + pixel checks run in the Storybook +
 * Playwright pass (iteration 3c) against a real browser. What we CAN assert in
 * real DOM here, deterministically, is the SKIN-AWARENESS WIRING:
 *
 *   1. The component mirrors the ambient skin/theme onto its host as observable
 *      data-skin / data-theme attributes (so :host([data-skin=emporium]) lights
 *      up portably — no :host-context, which Firefox lacks & happy-dom can't run).
 *   2. The mirrored attributes DIFFER between a [data-skin=garden] host and a
 *      [data-skin=emporium] host (the whole point), independently across the
 *      orthogonal [data-theme] axis.
 *   3. The shadow stylesheet carries real Emporium structural rules
 *      (:host([data-skin='emporium']) …) and consumes the skin DENSITY / RADIUS /
 *      LABEL role tokens (--mn-control-height / --mn-radius-control /
 *      --mn-label-display) rather than the old fixed px — proving the 24px tight
 *      density + square + icon-only flags route through under Emporium.
 *   4. Live reactivity: flipping the root's data-skin re-syncs the host.
 *
 * No hand-written mock arg bags: every assertion is against the REAL element's
 * real shadow DOM + reflected attributes, parameterized over the real skin/theme
 * value sets.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import '../mn-top-bar.js'
import '../mn-bottom-bar.js'
import type { MnTopBar } from '../mn-top-bar.js'
import type { MnBottomBar } from '../mn-bottom-bar.js'

type Skin = 'garden' | 'emporium' | '98' | 'glass'
type Theme = 'light' | 'dark'

const SKINS: Skin[] = ['garden', 'emporium', '98', 'glass']
const THEMES: Theme[] = ['light', 'dark']

/**
 * Mount a chrome element inside a HOST that carries [data-skin]/[data-theme] —
 * exactly the surface @shrubbery/tokens stamps (applySkinTheme on a root). For
 * Garden the host carries NO data-skin (the "[data-skin] absent" sux default),
 * matching the real applier's removeAttribute behaviour, so we verify the
 * component resolves Garden as the *unskinned* default.
 */
async function mountUnder<T extends HTMLElement>(
  tag: 'mn-top-bar' | 'mn-bottom-bar',
  skin: Skin,
  theme: Theme,
): Promise<{ host: HTMLElement; el: T }> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  host.setAttribute('data-theme', theme)
  document.body.appendChild(host)
  const el = document.createElement(tag) as unknown as T
  host.appendChild(el)
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete
  return { host, el }
}

/**
 * The REAL shadow CSS text the upgraded element ADOPTS. Lit applies its
 * `static styles` via adoptedStyleSheets (no <style> element in the shadow root),
 * so we read the CSSResult cssText off the live element's constructor — the exact
 * stylesheet the component renders with. Not a mock: it is the shipped CSS.
 */
function styleText(el: HTMLElement): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map(s => (s as { cssText?: string }).cssText ?? '').join('\n')
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
  document.documentElement.removeAttribute('data-design')
  document.documentElement.removeAttribute('data-theme')
})

describe('skin-aware chrome — both elements mirror ambient skin/theme onto the host', () => {
  beforeAll(() => {
    expect(customElements.get('mn-top-bar')).toBeDefined()
    expect(customElements.get('mn-bottom-bar')).toBeDefined()
  })

  for (const tag of ['mn-top-bar', 'mn-bottom-bar'] as const) {
    describe(`${tag} — across skin × theme`, () => {
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          it(`[skin=${skin}][theme=${theme}] reflects the ambient skin/theme onto the host`, async () => {
            const { el } = await mountUnder<MnTopBar | MnBottomBar>(tag, skin, theme)

            // Theme always mirrors (light + dark are both stamped attributes).
            expect(el.getAttribute('data-theme')).toBe(theme)
            expect(el.resolvedTheme).toBe(theme)

            if (skin !== 'garden') {
              expect(el.getAttribute('data-skin')).toBe(skin)
              expect(el.resolvedSkin).toBe(skin)
            } else {
              // Garden = the unskinned default: NO data-skin on the host (mirrors
              // the applier's removeAttribute), so :host([data-skin=emporium])
              // does NOT match and the Garden token defaults rule.
              expect(el.hasAttribute('data-skin')).toBe(false)
              expect(el.resolvedSkin).toBe('')
            }
          })
        }
      }

      it('the mirrored skin DIFFERS between a garden host and an emporium host', async () => {
        const { el: garden } = await mountUnder(tag, 'garden', 'light')
        const { el: emp } = await mountUnder(tag, 'emporium', 'light')
        expect(garden.getAttribute('data-skin')).not.toBe(emp.getAttribute('data-skin'))
        expect(emp.getAttribute('data-skin')).toBe('emporium')
        expect(garden.hasAttribute('data-skin')).toBe(false)
      })

      it('keeps 98 and Glass distinct from Garden and Emporium', async () => {
        const { el: garden } = await mountUnder(tag, 'garden', 'light')
        const { el: emp } = await mountUnder(tag, 'emporium', 'light')
        const { el: classic } = await mountUnder(tag, '98', 'light')
        const { el: glass } = await mountUnder(tag, 'glass', 'light')
        expect([
          garden.getAttribute('data-skin'),
          emp.getAttribute('data-skin'),
          classic.getAttribute('data-skin'),
          glass.getAttribute('data-skin'),
        ]).toEqual([null, 'emporium', '98', 'glass'])
      })
    })
  }

  it('accepts the [data-design=emporium] alias (garden two-host cloud pattern)', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-design', 'emporium')
    document.body.appendChild(host)
    const el = document.createElement('mn-top-bar') as MnTopBar
    host.appendChild(el)
    await el.updateComplete
    expect(el.resolvedSkin).toBe('emporium')
    expect(el.getAttribute('data-skin')).toBe('emporium')
  })
})

describe('skin-aware chrome — shadow CSS consumes the skin role tokens (density / radius / labels)', () => {
  it('mn-top-bar: action buttons size off --mn-control-height + --mn-radius-control (not fixed 32px)', async () => {
    const { el } = await mountUnder<MnTopBar>('mn-top-bar', 'garden', 'light')
    const css = styleText(el)
    // Density: the control box is the skin control height (Garden 28 / Emporium 24),
    // NOT the old hardcoded 32px square.
    expect(css).toMatch(/width:\s*var\(--mn-control-height/)
    expect(css).toMatch(/height:\s*var\(--mn-control-height/)
    // Radius role (square under Emporium) drives the action + switcher shoulders.
    expect(css).toMatch(/border-radius:\s*var\(--mn-radius-control/)
    // Icon-only label flag gates the app-switcher caption.
    expect(css).toMatch(/display:\s*var\(--mn-label-display/)
  })

  it('mn-bottom-bar: toggles size off --mn-control-height + skin radius + label flag', async () => {
    const { el } = await mountUnder<MnBottomBar>('mn-bottom-bar', 'garden', 'light')
    const css = styleText(el)
    expect(css).toMatch(/var\(--mn-control-height/) // toggle height density
    expect(css).toMatch(/border-radius:\s*var\(--mn-radius-control/)
    expect(css).toMatch(/border-radius:\s*var\(--mn-radius-surface/) // the toggle well
    expect(css).toMatch(/display:\s*var\(--mn-label-display/) // icon-only label flag
  })

  it('both carry real :host([data-skin=emporium]) structural rules (the Emporium STRUCTURE)', async () => {
    const { el: top } = await mountUnder<MnTopBar>('mn-top-bar', 'emporium', 'light')
    const { el: bottom } = await mountUnder<MnBottomBar>('mn-bottom-bar', 'emporium', 'light')
    // Each component ships an Emporium block; the chrome rule (stronger frame) is
    // the sophia figure-ground hook.
    expect(styleText(top)).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)/)
    expect(styleText(top)).toMatch(/var\(--mn-chrome-rule/)
    expect(styleText(bottom)).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)/)
    // Emporium tightens the bottom-bar floor to the row-height density.
    expect(styleText(bottom)).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)\s*\{[^}]*var\(--mn-row-height/)
  })

  it('both carry 98 raised/sunken structural rules', async () => {
    const { el: top } = await mountUnder<MnTopBar>('mn-top-bar', '98', 'light')
    const { el: bottom } = await mountUnder<MnBottomBar>('mn-bottom-bar', '98', 'light')
    expect(styleText(top)).toMatch(/:host\(\[data-skin=['"]98['"]\]\)/)
    expect(styleText(top)).toMatch(/var\(--mn-98-raised/)
    expect(styleText(top)).toMatch(/var\(--mn-98-sunken/)
    expect(styleText(bottom)).toMatch(/:host\(\[data-skin=['"]98['"]\]\)/)
    expect(styleText(bottom)).toMatch(/var\(--mn-98-raised/)
    expect(styleText(bottom)).toMatch(/var\(--mn-98-sunken/)
  })

  it('both carry Glass translucent control structural rules', async () => {
    const { el: top } = await mountUnder<MnTopBar>('mn-top-bar', 'glass', 'light')
    const { el: bottom } = await mountUnder<MnBottomBar>('mn-bottom-bar', 'glass', 'light')
    expect(styleText(top)).toMatch(/:host\(\[data-skin=['"]glass['"]\]\)/)
    expect(styleText(top)).toMatch(/var\(--mn-window-backdrop-filter/)
    expect(styleText(top)).toMatch(/var\(--mn-control-background/)
    expect(styleText(bottom)).toMatch(/:host\(\[data-skin=['"]glass['"]\]\)/)
    expect(styleText(bottom)).toMatch(/var\(--mn-control-shadow/)
  })
})

describe('skin-aware chrome — icon-only structure: the caption stays in the DOM, the icon glyph is skin-gated', () => {
  it('mn-top-bar: each app-switcher tab carries BOTH a hidden icon glyph and the label', async () => {
    const { el } = await mountUnder<MnTopBar>('mn-top-bar', 'emporium', 'light')
    // Slice 10: the switcher is config-derived (no hardcoded tab list); a
    // direct mount supplies fixture tabs to exercise the icon-only structure.
    el.apps = [
      { id: 'garden', label: 'Garden', icon: 'sprout' },
      { id: 'choreograph', label: 'Choreograph', icon: 'layers' },
    ]
    await el.updateComplete
    const tabs = el.shadowRoot!.querySelectorAll('.app-switcher-btn')
    expect(tabs.length).toBe(2)
    for (const tab of Array.from(tabs)) {
      // The caption is preserved for a11y / a Garden host (display toggled by CSS).
      expect(tab.querySelector('.switcher-label')).not.toBeNull()
      // The icon glyph that Emporium surfaces is present (CSS reveals it).
      expect(tab.querySelector('.switcher-icon')).not.toBeNull()
    }
    // accessible name survives icon-only mode.
    expect(tabs[0].getAttribute('aria-label')).toBe('Garden app')
  })

  it('mn-bottom-bar: each toggle carries BOTH an icon glyph and the label caption', async () => {
    const { el } = await mountUnder<MnBottomBar>('mn-bottom-bar', 'emporium', 'light')
    const toggles = Array.from(el.shadowRoot!.querySelectorAll('.toggle-btn'))
    expect(toggles.length).toBe(6) // Files/Graph/Outline (left) + Sophia/Comments/Wires (right)
    for (const t of toggles) {
      expect(t.querySelector('.toggle-icon')).not.toBeNull()
      expect(t.querySelector('.toggle-label')).not.toBeNull()
      expect(t.getAttribute('aria-label')).toBeTruthy() // a11y name independent of caption
    }
  })
})

describe('skin-aware chrome — live reactivity: re-syncs when the ambient root flips skin/theme', () => {
  it('mn-top-bar mounted under <html> tracks a runtime applySkinTheme flip', async () => {
    // Mount DIRECTLY in the body (no wrapping skin host) so the resolver falls
    // back to <html> — the exact path applySkinTheme(documentElement) drives.
    const el = document.createElement('mn-top-bar') as MnTopBar
    document.body.appendChild(el)
    await el.updateComplete
    // Starts unskinned (no root attr) → Garden default.
    expect(el.resolvedSkin).toBe('')
    expect(el.resolvedTheme).toBe('')

    // Flip the root to Emporium + dark (what applySkinTheme stamps).
    document.documentElement.setAttribute('data-skin', 'emporium')
    document.documentElement.setAttribute('data-theme', 'dark')
    // MutationObserver fires async — let the microtask/observer queue drain.
    await new Promise(r => setTimeout(r, 0))
    await el.updateComplete
    expect(el.resolvedSkin).toBe('emporium')
    expect(el.getAttribute('data-skin')).toBe('emporium')
    expect(el.resolvedTheme).toBe('dark')
    expect(el.getAttribute('data-theme')).toBe('dark')

    // Advance to the third global identity without replacing the component.
    document.documentElement.setAttribute('data-skin', '98')
    await new Promise(r => setTimeout(r, 0))
    await el.updateComplete
    expect(el.resolvedSkin).toBe('98')
    expect(el.getAttribute('data-skin')).toBe('98')

    // Advance once more to Glass without replacing the component.
    document.documentElement.setAttribute('data-skin', 'glass')
    await new Promise(r => setTimeout(r, 0))
    await el.updateComplete
    expect(el.resolvedSkin).toBe('glass')
    expect(el.getAttribute('data-skin')).toBe('glass')

    // Flip back to Garden default (removeAttribute) → host de-skins.
    document.documentElement.removeAttribute('data-skin')
    await new Promise(r => setTimeout(r, 0))
    await el.updateComplete
    expect(el.resolvedSkin).toBe('')
    expect(el.hasAttribute('data-skin')).toBe(false)
  })
})
