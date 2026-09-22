/**
 * Focused real-browser proof for Shrubbery's controlled adaptive projection.
 *
 * Set SHRUBBERY_HEADED=1 (and optionally SHRUBBERY_SLOW_MO=150) to watch the
 * same journey. The backend is the browser harness's deterministic in-memory
 * cell contract; user behavior is driven through Chromium DOM events.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_MOBILE_HARNESS_PORT ?? 5199)
const headed = process.env.SHRUBBERY_HEADED === '1'
const slowMo = Number(process.env.SHRUBBERY_SLOW_MO ?? (headed ? 100 : 0))
const indexSource = await readFile(resolve(appDir, 'index.html'), 'utf8')
const checkpointDir = process.env.SHRUBBERY_MOBILE_CHECKPOINT_DIR
if (checkpointDir) await mkdir(checkpointDir, { recursive: true })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`mobile-parity-browser assertion failed: ${message}`)
}

async function state(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { state: Record<string, unknown> }
    }).__organism
    if (!bridge) throw new Error('window.__organism is unavailable')
    return bridge.state
  })
}

async function dispatchEdgeSwipe(page: Page, startX: number, endX: number): Promise<void> {
  await page.locator('.organism-mobile-shell[data-active="true"]').evaluate(
    (portal, points) => {
      const start = new Event('touchstart', { bubbles: true, composed: true })
      Object.defineProperty(start, 'touches', {
        configurable: true,
        value: [{ clientX: points.startX, clientY: 120 }],
      })
      Object.defineProperty(start, 'changedTouches', { configurable: true, value: [] })
      portal.dispatchEvent(start)
      const end = new Event('touchend', { bubbles: true, composed: true })
      Object.defineProperty(end, 'touches', { configurable: true, value: [] })
      Object.defineProperty(end, 'changedTouches', {
        configurable: true,
        value: [{ clientX: points.endX, clientY: 120 }],
      })
      portal.dispatchEvent(end)
    },
    { startX, endX },
  )
}

async function waitForDestination(page: Page, label: 'Home' | 'Browse' | 'Sophia'): Promise<void> {
  const selector = '.organism-mobile-shell[data-active="true"] > mn-mobile-tabs'
  await page.waitForFunction((expected) => {
    const tabs = document.querySelector(
      '.organism-mobile-shell[data-active="true"] > mn-mobile-tabs',
    )
    const current = tabs?.shadowRoot?.querySelector('button[aria-current="page"]')
    return current?.textContent?.trim() === expected
  }, label)
  await page.locator(selector).evaluate(async (tabs) => {
    // Let style recalc instantiate transitions before asking the Web Animations
    // API for their completion; otherwise screenshots can retain the prior root.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await Promise.all(tabs.getAnimations({ subtree: true }).map(animation =>
      animation.finished.catch(() => undefined)))
  })
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true },
  logLevel: 'warn',
})

await server.listen()
const browser = await chromium.launch({ headless: !headed, slowMo })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { ready?: boolean; error?: string | null } }
    }).__organism
    return bridge?.state.ready === true || Boolean(bridge?.state.error)
  }, undefined, { timeout: 60_000 })
  const initialState = await state(page)
  assert(initialState.error == null, `boot error: ${String(initialState.error)}`)

  const desktopHome = page.locator('.app-container mn-home-view')
  await desktopHome.locator('button.resume').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { activeDocumentId?: string } }
    }).__organism
    return bridge?.state.activeDocumentId === 'research-notes'
  })
  await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileParityIdentity?: { editor: Element | null; chat: Element | null }
    }
    scope.__mobileParityIdentity = {
      editor: document.querySelector('#mn-editor-host'),
      chat: document.querySelector('sh-chat-host'),
    }
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobile?: boolean; mobileCenterMode?: string } }
    }).__organism
    return bridge?.state.mobile === true && bridge.state.mobileCenterMode === 'document'
  })
  const mobileShell = page.locator('.organism-mobile-shell[data-active="true"]')
  const tabs = mobileShell.locator('mn-mobile-tabs button')
  await tabs.first().waitFor({ state: 'visible' })
  assert(await tabs.count() === 3, 'responsive shell did not expose three destinations')
  assert(await tabs.allTextContents().then(labels => labels.map(label => label.trim()).join('|')) === 'Home|Browse|Sophia',
    'primary destinations are not stable Home/Browse/Sophia roots')
  assert(await tabs.evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 48)),
    'a primary destination is smaller than the 48px interaction target')
  const destinationVisibility = await tabs.evaluateAll(buttons => buttons.map((button) => {
    const rect = button.getBoundingClientRect()
    const label = button.querySelector<HTMLElement>('.tab-label')
    const labelRect = label?.getBoundingClientRect()
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const root = button.getRootNode()
    const host = root instanceof ShadowRoot ? root.host : null
    const style = getComputedStyle(button)
    return {
      label: button.textContent?.trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      labelRect: labelRect
        ? { x: labelRect.x, y: labelRect.y, width: labelRect.width, height: labelRect.height }
        : null,
      color: style.color,
      display: style.display,
      opacity: style.opacity,
      visibility: style.visibility,
      top: top?.tagName ?? null,
      owned: top === button
        || Boolean(top && button.contains(top))
        || top === host,
    }
  }))
  assert(destinationVisibility.every(destination =>
    destination.display !== 'none'
    && destination.visibility !== 'hidden'
    && Number(destination.opacity) > 0
    && destination.owned),
  `a primary destination is visually occluded: ${JSON.stringify(destinationVisibility)}`)
  assert(await mobileShell.locator('mn-mobile-tabs nav[aria-label="Primary"]').count() === 1,
    'primary navigation lost its landmark label')
  assert(await mobileShell.locator('mn-mobile-tabs [role="tablist"], mn-mobile-tabs [role="tab"]').count() === 0,
    'destination navigation is incorrectly exposed as an ARIA tab widget')
  assert(indexSource.includes('viewport-fit=cover')
    && indexSource.includes('interactive-widget=resizes-content'),
    'viewport metadata does not opt into safe-area and IME resizing')

  const editorToolbar = page.locator('mn-editor-toolbar')
  const compactEditorActions = editorToolbar.locator(
    '.compact-primary-toolbar mn-icon-button button',
  )
  assert(await compactEditorActions.count() === 5,
    'document detail did not expose the five-action compact editor toolbar')
  assert(await compactEditorActions.evaluateAll(buttons =>
    buttons.every(button => button.getBoundingClientRect().height >= 48)),
  'a compact editor action is smaller than the 48px interaction target')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '00-document-detail.png') })
  }
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { syncState: 'reconnecting' }): void }
    }).__organism
    bridge?.setContinuity({ syncState: 'reconnecting' })
  })
  const documentContinuity = mobileShell.locator(
    '.organism-mobile-continuity mn-continuity-status',
  )
  await documentContinuity.locator('[role="status"]').waitFor({ state: 'visible' })
  assert(await documentContinuity.getAttribute('state') === 'reconnecting',
    'live provider reconnect did not reach mobile document continuity')
  assert(await page.locator('#mn-editor-host').count() === 1,
    'document reconnect replaced the live editor')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '00-document-reconnecting.png') })
  }
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { syncState: 'error' }): void }
    }).__organism
    bridge?.setContinuity({ syncState: 'error' })
  })
  await documentContinuity.locator('[role="alert"]').waitFor({ state: 'visible' })
  assert(await documentContinuity.getAttribute('state') === 'error',
    'document sync failure did not use the shared continuity state')
  assert(await page.locator('#mn-editor-host').count() === 1,
    'document sync failure replaced the live editor')
  const continuityBox = await mobileShell.locator('.organism-mobile-continuity').boundingBox()
  const toolbarBox = await editorToolbar.boundingBox()
  const continuityGeometry = continuityBox && toolbarBox
    ? { continuityBottom: continuityBox.y + continuityBox.height, toolbarTop: toolbarBox.y }
    : null
  assert(Boolean(continuityGeometry
    && continuityGeometry.toolbarTop >= continuityGeometry.continuityBottom - 0.5),
  `document continuity overlaps the editor toolbar: ${JSON.stringify(continuityGeometry)}`)
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '00-document-sync-error.png') })
  }
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { syncState: 'synced' }): void }
    }).__organism
    bridge?.setContinuity({ syncState: 'synced' })
  })
  await documentContinuity.locator('[role]').waitFor({ state: 'detached' })
  const moreFormatting = editorToolbar.locator('[data-compact-tools-toggle] button')
  await moreFormatting.click()
  const formattingSheet = editorToolbar.locator(
    '#mn-editor-more-tools[role="dialog"][aria-modal="true"]',
  )
  await formattingSheet.waitFor({ state: 'visible' })
  assert(await tabs.first().isHidden(),
    'primary navigation remained interactive above the formatting modal')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '00-formatting-sheet.png') })
  }
  await page.keyboard.press('Escape')
  assert(await editorToolbar.locator('#mn-editor-more-tools[role="dialog"]').count() === 0,
    'Escape did not dismiss the compact formatting sheet')
  assert(await editorToolbar.locator('[data-compact-tools-toggle]').evaluate(control =>
    control.shadowRoot?.activeElement === control.shadowRoot?.querySelector('button')),
  'formatting sheet did not restore focus to More')
  assert(await tabs.first().isVisible(),
    'primary navigation did not return after the formatting modal closed')

  // Retapping the active Home root must not toggle a document into Home.
  await tabs.nth(0).click()
  await waitForDestination(page, 'Home')
  assert((await state(page)).mobileCenterMode === 'document', 'active-root retap changed the detail path')
  await mobileShell.locator('.organism-mobile-back').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobileCenterMode?: string } }
    }).__organism
    return bridge?.state.mobileCenterMode === 'home'
  })
  const mobileHome = mobileShell.locator('.organism-mobile-home[data-visible="true"] mn-home-view')
  await mobileHome.waitFor({ state: 'visible' })
  const chromeGeometry = await mobileShell.evaluate(shell => {
    const top = shell.querySelector('.organism-mobile-top-bar')?.getBoundingClientRect()
    const content = shell.querySelector('.organism-mobile-home[data-visible="true"]')?.getBoundingClientRect()
    const navigation = shell.querySelector('mn-mobile-tabs')?.getBoundingClientRect()
    return top && content && navigation
      ? {
          top: { top: top.top, bottom: top.bottom },
          content: { top: content.top, bottom: content.bottom },
          navigation: { top: navigation.top, bottom: navigation.bottom },
        }
      : null
  })
  assert(Boolean(chromeGeometry
    && chromeGeometry.content.top >= chromeGeometry.top.bottom - 0.5
    && chromeGeometry.content.bottom <= chromeGeometry.navigation.top + 0.5),
  `safe-area skeleton lets chrome overlap the active root: ${JSON.stringify(chromeGeometry)}`)
  assert(await mobileHome.locator('button.new-document').count() === 1, 'mobile home lost New Document')
  assert(await mobileHome.locator('button.dream').count() === 1, 'mobile home lost Dream Journal')
  assert(await mobileHome.locator('mn-daily-note-row').count() === 1, 'mobile home lost the daily note row')
  assert(
    await mobileHome.locator('section[aria-label="Pinned"] [data-document-id="architecture"]').count() === 1,
    'mobile home lost the controlled pinned projection',
  )
  assert(
    await mobileHome.locator('section[aria-label="Recently Opened"] [data-document-id="research-notes"]').count() === 1,
    'mobile home lost the controlled recent projection',
  )
  assert(await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileParityIdentity?: { editor: Element | null; chat: Element | null }
    }
    return scope.__mobileParityIdentity?.editor === document.querySelector('#mn-editor-host')
      && scope.__mobileParityIdentity?.chat === document.querySelector('sh-chat-host')
      && scope.__mobileParityIdentity.editor?.isConnected === true
      && scope.__mobileParityIdentity.chat?.isConnected === true
  }), 'home projection replaced a persistent editor/chat host')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '01-home-root.png') })
  }

  const newDocumentTrigger = mobileHome.locator('button.new-document')
  await newDocumentTrigger.click()
  const newDocumentDialog = page.locator('mn-input-dialog[open] .dialog[role="dialog"]')
  await newDocumentDialog.waitFor({ state: 'visible' })
  assert(await tabs.first().isHidden(),
    'primary navigation remained interactive above the new-document modal')
  assert(await newDocumentDialog.locator('.input, button').evaluateAll(controls =>
    controls.every(control => control.getBoundingClientRect().height >= 48)),
  'a new-document sheet control is smaller than the 48px interaction target')
  assert(await page.locator('mn-input-dialog[open]').evaluate((dialog) => {
    const shell = document.querySelector('.organism-mobile-shell[data-active="true"]')
    return Boolean(shell)
      && Number.parseInt(getComputedStyle(dialog).zIndex, 10)
        > Number.parseInt(getComputedStyle(shell!).zIndex, 10)
  }), 'new-document dialog is not above the adaptive delivery shell')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '01-new-document-sheet.png') })
  }
  await page.keyboard.press('Escape')
  await newDocumentDialog.waitFor({ state: 'hidden' })
  assert(await newDocumentTrigger.evaluate(button =>
    button.getRootNode() instanceof ShadowRoot
      && (button.getRootNode() as ShadowRoot).activeElement === button),
  'new-document sheet did not return focus to its exact Home trigger')
  assert(await tabs.first().isVisible(),
    'primary navigation did not return after the new-document modal closed')

  await mobileHome.locator('section[aria-label="Pinned"] [data-document-id="architecture"] .open').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { activeDocumentId?: string; mobileCenterMode?: string } }
    }).__organism
    return bridge?.state.activeDocumentId === 'architecture'
      && bridge.state.mobileCenterMode === 'document'
  })

  await tabs.nth(1).click()
  await waitForDestination(page, 'Browse')
  const files = mobileShell.locator('mn-mobile-file-list')
  assert(await mobileShell.locator('.organism-mobile-search').isHidden(),
    'Browse root duplicated its own search field in the generic top bar')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-browse-root.png') })
  }
  const retainedBrowseRows = await files.locator('[data-node-id]').count()
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { sidebarStatus: 'disconnected' }): void }
    }).__organism
    bridge?.setContinuity({ sidebarStatus: 'disconnected' })
  })
  await files.locator('mn-continuity-status[state="offline"]').waitFor({ state: 'attached' })
  assert(await files.locator('[data-node-id]').count() === retainedBrowseRows,
    'offline Browse discarded its last useful document projection')
  assert(await files.isVisible(),
    'same-document continuity refresh promoted the Browse root into a hidden detail route')
  const browseRecoveryAction = files.locator(
    'mn-continuity-status[data-scope="content"][state="offline"] button',
  )
  await browseRecoveryAction.waitFor({ state: 'visible' })
  const browseRecoveryHeight = await browseRecoveryAction.evaluate(button =>
    button.getBoundingClientRect().height)
  assert(browseRecoveryHeight >= 48,
    `Browse recovery action is smaller than the shared touch target (${browseRecoveryHeight}px)`)
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-browse-offline.png') })
  }
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { sidebarStatus: 'ready' }): void }
    }).__organism
    bridge?.setContinuity({ sidebarStatus: 'ready' })
  })
  await files.locator('mn-continuity-status[state="ready"]').waitFor({ state: 'attached' })
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { operation: Record<string, unknown> }): void }
    }).__organism
    bridge?.setContinuity({
      operation: {
        id: 'rename-architecture',
        action: 'rename',
        state: 'pending',
        nodeId: 'architecture',
        graphId: 'browser-harness-a',
        label: 'Architecture',
      },
    })
  })
  await files.locator('mn-continuity-status[data-scope="operation"][state="saving"]').waitFor({ state: 'visible' })
  assert(await files.locator('[data-node-id="architecture"]').getAttribute('aria-busy') === 'true',
    'pending gardend operation did not preserve and disable its authoritative row')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-browse-operation-pending.png') })
  }
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { operation: Record<string, unknown> }): void }
    }).__organism
    bridge?.setContinuity({
      operation: {
        id: 'rename-architecture',
        action: 'rename',
        state: 'indeterminate',
        nodeId: 'architecture',
        graphId: 'browser-harness-a',
        label: 'Architecture',
        message: 'Garden may still finish this rename.',
      },
    })
  })
  const operationContinuity = files.locator('mn-continuity-status[data-scope="operation"]')
  await operationContinuity.locator('button').waitFor({ state: 'visible' })
  assert(await operationContinuity.locator('button').textContent() === 'Check files',
    'indeterminate gardend operation offered replay instead of reconciliation')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-browse-operation-indeterminate.png') })
  }
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { setContinuity(input: { operation: null }): void }
    }).__organism
    bridge?.setContinuity({ operation: null })
  })
  await operationContinuity.waitFor({ state: 'detached' })
  await files.locator('[data-action-for="architecture"]').click()
  const fileActionSheet = files.locator('.ctx-sheet[role="dialog"][aria-modal="true"]')
  await fileActionSheet.waitFor({ state: 'visible' })
  assert(await tabs.first().isHidden(),
    'primary navigation remained interactive above the Browse action modal')
  assert(await fileActionSheet.locator('.ctx-item').evaluateAll(buttons =>
    buttons.every(button => button.getBoundingClientRect().height >= 48)),
  'a Browse action-sheet command is smaller than the 48px interaction target')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-browse-action-sheet.png') })
  }
  await files.evaluate((element) => {
    const scope = window as unknown as {
      __mobileParityFileAction?: Record<string, unknown> | null
    }
    scope.__mobileParityFileAction = null
    element.addEventListener('mn-mobile-file-action', (event) => {
      scope.__mobileParityFileAction = {
        ...(event as CustomEvent<Record<string, unknown>>).detail,
      }
    }, { once: true })
  })
  await fileActionSheet.locator('.ctx-item').first().click()
  const renameEditor = files.locator('[data-rename-for="architecture"]')
  await renameEditor.waitFor({ state: 'visible' })
  assert(await tabs.first().isVisible(),
    'primary navigation did not return when the Browse action sheet became inline rename')
  assert(await renameEditor.locator('.rename-input, .rename-action').evaluateAll(controls =>
    controls.every(control => control.getBoundingClientRect().height >= 48)),
  'an inline rename control is smaller than the 48px interaction target')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-browse-inline-rename.png') })
  }
  await renameEditor.locator('.rename-input').fill('  Architecture revised  ')
  await renameEditor.locator('.rename-save').click()
  await renameEditor.waitFor({ state: 'detached' })
  const fileAction = await page.evaluate(() => (
    window as unknown as { __mobileParityFileAction?: Record<string, unknown> | null }
  ).__mobileParityFileAction)
  assert(fileAction?.action === 'rename' && fileAction.proposedLabel === 'Architecture revised',
    `inline rename did not emit a validated host-owned proposal: ${JSON.stringify(fileAction)}`)
  assert(await files.locator('[data-action-for="architecture"]').evaluate(button =>
    button.getRootNode() instanceof ShadowRoot
      && (button.getRootNode() as ShadowRoot).activeElement === button),
  'inline rename did not restore focus to its originating action')

  const architectureActions = files.locator('[data-action-for="architecture"]')
  await architectureActions.click()
  await fileActionSheet.waitFor({ state: 'visible' })
  await fileActionSheet.locator('.ctx-item').nth(1).click()
  const moveDialog = page.locator('mn-folder-picker-dialog[open] .dialog[role="dialog"]')
  await moveDialog.waitFor({ state: 'visible' })
  assert(await tabs.first().isHidden(),
    'primary navigation remained interactive above the move-destination modal')
  assert(await moveDialog.locator('.folder-item, .footer button').evaluateAll(controls =>
    controls.every(control => control.getBoundingClientRect().height >= 48)),
  'a move-destination sheet control is smaller than the 48px interaction target')
  assert(await page.locator('mn-folder-picker-dialog[open]').evaluate((dialog) => {
    const shell = document.querySelector('.organism-mobile-shell[data-active="true"]')
    return Boolean(shell)
      && Number.parseInt(getComputedStyle(dialog).zIndex, 10)
        > Number.parseInt(getComputedStyle(shell!).zIndex, 10)
  }), 'move-destination dialog is not above the adaptive delivery shell')
  await moveDialog.getByRole('option', { name: 'Research' }).click()
  assert(await moveDialog.locator('.confirm-button').isEnabled(),
    'choosing a new destination did not enable explicit confirmation')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-move-destination-sheet.png') })
  }
  await page.keyboard.press('Escape')
  await moveDialog.waitFor({ state: 'hidden' })
  assert(await architectureActions.evaluate(button =>
    button.getRootNode() instanceof ShadowRoot
      && (button.getRootNode() as ShadowRoot).activeElement === button),
  'move-destination sheet did not return focus to the exact Browse trigger')

  await architectureActions.click()
  await fileActionSheet.waitFor({ state: 'visible' })
  await fileActionSheet.locator('.ctx-item[data-destructive="true"]').click()
  const deleteDialog = page.locator('mn-confirmation-dialog[open] [role="alertdialog"]')
  await deleteDialog.waitFor({ state: 'visible' })
  assert(await tabs.first().isHidden(),
    'primary navigation remained interactive above destructive confirmation')
  assert(await deleteDialog.locator('button').evaluateAll(buttons =>
    buttons.every(button => button.getBoundingClientRect().height >= 48)),
  'a destructive-confirmation control is smaller than the 48px interaction target')
  assert((await deleteDialog.textContent())?.includes('This cannot be undone here.'),
    'destructive confirmation lost the named consequence')
  const destructiveColor = await deleteDialog.locator('.confirm-button').evaluate(button =>
    getComputedStyle(button).backgroundColor)
  assert(/rgb\((190, 18, 60|225, 29, 72)\)/.test(destructiveColor),
    `destructive confirmation lost its danger color: ${destructiveColor}`)
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '02-delete-confirmation-sheet.png') })
  }
  await page.keyboard.press('Escape')
  await deleteDialog.waitFor({ state: 'hidden' })
  assert(await architectureActions.evaluate(button =>
    button.getRootNode() instanceof ShadowRoot
      && (button.getRootNode() as ShadowRoot).activeElement === button),
  'destructive confirmation did not return focus to the exact Browse trigger')
  assert(await tabs.first().isVisible(),
    'primary navigation did not return after transactional modals closed')
  await files.locator('.workspace-btn').click()
  await files.locator('[data-graph-id="browser-harness-b"]').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { graphId?: string; mobileTab?: string; mobileCenterMode?: string } }
    }).__organism
    return bridge?.state.graphId === 'browser-harness-b'
      && bridge.state.mobileTab === 'browse'
      && bridge.state.mobileCenterMode === 'home'
  })

  // Edge swipes are reserved for the native system Back/predictive-Back path.
  await dispatchEdgeSwipe(page, 388, 270)
  assert((await state(page)).mobileTab === 'browse', 'shell claimed a system-edge swipe')

  await tabs.nth(2).click()
  await waitForDestination(page, 'Sophia')
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobileTab?: string } }
    }).__organism
    return bridge?.state.mobileTab === 'sophia'
  })
  assert(await mobileShell.locator('.organism-mobile-top-bar').evaluate(top =>
    getComputedStyle(top).display === 'none'),
  'Sophia retained the generic shell bar above chat-chrome')
  assert(await page.locator('[data-organism-mobile-shell="true"] > .app-container').evaluate(container =>
    Math.abs(container.getBoundingClientRect().top) < 0.5),
  'Sophia did not receive the full safe-area-aware chat viewport')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-root.png') })
  }
  const chatPanel = page.locator('sh-chat-panel')

  // Model choice is a pre-conversation transaction. Exercise the compact modal
  // before projecting fixture history; any existing turn correctly locks it.
  const modelSelector = page.locator('sh-chat-panel .model-selector-trigger')
  await modelSelector.click({ timeout: 10_000 })
  const modelSheet = page.locator(
    'sh-chat-panel .model-picker-sheet[role="dialog"][aria-modal="true"]',
  )
  await modelSheet.waitFor({ state: 'visible', timeout: 10_000 })
  assert(await tabs.first().isHidden(),
    'primary navigation remained interactive above the Sophia model modal')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-model-sheet.png') })
  }
  await page.keyboard.press('Escape')
  assert(await page.locator('sh-chat-panel .model-picker-sheet').count() === 0,
    'Escape did not dismiss the Sophia model sheet')
  assert(await tabs.first().isVisible(),
    'primary navigation did not return after the Sophia model modal closed')

  await chatPanel.evaluate((element) => {
    const now = Date.now()
    const panel = element as HTMLElement & {
      messages: Array<Record<string, unknown>>
      requestUpdate(): void
    }
    panel.messages = [
      {
        id: 'continuity-user',
        role: 'user',
        content: 'What should I focus on next?',
        parts: [{ type: 'text', content: 'What should I focus on next?' }],
        isStreaming: false,
        toolCalls: [],
        createdAt: now - 1_000,
      },
      {
        id: 'continuity-assistant',
        role: 'assistant',
        content: 'Keep the current document available while this conversation opens, then continue from the same place.',
        parts: [{ type: 'text', content: 'Keep the current document available while this conversation opens, then continue from the same place.' }],
        isStreaming: false,
        toolCalls: [],
        createdAt: now,
      },
    ]
    panel.requestUpdate()
  })
  await chatPanel.locator('.message.assistant').waitFor({ state: 'attached' })
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-conversation.png') })
  }

  // Hoja is one persistent, controlled TipTap surface: compact affordances
  // elaborate progressively, while references resolve against the current
  // gardend graph projection instead of a second chat-specific document list.
  const chatHost = page.locator('sh-chat-host')
  const hojaComposer = chatPanel.locator('hoja-editor[posture="composer"]')
  const hojaInput = hojaComposer.locator('.ProseMirror[role="textbox"]')
  await hojaInput.waitFor({ state: 'visible' })
  assert(await chatPanel.locator('hoja-editor[posture="composer"]').count() === 1,
    'Sophia mounted more than one Hoja composer')
  assert(await chatPanel.locator('textarea').count() === 0,
    'the retired textarea composer survived beside Hoja')
  assert(await hojaInput.evaluate(input => parseFloat(getComputedStyle(input).fontSize) >= 16),
    'Hoja input text is smaller than 16px in the compact WebView posture')
  assert(await hojaComposer.locator('.hoja-editor__footer button').evaluateAll(buttons =>
    buttons.every(button => button.getBoundingClientRect().height >= 48)),
  'a compact Hoja affordance is smaller than the shared 48px interaction target')
  await hojaComposer.evaluate((element) => {
    const scope = window as unknown as {
      __mobileParityIdentity?: Record<string, Element | null>
    }
    scope.__mobileParityIdentity = {
      ...(scope.__mobileParityIdentity ?? {}),
      chatPanel: element.closest('sh-chat-panel'),
      hoja: element,
      proseMirror: element.querySelector('.ProseMirror'),
    }
  })

  const formattingToggle = hojaComposer.getByRole('button', { name: 'Show formatting' })
  await formattingToggle.click()
  const formattingToolbar = hojaComposer.getByRole('toolbar', { name: 'Message formatting' })
  await formattingToolbar.waitFor({ state: 'visible' })
  assert(await formattingToolbar.getByRole('button').count() === 3,
    'Hoja formatting disclosure did not expose the focused composer dialect')
  assert(await formattingToolbar.getByRole('button').evaluateAll(buttons =>
    buttons.every(button => button.getBoundingClientRect().height >= 48)),
  'a disclosed Hoja formatting action is smaller than 48px')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-hoja-tools.png') })
  }

  const wireCountBeforeComposer = Number((await state(page)).wireCount)
  const queryCountBeforeComposer = Number((await state(page)).queryCount)
  const boldButton = formattingToolbar.getByRole('button', { name: 'Bold' })
  await boldButton.click()
  await hojaComposer.evaluate(async (element) => {
    await (element as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete
  })
  await hojaInput.pressSequentially('Explore', { delay: 12 })
  await boldButton.click()
  await hojaComposer.evaluate(async (element) => {
    await (element as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete
  })
  await hojaInput.pressSequentially(' with [[work', { delay: 12 })

  const referenceList = hojaComposer.getByRole('listbox', { name: 'Matching documents' })
  await referenceList.waitFor({ state: 'visible', timeout: 10_000 })
  await formattingToolbar.waitFor({ state: 'hidden' })
  assert(await formattingToggle.getAttribute('aria-expanded') === 'false',
    'reference lookup left the sibling formatting elaboration open')
  const referenceOptions = referenceList.getByRole('option')
  assert(await referenceOptions.count() === 1,
    'Workspace B reference lookup did not stay isolated to its one document')
  const referenceCopy = (await referenceOptions.allTextContents()).join(' ')
  assert(referenceCopy.includes('Workspace B Only'),
    'graph-scoped chat references omitted the current workspace document')
  assert(!referenceCopy.includes('Architecture'),
    'chat references leaked a document from Workspace A')
  const activeReferenceId = await hojaInput.getAttribute('aria-activedescendant')
  assert(Boolean(activeReferenceId) && activeReferenceId === await referenceOptions.first().getAttribute('id'),
    'Hoja combobox did not expose its keyboard-active graph result')
  const queryCountAfterComposer = Number((await state(page)).queryCount)
  assert(queryCountAfterComposer - queryCountBeforeComposer === 1,
    'successive [[query keystrokes issued more than one graph projection request')
  assert(await hojaComposer.locator('.hoja-editor__footer button').evaluateAll(buttons =>
    buttons.every((button) => {
      const rect = button.getBoundingClientRect()
      const frame = button.closest('.hoja-editor__frame')?.getBoundingClientRect()
      return Boolean(frame)
        && rect.left >= frame!.left - 0.5
        && rect.right <= frame!.right + 0.5
        && rect.top >= frame!.top - 0.5
        && rect.bottom <= frame!.bottom + 0.5
    })),
  'a Hoja disclosure control was visually clipped by reference lookup')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-hoja-wikilinks.png') })
  }

  const messagesBeforeReferenceAccept = await chatPanel.locator('.message').count()
  await hojaInput.press('Enter')
  const resolvedWikiLink = hojaInput.locator('.wikilink')
  await resolvedWikiLink.waitFor({ state: 'visible' })
  assert(await chatPanel.locator('.message').count() === messagesBeforeReferenceAccept,
    'accepting a wikilink suggestion sent the chat draft')
  assert(await resolvedWikiLink.getAttribute('data-target-doc-id') === 'workspace-b-note'
    && await resolvedWikiLink.getAttribute('data-target-graph-id') === 'browser-harness-b',
  'accepted wikilink lost its gardend document/graph identity')
  await hojaInput.press('Shift+Enter')
  await hojaInput.pressSequentially('then shape the next pass.', { delay: 8 })

  const richDraft = await chatPanel.evaluate((element) => {
    const panel = element as HTMLElement & {
      draft: string
      draftDetail: {
        plainText: string
        references: Array<{ targetDocId: string | null; targetGraphId: string | null }>
      } | null
    }
    return { draft: panel.draft, detail: panel.draftDetail }
  })
  assert(richDraft.draft.includes('**Explore**')
    && richDraft.draft.includes('[[Workspace B Only]]')
    && richDraft.draft.includes('\nthen shape the next pass.'),
  `Hoja lost canonical rich Markdown: ${richDraft.draft}`)
  assert(richDraft.detail?.references[0]?.targetDocId === 'workspace-b-note'
    && richDraft.detail.references[0]?.targetGraphId === 'browser-harness-b',
  'Hoja sidecar detail lost its resolved reference identity')
  assert((await hojaInput.locator('strong').textContent()) === 'Explore',
    'bold composer content did not remain structural in ProseMirror')
  assert(Number((await state(page)).wireCount) === wireCountBeforeComposer,
    'drafting a chat reference created a persistent Garden wire')

  const richDraftSessionId = String((await state(page)).chatSessionId)
  const persistedRichDraft = await page.evaluate((sessionId) => ({
    canonical: sessionStorage.getItem(`garden:chat:draft:${sessionId}`),
    sidecar: sessionStorage.getItem(`garden:chat:draft:hoja:v1:${sessionId}`),
  }), richDraftSessionId)
  assert(persistedRichDraft.canonical === richDraft.draft,
    'legacy canonical draft storage diverged from Hoja')
  assert(Boolean(persistedRichDraft.sidecar?.includes('workspace-b-note')),
    'optional Hoja sidecar did not retain the resolved reference')

  const messagesBeforeImeEnter = await chatPanel.locator('.message').count()
  await hojaInput.evaluate((input) => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  assert(await chatPanel.locator('.message').count() === messagesBeforeImeEnter,
    'IME composition Enter submitted the Hoja draft')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-hoja-rich-draft.png') })
  }

  // Moving between mobile roots projects the same exact editor node; the rich
  // canonical string and reference sidecar must survive without remounting.
  await tabs.nth(0).click()
  await waitForDestination(page, 'Home')
  await tabs.nth(2).click()
  await waitForDestination(page, 'Sophia')
  await hojaInput.waitFor({ state: 'visible' })
  assert(await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileParityIdentity?: Record<string, Element | null>
    }
    const host = document.querySelector('sh-chat-host')
    const panel = host?.shadowRoot?.querySelector('sh-chat-panel') ?? null
    const hoja = panel?.querySelector('hoja-editor[posture="composer"]') ?? null
    const proseMirror = hoja?.querySelector('.ProseMirror') ?? null
    return scope.__mobileParityIdentity?.chatPanel === panel
      && scope.__mobileParityIdentity?.hoja === hoja
      && scope.__mobileParityIdentity?.proseMirror === proseMirror
      && Boolean(proseMirror?.isConnected)
  }), 'mobile root projection replaced the live Hoja/ProseMirror instance')
  assert(await chatPanel.evaluate(element =>
    (element as HTMLElement & { draft: string }).draft) === richDraft.draft,
  'mobile root projection lost the rich chat draft')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-hoja-recovered.png') })
  }

  const retainedMessages = await chatPanel.locator('.message').count()
  await chatPanel.evaluate((element) => {
    const panel = element as HTMLElement & {
      conversationState: string
      requestUpdate(): void
    }
    panel.conversationState = 'loading'
    panel.requestUpdate()
  })
  await chatPanel.locator('.connection-banner[data-state="loading"]').waitFor({ state: 'visible' })
  assert(await chatPanel.locator('.message').count() === retainedMessages,
    'Sophia conversation hydration discarded the transcript')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-loading.png') })
  }
  await chatPanel.evaluate((element) => {
    const panel = element as HTMLElement & {
      conversationState: string
      sendState: string
      sendRecovery: string
      sendError: string
      requestUpdate(): void
    }
    panel.conversationState = 'ready'
    panel.sendState = 'error'
    panel.sendRecovery = 'resubmit'
    panel.sendError = 'Message was not accepted.'
    panel.requestUpdate()
  })
  await chatPanel.locator('.send-continuity[data-state="error"]').waitFor({ state: 'visible' })
  assert((await chatPanel.locator('.send-retry').textContent())?.trim() === 'Retry send',
    'known pre-accept Sophia failure did not offer safe resubmission')
  assert(await chatPanel.locator('.send-retry').evaluate(button =>
    button.getBoundingClientRect().height >= 48),
  'Sophia send recovery action is smaller than the shared touch target')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-send-retry-local.png') })
  }
  await chatPanel.evaluate((element) => {
    const panel = element as HTMLElement & {
      sendState: string
      sendRecovery: string
      sendError: string
      requestUpdate(): void
    }
    panel.sendState = 'uncertain'
    panel.sendRecovery = 'reconcile'
    panel.sendError = 'Sophia accepted the turn, but its final status is not confirmed.'
    panel.requestUpdate()
  })
  await chatPanel.locator('.send-continuity[data-state="uncertain"]').waitFor({ state: 'visible' })
  assert((await chatPanel.locator('.send-retry').textContent())?.trim() === 'Check status',
    'ambiguous hosted Sophia turn offered replay instead of reconciliation')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-send-check-status.png') })
  }
  await chatPanel.evaluate((element) => {
    const panel = element as HTMLElement & {
      sendState: string
      sendRecovery: string
      sendError: string | null
      requestUpdate(): void
    }
    panel.sendState = 'ready'
    panel.sendRecovery = 'none'
    panel.sendError = null
    panel.requestUpdate()
  })

  // The first plain Enter after the suggestion tray has closed is the submit.
  // ChatService still receives only canonical text; the rich detail remains an
  // additive recovery sidecar owned by the host.
  await hojaInput.press('Enter')
  const sentReferenceMessage = chatPanel.locator('.message.user').filter({
    hasText: 'Workspace B Only',
  })
  await sentReferenceMessage.waitFor({ state: 'visible', timeout: 10_000 })
  await chatPanel.locator('.message.assistant').filter({ hasText: 'You said:' }).waitFor({
    state: 'visible',
    timeout: 10_000,
  })
  assert((await sentReferenceMessage.textContent())?.includes('Explore')
    && (await sentReferenceMessage.textContent())?.includes('then shape the next pass.'),
  'canonical rich composer text did not cross the existing ChatService seam')
  assert(await hojaComposer.getAttribute('data-empty') !== null,
    'successful submit did not clear the one live Hoja composer')
  const clearedDraftStorage = await page.evaluate((sessionId) => ({
    canonical: sessionStorage.getItem(`garden:chat:draft:${sessionId}`),
    sidecar: sessionStorage.getItem(`garden:chat:draft:hoja:v1:${sessionId}`),
  }), richDraftSessionId)
  assert(clearedDraftStorage.canonical === null && clearedDraftStorage.sidecar === null,
  'successful submit left stale canonical or rich draft recovery behind')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-hoja-sent.png') })
  }

  // The composer grows with the thought, then becomes its own scroller. This
  // keeps the transcript and primary navigation reachable under a mobile IME.
  await hojaInput.fill(Array.from({ length: 18 }, (_, index) =>
    `Layer ${String(index + 1).padStart(2, '0')} keeps the conversation legible.`).join('\n'))
  await hojaComposer.evaluate(async (element) => {
    await (element as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete
    await new Promise<void>(resolveFrame => requestAnimationFrame(() => resolveFrame()))
  })
  const composerGrowth = await hojaComposer.locator('.hoja-editor__mount').evaluate(mount => ({
    clientHeight: mount.clientHeight,
    scrollHeight: mount.scrollHeight,
  }))
  assert(composerGrowth.scrollHeight > composerGrowth.clientHeight,
    `long Hoja draft did not become internally scrollable: ${JSON.stringify(composerGrowth)}`)
  assert(composerGrowth.clientHeight <= 182,
    `Hoja exceeded the mobile growth clamp: ${JSON.stringify(composerGrowth)}`)
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '03-sophia-hoja-growth-clamp.png') })
  }
  await chatPanel.getByRole('button', { name: 'Clear message' }).click()
  assert(await hojaComposer.getAttribute('data-empty') !== null,
    'clear did not return Hoja to its empty posture')

  await tabs.nth(0).click()
  await waitForDestination(page, 'Home')
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobileTab?: string } }
    }).__organism
    return bridge?.state.mobileTab === 'home'
  })

  // The Living Codex identity is a two-theme contract, not a light-mode skin.
  // Exercise the same mounted resources through the dark projection so visual
  // checkpoints catch pale fallbacks, lost ink hierarchy, and identity churn.
  await page.evaluate(() => {
    document.querySelector('#harness-root')?.dispatchEvent(new CustomEvent('mn-theme-toggle', {
      bubbles: true,
      composed: true,
    }))
  })
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { theme?: string } }
    }).__organism
    return bridge?.state.theme === 'dark'
  })
  await waitForDestination(page, 'Home')
  assert(await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileParityIdentity?: { chat: Element | null }
    }
    return scope.__mobileParityIdentity?.chat === document.querySelector('sh-chat-host')
      && scope.__mobileParityIdentity.chat?.isConnected === true
  }), 'dark projection replaced the persistent chat resource')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '04-dark-home.png') })
  }

  await tabs.nth(1).click()
  await waitForDestination(page, 'Browse')
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobileTab?: string; mobileCenterMode?: string } }
    }).__organism
    return bridge?.state.mobileTab === 'browse' && bridge.state.mobileCenterMode === 'home'
  })
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '04-dark-browse.png') })
  }

  await mobileShell.locator('mn-mobile-file-list button[data-node-type="document"]:visible').first().click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: {
        state: { mobileTab?: string; mobileCenterMode?: string; activeDocumentId?: string | null }
      }
    }).__organism
    return bridge?.state.mobileTab === 'browse'
      && bridge.state.mobileCenterMode === 'document'
      && Boolean(bridge.state.activeDocumentId)
  })
  assert(await page.locator('#mn-editor-host').count() === 1,
    'dark document detail did not mount exactly one live editor')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '04-dark-document.png') })
  }
  await mobileShell.locator('.organism-mobile-back').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobileTab?: string; mobileCenterMode?: string } }
    }).__organism
    return bridge?.state.mobileTab === 'browse' && bridge.state.mobileCenterMode === 'home'
  })
  await tabs.nth(2).click()
  await waitForDestination(page, 'Sophia')
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobileTab?: string } }
    }).__organism
    return bridge?.state.mobileTab === 'sophia'
  })
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '04-dark-sophia.png') })
  }

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForFunction(() => {
    const scope = window as unknown as {
      __organism?: { state: { mobile?: boolean } }
    }
    return scope.__organism?.state.mobile === false
  })
  assert(await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileParityIdentity?: { chat: Element | null }
    }
    return scope.__mobileParityIdentity?.chat === document.querySelector('sh-chat-host')
  }), 'desktop transition replaced the persistent chat host')

  // The old separate-window affordance becomes a reversible spatial posture
  // for the exact same host, panel, Hoja element, and ProseMirror EditorView.
  const expandConversation = chatPanel.getByRole('button', { name: 'Expand conversation' })
  await expandConversation.waitFor({ state: 'visible' })
  await expandConversation.click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { chatPresentation?: string } }
    }).__organism
    return bridge?.state.chatPresentation === 'fullscreen'
      && document.querySelector('sh-chat-host')?.getAttribute('presentation') === 'fullscreen'
  })
  const fullScreenGeometry = await chatHost.evaluate(host => {
    const rect = host.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  assert(Math.abs(fullScreenGeometry.x) < 1
    && Math.abs(fullScreenGeometry.y) < 1
    && Math.abs(fullScreenGeometry.width - 1440) < 1
    && Math.abs(fullScreenGeometry.height - 960) < 1,
  `full-screen chat did not occupy the visual viewport: ${JSON.stringify(fullScreenGeometry)}`)
  assert(await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileParityIdentity?: Record<string, Element | null>
    }
    const host = document.querySelector('sh-chat-host')
    const panel = host?.shadowRoot?.querySelector('sh-chat-panel') ?? null
    const hoja = panel?.querySelector('hoja-editor[posture="composer"]') ?? null
    const proseMirror = hoja?.querySelector('.ProseMirror') ?? null
    return scope.__mobileParityIdentity?.chat === host
      && scope.__mobileParityIdentity?.chatPanel === panel
      && scope.__mobileParityIdentity?.hoja === hoja
      && scope.__mobileParityIdentity?.proseMirror === proseMirror
  }), 'full-screen projection cloned or replaced the live conversation surface')
  const fullScreenMeasure = await chatPanel.locator('.composer-heading').evaluate(element =>
    element.getBoundingClientRect().width)
  assert(fullScreenMeasure <= 866,
    `full-screen conversation exceeded its readable 54rem measure: ${fullScreenMeasure}`)
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '05-sophia-fullscreen.png') })
  }

  const restoreConversation = chatPanel.getByRole('button', {
    name: 'Return conversation to sidebar',
  })
  await restoreConversation.click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { chatPresentation?: string } }
    }).__organism
    return bridge?.state.chatPresentation === 'rail'
      && document.querySelector('sh-chat-host')?.getAttribute('presentation') === 'rail'
  })
  assert(await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileParityIdentity?: Record<string, Element | null>
    }
    const host = document.querySelector('sh-chat-host')
    const panel = host?.shadowRoot?.querySelector('sh-chat-panel') ?? null
    const hoja = panel?.querySelector('hoja-editor[posture="composer"]') ?? null
    return scope.__mobileParityIdentity?.chat === host
      && scope.__mobileParityIdentity?.chatPanel === panel
      && scope.__mobileParityIdentity?.hoja === hoja
      && scope.__mobileParityIdentity?.proseMirror === hoja?.querySelector('.ProseMirror')
  }), 'returning chat to the rail replaced its live editor identity')
  if (checkpointDir) {
    await page.screenshot({ path: resolve(checkpointDir, '05-sophia-restored.png') })
  }

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    richMobileHome: true,
    homeEditorIdentity: true,
    homeDocumentNavigation: true,
    workspaceSelection: true,
    stableRootNavigation: true,
    systemEdgeGesturesReserved: true,
    minimumTargetSize: true,
    navigationSemantics: true,
    safeAreaViewportSkeleton: true,
    browseSearchDeduplicated: true,
    unifiedSophiaChrome: true,
    editorProgressiveDisclosure: true,
    modalSheetFocusLifecycle: true,
    hostTransactionalSheets: true,
    modalDeliveryLayering: true,
    continuityProjectionRetention: true,
    browseDirectManipulation: true,
    chatDeliveryRecovery: true,
    hojaRichComposer: true,
    graphScopedChatReferences: true,
    richDraftRecovery: true,
    imeSafeSubmit: true,
    composerGrowthClamp: true,
    darkIdentityProjection: true,
    desktopMobileIdentity: true,
    sameNodeFullscreenChat: true,
  }, null, 2)}\n`)
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
