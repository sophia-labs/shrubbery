/**
 * Full production-entry proof for the Surface-owned dual-document center.
 *
 * This is deliberately stronger than the isolated center-panes specimen: it
 * boots a fresh real Gardend, seeds the real UX graph and three documents,
 * launches Organism's normal `?source=cell` entry, and drives the file pane,
 * document chooser, two live CRDT editors, history, Surface divider, and
 * close/reopen behavior in Chromium. Set SHRUBBERY_HEADED=1 to watch the same
 * journey.
 */

import { createRequire } from 'node:module'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, type Locator, type Page } from 'playwright'
import { createServer } from 'vite'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = join(appDir, '.gardend-loopback.json')
const graphId = 'center-panes-gardend-proof'
const port = Number(process.env.SHRUBBERY_CENTER_PANES_GARDEND_PORT ?? 5215)
const headed = process.env.SHRUBBERY_HEADED === '1'
const selectAllShortcut = process.platform === 'darwin' ? 'Meta+a' : 'Control+a'
const undoShortcut = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'
const redoShortcut = process.platform === 'darwin' ? 'Shift+Meta+z' : 'Shift+Control+z'
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`center-panes Gardend assertion failed: ${message}`)
}

async function waitForTagMaterial(locator: Locator): Promise<{
  readonly connected: boolean
  readonly display: string
  readonly radius: string
  readonly cursor: string
  readonly tag: string
  readonly className: string
}> {
  const deadline = Date.now() + 2_000
  let latest = {
    connected: false,
    display: '',
    radius: '',
    cursor: '',
    tag: '',
    className: '',
  }
  while (Date.now() < deadline) {
    try {
      latest = await locator.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          connected: element.isConnected,
          display: style.display,
          radius: style.borderRadius,
          cursor: style.cursor,
          tag: element.tagName,
          className: element.className,
        }
      })
      if (
        latest.connected
        && latest.display === 'inline-flex'
        && latest.radius !== '0px'
        && latest.cursor === 'pointer'
      ) return latest
    } catch {
      // ProseMirror may replace the just-inserted node while synchronizing the
      // parent block's derived tag attributes. Re-resolve the Locator instead
      // of treating that short detached-node window as missing material.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 20))
  }
  return latest
}

async function seedDocuments(cell: GardendCell): Promise<void> {
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  for (const [documentId, title] of [
    ['doc-alpha', 'Alpha notebook'],
    ['doc-beta', 'Beta notebook'],
    ['doc-gamma', 'Gamma notebook'],
  ] as const) {
    await mcp.toolsCall('create_document', { graphId, documentId, title })
  }
}

async function collectEditorDiagnostic(page: Page, selector: string): Promise<unknown> {
  return page.evaluate((hostSelector) => {
    const host = document.querySelector(hostSelector) as (HTMLElement & {
      binding?: { get?: () => unknown }
      liveEditor?: unknown
      renderRoot?: ShadowRoot
    }) | null
    const bindingState = host?.binding?.get?.() as {
      centerMode?: unknown
      graphId?: unknown
      documentId?: unknown
      status?: unknown
      error?: unknown
      provider?: unknown
    } | null | undefined
    const surface = document.querySelector('sh-workspace-surface') as (HTMLElement & {
      surfaceDocument?: () => {
        rootNodeId: string
        nodes: Record<string, { kind: string; descriptor?: { resource?: unknown } }>
      } | null
    }) | null
    const surfaceDocument = surface?.surfaceDocument?.() ?? null
    const secondaryWrapper = document.querySelector<HTMLElement>(
      '[data-layout-node-id="center-secondary"]',
    )
    const secondaryRect = secondaryWrapper?.getBoundingClientRect()
    return {
      selector: hostSelector,
      hostFound: Boolean(host),
      connected: host?.isConnected ?? false,
      binding: bindingState ? {
        centerMode: bindingState.centerMode,
        graphId: bindingState.graphId,
        documentId: bindingState.documentId,
        status: bindingState.status,
        error: String(bindingState.error ?? ''),
        provider: Boolean(bindingState.provider),
      } : null,
      liveEditor: Boolean(host?.liveEditor),
      shadowText: host?.renderRoot?.textContent?.trim().slice(0, 500) ?? null,
      bodyMode: document.body.dataset.organismMode ?? null,
      output: document.querySelector('#output')?.textContent?.trim().slice(-1000) ?? null,
      editorHosts: Array.from(document.querySelectorAll('sh-editor-host')).map(candidate => ({
        pane: candidate.getAttribute('data-center-pane-host'),
        connected: candidate.isConnected,
      })),
      secondaryWrapper: secondaryWrapper ? {
        connected: secondaryWrapper.isConnected,
        dataset: { ...secondaryWrapper.dataset },
        childTags: Array.from(secondaryWrapper.children).map(child => child.tagName.toLowerCase()),
        text: secondaryWrapper.textContent?.trim().slice(0, 500) ?? '',
        innerHtml: secondaryWrapper.innerHTML.slice(0, 1_000),
        rect: secondaryRect ? {
          x: secondaryRect.x,
          y: secondaryRect.y,
          width: secondaryRect.width,
          height: secondaryRect.height,
        } : null,
      } : null,
      surface: surfaceDocument ? {
        rootNodeId: surfaceDocument.rootNodeId,
        nodes: Object.fromEntries(Object.entries(surfaceDocument.nodes).map(([id, node]) => [
          id,
          { kind: node.kind, resource: node.descriptor?.resource ?? null },
        ])),
      } : null,
      centerPaneSession: Object.entries(window.sessionStorage)
        .filter(([key]) => key.startsWith('shrubbery:center-panes:v1:')),
    }
  }, selector)
}

async function editorReady(page: Page, selector: string): Promise<void> {
  try {
    await page.waitForFunction((hostSelector) => {
      const host = document.querySelector(hostSelector) as (HTMLElement & {
        liveEditor?: { getText?: () => string }
      }) | null
      return Boolean(host?.liveEditor?.getText)
    }, selector, { timeout: 30_000 })
  } catch (error) {
    const initial = await collectEditorDiagnostic(page, selector)
    let afterResize: unknown = null
    let afterRerender: unknown = null
    if (selector.includes('center-secondary')) {
      const viewport = page.viewportSize()
      if (viewport) {
        await page.setViewportSize({ width: viewport.width - 1, height: viewport.height })
        await page.setViewportSize(viewport)
        await page.locator('sh-workspace-surface').evaluate(async (element) => {
          await (element as HTMLElement & { whenReady?: () => Promise<void> }).whenReady?.()
        })
        await page.waitForTimeout(100)
        afterResize = await collectEditorDiagnostic(page, selector)
      }
      const primaryTitle = page.locator(
        'sh-workspace-surface [data-pane-id="center-primary"][data-surface-part="pane-header"] .pane-title',
      )
      if (await primaryTitle.count() > 0) {
        await primaryTitle.click()
        await page.locator('sh-workspace-surface').evaluate(async (element) => {
          await (element as HTMLElement & { whenReady?: () => Promise<void> }).whenReady?.()
        })
        await page.waitForTimeout(100)
        afterRerender = await collectEditorDiagnostic(page, selector)
      }
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({
      initial,
      afterResize,
      afterRerender,
    }, null, 2)}`)
  }
}

async function centerPanesSessionProjection(page: Page): Promise<{
  readonly activePaneId: string
  readonly dividerPercent: number
  readonly posture: string
  readonly panes: readonly {
    readonly id: string
    readonly documentId: string | null
    readonly backLength: number
    readonly forwardLength: number
  }[]
}> {
  return page.evaluate((sessionGraphId) => {
    const key = `shrubbery:center-panes:v1:${encodeURIComponent(sessionGraphId)}`
    const raw = window.sessionStorage.getItem(key)
    if (!raw) throw new Error(`missing center-pane session at ${key}`)
    const envelope = JSON.parse(raw) as {
      state: {
        activePaneId: string
        dividerPercent: number
        posture: string
        primary: {
          id: string
          current: { kind: string; documentId?: string }
          back: unknown[]
          forward: unknown[]
        }
        secondary: {
          id: string
          current: { kind: string; documentId?: string }
          back: unknown[]
          forward: unknown[]
        } | null
      }
    }
    const state = envelope.state
    return {
      activePaneId: state.activePaneId,
      dividerPercent: state.dividerPercent,
      posture: state.posture,
      panes: [state.primary, state.secondary]
        .filter((pane): pane is NonNullable<typeof pane> => pane !== null)
        .map(pane => ({
          id: pane.id,
          documentId: pane.current.documentId ?? null,
          backLength: pane.back.length,
          forwardLength: pane.forward.length,
        })),
    }
  }, graphId)
}

async function openSecondaryDocumentSwitcher(page: Page): Promise<void> {
  await page.locator('sh-workspace-surface [data-split-command]').click()
  const secondaryHeader = page.locator(
    'sh-workspace-surface [data-pane-id="center-secondary"][data-surface-part="pane-header"]',
  )
  await secondaryHeader.waitFor({ state: 'visible' })
  await secondaryHeader.locator('[data-pane-open="center-secondary"]').click()
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
const pageErrors: string[] = []
const consoleErrors: string[] = []
const requestFailures: string[] = []
const navigationAborts: string[] = []
let reloading = false

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real Gardend binary exists at ${bin}`)
  console.log(`[center-panes:gardend] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[center-panes:gardend] cell ready at ${cell.apiUrl}`)
  await createGraphAndSeedUxConfig(cell, graphId, readFileSync(seedPath, 'utf8'))
  await seedDocuments(cell)
  console.log('[center-panes:gardend] UX graph and three documents seeded')
  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId,
  }, null, 2))

  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  console.log(`[center-panes:gardend] Organism listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } })
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })
  page.on('requestfailed', request => {
    const failure = `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`
    if (reloading && request.failure()?.errorText === 'net::ERR_ABORTED') {
      navigationAborts.push(failure)
      return
    }
    requestFailures.push(failure)
  })

  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${graphId}`, {
    waitUntil: 'domcontentloaded',
  })
  console.log('[center-panes:gardend] production entry loaded')
  await page.locator('mn-sidebar-panel [data-node-id="doc-alpha"]').waitFor({ state: 'visible' })
  await page.locator('.app-container[data-workspace-renderer="surface"]').waitFor({ state: 'visible' })
  assert(await page.locator('sh-center-panes').count() === 0, 'legacy center-panes host is absent')
  assert(await page.locator('sl-split-panel').count() === 0, 'legacy Shoelace split spine is absent')
  assert(await page.locator('.boot-placeholder').count() === 0, 'static boot placeholder is retired')
  console.log('[center-panes:gardend] file pane loaded')
  await page.locator('mn-sidebar-panel [data-node-id="doc-alpha"]').click()
  await page.locator('sh-workspace-surface').waitFor({ state: 'visible' })
  await editorReady(page, '#mn-editor-host')
  console.log('[center-panes:gardend] primary editor ready')

  const primary = page.locator('#mn-editor-host .ProseMirror')
  const primaryHost = page.locator('#mn-editor-host')
  const primaryCaretAnchor = () => primaryHost.evaluate((element) => {
    const host = element as HTMLElement & {
      liveEditor?: {
        getOverlayAnchorRect?: () => {
          left: number
          right: number
          top: number
          bottom: number
        } | null
      }
    }
    return host.liveEditor?.getOverlayAnchorRect?.() ?? null
  })
  const assertAnchoredOverlay = (
    label: string,
    box: { x: number; y: number; width: number; height: number } | null,
    anchor: { left: number; right: number; top: number; bottom: number } | null,
  ): void => {
    assert(box, `${label} has physical geometry`)
    assert(anchor, `${label} received a real editor caret anchor`)
    assert(box.x > 8 && box.y > 8, `${label} does not render at the viewport origin`)
    assert(box.x + box.width <= 1492, `${label} stays inside the right viewport edge`)
    assert(box.y + box.height <= 972, `${label} stays inside the bottom viewport edge`)
    assert(Math.abs(box.x - anchor.left) <= 2, `${label} aligns to the caret x coordinate`)
    assert(
      Math.abs(box.y - (anchor.bottom + 8)) <= 2,
      `${label} prefers the shared eight-pixel below-caret gap`,
    )
  }

  // Semantic-node material is an editor-host responsibility: extension CSS
  // must cross the Shadow DOM boundary with the real TipTap node. Exercise the
  // quote node through the ordinary toolbar and inspect Chromium's paint model.
  await primary.click()
  await primary.fill('Quoted source')
  await page.locator('#mn-editor-host mn-editor-toolbar [data-block-select] button.trigger').click()
  await page.locator('#mn-editor-host mn-editor-toolbar [data-block-select] [data-menu-item-id="blockquote"]').click()
  const quote = page.locator('#mn-editor-host .ProseMirror > blockquote')
  await quote.waitFor({ state: 'visible' })
  const quoteMaterial = await quote.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      position: style.position,
      borderLeftWidth: style.borderLeftWidth,
      fontStyle: style.fontStyle,
      paddingLeft: Number.parseFloat(style.paddingLeft),
    }
  })
  assert(quoteMaterial.position === 'relative', 'quote gutter marker owns a local containing block')
  assert(quoteMaterial.borderLeftWidth === '3px', 'quote material has its semantic left rule')
  assert(quoteMaterial.fontStyle === 'italic', 'quote material has prose emphasis')
  assert(quoteMaterial.paddingLeft >= 20, 'quote material reserves a readable gutter')
  await page.locator('#mn-editor-host mn-editor-toolbar [data-block-select] button.trigger').click()
  await page.locator('#mn-editor-host mn-editor-toolbar [data-block-select] [data-menu-item-id="paragraph"]').click()

  // The shared popup contract covers every editor transient, not only the
  // wikilink dialog. Slash and tag suggestions anchor before first paint.
  await primary.click()
  await page.keyboard.press(selectAllShortcut)
  await page.keyboard.press('Backspace')
  const slashAnchorBefore = await primaryCaretAnchor()
  await page.keyboard.type('/')
  const slashMenu = page.locator('[data-slash-command-menu]')
  await slashMenu.waitFor({ state: 'visible' })
  assertAnchoredOverlay('slash-command popup', await slashMenu.boundingBox(), slashAnchorBefore)
  await page.keyboard.press('Escape')
  await slashMenu.waitFor({ state: 'detached' })

  await primary.click()
  await page.keyboard.press(selectAllShortcut)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('#t')
  await page.keyboard.type('o')
  const tagPopover = page.locator('mn-tag-autocomplete-popover')
  await tagPopover.waitFor({ state: 'visible' })
  assertAnchoredOverlay(
    'tag autocomplete popup',
    await tagPopover.boundingBox(),
    await primaryCaretAnchor(),
  )
  await page.keyboard.press('Enter')
  const tagChip = page.locator('#mn-editor-host .ProseMirror .tag-chip')
  await tagChip.waitFor({ state: 'visible' })
  const tagMaterial = await waitForTagMaterial(tagChip)
  assert(
    tagMaterial.display === 'inline-flex',
    `tag chip extension material crosses the host shadow boundary (${JSON.stringify(tagMaterial)})`,
  )
  assert(tagMaterial.radius !== '0px', 'tag chip retains its semantic pill shape')
  assert(tagMaterial.cursor === 'pointer', 'tag chip remains visibly interactive')

  await primary.click()
  await page.keyboard.press(selectAllShortcut)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('[[')
  const wikilinkPicker = page.locator('mn-wikilink-picker .container')
  await wikilinkPicker.waitFor({ state: 'visible' })
  assertAnchoredOverlay(
    'wikilink picker',
    await wikilinkPicker.boundingBox(),
    await primaryCaretAnchor(),
  )
  await page.locator('mn-wikilink-picker [data-doc-id="doc-beta"]').click()
  const wikilink = page.locator('#mn-editor-host .ProseMirror .wikilink')
  await wikilink.waitFor({ state: 'visible' })
  const wikilinkMaterial = await wikilink.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      cursor: style.cursor,
      decoration: style.textDecorationStyle,
      paddingLeft: Number.parseFloat(style.paddingLeft),
    }
  })
  assert(wikilinkMaterial.cursor === 'pointer', 'wikilink is visibly interactive')
  assert(wikilinkMaterial.decoration === 'dotted', 'wikilink retains its semantic dotted underline')
  assert(wikilinkMaterial.paddingLeft > 0, 'wikilink retains its inline material spacing')
  console.log('[center-panes:gardend] editor semantics and anchored transient surfaces proved')

  await primary.click()
  await primary.fill('alpha survives its own pane')
  const primaryHostIdentity = await page.locator('#mn-editor-host').evaluate((element) => {
    ;(window as unknown as { __primaryCenterHost?: Element }).__primaryCenterHost = element
    return element.getAttribute('data-center-pane-host')
  })
  assert(primaryHostIdentity === 'center-primary', 'primary host has stable pane identity')

  await openSecondaryDocumentSwitcher(page)
  await page.locator('mn-document-switcher [data-item-id="doc-beta"]').waitFor({ state: 'visible' })
  await page.locator('mn-document-switcher [data-item-id="doc-beta"]').click()
  const secondaryHost = 'sh-editor-host[data-center-pane-host="center-secondary"]'
  await editorReady(page, secondaryHost)
  console.log('[center-panes:gardend] secondary editor ready')
  assert(await page.locator('sh-workspace-surface sh-editor-host').count() === 2, 'two live editor hosts render')

  const secondary = page.locator(`${secondaryHost} .ProseMirror`)
  await secondary.click()
  await secondary.fill('beta remains independent')
  await page.locator(secondaryHost).evaluate((element) => {
    ;(window as unknown as { __secondaryCenterHost?: Element }).__secondaryCenterHost = element
  })
  await page.locator('sh-workspace-surface [data-pane-id="center-primary"][data-surface-part="pane-header"] .pane-title').click()
  assert(
    await page.locator('sh-workspace-surface [data-pane-id="center-primary"][data-surface-part="pane-header"]').getAttribute('data-active') === 'true',
    'pointer focus makes primary active',
  )
  assert(await primary.textContent() === 'alpha survives its own pane', 'primary content is independent')
  assert(await secondary.textContent() === 'beta remains independent', 'secondary content is independent')

  await page.locator('sh-workspace-surface [data-pane-id="center-secondary"][data-surface-part="pane-header"] .pane-title').click()
  await page.locator('sh-workspace-surface [data-pane-open="center-primary"]').click()
  await page.locator('mn-document-switcher [data-item-id="doc-gamma"]').waitFor({ state: 'visible' })
  await page.locator('mn-document-switcher [data-item-id="doc-gamma"]').click()
  await editorReady(page, '#mn-editor-host')
  assert(
    await page.locator('sh-workspace-surface [data-pane-id="center-primary"][data-surface-part="pane-header"]').getAttribute('data-active') === 'true',
    'an inactive pane command targets and activates that pane',
  )
  await page.locator('sh-workspace-surface [data-pane-back="center-primary"]').click()
  await editorReady(page, '#mn-editor-host')
  assert(await primary.textContent() === 'alpha survives its own pane', 'primary history restores its CRDT document')
  assert(
    await page.locator('#mn-editor-host').evaluate(element =>
      element === (window as unknown as { __primaryCenterHost?: Element }).__primaryCenterHost,
    ),
    'primary pane host survives inactive-command navigation',
  )

  await page.locator('sh-workspace-surface [data-pane-id="center-secondary"][data-surface-part="pane-header"] .pane-title').click()
  await page.locator('sh-workspace-surface [data-pane-open="center-secondary"]').click()
  await page.locator('mn-document-switcher [data-item-id="doc-gamma"]').waitFor({ state: 'visible' })
  await page.locator('mn-document-switcher [data-item-id="doc-gamma"]').click()
  await editorReady(page, secondaryHost)
  assert(
    await page.locator(secondaryHost).evaluate(element =>
      element === (window as unknown as { __secondaryCenterHost?: Element }).__secondaryCenterHost,
    ),
    'secondary pane host survives forward document navigation',
  )
  await page.locator('sh-workspace-surface [data-pane-back="center-secondary"]').click()
  await editorReady(page, secondaryHost)
  assert(
    await page.locator(secondaryHost).evaluate(element =>
      element === (window as unknown as { __secondaryCenterHost?: Element }).__secondaryCenterHost,
    ),
    'secondary pane host survives document history round-trip',
  )
  assert((await secondary.textContent())?.includes('beta remains independent'), 'beta CRDT content survives round-trip')

  const divider = page.locator('sh-workspace-surface [data-layout-divider="center-root-split"]')
  const dividerBefore = await divider.boundingBox()
  assert(dividerBefore, 'divider has physical geometry')
  await page.mouse.move(dividerBefore.x + dividerBefore.width / 2, dividerBefore.y + 120)
  await page.mouse.down()
  await page.mouse.move(dividerBefore.x + 140, dividerBefore.y + 120, { steps: 6 })
  await page.mouse.up()
  const dividerAfter = await divider.boundingBox()
  assert(dividerAfter, 'divider remains measurable after drag')
  assert(Math.abs(dividerAfter.x - dividerBefore.x) > 80, 'divider drag changes physical pane geometry')
  assert(
    await page.locator('#mn-editor-host').evaluate(element =>
      element === (window as unknown as { __primaryCenterHost?: Element }).__primaryCenterHost,
    ),
    'primary Class-B host survives split resize',
  )

  await page.locator('sh-workspace-surface [data-pane-close="center-secondary"]').click()
  await page.locator(secondaryHost).waitFor({ state: 'detached' })
  assert(await page.locator('sh-workspace-surface sh-editor-host').count() === 1, 'secondary host closes')
  assert(await primary.textContent() === 'alpha survives its own pane', 'primary survives secondary close')

  // Multiplexer room ownership: two pane-local TipTap views of the SAME Garden
  // document must share one ProviderHandle/Y.Doc/awareness/socket. A pane is a
  // view, not another local presence session.
  await openSecondaryDocumentSwitcher(page)
  await page.locator('mn-document-switcher [data-item-id="doc-alpha"]').waitFor({ state: 'visible' })
  await page.locator('mn-document-switcher [data-item-id="doc-alpha"]').click()
  await editorReady(page, secondaryHost)
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host[data-center-pane-host="center-secondary"]')
    return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent?.includes('alpha survives its own pane')
  })
  const sharedRoomIdentity = await page.evaluate(() => {
    const primaryHost = document.querySelector(
      'sh-editor-host[data-center-pane-host="center-primary"]',
    ) as (HTMLElement & { binding?: { get?: () => { provider?: unknown } }; liveEditor?: unknown }) | null
    const secondaryHostElement = document.querySelector(
      'sh-editor-host[data-center-pane-host="center-secondary"]',
    ) as (HTMLElement & { binding?: { get?: () => { provider?: unknown } }; liveEditor?: unknown }) | null
    const primaryProvider = primaryHost?.binding?.get?.().provider
    const secondaryProvider = secondaryHostElement?.binding?.get?.().provider
    ;(window as unknown as { __sharedRoomProvider?: unknown }).__sharedRoomProvider = primaryProvider
    return {
      sameProvider: Boolean(primaryProvider) && primaryProvider === secondaryProvider,
      differentViews: Boolean(primaryHost?.liveEditor)
        && Boolean(secondaryHostElement?.liveEditor)
        && primaryHost?.liveEditor !== secondaryHostElement?.liveEditor,
    }
  })
  assert(sharedRoomIdentity.sameProvider, 'same-document attachments share one ProviderHandle')
  assert(sharedRoomIdentity.differentViews, 'same-document attachments retain distinct TipTap views')

  // Room-owned history proof. Create two normal capture groups from different
  // views, then alternate the physical pane issuing each keyboard shortcut.
  // The former per-EditorView managers lost the second redo branch here.
  await secondary.click()
  await secondary.fill('shared room history first step')
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host[data-center-pane-host="center-primary"]')
    return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'shared room history first step'
  })
  await page.waitForTimeout(550)
  await primary.click()
  await primary.press('End')
  await primary.pressSequentially(' + second step')
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host[data-center-pane-host="center-secondary"]')
    return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent
      === 'shared room history first step + second step'
  })
  assert(
    await primary.textContent() === 'shared room history first step + second step',
    'shared room converges across both views',
  )

  await secondary.click()
  await page.keyboard.press(undoShortcut)
  assert(await primary.textContent() === 'shared room history first step', 'secondary-view undo removes second step')
  assert(await secondary.textContent() === 'shared room history first step', 'undo converges to secondary view')

  await primary.click()
  await page.keyboard.press(undoShortcut)
  assert(await primary.textContent() === 'alpha survives its own pane', 'primary-view undo removes first step')
  assert(await secondary.textContent() === 'alpha survives its own pane', 'second undo converges to secondary view')

  await secondary.click()
  await page.keyboard.press(redoShortcut)
  assert(await primary.textContent() === 'shared room history first step', 'secondary-view redo restores first step')
  assert(await secondary.textContent() === 'shared room history first step', 'first redo converges to secondary view')

  await primary.click()
  await page.keyboard.press(redoShortcut)
  assert(
    await primary.textContent() === 'shared room history first step + second step',
    'primary-view redo restores the complete second step',
  )
  assert(
    await secondary.textContent() === 'shared room history first step + second step',
    'alternating redo preserves and converges the complete branch',
  )

  await page.locator('sh-workspace-surface [data-pane-close="center-secondary"]').click()
  await page.locator(secondaryHost).waitFor({ state: 'detached' })
  assert(
    await page.locator('#mn-editor-host').evaluate((element) => {
      const host = element as HTMLElement & { binding?: { get?: () => { provider?: unknown } } }
      return host.binding?.get?.().provider
        === (window as unknown as { __sharedRoomProvider?: unknown }).__sharedRoomProvider
    }),
    'releasing one shared-room attachment leaves the survivor provider attached',
  )
  await primary.click()
  await primary.fill('shared provider survives secondary detach')
  await page.locator('sh-workspace-surface [data-pane-open="center-primary"]').click()
  await page.locator('mn-document-switcher [data-item-id="doc-gamma"]').waitFor({ state: 'visible' })
  await page.locator('mn-document-switcher [data-item-id="doc-gamma"]').click()
  await editorReady(page, '#mn-editor-host')
  await page.locator('sh-workspace-surface [data-pane-back="center-primary"]').click()
  await editorReady(page, '#mn-editor-host')
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host[data-center-pane-host="center-primary"]')
    return host?.shadowRoot?.querySelector('.ProseMirror')?.textContent
      === 'shared provider survives secondary detach'
  })

  // A mux session is browser-tab state, not only a live component tree. Restore
  // the two pane addresses, their independent history, focus, and divider after
  // a hard production-entry reload; EditorViews/providers are honestly rebuilt.
  await openSecondaryDocumentSwitcher(page)
  await page.locator('mn-document-switcher [data-item-id="doc-beta"]').waitFor({ state: 'visible' })
  await page.locator('mn-document-switcher [data-item-id="doc-beta"]').click()
  await editorReady(page, secondaryHost)
  const savedMuxSession = await centerPanesSessionProjection(page)
  assert(savedMuxSession.panes.length === 2, 'split session is present before reload')

  reloading = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(50)
  reloading = false
  await page.locator('mn-sidebar-panel [data-node-id="doc-alpha"]').waitFor({ state: 'visible' })
  await page.locator('sh-workspace-surface').waitFor({ state: 'visible' })
  await editorReady(page, '#mn-editor-host')
  await editorReady(page, secondaryHost)
  const restoredMuxSession = await centerPanesSessionProjection(page)
  assert(
    JSON.stringify(restoredMuxSession) === JSON.stringify(savedMuxSession),
    `reload restores exact mux projection: ${JSON.stringify({ savedMuxSession, restoredMuxSession })}`,
  )
  assert(
    (await page.locator('#mn-editor-host .ProseMirror').textContent()) === 'shared provider survives secondary detach',
    'primary CRDT content is present in the restored attachment',
  )
  assert(
    (await page.locator(`${secondaryHost} .ProseMirror`).textContent())?.includes('beta remains independent'),
    'secondary CRDT content is present in the restored attachment',
  )

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)
  assert(requestFailures.length === 0, `request failures: ${requestFailures.join('\n')}`)

  console.log(JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    backend: 'real-gardend',
    productionEntry: true,
    semanticEditorMaterial: true,
    collaborativeTextTriggers: true,
    anchoredEditorPopovers: true,
    twoLiveEditors: true,
    independentCrdtContent: true,
    navigationRoundTrip: true,
    dividerDeltaPx: Math.round(Math.abs(dividerAfter.x - dividerBefore.x) * 100) / 100,
    classBIdentity: true,
    closeLifecycle: true,
    sharedRoomProvider: true,
    distinctSharedRoomViews: true,
    sharedRoomConvergence: true,
    roomOwnedAlternatingUndoRedo: true,
    lastAttachmentOwnership: true,
    reloadSessionRestore: true,
    navigationAbortCount: navigationAborts.length,
    pageErrors,
    consoleErrors,
    requestFailures,
  }, null, 2))
} catch (error) {
  console.error('[center-panes:gardend] FAILED', error instanceof Error ? error.stack ?? error.message : error)
  console.error('[center-panes:gardend] browser diagnostics', JSON.stringify({
    pageErrors,
    consoleErrors,
    requestFailures,
    navigationAborts,
  }, null, 2))
  throw error
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
  await cell?.kill().catch(() => undefined)
}
