/**
 * Real-Chromium contract for the controlled workspace selector.
 *
 * Runs the same assertions headless or with SHRUBBERY_HEADED=1. The fixture is
 * injected into the deterministic organism harness so it consumes production
 * component code and tokens without adding a second demo implementation.
 */

import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium, type Locator, type Page } from 'playwright'
import { createServer } from 'vite'
import type { MnWorkspaceSelector, MnWorkspaceSummary } from '@shrubbery/components'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.SHRUBBERY_WORKSPACE_SELECTOR_BROWSER_PORT ?? 0)
const artifactDir = process.env.SHRUBBERY_WORKSPACE_SELECTOR_ARTIFACT_DIR
  ?? resolve(tmpdir(), 'shrubbery-workspace-selector-browser')
const headed = process.env.SHRUBBERY_HEADED === '1'
const humanPauseMs = Number(process.env.SHRUBBERY_WORKSPACE_SELECTOR_PAUSE_MS ?? (headed ? 650 : 0))

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`workspace-selector-browser-harness assertion failed: ${message}`)
}

async function humanPause(page: Page): Promise<void> {
  if (humanPauseMs > 0) await page.waitForTimeout(humanPauseMs)
}

async function waitForWorkspace(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = (window as unknown as {
      __organism?: { state: { ready?: boolean; error?: string | null } }
    }).__organism?.state
    return state?.ready === true || Boolean(state?.error)
  }, undefined, { timeout: 60_000 })
  const error = await page.evaluate(() => window.__organism?.state.error ?? null)
  assert(error == null, `deterministic workspace boot error: ${String(error)}`)
}

async function setAppearance(page: Page, skin: 'garden' | 'emporium' | '98' | 'glass', theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(({ nextSkin, nextTheme }) => {
    if (nextSkin === 'garden') document.documentElement.removeAttribute('data-skin')
    else document.documentElement.dataset.skin = nextSkin
    document.documentElement.dataset.theme = nextTheme
  }, { nextSkin: skin, nextTheme: theme })
  await page.waitForFunction(({ expectedSkin, expectedTheme }) => {
    const selector = document.querySelector('mn-workspace-selector')
    return selector?.getAttribute('data-skin') === (expectedSkin === 'garden' ? null : expectedSkin)
      && selector?.getAttribute('data-theme') === expectedTheme
  }, { expectedSkin: skin, expectedTheme: theme })
}

async function openSelector(trigger: Locator, menu: Locator): Promise<void> {
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  await menu.waitFor({ state: 'visible' })
}

await mkdir(artifactDir, { recursive: true })

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: requestedPort,
    strictPort: requestedPort !== 0,
    hmr: false,
  },
  logLevel: 'warn',
})
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : requestedPort
if (!port) throw new Error('Workspace-selector browser harness could not resolve its Vite port')

const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 55 : 0 })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const pageErrors: string[] = []
const consoleProblems: string[] = []
const requestFailures: string[] = []
const responseFailures: string[] = []
const allowedConsoleWarnings = [
  /^Lit is in dev mode\./,
]

page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleProblems.push(`error: ${message.text()}`)
  if (message.type() === 'warning' && !allowedConsoleWarnings.some(pattern => pattern.test(message.text()))) {
    consoleProblems.push(`warning: ${message.text()}`)
  }
})
page.on('requestfailed', request => requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`))
page.on('response', response => {
  if (response.status() >= 400) responseFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`)
})

try {
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitForWorkspace(page)

  await page.evaluate(async () => {
    document.querySelector('#harness-root')?.remove()
    document.querySelector('#harness-failure')?.remove()
    // The deterministic app owns a body-level responsive portal. Its controller
    // remains useful in the full app harness, but this isolated fixture removes
    // that already-created portal so it cannot cover the compact proof surface.
    document.querySelectorAll('.organism-mobile-shell').forEach(portal => portal.remove())
    document.body.removeAttribute('data-organism-mobile-shell-active')
    document.body.style.overflow = 'auto'
    document.body.style.minHeight = '100dvh'
    document.body.style.padding = '44px'

    const stage = document.createElement('main')
    stage.id = 'workspace-selector-fixture'
    stage.setAttribute('aria-label', 'Workspace selector browser fixture')
    stage.style.position = 'relative'
    stage.style.width = 'fit-content'
    stage.style.maxWidth = '100%'
    stage.style.padding = '10px'
    stage.style.border = '1px solid var(--mn-color-border-subtle, #dfe7e1)'
    stage.style.background = 'var(--mn-top-bar-bg, #e7f0e9)'

    const selector = document.createElement('mn-workspace-selector') as MnWorkspaceSelector
    selector.status = 'ready'
    selector.activeGraphId = 'owned-alpha'
    selector.busyGraphId = ''
    selector.workspaces = [
      {
        graphId: 'owned-alpha',
        title: 'Alpha Garden',
        role: 'owner',
        cellState: 'running',
        path: ['Vera', 'Research'],
        capabilities: { delete: { available: true } },
      },
      {
        graphId: 'owned-lab',
        title: 'Sophia Code Lab — an intentionally long workspace title for overflow proof',
        role: 'owner',
        cellState: 'starting',
        path: ['Sophia', 'Engineering', 'Cloud 2', 'Concordance'],
        capabilities: { delete: { available: true } },
      },
      {
        graphId: 'shared-notes',
        title: 'Shared Notes',
        role: 'editor',
        cellState: 'stopped',
        path: ['Eschaton', 'Commons'],
        capabilities: { leave: { available: true } },
      },
      {
        graphId: 'viewer-archive',
        title: 'Archive',
        role: 'viewer',
        cellState: 'running',
        disabled: true,
        disabledReason: 'Read-only gateway access is not available yet.',
        capabilities: {},
      },
    ] satisfies readonly MnWorkspaceSummary[]

    ;(window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents = []
    selector.addEventListener('mn-workspace-select', event => {
      const workspace = (event as CustomEvent<{ workspace: { graphId: string } }>).detail.workspace
      ;(window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents.push(`select:${workspace.graphId}`)
      selector.busyGraphId = workspace.graphId
      window.setTimeout(() => {
        selector.activeGraphId = workspace.graphId
        selector.busyGraphId = ''
      }, 520)
    })
    selector.addEventListener('mn-workspace-delete', event => {
      const workspace = (event as CustomEvent<{ workspace: { graphId: string } }>).detail.workspace
      ;(window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents.push(`delete:${workspace.graphId}`)
    })
    selector.addEventListener('mn-workspace-leave', event => {
      const workspace = (event as CustomEvent<{ workspace: { graphId: string } }>).detail.workspace
      ;(window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents.push(`leave:${workspace.graphId}`)
    })
    selector.addEventListener('mn-workspace-create', () => {
      ;(window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents.push('create')
    })
    selector.addEventListener('mn-workspace-refresh', () => {
      ;(window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents.push('refresh')
    })

    stage.append(selector)
    document.body.append(stage)
    await selector.updateComplete
  })

  const fixture = page.locator('#workspace-selector-fixture')
  const selector = fixture.locator('mn-workspace-selector')
  const trigger = selector.locator('.trigger')
  const menu = selector.locator('.menu')

  // Desktop: OG owned/shared grammar, quiet metadata, real capability menu.
  await openSelector(trigger, menu)
  assert(await selector.locator('[data-group="owned"] .group-heading').textContent() === 'My Workspaces', 'owned group heading is missing')
  assert(await selector.locator('[data-group="shared"] .group-heading').textContent() === 'Shared with me', 'shared group heading is missing')
  assert((await selector.locator('[data-graph-id="owned-alpha"] .path-line').textContent())?.includes('Vera / Research'), 'owned hierarchy path is missing')
  assert(await selector.locator('[data-graph-id="shared-notes"] .role').textContent() === 'Editor', 'shared editor role is missing')
  assert(await selector.locator('[data-graph-id="shared-notes"] .lifecycle').textContent() === 'Cell asleep', 'stopped lifecycle is missing')
  assert(await selector.locator('[data-graph-id="owned-alpha"] .lifecycle').count() === 0, 'running state should be quiet')
  assert(await selector.locator('[data-graph-id="viewer-archive"] .more').count() === 0, 'viewer received a fake management action')
  assert(await selector.locator('[data-graph-id="viewer-archive"] .select').isDisabled(), 'backend-gated viewer is selectable')
  assert((await selector.locator('[data-graph-id="viewer-archive"] .disabled-reason').textContent())?.includes('Read-only gateway'), 'viewer disabled reason is missing')

  // Top-layer contract: the menu must be a real Popover-API element promoted
  // above the page's stacking contexts, not a locally z-indexed absolute div
  // trapped inside the top-bar's stacking-context island (DIAGNOSIS.md Part 1
  // — the canary clip-under-the-doc-bar bug). Real Chromium is the only runtime
  // that can prove native top-layer promotion; happy-dom only proves the
  // `popover-open` attribute fallback, so this assertion is the load-bearing
  // one this harness exists for.
  assert(await menu.evaluate(element => element.hasAttribute('popover')), 'menu does not declare popover="manual" — not promoted to the top layer')
  assert(await menu.evaluate(element => element.matches(':popover-open')), 'open menu is not :popover-open in real Chromium — top-layer promotion did not take effect')

  const desktopGeometry = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const triggerRect = (element.getRootNode() as ShadowRoot).querySelector<HTMLElement>('.trigger')!.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, triggerBottom: triggerRect.bottom, position: getComputedStyle(element).position }
  })
  assert(desktopGeometry.position === 'fixed', 'desktop selector is not a viewport-fixed top-layer overlay')
  assert(desktopGeometry.top >= desktopGeometry.triggerBottom - 1, 'desktop selector is not anchored below the trigger')
  assert(desktopGeometry.left >= 0 && desktopGeometry.right <= 1280, 'desktop selector overflows the viewport')

  await selector.locator('[data-graph-id="owned-alpha"] .more').click()
  assert(await selector.locator('.action-item').count() === 1, 'owner menu should expose only the supported action')
  assert(await selector.locator('.action-item[data-action="delete"]').count() === 1, 'real owner delete action is missing')
  assert(await selector.locator('.action-item[data-action="rename"]').count() === 0, 'unsupported rename was fabricated')
  await page.keyboard.press('Escape')
  assert(await selector.locator('.action-menu').count() === 0, 'first Escape did not close the overflow menu')
  assert(await menu.isVisible(), 'first Escape closed the parent selector too')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })

  // Keyboard open focuses the first real option; switching remains controlled.
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await menu.waitFor({ state: 'visible' })
  const focusedClass = await selector.evaluate(element => (element.shadowRoot?.activeElement as HTMLElement | null)?.className ?? '')
  assert(String(focusedClass).includes('select'), 'keyboard open did not focus a workspace option')
  await selector.locator('[data-graph-id="shared-notes"] .select').click()
  await selector.locator('.progress').waitFor({ state: 'visible' })
  assert((await selector.locator('.progress').textContent())?.includes('Switching to Shared Notes'), 'switch continuity message is missing')
  assert(await trigger.locator('.trigger-label').textContent() === 'Alpha Garden', 'selector invented active workspace truth before host convergence')
  assert(await menu.isVisible(), 'selector disappeared during an in-flight switch')
  await page.waitForFunction(() => document.querySelector('mn-workspace-selector')?.getAttribute('active-graph-id') === null
    ? (document.querySelector('mn-workspace-selector') as unknown as { activeGraphId?: string })?.activeGraphId === 'shared-notes'
    : false)
  await menu.waitFor({ state: 'hidden' })
  assert(await trigger.locator('.trigger-label').textContent() === 'Shared Notes', 'host-converged selection did not reach the trigger')

  const eventsAfterSwitch = await page.evaluate(() => (window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents)
  assert(eventsAfterSwitch.includes('select:shared-notes'), 'select intent did not cross the host boundary')

  // Error/retry/empty are honest controlled catalog states.
  await selector.evaluate(async element => {
    const controlled = element as MnWorkspaceSelector
    controlled.status = 'error'
    controlled.error = 'Catalog unavailable for proof.'
    await controlled.updateComplete
  })
  await openSelector(trigger, menu)
  assert((await selector.locator('[role="alert"]').textContent())?.includes('Catalog unavailable for proof'), 'error state is not visible')
  await selector.locator('.retry').click()
  const eventsAfterRetry = await page.evaluate(() => (window as unknown as { __workspaceSelectorEvents: string[] }).__workspaceSelectorEvents)
  assert(eventsAfterRetry.filter(event => event === 'refresh').length >= 2, 'open + Retry did not emit refresh intents')
  await page.keyboard.press('Escape')
  await selector.evaluate(async element => {
    const controlled = element as MnWorkspaceSelector
    controlled.workspaces = []
    controlled.status = 'ready'
    await controlled.updateComplete
  })
  await openSelector(trigger, menu)
  assert((await selector.locator('.state').textContent())?.includes('No workspaces found'), 'empty catalog state is missing')
  await page.keyboard.press('Escape')

  // Restore the catalog, then prove all four product skins in both themes.
  await page.evaluate(async () => {
    const controlled = document.querySelector<MnWorkspaceSelector>('mn-workspace-selector')
    if (!controlled) throw new Error('workspace selector fixture disappeared')
    controlled.workspaces = [
      { graphId: 'owned-alpha', title: 'Alpha Garden', role: 'owner', cellState: 'running', path: ['Vera', 'Research'], capabilities: { delete: { available: true } } },
      { graphId: 'owned-lab', title: 'Sophia Code Lab — an intentionally long workspace title for overflow proof', role: 'owner', cellState: 'starting', path: ['Sophia', 'Engineering', 'Cloud 2', 'Concordance'], capabilities: { delete: { available: true } } },
      { graphId: 'shared-notes', title: 'Shared Notes', role: 'editor', cellState: 'stopped', path: ['Eschaton', 'Commons'], capabilities: { leave: { available: true } } },
      { graphId: 'viewer-archive', title: 'Archive', role: 'viewer', cellState: 'running', disabled: true, disabledReason: 'Read-only gateway access is not available yet.', capabilities: {} },
    ] satisfies readonly MnWorkspaceSummary[]
    controlled.status = 'ready'
    await controlled.updateComplete
  })

  for (const skin of ['garden', 'emporium', '98', 'glass'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await setAppearance(page, skin, theme)
      await openSelector(trigger, menu)
      const material = await menu.evaluate(element => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return {
          background: style.backgroundColor,
          borderRadius: style.borderRadius,
          backdrop: style.backdropFilter,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }
      })
      assert(material.background !== 'rgba(0, 0, 0, 0)', `${skin}/${theme} selector has a transparent accidental surface`)
      assert(material.left >= 0 && material.right <= 1280 && material.top >= 0 && material.bottom <= 800, `${skin}/${theme} selector escaped the desktop viewport`)
      if (skin === '98') assert(material.borderRadius === '0px', `98/${theme} did not acquire square window geometry`)
      if (skin === 'glass') assert(material.backdrop !== 'none', `glass/${theme} did not acquire translucent material`)
      await page.keyboard.press('Escape')
    }
  }
  await setAppearance(page, 'garden', 'light')
  await openSelector(trigger, menu)
  await humanPause(page)
  await page.screenshot({ path: resolve(artifactDir, 'workspace-selector-desktop.png'), fullPage: true })
  await page.keyboard.press('Escape')

  // Compact: bottom sheet, visible touch actions, viewport-safe overflow, backdrop.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    document.querySelectorAll('.organism-mobile-shell').forEach(portal => portal.remove())
    document.body.removeAttribute('data-organism-mobile-shell-active')
    document.body.style.padding = '12px'
  })
  await openSelector(trigger, menu)
  // Mobile also promotes to the top layer (DIAGNOSIS.md §3.1 mobile decision):
  // the bottom sheet shares the same `.menu` popover element, it just skips JS
  // positioning so the CSS `inset` bottom-sheet rule wins.
  assert(await menu.evaluate(element => element.matches(':popover-open')), 'compact menu is not :popover-open in real Chromium — mobile top-layer promotion did not take effect')
  const compactGeometry = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return { left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, position: style.position }
  })
  assert(compactGeometry.position === 'fixed', 'compact selector is not a fixed bottom sheet')
  assert(Math.abs(compactGeometry.left) <= 1 && Math.abs(compactGeometry.right - 390) <= 1, 'compact sheet does not span the viewport')
  assert(Math.abs(compactGeometry.bottom - 844) <= 1, 'compact sheet is not docked to the bottom edge')
  assert(await selector.locator('.sheet-header').isVisible(), 'compact sheet header is missing')
  assert(await selector.locator('.backdrop').isVisible(), 'compact modal backdrop is missing')
  const moreOpacity = await selector.locator('[data-graph-id="owned-alpha"] .more').evaluate(element => getComputedStyle(element).opacity)
  assert(moreOpacity === '1', 'compact management action is hidden behind hover')
  const overflow = await selector.locator('[data-graph-id="owned-lab"] .name').evaluate(element => {
    const style = getComputedStyle(element)
    return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, overflow: style.overflow, textOverflow: style.textOverflow }
  })
  assert(overflow.scrollWidth > overflow.clientWidth, 'long compact workspace title did not exercise overflow')
  assert(overflow.overflow === 'hidden' && overflow.textOverflow === 'ellipsis', 'long compact workspace title is not safely elided')

  await page.screenshot({ path: resolve(artifactDir, 'workspace-selector-compact.png'), fullPage: true })
  await humanPause(page)
  await page.mouse.click(8, 80)
  await menu.waitFor({ state: 'hidden' })

  await openSelector(trigger, menu)
  await selector.locator('[data-graph-id="owned-lab"] .select').click()
  await selector.locator('.progress').waitFor({ state: 'visible' })
  assert((await selector.locator('.progress').textContent())?.includes('Switching to Sophia Code Lab'), 'compact switch continuity is missing')
  await menu.waitFor({ state: 'hidden' })
  assert((await trigger.locator('.trigger-label').textContent())?.startsWith('Sophia Code Lab'), 'compact switch did not converge')

  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleProblems.length === 0, `console problems:\n${consoleProblems.join('\n')}`)
  assert(requestFailures.length === 0, `request failures:\n${requestFailures.join('\n')}`)
  assert(responseFailures.length === 0, `HTTP failures:\n${responseFailures.join('\n')}`)

  console.log(`workspace-selector-browser-harness: PASS (${headed ? 'headed' : 'headless'} Chromium; desktop + compact; Garden/Emporium/98/Glass light+dark)`)
  console.log(`workspace-selector-browser-harness: screenshots ${artifactDir}`)
} finally {
  await context.close()
  await browser.close()
  await server.close()
}
