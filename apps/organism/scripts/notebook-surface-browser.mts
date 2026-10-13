/** Isolated notebook geometry/lifetime regression; no credentials, real reads or execution.
 * pnpm --dir apps/organism exec tsx scripts/notebook-surface-browser.mts --out ABS_NEW_DIR
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

const args = process.argv.slice(2)
if (![2, 3].includes(args.length) || args[0] !== '--out' || !isAbsolute(args[1]!) || (args[2] && !['--mirror-only', '--joined-only'].includes(args[2]))) throw new Error('Use --out ABS_NEW_DIRECTORY [--mirror-only|--joined-only]')
const mirrorOnly = args[2] === '--mirror-only'
const joinedOnly = args[2] === '--joined-only'
const output = args[1]!
await mkdir(output, { recursive: false })
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '../..')
const temp = await mkdtemp(join(tmpdir(), 'notebook-surface-vite-'))
const sources = [
  'apps/organism/notebook-surface-harness.html', 'apps/organism/src/harness/notebook-surface-harness-main.ts',
  'apps/organism/scripts/notebook-surface-browser.mts', 'packages/runtime/src/layout/layout-interpreter.ts',
  'packages/runtime/src/layout/resource-broker.ts', 'packages/runtime/src/layout/resource-store.ts',
  'packages/runtime/src/layout/faces/compute-cell-face.ts', 'packages/runtime/src/layout/faces/compute-cell-view-element.ts',
  'packages/runtime/src/layout/faces/agent-session-family-face.ts', 'packages/runtime/src/layout/faces/agent-session-family-view-element.ts',
  'packages/runtime/src/layout/faces/grid-collection-query-resource-adapter.ts',
  'apps/organism/src/cell/source-mirror-runtime.ts', 'apps/organism/src/cell/offline-workspace-overlay.ts', 'packages/runtime/src/layout/workspace-surface-element.ts',
  'apps/organism/index.html', 'apps/organism/src/cell/notebook-workspace-shell.ts', 'packages/runtime/src/render-workspace.ts',
  'apps/organism/src/cell/mobile-shell-controller.ts',
  'packages/runtime/src/layout/surface-host.ts',
]
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex')
async function hashes() { return Object.fromEntries(await Promise.all(sources.map(async path => [path, sha(await readFile(resolve(repoDir, path)))]))) }
const receipt: Record<string, any> = {
  author: '/root/surface_atlas', role: 'notebook Surface/Layout Demanation, reused network-instrument body',
  scope: 'isolated Chromium with real face/adapter/interpreter and joined mobile/desktop navigation over synthetic SELECT results; not a booted main, live app, real document editor or kernel witness',
  startedAt: new Date().toISOString(), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim(),
  sourceHashesBefore: await hashes(), cases: [], cleanup: { contextsCreated: 0, contextsClosed: 0, browserClosed: false, serverClosed: false },
  actions: ['navigate to isolated fixture', 'read layout and content', 'scroll', 'select synthetic text', 'invoke fixture-only result/scope changes'],
  forbiddenActions: ['authentication', 'real graph read/write', 'notebook execution', 'model/provider/job/grant change', 'live visit'],
}
let server: ViteDevServer | undefined, browser: Browser | undefined
let captured: { nt: string; fragment: any; surface: string } | undefined
if (joinedOnly) {
  const path = '/path/to/private-evidence/2026-09-07-notebook-surface/sophia-live-layout-vafMqP/layout.json'
  const bytes = await readFile(path)
  if (sha(bytes) !== '6d175834834070b02fc22ea2c40cf3f4ce33fd2cb8a7b13dab23667b5ba3f54b') throw new Error('CapturedLayoutHashMismatch')
  const response = JSON.parse(bytes.toString('utf8'))
  const result = response.structuredContent ?? JSON.parse(response.content.find((item: any) => item.type === 'text').text)
  const rows: Array<{ s: string; p: string; o: string }> = result.rows
  const surface = rows.find(row => row.p === '<http://sophia.ai/ux#fragmentSurface>')!.o
  captured = { nt: rows.map(row => `${row.s} ${row.p} ${row.o} .`).join('\n'), surface: surface.slice(1, -1),
    fragment: JSON.parse(JSON.parse(rows.find(row => row.s === surface && row.p === '<http://mnemosyne.dev/ux#layoutJson>')!.o)) }
  receipt.capturedLayout = { path, sha256: sha(bytes), surface: captured.surface, layoutId: captured.fragment.layoutId, note: 'Exact retained graph layout/config; all displayed cell/family query rows remain synthetic' }
}
try {
  server = await createServer({ root: appDir, configFile: false, envDir: temp, cacheDir: join(temp, 'cache'), logLevel: 'error',
    optimizeDeps: { entries: ['notebook-surface-harness.html'], exclude: ['oxigraph'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [repoDir] } },
    plugins: [{ name: 'notebook-local-boundary', configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'")
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Fixture is read-only'); return }
        next()
      })
    } }],
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('NoLoopbackFixtureAddress')
  const origin = `http://127.0.0.1:${address.port}`
  receipt.origin = origin
  browser = await chromium.launch({ headless: true, timeout: 30000, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'] })
  receipt.engine = browser.version()
  const scenarios = mirrorOnly ? [{ layout: 'mirror', width: 1280, height: 720 }] : joinedOnly ? [{ layout: 'joined', width: 375, height: 720 }, { layout: 'joined', width: 1280, height: 720 }] : [
    { layout: 'leaf', width: 375, height: 400 }, { layout: 'stack', width: 280, height: 720 },
    { layout: 'reflow', width: 375, height: 720 }, { layout: 'family-split', width: 375, height: 720 },
    { layout: 'family-split', width: 1280, height: 720 }, { layout: 'collection', width: 1280, height: 720 },
  ]
  for (const scenario of scenarios) {
    const observed: Record<string, any> = { id: `${scenario.layout}-${scenario.width}`, ...scenario, checks: {}, pageErrors: [], blockedRequests: [] }
    receipt.cases.push(observed)
    let context: BrowserContext | undefined
    try {
      context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, serviceWorkers: 'block' })
      receipt.cleanup.contextsCreated++
      if (captured) await context.addInitScript(value => Object.defineProperty(window, '__capturedNotebook', { value }), captured)
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin && ['GET', 'HEAD'].includes(route.request().method())) return route.continue()
        observed.blockedRequests.push({ method: route.request().method(), origin: new URL(route.request().url()).origin }); return route.abort('blockedbyclient')
      })
      await context.routeWebSocket('**/*', socket => socket.close())
      const page = await context.newPage()
      page.setDefaultTimeout(7000)
      page.on('pageerror', error => observed.pageErrors.push(error.name))
      await page.goto(`${origin}/notebook-surface-harness.html?layout=${scenario.layout}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForFunction(() => window.__notebookSurface?.state.ready || window.__notebookSurface?.state.error)
      observed.initial = await page.evaluate(() => window.__notebookSurface.state)
      if (!observed.initial.ready) throw new Error(observed.initial.error ?? 'FixtureNotReady')
      await page.locator('sh-compute-cell-view .source code').first().waitFor({ state: 'visible' })
      observed.checks.allFacesReady = await page.evaluate(() => [...document.querySelectorAll('sh-compute-cell-view, sh-agent-session-family-view')].every(view => (view as HTMLElement & { status: string }).status === 'ready'))
      observed.geometry = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('#notebook-root, #host')!
        const wrapper = root.querySelector<HTMLElement>('[data-layout-node-kind="grid"]') ?? root.querySelector<HTMLElement>('[data-layout-node-kind="leaf"]')!
        const views = [...root.querySelectorAll('sh-compute-cell-view')]
        return { root: root.getBoundingClientRect().toJSON(), wrapper: { ...wrapper.getBoundingClientRect().toJSON(), scrollWidth: wrapper.scrollWidth, clientWidth: wrapper.clientWidth, scrollHeight: wrapper.scrollHeight, clientHeight: wrapper.clientHeight, overflowX: getComputedStyle(wrapper).overflowX, overflowY: getComputedStyle(wrapper).overflowY },
          views: views.map(view => ({ ...view.getBoundingClientRect().toJSON(), parent: view.parentElement!.getBoundingClientRect().toJSON(), content: view.shadowRoot!.querySelector('.cell')!.getBoundingClientRect().toJSON() })), pageScrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
      })
      const geometry = observed.geometry
      observed.checks.noHorizontalClipping = geometry.wrapper.scrollWidth <= geometry.wrapper.clientWidth + 1
        && geometry.views.every((view: any) => view.right <= geometry.wrapper.right + 1 && view.x >= geometry.wrapper.x - 1)
        && geometry.pageScrollWidth <= geometry.viewportWidth
      observed.checks.userVerticalScrollOwner = geometry.wrapper.scrollHeight <= geometry.wrapper.clientHeight + 1 || ['auto', 'scroll'].includes(geometry.wrapper.overflowY)
      observed.firstCellHit = await page.evaluate(() => {
        const view = document.querySelector('sh-compute-cell-view')!, code = view.shadowRoot!.querySelector('code')!, box = code.getBoundingClientRect()
        const x = box.left + Math.min(10, box.width / 2), y = box.top + 5
        let hit = document.elementFromPoint(x, y)
        while (hit?.shadowRoot) { const child = hit.shadowRoot.elementFromPoint(x, y); if (!child || child === hit) break; hit = child }
        return { x, y, tag: hit?.tagName, inCell: hit?.getRootNode() === view.shadowRoot }
      })
      observed.checks.notebookIsNotCoveredByAnotherSurface = observed.firstCellHit.inCell
      if (scenario.layout === 'joined' && scenario.width >= 1025) {
        // Read-only examination of the residual desktop rules. A passing
        // notebook scroll/lifetime suite does not certify these separators.
        observed.desktopDividerInspection = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#host [data-layout-divider]')].map(handle => {
          const box = handle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + Math.min(50, box.height / 2)
          const hit = document.elementFromPoint(x, y)
          const overlaps = [...document.querySelectorAll<HTMLElement>('sh-compute-cell-view, sh-agent-session-family-view')].filter(view => {
            const r = view.getBoundingClientRect(); return x > r.left && x < r.right && y > r.top && y < r.bottom
          }).map(view => view.tagName.toLowerCase())
          return { splitId: handle.dataset.layoutDivider, label: handle.getAttribute('aria-label'), box: box.toJSON(), rule: handle.querySelector('span')?.getBoundingClientRect().toJSON(),
            point: { x, y }, pointerEvents: getComputedStyle(handle).pointerEvents, hitIsThisSeparator: hit?.closest('[data-layout-divider]') === handle, overlaps }
        }))
        observed.openFindings = observed.desktopDividerInspection.filter((item: any) => item.hitIsThisSeparator && item.overlaps.length)
          .map((item: any) => ({ kind: 'desktop-divider-intercepts-content', splitId: item.splitId, overlaps: item.overlaps, disposition: 'Fails the amended divider acceptance.' }))
        observed.checks.desktopDividersDoNotInterceptContent = observed.openFindings.length === 0
      }
      if (scenario.layout === 'family-split' || scenario.layout === 'joined') {
        observed.family = await page.evaluate(() => {
          const view = document.querySelector('sh-agent-session-family-view')!, shadow = view.shadowRoot!
          const family = shadow.querySelector<HTMLElement>('.family')!, ledger = shadow.querySelector<HTMLElement>('[aria-label="Parent admission ledger"]')!
          const box = family.getBoundingClientRect()
          return { width: box.width, height: box.height, scrollHeight: family.scrollHeight, clientHeight: family.clientHeight, overflow: getComputedStyle(family).overflowY,
            ledgerText: ledger.textContent?.replace(/\s+/g, ' ').trim(), ledgerFits: [...ledger.querySelectorAll('span')].every(span => { const r = span.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 }) }
        })
        observed.checks.familyLedgerIsNotHorizontallyClipped = observed.family.width > 0 && observed.family.height > 0 && observed.family.ledgerFits
      }
      await page.screenshot({ path: join(output, `${observed.id}-top.png`), fullPage: false })
      observed.tail = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('#notebook-root, #host')!
        const wrapper = root.querySelector<HTMLElement>('[data-layout-node-kind="grid"]') ?? root.querySelector<HTMLElement>('[data-layout-node-kind="leaf"]')!
        wrapper.scrollTop = wrapper.scrollHeight
        const views = [...root.querySelectorAll('sh-compute-cell-view')]
        const tail = views.at(-1)!.shadowRoot!.querySelector<HTMLElement>('.output:last-child .content')!
        const r = tail.getBoundingClientRect(), w = wrapper.getBoundingClientRect()
        return { text: tail.textContent?.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right, wrapperTop: w.top, wrapperBottom: w.bottom, wrapperRight: w.right, scrollTop: wrapper.scrollTop }
      })
      observed.checks.lastOutputReachable = observed.checks.userVerticalScrollOwner && observed.tail.bottom <= observed.tail.wrapperBottom + 1 && observed.tail.top >= observed.tail.wrapperTop - 1 && observed.tail.right <= observed.tail.wrapperRight + 1
      await page.screenshot({ path: join(output, `${observed.id}-tail.png`), fullPage: false })
      if (scenario.layout === 'mirror') {
        await page.evaluate(() => {
          const first = document.querySelector('sh-compute-cell-view')!, scroll = document.querySelector<HTMLElement>('[data-layout-node-kind="grid"]')!
          scroll.scrollTop = 200
          ;(window as any).__mirrorBefore = { first, scroll, scrollTop: scroll.scrollTop, state: window.__notebookSurface.state, loadingFrames: 0 }
          ;(window as any).__mirrorObserver = new MutationObserver(() => {
            if ([...document.querySelectorAll('sh-compute-cell-view')].some(view => view.status === 'loading')) (window as any).__mirrorBefore.loadingFrames++
          })
          ;(window as any).__mirrorObserver.observe(document.querySelector('#notebook-root'), { childList: true, subtree: true })
        })
        for (let tick = 0; tick < 3; tick++) await page.evaluate(() => window.__notebookSurface.mirrorRetry())
        observed.mirror = await page.evaluate(() => {
          const old = (window as any).__mirrorBefore; (window as any).__mirrorObserver.disconnect()
          return { before: old.state, after: window.__notebookSurface.state, sameView: document.querySelector('sh-compute-cell-view') === old.first,
            scrollTop: old.scroll.scrollTop, previousScrollTop: old.scrollTop, loadingFrames: old.loadingFrames }
        })
        observed.checks.sameGraphFailedMirrorRetriesDoNotTearDown = observed.mirror.sameView && observed.mirror.after.mounts === observed.mirror.before.mounts
          && observed.mirror.after.disposals === 0 && observed.mirror.loadingFrames === 0 && observed.mirror.scrollTop === observed.mirror.previousScrollTop
        observed.checks.retriesStillOccur = observed.mirror.after.mirrorPulls === 3 && observed.mirror.after.mirrorNotifications >= 6
        await page.screenshot({ path: join(output, `${observed.id}-after-retries.png`), fullPage: false })
      }
      if (scenario.layout === 'collection' || scenario.layout === 'family-split' || scenario.layout === 'joined') {
        await page.evaluate(() => {
          const view = document.querySelector('sh-compute-cell-view')!
          const code = view.shadowRoot!.querySelector('code')!
          const range = document.createRange(); range.selectNodeContents(code)
          const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
          const scroll = document.querySelector<HTMLElement>('[data-layout-node-kind="grid"]')!; scroll.scrollTop = 200
          ;(window as any).__notebookRemembered = { view, code, scroll, scrollTop: scroll.scrollTop, selected: selection.toString(), state: window.__notebookSurface.state }
        })
        await page.waitForFunction(() => window.__notebookSurface.state.collectionReads >= (window as any).__notebookRemembered.state.collectionReads + 3)
        await page.evaluate(async () => { await window.__notebookSurface.unchangedRender(); await window.__notebookSurface.unchangedRender() })
        observed.refresh = await page.evaluate(() => {
          const old = (window as any).__notebookRemembered, state = window.__notebookSurface.state
          return { state, previous: old.state, sameView: document.querySelector('sh-compute-cell-view') === old.view,
            sameCode: old.view.shadowRoot.querySelector('code') === old.code, scrollTop: old.scroll.scrollTop, previousScrollTop: old.scrollTop,
            sameSelection: old.selected.length > 0 && window.getSelection()!.toString() === old.selected }
        })
        observed.checks.unchangedPollingPreservesMountScrollSelection = observed.refresh.sameView && observed.refresh.sameCode && observed.refresh.sameSelection
          && observed.refresh.scrollTop === observed.refresh.previousScrollTop && observed.refresh.state.mounts === observed.refresh.previous.mounts && observed.refresh.state.disposals === 0
        await page.evaluate(() => window.__notebookSurface.changeResult())
        await page.waitForFunction(() => [...document.querySelectorAll('sh-compute-cell-view')].some(view => view.cell?.cellIri === 'urn:fixture:notebook:changed'))
        observed.changed = await page.evaluate(() => ({ state: window.__notebookSurface.state, firstRetained: document.querySelector('sh-compute-cell-view') === (window as any).__notebookRemembered.view,
          cells: [...document.querySelectorAll('sh-compute-cell-view')].map(view => view.cell?.cellIri) }))
        observed.checks.changedResultUpdatesOnlyChangedCell = observed.changed.firstRetained && observed.changed.cells.join(',') === 'urn:fixture:notebook:first,urn:fixture:notebook:changed'
          && (scenario.layout === 'joined' || (observed.changed.state.mounts === observed.refresh.state.mounts + 1 && observed.changed.state.disposals === 1))
        if (scenario.layout !== 'joined') {
          await page.evaluate(() => window.__notebookSurface.changeResourceScope())
          observed.scopeChange = await page.evaluate(() => ({ state: window.__notebookSurface.state, replaced: document.querySelector('sh-compute-cell-view') !== (window as any).__notebookRemembered.view }))
          observed.checks.resourceBoundaryStillRemounts = observed.scopeChange.replaced && observed.scopeChange.state.mounts === observed.changed.state.mounts + 2
        }
      }
      if (scenario.layout === 'family-split' || scenario.layout === 'joined') {
        observed.familyTail = await page.evaluate(() => {
          const view = document.querySelector('sh-agent-session-family-view')!, family = view.shadowRoot!.querySelector<HTMLElement>('.family')!, rows = view.shadowRoot!.querySelector<HTMLElement>('.rows')!
          family.scrollTop = family.scrollHeight; rows.scrollTop = rows.scrollHeight
          const tail = rows.querySelector<HTMLElement>('.child:last-child .allocation')!, r = tail.getBoundingClientRect(), f = family.getBoundingClientRect()
          return { text: tail.textContent?.replace(/\s+/g, ' ').trim(), top: r.top, bottom: r.bottom, familyTop: f.top, familyBottom: f.bottom,
            scrollable: family.scrollHeight <= family.clientHeight + 1 || ['auto', 'scroll'].includes(getComputedStyle(family).overflowY) }
        })
        observed.checks.familyLastChildReachable = observed.familyTail.scrollable && observed.familyTail.familyBottom > observed.familyTail.familyTop && observed.familyTail.top >= observed.familyTail.familyTop - 1 && observed.familyTail.bottom <= observed.familyTail.familyBottom + 1
        await page.screenshot({ path: join(output, `${observed.id}-family-tail.png`), fullPage: false })
      }
      if (scenario.layout === 'joined') {
        await page.evaluate(() => { (window as any).__joinedSurface = document.querySelector('sh-workspace-surface') })
        if (scenario.width < 700) {
          const mobile = page.locator('.organism-mobile-shell[data-active="true"]')
          observed.checks.mobileNavigationVisible = await mobile.locator('mn-mobile-tabs').isVisible()
          observed.mobileSnapshot = await page.locator('body').ariaSnapshot()
          await page.screenshot({ path: join(output, `${observed.id}-mobile-before-navigation.png`), fullPage: false })
          await mobile.getByRole('button', { name: 'Browse', exact: true }).click()
          const documentRow = mobile.locator('.organism-mobile-files[data-visible="true"] mn-mobile-file-list .list[aria-label="Documents"] button[data-node-id="fixture-route"]:visible')
          if (await documentRow.count() !== 1) throw new Error('ExpectedOneVisibleMobileFixtureDocument')
          await documentRow.click()
          await page.waitForFunction(() => window.__notebookSurface.state.explicitRoute && !document.querySelector('sh-compute-cell-view'))
          const routeStatus = page.locator('#host #mn-editor-host').getByText('editor host — error: Synthetic read-only document route: no provider is opened.', { exact: true })
          await routeStatus.waitFor({ state: 'visible' })
          observed.checks.mobileBrowseEscapesNotebookForExplicitHostRoute = await routeStatus.isVisible()
            && await page.evaluate(() => window.__notebookSurface.state.mobile?.view === 'document' && document.querySelectorAll('sh-editor-host').length === 1)
          await page.screenshot({ path: join(output, `${observed.id}-synthetic-document-route.png`), fullPage: false })
          await mobile.getByRole('button', { name: 'Home', exact: true }).click()
          await page.waitForFunction(() => !window.__notebookSurface.state.explicitRoute && document.querySelector('#host')?.getAttribute('data-mobile-notebook') === 'true' && Boolean(document.querySelector('sh-compute-cell-view')))
          observed.checks.mobileHomeReturnsToCapturedNotebook = await page.evaluate(() => window.__notebookSurface.state.mobile?.activeRoot === 'home'
            && window.__notebookSurface.state.capturedLayoutId === window.__capturedNotebook!.fragment.layoutId
            && document.querySelector<HTMLElement>('.organism-mobile-home')!.dataset.visible === 'false'
            && Boolean(document.querySelector('sh-agent-session-family-view')?.closest('[data-mobile-notebook-node]')))
          await page.screenshot({ path: join(output, `${observed.id}-returned-home.png`), fullPage: false })
        } else {
        observed.checks.appChromeVisible = await page.locator('mn-top-bar').isVisible() && await page.locator('mn-bottom-bar').isVisible()
        const documentRow = page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('tree').locator('[role="treeitem"][data-kind="document"][data-node-id="fixture-route"]:visible')
        if (await documentRow.count() !== 1) throw new Error('ExpectedOneVisibleFixtureDocument')
        await documentRow.locator('.label').click()
        await page.waitForFunction(() => window.__notebookSurface.state.explicitRoute && !document.querySelector('sh-compute-cell-view'))
        const routeStatus = page.locator('#host #mn-editor-host').getByText('editor host — error: Synthetic read-only document route: no provider is opened.', { exact: true })
        await routeStatus.waitFor({ state: 'visible' })
        observed.checks.sidebarEscapesNotebookForExplicitHostRoute = await routeStatus.isVisible() && await page.locator('sh-editor-host').count() === 1
        await page.screenshot({ path: join(output, `${observed.id}-synthetic-document-route.png`), fullPage: false })
        await page.locator('mn-top-bar [data-app-action="home"]').click()
        await page.locator('sh-compute-cell-view').first().waitFor({ state: 'visible' })
        observed.checks.homeReturnsToCapturedNotebook = await page.evaluate(() => !window.__notebookSurface.state.explicitRoute && window.__notebookSurface.state.capturedLayoutId === window.__capturedNotebook!.fragment.layoutId)
        await page.screenshot({ path: join(output, `${observed.id}-returned-home.png`), fullPage: false })
        }
        observed.checks.navigationDoesNotCloneOrReplaceSurfaceHost = await page.evaluate(() => document.querySelectorAll('sh-workspace-surface').length === 1 && document.querySelector('sh-workspace-surface') === (window as any).__joinedSurface
          && document.querySelectorAll('sh-editor-host').length === 0)
        await page.evaluate(() => { (window as any).__beforeResize = document.querySelector('sh-compute-cell-view') })
        for (const width of [scenario.width < 700 ? 1280 : 375, scenario.width]) {
          await page.setViewportSize({ width, height: scenario.height })
          await page.waitForFunction(expected => document.querySelector('#host')?.getAttribute('data-mobile-notebook') === String(expected), width < 1025)
        }
        observed.checks.viewportChangesRetainNotebookNode = await page.evaluate(() => document.querySelector('sh-compute-cell-view') === (window as any).__beforeResize)
        for (const status of ['loading', 'error'] as const) {
          await page.evaluate(value => window.__notebookSurface.fragmentState(value), status)
          const visibleStatus = page.locator(`#host [data-layout-fragment-status="${status}"][data-fragment-region="region-center"]`)
          await visibleStatus.waitFor({ state: 'visible' })
          observed.checks[`${status}IsHonestVisibleNotebookState`] = await visibleStatus.isVisible() && await page.locator('sh-compute-cell-view').count() === 0
            && (status === 'loading' || (await visibleStatus.textContent())?.includes('Synthetic notebook read unavailable') === true)
          await page.screenshot({ path: join(output, `${observed.id}-${status}.png`), fullPage: false })
        }
        await page.evaluate(() => window.__notebookSurface.fragmentState('ready'))
        await page.locator('sh-compute-cell-view').first().waitFor({ state: 'visible' })
      }
      await page.evaluate(() => window.__notebookSurface.dispose())
      observed.final = await page.evaluate(() => window.__notebookSurface.state)
      if (scenario.layout === 'joined') {
        observed.checks.joinedHostsAndMobilePortalRemoved = await page.evaluate(() => !document.querySelector('sh-workspace-surface, .organism-mobile-shell'))
        observed.lifetimeInstrumentation = 'Joined Surface DOM identity and removal observed; inner broker lease/mount counters are not instrumented in this case.'
      } else observed.checks.noLeasesAfterDispose = observed.final.leases === 0 && observed.final.mounts === observed.final.disposals
      observed.checks.noUnexpectedPageErrors = observed.pageErrors.length === 0
      observed.checks.noExternalOrMutatingRequests = observed.blockedRequests.length === 0
      observed.pass = Object.values(observed.checks).every(Boolean)
    } catch (cause) { observed.error = cause instanceof Error ? { name: cause.name, message: cause.message.replace(/https?:\/\/[^\s)]+/g, '[url]') } : { name: 'UnknownError' }; observed.pass = false }
    finally { if (context) { await context.close(); receipt.cleanup.contextsClosed++ } console.log(JSON.stringify({ id: observed.id, pass: observed.pass, checks: observed.checks, error: observed.error })) }
  }
  receipt.sourceHashesAfter = await hashes()
  receipt.sourceStable = JSON.stringify(receipt.sourceHashesBefore) === JSON.stringify(receipt.sourceHashesAfter)
  receipt.pass = receipt.sourceStable && receipt.cases.length === scenarios.length && receipt.cases.every((item: any) => item.pass)
} catch (cause) { receipt.error = cause instanceof Error ? { name: cause.name, message: cause.message } : { name: 'UnknownError' }; receipt.pass = false }
finally {
  if (browser) { await browser.close(); receipt.cleanup.browserClosed = true }
  if (server) { await server.close(); receipt.cleanup.serverClosed = true }
  receipt.tempCacheRetained = temp; receipt.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
}
console.log(JSON.stringify({ output, pass: receipt.pass, sourceStable: receipt.sourceStable, cleanup: receipt.cleanup, error: receipt.error }))
process.exitCode = receipt.pass ? 0 : 1
