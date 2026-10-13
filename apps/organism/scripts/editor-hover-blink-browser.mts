/**
 * editor-hover-blink-browser.mts — why the block you are typing in flickers.
 *
 * REPORTED: "the block background blinks as you type it's fucking annoying …
 * like the faint green part".
 *
 * There are TWO hover treatments on an editor block, which is worth knowing
 * before blaming either:
 *
 *   editor-host.ts:1389  `p/h1/h2/h3:hover { background: --mn-color-surface-hover }`
 *   editor-host.ts:1924  `:hover { box-shadow: inset -3px 0 0 --mn-color-accent }`
 *                        — the green right-edge bar hinting at the value gutter
 *
 * THE HYPOTHESIS. ProseMirror owns the editor's DOM and redraws nodes on
 * change; a replaced element is a NEW element, and `:hover` is a state the
 * browser assigns from pointer position at hit-test time. A pointer resting
 * still over a paragraph that is being replaced under it can therefore lose
 * the hover state and regain it, repeatedly, while the pointer never moves.
 * That would flicker exactly while typing and never otherwise.
 *
 * That is a story, and a plausible story is precisely what this repo has been
 * bitten by all week. So this measures three things and lets them disagree:
 *
 *   1. Is the paragraph element the SAME NODE after typing? (identity)
 *   2. Does the live `:hover` match move off it? (`document.querySelector(':hover')`)
 *   3. Does its computed background actually change, sampled per frame?
 *
 * (3) is the report. (1) and (2) are the mechanism. If (3) flickers while (1)
 * says the node survived, the cause is something else entirely and the fix
 * below would have been aimed at nothing.
 *
 *   pnpm -C apps/organism run test:editor-hover-blink
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_BLINK_PORT ?? 5270)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'editor-hover-blink-probe'
const DOC_ID = 'blink-doc'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`editor-hover-blink-browser assertion failed: ${message}`)
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
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'blink probe' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_ID, title: 'Blink probe' })
  await mcp.toolsCall('write_document', {
    graphId: GRAPH_ID,
    documentId: DOC_ID,
    content: [
      '<h1>Blink probe</h1>',
      '<p>This paragraph is the one the pointer rests on while typing into it.</p>',
      '<p>A second paragraph, so the first is not the only candidate.</p>',
    ].join(''),
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

  browser = await engine.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const page = await browser.newPage({ viewport: { width: 1512, height: 944 } })
  page.on('pageerror', error => console.error(`[pageerror] ${error.message}`))
  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.waitForFunction(
    () => !!document.querySelector('mn-sidebar-panel')?.shadowRoot?.querySelector('[data-file-pane-body]'),
    undefined,
    { timeout: 60_000 },
  )
  await page.evaluate((documentId) => {
    const panel = document.querySelector('mn-sidebar-panel') as HTMLElement | null
    const row = panel?.shadowRoot?.querySelector(`[data-node-id="${documentId}"]`) as HTMLElement | null
    row?.click()
  }, DOC_ID)
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    return !!host?.shadowRoot?.querySelector('.editor-mount [contenteditable="true"] p')
  }, undefined, { timeout: 60_000 })
  await page.waitForTimeout(1200)

  // Put the pointer in the MIDDLE of the paragraph's text, where a reader's
  // pointer sits, and leave it there for the whole run. Never move it again:
  // the claim is that the flicker happens with a still pointer.
  const target = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const paragraph = host?.shadowRoot?.querySelector('.editor-mount [contenteditable="true"] p') as HTMLElement | null
    if (!paragraph) return null
    const rect = paragraph.getBoundingClientRect()
    ;(globalThis as { __blinkNode?: HTMLElement }).__blinkNode = paragraph
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  assert(target, 'a paragraph to hover')
  // CLICK, don't just hover. An earlier version only moved the pointer here,
  // so the editor never took focus, `page.keyboard.type` typed into nothing,
  // and the run reported a perfectly steady paragraph — of a document nobody
  // was editing. `data-block-focused: false` in every sample was the tell.
  // Clicking is also the honest gesture: you click where you want to type and
  // then type without moving the mouse, which is the reported situation exactly.
  await page.mouse.click(target!.x, target!.y)
  await page.waitForTimeout(500)

  const resting = await page.evaluate(() => {
    const node = (globalThis as { __blinkNode?: HTMLElement }).__blinkNode!
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, boxShadow: style.boxShadow }
  })
  console.log('resting, pointer over the paragraph, not typing:')
  console.log(`  background: ${resting.background}`)
  console.log(`  box-shadow: ${resting.boxShadow}\n`)

  // Sample every animation frame while keystrokes land. Per-frame, because a
  // flicker is a thing that happens between two states a human sees; polling
  // slower than the compositor would miss exactly the event being described.
  // NO NAMED INNER FUNCTION IN HERE. tsx compiles this file with esbuild's
  // keepNames helper, which rewrites `const tick = () => …` into a `__name(…)`
  // call — a helper that exists in Node and NOT in the page, so the evaluate
  // dies with "__name is not defined". An arrow passed straight in as an
  // argument is never given a name and is safe; a sampler written as a named
  // recursive rAF callback is not. Hence a bare `setInterval` at ~120Hz rather
  // than the requestAnimationFrame recursion this obviously wants to be.
  await page.evaluate(() => {
    const state = globalThis as unknown as {
      __blinkNode: HTMLElement
      __blinkSamples: Array<{ t: number; bg: string; shadow: string; focused: boolean; sameNode: boolean; hoverTag: string }>
      __blinkTimer?: ReturnType<typeof setInterval>
    }
    const original = state.__blinkNode
    state.__blinkSamples = []
    const started = performance.now()
    state.__blinkTimer = setInterval(() => {
      const host = document.querySelector('sh-editor-host') as HTMLElement | null
      const root = host?.shadowRoot ?? null
      const live = root?.querySelector('.editor-mount [contenteditable="true"] p') as HTMLElement | null
      const hovered = root?.querySelector(':hover')
      if (!live) return
      const style = getComputedStyle(live)
      state.__blinkSamples.push({
        t: Math.round(performance.now() - started),
        bg: style.backgroundColor,
        // THE FULL VALUE. An earlier version of this sampler flattened
        // box-shadow to 'none' | 'inset-bar', which cannot tell the HOVER bar
        // (inset -3px, right edge) from the FOCUS bar (inset 2px, left edge)
        // — and both are box-shadows on the same element. A flicker between
        // them read as a constant, and the run reported "no flicker observed"
        // about the very thing it was built to catch.
        shadow: style.boxShadow,
        focused: live.hasAttribute('data-block-focused'),
        sameNode: live === original,
        hoverTag: hovered ? hovered.tagName.toLowerCase() : 'none',
      })
    }, 8)
  })

  const before = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const paragraph = host?.shadowRoot?.querySelector('.editor-mount [contenteditable="true"] p') as HTMLElement | null
    return paragraph?.textContent ?? ''
  })
  await page.keyboard.type(' typing into this line', { delay: 60 })
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const paragraph = host?.shadowRoot?.querySelector('.editor-mount [contenteditable="true"] p') as HTMLElement | null
    return paragraph?.textContent ?? ''
  })
  // THE GUARD THE FIRST TWO RUNS LACKED. Without it a probe that types into
  // nothing reports a calm editor and calls the bug unreproducible.
  assert(
    after.length > before.length,
    `the keystrokes actually reached the document: ${JSON.stringify({ before: before.slice(0, 60), after: after.slice(0, 60) })}`,
  )

  const report = await page.evaluate(() => {
    const state = globalThis as unknown as {
      __blinkSamples: Array<{ t: number; bg: string; shadow: string; focused: boolean; sameNode: boolean; hoverTag: string }>
      __blinkTimer?: ReturnType<typeof setInterval>
    }
    if (state.__blinkTimer !== undefined) clearInterval(state.__blinkTimer)
    const samples = state.__blinkSamples
    let transitions = 0
    let focusFlips = 0
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i]!.bg !== samples[i - 1]!.bg || samples[i]!.shadow !== samples[i - 1]!.shadow) transitions += 1
      if (samples[i]!.focused !== samples[i - 1]!.focused) focusFlips += 1
    }
    // Every distinct painted state, with how long it held. A blink is a state
    // that appears and leaves; the durations say whether a human could see it.
    const runs: Array<{ bg: string; shadow: string; focused: boolean; frames: number; ms: number }> = []
    for (const sample of samples) {
      const last = runs[runs.length - 1]
      if (last && last.bg === sample.bg && last.shadow === sample.shadow && last.focused === sample.focused) {
        last.frames += 1
        continue
      }
      runs.push({ bg: sample.bg, shadow: sample.shadow, focused: sample.focused, frames: 1, ms: 0 })
    }
    for (const run of runs) run.ms = run.frames * 8
    return {
      frames: samples.length,
      transitions,
      focusFlips,
      nodeSurvived: samples.every(s => s.sameNode),
      hoverTags: [...new Set(samples.map(s => s.hoverTag))],
      distinctPaintedStates: runs.length,
      runs: runs.slice(0, 14),
    }
  })

  console.log('while typing, pointer never moved:')
  console.log(JSON.stringify(report, null, 2))
  console.log('')

  assert(
    report.frames > 60,
    `the sampler actually ran for the length of the typing: ${report.frames} frames`,
  )
  // THE BUG. Any change of painted state with a stationary pointer is the
  // blink; before the fix this was 151 transitions across 241 frames.
  assert(
    report.transitions === 0,
    `the block does not change appearance while typing: ${report.transitions} transitions across ${report.frames} frames, states=${JSON.stringify(report.runs)}`,
  )

  // AND THE COUNTERPART, without which the assertion above is satisfied by
  // simply deleting the hover treatment. Move the pointer — a real gesture,
  // two pixels — and the affordance must come back. `data-typing` is cleared
  // by pointer movement, so this is the exact seam the fix turns on.
  await page.mouse.move(target!.x + 2, target!.y + 2)
  await page.waitForTimeout(400)
  const restored = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const root = host?.shadowRoot ?? null
    const live = root?.querySelector('.editor-mount [contenteditable="true"] p') as HTMLElement | null
    const mount = root?.querySelector('.editor-mount') as HTMLElement | null
    if (!live) return null
    const style = getComputedStyle(live)
    return {
      background: style.backgroundColor,
      boxShadow: style.boxShadow,
      stillMarkedTyping: !!mount?.hasAttribute('data-typing'),
    }
  })
  assert(restored, 'the paragraph is still there after typing')
  console.log('after moving the pointer two pixels:')
  console.log(JSON.stringify(restored, null, 2))
  assert(
    !restored!.stillMarkedTyping,
    'pointer movement clears the typing mark',
  )
  assert(
    restored!.background !== 'rgba(0, 0, 0, 0)',
    `the hover wash returns once the pointer moves: ${restored!.background}`,
  )
  assert(
    restored!.boxShadow !== 'none',
    `and so does the value-gutter hint bar: ${restored!.boxShadow}`,
  )

  console.log('\nSteady while typing, and the affordance returns the moment the')
  console.log('pointer moves — which is when it starts meaning something again.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
