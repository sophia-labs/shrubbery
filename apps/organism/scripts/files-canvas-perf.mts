/**
 * Files canvas, house engine vs Excalidraw engine, in the real pane (Chromium): ~60 cards, ~30 connections.
 * Per interaction: frame intervals (rAF) during a card drag, and click-to-painted latency for Tidy and Links.
 *
 *   node --import tsx scripts/files-canvas-perf.mts
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_PERF_PORT ?? 5251)
const N = Number(process.env.FILES_PERF_CARDS ?? 60)
const cell = await startFilesContractServer({ graphIncarnation: 'inc-perf-1' })
for (let i = 0; i < N; i++) {
  const form = new FormData(); form.set('file', new File([new Uint8Array(40).fill(65)], `card-${String(i).padStart(2, '0')}.txt`, { type: 'text/plain' }))
  await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
}
const ids = [...cell.artifacts.keys()]
for (let i = 0; i < 30; i++) {
  const id = `w-perf-${i}`
  cell.wires.set(id, { id, sourceDocumentId: ids[i]!, targetDocumentId: ids[(i * 7 + 11) % ids.length]!, targetGraphId: cell.graphId, predicate: i % 2 ? 'supports' : 'isWiredTo', bidirectional: false })
}
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: true })
const stats = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!; return { n: s.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1]!.toFixed(1) } }

async function run(engine: 'house' | 'excalidraw'): Promise<unknown> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript('window.__name = (f) => f')
  const page = await context.newPage()
  const warns: string[] = []
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()) })
  await page.goto(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}${engine === 'house' ? '&engine=house' : ''}`)
  await page.waitForSelector('mn-sidebar-panel button.section-action')
  await page.click('mn-sidebar-panel button.section-action')
  await page.waitForFunction(n => (document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card:not([data-role="ghost"])').length ?? 0) >= n, N)
  await page.waitForTimeout(engine === 'excalidraw' ? 3000 : 800)       // let the lazy engine load and the scene settle
  const frames = (p: Page, fn: () => Promise<void>) => p.evaluate(() => { (window as any).__f = []; let last = performance.now(); const t = (now: number) => { (window as any).__f.push(now - last); last = now; (window as any).__raf = requestAnimationFrame(t) }; (window as any).__raf = requestAnimationFrame(t) }).then(fn).then(() => p.evaluate(() => { cancelAnimationFrame((window as any).__raf); return (window as any).__f as number[] }))
  const cardAt = (p: Page, idx: number) => p.evaluate(i => { const c = [...document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll<HTMLElement>('.card:not([data-role="ghost"])')][i]!; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, idx)
  const out: Record<string, unknown> = { engine }
  await page.click('mn-files-canvas >> button[aria-label="Tidy up"]'); await page.waitForTimeout(1500)   // so every card is on screen
  const latency = async (label: string, selector: string) => {
    const xs: number[] = []
    for (let i = 0; i < 5; i++) {
      xs.push(await page.evaluate(sel => new Promise<number>(res => { const b = document.querySelector('mn-files-canvas')!.shadowRoot!.querySelector<HTMLElement>(sel)!; const t0 = performance.now(); b.click(); requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => res(performance.now() - t0), 0))) }), selector))
      await page.waitForTimeout(400)
    }
    out[label] = stats(xs)
  }
  await latency('links toggle (click to painted, ms)', 'button[aria-label="Connections"]')
  await latency('links toggle back', 'button[aria-label="Connections"]')
  // drag: a card in the middle of the viewport, 60 pointer moves, three times
  const all: number[] = []
  for (let rep = 0; rep < 3; rep++) {
    const from = await cardAt(page, 12 + rep)
    const f = await frames(page, async () => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 250, from.y + 140, { steps: 60 }); await page.mouse.move(from.x - 100, from.y - 40, { steps: 60 }); await page.mouse.up() })
    all.push(...f.slice(2)); await page.waitForTimeout(500)
  }
  out['drag frame intervals (ms)'] = stats(all)
  out['drag frames >20ms'] = all.filter(x => x > 20).length
  // tidy: click to painted
  const tidy: number[] = []
  for (let i = 0; i < 3; i++) {
    const from = await cardAt(page, 20); await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 300, from.y + 200, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(500)
    tidy.push(await page.evaluate(() => new Promise<number>(res => { const b = document.querySelector('mn-files-canvas')!.shadowRoot!.querySelector<HTMLElement>('button[aria-label="Tidy up"]')!; const t0 = performance.now(); b.click(); requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => res(performance.now() - t0), 0))) })))
    await page.waitForTimeout(500)
  }
  out['tidy (click to painted, ms)'] = stats(tidy)
  out['connectors drawn'] = await page.evaluate(() => document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('.connector').length)
  out['console warnings'] = warns.filter(w => /files-canvas|Excalidraw/.test(w))
  await context.close()
  return out
}
try { for (const e of ['house', 'excalidraw'] as const) console.log(JSON.stringify(await run(e), null, 1)) }
finally { await browser.close(); await server.close(); await cell.close?.() }
process.exit(0)
