/** Actual repository + two browsers; generated files are removed through versioned APIs. */
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const configPath = process.env.DEVELOPMENT_TREE_CONFIG
if (!configPath) throw new Error('Set DEVELOPMENT_TREE_CONFIG to the existing trusted local IDE config.')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const manifest = JSON.parse(await readFile(config.gardenManifest, 'utf8'))
const origin = process.env.DEVELOPMENT_TREE_ORIGIN ?? 'http://127.0.0.1:5190'
const output = process.env.DEVELOPMENT_TREE_OUTPUT ?? '/tmp/pierre-tree-browser'
await mkdir(output, { recursive: true })
const api = async (rift: string, operation: string, args: unknown = {}) => {
  const response = await fetch(`http://127.0.0.1:${config.port}/rifts/${encodeURIComponent(rift)}/ide`, {
    method: 'POST', headers: { Authorization: `Bearer ${manifest.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, args }),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(`${operation}: ${response.status} ${value.error ?? ''}`)
  return value
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const contexts = await Promise.all([browser.newContext({ viewport: { width: 1600, height: 1100 } }), browser.newContext({ viewport: { width: 1600, height: 1100 } })])
const [first, second] = await Promise.all(contexts.map(context => context.newPage()))
const errors: string[] = [], checks: string[] = [], operations: string[] = []
const suffix = randomUUID(), original = `pierre-tree-probe-${suffix}.ts`, renamed = `pierre-tree-renamed-${suffix}.ts`
let alpha = '', beta = '', probeId = ''
let syntheticMs = 0, syntheticRows = 0
const url = `${origin}/choreograph?${new URLSearchParams({ graphId: config.graphId, screen: 'development', development: '1' })}`
const host = (page: Page) => page.locator('wf-development-ide')
const row = (page: Page, path: string) => page.locator(`wf-repository-tree [role="treeitem"][data-item-path=${JSON.stringify(path)}]`)
const state = (page: Page) => host(page).evaluate((element: any) => ({ selectedRiftId: element.state.selectedRiftId, total: element.state.ide.tree.total, tabs: element.state.ide.tabs.map((tab: any) => ({ id: tab.id, path: tab.entry.path, documentId: tab.file?.documentId, error: tab.error })), error: element.state.ide.error }))
const check = (message: string) => { checks.push(message); console.log(`PASS ${message}`) }
async function waitFor(check: () => Promise<boolean>, label: string, timeout = 30000) {
  const end = Date.now() + timeout
  do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)) } while (Date.now() < end)
  throw new Error(`Timed out: ${label}`)
}
async function openFile(page: Page, path: string) {
  await page.getByRole('textbox', { name: 'Filter repository files' }).fill(path)
  await waitFor(async () => host(page).evaluate((element: any, query: string) => element.state.ide.filter === query, path), 'applied explorer filter')
  await waitFor(async () => page.locator('wf-repository-tree').evaluate((element: any, query: string) => element.filter === query && element.tree?.getSearchValue() === query.toLowerCase(), path), 'rendered explorer filter')
  await row(page, path).click({ timeout: 30000 })
  await page.locator('sh-development-code-editor .cm-content').waitFor({ timeout: 45000 })
  await waitFor(async () => {
    const current = await state(page)
    if (current.error) throw new Error(`Opening ${path}: ${current.error}`)
    return current.tabs.some((tab: any) => tab.path === path && tab.documentId)
  }, `open ${path}`)
}
async function renameThroughUi(page: Page, path: string) {
  await page.getByRole('button', { name: /^Rename file/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Rename file', exact: true })
  await dialog.getByRole('textbox', { name: 'File path' }).fill(path)
  await dialog.getByRole('button', { name: 'Rename file', exact: true }).click()
}
for (const page of [first!, second!]) page.on('pageerror', error => errors.push(error.message))
first!.on('request', request => {
  if (request.url().endsWith('/ide')) {
    try { operations.push(request.postDataJSON().operation) } catch { /* not an IDE operation */ }
  }
})
try {
  await Promise.all([first!.goto(url), second!.goto(url)])
  await waitFor(async () => await host(first!).count() > 0 && (await state(first!)).total > 1900, 'complete Shrubbery metadata')
  await waitFor(async () => await host(second!).count() > 0 && (await state(second!)).total > 1900, 'second complete tree')
  alpha = (await state(first!)).selectedRiftId
  beta = await first!.getByRole('combobox', { name: 'Working Rift' }).locator('option').evaluateAll((options: any[], active: string) => options.find(option => option.value !== active)?.value, alpha)
  assert.ok(alpha && beta)
  assert.equal(operations.filter(operation => operation === 'open').length, 0)
  assert.ok(await first!.locator('wf-repository-tree [role=treeitem]').count() < 120)
  assert.equal(await first!.locator('wf-repository-tree [role=tree]').getAttribute('aria-label'), 'Repository files')
  check('actual complete Shrubbery metadata; bounded DOM; no eager document opens')

  const apps = row(first!, 'apps/')
  await apps.focus(); await first!.keyboard.press('ArrowLeft')
  await waitFor(async () => await apps.getAttribute('aria-expanded') === 'false', 'keyboard collapse')
  await first!.keyboard.press('ArrowRight')
  await waitFor(async () => await apps.getAttribute('aria-expanded') === 'true', 'keyboard expand')
  await first!.keyboard.press('End')
  await waitFor(async () => await first!.locator('wf-repository-tree [role=treeitem][tabindex="0"]').count() === 1, 'keyboard end focus')
  await first!.keyboard.press('Home')
  check('ArrowLeft/ArrowRight expansion; Home/End navigation; ARIA tree metadata')

  await openFile(first!, 'README.md')
  const editor = first!.locator('sh-development-code-editor .cm-content').first()
  assert.ok((await editor.innerText()).length > 100)
  await editor.focus()
  await first!.getByRole('button', { name: 'Refresh files', exact: true }).click()
  await editor.focus()
  // Cross a background metadata refresh without moving editor focus to the tree.
  await first!.waitForTimeout(7500)
  assert.equal(await editor.evaluate(element => element.getRootNode() instanceof ShadowRoot && (element.getRootNode() as ShadowRoot).activeElement === element), true)
  await first!.keyboard.press('Control+p')
  await first!.getByRole('textbox', { name: 'Quick open file' }).waitFor()
  await first!.keyboard.press('Escape')
  check('lazy Garden/CodeMirror open; editor focus survives metadata refresh; quick-open shortcut')

  const before = await api(alpha, 'files', { limit: 25000 })
  await api(alpha, 'create-file', { path: original, text: 'export const pierreTreeProbe = 1\n' })
  const probe = (await api(alpha, 'files', { prefix: original, limit: 10 })).files.find((file: any) => file.path === original)
  probeId = probe.fileId
  for (const page of [first!, second!]) {
    await page.getByRole('button', { name: 'Refresh files', exact: true }).click()
    await waitFor(async () => (await state(page)).total === before.total + 1, 'created file metadata')
    await openFile(page, original)
  }
  const documentId = (await state(second!)).tabs.find((tab: any) => tab.id === probeId).documentId
  await second!.locator('sh-development-code-editor .cm-content').last().focus()
  await renameThroughUi(first!, renamed)
  await waitFor(async () => (await state(first!)).tabs.some((tab: any) => tab.id === probeId && tab.path === renamed && !tab.error), 'accepted rename')
  await waitFor(async () => (await state(second!)).tabs.some((tab: any) => tab.id === probeId && tab.path === renamed && tab.documentId === documentId && !tab.error), 'remote rename on same shared document')
  assert.equal(await second!.locator('sh-development-code-editor .cm-content').last().evaluate(element => element.getRootNode() instanceof ShadowRoot && (element.getRootNode() as ShadowRoot).activeElement === element), true)
  assert.equal(await api(beta, 'files', { query: suffix, limit: 10 }).then(result => result.total), 0)
  check('accepted versioned rename; second browser follows stable file/document ID; sibling Rift unchanged')

  await renameThroughUi(first!, 'README.md')
  await waitFor(async () => !!(await state(first!)).error, 'collision refusal')
  assert.equal((await state(first!)).tabs.find((tab: any) => tab.id === probeId).path, renamed)
  assert.ok((await api(alpha, 'files', { prefix: renamed, limit: 10 })).files.some((file: any) => file.fileId === probeId && file.path === renamed))
  check('server-refused rename keeps original accepted path and document identity')

  await first!.getByRole('combobox', { name: 'Working Rift' }).selectOption(beta)
  await waitFor(async () => await host(first!).count() > 0 && (await state(first!)).selectedRiftId === beta && (await state(first!)).total > 1900, 'Beta tree')
  assert.equal((await state(first!)).tabs.length, 0)
  assert.equal(await first!.locator('wf-repository-tree file-tree-container').count(), 1)
  await first!.getByRole('textbox', { name: 'Filter repository files' }).fill(suffix)
  await first!.locator('wf-repository-tree').getByRole('status').filter({ hasText: 'No matching files' }).waitFor()
  assert.equal(await first!.locator('wf-repository-tree [data-item-type="file"][role=treeitem]:visible').count(), 0)
  await first!.getByRole('combobox', { name: 'Working Rift' }).selectOption(alpha)
  await waitFor(async () => await host(first!).count() > 0 && (await state(first!)).selectedRiftId === alpha && (await state(first!)).total === before.total + 1, 'Alpha return')
  await openFile(first!, renamed)
  await first!.screenshot({ path: join(output, 'actual-shrubbery-tree.png') })
  check('Rift switch disposes old view/leases and does not retain other Rift selection')

  const large = await contexts[0]!.newPage()
  await large.goto(url); await large.locator('wf-repository-tree file-tree-container').waitFor()
  syntheticMs = await large.evaluate(async () => {
    const element: any = document.createElement('wf-repository-tree')
    element.riftId = 'synthetic-scale'
    element.files = Array.from({ length: 25000 }, (_, i) => ({ fileId: `id-${i}`, path: `file-${String(i).padStart(5, '0')}.ts`, bytes: 1, mode: '100644', tracked: true, gitStatus: i === 24999 ? ' M' : '', kind: 'text', editable: true, diskVersion: 'fixture' }))
    element.style.cssText = 'display:block;height:600px;width:350px'
    const start = performance.now(); document.body.replaceChildren(element)
    await element.updateComplete
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    return performance.now() - start
  })
  await large.locator('wf-repository-tree [role=treeitem]').first().waitFor()
  syntheticRows = await large.locator('wf-repository-tree [role=treeitem]').count()
  assert.ok(syntheticRows > 0 && syntheticRows < 100)
  await large.locator('wf-repository-tree [role=treeitem]').first().focus()
  await large.keyboard.press('End')
  await row(large, 'file-24999.ts').waitFor()
  assert.equal(await row(large, 'file-24999.ts').getAttribute('data-item-git-status'), 'modified')
  assert.equal(await row(large, 'file-24999.ts').getAttribute('aria-setsize'), '25000')
  await large.screenshot({ path: join(output, '25000-files.png') })
  await large.close()
  check('25,000-file real browser render; bounded rows; keyboard reaches final file; Git badge')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ observedAt: new Date().toISOString(), origin, graphId: config.graphId, alpha, beta, checks, pageErrors: errors, synthetic: { files: 25000, mountedRows: syntheticRows, mountMs: Math.round(syntheticMs) } }, null, 2) + '\n')
  console.log(JSON.stringify({ checks: checks.length, pageErrors: errors.length, output, syntheticMs: Math.round(syntheticMs), syntheticRows }))
} catch (error) {
  await first!.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  console.error(JSON.stringify({ first: await state(first!).catch(() => null), second: await state(second!).catch(() => null), pageErrors: errors }))
  throw error
} finally {
  await browser.close()
  if (alpha) {
    const current = (await api(alpha, 'files', { query: suffix, limit: 10 })).files.filter((file: any) => file.path === original || file.path === renamed)
    for (const file of current) await api(alpha, 'delete-file', { path: file.path, expectedDiskVersion: file.diskVersion })
  }
}
