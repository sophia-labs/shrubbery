/**
 * right-panel-launch-browser.mts — does the right rail honour its launch
 * preference, and still yield to an explicit request?
 *
 * WHY THIS IS A BROWSER TEST AND CANNOT BE A UNIT TEST. The behaviour exists
 * only at boot. `currentRightPanel` is decided once, while the module is
 * evaluating, from three things that all live outside the function under test:
 * a localStorage preference, a sessionStorage panel layout, and the URL. There
 * is no seam to call. A unit test could only re-implement the decision and then
 * agree with itself.
 *
 * WHY THE PREFERENCE EXISTS AT ALL. The panel layout is kept in SESSION
 * storage, so the rail's collapsed state dies with the window and every launch
 * restores the default open rail. Closing it is not a thing you do once; it is
 * a thing you do every time you open Garden. The preference is the only place
 * that fact can survive.
 *
 * Three cases, because the interesting one is the third:
 *
 *   1. preference absent        -> rail opens (nobody's behaviour changes)
 *   2. preference false         -> rail stays closed
 *   3. preference false + ?r=   -> rail OPENS anyway
 *
 * Case 3 is the one worth writing down. A link that names a panel is a request
 * about this navigation, and a launch default has no business overruling it —
 * if it did, every "open the inspector on this document" link would silently
 * stop working for anyone who turned the rail off, which is the kind of
 * breakage that gets blamed on the link.
 *
 *   pnpm -C apps/organism run test:right-panel-launch
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_RIGHT_PANEL_PORT ?? 5268)
const GRAPH_ID = 'right-panel-launch-probe'
/** The key `settings-service.ts` persists to. */
const SETTINGS_KEY = 'shrubbery.organism.settings.v1'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`right-panel-launch-browser assertion failed: ${message}`)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real gardend binary at ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'right panel launch probe' })
  await mcp.toolsCall('create_document', {
    graphId: GRAPH_ID,
    documentId: 'probe-doc',
    title: 'Right panel probe',
  })

  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }, null, 2))

  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()

  browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })

  /**
   * Boot the shell with a given preference and read what the rail did.
   *
   * A FRESH CONTEXT PER CASE, deliberately. The decision is made once while the
   * module evaluates, so a reload in a warm context would not re-run it against
   * the new preference, and every case after the first would be measuring the
   * first one's answer.
   */
  const bootWith = async (
    preference: Record<string, unknown> | null,
    search = '',
  ): Promise<{ rightPanelPresent: boolean; rightPanelMode: string | null }> => {
    const context = await browser!.newContext({ viewport: { width: 1512, height: 944 } })
    const page = await context.newPage()
    // Seed storage on the ORIGIN before the app's module ever runs. `goto` first
    // would already have booted the shell with the wrong preference.
    await page.addInitScript(
      ([key, value]) => {
        try {
          if (value === null) globalThis.localStorage.removeItem(key)
          else globalThis.localStorage.setItem(key, value)
        } catch {
          // A context that refuses storage still exercises the default path.
        }
      },
      [SETTINGS_KEY, preference === null ? null : JSON.stringify(preference)] as const,
    )
    await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}${search}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
    await page.waitForTimeout(2500)

    const measured = await page.evaluate(() => {
      const host = document.querySelector('#host')
      const complementary = host?.querySelector('[role="complementary"]') as HTMLElement | null
      return {
        // The rail is a real box or it is not there. Measure the box; a present
        // element with no width is not an open panel.
        rightPanelPresent: !!complementary && complementary.getBoundingClientRect().width > 0,
        rightPanelMode: document.documentElement.dataset.rightPanel ?? null,
      }
    })
    await context.close()
    return measured
  }

  const openByDefault = await bootWith(null)
  console.log('no preference stored      :', JSON.stringify(openByDefault))
  assert(
    openByDefault.rightPanelPresent,
    `with no preference the rail opens, as it always has: ${JSON.stringify(openByDefault)}`,
  )

  const closed = await bootWith({ rightPanelOnLaunch: false })
  console.log('rightPanelOnLaunch=false  :', JSON.stringify(closed))
  assert(
    !closed.rightPanelPresent,
    `the launch preference keeps the rail closed: ${JSON.stringify(closed)}`,
  )

  const urlWins = await bootWith({ rightPanelOnLaunch: false }, '?r=inspector')
  console.log('…=false but ?r=inspector  :', JSON.stringify(urlWins))
  assert(
    urlWins.rightPanelPresent,
    `an explicit ?r= still opens the rail over the launch preference: ${JSON.stringify(urlWins)}`,
  )

  console.log('\nThe rail opens by default, stays shut when asked to, and still')
  console.log('answers a link that names a panel.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
