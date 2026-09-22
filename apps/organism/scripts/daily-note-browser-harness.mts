/**
 * Live Daily Note browser regression.
 *
 * This owns the complete production-shaped path under test:
 *   real Chromium -> real Organism page -> same-origin Vite HTTP/WS proxy ->
 *   fresh real gardend cell.
 *
 * It intentionally does not use the deterministic in-memory browser fixture.
 * A passing run proves the Daily Note home gesture creates/opens the document,
 * the lifted editor anchor remains usable below its header, a real pointer can
 * focus ProseMirror, and browser typing crosses the doc-sync WebSocket and
 * survives a full page reload + Daily Note reopen.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer as createViteServer, type ProxyOptions, type ViteDevServer } from 'vite'
import { WebSocket as NodeWebSocket } from 'ws'
import * as Y from 'yjs'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { LoopbackCrdtBackend } from '../src/cell/loopback-crdt-backend.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphId = `daily-note-browser-${randomUUID()}`
const marker = `Daily Note live browser ${randomUUID()}`
const WebSocketPolyfill = NodeWebSocket as unknown as new (
  url: string | URL,
  protocols?: string | string[],
) => unknown

const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')
const seedNt = readFileSync(seedPath, 'utf8')

function chromeExecutable(): string | undefined {
  const explicit = process.env.SHRUBBERY_CHROME_EXECUTABLE
    ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (explicit) {
    assert(existsSync(explicit), `configured Chrome executable does not exist: ${explicit}`)
    return explicit
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'linux'
      ? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
      : []
  return candidates.find(candidate => existsSync(candidate))
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`daily-note-browser-harness assertion failed: ${message}`)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
    }),
  ])
}

async function freePort(): Promise<number> {
  const socket = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolveListen)
  })
  const address = socket.address()
  assert(address && typeof address === 'object', 'could not reserve a local Vite port')
  const port = address.port
  await new Promise<void>((resolveClose, reject) => {
    socket.close(error => error ? reject(error) : resolveClose())
  })
  return port
}

function liveCellProxy(cell: GardendCell): Record<string, ProxyOptions> {
  return {
    '/cell': {
      target: cell.apiUrl,
      changeOrigin: true,
      ws: true,
      rewrite: path => path.replace(/^\/cell/, ''),
      configure(proxy) {
        proxy.on('proxyReq', request => {
          request.setHeader('Authorization', `Bearer ${cell.token}`)
        })
        proxy.on('proxyReqWs', (request: { setHeader(name: string, value: string): void }) => {
          request.setHeader('Authorization', `Bearer ${cell.token}`)
          request.setHeader('Origin', 'http://127.0.0.1')
        })
      },
    },
  }
}

async function selectLiveHome(page: Page): Promise<void> {
  const params = new URL(page.url()).searchParams
  if (params.get('source') === 'cell') {
    await page.waitForFunction((expectedGraphId) => {
      const graphInput = document.querySelector<HTMLInputElement>('#cell-graph-id')
      const status = document.querySelector<HTMLElement>('#status')
      const surface = document.querySelector<HTMLElement>('sh-workspace-surface')
      const home = surface?.querySelector<HTMLElement>('mn-home-view')
      const row = home?.shadowRoot?.querySelector('mn-daily-note-row')
      const editor = surface?.querySelector<HTMLElement>('sh-editor-host')
      return document.body.dataset.organismMode === 'local-cell'
        && graphInput?.value === expectedGraphId
        && status?.classList.contains('ok') === true
        && status.textContent?.includes('LIVE cell read') === true
        && (row !== null || editor !== null)
    }, graphId, { timeout: 60_000 })
    return
  }
  // The page is usable before bootOrganism's first async render finishes. Wait
  // for that authoritative initial SEED_NT render so it cannot race in later
  // and overwrite the live-cell selection made below.
  await page.waitForFunction(() => {
    const source = document.querySelector<HTMLSelectElement>('#source-select')
    const status = document.querySelector<HTMLElement>('#status')
    return source?.value === 'SEED_NT' && status?.textContent?.includes('parsed 275 triples') === true
  }, undefined, { timeout: 60_000 })
  await page.locator('#cell-graph-id').fill(graphId)
  await page.locator('#source-select').selectOption('CELL_LIVE')
  await page.waitForFunction((expectedGraphId) => {
    const graphInput = document.querySelector<HTMLInputElement>('#cell-graph-id')
    const status = document.querySelector<HTMLElement>('#status')
    const home = document.querySelector<HTMLElement>('sh-workspace-surface mn-home-view')
    const row = home?.shadowRoot?.querySelector('mn-daily-note-row')
    return graphInput?.value === expectedGraphId
      && status?.classList.contains('ok') === true
      && status.textContent?.includes('LIVE cell read') === true
      && row !== null
  }, graphId, { timeout: 60_000 })
}

async function ensureDailyNoteHome(page: Page): Promise<void> {
  if (await page.locator('sh-workspace-surface mn-home-view').count() === 0) {
    await page.locator('mn-top-bar .masthead').click()
  }
  await page.locator('sh-workspace-surface mn-home-view mn-daily-note-row').waitFor({ state: 'attached' })
}

async function openDailyNote(page: Page): Promise<string> {
  const home = page.locator('sh-workspace-surface mn-home-view')
  const dailyRow = home.locator('mn-daily-note-row')
  await dailyRow.waitFor({ state: 'attached' })
  const dateKey = await dailyRow.evaluate((node) => {
    const row = node as HTMLElement & { displayedDate?: string }
    return row.displayedDate ?? row.getAttribute('displayed-date') ?? ''
  })
  assert(/^\d{4}-\d{2}-\d{2}$/.test(dateKey), `Daily Note row exposed an invalid date key: ${dateKey}`)

  let clickError: unknown = null
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const row = home.locator('mn-daily-note-row .row')
      await row.waitFor({ state: 'visible', timeout: 1_000 })
      const box = await row.boundingBox()
      if (!box) continue
      // The live cell refreshes the home face while its sidebar/daily-note
      // projections settle. A locator click can hold a detached node for its
      // actionability retry window; a coordinate-level mouse click keeps the
      // browser's real pointer semantics and targets whichever visible row is
      // mounted at the instant of dispatch.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.locator(`mn-daily-note-header[date-key="${dateKey}"]`).waitFor({
        state: 'attached',
        timeout: 1_000,
      })
      clickError = null
      break
    } catch (error) {
      clickError = error
      if (await page.locator(`mn-daily-note-header[date-key="${dateKey}"]`).count() > 0) {
        clickError = null
        break
      }
    }
  }
  if (clickError) throw clickError
  await page.waitForFunction((expectedDateKey) => {
    const status = document.querySelector<HTMLElement>('#status')
    const header = document.querySelector<HTMLElement>('mn-daily-note-header')
    return status?.classList.contains('err') === true
      || header?.getAttribute('date-key') === expectedDateKey
  }, dateKey, { timeout: 30_000 })

  const status = page.locator('#status')
  const statusText = (await status.textContent()) ?? ''
  assert(!(await status.evaluate(node => node.classList.contains('err'))), `Daily Note click failed: ${statusText}`)
  assert(
    await page.locator(`mn-daily-note-header[date-key="${dateKey}"]`).count() === 1,
    'Daily Note click did not open the dated editor surface',
  )
  assert(
    await page.locator('#cell-doc-id').inputValue() === `daily-note-${dateKey}`,
    'Daily Note click did not select the deterministic document id',
  )
  return dateKey
}

interface EditorGeometry {
  readonly frame: DOMRectJson
  readonly header: DOMRectJson
  readonly anchor: DOMRectJson
  readonly host: DOMRectJson
  readonly proseMirror: DOMRectJson
}

interface DOMRectJson {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

async function editorGeometry(page: Page): Promise<EditorGeometry> {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('sh-workspace-surface')
    const frame = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="split"][data-layout-node-id="workspace-daily-note-frame"]',
    )
    const header = surface?.querySelector<HTMLElement>(
      '[data-layout-node-id="workspace-daily-note-header"] mn-daily-note-header',
    )
    const anchor = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="leaf"][data-layout-node-id="center-primary"]',
    )
    const host = document.querySelector<HTMLElement>('sh-editor-host')
    const proseMirror = host?.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    if (!frame || !header || !anchor || !host || !proseMirror) {
      throw new Error('Daily Note editor geometry nodes are incomplete')
    }
    return {
      frame: frame.getBoundingClientRect().toJSON(),
      header: header.getBoundingClientRect().toJSON(),
      anchor: anchor.getBoundingClientRect().toJSON(),
      host: host.getBoundingClientRect().toJSON(),
      proseMirror: proseMirror.getBoundingClientRect().toJSON(),
    }
  })
}

async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const host = document.querySelector<HTMLElement>('sh-editor-host')
    const proseMirror = host?.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    return proseMirror?.getAttribute('contenteditable') === 'true'
  }, undefined, { timeout: 30_000 })
}

async function assertEditorIsUsable(page: Page): Promise<EditorGeometry> {
  await waitForEditor(page)
  const geometry = await editorGeometry(page)
  assert(geometry.frame.height > 240, `Daily Note editor frame collapsed to ${geometry.frame.height}px`)
  assert(geometry.anchor.height > 200, `Daily Note anchor collapsed to ${geometry.anchor.height}px`)
  assert(geometry.host.height > 200, `lifted editor host collapsed to ${geometry.host.height}px`)
  assert(geometry.proseMirror.height > 160, `ProseMirror collapsed to ${geometry.proseMirror.height}px`)
  assert(
    geometry.anchor.top >= geometry.header.bottom - 1,
    `Daily Note anchor (${geometry.anchor.top}) overlaps its header (${geometry.header.bottom})`,
  )
  assert(
    Math.abs(geometry.host.top - geometry.anchor.top) <= 1
      && Math.abs(geometry.host.height - geometry.anchor.height) <= 1,
    'lifted editor host does not match the Daily Note anchor box',
  )

  const proseMirror = page.locator('sh-editor-host .ProseMirror')
  // Default Playwright click performs hit-target/actionability checks. It will
  // fail instead of forcing a click through an occluding or zero-sized pane.
  await proseMirror.click({ position: { x: 64, y: 64 } })
  const focused = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('sh-editor-host')
    const proseMirror = host?.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    return document.activeElement === host && host?.shadowRoot?.activeElement === proseMirror
  })
  assert(focused, 'a real pointer click did not focus ProseMirror through the lifted host')
  return geometry
}

interface PaneGeometry {
  readonly surface: DOMRectJson
  readonly outer: DOMRectJson
  readonly left: DOMRectJson
  readonly outerDivider: DOMRectJson
  readonly inner: DOMRectJson
  readonly center: DOMRectJson
  readonly innerDivider: DOMRectJson
  readonly right: DOMRectJson
}

async function paneGeometry(page: Page): Promise<PaneGeometry> {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('sh-workspace-surface')
    const outer = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="split"][data-layout-node-id="workspace-spine:region-left-rail"]',
    )
    const inner = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="split"][data-layout-node-id="workspace-spine:region-center"]',
    )
    const left = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="leaf"][data-layout-node-id="workspace-region:region-left-rail"]',
    )
    const center = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="split"][data-layout-node-id="workspace-daily-note-frame"]',
    )
    const right = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="leaf"][data-layout-node-id="workspace-panel:right"]',
    )
    const outerDivider = surface?.querySelector<HTMLElement>(
      '[data-layout-divider="workspace-spine:region-left-rail"]',
    )
    const innerDivider = surface?.querySelector<HTMLElement>(
      '[data-layout-divider="workspace-spine:region-center"]',
    )
    if (!surface || !outer || !inner || !left || !center || !right || !outerDivider || !innerDivider) {
      throw new Error('desktop Surface pane geometry is incomplete')
    }
    return {
      surface: surface.getBoundingClientRect().toJSON(),
      outer: outer.getBoundingClientRect().toJSON(),
      left: left.getBoundingClientRect().toJSON(),
      outerDivider: outerDivider.getBoundingClientRect().toJSON(),
      inner: inner.getBoundingClientRect().toJSON(),
      center: center.getBoundingClientRect().toJSON(),
      innerDivider: innerDivider.getBoundingClientRect().toJSON(),
      right: right.getBoundingClientRect().toJSON(),
    }
  })
}

async function waitForSurface(page: Page): Promise<void> {
  await page.locator('sh-workspace-surface').evaluate(async (element) => {
    await (element as HTMLElement & { whenReady?: () => Promise<void> }).whenReady?.()
  })
}

async function dragDivider(page: Page, role: 'left' | 'right', deltaX: number): Promise<void> {
  const dividerId = role === 'left'
    ? 'workspace-spine:region-left-rail'
    : 'workspace-spine:region-center'
  const rect = await page.evaluate((id) => {
    const divider = document.querySelector<HTMLElement>(
      `sh-workspace-surface [data-layout-divider="${id}"]`,
    )
    if (!divider) throw new Error(`missing Surface divider ${id}`)
    return divider.getBoundingClientRect().toJSON()
  }, dividerId)
  const x = rect.left + rect.width / 2
  // Avoid the intentional mid-edge expand/collapse affordances; exercise the
  // divider's unobstructed pointer track just above them.
  const y = rect.top + Math.min(100, rect.height / 4)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y, { steps: 12 })
  await page.mouse.up()
  await waitForSurface(page)
}

function closeTo(actual: number, expected: number, label: string, tolerance = 2): void {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}±${tolerance}, got ${actual}`)
}

async function panelState(page: Page): Promise<{
  leftPanelWidth: number
  rightPanelWidth: number
  leftCollapsed: boolean
  leftExpanded: boolean
  rightCollapsed: boolean
}> {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('shrubbery.organism.panel-layout.v1')
    if (!raw) throw new Error('panel layout state was not persisted')
    return JSON.parse(raw)
  })
}

async function runPanelLayoutMatrix(page: Page): Promise<Record<string, unknown>> {
  assert(await page.locator('.app-container[data-workspace-renderer="surface"]').count() === 1,
    'production workspace did not select the Surface renderer')
  assert(await page.locator('sl-split-panel').count() === 0, 'legacy Shoelace split spine remained mounted')
  await page.evaluate(() => {
    ;(window as Window & { __paneEditorHost?: Element | null }).__paneEditorHost =
      document.querySelector('sh-editor-host')
  })
  const initial = await paneGeometry(page)

  await dragDivider(page, 'left', 70)
  const leftFree = await paneGeometry(page)
  closeTo(leftFree.outerDivider.left - initial.outerDivider.left, 70, 'left free divider delta')
  closeTo(leftFree.left.width - initial.left.width, 70, 'left free start-pane delta')
  closeTo(leftFree.inner.width - initial.inner.width, -70, 'left free end-pane delta')
  closeTo((await panelState(page)).leftPanelWidth, Math.round(leftFree.left.width), 'left free persisted width')
  const dividerPolicy = await page.evaluate(() => {
    const left = document.querySelector<HTMLElement>(
      'sh-workspace-surface [data-layout-divider="workspace-spine:region-left-rail"]',
    )
    const right = document.querySelector<HTMLElement>(
      'sh-workspace-surface [data-layout-divider="workspace-spine:region-center"]',
    )
    if (!left || !right) throw new Error('Surface divider policy probes are incomplete')
    return {
      left: {
        label: left.getAttribute('aria-label'),
        orientation: left.getAttribute('aria-orientation'),
        minimum: Number(left.getAttribute('aria-valuemin')),
        maximum: Number(left.getAttribute('aria-valuemax')),
        value: Number(left.getAttribute('aria-valuenow')),
        hitWidth: left.getBoundingClientRect().width,
        ruleWidth: left.querySelector<HTMLElement>('span')?.getBoundingClientRect().width ?? 0,
      },
      right: {
        label: right.getAttribute('aria-label'),
        orientation: right.getAttribute('aria-orientation'),
        minimum: Number(right.getAttribute('aria-valuemin')),
        maximum: Number(right.getAttribute('aria-valuemax')),
        value: Number(right.getAttribute('aria-valuenow')),
        hitWidth: right.getBoundingClientRect().width,
        ruleWidth: right.querySelector<HTMLElement>('span')?.getBoundingClientRect().width ?? 0,
      },
    }
  })
  assert(dividerPolicy.left.label === 'Resize sidebar', 'left Surface separator lost its accessible label')
  assert(dividerPolicy.right.label === 'Resize right panel', 'right Surface separator lost its accessible label')
  assert(
    dividerPolicy.left.orientation === 'vertical' && dividerPolicy.right.orientation === 'vertical',
    'horizontal Surface splits did not expose vertical separators',
  )
  closeTo(dividerPolicy.left.hitWidth, 12, 'left Surface divider hit width')
  closeTo(dividerPolicy.right.hitWidth, 12, 'right Surface divider hit width')
  closeTo(dividerPolicy.left.ruleWidth, 1, 'left Surface divider rule width')
  closeTo(dividerPolicy.right.ruleWidth, 1, 'right Surface divider rule width')
  const expectedLeftMinimum = Math.round(180 / leftFree.outer.width * 100)
  const expectedLeftMaximum = Math.round(Math.min(500, leftFree.outer.width - 400) / leftFree.outer.width * 100)
  const expectedRightMinimum = Math.round(
    (1 - Math.min(500, leftFree.inner.width - 400) / leftFree.inner.width) * 100,
  )
  const expectedRightMaximum = Math.round((1 - 240 / leftFree.inner.width) * 100)
  assert(
    dividerPolicy.left.minimum === expectedLeftMinimum && dividerPolicy.left.maximum === expectedLeftMaximum,
    `left Surface policy drifted: ${JSON.stringify(dividerPolicy.left)}`,
  )
  assert(
    dividerPolicy.right.minimum === expectedRightMinimum && dividerPolicy.right.maximum === expectedRightMaximum,
    `right Surface policy drifted: ${JSON.stringify(dividerPolicy.right)}`,
  )
  closeTo(
    dividerPolicy.left.value,
    Math.round(leftFree.left.width / leftFree.outer.width * 100),
    'left Surface separator value',
    1,
  )
  closeTo(
    dividerPolicy.right.value,
    Math.round(leftFree.center.width / leftFree.inner.width * 100),
    'right Surface separator value',
    1,
  )
  const expectedLeftWidth = Math.round(leftFree.left.width)
  const expectedRightWidth = Math.round(leftFree.right.width)

  await page.locator('[data-panel-controls="left"] [data-panel-mode="expanded"]').click({ force: true })
  await page.waitForFunction(() => {
    const raw = sessionStorage.getItem('shrubbery.organism.panel-layout.v1')
    return raw ? JSON.parse(raw).leftExpanded === true : false
  })
  assert(
    await page.locator('sh-workspace-surface [data-layout-node-id="workspace-panel:right"]').count() === 0,
    'expanded left mode did not collapse right rail',
  )
  assert(await page.evaluate(() =>
    (window as Window & { __paneEditorHost?: Element | null }).__paneEditorHost === document.querySelector('sh-editor-host')),
  'editor host identity changed while expanding left pane')

  await page.locator('[data-panel-controls="left"] [data-panel-mode="normal"]').click({ force: true })
  await page.waitForFunction(() => document.querySelector(
    'sh-workspace-surface [data-layout-divider="workspace-spine:region-center"]',
  ) !== null)
  await waitForSurface(page)
  const restored = await paneGeometry(page)
  closeTo(restored.left.width, expectedLeftWidth, 'left width restored after expanded mode')
  closeTo(restored.right.width, expectedRightWidth, 'right width restored after expanded mode')
  assert(await page.evaluate(() =>
    (window as Window & { __paneEditorHost?: Element | null }).__paneEditorHost === document.querySelector('sh-editor-host')),
  'editor host identity changed while restoring expanded mode')

  await page.locator('[data-panel-controls="right"]').click({ force: true })
  await page.waitForFunction(() => document.querySelector('[data-panel-restore="right"]') !== null)
  assert(new URL(page.url()).searchParams.get('r') === 'none', 'collapsed right rail was not encoded as r=none')
  assert(await page.evaluate(() =>
    (window as Window & { __paneEditorHost?: Element | null }).__paneEditorHost === document.querySelector('sh-editor-host')),
  'editor host identity changed while collapsing right pane')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => document.querySelector('#host')?.getAttribute('data-organism-mobile-shell') === 'true')
  // The media-query projection and Surface's ResizeObserver reconciliation
  // settle on adjacent browser turns. Gate on the actual projected editor
  // geometry so this assertion observes the stable mobile layout, while a
  // genuine hidden/collapsed editor still times out and fails the harness.
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector<HTMLElement>('#host')
      const host = document.querySelector<HTMLElement>('sh-editor-host')
      return root?.dataset.mobileView === 'document'
        && (host?.getBoundingClientRect().width ?? 0) > 300
    })
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('#host')
      const wrapper = document.querySelector<HTMLElement>(
        'sh-workspace-surface [data-layout-node-id="center-primary"]',
      )
      const host = document.querySelector<HTMLElement>('sh-editor-host')
      return {
        root: root ? { ...root.dataset } : null,
        wrapper: wrapper ? {
          dataset: { ...wrapper.dataset },
          display: getComputedStyle(wrapper).display,
          rect: wrapper.getBoundingClientRect().toJSON(),
        } : null,
        host: host ? {
          display: getComputedStyle(host).display,
          visibility: getComputedStyle(host).visibility,
          rect: host.getBoundingClientRect().toJSON(),
        } : null,
      }
    })
    throw new Error(`mobile Surface did not settle: ${JSON.stringify(diagnostic)}`, { cause: error })
  }
  const mobile = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-panel-restore="right"]')
    const controls = document.querySelector<HTMLElement>('[data-panel-controls="left"]')
    const dividerLayer = document.querySelector<HTMLElement>(
      'sh-workspace-surface [data-layout-surface-dividers]',
    )
    const host = document.querySelector<HTMLElement>('sh-editor-host')
    if (!rail || !controls || !dividerLayer || !host) throw new Error('mobile Surface chrome probe is incomplete')
    return {
      railDisplay: getComputedStyle(rail).display,
      controlsDisplay: getComputedStyle(controls).display,
      dividerDisplay: getComputedStyle(dividerLayer).display,
      hostWidth: host.getBoundingClientRect().width,
      identityPreserved:
        (window as Window & { __paneEditorHost?: Element | null }).__paneEditorHost === host,
    }
  })
  assert(mobile.railDisplay === 'none', `mobile collapse rail remained ${mobile.railDisplay}`)
  assert(mobile.controlsDisplay === 'none', `mobile panel controls remained ${mobile.controlsDisplay}`)
  assert(mobile.dividerDisplay === 'none', `mobile split divider remained ${mobile.dividerDisplay}`)
  assert(mobile.hostWidth > 300 && mobile.hostWidth <= 390, `mobile editor host width was ${mobile.hostWidth}`)
  assert(mobile.identityPreserved, 'mobile transition replaced the live editor host')

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForFunction(() => document.querySelector('#host')?.getAttribute('data-organism-mobile-shell') === 'false')
  await page.reload({ waitUntil: 'commit' })
  await selectLiveHome(page)
  await page.waitForFunction(() => document.querySelector('[data-panel-restore="right"]') !== null)
  const reloadedState = await panelState(page)
  assert(reloadedState.leftPanelWidth === expectedLeftWidth, `reloaded left width was ${reloadedState.leftPanelWidth}`)
  assert(reloadedState.rightPanelWidth === expectedRightWidth, `reloaded right width was ${reloadedState.rightPanelWidth}`)
  assert(reloadedState.rightCollapsed, 'reloaded right rail lost its collapsed mode')
  assert(new URL(page.url()).searchParams.get('r') === 'none', 'reload lost the explicit collapsed URL authority')

  await page.locator('[data-panel-restore="right"]').click()
  await page.waitForFunction(() => document.querySelector(
    'sh-workspace-surface [data-layout-divider="workspace-spine:region-center"]',
  ) !== null)
  await waitForSurface(page)
  const reloadRestored = await paneGeometry(page)
  closeTo(reloadRestored.left.width, expectedLeftWidth, 'left width after reload')
  closeTo(reloadRestored.right.width, expectedRightWidth, 'right width after reload restore')

  return {
    leftFreeDividerDelta: leftFree.outerDivider.left - initial.outerDivider.left,
    leftFreeStartDelta: leftFree.left.width - initial.left.width,
    leftFreeEndDelta: leftFree.inner.width - initial.inner.width,
    dividerPolicy,
    expandedRestore: { left: restored.left.width, right: restored.right.width },
    editorIdentityPreservedAcrossModes: true,
    collapsedUrl: 'r=none',
    reloadState: reloadedState,
    reloadRestored: { left: reloadRestored.left.width, right: reloadRestored.right.width },
    mobile,
  }
}

const binary = resolveGardendBin()
assert(existsSync(binary), `gardend binary not found at ${binary} (set GARDEN_BIN to override)`)

let cell: GardendCell | null = null
let vite: ViteDevServer | null = null
let browser: Browser | null = null
let page: Page | null = null
let verifier: LoopbackCrdtBackend | null = null
const pageErrors: string[] = []
const consoleErrors: string[] = []

try {
  cell = await spawnGardend()
  await createGraphAndSeedUxConfig(cell, graphId, seedNt, 'Daily Note Browser Regression')

  const port = Number(process.env.SHRUBBERY_DAILY_NOTE_BROWSER_PORT ?? await freePort())
  vite = await createViteServer({
    root: appDir,
    configFile: false,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      // Acceptance must exercise one coherent build even if another local
      // worktree task edits source while this long real-cell journey runs.
      hmr: false,
      proxy: liveCellProxy(cell),
    },
    // This harness intentionally creates Vite without the app config. Keep
    // Oxigraph's browser WASM as a sibling asset instead of prebundling its
    // import.meta.url relative path into /node_modules/.vite/deps.
    optimizeDeps: { exclude: ['oxigraph'] },
    logLevel: 'warn',
  })
  await vite.listen()

  const executablePath = chromeExecutable()
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    timezoneId: 'America/Montevideo',
  })
  page = await context.newPage()
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, { waitUntil: 'commit' })
  await selectLiveHome(page)
  const dateKey = await openDailyNote(page)
  const documentId = `daily-note-${dateKey}`
  const initialGeometry = await assertEditorIsUsable(page)

  const proseMirror = page.locator('sh-editor-host .ProseMirror')
  // Async Daily Note/sidebar refreshes may rerender immediately after open;
  // target the live contenteditable again instead of relying on ambient focus.
  // Playwright fill drives the browser's contenteditable input events directly;
  // the pointer-focus contract was already asserted above.
  await proseMirror.fill(marker)
  await page.waitForFunction((expectedMarker) => {
    const host = document.querySelector<HTMLElement>('sh-editor-host')
    return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent?.includes(expectedMarker) === true
  }, marker)

  // Open a second, independent provider directly against gardend. Seeing the
  // browser's marker here proves the edit crossed the browser WebSocket proxy;
  // local DOM text alone cannot satisfy this assertion.
  verifier = new LoopbackCrdtBackend({
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    WebSocketPolyfill,
  })
  const verificationDoc = new Y.Doc()
  const verificationHandle = verifier.open({ kind: 'doc', graphId, docId: documentId }, verificationDoc)
  await withTimeout(verificationHandle.whenSynced, 15_000, 'verification provider sync')
  await withTimeout(new Promise<void>((resolveMarker) => {
    const content = verificationDoc.getXmlFragment('content')
    if (content.toString().includes(marker)) {
      resolveMarker()
      return
    }
    const observer = () => {
      if (!content.toString().includes(marker)) return
      content.unobserveDeep(observer)
      resolveMarker()
    }
    content.observeDeep(observer)
  }), 10_000, 'browser edit reaching real gardend')
  verifier.destroyAll()
  verifier = null

  // A full document reload destroys the browser provider. Select the live cell
  // again, require the row's backend projection to recognize today's document,
  // reopen it through the same visible gesture, and read the persisted marker.
  await page.reload({ waitUntil: 'commit' })
  await selectLiveHome(page)
  await page.waitForFunction((expectedDocumentId) => {
    const home = document.querySelector<HTMLElement>('.organism-mobile-home mn-home-view')
    const row = home?.shadowRoot?.querySelector('mn-daily-note-row') as
      | (HTMLElement & { doc?: { id?: string } | null })
      | null
    return row?.doc?.id === expectedDocumentId
  }, documentId, { timeout: 30_000 })
  await ensureDailyNoteHome(page)
  const reopenedDateKey = await openDailyNote(page)
  assert(reopenedDateKey === dateKey, 'Daily Note reopen changed the selected date')
  const reopenedGeometry = await assertEditorIsUsable(page)
  await page.waitForFunction((expectedMarker) => {
    const host = document.querySelector<HTMLElement>('sh-editor-host')
    return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent?.includes(expectedMarker) === true
  }, marker, { timeout: 30_000 })

  const panelMatrix = await runPanelLayoutMatrix(page)

  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    backend: 'real-gardend',
    graphId,
    documentId,
    dailyNoteCreatedAndOpened: true,
    pointerFocusedProseMirror: true,
    browserEditReachedGardend: true,
    editSurvivedReloadAndReopen: true,
    initialGeometry,
    reopenedGeometry,
    panelMatrix,
  }, null, 2)}\n`)
} catch (error) {
  const status = page && !page.isClosed()
    ? await page.locator('#status').textContent().catch(() => null)
    : null
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  throw new Error([
    message,
    status ? `Organism status: ${status}` : '',
    pageErrors.length ? `Page errors: ${pageErrors.join('\n')}` : '',
    consoleErrors.length ? `Console errors: ${consoleErrors.join('\n')}` : '',
  ].filter(Boolean).join('\n\n'))
} finally {
  verifier?.destroyAll()
  await page?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  await cell?.kill().catch(() => undefined)
}

// Vite's macOS file watcher can retain an idle native handle after close even
// though every owned browser/server/cell resource above is gone. This is a raw
// one-shot acceptance executable, so terminate cleanly once all assertions and
// teardown have completed.
process.exit(0)
