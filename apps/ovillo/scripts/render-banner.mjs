// node scripts/render-banner.mjs [out.png]
//
// The Android TV banner (320 × 180): Ovillo's tile background, the mark (an egg
// made out of one string) and the name in Literata, rendered by a headless
// Chrome (its own profile, muted) from the mark's own path. Writes
// public/tv-banner.png by default; tests/mark.test.ts checks its size.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(appDir, 'public/tv-banner.png'))
const markSrc = readFileSync(join(appDir, '../../packages/components/src/ovillo-mark.ts'), 'utf8')
const d = /OVILLO_MARK_PATH =\s*'([^']+)'/.exec(markSrc)?.[1]
if (!d) throw new Error('OVILLO_MARK_PATH not found in ovillo-mark.ts')
const font = pathToFileURL(join(appDir, '../../packages/tokens/node_modules/@fontsource-variable/literata/files/literata-latin-wght-normal.woff2')).href

const work = mkdtempSync(join(tmpdir(), 'ovillo-banner-'))
const page = join(work, 'banner.html')
writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: 'Literata Variable'; src: url('${font}') format('woff2'); font-weight: 200 900; }
  html, body { margin: 0; }
  .banner { width: 320px; height: 180px; display: flex; align-items: center; gap: 14px; padding: 0 26px 0 30px; box-sizing: border-box;
    /* --mn-app-tile-ovillo: carmine-600 over carmine-700, split by one hard diagonal */
    background: linear-gradient(155deg, #e11d48 0 58%, #be123c 58%); color: #fff; overflow: hidden; }
  svg { flex: 0 0 auto; }
  .name { font-family: 'Literata Variable', Georgia, serif; font-weight: 500; font-size: 52px; letter-spacing: -0.01em; line-height: 1; padding-bottom: 6px; }
</style><div class="banner"><svg width="104" height="104" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg><span class="name">Ovillo</span></div>`)

const port = 9600 + Math.floor(Math.random() * 300)
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(work, 'profile')}`, '--mute-audio', '--no-first-run', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(200)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await cdp('Page.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 180, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.navigate', { url: pathToFileURL(page).href })
  await sleep(1200)
  const fonts = await cdp('Runtime.evaluate', { expression: "document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'loaded').length)", awaitPromise: true, returnByValue: true })
  if (!(fonts.result?.result?.value > 0)) throw new Error('Literata did not load; the banner would fall back to Georgia')
  const shot = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 320, height: 180, scale: 1 } })
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  ws.close()
  console.log(out)
} finally {
  chrome.kill()
}
