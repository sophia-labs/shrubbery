/**
 * Real-Chromium proof that the comments side pane FILLS its host container.
 *
 * Regression coverage for: "comments rendering has lots of blank space and
 * doesn't fill up the side pane right." Drives the production renderWorkspace
 * -> renderCommentsPanel -> mn-comments-panel chain through the same
 * graph-browser-harness.html fixture the 3-D graph proof uses (it already
 * wires a "Comments panel" control). No mock DOM, no fake layout engine —
 * real Chromium computes the flex chain from `.right-panel` (apps/organism/
 * index.html's structural CSS, mirrored in this fixture's own <style>) down
 * through mn-comments-panel's shadow root.
 *
 * Two real states are checked, because a shrink-to-fit host's collapse is
 * CONTENT-DEPENDENT: with the empty state (no text at all) the collapse is
 * deterministic and severe; with a wall of unwrapped long paragraphs the
 * host's own max-content width can incidentally exceed the pane and mask the
 * bug entirely (verified by hand while diagnosing — see the worker-U
 * receipt). So this proof checks the state most users actually hit first
 * (opening the pane on a document with no comments yet) for width-fill +
 * vertical centering, and a populated state of realistically SHORT comments
 * (the common "lgtm" / "fixed" case, not epic paragraphs) for width-fill
 * plus scroll-not-stretch.
 *
 * Watch it happen with:
 *   SHRUBBERY_HEADED=1 SHRUBBERY_SLOW_MO=140 pnpm --dir apps/organism test:comments-panel-browser
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_COMMENTS_BROWSER_PORT ?? 5208)
const headed = process.env.SHRUBBERY_HEADED === '1'
const slowMoValue = Number(process.env.SHRUBBERY_SLOW_MO ?? (headed ? 100 : 0))
const slowMo = Number.isFinite(slowMoValue) ? Math.max(0, slowMoValue) : 0
// Defaults outside the repo (a scratch OS temp dir) — screenshots are
// evidence for a human/reviewer to inspect on demand, not repo artifacts.
// Pass SHRUBBERY_COMMENTS_SCREENSHOT_DIR to collect them somewhere durable.
const screenshotDir = process.env.SHRUBBERY_COMMENTS_SCREENSHOT_DIR
  ?? join(tmpdir(), 'shrubbery-comments-panel-screenshots')
const screenshotTag = process.env.SHRUBBERY_COMMENTS_SCREENSHOT_TAG ?? 'run'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`comments-panel-browser-harness assertion failed: ${message}`)
}

interface HarnessState {
  readonly ready?: boolean
  readonly error?: string | null
  readonly rightPanel?: string
  readonly rightCollapsed?: boolean
}

interface PaneRect {
  readonly width: number
  readonly height: number
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

interface PaneGeometry {
  readonly paneRect: PaneRect | null
  readonly panelRect: PaneRect | null
  readonly emptyStateRect: PaneRect | null
  readonly commentsContainerRect: PaneRect | null
  readonly hostComputedWidth: string | null
  readonly commentsContainerScrollHeight: number | null
  readonly commentsContainerClientHeight: number | null
  readonly commentCardCount: number
}

async function state(page: Page): Promise<HarnessState> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __graphHarness?: { state: HarnessState } }).__graphHarness
    if (!bridge) throw new Error('window.__graphHarness is unavailable')
    return bridge.state
  })
}

async function paneGeometry(page: Page): Promise<PaneGeometry> {
  return page.evaluate(() => {
    // Inline (not a nested named helper): tsx/esbuild's dev transform wraps
    // NAMED nested function/const-arrow bindings in a `__name(...)` call
    // whose helper only exists in the module's own scope — Playwright's
    // page.evaluate(fn) sends just fn.toString() to the browser, so any such
    // wrapped reference throws "__name is not defined" there. See the same
    // gotcha documented in layout-workbench-gardend-browser.mts.
    const pane = document.querySelector('.right-panel-body')
    const panel = document.querySelector('.right-panel-body mn-comments-panel')
    const shadow = panel?.shadowRoot ?? null
    const emptyState = shadow?.querySelector('.empty-state') ?? null
    const container = shadow?.querySelector('.comments-container') as HTMLElement | null

    const paneBox = pane?.getBoundingClientRect() ?? null
    const panelBox = panel?.getBoundingClientRect() ?? null
    const emptyBox = emptyState?.getBoundingClientRect() ?? null
    const containerBox = container?.getBoundingClientRect() ?? null

    return {
      paneRect: paneBox
        ? { width: paneBox.width, height: paneBox.height, top: paneBox.top, left: paneBox.left, bottom: paneBox.bottom, right: paneBox.right }
        : null,
      panelRect: panelBox
        ? { width: panelBox.width, height: panelBox.height, top: panelBox.top, left: panelBox.left, bottom: panelBox.bottom, right: panelBox.right }
        : null,
      emptyStateRect: emptyBox
        ? { width: emptyBox.width, height: emptyBox.height, top: emptyBox.top, left: emptyBox.left, bottom: emptyBox.bottom, right: emptyBox.right }
        : null,
      commentsContainerRect: containerBox
        ? { width: containerBox.width, height: containerBox.height, top: containerBox.top, left: containerBox.left, bottom: containerBox.bottom, right: containerBox.right }
        : null,
      hostComputedWidth: panel ? getComputedStyle(panel).width : null,
      commentsContainerScrollHeight: container ? container.scrollHeight : null,
      commentsContainerClientHeight: container ? container.clientHeight : null,
      commentCardCount: shadow?.querySelectorAll('[data-comment-id]').length ?? 0,
    }
  })
}

await mkdir(screenshotDir, { recursive: true })

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  logLevel: 'warn',
})

await server.listen()
const browser = await chromium.launch({ headless: !headed, slowMo })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 })
const pageErrors: string[] = []
const consoleErrors: string[] = []

page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`http://127.0.0.1:${port}/graph-browser-harness.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(() => {
    const current = (window as unknown as { __graphHarness?: { state: HarnessState } }).__graphHarness?.state
    return current?.ready === true || Boolean(current?.error)
  }, undefined, { timeout: 60_000 })
  const boot = await state(page)
  assert(boot.error == null, `fixture boot failed: ${String(boot.error)}`)

  // ── Scenario 1: EMPTY state — the deterministic, most-common-first case. ──
  await page.locator('[data-proof-action="comments"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __graphHarness?: { state: HarnessState } }).__graphHarness?.state.rightPanel === 'comments')
  await page.waitForSelector('.right-panel-body mn-comments-panel')
  await page.waitForTimeout(120)

  const empty = await paneGeometry(page)
  assert(empty.paneRect != null, '.right-panel-body did not render')
  assert(empty.panelRect != null, 'mn-comments-panel did not render inside .right-panel-body')
  assert(empty.commentCardCount === 0, `expected the empty scenario to have 0 cards, found ${empty.commentCardCount}`)
  assert(empty.emptyStateRect != null, '.empty-state did not render for zero comments')

  await page.locator('.right-panel-body').screenshot({
    path: resolve(screenshotDir, `comments-empty-${screenshotTag}.png`),
  })
  await page.screenshot({ path: resolve(screenshotDir, `comments-empty-full-${screenshotTag}.png`) })

  const emptyPane = empty.paneRect!
  const emptyPanel = empty.panelRect!
  const emptyBox = empty.emptyStateRect!
  const emptyWidthGap = emptyPane.width - emptyPanel.width
  const emptyHeightGap = emptyPane.height - emptyPanel.height
  // How far the empty-state's own vertical center sits from the pane's
  // vertical center. A properly-filled/centered empty state should land near
  // 0; a block stranded at the top of an unfilled container reports a large
  // positive offset (the block's midpoint sits well above the pane's).
  const emptyStateCenterOffset = (emptyPane.top + emptyPane.height / 2) - (emptyBox.top + emptyBox.height / 2)

  process.stdout.write(`${JSON.stringify({
    tag: `${screenshotTag}-empty`,
    paneRect: emptyPane,
    panelRect: emptyPanel,
    emptyStateRect: emptyBox,
    widthGap: Number(emptyWidthGap.toFixed(2)),
    heightGap: Number(emptyHeightGap.toFixed(2)),
    emptyStateCenterOffset: Number(emptyStateCenterOffset.toFixed(2)),
  }, null, 2)}\n`)

  // ── Scenario 2: populated with realistically SHORT comments. ──
  await page.locator('[data-proof-action="comments-many"]').click()
  await page.waitForFunction(() => {
    const shadow = document.querySelector('.right-panel-body mn-comments-panel')?.shadowRoot
    return (shadow?.querySelectorAll('[data-comment-id]').length ?? 0) === 8
  })
  await page.waitForTimeout(120)

  const populated = await paneGeometry(page)
  assert(populated.commentCardCount === 8, `expected 8 seeded comments, found ${populated.commentCardCount}`)
  const pane = populated.paneRect!
  const panel = populated.panelRect!
  const widthGap = pane.width - panel.width
  const heightGap = pane.height - panel.height

  await page.locator('.right-panel-body').screenshot({
    path: resolve(screenshotDir, `comments-populated-${screenshotTag}.png`),
  })
  await page.screenshot({ path: resolve(screenshotDir, `comments-populated-full-${screenshotTag}.png`) })

  process.stdout.write(`${JSON.stringify({
    tag: `${screenshotTag}-populated`,
    paneRect: pane,
    panelRect: panel,
    widthGap: Number(widthGap.toFixed(2)),
    heightGap: Number(heightGap.toFixed(2)),
    hostComputedWidth: populated.hostComputedWidth,
    commentsContainerScrollHeight: populated.commentsContainerScrollHeight,
    commentsContainerClientHeight: populated.commentsContainerClientHeight,
    overflowsWithinPane: (populated.commentsContainerScrollHeight ?? 0) > (populated.commentsContainerClientHeight ?? 0),
    consoleErrors,
    pageErrors,
  }, null, 2)}\n`)

  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)

  // The structural assertions this test exists to guard:

  // 1. The panel must fill its host pane's width/height in BOTH scenarios,
  //    not shrink-to-fit its content and leave dead space beside/below it.
  assert(Math.abs(emptyWidthGap) < 1, `[empty] mn-comments-panel left ${emptyWidthGap.toFixed(1)}px of blank width in the pane (pane=${emptyPane.width}, panel=${emptyPanel.width})`)
  assert(Math.abs(emptyHeightGap) < 1, `[empty] mn-comments-panel left ${emptyHeightGap.toFixed(1)}px of blank height in the pane (pane=${emptyPane.height}, panel=${emptyPanel.height})`)
  assert(Math.abs(widthGap) < 1, `[populated] mn-comments-panel left ${widthGap.toFixed(1)}px of blank width in the pane (pane=${pane.width}, panel=${panel.width})`)
  assert(Math.abs(heightGap) < 1, `[populated] mn-comments-panel left ${heightGap.toFixed(1)}px of blank height in the pane (pane=${pane.height}, panel=${panel.height})`)

  // 2. The empty state should be vertically centered in the pane (its own
  //    CSS already asks for align-content:center / justify-items:center —
  //    it just needs a parent that actually gives it the full height to
  //    center within).
  assert(Math.abs(emptyStateCenterOffset) < 24, `empty state is not vertically centered in the pane (offset=${emptyStateCenterOffset.toFixed(1)}px, pane center vs empty-state center)`)

  // 3. The pane's own outer height must stay pinned to the shell (not grow
  //    to accommodate a long/overflowing comment thread) — content scrolls
  //    inside instead of stretching the pane.
  assert(pane.height <= 960 - pane.top + 1, `pane grew past the viewport instead of scrolling internally (bottom=${pane.bottom})`)
  assert(
    (populated.commentsContainerScrollHeight ?? 0) > (populated.commentsContainerClientHeight ?? 0),
    'the 8 seeded comments did not overflow .comments-container — the scroll-not-stretch behavior is untested',
  )

  process.stdout.write('comments-panel-browser-harness: PASS\n')
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
