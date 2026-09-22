/**
 * Raw Playwright acceptance journey for the deterministic Organism page.
 *
 * This intentionally does not use a test-runner fixture: the script owns a Vite
 * server and a real Chromium process, drives visible DOM behavior, and exits
 * non-zero on the first failed invariant. The small window.__organism bridge is
 * read-only and is used only for readiness/state corroboration; user behavior is
 * driven through real clicks and keystrokes.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium, type Locator, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_BROWSER_HARNESS_PORT ?? 5197)
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`browser-harness assertion failed: ${message}`)
}

// The home "New document" affordance now opens the shared transactional
// mn-input-dialog (mobile branch, commit a73d220 "unify transactional sheets")
// instead of minting a document inline — the user names it, then confirms.
// Drive that real dialog end to end: click the affordance, type the name into
// the real <input>, and press the real Create button.
async function createDocumentViaDialog(page: Page, home: Locator, title: string): Promise<void> {
  await home.locator('button.new-document').click()
  const dialog = page.locator('mn-input-dialog')
  const input = dialog.locator('input.input')
  await input.waitFor({ state: 'visible' })
  await input.fill(title)
  await dialog.locator('button.confirm-button').click()
}

async function bridgeState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const bridge = (window as unknown as {
      __organism?: { state: Record<string, unknown> }
    }).__organism
    if (!bridge) throw new Error('window.__organism is unavailable')
    return bridge.state
  })
}

async function clickFinalTextGlyph(page: Page, locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  const deadline = Date.now() + 5_000
  let point: { x: number; y: number } | null = null
  while (!point && Date.now() < deadline) {
    try {
      point = await locator.evaluate((element) => {
        // Collaborative undo/redo may replace an individual ProseMirror block while
        // preserving the Class-B host, EditorView, and ProseMirror root. Scroll and
        // measure the semantic locator's current glyph in one browser task so the
        // pointer gesture does not require paragraph-node identity to be persistent.
        if (!element.isConnected) return null
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const editableTextNodes: Text[] = []
        let node = walker.nextNode()
        while (node) {
          if ((node.textContent ?? '').length > 0 && !node.parentElement?.closest('[contenteditable="false"]')) {
            editableTextNodes.push(node as Text)
          }
          node = walker.nextNode()
        }
        for (let nodeIndex = editableTextNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
          const textNode = editableTextNodes[nodeIndex]
          const text = textNode.textContent ?? ''
          for (let offset = text.length - 1; offset >= 0; offset -= 1) {
            if (/\s/u.test(text[offset])) continue
            const range = document.createRange()
            range.setStart(textNode, offset)
            range.setEnd(textNode, offset + 1)
            const rect = Array.from(range.getClientRects())
              .find((candidate) => candidate.width > 0 && candidate.height > 0)
            if (rect) return { x: rect.right - 0.5, y: rect.top + (rect.height / 2) }
          }
        }
        return null
      })
    } catch (error) {
      if (!(error instanceof Error) || !/not attached|detached/iu.test(error.message)) throw error
    }
    if (!point) await page.waitForTimeout(16)
  }
  if (!point) {
    throw new Error('target did not expose a connected, laid-out editable text glyph within 5 seconds')
  }
  await page.mouse.click(point.x, point.y)
}

interface SpeechHarnessSnapshot {
  readonly spoken: Array<{ text: string; rate: number }>
  readonly pauseCount: number
  readonly resumeCount: number
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  // The acceptance script owns one immutable page journey. HMR would turn an
  // unrelated concurrent edit in this shared worktree into a silent full-page
  // reset halfway through the editor persistence assertions.
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  logLevel: 'warn',
})

await server.listen()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

await page.addInitScript({ content: `
  (() => {
    class HarnessUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.lang = '';
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        this.onpause = null;
        this.onresume = null;
      }
    }
    const harness = {
      spoken: [], cancelCount: 0, pauseCount: 0, resumeCount: 0, current: null,
    };
    const synthesis = {
      speak(utterance) {
        harness.current = utterance;
        harness.spoken.push({ text: utterance.text, rate: utterance.rate });
        queueMicrotask(() => utterance.onstart?.());
      },
      cancel() {
        harness.cancelCount += 1;
        const current = harness.current;
        harness.current = null;
        queueMicrotask(() => current?.onerror?.({ error: 'canceled' }));
      },
      pause() {
        harness.pauseCount += 1;
        harness.current?.onpause?.();
      },
      resume() {
        harness.resumeCount += 1;
        harness.current?.onresume?.();
      },
    };
    Object.defineProperty(window, '__speechHarness', { configurable: true, value: harness });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: HarnessUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
  })();
` })

try {
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, {
    // The app's first Vite transform now includes PDF/EPUB reader code and can
    // exceed Playwright's 30s DOMContentLoaded navigation budget on a cold
    // machine. Commit proves the HTTP navigation; readiness below remains the
    // authoritative application gate (and reports boot errors explicitly).
    waitUntil: 'commit',
  })
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { ready?: boolean; error?: string | null } }
    }).__organism
    return bridge?.state.ready === true || Boolean(bridge?.state.error)
  }, undefined, { timeout: 60_000 })

  let state = await bridgeState(page)
  assert(state.error == null, `boot error: ${String(state.error)}`)
  assert(state.backend === 'in-memory-cell', 'unexpected backend identity')
  assert(state.home === true && state.activeDocumentId == null, 'harness should start on the real home surface')
  assert(Number(state.queryCount) >= 4, 'initial shell should query all sidebar projections')

  // Rich Garden home: every row is backed by actual graph-scoped fixture data.
  const home = page.locator('.app-container mn-home-view')
  await home.waitFor({ state: 'visible' })
  assert((await home.locator('button.resume').textContent())?.includes('Research Notes'), 'home resume projection is missing')
  assert(await home.locator('section[aria-label="Pinned"] [data-document-id="architecture"]').count() === 1, 'home pinned projection is missing')
  assert(await home.locator('section[aria-label="Newly Created"] [data-document-id="delivery-plan"]').count() === 1, 'home newly-created projection is missing')
  assert(await home.locator('section[aria-label="Recently Opened"] [data-document-id="research-notes"]').count() === 1, 'home recent projection is missing')
  assert(await home.locator('button.dream').count() === 1, 'real enabled Dream Journal projection is missing')
  const homeGeometry = await home.evaluate((element) => {
    const root = element.shadowRoot
    if (!root) throw new Error('home shadow root missing')
    const main = root.querySelector<HTMLElement>('main.home')!
    const inner = root.querySelector<HTMLElement>('.home-inner')!
    const heading = root.querySelector<HTMLElement>('.heading')!
    const action = root.querySelector<HTMLElement>('button.new-document')!
    const section = root.querySelector<HTMLElement>('section[aria-label="Newly Created"]')!
    const row = section.querySelector<HTMLElement>('.row')!
    const pin = row.querySelector<HTMLElement>('.pin')!
    const mainRect = main.getBoundingClientRect()
    const innerRect = inner.getBoundingClientRect()
    const headingRect = heading.getBoundingClientRect()
    const sectionRect = section.getBoundingClientRect()
    const mainStyle = getComputedStyle(main)
    const innerStyle = getComputedStyle(inner)
    const actionStyle = getComputedStyle(action)
    return {
      // Classic-paper-mode home: a block scroll container whose content is
      // centred by an auto-margin .home-inner column, NOT a flex centred column.
      mainDisplay: mainStyle.display,
      mainOverflowY: mainStyle.overflowY,
      innerMaxWidth: innerStyle.maxWidth,
      // margin:0 auto centres the column; the two side margins match (the page
      // reserves a stable scrollbar gutter, so measure symmetry, not the raw
      // offset from the full-bleed page centre).
      innerMarginDelta: Math.abs(parseFloat(innerStyle.marginLeft) - parseFloat(innerStyle.marginRight)),
      // The centred heading spans the inner column and reads as centred within it.
      headingCenterDelta: Math.abs(
        (headingRect.left + headingRect.width / 2) - (innerRect.left + innerRect.width / 2),
      ),
      innerWidth: innerRect.width,
      sectionWidth: sectionRect.width,
      // The action is a ledger "rule" button: no box border, but a 1px solid
      // top+bottom rule and no side borders.
      actionBorderTopWidth: actionStyle.borderTopWidth,
      actionBorderBottomWidth: actionStyle.borderBottomWidth,
      actionBorderLeftWidth: actionStyle.borderLeftWidth,
      actionBorderRightWidth: actionStyle.borderRightWidth,
      actionBorderTopStyle: actionStyle.borderTopStyle,
      rowBorderBottomWidth: getComputedStyle(row).borderBottomWidth,
      pinOpacity: getComputedStyle(pin).opacity,
    }
  })
  // Classic paper mode (mobile branch, commits 912fdf1 / b1f1d4e): the home is a
  // block scroll container whose content is centred by an auto-margin .home-inner
  // ~460px column — replacing Sophia's flex `align-items:center` column.
  assert(homeGeometry.mainDisplay === 'block', 'classic-paper home is not a block scroll container')
  assert(homeGeometry.mainOverflowY === 'auto', 'classic-paper home lost its own vertical scroll container')
  assert(homeGeometry.innerMaxWidth === '460px', 'classic-paper .home-inner is not capped at the 460px ledger measure')
  assert(homeGeometry.innerMarginDelta <= 0.5, 'classic-paper .home-inner is not auto-centred (asymmetric side margins)')
  assert(homeGeometry.headingCenterDelta <= 1, 'home masthead is not centered within the ledger column')
  assert(homeGeometry.innerWidth > 450 && homeGeometry.innerWidth <= 460.5, 'classic-paper .home-inner is not the reference ~460px measure')
  assert(homeGeometry.sectionWidth > 450 && homeGeometry.sectionWidth <= 460.5, 'home document column is not the full ~460px .home-inner measure')
  assert(
    homeGeometry.actionBorderTopWidth === '1px'
      && homeGeometry.actionBorderBottomWidth === '1px'
      && homeGeometry.actionBorderTopStyle === 'solid'
      && homeGeometry.actionBorderLeftWidth === '0px'
      && homeGeometry.actionBorderRightWidth === '0px',
    'home New Document action lost the classic-paper solid top/bottom rule treatment',
  )
  assert(homeGeometry.rowBorderBottomWidth === '1px', 'home rows lost the classic-paper 1px ledger bottom rule')
  assert(homeGeometry.pinOpacity === '0', 'home pin action should reveal on hover, not remain visually heavy')

  // New -> Home -> Resume is a real CRDT-room journey, not bridge mutation.
  await createDocumentViaDialog(page, home, 'Browser New Document')
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { activeDocumentTitle?: string | null } } }).__organism?.state
    return state?.activeDocumentTitle === 'Browser New Document'
  })
  state = await bridgeState(page)
  const firstCreatedDocumentId = String(state.activeDocumentId)
  await page.locator('mn-top-bar .masthead').click()
  await home.waitFor({ state: 'visible' })
  await home.locator('button.resume').click()
  await page.waitForFunction((documentId) => {
    const state = (window as unknown as { __organism?: { state: { activeDocumentId?: string | null } } }).__organism?.state
    return state?.activeDocumentId === documentId
  }, firstCreatedDocumentId)

  // Today's row creates a real graph-local document and opens its CRDT room.
  await page.locator('mn-top-bar .masthead').click()
  await home.waitFor({ state: 'visible' })
  await home.locator('mn-daily-note-row .row').click()
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { activeDocumentId?: string | null } } }).__organism?.state
    return state?.activeDocumentId === 'daily-note-2026-07-10'
  })
  await page.locator('mn-top-bar .masthead').click()
  await home.waitFor({ state: 'visible' })

  // Workspace lifecycle: create/select an empty graph, create and edit a doc,
  // switch away (proving A/B document isolation), switch back (proving CRDT
  // preservation), then delete the active graph and land on a valid fallback.
  const workspaceSelector = page.locator('mn-top-bar mn-workspace-selector')
  const workspaceTrigger = workspaceSelector.locator('button.trigger')
  await workspaceTrigger.click()
  await workspaceSelector.locator('button.create').click()
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { graphId?: string; home?: boolean } } }).__organism?.state
    return state?.graphId?.startsWith('browser-created-workspace-') === true && state.home === true
  })
  state = await bridgeState(page)
  const createdWorkspaceId = String(state.graphId)
  assert(Array.isArray(state.documentIds) && state.documentIds.length === 0, 'created workspace should start honestly empty')

  await createDocumentViaDialog(page, home, 'Browser New Document')
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { activeDocumentTitle?: string | null } } }).__organism?.state
    return state?.activeDocumentTitle === 'Browser New Document'
  })
  state = await bridgeState(page)
  const createdWorkspaceDocumentId = String(state.activeDocumentId)
  const createdWorkspaceLast = page.locator('sh-editor-host .ProseMirror > p').last()
  await createdWorkspaceLast.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Workspace isolation survives a round trip.')
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { editorText?: string } } }).__organism?.state
    return state?.editorText?.includes('Workspace isolation survives a round trip.') === true
  })
  await page.locator('mn-top-bar .masthead').click()
  await home.waitFor({ state: 'visible' })

  await workspaceTrigger.click()
  await workspaceSelector.locator('[data-graph-id="browser-harness-b"] button.select').click()
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { graphId?: string; home?: boolean } } }).__organism?.state
    return state?.graphId === 'browser-harness-b' && state.home === true
  })
  state = await bridgeState(page)
  assert((state.documentIds as string[]).includes('workspace-b-note'), 'Workspace B document set is missing')
  assert(!(state.documentIds as string[]).includes(createdWorkspaceDocumentId), 'created workspace document leaked into Workspace B')
  assert(await page.locator('mn-sidebar-panel [data-node-id="architecture"]').count() === 0, 'Workspace A sidebar leaked into Workspace B')

  await workspaceTrigger.click()
  await workspaceSelector.locator(`[data-graph-id="${createdWorkspaceId}"] button.select`).click()
  await page.waitForFunction((graph) => {
    const state = (window as unknown as { __organism?: { state: { graphId?: string; home?: boolean } } }).__organism?.state
    return state?.graphId === graph && state.home === true
  }, createdWorkspaceId)
  await home.locator('button.resume').click()
  await page.waitForFunction((documentId) => {
    const state = (window as unknown as { __organism?: { state: { activeDocumentId?: string | null; editorText?: string } } }).__organism?.state
    return state?.activeDocumentId === documentId
      && state.editorText?.includes('Workspace isolation survives a round trip.') === true
  }, createdWorkspaceDocumentId)

  await page.locator('mn-top-bar .masthead').click()
  await home.waitFor({ state: 'visible' })
  await workspaceTrigger.click()
  const createdWorkspaceRow = workspaceSelector.locator(`[data-graph-id="${createdWorkspaceId}"]`)
  await createdWorkspaceRow.locator('button.more').click()
  await workspaceSelector.locator(`.action-menu[data-graph-id="${createdWorkspaceId}"] .action-item[data-action="delete"]`).click()
  await page.waitForFunction((deletedGraph) => {
    const state = (window as unknown as {
      __organism?: { state: { graphId?: string; workspaceIds?: string[]; home?: boolean } }
    }).__organism?.state
    return state?.graphId === 'browser-harness'
      && state.home === true
      && state.workspaceIds?.includes(deletedGraph) === false
  }, createdWorkspaceId)

  // Quick Clip is the real controlled top-bar form composed through the
  // runtime into the same in-memory cell contract. The web and YouTube paths
  // create honest graph documents without opening/replacing the current home.
  const quickClip = page.locator('mn-top-bar mn-quick-clip')
  await quickClip.locator('button[aria-label="Quick clip"]').click()
  const quickClipInput = quickClip.locator('input[aria-label="Web page or YouTube URL"]')
  await quickClipInput.fill('https://example.com/browser-contract')
  await quickClipInput.press('Enter')
  await page.waitForFunction(() => {
    const state = (window as unknown as {
      __organism?: { state: { quickClipStatus?: string; quickClipKind?: string; quickClipDocumentId?: string | null } }
    }).__organism?.state
    return state?.quickClipStatus === 'complete'
      && state.quickClipKind === 'web'
      && Boolean(state.quickClipDocumentId)
  })
  state = await bridgeState(page)
  const webClipDocumentId = String(state.quickClipDocumentId)
  assert((state.documentIds as string[]).includes(webClipDocumentId), 'web clip was not materialized in the active graph')
  assert(
    await home.locator(`section[aria-label="Newly Created"] [data-document-id="${webClipDocumentId}"]`).count() === 1,
    'web clip did not enter the graph-scoped home projection',
  )

  await quickClip.locator('button.another').click()
  await quickClipInput.fill('https://youtu.be/browser-contract')
  await quickClipInput.press('Enter')
  await page.waitForFunction(() => {
    const state = (window as unknown as {
      __organism?: { state: { quickClipStatus?: string; quickClipKind?: string; quickClipDocumentId?: string | null } }
    }).__organism?.state
    return state?.quickClipStatus === 'complete'
      && state.quickClipKind === 'youtube'
      && Boolean(state.quickClipDocumentId)
  })
  state = await bridgeState(page)
  const youtubeClipDocumentId = String(state.quickClipDocumentId)
  assert((state.documentIds as string[]).includes(youtubeClipDocumentId), 'YouTube clip was not materialized in the active graph')
  assert(youtubeClipDocumentId !== webClipDocumentId, 'web and YouTube clips collapsed onto one document')
  await quickClip.locator('button[aria-label="Close quick clip"]').click()

  // Return to the original stable Architecture selector; the rest of this file
  // continues the pre-existing editor/chat/TTS/mobile acceptance journey.
  await home.locator('[data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { activeDocumentId?: string | null } } }).__organism?.state
    return state?.activeDocumentId === 'architecture'
  })

  const breadcrumb = page.locator('mn-top-bar .breadcrumb[aria-current="page"]')
  await breadcrumb.waitFor({ state: 'visible' })
  assert((await breadcrumb.textContent())?.includes('Architecture'), 'live breadcrumb missing active title')

  // Authenticated original-file reader: enter the alternate presentation,
  // prove bytes came through the graph-scoped fixture route, then return to
  // the exact same keyed editor host/editor/ProseMirror objects.
  await page.evaluate(() => {
    const host = document.querySelector('#mn-editor-host') as (Element & { liveEditor?: unknown }) | null
    ;(window as unknown as {
      __originalNodeIdentity?: { host: Element | null; editor: unknown; proseMirror: Element | null }
    }).__originalNodeIdentity = {
      host,
      editor: host?.liveEditor ?? null,
      proseMirror: host?.shadowRoot?.querySelector('.ProseMirror') ?? null,
    }
  })
  const architectureProseMirror = page.locator('sh-editor-host .ProseMirror')
  assert(await architectureProseMirror.getAttribute('contenteditable') === 'false',
    'imported Architecture document was not read-only on entry')
  assert(await page.locator('mn-editor-toolbar [data-read-only-badge]').count() === 1,
    'imported Architecture document did not expose its read-only authority state')
  await page.locator('mn-editor-toolbar [data-original-view-toggle] button').click()
  const originalViewer = page.locator('sh-editor-host mn-original-viewer')
  await originalViewer.locator('.source-pre').waitFor({ state: 'visible' })
  assert(
    (await originalViewer.locator('.source-pre').textContent())?.includes('authenticated original-file fixture'),
    'authenticated original bytes were not rendered',
  )
  assert(await page.locator('sh-editor-host .editor-mount[hidden][inert]').count() === 1,
    'live editor was not made inert during original view')
  assert(await page.locator('mn-editor-toolbar [data-original-annotation-unavailable]').count() === 1,
    'original-view annotation limitation was not surfaced')
  await page.locator('mn-editor-toolbar [data-original-view-toggle] button').click()
  await page.waitForFunction(() => {
    const scope = window as unknown as {
      __originalNodeIdentity?: { host: Element | null; editor: unknown; proseMirror: Element | null }
    }
    const host = document.querySelector('#mn-editor-host') as (Element & { liveEditor?: unknown }) | null
    return host?.shadowRoot?.querySelector('mn-original-viewer') === null
      && scope.__originalNodeIdentity?.host === host
      && scope.__originalNodeIdentity?.editor === host?.liveEditor
      && scope.__originalNodeIdentity?.proseMirror === host?.shadowRoot?.querySelector('.ProseMirror')
  })

  // Imported source documents begin read-only. Make Editable must mutate the
  // document authority in place: the keyed host, editor instance, ProseMirror
  // node, and original-source affordance all survive the transition.
  await page.locator('mn-editor-toolbar [data-make-editable] button').click()
  await page.waitForFunction(() => {
    const scope = window as unknown as {
      __organism?: { state: { activeDocumentReadOnly?: boolean; makeEditableStatus?: string } }
      __originalNodeIdentity?: { host: Element | null; editor: unknown; proseMirror: Element | null }
    }
    const host = document.querySelector('#mn-editor-host') as (Element & { liveEditor?: unknown }) | null
    return scope.__organism?.state.activeDocumentReadOnly === false
      && scope.__organism.state.makeEditableStatus === 'idle'
      && host?.shadowRoot?.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'true'
      && scope.__originalNodeIdentity?.host === host
      && scope.__originalNodeIdentity?.editor === host?.liveEditor
      && scope.__originalNodeIdentity?.proseMirror === host?.shadowRoot?.querySelector('.ProseMirror')
  })
  assert(await page.locator('mn-editor-toolbar [data-read-only-badge]').count() === 0,
    'read-only authority badge survived Make Editable')
  assert(await page.locator('mn-editor-toolbar [data-original-view-toggle]').count() === 1,
    'Make Editable discarded persisted original-source metadata')

  // Real rich-editor behavior: type through Chromium, retain a keyboard selection
  // across a toolbar click, apply an inline mark, transform the live block, and
  // exercise the collaboration-owned undo/redo history. These are deliberately
  // DOM-driven interactions rather than calls through liveEditor/the bridge.
  const architectureLast = page.locator('#mn-editor-host .ProseMirror > p').last()
  await clickFinalTextGlyph(page, architectureLast)
  await page.keyboard.type(' Browser typing is live.')
  await page.waitForFunction(() => {
    const bridge = (window as unknown as { __organism?: { state: { editorText?: string } } }).__organism
    return bridge?.state.editorText?.includes('Browser typing is live.') === true
  })

  // Isolate keyboard history against plain text while ProseMirror still owns
  // focus. This avoids conflating the keymap/UndoManager contract with a later
  // native select's focus behavior or block-attribute history semantics.
  await page.waitForTimeout(650)
  await page.keyboard.type(' Undo round trip.')
  await page.waitForFunction(() => {
    const bridge = (window as unknown as { __organism?: { state: { editorText?: string } } }).__organism
    return bridge?.state.editorText?.includes('Undo round trip.') === true
  })
  await page.waitForTimeout(250)
  await page.keyboard.press(`${primaryModifier}+z`)
  await page.waitForFunction(() => {
    const text = document.querySelector('#mn-editor-host')?.shadowRoot?.querySelector('.ProseMirror')?.textContent ?? ''
    return text.includes('Browser typing is live.') && !text.includes('Undo round trip.')
  })
  await page.keyboard.press(`${primaryModifier}+Shift+z`)
  await page.waitForFunction(() => {
    const text = document.querySelector('#mn-editor-host')?.shadowRoot?.querySelector('.ProseMirror')?.textContent ?? ''
    return text.includes('Undo round trip.')
  })
  const historyEditorIdentity = await page.evaluate(() => {
    const scope = window as unknown as {
      __originalNodeIdentity?: { host: Element | null; editor: unknown; proseMirror: Element | null }
    }
    const host = document.querySelector('#mn-editor-host') as (Element & { liveEditor?: unknown }) | null
    return scope.__originalNodeIdentity?.host === host
      && scope.__originalNodeIdentity?.editor === host?.liveEditor
      && scope.__originalNodeIdentity?.proseMirror === host?.shadowRoot?.querySelector('.ProseMirror')
  })
  assert(historyEditorIdentity, 'undo/redo replaced the Class-B host, EditorView, or ProseMirror root')

  // Select "trip." using the real editor selection, then use the real toolbar.
  // keepFocus on the toolbar control is load-bearing: it must not collapse the
  // ProseMirror selection before the command executes.
  const richParagraph = page.locator('#mn-editor-host .ProseMirror > p', {
    hasText: 'Browser typing is live. Undo round trip.',
  })
  await clickFinalTextGlyph(page, richParagraph)
  for (let index = 0; index < 'trip.'.length; index += 1) {
    await page.keyboard.press('Shift+ArrowLeft')
  }
  await page.locator('mn-editor-toolbar [data-format-command="bold"] button').click()
  const boldLiveText = page.locator('#mn-editor-host .ProseMirror strong', { hasText: 'trip.' })
  await boldLiveText.waitFor({ state: 'visible' })

  // Yjs intentionally coalesces edits inside its capture window. Let the inline
  // edit settle before starting a distinct block-formatting gesture, matching a
  // human pause and giving undo a meaningful semantic boundary.
  await page.waitForTimeout(650)
  await page.locator('mn-editor-toolbar [data-block-select] button.trigger').click()
  await page.locator('mn-editor-toolbar [data-block-select] [data-menu-item-id="heading2"]').click()
  const transformedHeading = page.locator('#mn-editor-host .ProseMirror > h2', {
    hasText: 'Browser typing is live. Undo round trip.',
  })
  await transformedHeading.waitFor({ state: 'visible' })
  assert(await boldLiveText.count() === 1, 'inline formatting was lost during the block transform')

  // Table insertion replaces a non-empty ProseMirror selection by design. Put
  // the caret at the end first, matching an intentional user insertion and
  // ensuring this step does not consume the just-formatted text range.
  await clickFinalTextGlyph(page, transformedHeading)
  await page.waitForTimeout(650)
  await page.locator('mn-editor-toolbar [data-table-command] button').click()
  const insertedTable = page.locator('#mn-editor-host .ProseMirror table')
  await insertedTable.waitFor({ state: 'visible' })

  // Leave the alternate reader active while switching documents. Provider
  // cleanup must revoke the old view before the new room becomes interactive.
  await page.locator('mn-editor-toolbar [data-original-view-toggle] button').click()
  await originalViewer.locator('.source-pre').waitFor({ state: 'visible' })

  // Real sidebar behavior: component-local search, clear, then a click-driven CRDT room swap.
  const sidebar = page.locator('mn-sidebar-panel')
  const search = sidebar.locator('input.search-input')
  await search.fill('Research')
  await sidebar.locator('[data-node-id="research-notes"]').waitFor({ state: 'visible' })
  assert(await sidebar.locator('[data-node-id="architecture"]').count() === 0, 'sidebar search did not filter')
  await search.fill('')
  await sidebar.locator('[data-node-id="research-notes"]').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { activeDocumentId?: string; editorText?: string } }
    }).__organism
    return bridge?.state.activeDocumentId === 'research-notes'
      && bridge.state.editorText?.includes('Exercise behavior in Chromium') === true
  })
  assert((await breadcrumb.textContent())?.includes('Research Notes'), 'breadcrumb did not follow document switch')
  assert(await page.locator('sh-editor-host mn-original-viewer').count() === 0,
    'original viewer survived a document/provider swap')
  assert(await page.locator('mn-editor-toolbar [data-original-view-toggle]').count() === 0,
    'ordinary Research document exposed an unavailable original-file action')
  state = await bridgeState(page)
  assert(state.originalFetchCount === 2 && state.authenticatedOriginalFetchCount === 2,
    'original-file requests did not all traverse the authenticated fixture route')

  // Browser-local TTS: start at the real editor cursor, drive the controlled
  // player, and verify SpeechSynthesis receives real live-block text/settings.
  const spokenParagraph = page.locator('sh-editor-host .ProseMirror > p', {
    hasText: 'Exercise behavior in Chromium',
  })
  await spokenParagraph.click()
  await page.locator('mn-editor-toolbar [data-tts-command]').click()
  await page.locator('mn-tts-player .tts-bar').waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const state = (window as unknown as { __organism?: { state: { ttsStatus?: string } } }).__organism?.state
    return state?.ttsStatus === 'playing'
  })
  let speech: SpeechHarnessSnapshot = await page.evaluate(() => {
    const source = (window as unknown as { __speechHarness: SpeechHarnessSnapshot }).__speechHarness
    return { spoken: [...source.spoken], pauseCount: source.pauseCount, resumeCount: source.resumeCount }
  })
  assert(speech.spoken.at(-1)?.text === 'Exercise behavior in Chromium, not only happy-dom.',
    'TTS did not start at the live cursor block')
  assert(await page.locator('sh-editor-host style[data-organism-tts-highlight]').count() === 1,
    'active speech highlight style was not installed')
  assert((await spokenParagraph.evaluate(node => getComputedStyle(node).boxShadow)) !== 'none',
    'active speech block was not visibly highlighted')

  await page.locator('mn-tts-player button[title="Next block"]').click()
  await page.waitForFunction(() => {
    const state = (window as unknown as {
      __organism?: { state: { ttsBlockIndex?: number } }
    }).__organism?.state
    return state?.ttsBlockIndex === 2
  })
  await page.locator('mn-tts-player select[title="Playback speed"]').selectOption('1.5')
  await page.locator('mn-tts-player button[title="Pause"]').click()
  await page.locator('mn-tts-player button[title="Resume"]').waitFor({ state: 'visible' })
  await page.locator('mn-tts-player button[title="Resume"]').click()
  speech = await page.evaluate(() => {
    const source = (window as unknown as { __speechHarness: SpeechHarnessSnapshot }).__speechHarness
    return { spoken: [...source.spoken], pauseCount: source.pauseCount, resumeCount: source.resumeCount }
  })
  assert(speech.spoken.at(-1)?.rate === 1.5, 'TTS speed change did not restart the live block')
  assert(speech.pauseCount === 1 && speech.resumeCount === 1, 'TTS pause/resume did not reach SpeechSynthesis')

  // A real document/provider swap must cancel playback and clear the player.
  await search.fill('Architecture')
  await sidebar.locator('[data-node-id="architecture"]').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { activeDocumentId?: string; ttsStatus?: string } }
    }).__organism
    return bridge?.state.activeDocumentId === 'architecture' && bridge.state.ttsStatus === 'idle'
  })
  assert(await page.locator('mn-tts-player .tts-bar').count() === 0, 'TTS player survived a document swap')
  // Route state commits before the provider-gated editor replacement. Wait for
  // the returning room's rich body so count() never samples the outgoing room.
  try {
    await transformedHeading.waitFor({ state: 'visible', timeout: 10_000 })
  } catch (error) {
    const observed = await page.locator('sh-editor-host').evaluate((host) => ({
      documentId: (window as unknown as {
        __organism?: { state: { activeDocumentId?: string; editorText?: string } }
      }).__organism?.state.activeDocumentId,
      editorText: (window as unknown as {
        __organism?: { state: { activeDocumentId?: string; editorText?: string } }
      }).__organism?.state.editorText,
      editorHtml: host.shadowRoot?.querySelector('.ProseMirror')?.innerHTML ?? '',
    }))
    throw new Error(`returning rich room did not settle: ${JSON.stringify(observed)}; ${String(error)}`)
  }
  assert(await transformedHeading.count() === 1, 'block formatting did not survive a real document round trip')
  assert(await boldLiveText.count() === 1, 'inline formatting did not survive a real document round trip')
  assert(await insertedTable.count() === 1, 'inserted table did not survive a real document round trip')
  await search.fill('Research')
  await sidebar.locator('[data-node-id="research-notes"]').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { activeDocumentId?: string } }
    }).__organism
    return bridge?.state.activeDocumentId === 'research-notes'
  })
  await search.fill('')

  // Real chrome behavior: event leaves shadow DOM, shell applies dark tokens, rerenders.
  await page.locator('mn-top-bar button[aria-label="Toggle theme"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  state = await bridgeState(page)
  assert(state.theme === 'dark', 'theme state did not follow chrome intent')

  // Real in-process chat: type/send, fold event stream, and render the assistant echo.
  const composer = page.locator('sh-chat-host sh-chat-panel hoja-editor .ProseMirror[aria-label^="Message "]')
  await composer.fill('Browser contract round trip')
  await composer.press('Enter')
  const assistant = page.locator('sh-chat-host sh-chat-panel .message.assistant', {
    hasText: 'You said: Browser contract round trip',
  })
  await assistant.waitFor({ state: 'visible' })

  // A surrounding shell rerender must not erase the mounted chat conversation.
  await page.locator('mn-bottom-bar button[aria-label="Toggle wires panel"]').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as { __organism?: { state: { rightPanel?: string } } }).__organism
    return bridge?.state.rightPanel === 'wires'
  })
  await page.locator('[data-panel="wires"] sh-wires-panel').waitFor({ state: 'visible' })
  // The scalar grammar intentionally hides Chat while Wires is selected. A
  // return to Sophia proves the live chat host survived that replacement.
  await page.locator('mn-bottom-bar button[aria-label="Toggle Sophia panel"]').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as { __organism?: { state: { rightPanel?: string } } }).__organism
    return bridge?.state.rightPanel === 'chat'
  })
  await assistant.waitFor({ state: 'visible' })
  assert(await assistant.isVisible(), 'chat conversation was lost across panel replacement')
  assert(await composer.isEnabled(), 'chat composer was lost or disabled across panel replacement')

  // Responsive Garden shell: shrink the same live workspace into a phone. The
  // controller must reuse (not clone/remount) the keyed editor/chat organisms.
  await page.evaluate(() => {
    const scope = window as unknown as {
      __mobileNodeIdentity?: { editor: Element | null; chat: Element | null }
    }
    scope.__mobileNodeIdentity = {
      editor: document.querySelector('#mn-editor-host'),
      chat: document.querySelector('sh-chat-host'),
    }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const bridge = (window as unknown as { __organism?: { state: { mobile?: boolean } } }).__organism
    return bridge?.state.mobile === true
  })
  const mobileShell = page.locator('.organism-mobile-shell[data-active="true"]')
  await mobileShell.waitFor({ state: 'visible' })
  const mobileTabs = mobileShell.locator('mn-mobile-tabs button')
  assert(await mobileTabs.count() === 3, 'mobile Home/Browse/Sophia destinations were not mounted')

  // Type in the real editor, return explicitly to its Home root, then resume
  // the pushed detail without losing the CRDT body.
  const mobileEditorLast = page.locator('sh-editor-host .ProseMirror > p').last()
  await mobileEditorLast.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Mobile typing survives tabs.')
  await page.waitForFunction(() => {
    const bridge = (window as unknown as { __organism?: { state: { editorText?: string } } }).__organism
    return bridge?.state.editorText?.includes('Mobile typing survives tabs.') === true
  })
  await mobileShell.locator('.organism-mobile-back').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { mobileTab?: string; mobileCenterMode?: string } }
    }).__organism
    return bridge?.state.mobileTab === 'home' && bridge.state.mobileCenterMode === 'home'
  })
  const mobileHome = mobileShell.locator('.organism-mobile-home[data-visible="true"] mn-home-view')
  await mobileHome.waitFor({ state: 'visible' })
  assert(await mobileHome.locator('section[aria-label="Pinned"]').count() === 1, 'mobile home lost the controlled pinned projection')
  await mobileTabs.nth(0).click()
  assert((await bridgeState(page)).mobileCenterMode === 'home', 'active Home retap toggled the detail path')
  await mobileHome.locator('button.resume').click()
  await mobileEditorLast.waitFor({ state: 'visible' })
  assert(
    (await bridgeState(page)).editorText?.toString().includes('Mobile typing survives tabs.'),
    'editor text was lost across explicit Back/home/resume',
  )

  // The controlled mobile file list routes through the same sidebar opener and
  // swaps to a different real in-memory CRDT room.
  await mobileTabs.nth(1).click()
  const mobileFiles = mobileShell.locator('mn-mobile-file-list')
  await mobileFiles.locator('[data-node-id="architecture"]').click()
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { activeDocumentId?: string; mobileTab?: string; editorText?: string } }
    }).__organism
    return bridge?.state.activeDocumentId === 'architecture'
      && bridge.state.mobileTab === 'browse'
      && bridge.state.editorText?.includes('Browser typing is live.') === true
  })

  // Mobile Sophia uses the existing chat host. A round trip must remain in the
  // DOM after returning to desktop, with exact node identity preserved.
  await mobileTabs.nth(2).click()
  const mobileComposer = page.locator('sh-chat-host sh-chat-panel hoja-editor .ProseMirror[aria-label^="Message "]')
  await mobileComposer.fill('Mobile chat survives desktop')
  await mobileComposer.press('Enter')
  const mobileAssistant = page.locator('sh-chat-host sh-chat-panel .message.assistant', {
    hasText: 'You said: Mobile chat survives desktop',
  })
  await mobileAssistant.waitFor({ state: 'visible' })

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForFunction(() => {
    const scope = window as unknown as {
      __organism?: { state: { mobile?: boolean } }
      __mobileNodeIdentity?: { editor: Element | null; chat: Element | null }
    }
    return scope.__organism?.state.mobile === false
      && scope.__mobileNodeIdentity?.editor === document.querySelector('#mn-editor-host')
      && scope.__mobileNodeIdentity?.chat === document.querySelector('sh-chat-host')
  })
  assert(await mobileAssistant.isVisible(), 'mobile chat round trip was lost on desktop transition')

  state = await bridgeState(page)
  assert(state.activeDocumentId === 'architecture', 'mobile file-list document switch drifted')
  assert(Number(state.queryCount) >= 8, 'document switch did not re-read backend projections')
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    activeDocumentId: state.activeDocumentId,
    theme: state.theme,
    rightPanel: state.rightPanel,
    queryCount: state.queryCount,
    editorTyped: true,
    editorInlineFormatting: true,
    editorBlockTransform: true,
    editorUndoRedo: true,
    editorClassBIdentityAfterHistory: historyEditorIdentity,
    editorTableTransaction: true,
    editorRichStateSurvivedDocumentRoundTrip: true,
    chatRoundTrip: true,
    chatSurvivedShellRerender: true,
    ttsBrowserPlayback: true,
    ttsDocumentCleanup: true,
    mobileViewportJourney: true,
    mobileEditorSurvivedTabs: true,
    mobileChatSurvivedDesktop: true,
    desktopMobileNodeIdentity: true,
    homeNewResumeDaily: true,
    homeHonestProjections: true,
    workspaceCreateSwitchIsolation: true,
    workspaceRoundTripPreserved: true,
    workspaceDeleteFallback: true,
    quickClipWebAndYoutube: true,
    quickClipGraphProjection: true,
    importedDocumentReadOnly: true,
    importedDocumentMadeEditableInPlace: true,
    originalFileAuthenticated: true,
    originalFileEditorIdentity: true,
    originalFileProviderCleanup: true,
    originalFileMetadataIsolation: true,
  }, null, 2)}\n`)
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
