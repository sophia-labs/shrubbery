/**
 * Focused real-Chromium journey for imported-document fidelity.
 *
 * Uses the same deterministic in-memory cell contract as the full browser
 * harness, but keeps this acceptance lane independent so broader editor work can
 * evolve without masking the read-only/source-file invariants.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_IMPORTED_DOCUMENT_PORT ?? 5198)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`imported-document browser assertion failed: ${message}`)
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true },
  logLevel: 'warn',
})
await server.listen()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const pageErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))

try {
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'commit' })
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { ready?: boolean; error?: string | null } }
    }).__organism
    return bridge?.state.ready === true || Boolean(bridge?.state.error)
  }, undefined, { timeout: 60_000 })

  const bootError = await page.evaluate(() => (window as unknown as {
    __organism?: { state: { error?: string | null } }
  }).__organism?.state.error)
  assert(!bootError, `boot failed: ${String(bootError)}`)

  await page.locator('mn-home-view [data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => (window as unknown as {
    __organism?: { state: { activeDocumentId?: string | null; activeDocumentReadOnly?: boolean } }
  }).__organism?.state.activeDocumentId === 'architecture')

  await page.waitForFunction(() => {
    const host = document.querySelector('#mn-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    return Boolean(host?.liveEditor && host.shadowRoot?.querySelector('.ProseMirror'))
  })
  await page.evaluate(() => {
    const host = document.querySelector('#mn-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    ;(window as unknown as { __importedIdentity?: Record<string, unknown> }).__importedIdentity = {
      host,
      editor: host?.liveEditor ?? null,
      proseMirror: host?.shadowRoot?.querySelector('.ProseMirror') ?? null,
    }
  })

  const host = page.locator('sh-editor-host')
  const proseMirror = host.locator('.ProseMirror')
  assert(await proseMirror.getAttribute('contenteditable') === 'false', 'imported document accepted typing')
  const readOnlyText = await page.evaluate(() => (window as unknown as {
    __organism?: { state: { editorText?: string } }
  }).__organism?.state.editorText ?? '')
  await proseMirror.locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' READ_ONLY_WRITE_MUST_NOT_LAND')
  assert(await page.evaluate(() => (window as unknown as {
    __organism?: { state: { editorText?: string } }
  }).__organism?.state.editorText ?? '') === readOnlyText, 'keyboard input changed a read-only CRDT document')
  await page.locator('mn-editor-toolbar [data-read-only-badge]').waitFor({ state: 'visible' })
  assert(await page.locator('mn-editor-toolbar [data-original-view-toggle]').count() === 1,
    'persisted source metadata did not expose View Original')

  await page.locator('mn-editor-toolbar [data-original-view-toggle] button').click()
  const viewer = host.locator('mn-original-viewer')
  await viewer.locator('.source-pre').waitFor({ state: 'visible' })
  assert((await viewer.locator('.source-pre').textContent())?.includes('authenticated original-file fixture'),
    'authenticated original bytes were not rendered')
  await page.locator('mn-editor-toolbar [data-original-view-toggle] button').click()

  await page.locator('mn-editor-toolbar [data-make-editable] button').click()
  await page.waitForFunction(() => {
    const state = (window as unknown as {
      __organism?: { state: { activeDocumentReadOnly?: boolean; makeEditableStatus?: string } }
    }).__organism?.state
    const host = document.querySelector('#mn-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const saved = (window as unknown as { __importedIdentity?: Record<string, unknown> }).__importedIdentity
    return state?.activeDocumentReadOnly === false
      && state.makeEditableStatus === 'idle'
      && host?.shadowRoot?.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'true'
      && saved?.host === host
      && saved?.editor === host?.liveEditor
      && saved?.proseMirror === host?.shadowRoot?.querySelector('.ProseMirror')
  })
  assert(await page.locator('mn-editor-toolbar [data-read-only-badge]').count() === 0,
    'read-only toolbar survived successful authority mutation')
  assert(await page.locator('mn-editor-toolbar [data-original-view-toggle]').count() === 1,
    'making editable incorrectly discarded original-source metadata')
  await proseMirror.locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' EDITABLE_WRITE_LANDED')
  await page.waitForFunction(() => (window as unknown as {
    __organism?: { state: { editorText?: string } }
  }).__organism?.state.editorText?.includes('EDITABLE_WRITE_LANDED') === true)

  await page.locator('mn-sidebar-panel [data-node-id="research-notes"]').click()
  await page.waitForFunction(() => (window as unknown as {
    __organism?: { state: { activeDocumentId?: string | null } }
  }).__organism?.state.activeDocumentId === 'research-notes')
  assert(await page.locator('mn-editor-toolbar [data-original-view-toggle]').count() === 0,
    'source metadata leaked to an ordinary document')
  assert(await proseMirror.getAttribute('contenteditable') === 'true',
    'read-only state leaked to an ordinary document')
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    importedReadOnly: true,
    authenticatedOriginal: true,
    madeEditableThroughAuthority: true,
    editorIdentityPreserved: true,
    metadataIsolation: true,
  }, null, 2)}\n`)
} finally {
  await browser.close()
  await server.close()
}
