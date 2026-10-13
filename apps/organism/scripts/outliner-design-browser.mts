import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const phase = process.argv.includes('--baseline') ? 'before' : 'after'
const output = process.env.OUTLINER_EVIDENCE_DIR ?? '/tmp/outliner-design-evidence'
await mkdir(output, { recursive: true })
const root = resolve(import.meta.dirname, '../../..')
const baselineFiles = ['packages/runtime/src/editor-host.ts', 'packages/runtime/src/collab/live-editor.ts', 'packages/editor-kernel/src/extensions/outliner.ts', 'packages/editor-kernel/src/extensions/block-dnd.ts', 'packages/editor-kernel/src/extensions/block-selection.ts', 'packages/components/src/mn-editor-toolbar.ts', 'packages/components/src/mn-dropdown-button.ts']
const port = phase === 'before' ? 5194 : 5195
const server = phase === 'before' ? await createServer({
  root: resolve(root, 'apps/organism'), configFile: false,
  cacheDir: resolve(output, 'baseline-vite-cache'),
  optimizeDeps: { exclude: ['oxigraph'] },
  server: { host: '127.0.0.1', port: 5194, strictPort: true },
  plugins: [{ name: 'exact-deployed-source', enforce: 'pre', load(id) {
    const relative = id.split('?')[0].replace(`${root}/`, '')
    if (baselineFiles.includes(relative)) return execFileSync('git', ['show', `8a538ff7a95cf3e35995993013125df8fce9c9a4:${relative}`], { cwd: root, encoding: 'utf8' })
  } }],
}) : await createServer({ root: resolve(root, 'apps/organism'), configFile: resolve(root, 'apps/organism/vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`)
  await page.locator('mn-sidebar-panel [data-node-id="research-notes"]').click()
  const host = page.locator('sh-editor-host')
  const editor = host.locator('.ProseMirror')
  await editor.waitFor()
  // Fixture preparation uses the real collaborative editor; all gestures below
  // use browser pointer and keyboard input against the ordinary host/toolbar.
  await host.evaluate((h: any) => h._editor.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, 'data-block-id': 'title' }, content: [{ type: 'text', text: 'A place for unfinished thoughts' }] },
    { type: 'paragraph', attrs: { 'data-block-id': 'parent' }, content: [{ type: 'text', text: 'Keep the thought and its context together.' }] },
    { type: 'paragraph', attrs: { indent: 1, 'data-block-id': 'child' }, content: [{ type: 'text', text: 'A nested detail should feel like part of the same thought.' }] },
    { type: 'paragraph', attrs: { indent: 2, 'data-block-id': 'deep' }, content: [{ type: 'text', text: 'Even a small detail deserves a stable place.' }] },
    { type: 'paragraph', attrs: { 'data-block-id': 'long' }, content: [{ type: 'text', text: 'A longer note wraps across lines so its controls must stay anchored to the beginning, quietly available while the text remains the main thing to read and edit.' }] },
    { type: 'paragraph', attrs: { 'data-block-id': 'empty' } },
    { type: 'blockquote', attrs: { 'data-block-id': 'quote' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Make the useful thing feel inevitable.' }] }] },
  ] }))
  await host.evaluate((h: any) => { h.wireBundle = {
    outgoingWires: [{ id: 'fixture-wire', localBlockId: 'parent', predicate: 'relatedTo', predicateLabel: 'related to', otherDocumentId: 'architecture', otherGraphId: 'browser-harness', otherTitle: 'Architecture', otherSnippet: 'The context behind this thought.', bidirectional: false }],
    incomingWires: [], wiredBlockIds: ['parent'],
  } })
  await page.waitForTimeout(150)
  await editor.locator('[data-block-id="child"]').click({ position: { x: 120, y: 18 } })
  await page.keyboard.press('End')
  await page.screenshot({ path: `${output}/${phase}-desktop.png` })
  await editor.locator('[data-block-id="parent"]').hover({ position: { x: 12, y: 18 } })
  await page.screenshot({ path: `${output}/${phase}-hover.png` })
  const before = await host.evaluate((h: any) => ({ selection: h._editor.state.selection.toJSON(), json: h._editor.getJSON() }))
  await host.locator('[data-block-select] button.trigger').click()
  await host.locator('[data-block-select] button[data-menu-item-id="heading2"]').click()
  await page.waitForTimeout(100)
  await page.keyboard.type('!')
  const after = await host.evaluate((h: any) => ({ selection: h._editor.state.selection.toJSON(), json: h._editor.getJSON(), focused: h.shadowRoot.activeElement?.className }))
  const summarize = (s: any) => ({ selection: s.selection, focused: s.focused, blocks: s.json.content.map((n: any) => ({ id: n.attrs['data-block-id'], type: n.type, text: JSON.stringify(n.content) })) })
  const result = { phase, before: summarize(before), after: summarize(after) }
  await writeFile(`${output}/${phase}-focus.json`, JSON.stringify(result, null, 2))
  const checks: string[] = []
  const check = (value: unknown, description: string) => {
    if (!value) throw new Error(description)
    checks.push(description)
  }
  const state = () => host.evaluate((h: any) => ({ selection: h._editor.state.selection.toJSON(), blocks: h._editor.getJSON().content }))
  const style = async (id: string) => {
    await host.locator('[data-block-select] button.trigger').click()
    await host.locator(`[data-block-select] button[data-menu-item-id="${id}"]`).click()
    await page.waitForTimeout(80)
  }
  if (phase === 'after') {
    check(after.json.content.find((n: any) => n.attrs['data-block-id'] === 'child').content[0].text.endsWith('!'), 'typed character stays at the styled nested caret')
    check(!after.json.content.find((n: any) => n.attrs['data-block-id'] === 'deep').content[0].text.includes('!'), 'adjacent block is untouched')
    await style('paragraph')
    await page.keyboard.type('x')
    check((await editor.locator('[data-block-id="child"]').innerText()).endsWith('!x'), 'repeated style returns to the same caret')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.waitForFunction(() => !(document.querySelector('sh-editor-host') as any)._editor.state.selection.empty)
    const rangeBefore = (await state()).selection
    await style('heading3')
    check(JSON.stringify((await state()).selection) === JSON.stringify(rangeBefore), 'non-collapsed range survives style conversion')
    await page.keyboard.type('?')
    check((await editor.locator('[data-block-id="child"]').innerText()).endsWith('.?'), 'typing replaces only the saved range')
    const cancelBefore = await state()
    await host.locator('[data-block-select] button.trigger').click()
    await page.keyboard.press('ArrowDown')
    check(await host.locator('[data-block-select] button.menu-item:focus').count() === 1, 'open style menu owns keyboard focus')
    await page.keyboard.press('Escape')
    check(JSON.stringify((await state()).blocks) === JSON.stringify(cancelBefore.blocks), 'Escape cancels without changing content')
    check(await host.locator('[data-block-select] button.trigger:focus').count() === 1, 'Escape returns focus to the style trigger')
    await host.locator('[data-block-select] button.trigger').press('ArrowDown')
    await page.keyboard.press('Home')
    await host.locator('[data-block-select] button[data-menu-item-id="paragraph"]').click()
    await page.keyboard.type('k')
    check((await editor.locator('[data-block-id="child"]').innerText()).endsWith('.?k'), 'style after cancellation retains editing context')

    const parent = editor.locator('[data-block-id="parent"]')
    await parent.locator('.outliner-fold-button').click()
    await editor.locator('[data-block-id="child"]').waitFor({ state: 'hidden' })
    check(!(await editor.locator('[data-block-id="child"]').isVisible()), 'pointer fold hides the subtree')
    check((await host.evaluate((h: any) => h.liveEditor.getActiveBlockId())) === 'parent', 'collapsing a selected descendant leaves a visible typing target')
    await parent.locator('.outliner-fold-button').focus()
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('wire-highlight-block', { detail: { blockId: 'parent' } })))
    await page.keyboard.press('Enter')
    await editor.locator('[data-block-id="deep"]').waitFor({ state: 'visible' })
    check(await editor.locator('[data-block-id="deep"]').isVisible(), 'keyboard fold restores nested content')
    check(await parent.locator('.outliner-fold-button:focus').count() === 1, 'fold keeps keyboard focus on its replacement control')
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('wire-highlight-block', { detail: { blockId: null } })))

    await parent.locator('.outliner-node-button').click()
    await host.locator('.outliner-menu').waitFor({ state: 'visible' })
    check((await host.locator('[data-outliner-action="connections"]').innerText()).includes('(1)'), 'block context includes its actual connection count')
    await page.screenshot({ path: `${output}/after-context-menu.png` })
    check(await host.locator('.outliner-menu button:focus').count() === 1, 'block menu receives deliberate keyboard focus')
    await page.keyboard.press('ArrowDown')
    check(await host.locator('[data-outliner-action="zoom"]:focus').count() === 1, 'block menu arrow navigation reaches focus action')
    await page.keyboard.press('Escape')
    check(await parent.locator('.outliner-node-button:focus').count() === 1, 'block menu cancellation restores its invoker')
    await parent.locator('.outliner-node-button').click()
    await host.locator('[data-outliner-action="down"]').click()
    const moved = (await state()).blocks.map((n: any) => n.attrs['data-block-id'])
    check(moved.indexOf('long') < moved.indexOf('parent') && moved.indexOf('deep') === moved.indexOf('parent') + 2, 'move action keeps nested subtree together')
    await parent.locator('.outliner-node-button').click()
    await host.locator('[data-outliner-action="select"]').click()
    check(await parent.evaluate(el => el.classList.contains('block-selected')), 'contextual selection retains block selection capability')
    await page.keyboard.press('Escape')

    // A genuine HTML drag, with pointer input rather than a synthetic drop event.
    const grip = parent.locator('.outliner-node-button')
    const sourceBox = await grip.boundingBox()
    const targetBox = await editor.locator('[data-block-id="long"]').boundingBox()
    if (!sourceBox || !targetBox) throw new Error('drag targets unavailable')
    await page.mouse.move(sourceBox.x + 12, sourceBox.y + 12)
    await page.mouse.down()
    await page.mouse.move(sourceBox.x + 18, sourceBox.y + 14, { steps: 3 })
    await page.mouse.move(targetBox.x + 100, targetBox.y + 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(80)
    const dragged = (await state()).blocks.map((n: any) => n.attrs['data-block-id'])
    check(dragged.indexOf('parent') < dragged.indexOf('long') && dragged.indexOf('deep') === dragged.indexOf('parent') + 2, 'pointer drag moves the complete subtree')

    await editor.locator('[data-block-id="empty"] .outliner-node-button').click()
    check(await host.locator('.outliner-menu').isVisible(), 'empty block exposes its actions')
    await page.keyboard.press('Escape')
    await editor.locator('[data-block-id="quote"] .outliner-node-button').click()
    check(await host.locator('.outliner-menu').isVisible(), 'container block exposes its actions')
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `${output}/after-desktop-final.png` })

    await host.evaluate((h: any) => h._editor.commands.setContent({ type: 'doc', content: [
      { type: 'paragraph', attrs: { 'data-block-id': 'atoms-title' }, content: [{ type: 'text', text: 'Structured and non-text content' }] },
      { type: 'listItem', attrs: { listType: 'ordered', 'data-block-id': 'ordered' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First numbered thought' }] }] },
      { type: 'listItem', attrs: { listType: 'task', 'data-block-id': 'task' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A task still has its checkbox' }] }] },
      { type: 'table', attrs: { 'data-block-id': 'table' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A table cell remains editable' }] }] }] }] },
      { type: 'codeBlock', attrs: { 'data-block-id': 'code' }, content: [{ type: 'text', text: 'const thought = "uninterrupted"' }] },
      { type: 'image', attrs: { 'data-block-id': 'image', src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="80"%3E%3Crect width="320" height="80" fill="%23dbe8df"/%3E%3C/svg%3E', alt: 'A quiet green rectangle' } },
    ] }))
    await editor.locator('[data-outliner-pos] .outliner-node-button').click()
    check(await host.locator('.outliner-menu').isVisible(), 'table block exposes integrated actions')
    await page.keyboard.press('Escape')
    check(await editor.locator('[data-block-id="task"] input[type="checkbox"]').count() === 1, 'task checkbox remains available beside block controls')
    await editor.locator('[data-block-id="task"] input[type="checkbox"]').click()
    check(await editor.locator('[data-block-id="task"] input[type="checkbox"]').isChecked(), 'task checkbox still changes task state')
    check(await editor.locator('[data-block-id="code"] .code-copy-btn').count() > 0, 'code block keeps its native copy control')
    check(await editor.locator('[data-block-id="image"] img').isVisible(), 'image atom remains visible')
    await page.screenshot({ path: `${output}/after-nontext.png` })
    await host.evaluate((h: any) => { h.documentAccess = { readOnly: true } })
    await editor.locator('[data-block-id="ordered"] .outliner-node-button').click()
    check(await host.locator('[data-outliner-action="down"]').isDisabled(), 'read-only block menu disables mutation')
    check(await host.locator('[data-outliner-action="connections"]').isEnabled(), 'read-only block menu retains contextual access')
    await page.keyboard.press('Escape')
    await host.evaluate((h: any) => {
      h.documentAccess = { readOnly: false }
      h._editor.commands.setContent({ type: 'doc', content: Array.from({ length: 28 }, (_, i) => ({ type: 'paragraph', attrs: { 'data-block-id': `long-${i}` }, content: [{ type: 'text', text: `Note ${i + 1}. A useful control stays with its thought, even far down a long document. There is enough text here to wrap and make the reading position matter.` }] })) })
    })
    const last = editor.locator('[data-block-id="long-27"]')
    await last.scrollIntoViewIfNeeded()
    await last.click({ position: { x: 160, y: 18 } })
    await page.keyboard.press('End')
    const scrollBefore = await host.locator('.editor-mount').evaluate(el => el.scrollTop)
    await style('heading2')
    await page.keyboard.type('L')
    check((await last.innerText()).includes('L'), 'a style change at the end of a long document keeps the typing target')
    const scrollAfter = await host.locator('.editor-mount').evaluate(el => el.scrollTop)
    check(scrollBefore > 500 && scrollAfter > scrollBefore - 100, 'style commit does not jump the long document back to the top')
    await page.screenshot({ path: `${output}/after-long-scroll.png` })

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
    const touch = await mobile.newPage()
    await touch.goto(`http://127.0.0.1:${port}/browser-harness.html`)
    await touch.locator('mn-home-view button.resume:visible').tap()
    const touchHost = touch.locator('sh-editor-host')
    const touchEditor = touchHost.locator('.ProseMirror')
    await touchEditor.waitFor()
    await touchHost.evaluate((h: any, json) => h._editor.commands.setContent(json), before.json)
    await touchEditor.locator('[data-block-id="child"]').tap({ position: { x: 160, y: 20 } })
    await touch.keyboard.press('End')
    await touchHost.locator('[data-compact-tools-toggle] button').tap()
    await touchHost.locator('[data-block-select] button.trigger').tap()
    await touchHost.locator('[data-block-select] button[data-menu-item-id="heading2"]').tap()
    await touch.keyboard.type('T')
    check((await touchEditor.locator('[data-block-id="child"]').innerText()).includes('T'), 'touch style selection returns typing to the original block')
    check(await touchHost.locator('[role="dialog"][aria-label="Formatting tools"]:visible').count() === 0, 'committing a touch style closes the formatting sheet before editor focus returns')
    await touchEditor.locator('[data-block-id="parent"] .outliner-fold-button').tap()
    check(!await touchEditor.locator('[data-block-id="child"]').isVisible(), 'touch folding works without hover')
    await touchEditor.locator('[data-block-id="parent"] .outliner-fold-button').tap()
    check(await touchEditor.locator('[data-block-id="child"]').isVisible(), 'touch expansion restores the child')
    await touchEditor.locator('[data-block-id="parent"] .outliner-node-button').tap()
    await touch.screenshot({ path: `${output}/after-mobile-menu.png` })
    const touchMenuBox = await touchHost.locator('.outliner-menu').boundingBox()
    check(touchMenuBox && touchMenuBox.x >= 0 && touchMenuBox.x + touchMenuBox.width <= 390, 'touch action menu stays inside the viewport')
    await touchHost.locator('[data-outliner-action="down"]').tap()
    const touchOrder = await touchHost.evaluate((h: any) => h._editor.getJSON().content.map((n: any) => n.attrs['data-block-id']))
    check(touchOrder.indexOf('long') < touchOrder.indexOf('parent'), 'touch movement has a menu alternative to dragging')
    const targets = await touchEditor.locator('.outliner-control button:visible').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height } }))
    check(targets.every(r => r.w >= 32 && r.h >= 36), 'touch control targets are at least 32 by 36 pixels')
    await touch.screenshot({ path: `${output}/after-mobile.png` })
    await mobile.close()
  } else {
    check(!after.json.content.some((n: any) => JSON.stringify(n.content ?? []).includes('!')), 'deployed baseline reproduces lost typing after style selection')
  }
  await writeFile(`${output}/${phase}-checks.json`, JSON.stringify({ phase, checks }, null, 2))
  console.log(JSON.stringify({ phase, checks }))
} finally {
  await browser.close()
  await server.close()
}
