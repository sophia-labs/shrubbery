// @vitest-environment node
/**
 * The tract World the element runs (ovillo-tract-world's C ABI, the module
 * OVILLO_TRACT_WASM names): its state layout is the one tract-engine.js reads,
 * it breathes into voice on its own, and its books close. Env-gated: without a
 * built module these are skipped, never faked.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WASM = process.env.OVILLO_TRACT_WASM ?? ''
const here = dirname(fileURLToPath(import.meta.url))
const engine = readFileSync(join(here, '../src/tract/tract-engine.js'), 'utf8')

describe('the port', () => {
  it('reaches the page only through its root and its options', () => {
    expect(engine).not.toMatch(/document\.(getElementById|querySelector|body)/)
    expect(engine).not.toMatch(/fetch\(/)
    expect(engine).toContain("import * as THREE from 'three';")
    expect(engine).toContain('window.ovilloTV = ovilloTV;')
    expect(engine).toMatch(/const MUTE = query\.has\('mute'\);/)
  })
})

describe.skipIf(!WASM || !existsSync(WASM))('the tract World (real module)', () => {
  it('has the state layout the page reads, voices on its own breath, and keeps its books', async () => {
    const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {})
    const x = instance.exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory }
    const LEN = Number(/LEN: (\d+)/.exec(engine)![1])
    const at = (name: string): number => Number(new RegExp(`\\b${name}: (\\d+)`).exec(engine)![1])
    x.tract_init_decimated(48000, 1)
    expect(x.tract_state_len()).toBe(LEN)
    x.tract_set(6, 0.6) // breath
    x.tract_preset(0) // aaa
    for (let i = 0; i < 375 * 2; i++) x.tract_process(128) // two seconds
    x.tract_snapshot()
    const s = new Float32Array(x.memory.buffer, x.tract_state_ptr(), LEN)
    expect(s[at('ORAL_N')]).toBe(44)
    expect(s[at('NASAL_N')]).toBe(31)
    expect(s[at('F0')]).toBeGreaterThan(60)
    expect(s[at('MUSCLE')]).toBeGreaterThan(0)
    expect(Math.abs(s[at('MAX_RES')])).toBeLessThan(1e-9)
    const out = new Float32Array(x.memory.buffer, x.tract_out_ptr(), 128)
    expect(out.some((v) => v !== 0)).toBe(true)
  })
})
