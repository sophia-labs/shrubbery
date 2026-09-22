/**
 * iOS/WebKit-shaped regression for the production Surface workspace.
 *
 * Headless browser automation cannot summon the native iOS software keyboard,
 * so this probe keeps a real ProseMirror focused while animating a test-owned
 * `visualViewport` through iPhone-keyboard-sized pans and resizes. The layout
 * viewport stays fixed, real visualViewport events reach MobileShellController,
 * and its production viewport projection drives ResizeObserver and the Surface
 * reconciliation path exactly as it does on iOS.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Browser,
  chromium,
  devices,
  type Locator,
  type Page,
  webkit,
} from 'playwright'
import { createServer as createViteServer, type ProxyOptions, type ViteDevServer } from 'vite'
import {
  createGraphAndSeedUxConfig,
  type GardendCell,
  resolveGardendBin,
  spawnGardend,
} from '../src/cell/spawn-gardend.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphId = `mobile-surface-keyboard-${randomUUID()}`
const marker = `mobile Surface keyboard ${randomUUID()}`
const chatMarker = `mobile Sophia pan ${randomUUID()}`
const intermediateSuffix = ' remains editable mid-animation'
const suffix = ' remains editable after shrink'
const requestedBrowser = (process.env.SHRUBBERY_BROWSER ?? 'webkit').toLowerCase()
const requestedDevice = process.env.SHRUBBERY_DEVICE ?? 'iPhone 12 Pro Max'
const headed = process.env.SHRUBBERY_HEADED === '1'
const checkpointDir = process.env.SHRUBBERY_MOBILE_SURFACE_CHECKPOINT_DIR
if (checkpointDir) await mkdir(checkpointDir, { recursive: true })

const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')
const seedNt = readFileSync(seedPath, 'utf8')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`mobile-surface-keyboard assertion failed: ${message}`)
}

const deviceDescriptor = devices[requestedDevice]
assert(deviceDescriptor, `unknown Playwright device: ${requestedDevice}`)
const { defaultBrowserType: _defaultBrowserType, ...deviceContext } = deviceDescriptor
const layoutWidth = deviceDescriptor.viewport.width
const layoutHeight = deviceDescriptor.viewport.height
const keyboardOcclusionHeight = 344
const keyboardViewportHeight = layoutHeight - keyboardOcclusionHeight
assert(keyboardViewportHeight > 300,
  `${requestedDevice} viewport is too short for the ${keyboardOcclusionHeight}px keyboard model`)

const initialViewportRect: SimulatedVisualViewportRect = {
  offsetLeft: 0,
  offsetTop: 0,
  width: layoutWidth,
  height: layoutHeight,
}

// Keep every opening frame beyond the production controller's 150px keyboard
// threshold. The viewport stays full-width, while its top edge follows a
// progressively stronger Safari pan until the visible rect is bottom-anchored.
const openingRects: readonly SimulatedVisualViewportRect[] = [
  { offsetLeft: 0, offsetTop: 156, width: layoutWidth, height: layoutHeight - 156 },
  { offsetLeft: 0, offsetTop: 226, width: layoutWidth, height: layoutHeight - 226 },
  { offsetLeft: 0, offsetTop: 286, width: layoutWidth, height: layoutHeight - 286 },
  {
    offsetLeft: 0,
    offsetTop: keyboardOcclusionHeight,
    width: layoutWidth,
    height: keyboardViewportHeight,
  },
]
const finalKeyboardViewportRect = openingRects.at(-1)!

async function freePort(): Promise<number> {
  const socket = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolveListen)
  })
  const address = socket.address()
  assert(address && typeof address === 'object', 'could not reserve a Vite port')
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

interface RectJson {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

interface GeometrySnapshot {
  readonly label: string
  readonly viewport: {
    readonly innerWidth: number
    readonly innerHeight: number
    readonly visualWidth: number | null
    readonly visualHeight: number | null
    readonly visualOffsetLeft: number | null
    readonly visualOffsetTop: number | null
    readonly visualPageLeft: number | null
    readonly visualPageTop: number | null
    readonly nativeScrollX: number
    readonly nativeScrollY: number
    readonly simulatedLayoutScrollX: number
    readonly simulatedLayoutScrollY: number
    readonly documentClientWidth: number
    readonly documentClientHeight: number
  }
  readonly focused: boolean
  readonly editorIdentityPreserved: boolean
  readonly keyboardOpen: boolean
  readonly bodyScrollHeight: number
  readonly regions: Record<string, RectJson | null>
  readonly visibleLeaves: readonly {
    readonly id: string | null
    readonly part: string | null
    readonly display: string
    readonly visibility: string
    readonly rect: RectJson
  }[]
  readonly zeroSizedRegions: readonly string[]
  readonly zeroSizedVisibleLeaves: readonly string[]
}

async function geometry(page: Page, label: string): Promise<GeometrySnapshot> {
  return page.evaluate((snapshotLabel) => {
    const main = document.querySelector<HTMLElement>('.app-container[data-workspace-renderer="surface"] .main')
    const surface = document.querySelector<HTMLElement>('sh-workspace-surface')
    const content = surface?.querySelector<HTMLElement>('[data-layout-surface-content]') ?? null
    const activeLeaf = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="leaf"][data-surface-part="center-content"][data-active="true"]',
    ) ?? null
    const editorHost = document.querySelector<HTMLElement>('sh-editor-host')
    const proseMirror = editorHost?.shadowRoot?.querySelector<HTMLElement>('.ProseMirror') ?? null
    const mobileShell = document.querySelector<HTMLElement>('.organism-mobile-shell[data-active="true"]')
    const mobileTop = mobileShell?.querySelector<HTMLElement>('.organism-mobile-top-bar') ?? null
    const mobileNavigation = mobileShell?.querySelector<HTMLElement>('mn-mobile-tabs') ?? null

    const mainRect = main?.getBoundingClientRect() ?? null
    const surfaceRect = surface?.getBoundingClientRect() ?? null
    const contentRect = content?.getBoundingClientRect() ?? null
    const activeLeafRect = activeLeaf?.getBoundingClientRect() ?? null
    const editorHostRect = editorHost?.getBoundingClientRect() ?? null
    const proseMirrorRect = proseMirror?.getBoundingClientRect() ?? null
    const mobileShellRect = mobileShell?.getBoundingClientRect() ?? null
    const mobileTopRect = mobileTop?.getBoundingClientRect() ?? null
    const mobileNavigationRect = mobileNavigation?.getBoundingClientRect() ?? null

    const regions: Record<string, RectJson | null> = {
      main: mainRect ? {
        top: mainRect.top, bottom: mainRect.bottom, left: mainRect.left, right: mainRect.right,
        width: mainRect.width, height: mainRect.height,
      } : null,
      surface: surfaceRect ? {
        top: surfaceRect.top, bottom: surfaceRect.bottom, left: surfaceRect.left, right: surfaceRect.right,
        width: surfaceRect.width, height: surfaceRect.height,
      } : null,
      surfaceContent: contentRect ? {
        top: contentRect.top, bottom: contentRect.bottom, left: contentRect.left, right: contentRect.right,
        width: contentRect.width, height: contentRect.height,
      } : null,
      activeLeaf: activeLeafRect ? {
        top: activeLeafRect.top, bottom: activeLeafRect.bottom, left: activeLeafRect.left, right: activeLeafRect.right,
        width: activeLeafRect.width, height: activeLeafRect.height,
      } : null,
      editorHost: editorHostRect ? {
        top: editorHostRect.top, bottom: editorHostRect.bottom, left: editorHostRect.left, right: editorHostRect.right,
        width: editorHostRect.width, height: editorHostRect.height,
      } : null,
      proseMirror: proseMirrorRect ? {
        top: proseMirrorRect.top, bottom: proseMirrorRect.bottom, left: proseMirrorRect.left, right: proseMirrorRect.right,
        width: proseMirrorRect.width, height: proseMirrorRect.height,
      } : null,
      mobileShell: mobileShellRect ? {
        top: mobileShellRect.top, bottom: mobileShellRect.bottom, left: mobileShellRect.left, right: mobileShellRect.right,
        width: mobileShellRect.width, height: mobileShellRect.height,
      } : null,
      mobileTop: mobileTopRect ? {
        top: mobileTopRect.top, bottom: mobileTopRect.bottom, left: mobileTopRect.left, right: mobileTopRect.right,
        width: mobileTopRect.width, height: mobileTopRect.height,
      } : null,
      mobileNavigation: mobileNavigationRect ? {
        top: mobileNavigationRect.top, bottom: mobileNavigationRect.bottom,
        left: mobileNavigationRect.left, right: mobileNavigationRect.right,
        width: mobileNavigationRect.width, height: mobileNavigationRect.height,
      } : null,
    }

    const visibleLeaves: Array<{
      id: string | null
      part: string | null
      display: string
      visibility: string
      rect: RectJson
    }> = []
    const zeroSizedVisibleLeaves: string[] = []
    const leaves = surface?.querySelectorAll<HTMLElement>('[data-layout-node-kind="leaf"]') ?? []
    for (const leaf of leaves) {
      const style = getComputedStyle(leaf)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const rect = leaf.getBoundingClientRect()
      const entry = {
        id: leaf.dataset.layoutNodeId ?? null,
        part: leaf.dataset.surfacePart ?? null,
        display: style.display,
        visibility: style.visibility,
        rect: {
          top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          width: rect.width, height: rect.height,
        },
      }
      visibleLeaves.push(entry)
      if (!(rect.width > 0 && rect.height > 0)) {
        zeroSizedVisibleLeaves.push(leaf.dataset.layoutNodeId ?? '(anonymous leaf)')
      }
    }

    const zeroSizedRegions: string[] = []
    for (const name of ['main', 'surface', 'surfaceContent', 'activeLeaf', 'editorHost', 'proseMirror', 'mobileShell']) {
      const rect = regions[name]
      if (!rect || !(rect.width > 0 && rect.height > 0)) zeroSizedRegions.push(name)
    }

    return {
      label: snapshotLabel,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        visualWidth: window.visualViewport?.width ?? null,
        visualHeight: window.visualViewport?.height ?? null,
        visualOffsetLeft: window.visualViewport?.offsetLeft ?? null,
        visualOffsetTop: window.visualViewport?.offsetTop ?? null,
        visualPageLeft: window.visualViewport?.pageLeft ?? null,
        visualPageTop: window.visualViewport?.pageTop ?? null,
        nativeScrollX: window.scrollX,
        nativeScrollY: window.scrollY,
        simulatedLayoutScrollX:
          (window as unknown as { __shrubberyLayoutScrollX?: number }).__shrubberyLayoutScrollX ?? 0,
        simulatedLayoutScrollY:
          (window as unknown as { __shrubberyLayoutScrollY?: number }).__shrubberyLayoutScrollY ?? 0,
        documentClientWidth: document.documentElement.clientWidth,
        documentClientHeight: document.documentElement.clientHeight,
      },
      focused: document.activeElement === editorHost && editorHost?.shadowRoot?.activeElement === proseMirror,
      editorIdentityPreserved:
        (window as unknown as { __mobileSurfaceEditorHost?: Element }).__mobileSurfaceEditorHost === editorHost,
      keyboardOpen: document.querySelector('#host')?.getAttribute('data-mobile-keyboard') === 'true',
      bodyScrollHeight: document.body.scrollHeight,
      regions,
      visibleLeaves,
      zeroSizedRegions,
      zeroSizedVisibleLeaves,
    }
  }, label)
}

interface ChatGeometrySnapshot {
  readonly label: string
  readonly viewport: GeometrySnapshot['viewport']
  readonly focused: boolean
  readonly identityPreserved: boolean
  readonly keyboardOpen: boolean
  readonly regions: Record<string, RectJson | null>
  readonly zeroSizedRegions: readonly string[]
  readonly fixedOriginContract: {
    readonly shellTop: number | null
    readonly shellLeft: number | null
    readonly ignoredVisualOffsetTop: number | null
    readonly ignoredVisualOffsetLeft: number | null
  }
}

async function chatGeometry(page: Page, label: string): Promise<ChatGeometrySnapshot> {
  return page.evaluate((snapshotLabel) => {
    const mobileShell = document.querySelector<HTMLElement>('.organism-mobile-shell[data-active="true"]')
    const app = document.querySelector<HTMLElement>(
      '#host[data-mobile-root="sophia"] > .app-container[data-workspace-renderer="surface"]',
    )
    const surface = app?.querySelector<HTMLElement>('sh-workspace-surface') ?? null
    const chatLeaf = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="leaf"][data-surface-part="right-panel"][data-panel="chat"]',
    ) ?? null
    const chatHost = chatLeaf?.querySelector<HTMLElement>('sh-chat-host') ?? null
    const chatPanel = chatHost?.shadowRoot?.querySelector<HTMLElement>('sh-chat-panel') ?? null
    const hoja = chatPanel?.querySelector<HTMLElement>('hoja-editor[posture="composer"]') ?? null
    const composer = hoja?.querySelector<HTMLElement>('.ProseMirror[role="textbox"]') ?? null

    const shellRect = mobileShell?.getBoundingClientRect() ?? null
    const appRect = app?.getBoundingClientRect() ?? null
    const surfaceRect = surface?.getBoundingClientRect() ?? null
    const leafRect = chatLeaf?.getBoundingClientRect() ?? null
    const hostRect = chatHost?.getBoundingClientRect() ?? null
    const panelRect = chatPanel?.getBoundingClientRect() ?? null
    const hojaRect = hoja?.getBoundingClientRect() ?? null
    const composerRect = composer?.getBoundingClientRect() ?? null
    const regions: Record<string, RectJson | null> = {
      mobileShell: shellRect ? {
        top: shellRect.top, bottom: shellRect.bottom, left: shellRect.left, right: shellRect.right,
        width: shellRect.width, height: shellRect.height,
      } : null,
      app: appRect ? {
        top: appRect.top, bottom: appRect.bottom, left: appRect.left, right: appRect.right,
        width: appRect.width, height: appRect.height,
      } : null,
      surface: surfaceRect ? {
        top: surfaceRect.top, bottom: surfaceRect.bottom, left: surfaceRect.left, right: surfaceRect.right,
        width: surfaceRect.width, height: surfaceRect.height,
      } : null,
      chatLeaf: leafRect ? {
        top: leafRect.top, bottom: leafRect.bottom, left: leafRect.left, right: leafRect.right,
        width: leafRect.width, height: leafRect.height,
      } : null,
      chatHost: hostRect ? {
        top: hostRect.top, bottom: hostRect.bottom, left: hostRect.left, right: hostRect.right,
        width: hostRect.width, height: hostRect.height,
      } : null,
      chatPanel: panelRect ? {
        top: panelRect.top, bottom: panelRect.bottom, left: panelRect.left, right: panelRect.right,
        width: panelRect.width, height: panelRect.height,
      } : null,
      hoja: hojaRect ? {
        top: hojaRect.top, bottom: hojaRect.bottom, left: hojaRect.left, right: hojaRect.right,
        width: hojaRect.width, height: hojaRect.height,
      } : null,
      composer: composerRect ? {
        top: composerRect.top, bottom: composerRect.bottom, left: composerRect.left, right: composerRect.right,
        width: composerRect.width, height: composerRect.height,
      } : null,
    }
    const zeroSizedRegions: string[] = []
    for (const name of ['mobileShell', 'app', 'surface', 'chatLeaf', 'chatHost', 'chatPanel', 'hoja', 'composer']) {
      const rect = regions[name]
      if (!rect || !(rect.width > 0 && rect.height > 0)) zeroSizedRegions.push(name)
    }
    const viewport = window.visualViewport
    const offsetLeft = viewport?.offsetLeft ?? null
    const offsetTop = viewport?.offsetTop ?? null
    const remembered = (window as unknown as {
      __mobileSurfaceChat?: {
        host: Element | null
        panel: Element | null
        hoja: Element | null
        composer: Element | null
      }
    }).__mobileSurfaceChat
    return {
      label: snapshotLabel,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        visualWidth: viewport?.width ?? null,
        visualHeight: viewport?.height ?? null,
        visualOffsetLeft: offsetLeft,
        visualOffsetTop: offsetTop,
        visualPageLeft: viewport?.pageLeft ?? null,
        visualPageTop: viewport?.pageTop ?? null,
        nativeScrollX: window.scrollX,
        nativeScrollY: window.scrollY,
        simulatedLayoutScrollX:
          (window as unknown as { __shrubberyLayoutScrollX?: number }).__shrubberyLayoutScrollX ?? 0,
        simulatedLayoutScrollY:
          (window as unknown as { __shrubberyLayoutScrollY?: number }).__shrubberyLayoutScrollY ?? 0,
        documentClientWidth: document.documentElement.clientWidth,
        documentClientHeight: document.documentElement.clientHeight,
      },
      focused: composer?.matches(':focus') === true,
      identityPreserved: remembered?.host === chatHost
        && remembered.panel === chatPanel
        && remembered.hoja === hoja
        && remembered.composer === composer,
      keyboardOpen: document.querySelector('#host')?.getAttribute('data-mobile-keyboard') === 'true',
      regions,
      zeroSizedRegions,
      // The shim cannot move WebKit's native fixed containing block. Under
      // the default follow strategy the screen roots re-anchor to the
      // projected offsets while the IME is open; these fields are diagnostics.
      fixedOriginContract: {
        shellTop: shellRect?.top ?? null,
        shellLeft: shellRect?.left ?? null,
        ignoredVisualOffsetTop: offsetTop,
        ignoredVisualOffsetLeft: offsetLeft,
      },
    }
  }, label)
}

async function waitForSurface(page: Page): Promise<void> {
  await page.locator('sh-workspace-surface').evaluate(async (element) => {
    await (element as HTMLElement & { whenReady?: () => Promise<void> }).whenReady?.()
  })
}

async function focusStableEditable(page: Page, locator: Locator, label: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await locator.click({ position: { x: 32, y: 20 } })
    await page.waitForTimeout(120)
    if (!await locator.evaluate(element => element.matches(':focus'))) continue
    await page.waitForTimeout(180)
    if (await locator.evaluate(element => element.matches(':focus'))) return
  }
  throw new Error(`${label} did not retain focus after three pointer attempts`)
}

interface SimulatedVisualViewportRect {
  readonly offsetLeft: number
  readonly offsetTop: number
  readonly width: number
  readonly height: number
  readonly layoutScrollX?: number
  readonly layoutScrollY?: number
}

async function setSimulatedVisualViewportRect(
  page: Page,
  rect: SimulatedVisualViewportRect,
  options: { readonly waitForWorkspaceSurface?: boolean } = {},
): Promise<void> {
  await page.evaluate((nextRect) => {
    const setter = (window as unknown as {
      __shrubberySetVisualViewportRect?: (value: SimulatedVisualViewportRect) => void
    }).__shrubberySetVisualViewportRect
    if (!setter) throw new Error('visualViewport keyboard simulation was not installed')
    setter(nextRect)
  }, rect)
  // The pixel override exists ONLY while the IME is open (same threshold as
  // the controllers); closed, the var is removed so 100dvh tracks natively.
  const keyboardOpen = rect.height < layoutHeight - 150
  await page.waitForFunction(({ expectedRect, expectedCssHeight }) => {
    const cssHeight = getComputedStyle(document.documentElement)
      .getPropertyValue('--organism-vvh')
      .trim()
    const viewport = window.visualViewport
    return viewport?.offsetLeft === expectedRect.offsetLeft
      && viewport.offsetTop === expectedRect.offsetTop
      && viewport.width === expectedRect.width
      && viewport.height === expectedRect.height
      && viewport.pageLeft === (expectedRect.layoutScrollX ?? 0) + expectedRect.offsetLeft
      && viewport.pageTop === (expectedRect.layoutScrollY ?? 0) + expectedRect.offsetTop
      && cssHeight === expectedCssHeight
  }, { expectedRect: rect, expectedCssHeight: keyboardOpen ? `${rect.height}px` : '' })
  if (options.waitForWorkspaceSurface !== false) await waitForSurface(page)
  await page.waitForTimeout(50)
}

function closeTo(actual: number, expected: number, label: string, tolerance = 1): void {
  assert(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}±${tolerance}, got ${actual}`)
}

function assertVisualViewportProjection(snapshot: GeometrySnapshot): void {
  const viewport = snapshot.viewport
  const offsetLeft = viewport.visualOffsetLeft
  const offsetTop = viewport.visualOffsetTop
  const width = viewport.visualWidth
  const height = viewport.visualHeight
  const shell = snapshot.regions.mobileShell
  const surface = snapshot.regions.surface
  const top = snapshot.regions.mobileTop
  const navigation = snapshot.regions.mobileNavigation
  assert(offsetLeft !== null && offsetTop !== null && width !== null && height !== null,
    `${snapshot.label}: visualViewport rectangle is unavailable`)
  assert(viewport.visualPageLeft === viewport.simulatedLayoutScrollX + offsetLeft,
    `${snapshot.label}: visualViewport.pageLeft lost layout-scroll + offset semantics`)
  assert(viewport.visualPageTop === viewport.simulatedLayoutScrollY + offsetTop,
    `${snapshot.label}: visualViewport.pageTop lost layout-scroll + offset semantics`)
  assert(shell && surface && top && navigation,
    `${snapshot.label}: shell/Surface geometry is incomplete`)
  // Follow contract (default strategy): while the IME is open the screen
  // roots re-anchor to the projected visual-viewport offset. The shim cannot
  // move WebKit's fixed containing block, so "glued to the glass" appears
  // here as rect.origin == (offsetLeft, offsetTop).
  const originLeft = snapshot.keyboardOpen ? offsetLeft : 0
  const originTop = snapshot.keyboardOpen ? offsetTop : 0
  closeTo(shell.left, originLeft, `${snapshot.label}: shell left`)
  closeTo(shell.top, originTop, `${snapshot.label}: shell top`)
  closeTo(shell.width, width, `${snapshot.label}: shell width`)
  closeTo(shell.height, height, `${snapshot.label}: shell height`)
  closeTo(shell.bottom, originTop + height, `${snapshot.label}: shell bottom`)

  // The Surface is the visible workspace band between shell-owned mobile
  // chrome. It must share the visual viewport's horizontal frame and consume
  // every remaining vertical pixel without a blank band.
  closeTo(surface.left, originLeft, `${snapshot.label}: Surface left`)
  closeTo(surface.width, width, `${snapshot.label}: Surface width`)
  closeTo(surface.top, originTop + top.height, `${snapshot.label}: Surface top`)
  closeTo(surface.bottom, originTop + height - navigation.height, `${snapshot.label}: Surface bottom`)
}

function assertAnimationFrame(snapshot: GeometrySnapshot, keyboardOpen: boolean): void {
  assert(snapshot.focused, `${snapshot.label}: ProseMirror lost focus`)
  assert(snapshot.editorIdentityPreserved, `${snapshot.label}: Surface editor host identity changed`)
  assert(snapshot.keyboardOpen === keyboardOpen,
    `${snapshot.label}: expected keyboardOpen=${keyboardOpen}, got ${snapshot.keyboardOpen}`)
  assert(snapshot.zeroSizedRegions.length === 0,
    `${snapshot.label}: zero-sized regions: ${snapshot.zeroSizedRegions.join(', ')}`)
  assert(snapshot.zeroSizedVisibleLeaves.length === 0,
    `${snapshot.label}: zero-sized visible leaves: ${snapshot.zeroSizedVisibleLeaves.join(', ')}`)
  assert(snapshot.viewport.innerWidth === layoutWidth && snapshot.viewport.innerHeight === layoutHeight,
    `${snapshot.label}: layout viewport changed to ${snapshot.viewport.innerWidth}x${snapshot.viewport.innerHeight}`)
  assert((snapshot.regions.activeLeaf?.height ?? 0) > 100,
    `${snapshot.label}: active editor leaf became unusably short: ${snapshot.regions.activeLeaf?.height}`)
  assertVisualViewportProjection(snapshot)
}

function assertSyntheticChatPanFrame(snapshot: ChatGeometrySnapshot): void {
  const viewport = snapshot.viewport
  const offsetLeft = viewport.visualOffsetLeft
  const offsetTop = viewport.visualOffsetTop
  const width = viewport.visualWidth
  const height = viewport.visualHeight
  assert(offsetLeft !== null && offsetTop !== null && width !== null && height !== null,
    `${snapshot.label}: visual viewport is unavailable`)
  assert(snapshot.focused, `${snapshot.label}: Hoja composer lost focus`)
  assert(snapshot.identityPreserved, `${snapshot.label}: live chat/composer identity changed`)
  assert(snapshot.keyboardOpen, `${snapshot.label}: mobile shell left keyboard posture`)
  assert(snapshot.zeroSizedRegions.length === 0,
    `${snapshot.label}: zero-sized chat regions: ${snapshot.zeroSizedRegions.join(', ')}`)
  assert(viewport.visualPageLeft === viewport.simulatedLayoutScrollX + offsetLeft,
    `${snapshot.label}: pageLeft != layoutScrollX + offsetLeft`)
  assert(viewport.visualPageTop === viewport.simulatedLayoutScrollY + offsetTop,
    `${snapshot.label}: pageTop != layoutScrollY + offsetTop`)

  // Follow contract: the chat pan frame is asserted only in keyboard
  // posture, so every screen root re-anchors to the projected offsets.
  const shell = snapshot.regions.mobileShell!
  closeTo(shell.left, offsetLeft, `${snapshot.label}: synthetic shell left`)
  closeTo(shell.top, offsetTop, `${snapshot.label}: synthetic shell top`)
  closeTo(shell.width, width, `${snapshot.label}: synthetic shell width`)
  closeTo(shell.height, height, `${snapshot.label}: synthetic shell height`)
  closeTo(shell.bottom, offsetTop + height, `${snapshot.label}: synthetic shell bottom`)
  for (const name of ['app', 'surface', 'chatLeaf', 'chatHost', 'chatPanel']) {
    const rect = snapshot.regions[name]!
    closeTo(rect.left, offsetLeft, `${snapshot.label}: ${name} left`)
    closeTo(rect.top, offsetTop, `${snapshot.label}: ${name} top`)
    closeTo(rect.width, width, `${snapshot.label}: ${name} width`)
    closeTo(rect.height, height, `${snapshot.label}: ${name} height`)
  }
  const composer = snapshot.regions.composer!
  assert(composer.left >= offsetLeft - 1 && composer.right <= offsetLeft + width + 1,
    `${snapshot.label}: composer escaped the visual viewport horizontally`)
  assert(composer.top >= offsetTop - 1 && composer.bottom <= offsetTop + height + 1,
    `${snapshot.label}: composer escaped the visual viewport vertically`)
}

assert(requestedBrowser === 'webkit' || requestedBrowser === 'chromium',
  `SHRUBBERY_BROWSER must be webkit or chromium, got ${requestedBrowser}`)
const browserType = requestedBrowser === 'webkit' ? webkit : chromium
const executablePath = browserType.executablePath()
assert(existsSync(executablePath), `${requestedBrowser} executable is unavailable at ${executablePath}`)
const gardendBin = resolveGardendBin()
assert(existsSync(gardendBin), `gardend binary not found at ${gardendBin}`)

let cell: GardendCell | null = null
let vite: ViteDevServer | null = null
let browser: Browser | null = null
let page: Page | null = null
const pageErrors: string[] = []
const consoleErrors: string[] = []
const expectedConsoleErrors: string[] = []

try {
  cell = await spawnGardend()
  await createGraphAndSeedUxConfig(cell, graphId, seedNt, 'Mobile Surface Keyboard Regression')
  const port = Number(process.env.SHRUBBERY_MOBILE_SURFACE_PORT ?? await freePort())
  vite = await createViteServer({
    root: appDir,
    configFile: false,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
      proxy: liveCellProxy(cell),
    },
    logLevel: 'warn',
  })
  await vite.listen()

  browser = await browserType.launch({ headless: !headed })
  const context = await browser.newContext({
    ...deviceContext,
    timezoneId: 'America/Montevideo',
  })
  page = await context.newPage()
  await page.addInitScript({
    content: `(() => {
      const actual = window.visualViewport;
      if (!actual) return;
      const events = new EventTarget();
      let simulatedOffsetLeft = 0;
      let simulatedOffsetTop = 0;
      let simulatedWidth = 0;
      let simulatedHeight = 0;
      let simulatedLayoutScrollX = 0;
      let simulatedLayoutScrollY = 0;
      const shim = {
        get width() { return simulatedWidth > 0 ? simulatedWidth : window.innerWidth; },
        get height() { return simulatedHeight > 0 ? simulatedHeight : window.innerHeight; },
        get offsetLeft() { return simulatedOffsetLeft; },
        get offsetTop() { return simulatedOffsetTop; },
        get pageLeft() { return simulatedLayoutScrollX + simulatedOffsetLeft; },
        get pageTop() { return simulatedLayoutScrollY + simulatedOffsetTop; },
        get scale() { return actual.scale; },
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
        onresize: null,
        onscroll: null,
      };
      try {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          get() { return shim; },
        });
      } catch {
        return;
      }
      window.__shrubberySetVisualViewportRect = (rect) => {
        simulatedOffsetLeft = rect.offsetLeft;
        simulatedOffsetTop = rect.offsetTop;
        simulatedWidth = rect.width;
        simulatedHeight = rect.height;
        simulatedLayoutScrollX = rect.layoutScrollX ?? 0;
        simulatedLayoutScrollY = rect.layoutScrollY ?? 0;
        window.__shrubberyLayoutScrollX = simulatedLayoutScrollX;
        window.__shrubberyLayoutScrollY = simulatedLayoutScrollY;
        events.dispatchEvent(new Event('resize'));
        events.dispatchEvent(new Event('scroll'));
      };
    })();`,
  })
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const value = message.text()
    if (value.includes('Viewport argument key "interactive-widget" not recognized and ignored.')) {
      expectedConsoleErrors.push(value)
      return
    }
    consoleErrors.push(value)
  })
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))

  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, {
    waitUntil: 'commit',
    timeout: 60_000,
  })
  await page.waitForFunction((expectedGraphId) => {
    const graphInput = document.querySelector<HTMLInputElement>('#cell-graph-id')
    const status = document.querySelector<HTMLElement>('#status')
    const shell = document.querySelector<HTMLElement>('.organism-mobile-shell[data-active="true"]')
    const home = shell?.querySelector<HTMLElement>('.organism-mobile-home[data-visible="true"] mn-home-view')
    const row = home?.shadowRoot?.querySelector('mn-daily-note-row')
    return document.body.dataset.organismMode === 'local-cell'
      && graphInput?.value === expectedGraphId
      && status?.classList.contains('ok') === true
      && status.textContent?.includes('LIVE cell read') === true
      && row !== null
  }, graphId, { timeout: 60_000 })
  await setSimulatedVisualViewportRect(page, initialViewportRect)

  const dailyRow = page.locator(
    '.organism-mobile-shell[data-active="true"] .organism-mobile-home[data-visible="true"] mn-home-view mn-daily-note-row',
  )
  await dailyRow.locator('.row').click()
  await page.waitForFunction(() => {
    const surface = document.querySelector<HTMLElement>('sh-workspace-surface')
    const leaf = surface?.querySelector<HTMLElement>(
      '[data-layout-node-kind="leaf"][data-surface-part="center-content"][data-active="true"]',
    )
    const host = leaf?.querySelector<HTMLElement>('sh-editor-host')
    const proseMirror = host?.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    return proseMirror?.getAttribute('contenteditable') === 'true'
  }, undefined, { timeout: 30_000 })
  await waitForSurface(page)

  const proseMirror = page.locator('sh-editor-host .ProseMirror')
  await page.evaluate(() => {
    ;(window as unknown as { __mobileSurfaceEditorHost?: Element | null }).__mobileSurfaceEditorHost =
      document.querySelector('sh-editor-host')
  })
  await focusStableEditable(page, proseMirror, 'Daily Note ProseMirror')
  await proseMirror.pressSequentially(marker, { delay: 4 })
  await page.waitForFunction((expected) => {
    const host = document.querySelector<HTMLElement>('sh-editor-host')
    return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent?.includes(expected) === true
  }, marker)
  const before = await geometry(page, 'before-keyboard-shrink')
  assertAnimationFrame(before, false)
  if (checkpointDir) await page.screenshot({ path: resolve(checkpointDir, `${requestedBrowser}-before.png`) })

  assert(before.viewport.visualHeight === layoutHeight,
    `visualViewport shim did not start at ${layoutHeight}px: ${before.viewport.visualHeight}`)

  // All animated opening frames are beyond the controller's 150px keyboard
  // threshold. They model Safari's simultaneous upward pan and keyboard-driven
  // height reduction on the exact requested device profile.
  const openingFrames: GeometrySnapshot[] = []
  let expectedText = marker
  for (let index = 0; index < openingRects.length; index += 1) {
    await setSimulatedVisualViewportRect(page, openingRects[index])
    if (index === 1) {
      await proseMirror.pressSequentially(intermediateSuffix, { delay: 4 })
      expectedText += intermediateSuffix
    }
    if (index === openingRects.length - 1) {
      await proseMirror.pressSequentially(suffix, { delay: 4 })
      expectedText += suffix
    }
    if (index === 1 || index === openingRects.length - 1) {
      await page.waitForFunction((expected) => {
        const host = document.querySelector<HTMLElement>('sh-editor-host')
        return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent?.includes(expected) === true
      }, expectedText)
    }
    const frame = await geometry(page, `keyboard-opening-${index + 1}`)
    assertAnimationFrame(frame, true)
    openingFrames.push(frame)
  }
  const after = openingFrames.at(-1)!
  assert((before.viewport.visualHeight ?? 0) - (after.viewport.visualHeight ?? 0) === keyboardOcclusionHeight,
    `final visual viewport shrink was not ${keyboardOcclusionHeight}px: ${before.viewport.visualHeight} -> ${after.viewport.visualHeight}`)
  assert(
    (before.regions.surface?.height ?? 0) - (after.regions.surface?.height ?? 0) > 200,
    `Surface did not follow the reduced viewport: ${before.regions.surface?.height} -> ${after.regions.surface?.height}`,
  )
  if (checkpointDir) await page.screenshot({ path: resolve(checkpointDir, `${requestedBrowser}-after.png`) })

  const closingRects: readonly SimulatedVisualViewportRect[] = [
    openingRects[2],
    openingRects[1],
    openingRects[0],
    initialViewportRect,
  ]
  const closingFrames: GeometrySnapshot[] = []
  for (let index = 0; index < closingRects.length; index += 1) {
    await setSimulatedVisualViewportRect(page, closingRects[index])
    const frame = await geometry(page, `keyboard-closing-${index + 1}`)
    assertAnimationFrame(frame, index < closingRects.length - 1)
    closingFrames.push(frame)
  }
  const restored = closingFrames.at(-1)!
  assert(Math.abs((restored.regions.surface?.height ?? 0) - (before.regions.surface?.height ?? 0)) <= 1,
    `Surface height did not restore: ${before.regions.surface?.height} -> ${restored.regions.surface?.height}`)

  // Exercise the production mobile Sophia route separately. This is the path
  // implicated by the on-device whole-shell pan: the chat composer is at the
  // bottom of a full-height Surface leaf and Safari may report both layout
  // scroll (visualViewport.pageTop) and a visual offset (offsetTop).
  const tabs = page.locator('.organism-mobile-shell[data-active="true"] > mn-mobile-tabs button')
  await tabs.nth(2).click()
  await page.waitForFunction(() =>
    document.querySelector('#host')?.getAttribute('data-mobile-root') === 'sophia')
  const chatInput = page.locator(
    'sh-chat-host sh-chat-panel hoja-editor[posture="composer"] .ProseMirror[role="textbox"]',
  )
  await chatInput.waitFor({ state: 'visible', timeout: 30_000 })
  await page.evaluate(() => {
    const host = document.querySelector('sh-chat-host')
    const panel = host?.shadowRoot?.querySelector('sh-chat-panel') ?? null
    const hoja = panel?.querySelector('hoja-editor[posture="composer"]') ?? null
    const composer = hoja?.querySelector('.ProseMirror[role="textbox"]') ?? null
    ;(window as unknown as {
      __mobileSurfaceChat?: {
        host: Element | null
        panel: Element | null
        hoja: Element | null
        composer: Element | null
      }
    }).__mobileSurfaceChat = { host, panel, hoja, composer }
  })
  await focusStableEditable(page, chatInput, 'integrated Sophia composer')
  await chatInput.pressSequentially(chatMarker, { delay: 4 })
  await page.waitForFunction((expected) =>
    document.querySelector('sh-chat-host')?.shadowRoot
      ?.querySelector('sh-chat-panel')
      ?.querySelector('hoja-editor[posture="composer"]')
      ?.querySelector('.ProseMirror[role="textbox"]')
      ?.textContent?.includes(expected) === true, chatMarker)
  const chatBaseline = await chatGeometry(page, 'chat-before-keyboard-pan')
  assert(chatBaseline.focused && chatBaseline.identityPreserved,
    'chat composer was not focused with stable identity before the pan')
  assert(chatBaseline.zeroSizedRegions.length === 0,
    `chat baseline has zero-sized regions: ${chatBaseline.zeroSizedRegions.join(', ')}`)

  // A normal desktop WebKit page with Garden's scroll lock cannot reproduce
  // iOS Safari's browser-driven layout-viewport pan. Keep the attempted native
  // scroll as an explicit diagnostic instead of silently treating pageTop as
  // equivalent to scrollY.
  const nativeLayoutScrollAttempt = await page.evaluate(() => {
    const beforeY = window.scrollY
    window.scrollTo(0, 160)
    const observedY = window.scrollY
    window.scrollTo(0, 0)
    return {
      requestedY: 160,
      beforeY,
      observedY,
      restoredY: window.scrollY,
      scrollHeight: document.scrollingElement?.scrollHeight ?? null,
      clientHeight: document.scrollingElement?.clientHeight ?? null,
    }
  })

  const chatPanRects: readonly SimulatedVisualViewportRect[] = [
    {
      ...openingRects[1],
      layoutScrollX: 0,
      layoutScrollY: 80,
    },
    {
      ...finalKeyboardViewportRect,
      layoutScrollX: 6,
      layoutScrollY: 160,
    },
  ]
  const chatPanFrames: ChatGeometrySnapshot[] = []
  for (let index = 0; index < chatPanRects.length; index += 1) {
    await setSimulatedVisualViewportRect(page, chatPanRects[index])
    if (index === chatPanRects.length - 1) {
      await chatInput.pressSequentially(' still typing', { delay: 4 })
    }
    const frame = await chatGeometry(page, `chat-keyboard-pan-${index + 1}`)
    assertSyntheticChatPanFrame(frame)
    chatPanFrames.push(frame)
  }
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, `${requestedBrowser}-chat-keyboard-open.png`) })
  }
  await setSimulatedVisualViewportRect(page, {
    ...initialViewportRect,
    layoutScrollX: 0,
    layoutScrollY: 0,
  })
  const chatRestored = await chatGeometry(page, 'chat-after-keyboard-pan')
  assert(chatRestored.focused && chatRestored.identityPreserved,
    'chat composer focus/identity did not survive keyboard dismissal')
  assert(chatRestored.zeroSizedRegions.length === 0,
    `chat did not recover from keyboard pan: ${chatRestored.zeroSizedRegions.join(', ')}`)

  // The standalone /chat SPA route returns before the workspace mobile-shell
  // feature mounts. It must independently acquire the same follow-strategy
  // visual frame or Safari will pan its entire 100vh route tree as one body.
  await page.goto(`http://127.0.0.1:${port}/chat`, { waitUntil: 'domcontentloaded' })
  const routeComposer = page.locator(
    'sh-chat-host sh-chat-panel hoja-editor[posture="composer"] .ProseMirror[role="textbox"]',
  )
  await routeComposer.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() =>
    document.body.hasAttribute('data-organism-route-viewport-frame')
      && document.documentElement.dataset.organismVisualViewportFrame === 'true')
  const routeTransitionConsole = consoleErrors.splice(0)
  assert(routeTransitionConsole.every(message =>
    message.includes('WebSocket connection') && message.includes('Socket is not connected')),
  `unexpected console error while leaving workspace: ${routeTransitionConsole.join('\n')}`)
  assert(pageErrors.length === 0,
    `page error while entering standalone /chat: ${pageErrors.join('\n')}`)
  await focusStableEditable(page, routeComposer, 'standalone /chat composer')
  await routeComposer.pressSequentially('standalone route still typing', { delay: 4 })
  await setSimulatedVisualViewportRect(page, {
    ...finalKeyboardViewportRect,
    layoutScrollX: 6,
    layoutScrollY: 160,
  }, { waitForWorkspaceSurface: false })
  const routeKeyboard = await page.evaluate(() => {
    const chatHost = document.querySelector('sh-chat-host')
    const panel = chatHost?.shadowRoot?.querySelector('sh-chat-panel') ?? null
    const hoja = panel?.querySelector('hoja-editor[posture="composer"]') ?? null
    const composer = hoja?.querySelector('.ProseMirror[role="textbox"]') ?? null
    const boxes = Object.fromEntries(Object.entries({
      html: document.documentElement,
      body: document.body,
      shell: document.querySelector('body > .shell-pane'),
      host: document.querySelector('#host'),
      route: document.querySelector('.organism-route-chat'),
      chatHost,
      panel,
      composer,
    }).map(([name, element]) => {
      if (!element) return [name, null]
      const value = element.getBoundingClientRect()
      return [name, {
        top: value.top,
        bottom: value.bottom,
        left: value.left,
        right: value.right,
        width: value.width,
        height: value.height,
      }]
    })) as Record<string, RectJson | null>
    return {
      html: boxes.html,
      body: boxes.body,
      shell: boxes.shell,
      host: boxes.host,
      route: boxes.route,
      chatHost: boxes.chatHost,
      panel: boxes.panel,
      composer: boxes.composer,
      focused: composer?.matches(':focus') === true,
      frameActive: document.documentElement.dataset.organismVisualViewportFrame === 'true',
      keyboard: document.body.hasAttribute('data-organism-viewport-keyboard'),
      rootKeyboard: document.documentElement.hasAttribute('data-organism-viewport-keyboard'),
      rootScroll: {
        windowX: window.scrollX,
        windowY: window.scrollY,
        htmlX: document.documentElement.scrollLeft,
        htmlY: document.documentElement.scrollTop,
        bodyX: document.body.scrollLeft,
        bodyY: document.body.scrollTop,
      },
      overflowAnchor: {
        html: getComputedStyle(document.documentElement).overflowAnchor,
        body: getComputedStyle(document.body).overflowAnchor,
        shell: getComputedStyle(document.querySelector('body > .shell-pane')!).overflowAnchor,
      },
      cssWidth: getComputedStyle(document.documentElement).getPropertyValue('--organism-vvw').trim(),
      cssHeight: getComputedStyle(document.documentElement).getPropertyValue('--organism-vvh').trim(),
    }
  })
  assert(routeKeyboard.focused, 'standalone /chat composer lost focus')
  assert(routeKeyboard.frameActive && routeKeyboard.keyboard && routeKeyboard.rootKeyboard,
    'standalone /chat did not acquire keyboard viewport frame')
  assert(routeKeyboard.cssWidth === `${layoutWidth}px`
    && routeKeyboard.cssHeight === `${keyboardViewportHeight}px`,
    `standalone /chat received wrong viewport vars: ${routeKeyboard.cssWidth} x ${routeKeyboard.cssHeight}`)
  assert(routeKeyboard.html && routeKeyboard.body,
    'standalone /chat root geometry is missing')
  closeTo(routeKeyboard.html.height, keyboardViewportHeight, 'standalone /chat constrained html height')
  closeTo(routeKeyboard.body.height, keyboardViewportHeight, 'standalone /chat constrained body height')
  assert(Object.values(routeKeyboard.rootScroll).every(value => value === 0),
    `standalone /chat root scroll escaped its capture: ${JSON.stringify(routeKeyboard.rootScroll)}`)
  assert(Object.values(routeKeyboard.overflowAnchor).every(value => value === 'none'),
    `standalone /chat retained Safari 27 scroll anchors: ${JSON.stringify(routeKeyboard.overflowAnchor)}`)
  // Follow contract: with the IME open the route roots re-anchor to the
  // projected visual-viewport offsets.
  for (const name of ['shell', 'host', 'route', 'chatHost', 'panel'] as const) {
    const rect = routeKeyboard[name]
    assert(rect, `standalone /chat ${name} geometry is missing`)
    closeTo(rect.left, finalKeyboardViewportRect.offsetLeft, `standalone /chat ${name} left`)
    closeTo(rect.top, finalKeyboardViewportRect.offsetTop, `standalone /chat ${name} top`)
    closeTo(rect.width, layoutWidth, `standalone /chat ${name} width`)
    closeTo(rect.height, keyboardViewportHeight, `standalone /chat ${name} height`)
  }
  assert(routeKeyboard.composer
    && routeKeyboard.composer.top >= finalKeyboardViewportRect.offsetTop - 1
    && routeKeyboard.composer.bottom <= finalKeyboardViewportRect.offsetTop + keyboardViewportHeight + 1,
  `standalone /chat composer escaped visual frame: ${JSON.stringify(routeKeyboard.composer)}`)
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, `${requestedBrowser}-route-keyboard-open.png`) })
  }
  await setSimulatedVisualViewportRect(page, {
    ...initialViewportRect,
    layoutScrollX: 0,
    layoutScrollY: 0,
  }, { waitForWorkspaceSurface: false })
  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: requestedBrowser,
    browserVersion: browser.version(),
    executablePath,
    device: requestedDevice,
    deviceViewport: deviceDescriptor.viewport,
    deviceScaleFactor: deviceDescriptor.deviceScaleFactor,
    keyboardSimulation: `four-step visualViewport open {0,0,${layoutWidth},${layoutHeight}} -> {0,${keyboardOcclusionHeight},${layoutWidth},${keyboardViewportHeight}}, then four-step close, with layout viewport held at ${layoutWidth}x${layoutHeight}`,
    webkitViewportMetadataWarnings: expectedConsoleErrors,
    backend: 'real-gardend',
    graphId,
    typedTextSurvivedIntermediateAndFinalOpenFrames: true,
    surfaceReadyWaits: 1 + openingFrames.length + closingFrames.length,
    before,
    openingFrames,
    closingFrames,
    restored,
    chat: {
      nativeLayoutScrollAttempt,
      originSemantics: 'diagnostic-only: Playwright shim changes JS visualViewport values, not WebKit compositor fixed-origin behavior',
      baseline: chatBaseline,
      panFrames: chatPanFrames,
      restored: chatRestored,
    },
    standaloneChatRoute: routeKeyboard,
  }, null, 2)}\n`)
} catch (error) {
  const lastGeometry = page && !page.isClosed()
    ? await geometry(page, 'failure').catch(() => null)
    : null
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  throw new Error([
    message,
    lastGeometry ? `Last geometry: ${JSON.stringify(lastGeometry, null, 2)}` : '',
    pageErrors.length ? `Page errors: ${pageErrors.join('\n')}` : '',
    consoleErrors.length ? `Console errors: ${consoleErrors.join('\n')}` : '',
  ].filter(Boolean).join('\n\n'))
} finally {
  await page?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  await cell?.kill().catch(() => undefined)
}

process.exit(0)
