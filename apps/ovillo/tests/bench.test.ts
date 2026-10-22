/**
 * mn-ovillo-bench: quiet until a gesture (happy-dom, no audio), and the contract
 * it reads from the REAL ovillo-web module (in Node, when OVILLO_BENCH_WASM names
 * a build): the info it shows, and the telemetry slots that move when the World
 * is played.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import '../src/bench/mn-ovillo-bench.js'
import type { BenchInfo, MnOvilloBench } from '../src/bench/mn-ovillo-bench.js'

const WASM = process.env.OVILLO_BENCH_WASM ?? ''

describe('mn-ovillo-bench in the page', () => {
  it('renders quiet: no audio, the strings to pluck, a start control, and says it starts quiet', async () => {
    const el = document.createElement('mn-ovillo-bench') as MnOvilloBench
    el.wasm = '/wasm/ovillo_web.wasm'
    el.scores = [{ id: 'x', title: 'Agua mansa', json: '{}' }]
    document.body.appendChild(el)
    await el.updateComplete
    expect(el.audioState).toBe('off')
    expect(el.dataset.audio).toBe('off')
    expect(el.telemetry).toBeNull()
    const root = el.shadowRoot!
    expect(root.querySelector('[data-action="start"]')!.textContent!.trim()).toBe('Start audio')
    expect([...root.querySelectorAll('[data-string]')].map((b) => b.textContent!.trim())).toEqual(['E2 · Z', 'A2 · X', 'D3 · C', 'G3 · V', 'B3 · B', 'E4 · N'])
    expect([...root.querySelectorAll('.meter')].map((m) => (m as HTMLElement).dataset.body)).toEqual(['material', 'reservoir', 'space'])
    expect(root.querySelector('[data-chip="audio"]')!.textContent).toBe('Audio off')
    expect(root.textContent).toContain('It starts quiet')
    expect(root.querySelector('.msg')!.textContent).toContain('The bench is quiet')
    el.remove()
  })
})

describe.skipIf(!WASM || !existsSync(WASM))('the real ovillo-web module (the contract the bench reads)', () => {
  it('says what it is, and its World answers a pluck with energy, a closure residual and a sounding string', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {})
    const x = instance.exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory }
    expect(x.ovillo_init(48000, 7)).toBe(0)
    const text = (len: number): string => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.ovillo_text_ptr(), len))
    const info = JSON.parse(text(x.ovillo_info())) as BenchInfo
    expect(info.sampleRate).toBe(48000)
    expect(info.planDigest).toMatch(/^sha256:/)
    for (const key of ['material', 'reservoir', 'space', 'closureResidual', 'guard', 'sounding', 'stringHz', 'stringLevel', 'stringFret', 'pattern', 'safetyLimitedFrames', 'sample']) {
      expect(info.slots[key], key).toBeTypeOf('number')
    }
    expect(info.patterns.map((p) => p.id)).toContain('wander')
    for (const k of [6, 7, 9, 13, 14, 4, 16]) expect(info.params[k]?.label, `knob ${k}`).toBeTruthy()
    const slots = (): Float64Array => new Float64Array(x.memory.buffer, x.ovillo_telemetry_ptr(), info.slots.count)
    for (let i = 0; i < 40; i++) x.ovillo_render(128)
    const before = slots()[info.slots.material]
    x.ovillo_pluck(0, 0, 0.8)
    for (let i = 0; i < 40; i++) x.ovillo_render(128)
    const s = slots()
    expect(s[info.slots.material]).toBeGreaterThan(before)
    expect((s[info.slots.sounding] | 0) & 1).toBe(1)
    expect(s[info.slots.stringHz]).toBeCloseTo(82.4, 0)
    expect(Math.abs(s[info.slots.closureResidual])).toBeLessThan(1e-9)
    expect(s[info.slots.sample]).toBe(80 * 128)
  })
})
