/**
 * The MUS verdict face, and the whole workbench it sits in, against the REAL engine (Ovillo's `mus-wasm`, in process,
 * on the Worker's own protocol): a wrong fret listed and RENDER held, a clean score rendered with progress, played by
 * the take player, and its ledger shown with units. Point `MUS_WASM` at a built module; without one the engine tests
 * are skipped, never faked.
 */
import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createInProcessMusPort, createMusWasmEngine, mountMusWorkbench, type MusWasmEngine } from '@shrubbery/runtime/mus'
import '../mn-mus-verdict.js'
import { formatEnergy, type MnMusVerdict } from '../mn-mus-verdict.js'
import type { MnMusTakePlayer } from '../mn-mus-take-player.js'

const WASM = process.env['MUS_WASM'] ?? ''
const have = Boolean(WASM && existsSync(WASM))

const GUITAR = `# score: one bar
# tempo: 240    time: 4/4
# instruments:
#   gt   = steel-string guitar (treble, -12, anatomy=steel-string-v0, tuning=E2 A2 D3 G3 B3 E4, capo=0)
#   gt.p = thumb, thumbpick (treble, pos=0.10, pick=0.85, pm=0.45)
#   gt.v = fingers (treble, pos=0.20, pick=0.45)
`
const CLEAN = `${GUITAR}bar 1: gt.p=A2h@5:0 E3h@4:2  gt.v=<A3@3:2 C4@2:1 E4@1:0>w\n`
const WRONG = `${GUITAR}bar 1: gt.p=A2h@5:0 E3h@4:2  gt.v=C4e@2:3 Re Rh.\n`

const settle = async (el: { updateComplete: Promise<unknown> }): Promise<void> => { await el.updateComplete; await Promise.resolve(); await el.updateComplete }
const until = async (ok: () => boolean, ms = 240_000): Promise<void> => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 25))
  }
}

describe('formatEnergy', () => {
  it('prints four significant figures and a ×10ⁿ for small magnitudes', () => {
    expect(formatEnergy(1.8762794792255667e-7)).toBe('1.876 × 10⁻⁷')
    expect(formatEnergy(-1.18e-16)).toBe('-1.180 × 10⁻¹⁶')
    expect(formatEnergy(0.5)).toBe('0.5000')
    expect(formatEnergy(0)).toBe('0')
    expect(formatEnergy(Number.NaN)).toBe('—')
  })
})

describe.skipIf(!have)('mn-mus-verdict with the real engine', () => {
  let engine: MusWasmEngine
  beforeAll(async () => {
    engine = await createMusWasmEngine({ wasm: readFileSync(WASM).buffer.slice(0) as ArrayBuffer, port: createInProcessMusPort(), stepSamples: 24_000 })
  })
  afterAll(() => engine?.dispose())

  it('lists a wrong fret, holds RENDER, and asks the host to show it', async () => {
    const verdict = document.createElement('mn-mus-verdict') as MnMusVerdict
    document.body.appendChild(verdict)
    verdict.report = await engine.check(WRONG)
    verdict.current = true
    verdict.renderer = ({ signal, onProgress }) => engine.render(WRONG, { signal, onProgress })
    await settle(verdict)
    const root = verdict.shadowRoot!
    expect(root.querySelector('.status strong')?.textContent).toBe('1 error')
    const item = root.querySelector('li.error button') as HTMLButtonElement
    expect(item.dataset['code']).toBe('tab-position-disagrees')
    expect(item.textContent).toContain('bar 1 · gt.v · C4e@2:3')
    expect(item.textContent).toContain('sounds D4, not C4')
    expect((root.querySelector('button.go') as HTMLButtonElement).disabled).toBe(true)
    const revealed: unknown[] = []
    verdict.addEventListener('mn-mus-reveal', e => revealed.push((e as CustomEvent).detail.diagnostic))
    item.click()
    expect(revealed).toHaveLength(1)
  })

  it('renders a clean score with progress, plays it, and shows the ledger with units', async () => {
    const verdict = document.createElement('mn-mus-verdict') as MnMusVerdict
    document.body.appendChild(verdict)
    verdict.report = await engine.check(CLEAN)
    verdict.current = true
    verdict.renderer = ({ signal, onProgress }) => engine.render(CLEAN, { signal, onProgress })
    await settle(verdict)
    const root = verdict.shadowRoot!
    expect(root.querySelector('.status strong')?.textContent).toBe('Clean')
    expect(root.querySelector('.status')?.textContent).toContain('gt (steel-string-v0, 2 hands)')
    const takes: unknown[] = []
    verdict.addEventListener('mn-mus-take', e => takes.push((e as CustomEvent).detail.take))
    const go = root.querySelector('button.go') as HTMLButtonElement
    expect(go.disabled).toBe(false)
    go.click()
    await settle(verdict)
    expect(root.querySelector('[role="progressbar"]')).not.toBeNull()
    await until(() => takes.length === 1)
    await settle(verdict)
    const take = verdict.lastTake!
    expect(take.receipt.renderDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    const player = root.querySelector('mn-mus-take-player') as MnMusTakePlayer
    expect(player.take).toBe(take)
    expect(player.duration).toBe(5)
    const world = take.receipt.ariadneWorlds![0]!
    const source = root.querySelector('[data-ledger="sourceWork"] dd') as HTMLElement
    expect(source.dataset['exact']).toBe(String(world.sourceWork))
    expect(source.textContent).toContain('eu')
    expect(root.querySelector('[data-ledger="cumulativeClosureResidual"]')).not.toBeNull()
    expect(root.querySelector('.ledger .caption')?.textContent?.replace(/\s+/g, ' ')).toContain(`${world.plucks} plucks`)
    expect(root.querySelector('.digest')?.textContent).toContain(take.receipt.renderDigest)
    expect(root.querySelector('.note')?.textContent).toContain('not calibrated to joules')
  }, 300_000)

  it('mounts the workbench: Hoja with the verdict drawn in, and the face beside it', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const bench = mountMusWorkbench(host, { score: WRONG, title: 'A wrong fret', engine, debounceMs: 10 })
    await until(() => bench.controller.current().current)
    await settle(bench.verdict as unknown as MnMusVerdict)
    expect(bench.controller.current().report!.clean).toBe(false)
    const marked = [...bench.editor.querySelectorAll('.hoja-diag--error')].map(e => e.textContent).join('')
    expect(marked).toBe('C4e@2:3')
    expect((bench.verdict.shadowRoot!.querySelector('button.go') as HTMLButtonElement).disabled).toBe(true)
    expect(bench.source()).toBe(WRONG)
    bench.dispose()
    expect(host.children.length).toBe(0)
  }, 60_000)

  it('refuses to mount without an engine or a module', () => {
    expect(() => mountMusWorkbench(document.createElement('div'), { score: CLEAN })).toThrow(/pass `wasm`/)
  })
})
