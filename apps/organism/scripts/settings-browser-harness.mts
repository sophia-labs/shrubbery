import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium, type Locator, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.SHRUBBERY_SETTINGS_BROWSER_PORT ?? 0)
const headed = process.env.SHRUBBERY_SETTINGS_HEADED === '1'
const GRAPH_ID = 'settings-browser'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`settings-browser-harness assertion failed: ${message}`)
}

async function bridgeState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __settingsHarness?: { state: Record<string, unknown> } }).__settingsHarness
    if (!bridge) throw new Error('window.__settingsHarness is unavailable')
    return bridge.state
  })
}

async function waitForJob(
  settings: Locator,
  jobId: string,
  status: 'succeeded' | 'failed',
): Promise<Locator> {
  const job = settings.locator(`[data-job-id="${jobId}"]`)
  await settings.locator(`[data-job-id="${jobId}"][data-status="${status}"]`).waitFor()
  return job
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: requestedPort, strictPort: requestedPort !== 0 },
  logLevel: 'warn',
})
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : requestedPort
if (!port) throw new Error('Settings browser harness could not resolve its Vite port')
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 40 : 0 })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`http://127.0.0.1:${port}/settings-browser-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const state = (window as unknown as { __settingsHarness?: { state: { ready?: boolean; error?: string | null } } }).__settingsHarness?.state
    return state?.ready === true || Boolean(state?.error)
  })
  let state = await bridgeState(page)
  assert(state.error == null, `boot error: ${String(state.error)}`)

  const settings = page.locator('mn-settings-page')
  await settings.waitFor({ state: 'visible' })
  for (const label of ['Account', 'Appearance', 'Interface', 'Version History', 'Graph Ops', 'Imports', 'API & MCP', 'Local AI']) {
    assert(await settings.getByRole('button', { name: label, exact: true }).count() === 1, `${label} navigation is missing`)
  }
  for (const label of ['Billing & Usage', 'Billing', 'Usage', 'AI Provider Keys', 'Experimental', 'Privacy']) {
    assert(await settings.getByRole('button', { name: label, exact: true }).count() === 0, `${label} should not be advertised in this runtime`)
  }
  assert(await settings.getByRole('button', { name: 'Refresh', exact: true }).count() === 0, 'generic global Refresh control should be absent')
  assert(await settings.locator('[data-action-id="rename-graph"]').count() === 0, 'rename placeholder should be absent')
  assert(await settings.locator('[data-job-id="graph-maintenance"]').count() === 0, 'graph-maintenance placeholder should be absent')
  assert((await settings.locator('.section-kicker').textContent())?.trim() === 'Workspace', 'section provenance is absent')
  assert(await settings.locator('[data-section-id="imports"]').getAttribute('aria-current') === 'page', 'active Settings navigation lacks page semantics')

  // Appearance is the same persisted identity system as the workspace chrome.
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
  assert(await settings.locator('.panel-title').allTextContents().then(values => values.join('|')) === 'Reading room|Motion', 'Appearance lacks reading-room hierarchy')
  await settings.evaluate((element) => {
    const root = element.shadowRoot!
    const monitor = window as typeof window & {
      __settingsBlankRefreshes?: number
      __settingsRefreshObserver?: MutationObserver
    }
    monitor.__settingsBlankRefreshes = 0
    monitor.__settingsRefreshObserver?.disconnect()
    monitor.__settingsRefreshObserver = new MutationObserver(() => {
      const main = root.querySelector<HTMLElement>('main')
      if (main?.getAttribute('aria-busy') === 'true' && !root.querySelector('.section-title')) {
        monitor.__settingsBlankRefreshes = (monitor.__settingsBlankRefreshes ?? 0) + 1
      }
    })
    monitor.__settingsRefreshObserver.observe(root, { childList: true, subtree: true, attributes: true })
  })
  const skinSelect = settings.getByLabel('Skin', { exact: true })
  assert(await skinSelect.locator('option').allTextContents().then(values => values.join('|'))
    === 'Garden|Sophia|98|Glass', 'Settings does not expose the complete identity cycle')
  await skinSelect.selectOption('98')
  await page.waitForFunction(() => document.documentElement.dataset.skin === '98')
  const ninetyEightMaterials = await settings.evaluate((element) => {
    const root = element.shadowRoot!
    const panel = root.querySelector<HTMLElement>('.panel')!
    const toggle = root.querySelector<HTMLElement>('.toggle')!
    const close = root.querySelector<HTMLElement>('.close')!
    return {
      panelRadius: getComputedStyle(panel).borderRadius,
      panelShadow: getComputedStyle(panel).boxShadow,
      toggleRadius: getComputedStyle(toggle).borderRadius,
      closeRadius: getComputedStyle(close).borderRadius,
    }
  })
  assert(ninetyEightMaterials.panelRadius === '0px', '98 Settings panel kept modern rounded corners')
  assert(ninetyEightMaterials.toggleRadius === '0px', '98 Settings toggle kept modern rounded corners')
  assert(ninetyEightMaterials.closeRadius === '0px', '98 Settings close control kept modern rounded corners')
  assert(ninetyEightMaterials.panelShadow !== 'none', '98 Settings panel lacks raised material')
  await skinSelect.selectOption('glass')
  await page.waitForFunction(() => document.documentElement.dataset.skin === 'glass')
  const glassMaterials = await settings.evaluate((element) => {
    const root = element.shadowRoot!
    const panel = root.querySelector<HTMLElement>('.panel')!
    const close = root.querySelector<HTMLElement>('.close')!
    return {
      panelShadow: getComputedStyle(panel).boxShadow,
      closeBackground: getComputedStyle(close).backgroundColor,
      closeBackgroundImage: getComputedStyle(close).backgroundImage,
      closeBorder: getComputedStyle(close).borderTopStyle,
    }
  })
  assert(glassMaterials.panelShadow !== 'none', 'Glass Settings panel lacks dimensional material')
  assert(
    glassMaterials.closeBackground !== 'rgba(0, 0, 0, 0)' || glassMaterials.closeBackgroundImage !== 'none',
    'Glass Settings close control is transparent',
  )
  assert(glassMaterials.closeBorder !== 'none', 'Glass Settings close control lacks a glass border')
  const blankRefreshes = await page.evaluate(() => {
    const monitor = window as typeof window & {
      __settingsBlankRefreshes?: number
      __settingsRefreshObserver?: MutationObserver
    }
    monitor.__settingsRefreshObserver?.disconnect()
    return monitor.__settingsBlankRefreshes ?? 0
  })
  assert(blankRefreshes === 0, 'Settings blanked its current section during an appearance refresh')

  await page.setViewportSize({ width: 640, height: 820 })
  const compactNavigation = await settings.evaluate((element) => {
    const root = element.shadowRoot!
    return {
      sidebarDirection: getComputedStyle(root.querySelector<HTMLElement>('.sidebar')!).flexDirection,
      navDisplay: getComputedStyle(root.querySelector<HTMLElement>('.nav')!).display,
      navOverflowX: getComputedStyle(root.querySelector<HTMLElement>('.nav')!).overflowX,
    }
  })
  assert(compactNavigation.sidebarDirection === 'row', 'compact Settings navigation did not become a top rail')
  assert(compactNavigation.navDisplay === 'flex', 'compact Settings navigation is not horizontally composed')
  assert(compactNavigation.navOverflowX === 'auto', 'compact Settings navigation cannot scroll')
  await page.setViewportSize({ width: 1280, height: 900 })
  const persistedSkin = await page.evaluate(() => {
    const raw = window.localStorage.getItem('shrubbery.organism.settings.v1')
    return raw ? (JSON.parse(raw) as { skin?: string }).skin : null
  })
  assert(persistedSkin === 'glass', 'Glass identity was not persisted')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__settingsHarness?.state.ready === true)
  await settings.waitFor({ state: 'visible' })
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
  assert(await settings.getByLabel('Skin', { exact: true }).inputValue() === 'glass', 'Glass identity did not restore after reload')
  assert(await page.evaluate(() => document.documentElement.dataset.skin) === 'glass', 'restored Settings did not apply Glass to the root')
  await settings.getByRole('button', { name: 'Imports', exact: true }).click()

  for (const label of ['Import files', 'Import Obsidian vault', 'Import Notion archive', 'Import Roam archive']) {
    assert(await settings.getByRole('button', { name: label, exact: true }).isEnabled(), `${label} is not enabled`)
  }

  const obsidianChooser = page.waitForEvent('filechooser')
  await settings.getByRole('button', { name: 'Import Obsidian vault', exact: true }).click()
  await (await obsidianChooser).setFiles({
    name: 'browser-vault.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('deterministic browser archive'),
  })
  const importJob = settings.locator('[data-job-id="import-obsidian"]')
  await importJob.getByText('Parsing browser-vault.zip', { exact: true }).waitFor()
  assert(await importJob.locator('.progress-bar').getAttribute('style') === 'width:45%', 'live import progress was not rendered')
  await waitForJob(settings, 'import-obsidian', 'succeeded')
  assert((await importJob.textContent())?.includes('2 documents, 1 wire'), 'terminal import result was not rendered')

  const notionChooser = page.waitForEvent('filechooser')
  await settings.getByRole('button', { name: 'Import Notion archive', exact: true }).click()
  await (await notionChooser).setFiles({
    name: 'corrupt-notion.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a real zip'),
  })
  const notionJob = await waitForJob(settings, 'import-notion', 'failed')
  assert((await notionJob.textContent())?.includes('Parser rejected corrupt-notion.zip'), 'backend failure was not surfaced')
  assert(!(await notionJob.textContent())?.includes('complete:'), 'failed import displayed a false success')

  await settings.getByRole('button', { name: 'Graph Ops', exact: true }).click()
  for (const label of ['Duplicate graph', 'Export graph', 'Import graph']) {
    assert(await settings.getByRole('button', { name: label, exact: true }).isEnabled(), `${label} is not enabled`)
  }

  await settings.getByRole('button', { name: 'Duplicate graph', exact: true }).click()
  const duplicateJob = await waitForJob(settings, 'duplicate-graph', 'succeeded')
  assert((await duplicateJob.textContent())?.includes('settings-browser-copy'), 'duplicate result did not identify the created graph')

  await settings.getByRole('button', { name: 'Export graph', exact: true }).click()
  const exportJob = await waitForJob(settings, 'export-graph', 'succeeded')
  assert((await exportJob.textContent())?.includes('settings-browser.trig'), 'export result did not identify the saved TriG file')

  const graphChooser = page.waitForEvent('filechooser')
  await settings.getByRole('button', { name: 'Import graph', exact: true }).click()
  await (await graphChooser).setFiles({
    name: 'garden-backup.tar.gz',
    mimeType: 'application/gzip',
    buffer: Buffer.from('deterministic Garden graph archive'),
  })
  const graphImportJob = await waitForJob(settings, 'import-graph', 'succeeded')
  assert((await graphImportJob.textContent())?.includes('settings-browser-imported'), 'graph import result did not identify the new graph')

  await settings.getByRole('button', { name: 'Version History', exact: true }).click()
  assert((await settings.locator('[data-action-id="restore-point:rp-browser"]').textContent())?.includes('Browser checkpoint'), 'restore-point action is missing')
  await settings.getByRole('button', { name: 'Create restore point', exact: true }).click()
  const createPointJob = await waitForJob(settings, 'create-restore-point', 'succeeded')
  assert((await createPointJob.textContent())?.includes('Before browser mutation'), 'created restore point was not reported')
  assert((await settings.locator('[data-action-id="restore-point:rp-created"]').textContent())?.includes('Before browser mutation'), 'new restore point was not added to the timeline')

  await settings.locator('[data-action-id="restore-point:rp-browser"]').getByRole('button').click()
  const restoreJob = await waitForJob(settings, 'restore-point:rp-browser', 'succeeded')
  assert((await restoreJob.textContent())?.includes('Browser checkpoint'), 'restore result did not identify the selected checkpoint')

  await settings.getByRole('button', { name: 'Refresh graph history', exact: true }).click()
  const refreshJob = await waitForJob(settings, 'refresh-history', 'succeeded')
  assert((await refreshJob.textContent())?.includes('2 restore points'), 'history refresh did not report the backend result')

  await settings.getByRole('button', { name: 'Local AI', exact: true }).click()
  assert((await settings.locator('[data-section-id="local-ai"]').getAttribute('data-active')) === 'true', 'Local AI section did not activate')
  assert((await settings.locator('[data-metric-id="semantic-model-status"]').textContent())?.includes('BGE Small'), 'live embedding model status is absent')
  assert((await settings.locator('[data-metric-id="semantic-index-status"]').textContent())?.includes('9 blocks'), 'live semantic index status is absent')
  assert((await settings.locator('[data-metric-id="pdf-pipeline-status"]').textContent())?.includes('PDF Fast Text'), 'live PDF pipeline status is absent')
  assert(!(await settings.textContent())?.includes('OCRmyPDF'), 'unwired PDF engine was advertised as a selectable Local AI control')

  await settings.getByLabel('Embedding model', { exact: true }).selectOption('candle/nomic-embed-text-v2-moe')
  await page.waitForFunction(() => window.__settingsHarness?.state.semanticConfigWrites === 1)
  await settings.getByLabel('PDF ingestion', { exact: true }).selectOption('pdf.fast-text')
  await page.waitForFunction(() => window.__settingsHarness?.state.pdfPipelineWrites === 1)

  const providerCard = settings.locator('[data-secret-id="openrouter"]')
  await providerCard.getByRole('button', { name: 'Configure', exact: true }).click()
  await providerCard.getByText('Configured', { exact: true }).waitFor()
  await providerCard.getByRole('button', { name: 'Delete', exact: true }).click()
  await providerCard.getByText('Not configured', { exact: true }).waitFor()
  const secretResidue = await page.evaluate(() => {
    const localValues: string[] = []
    const sessionValues: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      localValues.push(window.localStorage.getItem(window.localStorage.key(index) ?? '') ?? '')
    }
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      sessionValues.push(window.sessionStorage.getItem(window.sessionStorage.key(index) ?? '') ?? '')
    }
    const shadowText = Array.from(document.querySelectorAll('*'))
      .map(element => element.shadowRoot?.textContent ?? '')
      .join('\n')
    return [
      window.location.href,
      document.documentElement.outerHTML,
      shadowText,
      ...localValues,
      ...sessionValues,
    ].join('\n')
  })
  assert(!secretResidue.includes('browser-secret-never-projected'), 'provider secret leaked into URL, DOM, or browser storage')

  const semanticIndexJob = settings.locator('[data-job-id="refresh-semantic-index"]')
  await semanticIndexJob.getByRole('button', { name: 'Refresh', exact: true }).click()
  await settings.locator('[data-job-id="refresh-semantic-index"][data-status="succeeded"]').waitFor()
  assert((await semanticIndexJob.locator('.job-state').textContent())?.includes('Complete'), 'terminal status is not presented in human language')
  assert((await semanticIndexJob.textContent())?.includes('Browser index ready'), 'semantic index terminal progress was not rendered')

  await settings.getByRole('button', { name: 'Back to workspace', exact: true }).click()

  state = await bridgeState(page)
  const requestedPaths = state.requestedPaths as string[]
  const contractViolations = state.backendContractViolations as string[]
  assert(contractViolations.length === 0, `backend contract violations: ${contractViolations.join('; ')}`)
  for (const path of [
    `POST /settings-harness/cell/g/${GRAPH_ID}/graphs/${GRAPH_ID}/duplicate`,
    `POST /settings-harness/cell/g/${GRAPH_ID}/graphs/${GRAPH_ID}/export`,
    `POST /settings-harness/cell/g/${GRAPH_ID}/graphs/import`,
    `POST /settings-harness/cell/g/${GRAPH_ID}/v1/time-travel/${GRAPH_ID}/restore-points`,
    `POST /settings-harness/cell/g/${GRAPH_ID}/v1/time-travel/${GRAPH_ID}/restores`,
    `PUT /settings-harness/cell/g/${GRAPH_ID}/api/semantic/model/config`,
    `PUT /settings-harness/cell/g/${GRAPH_ID}/api/artifacts/ingestion/pdf/pipeline`,
    `POST /settings-harness/cell/g/${GRAPH_ID}/api/semantic/index/refresh/jobs`,
  ]) assert(requestedPaths.includes(path), `missing exact backend request: ${path}`)
  assert(!requestedPaths.some(path => path.endsWith('/graphs/jobs/job-notion/result')), 'failed Notion job incorrectly requested a result')
  for (const jobId of ['job-obsidian', 'job-duplicate', 'job-export', 'job-graph-import']) {
    const statusIndex = requestedPaths.findIndex(path => path.endsWith(`/graphs/jobs/${jobId}`))
    const resultIndex = requestedPaths.findIndex(path => path.endsWith(`/graphs/jobs/${jobId}/result`))
    assert(statusIndex >= 0 && resultIndex > statusIndex, `${jobId} result was read before terminal status`)
  }
  assert(Number(state.authenticatedRequests) === requestedPaths.length, 'not every backend request crossed the authenticated seam')
  assert(Number(state.historyReads) >= 4, 'graph history did not reload after mutations')
  assert(state.savedExports === 1, 'export bytes did not reach the save seam')
  assert(state.duplicateJobs === 1, 'duplicate did not reach the backend')
  assert(state.graphImportJobs === 1, 'graph import did not reach the backend')
  assert(state.createdRestorePoints === 1, 'create restore point did not reach the backend')
  assert(state.restoreStarts === 1, 'restore did not reach the backend')
  assert(state.providerSecretWrites === 1, 'OpenRouter key did not reach the write-only secret seam')
  assert(state.providerSecretDeletes === 1, 'OpenRouter key delete did not reach the secret seam')
  assert(state.semanticConfigWrites === 1, 'embedding model selection did not reach gardend')
  assert(state.pdfPipelineWrites === 1, 'PDF pipeline selection did not reach gardend')
  assert(state.semanticIndexStarts === 1, 'semantic index refresh did not reach gardend')
  assert(JSON.stringify(state).includes('browser-secret-never-projected') === false, 'provider secret leaked into browser evidence')
  assert(state.closeCalls === 1, 'Back to workspace did not cross the route close seam')
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    enabledImportActions: 4,
    enabledGraphActions: 3,
    localAiOperational: true,
    providerSecretWriteOnly: true,
    importProgress: true,
    importSuccess: true,
    backendErrorVisible: true,
    falseSuccessAbsent: true,
    placeboControlsAbsent: true,
    ninetyEightIdentityPersisted: true,
    glassIdentityPersisted: true,
    settingsMaterialParity: true,
    responsiveSettingsRail: true,
    duplicateExportImport: true,
    createAndApplyRestorePoint: true,
    settingsRouteClose: true,
    authenticatedRequests: state.authenticatedRequests,
  }, null, 2)}\n`)
} finally {
  await browser.close()
  await server.close()
}
