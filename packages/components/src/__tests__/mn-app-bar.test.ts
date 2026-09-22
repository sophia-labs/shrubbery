/**
 * REAL component test — mn-app-bar (the richer general PRODUCT bar).
 *
 * NO MOCKS: instantiates the REAL @customElement, mounts it in the (happy-dom)
 * document, and asserts its REAL shadow DOM + behaviour across BOTH skins. The
 * component depends on no store/auth/tauri, so there is nothing to mock.
 *
 * The bar lifts MORE of garden's real top-bar structure than the chrome bar —
 * specifically a SEARCH/FILTER input and a real BREADCRUMB TRAIL — generalized
 * into CONTROLLED props. These tests prove: the masthead/badge/glyph come from
 * props (never faked), the search is controlled (emits, never self-mutates), the
 * breadcrumb trail renders the controlled crumbs (last = current, earlier =
 * clickable → mn-crumb), the action buttons emit composed events, and the bar is
 * skin-aware (mirrors ambient [data-skin] onto its host so :host([data-skin]) and
 * the role tokens light up under both skins).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import '../mn-app-bar.js'
import type { MnAppBar, MnCrumb } from '../mn-app-bar.js'

async function mount(setup?: (el: MnAppBar) => void, skin?: 'garden' | 'emporium'): Promise<{ host: HTMLElement; el: MnAppBar }> {
  const host = document.createElement('div')
  if (skin && skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-app-bar') as MnAppBar
  if (setup) setup(el)
  host.appendChild(el)
  await el.updateComplete
  return { host, el }
}

const sr = (el: MnAppBar) => el.shadowRoot!

/** The real shadow CSS the upgraded element adopts (Lit static styles). */
function styleText(el: MnAppBar): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('mn-app-bar — real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-app-bar')).toBeDefined()
  })

  it('upgrades the tag and builds a shadow root', async () => {
    const { el } = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(el.tagName.toLowerCase()).toBe('mn-app-bar')
  })

  it('renders the masthead brand/badge/glyph from controlled props (not faked)', async () => {
    const { el } = await mount((e) => {
      e.brand = 'Emporium'
      e.badge = 'live'
      e.glyph = '⬡'
    })
    expect(sr(el).querySelector('.masthead-name')?.textContent?.trim()).toBe('Emporium')
    expect(sr(el).querySelector('.masthead-badge')?.textContent?.trim()).toBe('live')
    expect(sr(el).querySelector('.masthead-glyph')?.textContent?.trim()).toBe('⬡')
  })

  it('the masthead click emits mn-navigate-home (composed)', async () => {
    const { host, el } = await mount()
    let fired = false
    host.addEventListener('mn-navigate-home', () => (fired = true))
    ;(sr(el).querySelector('.masthead') as HTMLElement).click()
    expect(fired).toBe(true)
  })

  // ── Search / filter ────────────────────────────────────────────────────────
  it('renders the search input with the controlled query + placeholder', async () => {
    const { el } = await mount((e) => {
      e.query = 'mem'
      e.searchPlaceholder = 'Search vocabularies…'
    })
    const input = sr(el).querySelector('.search-input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('mem')
    expect(input.getAttribute('placeholder')).toBe('Search vocabularies…')
  })

  it('typing emits mn-search but does NOT self-mutate query (controlled)', async () => {
    const { host, el } = await mount()
    let detail: { query: string } | null = null
    host.addEventListener('mn-search', (e) => (detail = (e as CustomEvent).detail))
    const input = sr(el).querySelector('.search-input') as HTMLInputElement
    input.value = 'work'
    input.dispatchEvent(new Event('input'))
    expect(detail).toEqual({ query: 'work' })
    // Controlled: the bar did not flip its own query (the shell owns the value).
    expect(el.query).toBe('')
  })

  it('Enter emits mn-search-submit with the current value', async () => {
    const { host, el } = await mount((e) => (e.query = 'flow'))
    let submitted: { query: string } | null = null
    host.addEventListener('mn-search-submit', (e) => (submitted = (e as CustomEvent).detail))
    const input = sr(el).querySelector('.search-input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(submitted).toEqual({ query: 'flow' })
  })

  it('a clear button appears only when query is non-empty and emits an empty mn-search', async () => {
    const { el: empty } = await mount()
    expect(sr(empty).querySelector('.search-clear')).toBeNull()

    const { host, el } = await mount((e) => (e.query = 'x'))
    const clear = sr(el).querySelector('.search-clear') as HTMLButtonElement
    expect(clear).not.toBeNull()
    let detail: { query: string } | null = null
    host.addEventListener('mn-search', (e) => (detail = (e as CustomEvent).detail))
    clear.click()
    expect(detail).toEqual({ query: '' })
  })

  it('show-search=false omits the search region entirely', async () => {
    const { el } = await mount((e) => (e.showSearch = false))
    expect(sr(el).querySelector('.search')).toBeNull()
  })

  // ── Breadcrumb trail ─────────────────────────────────────────────────────────
  it('renders an EMPTY trail with no crumbs (never a faked location)', async () => {
    const { el } = await mount()
    const nav = sr(el).querySelector('nav.breadcrumbs')!
    expect(nav).not.toBeNull()
    expect(nav.querySelectorAll('.crumb').length).toBe(0)
    expect(nav.querySelector('slot[name="breadcrumbs"]')).not.toBeNull()
  })

  it('renders the controlled crumbs; the last is current (not a button), earlier are buttons', async () => {
    const crumbs: MnCrumb[] = [
      { label: 'Emporium', id: 'root' },
      { label: 'workflow', id: 'workflow' },
      { label: 'AgentNode' },
    ]
    const { el } = await mount((e) => (e.crumbs = crumbs))
    const items = sr(el).querySelectorAll('.crumb')
    expect(items.length).toBe(3)
    expect(items[0].tagName.toLowerCase()).toBe('button')
    expect(items[1].tagName.toLowerCase()).toBe('button')
    // Last crumb is the current location: a span, marked aria-current=page.
    expect(items[2].tagName.toLowerCase()).toBe('span')
    expect(items[2].classList.contains('crumb--current')).toBe(true)
    expect(items[2].getAttribute('aria-current')).toBe('page')
    // Separators: one fewer than crumbs.
    expect(sr(el).querySelectorAll('.crumb-sep').length).toBe(2)
  })

  it('clicking an earlier crumb emits mn-crumb with its id (does not self-navigate)', async () => {
    const { host, el } = await mount(
      (e) =>
        (e.crumbs = [
          { label: 'Emporium', id: 'root' },
          { label: 'workflow', id: 'workflow' },
          { label: 'AgentNode' },
        ]),
    )
    let detail: { id?: string; label: string } | null = null
    host.addEventListener('mn-crumb', (e) => (detail = (e as CustomEvent).detail))
    const root = sr(el).querySelectorAll('.crumb')[0] as HTMLButtonElement
    root.click()
    expect(detail).toEqual({ id: 'root', label: 'Emporium' })
  })

  // ── Actions ──────────────────────────────────────────────────────────────────
  it('theme/skin action buttons reflect controlled props + emit composed events', async () => {
    const { host, el } = await mount((e) => {
      e.isDark = true
      e.activeSkin = '98'
    })
    const buttons = Array.from(sr(el).querySelectorAll('.action-btn')) as HTMLButtonElement[]
    const themeBtn = buttons.find((b) => b.getAttribute('aria-label') === 'Toggle theme')!
    const skinBtn = buttons.find((b) => b.dataset.action === 'skin')!
    expect(themeBtn.getAttribute('aria-pressed')).toBe('true')
    expect(themeBtn.classList.contains('active')).toBe(true)
    expect(skinBtn.getAttribute('aria-pressed')).toBeNull()
    expect(skinBtn.dataset.activeSkin).toBe('98')
    expect(skinBtn.getAttribute('aria-label')).toContain('98')
    expect(skinBtn.querySelector('svg')).not.toBeNull()

    let theme = false,
      skin = false,
      settings = false
    host.addEventListener('mn-theme-toggle', () => (theme = true))
    host.addEventListener('mn-skin-toggle', () => (skin = true))
    host.addEventListener('mn-settings-toggle', () => (settings = true))
    themeBtn.click()
    skinBtn.click()
    buttons.find((b) => b.getAttribute('aria-label') === 'Settings')!.click()
    expect([theme, skin, settings]).toEqual([true, true, true])
  })

  it('show-actions=false omits the built-in action buttons (slot stays)', async () => {
    const { el } = await mount((e) => (e.showActions = false))
    expect(sr(el).querySelectorAll('.action-btn').length).toBe(0)
    // the actions container + the slots still render (a shell may slot custom nav/actions).
    expect(sr(el).querySelector('.actions')).not.toBeNull()
    expect(sr(el).querySelector('slot[name="actions"]')).not.toBeNull()
  })

  // ── Skin-awareness (both skins) ──────────────────────────────────────────────
  it('mirrors the ambient skin onto its host (garden = unskinned, emporium = stamped)', async () => {
    const { el: garden } = await mount(undefined, 'garden')
    const { el: emp } = await mount(undefined, 'emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
    expect(garden.resolvedSkin).toBe('')
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(emp.resolvedSkin).toBe('emporium')
  })

  it('shadow CSS consumes the skin role tokens + carries the Emporium structural block', async () => {
    const { el } = await mount(undefined, 'emporium')
    const css = styleText(el)
    // Density + radius role tokens (Garden 32 / Emporium tight 24, square shoulders).
    expect(css).toMatch(/var\(--mn-control-height/)
    expect(css).toMatch(/border-radius:\s*var\(--mn-radius-control/)
    // Real Emporium structural rule (the sophia figure-ground frame rule).
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)/)
    expect(css).toMatch(/var\(--mn-chrome-rule/)
  })
})
