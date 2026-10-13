/**
 * The unified Sophia chrome: one <mn-top-bar> in Garden, Choreograph and Hoja.
 *
 * REAL component tests (happy-dom, no mocks). Each block mounts the bar the way
 * that app's shell does and checks the four things the suite promises in every
 * app: the picker is there, it lists what the shell permitted in the suite's
 * order, the current app is the checked row, and the app's own toolbar shows.
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-top-bar.js'
import type { ChromeAppLink, ChromeAppTab, MnTopBar } from '../mn-top-bar.js'
import { APP_TOOLBAR_ACTIONS, CHOREOGRAPH_NEW_MODE_ACTION, CHOREOGRAPH_OVERVIEW_ACTION, HOJA_NEW_NOTE_ACTION, HOME_ACTION } from '../app-toolbar.js'
import { orderSophiaApps, sophiaApp, sophiaAppAccessibleName, sophiaAppHref, SOPHIA_APP_ORDER } from '../sophia-suite.js'

async function mount(setup: (el: MnTopBar) => void): Promise<MnTopBar> {
  const el = document.createElement('mn-top-bar') as MnTopBar
  setup(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}
const sr = (el: MnTopBar) => el.shadowRoot!
const rows = (el: MnTopBar) => Array.from(sr(el).querySelectorAll<HTMLElement>('.app-switcher-btn'))
const rowIds = (el: MnTopBar) => rows(el).map(row => row.dataset.appId)
const checked = (el: MnTopBar) => rows(el).filter(row => row.getAttribute('aria-checked') === 'true').map(row => row.dataset.appId)
const toolbarIds = (el: MnTopBar) => Array.from(sr(el).querySelectorAll<HTMLElement>('.app-toolbar button')).map(b => b.dataset.appAction)
const tab = (id: string): ChromeAppTab => ({ id, label: sophiaApp(id).label, icon: sophiaApp(id).icon })
const link = (id: string, href: string): ChromeAppLink => ({ ...tab(id), href })

afterEach(() => { document.body.replaceChildren() })

describe('the suite catalogue', () => {
  it('orders apps Garden → Choreograph → Grapevine → Flow → Hoja, unknown ids last in given order', () => {
    expect(SOPHIA_APP_ORDER).toEqual(['garden', 'choreograph', 'grapevine', 'flow', 'hoja'])
    const ordered = orderSophiaApps([{ id: 'hoja' }, { id: 'zeta' }, { id: 'garden' }, { id: 'alpha' }, { id: 'choreograph' }])
    expect(ordered.map(e => e.id)).toEqual(['garden', 'choreograph', 'hoja', 'zeta', 'alpha'])
  })

  it('names and draws each app one way everywhere', () => {
    expect(sophiaApp('choreograph')).toMatchObject({ label: 'Choreograph', icon: 'workflow' })
    expect(sophiaApp('hoja')).toMatchObject({ label: 'Hoja', icon: 'leaf' })
    expect(sophiaApp('shrubbery-labs')).toMatchObject({ label: 'Shrubbery-labs', icon: 'layers', description: '' })
  })

  it('cross-app links carry the workspace as ?graph= and keep what the base already had', () => {
    expect(sophiaAppHref('/hoja/', 'angels')).toBe('/hoja/?graph=angels')
    expect(sophiaAppHref('/choreograph', 'a b')).toBe('/choreograph?graph=a+b')
    expect(sophiaAppHref('http://127.0.0.1:5191/browser-harness.html?app=choreograph', 'g1'))
      .toBe('http://127.0.0.1:5191/browser-harness.html?app=choreograph&graph=g1')
    expect(sophiaAppHref('/hoja/', '')).toBe('/hoja/')
  })

  it('a release stage is catalogue data: Hoja is experimental, released apps carry none', () => {
    expect(sophiaApp('hoja').stage).toBe('experimental')
    expect(sophiaApp('garden').stage).toBeUndefined()
    expect(sophiaApp('choreograph').stage).toBeUndefined()
    expect(sophiaAppAccessibleName('Hoja', 'experimental')).toBe('Hoja (experimental)')
    expect(sophiaAppAccessibleName('Garden', undefined)).toBe('Garden')
  })

  it('declares a starter toolbar per app', () => {
    expect(APP_TOOLBAR_ACTIONS.garden).toEqual([HOME_ACTION])
    expect(APP_TOOLBAR_ACTIONS.choreograph).toEqual([CHOREOGRAPH_OVERVIEW_ACTION, CHOREOGRAPH_NEW_MODE_ACTION])
    expect(APP_TOOLBAR_ACTIONS.hoja).toEqual([HOJA_NEW_NOTE_ACTION])
  })
})

describe('Garden (organism workspace)', () => {
  const garden = (el: MnTopBar) => {
    el.activeApp = 'garden'
    el.apps = [tab('garden'), tab('choreograph')]
    el.appLinks = [link('hoja', '/hoja/?graph=g1')]
  }

  it('picker present; Garden checked; Garden → Choreograph → Hoja; Home toolbar; every right control', async () => {
    const el = await mount(garden)
    expect((sr(el).querySelector('.app-picker') as HTMLButtonElement).disabled).toBe(false)
    expect(sr(el).querySelector('.masthead-name')?.textContent?.trim()).toBe('Garden')
    expect(rowIds(el)).toEqual(['garden', 'choreograph', 'hoja'])
    expect(checked(el)).toEqual(['garden'])
    expect(toolbarIds(el)).toEqual(['home'])
    for (const action of ['theme', 'skin', 'settings']) {
      expect(sr(el).querySelector<HTMLElement>(`[data-action="${action}"]`)?.hidden).toBe(false)
    }
  })

  it('a link opens by navigation (an anchor with the workspace in it), a tab by mn-app-change', async () => {
    const el = await mount(garden)
    const hoja = sr(el).querySelector<HTMLAnchorElement>('.app-switcher-btn[data-app-id="hoja"]')!
    expect(hoja.tagName).toBe('A')
    expect(hoja.getAttribute('href')).toBe('/hoja/?graph=g1')
    let app: unknown = null
    el.addEventListener('mn-app-change', e => { app = (e as CustomEvent<{ app: string }>).detail.app })
    sr(el).querySelector<HTMLButtonElement>('.app-switcher-btn[data-app-id="choreograph"]')!.click()
    expect(app).toBe('choreograph')
  })

  it('an operator Choreograph link fills in when the workspace config declares no Choreograph tab', async () => {
    const el = await mount(e => {
      e.activeApp = 'garden'
      e.apps = [tab('garden')]
      e.appLinks = [link('hoja', '/hoja/?graph=g1'), link('choreograph', '/choreograph?graph=g1')]
    })
    expect(rowIds(el)).toEqual(['garden', 'choreograph', 'hoja'])
    expect(sr(el).querySelector('.app-switcher-btn[data-app-id="choreograph"]')?.getAttribute('href')).toBe('/choreograph?graph=g1')
  })

  it('an in-shell tab wins over a link with the same id (no duplicate rows)', async () => {
    const el = await mount(e => { garden(e); e.appLinks = [...e.appLinks, link('choreograph', '/choreograph')] })
    expect(rowIds(el)).toEqual(['garden', 'choreograph', 'hoja'])
    expect(sr(el).querySelector('.app-switcher-btn[data-app-id="choreograph"]')?.tagName).toBe('BUTTON')
  })

  it('a non-operator sees Garden only (the shell permitted nothing else)', async () => {
    const el = await mount(e => { e.activeApp = 'garden'; e.apps = [tab('garden')] })
    expect(rowIds(el)).toEqual(['garden'])
    expect(checked(el)).toEqual(['garden'])
  })

  it('Grapevine / Flow tabs sit in suite order when a shell composes them', async () => {
    const el = await mount(e => {
      e.activeApp = 'flow'
      e.apps = [tab('garden'), tab('flow'), tab('grapevine'), tab('choreograph')]
      e.appLinks = [link('hoja', '/hoja/')]
    })
    expect(rowIds(el)).toEqual(['garden', 'choreograph', 'grapevine', 'flow', 'hoja'])
    expect(checked(el)).toEqual(['flow'])
  })
})

describe('Choreograph (in-organism app and the /choreograph route)', () => {
  it('in the organism: Choreograph checked, Overview + New mode toolbar', async () => {
    const el = await mount(e => {
      e.activeApp = 'choreograph'
      e.apps = [tab('garden'), tab('choreograph')]
      e.appLinks = [link('hoja', '/hoja/?graph=g1')]
    })
    expect(sr(el).querySelector('.masthead-name')?.textContent?.trim()).toBe('Choreograph')
    expect(sr(el).querySelector('.masthead-icon')?.getAttribute('data-app-id')).toBe('choreograph')
    expect(rowIds(el)).toEqual(['garden', 'choreograph', 'hoja'])
    expect(checked(el)).toEqual(['choreograph'])
    expect(toolbarIds(el)).toEqual(['overview', 'new-mode'])
  })

  it('on the route: Garden is a link back into the same workspace; the toolbar emits its events', async () => {
    const el = await mount(e => {
      e.activeApp = 'choreograph'
      e.apps = [tab('choreograph')]
      e.appLinks = [link('garden', '/?graph=g1'), link('hoja', '/hoja/?graph=g1')]
    })
    expect(rowIds(el)).toEqual(['garden', 'choreograph', 'hoja'])
    expect(checked(el)).toEqual(['choreograph'])
    expect(sr(el).querySelector('.app-switcher-btn[data-app-id="garden"]')?.getAttribute('href')).toBe('/?graph=g1')
    const fired: string[] = []
    for (const name of ['mn-choreograph-overview', 'mn-choreograph-new-mode']) {
      document.addEventListener(name, () => fired.push(name), { once: true })
    }
    for (const button of sr(el).querySelectorAll<HTMLButtonElement>('.app-toolbar button')) button.click()
    // Composed + bubbling: a surface listening on its document hears the bar.
    expect(fired).toEqual(['mn-choreograph-overview', 'mn-choreograph-new-mode'])
  })

  it('an active LINK is the checked row and does not navigate', async () => {
    const el = await mount(e => { e.activeApp = 'choreograph'; e.appLinks = [link('garden', '/'), link('choreograph', '/choreograph')] })
    const row = sr(el).querySelector<HTMLElement>('.app-switcher-btn[data-app-id="choreograph"]')!
    expect(row.tagName).toBe('BUTTON')
    expect(row.getAttribute('aria-checked')).toBe('true')
  })
})

describe('Hoja (standalone suite app)', () => {
  const hoja = (el: MnTopBar) => {
    el.activeApp = 'hoja'
    el.apps = [tab('hoja'), tab('garden'), tab('choreograph')]
    el.controls = ['theme']
  }

  it('picker present; Hoja checked; same order as Garden; New note toolbar; theme only on the right', async () => {
    const el = await mount(hoja)
    expect(sr(el).querySelector('.masthead-name')?.textContent?.trim()).toBe('Hoja')
    expect(rowIds(el)).toEqual(['garden', 'choreograph', 'hoja'])
    expect(checked(el)).toEqual(['hoja'])
    expect(toolbarIds(el)).toEqual(['new-note'])
    expect(sr(el).querySelector<HTMLElement>('[data-action="theme"]')?.hidden).toBe(false)
    for (const action of ['skin', 'settings']) {
      expect(sr(el).querySelector<HTMLElement>(`[data-action="${action}"]`)?.hidden).toBe(true)
    }
    expect(sr(el).querySelector<HTMLElement>('.appearance-btn')?.hidden).toBe(true)
  })

  it('without the Choreograph gate Hoja lists Garden + Hoja only', async () => {
    const el = await mount(e => { hoja(e); e.apps = [tab('hoja'), tab('garden')] })
    expect(rowIds(el)).toEqual(['garden', 'hoja'])
  })

  it('a disabled toolbar action (read-only workspace) renders but does not fire', async () => {
    const el = await mount(e => { hoja(e); e.toolbarActions = [{ ...HOJA_NEW_NOTE_ACTION, disabled: true }] })
    const button = sr(el).querySelector<HTMLButtonElement>('[data-app-action="new-note"]')!
    expect(button.disabled).toBe(true)
    let fired = false
    el.addEventListener('mn-hoja-new-note', () => { fired = true })
    button.click()
    expect(fired).toBe(false)
  })

  it('the Hoja New note action emits mn-hoja-new-note', async () => {
    const el = await mount(hoja)
    let fired = false
    el.addEventListener('mn-hoja-new-note', () => { fired = true })
    sr(el).querySelector<HTMLButtonElement>('[data-app-action="new-note"]')!.click()
    expect(fired).toBe(true)
  })
})

describe('Choreograph modes surface answers its toolbar', () => {
  it('New mode opens the Modes screen; Overview returns home', async () => {
    await import('../choreo-modes-surface.js')
    const surface = document.createElement('choreo-modes-surface') as HTMLElement & { updateComplete: Promise<unknown> }
    document.body.append(surface)
    await surface.updateComplete
    const current = () => surface.shadowRoot!.querySelector<HTMLElement>('.studio-nav-item[aria-current="page"]')?.dataset.screen
    expect(current()).toBe('overview')
    const bar = await mount(e => { e.activeApp = 'choreograph'; e.apps = [tab('garden'), tab('choreograph')] })
    sr(bar).querySelector<HTMLButtonElement>('[data-app-action="new-mode"]')!.click()
    await surface.updateComplete
    expect(current()).toBe('modes')
    sr(bar).querySelector<HTMLButtonElement>('[data-app-action="overview"]')!.click()
    await surface.updateComplete
    expect(current()).toBe('overview')
    surface.remove()
    // Detached: the document listener is gone with the surface.
    sr(bar).querySelector<HTMLButtonElement>('[data-app-action="new-mode"]')!.click()
    expect(current()).toBe('overview')
  })
})

describe('release stage tag in the launcher', () => {
  const stageOf = (el: MnTopBar, id: string) => sr(el).querySelector<HTMLElement>(`.app-switcher-btn[data-app-id="${id}"] .app-stage`)
  const rowOf = (el: MnTopBar, id: string) => sr(el).querySelector<HTMLElement>(`.app-switcher-btn[data-app-id="${id}"]`)

  it('Hoja as a link row (Garden, the /choreograph route) shows the experimental tag and names itself so', async () => {
    const el = await mount(el => {
      el.apps = [tab('garden')]
      el.appLinks = [link('hoja', '/hoja/?graph=g')]
      el.activeApp = 'garden'
    })
    expect(stageOf(el, 'hoja')?.textContent?.trim()).toBe('experimental')
    expect(stageOf(el, 'hoja')?.dataset.stage).toBe('experimental')
    expect(stageOf(el, 'hoja')?.getAttribute('aria-hidden')).toBe('true')
    expect(rowOf(el, 'hoja')?.getAttribute('aria-label')).toBe('Hoja (experimental) app')
    expect(stageOf(el, 'garden')).toBeNull()
    expect(rowOf(el, 'garden')?.getAttribute('aria-label')).toBe('Garden app')
  })

  it('Hoja as the checked tab row (inside Hoja) keeps the tag', async () => {
    const el = await mount(el => {
      el.apps = [tab('hoja'), tab('garden')]
      el.activeApp = 'hoja'
    })
    expect(rowOf(el, 'hoja')?.getAttribute('aria-checked')).toBe('true')
    expect(stageOf(el, 'hoja')?.textContent?.trim()).toBe('experimental')
    expect(rowOf(el, 'hoja')?.getAttribute('aria-label')).toBe('Hoja (experimental) app')
  })

  it('a shell may stage any app through its tab data, and that wins over the catalogue', async () => {
    const el = await mount(el => {
      el.apps = [tab('garden'), { ...tab('choreograph'), stage: 'beta' }, { ...tab('hoja'), stage: '' }]
      el.activeApp = 'garden'
    })
    expect(stageOf(el, 'choreograph')?.textContent?.trim()).toBe('beta')
    expect(rowOf(el, 'choreograph')?.getAttribute('aria-label')).toBe('Choreograph (beta) app')
    expect(stageOf(el, 'hoja')).toBeNull()
  })
})
