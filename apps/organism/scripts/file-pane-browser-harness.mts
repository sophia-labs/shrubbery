import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_FILE_PANE_BROWSER_PORT ?? 5209)
const headed = process.env.SHRUBBERY_HEADED === '1'
const slowMo = Number(process.env.SHRUBBERY_SLOW_MO ?? (headed ? 100 : 0))

interface HarnessState {
  readonly ready?: boolean
  readonly error?: string | null
  readonly leftExpanded?: boolean
  readonly searchQuery?: string
  readonly sort?: { readonly criterion?: string; readonly direction?: string }
  readonly grouping?: { readonly separateArtifacts?: boolean; readonly showFolders?: boolean }
  readonly selectedIds?: readonly string[]
  readonly columnPaths?: Readonly<Record<string, readonly string[]>>
  readonly status?: string
  readonly refreshCount?: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`file-pane-browser-harness assertion failed: ${message}`)
}

async function state(page: Page): Promise<HarnessState> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __filePaneHarness?: { state: HarnessState } }).__filePaneHarness
    if (!bridge) throw new Error('file-pane harness bridge unavailable')
    return bridge.state
  })
}

async function rowIds(page: Page): Promise<string[]> {
  return page.locator('mn-sidebar-panel [data-node-id]').evaluateAll(rows =>
    rows.map(row => row.getAttribute('data-node-id') ?? ''),
  )
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  logLevel: 'warn',
})
await server.listen()

const browser = await chromium.launch({ headless: !headed, slowMo: Number.isFinite(slowMo) ? slowMo : 0 })
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
const consoleWarnings: string[] = []
const failedRequests: string[] = []
const badResponses: string[] = []
page.on('pageerror', value => pageErrors.push(value.stack ?? value.message))
page.on('console', value => {
  if (value.type() === 'error') consoleErrors.push(value.text())
  if (value.type() === 'warning') consoleWarnings.push(value.text())
})
page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText ?? 'failed'}`))
page.on('response', response => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`) })

try {
  await page.goto(`http://127.0.0.1:${port}/file-pane-browser-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const current = (window as unknown as { __filePaneHarness?: { state: HarnessState } }).__filePaneHarness?.state
    return current?.ready === true || Boolean(current?.error)
  })
  const boot = await state(page)
  assert(boot.error == null, `fixture boot failed: ${String(boot.error)}`)

  const pane = page.locator('mn-sidebar-panel')
  await pane.waitFor({ state: 'visible' })
  assert(await page.locator('mn-sidebar-panel [data-file-pane-body="tree"]').count() === 1, 'compact tree was not the initial topology')
  const initialRows = await rowIds(page)
  assert(
    initialRows.join(',') === 'folder-research,doc-zeta,doc-alpha,doc-root,artifact-map,tag-parity',
    `initial manual order changed: ${initialRows.join(',')}`,
  )

  await page.locator('mn-sidebar-panel .sort-select').selectOption('alphabetical')
  await page.waitForFunction(() =>
    (window as unknown as { __filePaneHarness?: { state: HarnessState } })
      .__filePaneHarness?.state.sort?.criterion === 'alphabetical')
  const alphabetical = await rowIds(page)
  assert(alphabetical.slice(0, 4).join(',') === 'folder-research,doc-alpha,doc-zeta,doc-root', `alphabetical order was ${alphabetical.join(',')}`)

  await page.locator('mn-sidebar-panel [data-node-id="doc-alpha"]').click()
  await page.locator('mn-sidebar-panel [data-node-id="doc-zeta"]').click({ modifiers: ['Meta'] })
  await page.waitForTimeout(100)
  const selected = await state(page)
  assert(selected.selectedIds?.length === 2, `controlled selection was ${selected.selectedIds?.join(',') ?? '(none)'}`)
  assert(await page.locator('mn-sidebar-panel .selection-copy').textContent() === '2 items selected', 'multi-selection feedback was absent')

  await page.locator('[data-panel-controls="left"] [data-panel-mode="expanded"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __filePaneHarness?: { state: HarnessState } })
      .__filePaneHarness?.state.leftExpanded === true)
  assert(await page.locator('mn-sidebar-panel [data-file-pane-body="columns"]').count() === 1, 'expanded pane did not become Miller columns')
  await page.locator('mn-sidebar-panel [data-column-node][data-node-id="folder-research"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __filePaneHarness?: { state: HarnessState } })
      .__filePaneHarness?.state.columnPaths?.documents?.join(',') === 'folder-research')
  assert(await page.locator('mn-sidebar-panel [data-columns-section="documents"] .column').count() === 2, 'folder path did not add a document column')

  await page.locator('mn-sidebar-panel .search-input').fill('alpha')
  await page.waitForFunction(() =>
    document.querySelector('mn-sidebar-panel')?.shadowRoot
      ?.querySelector('[data-file-pane-presentation="search-results"]') != null)
  assert(await page.locator('mn-sidebar-panel [data-file-pane-body="columns"]').count() === 0, 'search failed to supersede columns topology')
  assert((await rowIds(page)).join(',') === 'folder-research,doc-alpha', 'search did not preserve only the matching ancestor path')
  await page.locator('mn-sidebar-panel .search-input').fill('')

  await page.evaluate(() => {
    ;(window as unknown as { __filePaneHarness?: { setStatus(status: string): void } })
      .__filePaneHarness?.setStatus('reconnecting')
  })
  await page.locator('mn-sidebar-panel [data-status="reconnecting"]').waitFor()
  await page.locator('mn-sidebar-panel button[aria-label="Refresh files"]').click()
  assert((await state(page)).refreshCount === 1, 'refresh intent did not reach the controlled host')

  await page.evaluate(() => {
    ;(window as unknown as { __filePaneHarness?: { setCapabilities(value: Record<string, boolean>): void } })
      .__filePaneHarness?.setCapabilities({ refresh: true, sort: true, group: true, multiSelect: true })
  })
  assert(await page.locator('mn-sidebar-panel button[aria-label="New document"]').count() === 0, 'strict capabilities exposed an unavailable create action')
  assert(await page.locator('mn-sidebar-panel [data-node-id="doc-alpha"]').getAttribute('draggable') === 'false', 'strict capabilities exposed drag/drop')

  await page.locator('[data-panel-controls="left"] [data-panel-mode="normal"]').click()
  await page.setViewportSize({ width: 820, height: 720 })
  await page.waitForFunction(() =>
    (window as unknown as { __filePaneHarness?: { state: HarnessState } })
      .__filePaneHarness?.state.leftExpanded === false)
  const compactRect = await pane.boundingBox()
  assert(compactRect && compactRect.width >= 180 && compactRect.height > 500, `compact pane geometry was ${JSON.stringify(compactRect)}`)
  await page.locator('mn-sidebar-panel .sort-select').selectOption('connectivity')
  assert((await state(page)).sort?.criterion === 'connectivity', 'compact control was not pointer-operable')

  const unexpectedWarnings = consoleWarnings.filter(value => !value.includes('Lit is in dev mode'))
  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)
  assert(unexpectedWarnings.length === 0, `unexpected warnings:\n${unexpectedWarnings.join('\n')}`)
  assert(failedRequests.length === 0, `failed requests:\n${failedRequests.join('\n')}`)
  assert(badResponses.length === 0, `HTTP errors:\n${badResponses.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    treeColumnsSearchTopologies: true,
    sortGroupingSelectionAndPathIntents: true,
    operationalAndCapabilityTruth: true,
    desktopAndCompact: true,
    consoleErrors,
    pageErrors,
    unexpectedWarnings,
    failedRequests,
    badResponses,
  }, null, 2)}\n`)
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
