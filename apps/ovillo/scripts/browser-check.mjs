// node scripts/browser-check.mjs <url> <out-dir>
//
// A muted headless Chrome over CDP (its own profile, --mute-audio: nothing is ever audible):
// the console stays clean (CSP refusals included), no horizontal scroll at 390 px, playback
// advances, the visualizers move (energy meters, spectrum, scope), and screenshots at
// 1280 and 390 px, light and dark, gallery and piece page. Exits 1 if a check fails.
// OVILLO_CHECK_PIECE=<slug> also walks that piece: its page (for a note-list piece, the table, the measurement,
// what the receipt does not state), playback in the muted tab with its energy meters, 390 px, its score route.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const [url, out] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: node scripts/browser-check.mjs <url> <out-dir>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })
const port = 9300 + Math.floor(Math.random() * 400)
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${out}/profile`, '--mute-audio',
  '--no-first-run', '--disable-extensions', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
let id = 0
const pending = new Map()
const logs = []
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

// In-page helpers: a deep (shadow-piercing) query, and the app's handles.
const PRELUDE = `
  window.__deep = (sel, root = document, out = []) => {
    root.querySelectorAll(sel).forEach((e) => out.push(e))
    root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) window.__deep(sel, e.shadowRoot, out) })
    return out
  };
  window.__player = () => window.__deep('mn-audio-player')[0] ?? null;
  window.__in = (el, sel) => el?.shadowRoot?.querySelector(sel) ?? null;
  window.__inAll = (el, sel) => [...(el?.shadowRoot?.querySelectorAll(sel) ?? [])];
`

try {
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(200)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`)
    if (m.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`)
    if (m.method === 'Log.entryAdded') logs.push(`log.${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`)
  }
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
    if (r.result?.exceptionDetails) throw new Error(`evaluate failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n${expr}`)
    return r.result?.result?.value
  }
  const shot = async (name) => {
    const r = await cdp('Page.captureScreenshot', { format: 'png' })
    const path = `${out}/${name}.png`
    writeFileSync(path, Buffer.from(r.result.data, 'base64'))
    console.log(`     screenshot ${path}`)
  }
  const ready = async () => {
    for (let i = 0; i < 80; i++) {
      await sleep(250)
      const ok = await ev(`(() => { ${PRELUDE}; const p = window.__player(); return !!p && !!window.__in(p, '.deck') })()`)
      if (ok) return true
    }
    return false
  }
  const overflow = () => ev(`(() => { ${PRELUDE};
    const cw = document.documentElement.clientWidth;
    const wide = window.__deep('*').filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > cw + 0.5 })
      .slice(0, 8).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + ' ' + Math.round(e.getBoundingClientRect().right));
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: cw, wide };
  })()`)
  const setTheme = (theme) => ev(`(() => { ${PRELUDE}; const app = document.querySelector('ovillo-app'); if ((document.documentElement.dataset.theme || 'light') !== '${theme}') window.__in(app, 'mn-top-bar').shadowRoot.querySelector('[data-action=theme]').click(); return document.documentElement.dataset.theme })()`)

  await cdp('Runtime.enable'); await cdp('Log.enable'); await cdp('Page.enable')

  // ── 390 px: layout, no horizontal scroll ───────────────────────────────────
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await cdp('Page.navigate', { url })
  check(await ready(), '390 px: the gallery and its player render')
  await setTheme('light')
  await sleep(600)
  let o = await overflow()
  check(o.scrollWidth <= o.clientWidth, `390 px: no horizontal scroll (scrollWidth ${o.scrollWidth}, clientWidth ${o.clientWidth}${o.wide.length ? `; wide: ${o.wide.join(', ')}` : ''})`)
  await shot('gallery-390-light')

  // ── 1280 px: play, and watch everything move ───────────────────────────────
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.navigate', { url })
  check(await ready(), '1280 px: the gallery and its player render')
  await setTheme('light')
  const rows = await ev(`(() => { ${PRELUDE}; return window.__inAll(window.__player(), '.row').map((r) => r.querySelector('.t b').textContent) })()`)
  check(rows.length >= 3, `the playlist lists the pieces (${rows.join(' · ')})`)
  await ev(`(() => { ${PRELUDE}; window.__in(window.__player(), 'button[data-action=toggle]').click() })()`)
  await sleep(1500)
  const sample = () => ev(`(() => { ${PRELUDE}; const p = window.__player(); const a = document.getElementById('ovillo-audio');
    return { t: a.currentTime, paused: a.paused, status: p.dataset.status, mode: p.dataset.visualizer, frames: Number(p.dataset.vizFrames),
      levels: window.__inAll(p, '.meter').map((m) => Number(m.dataset.level)), lit: window.__inAll(p, '.led[data-lit=true]').length,
      head: Number(window.__in(p, '.trace .head')?.getAttribute('x1') ?? -1), progress: window.__in(p, '.scrub').style.getPropertyValue('--p'),
      clock: window.__in(p, '.clock .elapsed').textContent } })()`)
  const a = await sample()
  await sleep(1200)
  const b = await sample()
  console.log(`     t ${a.t.toFixed(2)} → ${b.t.toFixed(2)} s · status ${b.status} · clock ${b.clock} · levels ${a.levels.map((v) => v.toFixed(2))} → ${b.levels.map((v) => v.toFixed(2))} · frames ${a.frames} → ${b.frames}`)
  check(b.status === 'playing' && !b.paused, 'playback started (status playing)')
  check(b.t > a.t + 0.5, `playback advances (${a.t.toFixed(2)} → ${b.t.toFixed(2)} s)`)
  check(a.mode === 'energy', `the energy visualizer is the default for an Ariadne piece (${a.mode})`)
  check(b.frames - a.frames > 20, `the visualizer repaints every frame while playing (${b.frames - a.frames} frames in 1.2 s)`)
  check(b.levels.some((v, i) => Math.abs(v - a.levels[i]) > 0.005), 'the energy meters move with the sound')
  check(b.head > a.head, `the trace playhead moves (${a.head.toFixed(1)} → ${b.head.toFixed(1)})`)
  await shot('gallery-1280-light-energy')

  for (const mode of ['spectrum', 'scope']) {
    await ev(`(() => { ${PRELUDE}; window.__in(window.__player(), '.modes button[data-mode=${mode}]').click() })()`)
    await sleep(500)
    const e1 = await ev(`(() => { ${PRELUDE}; const c = window.__in(window.__player(), 'canvas.viz'); return { e: Number(c?.dataset.energy ?? 0), url: c?.toDataURL().length ?? 0, sig: c ? c.toDataURL().slice(-200) : '' } })()`)
    await sleep(400)
    const e2 = await ev(`(() => { ${PRELUDE}; const c = window.__in(window.__player(), 'canvas.viz'); return { e: Number(c?.dataset.energy ?? 0), url: c?.toDataURL().length ?? 0, sig: c ? c.toDataURL().slice(-200) : '' } })()`)
    check(e1.e > 0 && e2.e > 0, `${mode}: the analyser hears the sound (energy ${e1.e} / ${e2.e})`)
    check(e1.sig !== e2.sig, `${mode}: the canvas changes from frame to frame`)
    await shot(`gallery-1280-light-${mode}`)
  }
  await ev(`(() => { ${PRELUDE}; window.__in(window.__player(), '.modes button[data-mode=energy]').click() })()`)

  // Next track, then dark.
  await ev(`(() => { ${PRELUDE}; window.__in(window.__player(), 'button[aria-label=Next]').click() })()`)
  await sleep(1500)
  const n = await sample()
  check(n.status === 'playing', `next plays the next piece (${await ev(`(() => { ${PRELUDE}; return window.__in(window.__player(), '.title').textContent })()`)})`)
  await setTheme('dark')
  await sleep(900)
  await shot('gallery-1280-dark-energy')

  // ── The piece page ─────────────────────────────────────────────────────────
  const href = await ev(`(() => { ${PRELUDE}; return window.__deep('.now a.link')[0]?.getAttribute('href') ?? '' })()`)
  check(href.startsWith('#/piece/'), `the now-playing card links to its piece (${href})`)
  await ev(`location.hash = ${JSON.stringify(href)}`)
  await sleep(1800)
  const piece = await ev(`(() => { ${PRELUDE}; return { faces: window.__deep('[data-face]').map((f) => f.dataset.face), trace: window.__deep('ov-energy-trace').length,
    head: window.__deep('ov-energy-trace')[0]?.shadowRoot?.querySelector('.head')?.dataset.seconds ?? '', ledger: window.__deep('mn-energy-ledger').length,
    score: (window.__deep('pre.score')[0]?.textContent ?? '').length } })()`)
  check(['piece-player', 'piece-trace', 'piece-ledger', 'piece-world', 'piece-receipt', 'piece-score'].every((f) => piece.faces.includes(f)), `the piece page has its faces (${piece.faces.join(', ')})`)
  check(piece.score > 100, `the score text is shown (${piece.score} characters)`)
  await shot('piece-1280-dark')
  await setTheme('light')
  await sleep(600)
  await shot('piece-1280-light')
  // The whole piece page at once (the surface scrolls inside the viewport, so a tall viewport shows it all).
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 2300, deviceScaleFactor: 1, mobile: false })
  await sleep(900)
  await shot('piece-1280-full-light')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(900)
  o = await overflow()
  check(o.scrollWidth <= o.clientWidth, `390 px piece page: no horizontal scroll (scrollWidth ${o.scrollWidth}${o.wide.length ? `; wide: ${o.wide.join(', ')}` : ''})`)
  await shot('piece-390-light')
  // ── The score editor: the first bars, checked, rendered by the World here, played with its energy ──
  if (!process.env.SKIP_SCORE) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false })
    const slug = href.replace('#/piece/', '')
    await ev(`document.getElementById('ovillo-audio').pause()`)
    await ev(`location.hash = '#/score/${slug}'`)
    const W = `window.__deep('ov-score-workbench')[0]`
    const V = `window.__deep('mn-mus-verdict')[0]`
    let ok = false
    for (let i = 0; i < 120 && !ok; i++) { await sleep(500); ok = await ev(`(() => { ${PRELUDE}; return !!${V} && !!window.__deep('hoja-mus-editor')[0] })()`) }
    check(ok, 'the score editor mounts: Hoja’s MUS mode and the verdict face')
    await ev(`(() => { ${PRELUDE}; ${W}.querySelector('[data-excerpt="2"]').click() })()`)
    let clean = false
    for (let i = 0; i < 240 && !clean; i++) { await sleep(500); clean = await ev(`(() => { ${PRELUDE}; const v = ${V}; return !!v?.shadowRoot?.querySelector('.status.clean') && !v.shadowRoot.querySelector('button.go').disabled })()`) }
    check(clean, 'the first two bars check clean, and RENDER is on')
    check(await ev(`(() => { ${PRELUDE}; return ${W}.textContent.includes('about a minute for a 30-second piece') })()`), 'the page says a render takes about a minute for a 30-second piece')
    await shot('score-1280-light-checked')
    await ev(`(() => { ${PRELUDE}; ${V}.shadowRoot.querySelector('button.go').click() })()`)
    let progress = 0
    let took = false
    const started = Date.now()
    for (let i = 0; i < 1200 && !took; i++) {
      await sleep(500)
      const st = await ev(`(() => { ${PRELUDE}; const v = ${V}.shadowRoot; return { p: Number(v.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') ?? -1), take: !!v.querySelector('.take mn-audio-player') } })()`)
      progress = Math.max(progress, st.p)
      if (st.p > 0 && st.p < 100 && !globalThis.__shotProgress) { globalThis.__shotProgress = true; await shot('score-1280-light-rendering') }
      took = st.take
    }
    console.log(`     render: ${((Date.now() - started) / 1000).toFixed(1)} s, progress seen up to ${progress}%`)
    check(progress > 0, 'the render shows its progress')
    check(took, 'the take arrives and plays in mn-audio-player')
    if (took) {
      await ev(`(() => { ${PRELUDE}; window.__in(window.__deep('mn-audio-player')[0], 'button[data-action=toggle]').click() })()`)
      await sleep(1500)
      const s1 = await sample()
      await sleep(900)
      const s2 = await sample()
      console.log(`     take: t ${s1.t.toFixed(2)} → ${s2.t.toFixed(2)} · ${s2.mode} · levels ${s1.levels.map((v) => v.toFixed(2))} → ${s2.levels.map((v) => v.toFixed(2))}`)
      check(s2.status === 'playing' && s2.t > s1.t, 'the take plays (through the app’s one engine)')
      check(s2.mode === 'energy' && s2.levels.length === 3, 'the take’s energy trace is in the player’s energy screen')
      check(await ev(`(() => { ${PRELUDE}; return !!${V}.shadowRoot.querySelector('.ledger') })()`), 'the take’s ledger is shown beside it')
      await shot('score-1280-light-take')
      await ev(`document.getElementById('ovillo-audio').pause()`)
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await sleep(900)
    o = await overflow()
    check(o.scrollWidth <= o.clientWidth, `390 px score editor: no horizontal scroll (scrollWidth ${o.scrollWidth}${o.wide.length ? `; wide: ${o.wide.join(', ')}` : ''})`)
    await shot('score-390-light')
  }
  // ── The bench: quiet until a gesture; then the World sounds and its telemetry moves ──
  if (!process.env.SKIP_BENCH) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1500, deviceScaleFactor: 1, mobile: false })
    await ev(`document.getElementById('ovillo-audio').pause()`)
    await ev(`location.hash = '#/bench'`)
    const B = `window.__deep('mn-ovillo-bench')[0]`
    let up = false
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); up = await ev(`(() => { ${PRELUDE}; return !!${B}?.shadowRoot?.querySelector('.bench') })()`) }
    check(up, 'the bench mounts')
    await sleep(800)
    check(await ev(`(() => { ${PRELUDE}; return ${B}.audioState })()`) === 'off', 'the bench starts quiet: no audio until a gesture')
    await shot('bench-1280-light-quiet')
    await ev(`(() => { ${PRELUDE}; ${B}.shadowRoot.querySelector('[data-action=start]').click() })()`)
    let on = ''
    for (let i = 0; i < 120 && on !== 'on'; i++) { await sleep(250); on = await ev(`(() => { ${PRELUDE}; return ${B}.audioState })()`) }
    check(on === 'on', `Start audio starts the World (${on})`)
    await ev(`(() => { ${PRELUDE}; ${B}.shadowRoot.querySelector('[data-action=guitarist]').click() })()`)
    await sleep(2500)
    const bt = () => ev(`(() => { ${PRELUDE}; const b = ${B}; const t = b.telemetry; return { load: t?.load ?? -1, resid: t?.closureResidual, material: t?.material, sample: t?.sample, levels: [...b.shadowRoot.querySelectorAll('.meter')].map((m) => Number(m.dataset.level)) } })()`)
    const b1 = await bt()
    await sleep(1500)
    const b2 = await bt()
    console.log(`     bench: load ${(b2.load * 100).toFixed(0)}% · residual ${b2.resid} · material ${b1.material} → ${b2.material} · samples ${b1.sample} → ${b2.sample}`)
    check(b2.sample > b1.sample, 'the World renders, live')
    check(b2.load > 0 && b2.load < 5, `the DSP load is reported (${(b2.load * 100).toFixed(0)}%)`)
    check(Number.isFinite(b2.resid), `the live closure residual is reported (${b2.resid})`)
    check(b2.levels.some((v, i) => Math.abs(v - b1.levels[i]) > 0.002) && b2.levels[0] > 0, 'the World’s energy meters move')
    await shot('bench-1280-light-playing')
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await sleep(900)
    o = await overflow()
    check(o.scrollWidth <= o.clientWidth, `390 px bench: no horizontal scroll (scrollWidth ${o.scrollWidth}${o.wide.length ? `; wide: ${o.wide.join(', ')}` : ''})`)
    await shot('bench-390-light')
    await ev(`location.hash = '#/'`)
    await sleep(600)
  }

  // ── The tract: breathing silently until START; then the World sounds; TV mode and the mute lock ──
  if (!process.env.SKIP_TRACT) {
    const T = `window.__deep('mn-ovillo-tract')[0]`
    const openTract = async (query) => {
      await cdp('Page.navigate', { url: url.replace(/[?#].*$/, '') + query + '#/tract' })
      let ok = false
      for (let i = 0; i < 160 && !ok; i++) { await sleep(250); ok = await ev(`(() => { ${PRELUDE}; return ${T}?.dataset.tract === 'ready' && !!window.__tract })()`) }
      return ok
    }
    const base = new URL(url).search.replace(/^\?/, '')
    const q = (extra) => `?${[base, extra].filter(Boolean).join('&')}`
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false })
    check(await openTract(q('')), 'the tract mounts: the organ, the cross-section, the books')
    const s0 = await ev(`(() => ({ live: window.__tract.live, dsp: window.__tract.dspLoad, rtf: window.__tract.wasmRtf, lung: window.__tract.state[8] }))()`)
    await sleep(1500)
    const s1 = await ev(`(() => ({ live: window.__tract.live, lung: window.__tract.state[8], frames: window.__tract.state[22] }))()`)
    check(s0.live === false && s0.dsp === null, 'the tract starts quiet: no audio, the silent World drives the pictures')
    check(s0.rtf > 0, `the wasm real-time factor is measured (${Number(s0.rtf).toFixed(1)}×)`)
    await shot('tract-1280-light-quiet')
    await ev(`(() => { ${PRELUDE}; ${T}.shadowRoot.getElementById('start').click() })()`)
    let live = false
    for (let i = 0; i < 80 && !live; i++) { await sleep(250); live = await ev(`window.__tract.live`) }
    check(live, 'START gives the World to the worklet: it sounds')
    await sleep(1500)
    const s2 = await ev(`(() => ({ dsp: window.__tract.dspLoad, f0: window.__tract.state[9], books: ${T}.shadowRoot.getElementById('h-books').textContent, readout: ${T}.shadowRoot.getElementById('readout').children.length }))()`)
    console.log(`     tract: DSP ${(s2.dsp * 100).toFixed(1)}% · F0 ${Number(s2.f0).toFixed(1)} Hz · books ${s2.books} · ${s2.readout / 2} readouts`)
    check(s2.dsp !== null && s2.dsp > 0, 'the worklet reports its DSP load')
    check(s2.readout >= 30, 'the books are on screen')
    await ev(`(() => { ${PRELUDE}; ${T}.shadowRoot.querySelector('[data-gesture="7"]').click() })()`)
    await sleep(1200)
    await shot('tract-1280-light-live')
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await sleep(900)
    o = await overflow()
    check(o.scrollWidth <= o.clientWidth, `390 px tract: no horizontal scroll (scrollWidth ${o.scrollWidth}${o.wide.length ? `; wide: ${o.wide.join(', ')}` : ''})`)
    await shot('tract-390-light')
    // TV mode: window.ovilloTV drives it; ?mute=1 is a hard lock.
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
    check(await openTract(q('tv=1&mute=1')), 'TV mode mounts (?tv=1&mute=1)')
    const tv = await ev(`(() => { ${PRELUDE}; const t = ${T}; const before = window.__tract.state[26]; const handled = window.ovilloTV('right');
      return new Promise((r) => setTimeout(() => r({ handled, before, after: window.__tract.state[26], tv: t.classList.contains('tv'), legend: !t.shadowRoot.getElementById('legend').hidden,
        muted: !t.shadowRoot.getElementById('h-muted').hidden, master: t.shadowRoot.getElementById('o-master').textContent }), 600)) })()`)
    check(tv.handled === true && tv.after > tv.before, `window.ovilloTV('right') moves the tongue (${Number(tv.before).toFixed(2)} → ${Number(tv.after).toFixed(2)})`)
    check(tv.tv && tv.legend, 'TV mode shows the organ with the remote legend')
    await ev(`window.ovilloTV('m')`)
    const locked = await ev(`(() => { ${PRELUDE}; return ${T}.shadowRoot.getElementById('o-master').textContent })()`)
    check(tv.muted && tv.master === 'muted' && locked === 'muted', '?mute=1 is a hard lock (M does not unmute)')
    await shot('tract-tv-1280')
  }

  // ── One named piece, start to end (OVILLO_CHECK_PIECE=<slug>): its page, its traces, playback, its score route ──
  // For a piece whose score is a note list (a World a Rust example plays, the trombone v1) it also checks the table,
  // the measurement beside it, and that the page says what the receipt does not state.
  const only = process.env.OVILLO_CHECK_PIECE
  if (only) {
    const base = new URL(url).search
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false })
    await cdp('Page.navigate', { url: url.replace(/[?#].*$/, '') + base + `#/piece/${only}` })
    let up = false
    for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await ev(`(() => { ${PRELUDE}; return !!window.__deep('[data-face=piece-score]')[0] && !!window.__player() })()`) }
    check(up, `#/piece/${only}: the piece page renders`)
    await setTheme('light')
    await sleep(1500)
    const P = await ev(`(async () => { ${PRELUDE};
      const face = (n) => window.__deep('[data-face=' + n + ']')[0];
      const t = window.__deep('ov-energy-trace')[0];
      const receiptUrl = [...face('piece-receipt').querySelectorAll('.files a')].find((a) => a.textContent.startsWith('receipt'))?.getAttribute('href');
      const receipt = receiptUrl ? await (await fetch(receiptUrl)).json() : null;
      const table = face('piece-score').querySelector('.notes[role=table]');
      return {
        faces: window.__deep('[data-face]').map((f) => f.dataset.face),
        title: face('piece-player').querySelector('h1')?.textContent,
        format: (face('piece-score').querySelector('.eyebrow')?.textContent ?? '').trim(),
        rows: table ? Number(table.dataset.rows) : -1,
        bodyRows: face('piece-score').querySelectorAll('.body [role=row]').length,
        same: face('piece-score').querySelectorAll('[role=cell][data-same=true]').length,
        measured: (face('piece-score').querySelector('[data-measured]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        editorLink: !!face('piece-score').querySelector('a.link'),
        notes: receipt?.notes ?? null,
        schema: receipt?.schema ?? null,
        unstated: (face('piece-receipt').textContent.match(/not in this receipt/g) ?? []).length,
        exampleReceipt: !!face('piece-receipt').querySelector('[data-example-receipt]'),
        stored: (face('piece-ledger').querySelector('[data-stored]')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        ledger: !!face('piece-ledger').querySelector('mn-energy-ledger')?.shadowRoot?.querySelector('.world'),
        bodies: t ? [...t.shadowRoot.querySelectorAll('polyline')].map((p) => p.dataset.body) : [],
        units: (face('piece-trace').querySelector('[data-units]')?.textContent ?? '').trim(),
        world: face('piece-world').textContent.replace(/\\s+/g, ' ').trim(),
      } })()`)
    console.log(`     ${P.title} · ${P.format} · rows ${P.rows} (${P.bodyRows} drawn, ${P.same} on their partial) · receipt ${P.schema} ${P.notes} notes · bodies ${P.bodies.join(', ')}`)
    console.log(`     measured: ${P.measured}`)
    console.log(`     stored: ${P.stored}`)
    console.log(`     units: ${P.units}`)
    check(['piece-player', 'piece-trace', 'piece-ledger', 'piece-world', 'piece-receipt', 'piece-score'].every((f) => P.faces.includes(f)), `${only}: the piece page has its faces`)
    if (P.format.includes('ovillo-notes-tsv')) {
      check(P.rows === P.notes && P.bodyRows === P.notes, `${only}: the note list is a table, one row per note the receipt counts (${P.rows} / ${P.notes})`)
      check(P.same === P.notes && P.measured.includes(`${P.notes} of ${P.notes} notes sound the partial`), `${only}: the measurement sits beside the notes (${P.same} on their partial)`)
      check(!P.editorLink, `${only}: no score-editor link for a note list`)
      check(P.unstated >= 2 && P.exampleReceipt, `${only}: the receipt face says what the receipt does not state (${P.unstated} fields) and shows its own figures`)
      check(P.stored.includes('before its first frame'), `${only}: the ledger face states the World's stored energy at both ends`)
    }
    check(P.ledger, `${only}: the ledger is drawn`)
    check(P.bodies.length >= 1, `${only}: the energy trace draws its bodies (${P.bodies.join(', ')})`)
    check(P.units.length > 0, `${only}: the page says what the trace's channels are`)
    await shot(`only-${only}-1280-light`)
    // play it, muted (the browser runs with --mute-audio): the piece page's own player
    await ev(`(() => { ${PRELUDE}; window.__in(window.__player(), 'button[data-action=toggle]').click() })()`)
    await sleep(1800)
    const s1 = await sample()
    await sleep(1200)
    const s2 = await sample()
    console.log(`     ${only}: t ${s1.t.toFixed(2)} → ${s2.t.toFixed(2)} s · ${s2.status} · ${s2.mode} · levels ${s1.levels.map((v) => v.toFixed(2))} → ${s2.levels.map((v) => v.toFixed(2))} · frames ${s1.frames} → ${s2.frames}`)
    check(s2.status === 'playing' && !s2.paused && s2.t > s1.t + 0.5, `${only}: it plays and advances (${s1.t.toFixed(2)} → ${s2.t.toFixed(2)} s)`)
    check(s2.mode === 'energy' && s2.levels.length === P.bodies.length, `${only}: the player's energy screen has a meter per body (${s2.levels.length})`)
    check(s2.levels.some((v, i) => Math.abs(v - s1.levels[i]) > 0.005), `${only}: the energy meters move with the sound`)
    const head = await ev(`(() => { ${PRELUDE}; return Number(window.__deep('ov-energy-trace')[0]?.shadowRoot?.querySelector('.head')?.dataset.seconds ?? -1) })()`)
    check(head > 0, `${only}: the full-size trace's playhead follows (${head} s)`)
    await shot(`only-${only}-1280-light-playing`)
    await setTheme('dark')
    await sleep(700)
    await shot(`only-${only}-1280-dark-playing`)
    await setTheme('light')
    await ev(`document.getElementById('ovillo-audio').pause()`)
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 3200, deviceScaleFactor: 1, mobile: false })
    await sleep(900)
    await shot(`only-${only}-1280-full-light`)
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await sleep(900)
    o = await overflow()
    check(o.scrollWidth <= o.clientWidth, `${only} at 390 px: no horizontal scroll (scrollWidth ${o.scrollWidth}${o.wide.length ? `; wide: ${o.wide.join(', ')}` : ''})`)
    await shot(`only-${only}-390-light`)
    await ev(`location.hash = '#/score/${only}'`)
    let ro = null
    for (let i = 0; i < 40 && !ro; i++) { await sleep(250); ro = await ev(`(() => { ${PRELUDE}; const f = window.__deep('[data-face=mount-score]')[0]; return f ? { mount: f.dataset.mount, format: f.dataset.format, text: f.textContent.replace(/\\s+/g, ' ') } : null })()`) }
    check(!!ro && (ro.format !== 'ovillo-notes-tsv' || (ro.mount === 'read-only' && ro.text.includes('no MUS score to edit'))), `#/score/${only}: ${ro?.mount} (${ro?.format})`)
    await ev(`location.hash = '#/'`)
    await sleep(500)
  }

  // Stop (silence the engine) before closing.
  await ev(`document.getElementById('ovillo-audio').pause()`)
  const clean = logs.filter((l) => !/^console\.(debug|info|log):/.test(l))
  check(clean.length === 0, `console clean${clean.length ? `:\n  ${clean.join('\n  ')}` : ''}`)
  if (logs.length) console.log(`     all console lines:\n       ${logs.join('\n       ')}`)
} finally {
  try { ws?.close() } catch {}
  chrome.kill()
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
