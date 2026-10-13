/** Composed local organism review; --baseline loads the exact shipped host. */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const baseline = process.argv.includes('--baseline')
const phase = baseline ? 'before' : 'after'
const output = process.env.OUTLINER_EVIDENCE_DIR ?? '/tmp/outliner-focus-evidence'
const root = resolve(import.meta.dirname, '../../..')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: resolve(root, 'apps/organism'), configFile: false,
  cacheDir: resolve(output, `${phase}-vite-cache`),
  optimizeDeps: { exclude: ['oxigraph'] },
  server: { host: '127.0.0.1', port: baseline ? 5196 : 5197, strictPort: true },
  plugins: baseline ? [{ name: 'shipped-outliner', enforce: 'pre', load(id) {
    if (id === resolve(root, 'packages/runtime/src/editor-host.ts')) {
      return execFileSync('git', ['show', '90c506069e7c24b925fe9d76da6e230427add659:packages/runtime/src/editor-host.ts'], { cwd: root, encoding: 'utf8' })
    }
  } }] : [],
})
await server.listen()
const browser = await chromium.launch({ headless: true })
const checks: string[] = []
const check = (value: unknown, description: string) => {
  if (!value) throw new Error(description)
  checks.push(description)
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`http://127.0.0.1:${baseline ? 5196 : 5197}/browser-harness.html`)
  await page.locator('mn-sidebar-panel [data-node-id="research-notes"]').click()
  const host = page.locator('sh-editor-host')
  const editor = host.locator('.ProseMirror')
  await editor.waitFor()
  await host.evaluate((h: any) => h._editor.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, 'data-block-id': 'title' }, content: [{ type: 'text', text: 'A place for unfinished thoughts' }] },
    ...[
      ['parent', 0, 'Keep the thought and its context together.'],
      ['child', 1, 'A nested detail belongs to the same thought.'],
      ['deep', 2, 'Even a small detail deserves a stable place.'],
      ['long', 0, 'A longer note wraps across lines so its controls stay anchored to the beginning, quietly available while the text remains the main thing to read and edit.'],
      ['last', 0, 'Leave room for the next connection.'],
    ].map(([id, indent, text]) => ({ type: 'paragraph', attrs: { indent, 'data-block-id': id }, content: [{ type: 'text', text }] })),
  ] }))
  await host.evaluate((h: any) => { h.wireBundle = {
    outgoingWires: [{ id: 'fixture-wire', localBlockId: 'parent', predicate: 'relatedTo', predicateLabel: 'related to', otherDocumentId: 'architecture', otherGraphId: 'browser-harness', otherTitle: 'Architecture', otherSnippet: 'Context.', bidirectional: false }],
    incomingWires: [], wiredBlockIds: ['parent'],
  } })
  const child = editor.locator('[data-block-id="child"]')
  const parent = editor.locator('[data-block-id="parent"]')
  await child.click({ position: { x: 130, y: 18 } })
  await page.keyboard.press('End')
  const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const screenshot = async (name: string) => { await settle(); await page.screenshot({ path: `${output}/${phase}-${name}.png` }) }
  const geometry = () => host.evaluate((h: HTMLElement) => {
    const mount = h.shadowRoot!.querySelector<HTMLElement>('.editor-mount')!
    const origin = mount.getBoundingClientRect()
    const points = Array.from(mount.querySelectorAll<HTMLElement>('.outliner-node-button'))
      .filter(el => el.getClientRects().length)
      .map(el => {
        const rect = el.getBoundingClientRect()
        return { x: rect.x + rect.width / 2 - origin.x + mount.scrollLeft - mount.clientLeft, y: rect.y + rect.height / 2 - origin.y + mount.scrollTop - mount.clientTop }
      })
    const path = mount.querySelector<SVGPathElement>('.outliner-gutter path')
    const d = path?.getAttribute('d') ?? ''
    const x = Math.min(...points.map(point => point.x))
    return { points, d, connected: points.length > 1 && d.startsWith(`M ${x} ${points[0].y} V ${points.at(-1)!.y}`) && points.every(point => point.x === x || d.includes(`M ${x} ${point.y} H ${point.x}`)) }
  })
  await screenshot('desktop')
  const initial = await geometry()
  if (!baseline) check(initial.connected && initial.points.length === 6, 'visible root and nested stations share a trunk with bounded ends')
  await parent.locator('.outliner-node-button').hover()
  await screenshot('hover')
  await parent.locator('.outliner-fold-button').click()
  await screenshot('collapsed')
  check(!await child.isVisible(), 'fold still hides nested descendants')
  if (!baseline) { const folded = await geometry(); check(folded.connected && folded.points.length === 4, 'collapsed descendants leave no phantom stations') }
  await parent.locator('.outliner-fold-button').focus()
  await page.keyboard.press('Enter')
  await screenshot('keyboard-focus')
  check(await child.isVisible(), 'keyboard fold restores the subtree')
  check(await parent.locator('.outliner-fold-button:focus').count() === 1, 'keyboard focus survives fold widget replacement')
  await child.click({ position: { x: 130, y: 18 } })
  await page.keyboard.press('End')
  const beforeType = await child.innerText()
  await page.keyboard.type('!')
  check((await child.innerText()) === `${beforeType}!`, 'typing remains in the active nested block')
  await child.locator('.outliner-node-button').click()
  await host.locator('[data-outliner-action="zoom"]').click()
  await screenshot('zoom')
  if (!baseline) { const zoomed = await geometry(); check(zoomed.connected && zoomed.points.length === 2, 'zoom bounds linework to its visible subtree') }
  await host.locator('.zoom-breadcrumb-crumb').first().click()
  await settle()
  await page.setViewportSize({ width: 900, height: 700 })
  await screenshot('narrow')
  if (!baseline) check((await geometry()).connected, 'linework follows reflow in a narrow composed editor')
  const savedContent = await host.evaluate((h: any) => h._editor.getJSON())
  await host.evaluate((h: any) => h._editor.commands.insertContentAt(h._editor.state.doc.content.size,
    Array.from({ length: 24 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `A further thought ${index + 1}.` }] }))))
  await settle()
  const beforeScroll = await geometry()
  const scrollTop = await host.evaluate((h: HTMLElement) => {
    const mount = h.shadowRoot!.querySelector('.editor-mount')!
    mount.scrollTop = 160
    return mount.scrollTop
  })
  await screenshot('scrolled')
  if (!baseline) check(scrollTop > 0 && (await geometry()).connected && (await geometry()).d === beforeScroll.d, 'actual scrolling preserves content-relative stations')
  await host.evaluate((h: any, content) => h._editor.commands.setContent(content), savedContent)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await child.click({ position: { x: 130, y: 18 } })
  await screenshot('dark')
  if (!baseline) check((await geometry()).connected, 'dark theme retains connected geometry')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await screenshot('phone')
  if (!baseline) check((await geometry()).connected, 'linework follows nested wrapping at phone width')
  await host.evaluate((h: any) => h._editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One thought.' }] }] }))
  await settle()
  if (!baseline) check((await geometry()).d === '', 'a lone station has no dangling line')
  await host.evaluate((h: any) => h._editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }))
  await settle()
  if (!baseline) check((await geometry()).d === '', 'an empty document has no dangling line')
  await writeFile(`${output}/${phase}-checks.json`, JSON.stringify({ phase, checks, initial }, null, 2))
  console.log(JSON.stringify({ phase, checks, output }))
} finally {
  await browser.close()
  await server.close()
}
