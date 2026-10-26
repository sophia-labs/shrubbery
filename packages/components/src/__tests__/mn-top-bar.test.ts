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
import { APP_TOOLBAR_ACTIONS, HOME_ACTION, appToolbarActions } from '../app-toolbar.js'

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

  it('offers New Workspace unless the shell says this person may not create one', async () => {
    const workspaces = [{ graphId: 'garden', title: 'Garden', role: 'owner' as const, cellState: 'running' as const }]
    const open = async (el: MnTopBar) => {
      const selector = el.shadowRoot!.querySelector('mn-workspace-selector') as HTMLElement & { updateComplete: Promise<unknown> }
      await selector.updateComplete
      selector.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
      await selector.updateComplete
      return selector.shadowRoot!.querySelector('.create')
    }
    expect(await open(await mount(e => { e.workspaces = workspaces; e.workspaceStatus = 'ready' }))).not.toBeNull()
    document.body.replaceChildren()
    expect(await open(await mount(e => {
      e.workspaces = workspaces
      e.workspaceStatus = 'ready'
      e.workspaceCreateAvailable = false
    }))).toBeNull()
  })

  it('upgrades the tag and builds a shadow root', async () => {
    const el = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(el.tagName.toLowerCase()).toBe('mn-top-bar')
  })

  it('the app picker sits alone in the left corner — no Sophia/Start button; no badge by default (out of beta)', async () => {
    const el = await mount()
    expect(sr(el).querySelector('.masthead')).toBeNull()
    expect(sr(el).querySelector('.os-menu')).toBeNull()
    const first = sr(el).firstElementChild as HTMLElement
    expect(first.classList.contains('app-title')).toBe(true)
    const name = sr(el).querySelector('.masthead-name')
    const badge = sr(el).querySelector('.masthead-badge')
    expect(name?.textContent?.trim()).toBe('Garden')
    expect(badge?.textContent?.trim()).toBe('')
    expect(badge?.hasAttribute('hidden')).toBe(true)
  })

  it('with apps, the app title is the ACTIVE app and the launcher lists every app with a description', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS; e.activeApp = 'choreograph' })
    expect(sr(el).querySelector('.masthead-name')?.textContent?.trim()).toBe('Choreograph')
    const picker = sr(el).querySelector('.app-picker') as HTMLButtonElement
    expect(picker.disabled).toBe(false)
    expect(picker.getAttribute('aria-haspopup')).toBe('menu')
    const descriptions = Array.from(sr(el).querySelectorAll('.switcher-description')).map(d => d.textContent?.trim())
    expect(descriptions).toEqual(['Notes, documents and the knowledge graph', 'Agents, runs and workflows'])
  })

  it('the app picker opens and closes the launcher; aria-expanded mirrors it', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS })
    const picker = sr(el).querySelector('.app-picker') as HTMLButtonElement
    const launcher = sr(el).querySelector('.app-switcher') as HTMLElement
    picker.click()
    await el.updateComplete
    expect(launcher.hasAttribute('popover-open')).toBe(true)
    expect(picker.getAttribute('aria-expanded')).toBe('true')
    picker.click()
    await el.updateComplete
    expect(launcher.hasAttribute('popover-open')).toBe(false)
    expect(picker.getAttribute('aria-expanded')).toBe('false')
  })

  it('a native close (Escape / light dismiss) is mirrored, so the next click reopens instead of "closing"', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS })
    const os = sr(el).querySelector('.app-picker') as HTMLButtonElement
    const menu = sr(el).querySelector('.app-switcher') as HTMLElement
    os.click()
    await el.updateComplete
    // The browser closes the popover itself and fires `toggle` (newState=closed).
    const toggle = Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' })
    menu.dispatchEvent(toggle)
    await el.updateComplete
    expect(menu.hasAttribute('popover-open')).toBe(false)
    expect(os.getAttribute('aria-expanded')).toBe('false')
    os.click()
    await el.updateComplete
    expect(menu.hasAttribute('popover-open')).toBe(true)
  })

  it('with no apps the picker is an inert title (disabled, no caret)', async () => {
    const el = await mount()
    const picker = sr(el).querySelector('.app-picker') as HTMLButtonElement
    expect(picker.disabled).toBe(true)
    expect(sr(el).querySelector('.app-picker-caret')?.hasAttribute('hidden')).toBe(true)
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
    // Launcher rows are radio menu items (a menu, not a tablist).
    expect(garden.getAttribute('role')).toBe('menuitemradio')
    expect(garden.getAttribute('aria-checked')).toBe('true')
    expect(choreo.classList.contains('app-switcher-btn--active')).toBe(false)
    expect(choreo.getAttribute('aria-checked')).toBe('false')
  })

  it('offers an explicitly configured Hoja route as a suite app', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS; e.hojaHref = '/hoja/' })
    const hoja = sr(el).querySelector<HTMLAnchorElement>('.app-switcher-btn[data-app-id="hoja"]')

    expect(hoja?.getAttribute('href')).toBe('/hoja/')
    expect(hoja?.querySelector('.switcher-label')?.textContent?.trim()).toBe('Hoja')
    // One launcher: tabs and links are the same kind of row, unchecked unless current.
    expect(sr(el).querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
    expect(hoja?.getAttribute('aria-checked')).toBe('false')
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
    expect(tabs[0].getAttribute('aria-checked')).toBe('false')
    expect(tabs[1].getAttribute('aria-checked')).toBe('true')
    expect(tabs[1].classList.contains('app-switcher-btn--active')).toBe(true)
  })

  it('an activeApp that matches NO tab (an undeclared/stale app) leaves every tab unselected — never a guess', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS; e.activeApp = 'not-a-real-app' })
    const tabs = sr(el).querySelectorAll('.app-switcher-btn')
    expect(Array.from(tabs).every(t => t.getAttribute('aria-checked') === 'false')).toBe(true)
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

  it('Garden declares exactly one toolbar button — Home — right of the picker; it emits mn-navigate-home', async () => {
    const el = await mount(e => { e.apps = GARDEN_CHOREOGRAPH_TABS })
    const toolbar = sr(el).querySelector('.app-toolbar') as HTMLElement
    expect(toolbar.getAttribute('role')).toBe('toolbar')
    expect(toolbar.getAttribute('aria-label')).toBe('Garden tools')
    expect(toolbar.hasAttribute('hidden')).toBe(false)
    // Order: picker first, toolbar immediately after it.
    expect(sr(el).querySelector('.app-title')?.nextElementSibling).toBe(toolbar)
    const buttons = Array.from(toolbar.querySelectorAll('button'))
    expect(buttons.map(b => b.dataset.appAction)).toEqual(['home'])
    const home = buttons[0]
    // Icon-only: an accessible name and a tooltip, plus a real glyph.
    expect(home.getAttribute('aria-label')).toBe('Home')
    expect(home.getAttribute('title')).toBe('Home')
    expect(home.querySelector('svg')).not.toBeNull()
    let fired = false
    el.addEventListener('mn-navigate-home', () => { fired = true })
    home.click()
    expect(fired).toBe(true)
  })

  it('the toolbar is registry-driven: an app with no declared set renders an empty, hidden toolbar', async () => {
    const el = await mount(e => { e.apps = [...GARDEN_CHOREOGRAPH_TABS, { id: 'grapevine', label: 'Grapevine' }]; e.activeApp = 'grapevine' })
    const toolbar = sr(el).querySelector('.app-toolbar') as HTMLElement
    expect(toolbar.querySelectorAll('button').length).toBe(0)
    expect(toolbar.hasAttribute('hidden')).toBe(true)
    expect(appToolbarActions('grapevine')).toEqual([])
    expect(APP_TOOLBAR_ACTIONS.garden).toEqual([HOME_ACTION])
  })

  it('a shell may override the declared set; each action emits its own event and detail', async () => {
    const el = await mount(e => {
      e.toolbarActions = [
        HOME_ACTION,
        { id: 'search', label: 'Search', icon: 'search', event: 'mn-search-open', detail: { scope: 'graph' } },
      ]
    })
    const buttons = Array.from(sr(el).querySelectorAll<HTMLButtonElement>('.app-toolbar button'))
    expect(buttons.map(b => b.dataset.appAction)).toEqual(['home', 'search'])
    let detail: unknown = null
    el.addEventListener('mn-search-open', e => { detail = (e as CustomEvent).detail })
    buttons[1].click()
    expect(detail).toEqual({ scope: 'graph' })
  })

  it('theme action and skin picker reflect controlled props + emit composed events', async () => {
    const el = await mount(e => { e.isDark = true; e.activeSkin = '98' })
    const buttons = Array.from(sr(el).querySelectorAll('.action-btn')) as HTMLButtonElement[]
    const themeBtn = buttons.find(b => b.getAttribute('aria-label') === 'Toggle theme')!
    const settingsBtn = buttons.find(b => b.getAttribute('aria-label') === 'Settings')!
    const picker = sr(el).querySelector('mn-skin-picker[data-action="skin"]') as HTMLElement & { value: string; updateComplete: Promise<unknown> }
    // pressed state comes from props, not a theme store.
    expect(themeBtn.getAttribute('aria-pressed')).toBe('true')
    expect(themeBtn.classList.contains('active')).toBe(true)
    // the skin control is a picker (a drop-down listing every skin), not a toggle button
    expect(sr(el).querySelector('button[data-action="skin"]')).toBeNull()
    expect(picker.value).toBe('98')
    await picker.updateComplete
    const dropdown = picker.shadowRoot!.querySelector('mn-dropdown-button') as HTMLElement & { updateComplete: Promise<unknown> }
    await dropdown.updateComplete
    const trigger = dropdown.shadowRoot!.querySelector('.trigger') as HTMLButtonElement
    expect(trigger.getAttribute('aria-label')).toContain('98')
    expect(trigger.querySelector('svg')).not.toBeNull()

    let theme = false, settings = false
    const skins: string[] = []
    el.addEventListener('mn-theme-toggle', () => { theme = true })
    el.addEventListener('mn-skin-select', e => { skins.push((e as CustomEvent<{ skin: string }>).detail.skin) })
    el.addEventListener('mn-settings-toggle', () => { settings = true })
    themeBtn.click(); settingsBtn.click()
    trigger.click()
    await dropdown.updateComplete
    dropdown.shadowRoot!.querySelector<HTMLButtonElement>('[data-menu-item-id="glass"]')!.click()
    expect([theme, settings, skins]).toEqual([true, true, ['glass']])
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
    ;(el.shadowRoot!.querySelector('[data-app-action="home"]') as HTMLElement).click()
    expect(caughtOnHost).toBe(true)
  })

  it('says View only for a graph shared with this account as a Viewer, and nothing for its editors', async () => {
    const access = (currentRole: 'viewer' | 'editor' | 'owner') => ({
      graphId: 'shared', graphTitle: 'Shared', currentRole, status: 'ready' as const, grants: [],
    })
    const viewer = await mount(el => { el.access = access('viewer') })
    const chip = sr(viewer).querySelector('[data-view-only]')
    expect(chip?.textContent?.trim()).toBe('View only')
    expect(sr(viewer).querySelector('mn-access-manager')).not.toBeNull()
    viewer.access = access('editor')
    await viewer.updateComplete
    expect(sr(viewer).querySelector('[data-view-only]')).toBeNull()
    const owner = await mount(el => { el.access = access('owner') })
    expect(sr(owner).querySelector('[data-view-only]')).toBeNull()
  })
})

function eBreadcrumb(el: MnTopBar, index: number) {
  return el.breadcrumbs[index]
}
