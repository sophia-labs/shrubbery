/**
 * REAL component test — mn-top-bar chrome shell.
 *
 * NO MOCKS: instantiates the REAL @customElement, mounts it in the (happy-dom)
 * document, and asserts its REAL shadow DOM + behaviour. The component depends
 * on no store/auth/tauri, so there is nothing to mock — we test it as-is.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '../mn-top-bar.js'
import type { ChromeAppTab, MnTopBar } from '../mn-top-bar.js'

/** The two-tab fixture every pre-Slice-10 test relied on being hardcoded. */
const GARDEN_CHOREOGRAPH_TABS: readonly ChromeAppTab[] = [
  { id: 'garden', label: 'Garden', icon: 'sprout' },
  { id: 'choreograph', label: 'Choreograph', icon: 'layers' },
]

/** Mount a fresh, upgraded <mn-top-bar> and wait for its first render. */
async function mount(setup?: (el: MnTopBar) => void): Promise<MnTopBar> {
  const el = document.createElement('mn-top-bar') as MnTopBar
  if (setup) setup(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnTopBar) => el.shadowRoot!

describe('mn-top-bar — real custom element', () => {
  beforeAll(() => {
    // The tag must be a registered custom element (the upgrade seam).
    expect(customElements.get('mn-top-bar')).toBeDefined()
  })

  it('upgrades the tag and builds a shadow root', async () => {
    const el = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(el.tagName.toLowerCase()).toBe('mn-top-bar')
  })

  it('renders the masthead brand + badge from controlled props (defaults)', async () => {
    const el = await mount()
    const name = sr(el).querySelector('.masthead-name')
    const badge = sr(el).querySelector('.masthead-badge')
    expect(name?.textContent?.trim()).toBe('Garden')
    expect(badge?.textContent?.trim()).toBe('beta')
  })

  it('brand/badge are driven by props, not faked from a store', async () => {
    const el = await mount(e => {
      e.brand = 'Canary'
      e.badge = 'staging'
    })
    expect(sr(el).querySelector('.masthead-name')?.textContent?.trim()).toBe('Canary')
    expect(sr(el).querySelector('.masthead-badge')?.textContent?.trim()).toBe('staging')
  })

  it('with no `apps` supplied (the default), the switcher is HIDDEN and offers zero tabs — no hardcoded Garden/Choreograph pair', async () => {
    const el = await mount()
    const switcher = sr(el).querySelector('.app-switcher')
    // `hidden` (not DOM removal — an empty ChildPart at this exact position is
    // a real lit-html/happy-dom miscompile in this toolchain, reproduced and
    // worked around; see the comment on `apps` above `hidden` renders nothing
    // to the eye, the a11y tree, or tab order, which is what "no switcher"
    // means to a user).
    expect(switcher?.hasAttribute('hidden')).toBe(true)
    expect(sr(el).querySelectorAll('.app-switcher-btn').length).toBe(0)
  })

  it('renders exactly the tabs it is given, in order; garden active by default prop', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS })
    const tabs = sr(el).querySelectorAll('.app-switcher-btn')
    expect(tabs.length).toBe(2)
    const garden = tabs[0]
    const choreo = tabs[1]
    expect(garden.querySelector('.switcher-label')?.textContent?.trim()).toBe('Garden')
    expect(choreo.querySelector('.switcher-label')?.textContent?.trim()).toBe('Choreograph')
    expect(garden.classList.contains('app-switcher-btn--active')).toBe(true)
    expect(garden.getAttribute('aria-selected')).toBe('true')
    expect(choreo.classList.contains('app-switcher-btn--active')).toBe(false)
    expect(choreo.getAttribute('aria-selected')).toBe('false')
  })

  it('a THIRD, config-declared app renders as a real tab (no hardcoded two-tab ceiling)', async () => {
    const el = await mount(e => {
      e.apps = [...GARDEN_CHOREOGRAPH_TABS, { id: 'shrubbery-labs', label: 'Shrubbery Labs' }]
    })
    const tabs = sr(el).querySelectorAll('.app-switcher-btn')
    expect(tabs.length).toBe(3)
    expect(tabs[2].querySelector('.switcher-label')?.textContent?.trim()).toBe('Shrubbery Labs')
    // icon is optional — a label-only tab renders with no .switcher-icon.
    expect(tabs[2].querySelector('.switcher-icon')).toBeNull()
  })

  it('activeApp prop drives which tab is active (controlled, no store)', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS; e.activeApp = 'choreograph' })
    const tabs = sr(el).querySelectorAll('.app-switcher-btn')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].classList.contains('app-switcher-btn--active')).toBe(true)
  })

  it('an activeApp that matches NO tab (an undeclared/stale app) leaves every tab unselected — never a guess', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS; e.activeApp = 'not-a-real-app' })
    const tabs = sr(el).querySelectorAll('.app-switcher-btn')
    expect(Array.from(tabs).every(t => t.getAttribute('aria-selected') === 'false')).toBe(true)
    expect(Array.from(tabs).every(t => !t.classList.contains('app-switcher-btn--active'))).toBe(true)
  })

  it('clicking an inactive app tab emits mn-app-change (does NOT self-mutate)', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS })
    let detail: { app: string } | null = null
    el.addEventListener('mn-app-change', e => { detail = (e as CustomEvent).detail })
    const choreo = sr(el).querySelectorAll('.app-switcher-btn')[1] as HTMLButtonElement
    choreo.click()
    await el.updateComplete
    expect(detail).toEqual({ app: 'choreograph' })
    // Controlled component: it did NOT flip its own activeApp (no store, no
    // self-mutation — the shell owns the state).
    expect(el.activeApp).toBe('garden')
  })

  it('clicking the ALREADY-active tab emits nothing (no-op)', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS })
    let fired = false
    el.addEventListener('mn-app-change', () => { fired = true })
    const garden = sr(el).querySelectorAll('.app-switcher-btn')[0] as HTMLButtonElement
    garden.click()
    await el.updateComplete
    expect(fired).toBe(false)
  })

  it('the breadcrumb area is an INERT slot (empty, no faked workspace/doc)', async () => {
    const el = await mount()
    const nav = sr(el).querySelector('nav.breadcrumbs')
    expect(nav).not.toBeNull()
    // It exposes a named slot and renders NO crumb text of its own.
    expect(nav!.querySelector('slot[name="breadcrumbs"]')).not.toBeNull()
    expect(nav!.textContent?.trim()).toBe('') // no "Select Workspace", no fake title
    expect(nav!.getAttribute('data-inert-slot')).toBe('breadcrumbs')
  })

  it('renders controlled live breadcrumbs and emits navigation for a non-current crumb', async () => {
    const el = await mount(e => {
      e.breadcrumbs = [
        { id: 'graph-a', label: 'Sophia Code Lab', kind: 'graph' },
        { id: 'doc-a', label: 'Living Map', kind: 'document', current: true },
      ]
    })
    const nav = sr(el).querySelector('nav.breadcrumbs')!
    const crumbs = Array.from(nav.querySelectorAll<HTMLButtonElement>('.breadcrumb'))
    expect(nav.querySelector('slot')).toBeNull()
    expect(nav.hasAttribute('data-inert-slot')).toBe(false)
    expect(crumbs.map(crumb => crumb.textContent?.trim())).toEqual(['Sophia Code Lab', 'Living Map'])
    expect(crumbs[1].getAttribute('aria-current')).toBe('page')

    let detail: unknown = null
    el.addEventListener('mn-breadcrumb-open', event => { detail = (event as CustomEvent).detail })
    crumbs[0].click()
    expect(detail).toEqual({ breadcrumb: eBreadcrumb(el, 0) })
    detail = null
    crumbs[1].click()
    expect(detail).toBeNull()
  })

  it('clicking the current document crumb opens a document-actions menu instead of navigating (regression: no per-document menu existed)', async () => {
    const el = await mount(e => {
      e.breadcrumbs = [
        { id: 'graph-a', label: 'Sophia Code Lab', kind: 'graph' },
        { id: 'doc-a', label: 'Living Map', kind: 'document', current: true },
      ]
    })
    const crumbs = Array.from(sr(el).querySelectorAll<HTMLButtonElement>('.breadcrumb'))
    expect(crumbs[1].getAttribute('aria-haspopup')).toBe('menu')
    expect(crumbs[1].querySelector('.breadcrumb-menu-caret')).not.toBeNull()

    let detail: { breadcrumb: unknown, x: number, y: number } | null = null
    el.addEventListener('mn-breadcrumb-menu-open', event => {
      detail = (event as CustomEvent).detail
    })
    crumbs[1].click()
    expect(detail).not.toBeNull()
    expect((detail as unknown as { breadcrumb: { id: string } }).breadcrumb.id).toBe('doc-a')
    expect(typeof (detail as unknown as { x: number }).x).toBe('number')
    expect(typeof (detail as unknown as { y: number }).y).toBe('number')
  })

  it('a current crumb that is NOT a document (e.g. a view) stays inert on click — only documents get the menu treatment', async () => {
    const el = await mount(e => {
      e.breadcrumbs = [
        { id: 'view-a', label: 'History', kind: 'view', current: true },
      ]
    })
    const crumb = sr(el).querySelector<HTMLButtonElement>('.breadcrumb')!
    expect(crumb.getAttribute('aria-haspopup')).toBeNull()
    expect(crumb.querySelector('.breadcrumb-menu-caret')).toBeNull()

    let opened = false
    let menuOpened = false
    el.addEventListener('mn-breadcrumb-open', () => { opened = true })
    el.addEventListener('mn-breadcrumb-menu-open', () => { menuOpened = true })
    crumb.click()
    expect(opened).toBe(false)
    expect(menuOpened).toBe(false)
  })

  it('the masthead click emits mn-navigate-home', async () => {
    const el = await mount()
    let fired = false
    el.addEventListener('mn-navigate-home', () => { fired = true })
    ;(sr(el).querySelector('.masthead') as HTMLElement).click()
    expect(fired).toBe(true)
  })

  it('theme/skin action buttons reflect controlled props + emit composed events', async () => {
    const el = await mount(e => { e.isDark = true; e.activeSkin = '98' })
    const buttons = Array.from(sr(el).querySelectorAll('.action-btn')) as HTMLButtonElement[]
    const themeBtn = buttons.find(b => b.getAttribute('aria-label') === 'Toggle theme')!
    const skinBtn = buttons.find(b => b.dataset.action === 'skin')!
    const settingsBtn = buttons.find(b => b.getAttribute('aria-label') === 'Settings')!
    // pressed state comes from props, not a theme store.
    expect(themeBtn.getAttribute('aria-pressed')).toBe('true')
    expect(themeBtn.classList.contains('active')).toBe(true)
    expect(skinBtn.getAttribute('aria-pressed')).toBeNull()
    expect(skinBtn.dataset.activeSkin).toBe('98')
    expect(skinBtn.getAttribute('aria-label')).toContain('98')
    expect(skinBtn.querySelector('svg')).not.toBeNull()

    let theme = false, skin = false, settings = false
    el.addEventListener('mn-theme-toggle', () => { theme = true })
    el.addEventListener('mn-skin-toggle', () => { skin = true })
    el.addEventListener('mn-settings-toggle', () => { settings = true })
    themeBtn.click(); skinBtn.click(); settingsBtn.click()
    expect([theme, skin, settings]).toEqual([true, true, true])
  })

  it('renders Quick Clip only for a live graph and forwards controlled state/intents', async () => {
    const element = await mount()
    expect(sr(element).querySelector('mn-quick-clip')).toBeNull()

    element.quickClipAvailable = true
    element.quickClipStatus = 'error'
    element.quickClipError = 'Extractor unavailable'
    await element.updateComplete
    const clip = sr(element).querySelector('mn-quick-clip') as HTMLElement & {
      status: string
      error: string
      updateComplete: Promise<boolean>
    }
    await clip.updateComplete
    expect(clip.status).toBe('error')
    expect(clip.error).toBe('Extractor unavailable')

    let detail: unknown = null
    element.addEventListener('mn-quick-clip-request', event => {
      detail = (event as CustomEvent).detail
    })
    clip.dispatchEvent(new CustomEvent('mn-quick-clip-request', {
      detail: { url: 'https://example.com/article', kind: 'web' },
      bubbles: true,
      composed: true,
    }))
    expect(detail).toEqual({ url: 'https://example.com/article', kind: 'web' })
  })

  it('emitted events are composed + bubbling (cross shadow boundaries)', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const el = document.createElement('mn-top-bar') as MnTopBar
    host.appendChild(el)
    await el.updateComplete
    let caughtOnHost = false
    host.addEventListener('mn-navigate-home', () => { caughtOnHost = true })
    ;(el.shadowRoot!.querySelector('.masthead') as HTMLElement).click()
    expect(caughtOnHost).toBe(true)
  })
})

function eBreadcrumb(el: MnTopBar, index: number) {
  return el.breadcrumbs[index]
}
