/**
 * Focused real-Chromium proof for the controlled Garden 3-D graph.
 *
 * This drives the production renderWorkspace -> persistent sh-graph-host ->
 * mn-graph-panel -> mn-graph-three chain. The fixture owns only controlled
 * graph/panel state; no test renderer or fake canvas is substituted.
 *
 * Watch the same journey with:
 *   SHRUBBERY_HEADED=1 SHRUBBERY_SLOW_MO=140 pnpm --dir apps/organism test:graph-browser
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { PNG } from 'pngjs'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_GRAPH_BROWSER_PORT ?? 5206)
const headed = process.env.SHRUBBERY_HEADED === '1'
const slowMoValue = Number(process.env.SHRUBBERY_SLOW_MO ?? (headed ? 100 : 0))
const slowMo = Number.isFinite(slowMoValue) ? Math.max(0, slowMoValue) : 0

interface Point3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface GraphSnapshot {
  readonly hostVisible: boolean
  readonly hostRect: { readonly width: number; readonly height: number }
  readonly viewMode: string
  readonly nodeIds: readonly string[]
  readonly nodeKinds: Readonly<Record<string, string>>
  readonly positions: Readonly<Record<string, Point3>>
  readonly canvas: { readonly width: number; readonly height: number }
  readonly renderCalls: number
  readonly contextLost: boolean
  readonly camera: Point3
  readonly target: Point3
}

interface HarnessState {
  readonly ready?: boolean
  readonly error?: string | null
  readonly viewMode?: string
  readonly leftPanelMode?: 'files' | 'graph'
  readonly leftCollapsed?: boolean
  readonly rightPanel?: string
  readonly rightCollapsed?: boolean
  readonly selectedNodeId?: string | null
  readonly selectedNodeIds?: readonly string[]
  readonly activatedNodeIds?: readonly string[]
  readonly refreshCount?: number
  readonly projectionRevision?: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`graph-browser-harness assertion failed: ${message}`)
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function normalized(vector: Point3): Point3 {
  const length = Math.max(1e-9, Math.hypot(vector.x, vector.y, vector.z))
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function cameraDirection(snapshot: GraphSnapshot): Point3 {
  return normalized({
    x: snapshot.camera.x - snapshot.target.x,
    y: snapshot.camera.y - snapshot.target.y,
    z: snapshot.camera.z - snapshot.target.z,
  })
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

async function state(page: Page): Promise<HarnessState> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __graphHarness?: { state: HarnessState } }).__graphHarness
    if (!bridge) throw new Error('window.__graphHarness is unavailable')
    return bridge.state
  })
}

async function graphSnapshot(page: Page): Promise<GraphSnapshot> {
  return page.evaluate(() => {
    const host = document.querySelector('sh-graph-host') as HTMLElement | null
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel') as (HTMLElement & {
      viewMode?: string
    }) | null
    const three = panel?.shadowRoot?.querySelector('mn-graph-three') as (HTMLElement & {
      nodes?: readonly { id: string; kind?: string }[]
      _renderer?: {
        info?: { render?: { calls?: number } }
        getContext?: () => { isContextLost?: () => boolean }
      }
      _camera?: { position?: Point3 }
      _controls?: { target?: Point3 }
      _nodeViews?: Map<string, { basePosition?: Point3 }>
    }) | null
    const canvas = three?.shadowRoot?.querySelector('canvas') as HTMLCanvasElement | null
    if (!host || !panel || !three || !canvas || !three._renderer || !three._camera?.position || !three._controls?.target) {
      throw new Error('live WebGL graph chain is incomplete')
    }
    const hostRect = host.getBoundingClientRect()
    const positions = Object.fromEntries(
      [...(three._nodeViews ?? new Map())].map(([id, view]) => [id, {
        x: view.basePosition?.x ?? Number.NaN,
        y: view.basePosition?.y ?? Number.NaN,
        z: view.basePosition?.z ?? Number.NaN,
      }]),
    )
    const nodeKinds = Object.fromEntries((three.nodes ?? []).map((node) => [node.id, node.kind ?? 'unknown']))
    const context = three._renderer.getContext?.()
    return {
      hostVisible: host.hasAttribute('data-visible'),
      hostRect: { width: hostRect.width, height: hostRect.height },
      viewMode: panel.viewMode ?? '',
      nodeIds: (three.nodes ?? []).map(node => node.id),
      nodeKinds,
      positions,
      canvas: { width: canvas.width, height: canvas.height },
      renderCalls: three._renderer.info?.render?.calls ?? 0,
      contextLost: context?.isContextLost?.() ?? true,
      camera: {
        x: three._camera.position.x,
        y: three._camera.position.y,
        z: three._camera.position.z,
      },
      target: {
        x: three._controls.target.x,
        y: three._controls.target.y,
        z: three._controls.target.z,
      },
    }
  })
}

async function rememberGraphIdentity(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel') ?? null
    const three = panel?.shadowRoot?.querySelector('mn-graph-three') ?? null
    const canvas = three?.shadowRoot?.querySelector('canvas') ?? null
    if (!host || !panel || !three || !canvas) throw new Error('cannot remember an incomplete graph identity')
    ;(window as unknown as { __graphProofIdentity?: unknown }).__graphProofIdentity = { host, panel, three, canvas }
  })
}

async function graphIdentity(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() => {
    const remembered = (window as unknown as {
      __graphProofIdentity?: { host: Element; panel: Element; three: Element; canvas: Element }
    }).__graphProofIdentity
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel') ?? null
    const three = panel?.shadowRoot?.querySelector('mn-graph-three') ?? null
    const canvas = three?.shadowRoot?.querySelector('canvas') ?? null
    return {
      host: remembered?.host === host,
      panel: remembered?.panel === panel,
      three: remembered?.three === three,
      canvas: remembered?.canvas === canvas,
    }
  })
}

function assertIdentity(identity: Record<string, boolean>, context: string): void {
  for (const [part, preserved] of Object.entries(identity)) {
    assert(preserved, `${context} replaced the persistent ${part}`)
  }
}

async function nodeScreenPoint(page: Page, nodeId: string): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel')
    const three = panel?.shadowRoot?.querySelector('mn-graph-three') as (HTMLElement & {
      _camera?: unknown
      _nodeViews?: Map<string, { group?: { position?: { clone?: () => { project?: (camera: unknown) => Point3 } } } }>
    }) | null
    const canvas = three?.shadowRoot?.querySelector('canvas') as HTMLCanvasElement | null
    const view = three?._nodeViews?.get(id)
    const projected = view?.group?.position?.clone?.().project?.(three?._camera)
    if (!canvas || !projected) throw new Error(`cannot project graph node ${id}`)
    const rect = canvas.getBoundingClientRect()
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    }
  }, nodeId)
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  logLevel: 'warn',
})

await server.listen()
const browser = await chromium.launch({ headless: !headed, slowMo })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 })
const pageErrors: string[] = []
const consoleErrors: string[] = []
const consoleWarnings: string[] = []
const failedRequests: string[] = []
const badResponses: string[] = []

page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
  if (message.type() === 'warning') consoleWarnings.push(message.text())
})
page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText ?? 'failed'}`))
page.on('response', (response) => {
  if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
})

try {
  await page.goto(`http://127.0.0.1:${port}/graph-browser-harness.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(() => {
    const current = (window as unknown as {
      __graphHarness?: { state: { ready?: boolean; error?: string | null } }
    }).__graphHarness?.state
    return current?.ready === true || Boolean(current?.error)
  }, undefined, { timeout: 60_000 })
  const boot = await state(page)
  assert(boot.error == null, `fixture boot failed: ${String(boot.error)}`)

  const canvas = page.locator('sh-graph-host mn-graph-panel mn-graph-three canvas')
  await canvas.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel')
    const three = panel?.shadowRoot?.querySelector('mn-graph-three') as (HTMLElement & { _renderer?: unknown }) | null
    return host?.hasAttribute('data-visible') && Boolean(three?._renderer)
  }, undefined, { timeout: 60_000 })

  const initial = await graphSnapshot(page)
  assert(initial.hostVisible, 'graph host did not become visible')
  assert(initial.hostRect.width > 200 && initial.hostRect.height > 400, `graph host measured ${initial.hostRect.width}x${initial.hostRect.height}`)
  assert(initial.viewMode === 'workspace', `initial mode was ${initial.viewMode}`)
  assert(initial.nodeIds.length === 7, `workspace scene had ${initial.nodeIds.length} nodes`)
  assert(initial.nodeKinds['doc-archive'] === 'read-only-document', 'read-only document semantics were lost')
  assert(initial.renderCalls > 0, 'Three renderer did not submit a draw call')
  assert(!initial.contextLost, 'WebGL context was already lost')
  assert(initial.canvas.width > 200 && initial.canvas.height > 400, `backing canvas was ${initial.canvas.width}x${initial.canvas.height}`)

  const graphPng = PNG.sync.read(await canvas.screenshot({ type: 'png' }))
  const sampledColors = new Set<string>()
  let minLuma = 255
  let maxLuma = 0
  for (let index = 0; index < graphPng.width * graphPng.height; index += 19) {
    const offset = index * 4
    const r = graphPng.data[offset]
    const g = graphPng.data[offset + 1]
    const b = graphPng.data[offset + 2]
    const a = graphPng.data[offset + 3]
    sampledColors.add(`${r},${g},${b},${a}`)
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    minLuma = Math.min(minLuma, luma)
    maxLuma = Math.max(maxLuma, luma)
  }
  assert(sampledColors.size > 24, `canvas screenshot had only ${sampledColors.size} sampled colors`)
  assert(maxLuma - minLuma > 50, `canvas screenshot luminance range was only ${(maxLuma - minLuma).toFixed(1)}`)

  // The accessible graph-node surface drives both controlled select and open
  // intents, independent of raycast precision.
  const accessibleWorkspaceNode = page.locator('sh-graph-host mn-graph-panel mn-graph-three [data-accessible-node="doc-beta"]')
  await accessibleWorkspaceNode.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const current = (window as unknown as {
      __graphHarness?: { state: { activatedNodeIds?: readonly string[] } }
    }).__graphHarness?.state
    return current?.activatedNodeIds?.includes('doc-beta')
  })
  let controlled = await state(page)
  assert(controlled.selectedNodeId === 'doc-beta', 'accessible activation did not update controlled selection')
  assert(controlled.selectedNodeIds?.includes('doc-beta'), 'accessible activation did not emit node selection')

  // A real canvas click selects the projected object. Garden focus behavior
  // moves OrbitControls toward that node; Center restores the scene framing.
  const focusBefore = await graphSnapshot(page)
  const alphaPoint = await nodeScreenPoint(page, 'doc-alpha')
  await page.mouse.click(alphaPoint.x, alphaPoint.y)
  await page.waitForFunction(() =>
    (window as unknown as { __graphHarness?: { state: { selectedNodeId?: string | null } } })
      .__graphHarness?.state.selectedNodeId === 'doc-alpha', undefined, { timeout: 10_000 })
  await page.waitForTimeout(550)
  const focused = await graphSnapshot(page)
  assert(distance(focused.target, focusBefore.target) > 0.08, 'single-click selection did not move the OrbitControls focus target')

  // A genuine controlled read-model revision rebuilds scene objects while the
  // Class-C renderer/canvas/camera lifetime remains intact.
  await rememberGraphIdentity(page)
  await page.locator('[data-proof-action="mutate-projection"]').click()
  await page.waitForFunction(() => {
    const current = (window as unknown as {
      __graphHarness?: { state: { projectionRevision?: number } }
    }).__graphHarness?.state
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel')
    const three = panel?.shadowRoot?.querySelector('mn-graph-three') as (HTMLElement & {
      nodes?: readonly { id: string }[]
    }) | null
    return current?.projectionRevision === 1 && three?.nodes?.some(node => node.id === 'doc-gamma')
  })
  assertIdentity(await graphIdentity(page), 'controlled projection mutation')
  const mutatedScene = await graphSnapshot(page)
  assert(mutatedScene.nodeIds.length === 8 && mutatedScene.nodeIds.includes('doc-gamma'), 'projection mutation did not rebuild the live scene')
  assert(mutatedScene.renderCalls > 0 && !mutatedScene.contextLost, 'projection mutation lost the live WebGL renderer')

  // The right rail is a single contextual surface: selecting Comments replaces
  // Graph rather than creating a second vertical stack.
  await page.locator('[data-proof-action="comments"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __graphHarness?: { state: { rightPanel?: string } } })
      .__graphHarness?.state.rightPanel === 'comments')

  await page.locator('[data-proof-action="graph"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __graphHarness?: { state: { rightPanel?: string } } })
      .__graphHarness?.state.rightPanel === 'graph')
  await page.waitForFunction(() => document.querySelector('sh-graph-host')?.hasAttribute('data-visible'))
  assertIdentity(await graphIdentity(page), 'graph replacement')

  await page.locator('[data-proof-action="collapse"]').click()
  await page.waitForFunction(() => !document.querySelector('sh-graph-host')?.hasAttribute('data-visible'))
  assertIdentity(await graphIdentity(page), 'right-rail collapse')
  const collapsed = await state(page)
  assert(collapsed.rightCollapsed === true, 'collapse control did not update shell-owned state')

  await page.locator('[data-proof-action="expand"]').click()
  await page.waitForFunction(() => document.querySelector('sh-graph-host')?.hasAttribute('data-visible'))
  assertIdentity(await graphIdentity(page), 'right-rail expansion')

  await page.locator('[data-proof-action="graph-only"]').click()
  await page.waitForFunction(() => {
    const current = (window as unknown as {
      __graphHarness?: { state: { rightPanel?: string; rightCollapsed?: boolean } }
    }).__graphHarness?.state
    return current?.rightPanel === 'graph' && current.rightCollapsed === false
  })
  assertIdentity(await graphIdentity(page), 'graph-only restoration')

  // Drive the real bottom-bar Files/Graph control. The graph moves from its
  // right-rail anchor into the actual left surface while the Class-C host,
  // panel, Three scene, canvas, camera, and WebGL context remain continuous.
  await page.waitForTimeout(350)
  const beforeLeftMove = await graphSnapshot(page)
  const leftGraphToggle = page.locator('mn-bottom-bar button[aria-label="Graph"]')
  const bottomBarGeometry = await leftGraphToggle.evaluate((button) => {
    const rect = button.getBoundingClientRect()
    const center = (button.getRootNode() as ShadowRoot).querySelector('.center-section')?.getBoundingClientRect()
    const left = (button.getRootNode() as ShadowRoot).querySelector('.left-section')?.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      button: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      center: center ? { left: center.left, right: center.right, top: center.top, bottom: center.bottom } : null,
      left: left ? { left: left.left, right: left.right, top: left.top, bottom: left.bottom } : null,
      hit: hit?.tagName ?? null,
    }
  })
  assert(
    bottomBarGeometry.button.right <= (bottomBarGeometry.left?.right ?? Number.POSITIVE_INFINITY) + 0.5,
    `left Graph toggle overflowed its grid track: ${JSON.stringify(bottomBarGeometry)}`,
  )
  await leftGraphToggle.click({ timeout: 5_000 })
  await page.waitForFunction(() => {
    const current = (window as unknown as {
      __graphHarness?: { state: HarnessState }
    }).__graphHarness?.state
    const leftAnchor = document.querySelector(
      '.split-pane[data-role="sidebar"] [data-graph-panel-anchor][data-graph-panel-location="left"]',
    )
    return current?.leftPanelMode === 'graph'
      && current.leftCollapsed === false
      && current.rightPanel === 'none'
      && leftAnchor != null
      && document.querySelector('.right-panel [data-graph-panel-anchor]') == null
      && document.querySelector('sh-graph-host')?.hasAttribute('data-visible')
  })
  assertIdentity(await graphIdentity(page), 'Files-to-Graph left-surface move')
  await page.waitForTimeout(120)
  const leftScene = await graphSnapshot(page)
  assert(leftScene.hostRect.width > 200 && leftScene.hostRect.height > 400, 'left graph did not receive usable browser geometry')
  assert(!leftScene.contextLost && leftScene.renderCalls > 0, 'left-surface move lost the WebGL renderer')
  assert(distance(leftScene.camera, beforeLeftMove.camera) < 0.05, 'left-surface move reset the graph camera')

  // Drive OrbitControls through native pointer input, then use the real panel
  // Center control and assert its canonical workspace framing direction.
  const beforeOrbit = await graphSnapshot(page)
  const canvasBox = await canvas.boundingBox()
  assert(canvasBox, 'canvas had no browser geometry for orbit drag')
  const orbitStart = { x: canvasBox.x + canvasBox.width * 0.52, y: canvasBox.y + canvasBox.height * 0.52 }
  await page.mouse.move(orbitStart.x, orbitStart.y)
  await page.mouse.down()
  await page.mouse.move(orbitStart.x + 130, orbitStart.y + 70, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(180)
  const afterOrbit = await graphSnapshot(page)
  assert(distance(afterOrbit.camera, beforeOrbit.camera) > 0.2, 'native drag did not orbit the perspective camera')

  await page.locator('sh-graph-host mn-graph-panel button[aria-label="Center graph view"]').click()
  await page.waitForTimeout(100)
  const recentered = await graphSnapshot(page)
  const canonicalWorkspaceDirection = normalized({ x: 0, y: 14, z: 18 })
  assert(distance(recentered.camera, afterOrbit.camera) > 0.2, 'Center did not move the camera after orbiting')
  assert(dot(cameraDirection(recentered), canonicalWorkspaceDirection) > 0.995, 'Center did not restore canonical workspace framing')

  // Switch through the controlled mode intent and inspect the scene actually
  // consumed by Three: six blocks on a 3.8-radius, -0.28-step helix and one
  // portal at radius 7.3 sharing its anchor's vertical position.
  await page.locator('sh-graph-host mn-graph-panel button[aria-label="Show this document"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __graphHarness?: { state: { viewMode?: string } } })
      .__graphHarness?.state.viewMode === 'document')
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel') as (HTMLElement & { viewMode?: string }) | null
    const three = panel?.shadowRoot?.querySelector('mn-graph-three') as (HTMLElement & { _renderer?: unknown }) | null
    return panel?.viewMode === 'document' && Boolean(three?._renderer)
  })
  const documentScene = await graphSnapshot(page)
  assert(documentScene.viewMode === 'document', `panel remained in ${documentScene.viewMode} mode`)
  assert(documentScene.nodeIds.join(',') === 'block-title,block-thesis,block-bullet,block-task,block-code,block-footnote,portal-neighbor', 'document projection inputs changed or reordered')
  assert(documentScene.nodeKinds['block-task'] === 'task', 'task block semantics were lost')
  assert(documentScene.nodeKinds['portal-neighbor'] === 'portal', 'cross-document portal semantics were lost')
  const blockIds = ['block-title', 'block-thesis', 'block-bullet', 'block-task', 'block-code', 'block-footnote']
  blockIds.forEach((id, index) => {
    const point = documentScene.positions[id]
    assert(point, `document scene omitted ${id}`)
    const angle = index * Math.PI * 2 / 12
    const expectedX = 3.8 * Math.cos(angle)
    // Rendered node groups receive the component's deliberate +0.02 z lift.
    const expectedZ = 3.8 * Math.sin(angle) + 0.02
    assert(Math.abs(point.x - expectedX) < 0.001, `${id} helix x was ${point.x.toFixed(3)}`)
    assert(Math.abs(point.z - expectedZ) < 0.001, `${id} helix z was ${point.z.toFixed(3)}`)
    assert(Math.abs(point.y - (index === 0 ? 0 : -index * 0.28)) < 0.001, `${id} helix y was ${point.y.toFixed(3)}`)
  })
  const portal = documentScene.positions['portal-neighbor']
  const task = documentScene.positions['block-task']
  assert(Math.abs(portal.x) < 0.001 && Math.abs(portal.z - 7.32) < 0.001, 'external portal did not fan outside the helix')
  assert(Math.abs(portal.y - task.y) < 0.001, 'external portal did not retain its block anchor height')
  assert(documentScene.renderCalls > 0 && !documentScene.contextLost, 'document scene did not render on a live WebGL context')

  const accessibleTask = page.locator('sh-graph-host mn-graph-panel mn-graph-three [data-accessible-node="block-task"]')
  await accessibleTask.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => {
    const current = (window as unknown as {
      __graphHarness?: { state: { activatedNodeIds?: readonly string[] } }
    }).__graphHarness?.state
    return current?.activatedNodeIds?.includes('block-task')
  })
  controlled = await state(page)
  assert(controlled.selectedNodeId === 'block-task', 'document accessible activation did not update controlled selection')

  const documentCanvas = page.locator('sh-graph-host mn-graph-panel mn-graph-three canvas')
  const documentPng = PNG.sync.read(await documentCanvas.screenshot({ type: 'png' }))
  assert(documentPng.width > 200 && documentPng.height > 400, 'document canvas did not fill the graph host')

  const refreshBefore = controlled.refreshCount ?? 0
  await page.evaluate(() => {
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel')
    const three = panel?.shadowRoot?.querySelector('mn-graph-three')
    ;(window as unknown as { __graphRefreshCanvas?: Element | null }).__graphRefreshCanvas =
      three?.shadowRoot?.querySelector('canvas') ?? null
  })
  await page.locator('sh-graph-host mn-graph-panel button[aria-label="Refresh graph"]').click()
  await page.waitForFunction((before) =>
    ((window as unknown as { __graphHarness?: { state: { refreshCount?: number } } })
      .__graphHarness?.state.refreshCount ?? 0) === before + 1, refreshBefore)
  assert(await page.evaluate(() => {
    const remembered = (window as unknown as { __graphRefreshCanvas?: Element | null }).__graphRefreshCanvas
    const host = document.querySelector('sh-graph-host')
    const panel = host?.shadowRoot?.querySelector('mn-graph-panel')
    const three = panel?.shadowRoot?.querySelector('mn-graph-three')
    return remembered != null && remembered === three?.shadowRoot?.querySelector('canvas')
  }), 'controlled refresh replaced the WebGL canvas')

  await page.locator('sh-graph-host mn-graph-panel button[aria-label="Show the whole workspace"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __graphHarness?: { state: { viewMode?: string } } })
      .__graphHarness?.state.viewMode === 'workspace')

  // Round-trip through Files and the right Graph toggle. The graph is hidden
  // while it has no anchor, then the same persistent canvas returns at right.
  await page.locator('mn-bottom-bar button[aria-label="Files"]').click()
  await page.waitForFunction(() => {
    const current = (window as unknown as { __graphHarness?: { state: HarnessState } }).__graphHarness?.state
    return current?.leftPanelMode === 'files'
      && document.querySelector('.split-pane[data-role="sidebar"] mn-sidebar-panel') != null
      && !document.querySelector('sh-graph-host')?.hasAttribute('data-visible')
  })
  assertIdentity(await graphIdentity(page), 'Graph-to-Files left-surface move')
  await page.locator('mn-bottom-bar button[aria-label="Toggle graph panel"]').click()
  await page.waitForFunction(() => {
    const current = (window as unknown as { __graphHarness?: { state: HarnessState } }).__graphHarness?.state
    return current?.rightPanel === 'graph'
      && document.querySelector('[data-graph-panel-location="right"]') != null
      && document.querySelector('sh-graph-host')?.hasAttribute('data-visible')
  })
  assertIdentity(await graphIdentity(page), 'right-graph restoration')

  await page.setViewportSize({ width: 820, height: 720 })
  await page.locator('mn-bottom-bar button[aria-label="Graph"]').click({ timeout: 5_000 })
  await page.waitForFunction(() =>
    document.querySelector('[data-graph-panel-location="left"]') != null
      && document.querySelector('sh-graph-host')?.hasAttribute('data-visible'))
  await page.waitForTimeout(120)
  assertIdentity(await graphIdentity(page), 'compact Files-to-Graph move')
  const compactLeftScene = await graphSnapshot(page)
  assert(
    compactLeftScene.hostRect.width >= 175 && compactLeftScene.hostRect.height > 300,
    `compact left graph measured ${compactLeftScene.hostRect.width}x${compactLeftScene.hostRect.height}`,
  )
  assert(!compactLeftScene.contextLost && compactLeftScene.renderCalls > 0, 'compact move lost WebGL rendering')

  const expectedDevWarnings = consoleWarnings.filter(message => message.includes('Lit is in dev mode'))
  // Chromium emits these only because the proof deliberately reads the WebGL
  // framebuffer for pixel evidence. They are driver diagnostics, not app logs.
  const expectedReadPixelsWarnings = consoleWarnings.filter(message =>
    message.includes('GL Driver Message') && message.includes('ReadPixels'))
  const unexpectedWarnings = consoleWarnings.filter(message =>
    !message.includes('Lit is in dev mode') &&
    !(message.includes('GL Driver Message') && message.includes('ReadPixels')))
  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)
  assert(unexpectedWarnings.length === 0, `unexpected console warnings:\n${unexpectedWarnings.join('\n')}`)
  assert(failedRequests.length === 0, `failed requests:\n${failedRequests.join('\n')}`)
  assert(badResponses.length === 0, `HTTP errors:\n${badResponses.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    slowMo,
    actualWebGL: true,
    canvasSampledColors: sampledColors.size,
    canvasLumaRange: Number((maxLuma - minLuma).toFixed(1)),
    workspaceNodes: initial.nodeIds.length,
    documentNodes: documentScene.nodeIds.length,
    controlledAccessibleActivation: true,
    canvasNodeFocus: true,
    nativeOrbitAndRecenter: true,
    persistentIdentityAcrossReorderAndCollapse: true,
    persistentIdentityAcrossLeftRightSurfaceMoves: true,
    desktopAndCompactLeftSurface: true,
    persistentIdentityAcrossProjectionMutation: true,
    documentHelixAndPortal: true,
    consoleErrors,
    pageErrors,
    unexpectedWarnings,
    expectedDevWarnings: expectedDevWarnings.length,
    expectedReadPixelsWarnings: expectedReadPixelsWarnings.length,
    failedRequests,
    badResponses,
  }, null, 2)}\n`)
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
