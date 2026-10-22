/**
 * The MUS engine with the REAL `mus-wasm` (Ovillo's browser build of `mus check` / `mus render`), run on the same
 * message protocol a Worker gets, in process. Point `MUS_WASM` at a built module (`mus-rs/crates/mus-wasm/build.sh`);
 * without one these tests are skipped, never faked.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MusRenderRefusedError } from '@shrubbery/hoja/mus'
import { createInProcessMusPort, createMusWasmEngine, createMusCheckController, type MusWasmEngine } from '../index.js'
import { fetchWasmBytes, WasmLoadError } from '../../wasm/loader.js'

const WASM = process.env['MUS_WASM'] ?? ''
const have = Boolean(WASM && existsSync(WASM))

const GUITAR = `# score: one bar
# tempo: 240    time: 4/4
# master: rms=-16
# instruments:
#   gt   = steel-string guitar (treble, -12, anatomy=steel-string-v0, tuning=E2 A2 D3 G3 B3 E4, capo=0)
#   gt.p = thumb, thumbpick (treble, pos=0.10, pick=0.85, pm=0.45)
#   gt.v = fingers (treble, pos=0.20, pick=0.45)
`
const score = (bar: string): string => `${GUITAR}${bar}\n`
const CLEAN = score('bar 1: gt.p=A2h@5:0 E3h@4:2  gt.v=<A3@3:2 C4@2:1 E4@1:0>w')
const WRONG = score('bar 1: gt.p=A2h@5:0 E3h@4:2  gt.v=C4e@2:3 Re Rh.')

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return `sha256:${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')}`
}

describe.skipIf(!have)('the MUS engine (real mus-wasm)', () => {
  let engine: MusWasmEngine
  let server: Server
  let base = ''

  beforeAll(async () => {
    const bytes = readFileSync(WASM)
    // happy-dom's window has its own origin, so the test server answers cross-origin.
    const cors = { 'access-control-allow-origin': '*' }
    server = createServer((req, res) => {
      if (req.url === '/mus_wasm.wasm') { res.writeHead(200, { ...cors, 'content-type': 'application/wasm' }); res.end(bytes); return }
      res.writeHead(200, { ...cors, 'content-type': 'text/html' }); res.end('<!doctype html><p>not wasm')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    engine = await createMusWasmEngine({ wasm: `${base}/mus_wasm.wasm`, port: createInProcessMusPort(), stepSamples: 24_000 })
  })
  afterAll(() => { engine?.dispose(); server?.close() })

  it('loads the bytes on this side and says what it is', () => {
    expect(engine.info.sampleRate).toBe(48_000)
    expect(engine.info.ariadneOnly).toBe(true)
    expect(engine.info.anatomies).toEqual(['steel-string-v0'])
  })

  it('refuses what is not WebAssembly, and a build that is not the pinned one', async () => {
    await expect(fetchWasmBytes(`${base}/page.html`)).rejects.toBeInstanceOf(WasmLoadError)
    await expect(fetchWasmBytes(`${base}/mus_wasm.wasm`, { sha256: '0'.repeat(64) })).rejects.toThrow(/not the pinned/)
  })

  it('checks a clean score clean, and anchors a wrong fret to its token', async () => {
    const clean = await engine.check(CLEAN)
    expect(clean.clean).toBe(true)
    expect(clean.worlds.map(w => w.abbrev)).toEqual(['gt'])
    const wrong = await engine.check(WRONG)
    expect(wrong.clean).toBe(false)
    const d = wrong.diagnostics.find(x => x.code === 'tab-position-disagrees')!
    expect(d.message).toContain('sounds D4, not C4')
    expect(WRONG.slice(d.span!.from, d.span!.to)).toBe('C4e@2:3')
    expect(d.anchor).toMatchObject({ kind: 'event', bar: 1, track: 'gt.v' })
  })

  it('never renders a track that is not an Ariadne World', async () => {
    for (const line of ['#   s = synth (perc, synth=sine)', '#   w = weave (treble, synth=weave)', '#   v = bird (treble, voice=wren)']) {
      const text = `${GUITAR}${line}\nbar 1: gt.p=A2w@5:0 gt.v=Rw\n`
      const report = await engine.check(text)
      expect(report.diagnostics.some(d => d.code === 'not-ariadne' && d.message.includes('Ariadne Worlds only'))).toBe(true)
      const refused = await engine.render(text).catch(e => e)
      expect(refused).toBeInstanceOf(MusRenderRefusedError)
      expect((refused as MusRenderRefusedError).report.clean).toBe(false)
    }
  })

  it('renders on the World with progress, and the WAV is the one the receipt digests', async () => {
    const seen: number[] = []
    const take = await engine.render(CLEAN, { onProgress: p => seen.push(p.fraction) })
    expect(seen.length).toBeGreaterThan(3)
    expect(seen.at(-1)).toBe(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(take.sampleRate).toBe(48_000)
    expect(take.frames).toBe(5 * 48_000)
    expect(take.left.length).toBe(take.frames)
    expect(Math.max(...take.left.subarray(0, 48_000).map(Math.abs))).toBeGreaterThan(1e-3)
    expect(new TextDecoder().decode(take.wav.subarray(0, 4))).toBe('RIFF')
    expect(take.receipt.schema).toBe('mus.audio.render-receipt.v1')
    expect(await sha256(take.wav)).toBe(take.receipt.renderDigest)
    const world = take.receipt.ariadneWorlds![0]!
    expect(world.anatomy).toBe('steel-string-v0')
    expect(world.plucks).toBe(5)
    expect(Math.abs(world.cumulativeClosureResidual)).toBeLessThan(1e-12)
    expect(take.energy.schema).toBe('mus.ariadne.energy-trace.v1')
    expect(take.energy.worlds[0]!.channels.at(-1)).toBe('room')
  }, 300_000)

  it('stops a render when asked', async () => {
    const abort = new AbortController()
    const result = engine.render(CLEAN, { signal: abort.signal, onProgress: p => { if (p.done > 0) abort.abort() } })
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    // The engine is free again.
    expect((await engine.check(CLEAN)).clean).toBe(true)
  }, 300_000)

  it('the check loop keeps only the newest verdict', async () => {
    const controller = createMusCheckController({ engine, debounceMs: 20 })
    const verdicts: (boolean | null)[] = []
    controller.subscribe(s => { if (!s.checking && !s.pending && s.report) verdicts.push(s.report.clean) })
    controller.update(WRONG)
    controller.update(CLEAN.replace('<A3@3:2', '<A3@3:3'))
    controller.update(CLEAN)
    await new Promise(r => setTimeout(r, 200))
    await controller.checkNow()
    const s = controller.current()
    expect(s.source).toBe(CLEAN)
    expect(s.checkedSource).toBe(CLEAN)
    expect(s.current).toBe(true)
    expect(s.report!.clean).toBe(true)
    expect(verdicts.every(v => v === true)).toBe(true)
    controller.update(null, 'No ```mus fence')
    expect(controller.current().sourceError).toBe('No ```mus fence')
    expect(controller.current().current).toBe(false)
    controller.dispose()
  }, 60_000)
})

describe('without a built engine', () => {
  it('says how to point the tests at one', () => {
    if (!have) console.info('MUS_WASM is not set to a built mus_wasm.wasm: the engine tests were skipped (mus-rs/crates/mus-wasm/build.sh builds one)')
    expect(true).toBe(true)
  })
})
