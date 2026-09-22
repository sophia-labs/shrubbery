import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.SHRUBBERY_ACCESS_BROWSER_PORT ?? 0)
const headed = process.env.SHRUBBERY_ACCESS_BROWSER_HEADED === '1'
const slowMo = Number(process.env.SHRUBBERY_ACCESS_BROWSER_SLOW_MO ?? (headed ? 150 : 0))

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`hosted-access-browser-harness assertion failed: ${message}`)
}

async function bridgeState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __accessHarness?: { state: Record<string, unknown> } }).__accessHarness
    if (!bridge) throw new Error('window.__accessHarness is unavailable')
    return bridge.state
  })
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
if (!port) throw new Error('Hosted access browser harness could not resolve its Vite port')

const browser = await chromium.launch({ headless: !headed, slowMo: Number.isFinite(slowMo) ? slowMo : 0 })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`http://127.0.0.1:${port}/access-browser-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const state = (window as unknown as { __accessHarness?: { state: { ready?: boolean; error?: string | null } } }).__accessHarness?.state
    return state?.ready === true || Boolean(state?.error)
  })
  let state = await bridgeState(page)
  assert(state.error == null, `boot error: ${String(state.error)}`)

  const access = page.locator('mn-access-manager')
  await access.waitFor({ state: 'visible' })
  await access.getByRole('button', { name: 'Manage workspace access', exact: true }).click()
  await access.getByRole('dialog', { name: 'Workspace access', exact: true }).waitFor()
  await access.locator('[data-user-id="owner-1"]').waitFor()
  await access.locator('[data-user-id="editor-2"]').waitFor()
  assert(await access.locator('[data-user-id="owner-1"] select').count() === 0, 'owner row exposed a role mutation')
  assert(await access.locator('[data-user-id="owner-1"] .remove').count() === 0, 'owner row exposed removal')
  assert(await access.getByRole('button', { name: 'Link', exact: true }).count() === 0, 'fabricated public-link tab was rendered')
  assert((await access.locator('.capability-note').textContent())?.includes('gateway does not expose share-token creation or revocation'), 'share-token backend gap was not disclosed')

  const userId = access.getByLabel('Member user ID', { exact: true })
  const addRole = access.locator('[name="access-role"]')
  await userId.fill('denied-user')
  await addRole.selectOption('viewer')
  await access.getByRole('button', { name: 'Add member', exact: true }).click()
  await access.getByRole('alert').getByText('Only the workspace owner can manage member access.', { exact: true }).waitFor()
  assert(await access.locator('[data-user-id="denied-user"]').count() === 0, 'denied add was painted as success')

  await userId.fill('viewer/3')
  await access.locator('[name="access-email"]').fill('viewer@example.test')
  await access.locator('[name="access-display-name"]').fill('Viv Viewer')
  await addRole.selectOption('viewer')
  await access.getByRole('button', { name: 'Add member', exact: true }).click()
  const viewerRow = access.locator('[data-user-id="viewer/3"]')
  await viewerRow.waitFor()
  await access.getByText('Added Viv Viewer as viewer.', { exact: true }).waitFor()
  assert((await viewerRow.textContent())?.includes('viewer@example.test'), 'added member metadata was not projected')

  await access.getByLabel('Role for Viv Viewer', { exact: true }).selectOption('editor')
  await access.getByText('Updated Viv Viewer to editor.', { exact: true }).waitFor()
  assert(await access.getByLabel('Role for Viv Viewer', { exact: true }).inputValue() === 'editor', 'role update did not survive authoritative reload')

  await access.getByRole('button', { name: 'Remove Viv Viewer', exact: true }).click()
  let confirmation = page.getByRole('alertdialog', { name: 'Remove Viv Viewer?', exact: true })
  await confirmation.waitFor()
  assert((await confirmation.textContent())?.includes('immediately lose editor access'), 'removal confirmation omitted impact')
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await confirmation.waitFor({ state: 'detached' })
  assert(await viewerRow.count() === 1, 'cancelled removal changed the member list')
  state = await bridgeState(page)
  assert(!(state.requestedRoutes as string[]).some(route => route.startsWith('DELETE ')), 'cancelled removal reached DELETE')

  // The modal is intentionally outside the popover, so its pointer interaction
  // closes the underlying access panel. Re-open it before the second attempt.
  await access.getByRole('button', { name: 'Manage workspace access', exact: true }).click()
  await viewerRow.waitFor()
  await access.getByRole('button', { name: 'Remove Viv Viewer', exact: true }).click()
  confirmation = page.getByRole('alertdialog', { name: 'Remove Viv Viewer?', exact: true })
  await confirmation.waitFor()
  await confirmation.getByRole('button', { name: 'Remove member', exact: true }).click()
  await viewerRow.waitFor({ state: 'detached' })
  await access.getByRole('button', { name: 'Manage workspace access', exact: true }).click()
  await access.getByText('Removed Viv Viewer.', { exact: true }).waitFor()

  state = await bridgeState(page)
  const routes = state.requestedRoutes as string[]
  assert(routes.filter(route => route.startsWith('GET ')).length >= 4, 'authoritative member list was not re-read after mutations')
  assert(routes.filter(route => route.startsWith('PUT ')).length === 3, 'unexpected PUT count')
  assert(routes.filter(route => route.startsWith('DELETE ')).length === 1, 'confirmed removal did not issue exactly one DELETE')
  assert(Number(state.authenticatedRequests) === routes.length, 'a request bypassed bearer authentication')
  assert(!(state.grants as Array<{ userId: string }>).some(grant => grant.userId === 'viewer/3'), 'removed grant remains in backend state')
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    lazyAuthenticatedList: true,
    ownerProtected: true,
    deniedMutationHonest: true,
    addAndAuthoritativeReload: true,
    roleUpdateAndAuthoritativeReload: true,
    removeConfirmationCancel: true,
    removeConfirmationCommit: true,
    publicShareTokenUiAbsent: true,
    authenticatedRequests: state.authenticatedRequests,
    routes,
  }, null, 2)}\n`)
} finally {
  await browser.close()
  await server.close()
}
