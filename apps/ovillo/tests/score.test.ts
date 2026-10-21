// @vitest-environment node
/**
 * The score editor's excerpts, and (when a built mus-wasm is named by
 * OVILLO_MUS_WASM or MUS_WASM) the REAL engine checking and rendering them, in
 * process, on the same message protocol its Worker speaks.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInProcessMusPort, createMusWasmEngine } from '@shrubbery/runtime/mus'
import { parseEnergyTrace } from '@shrubbery/components/audio'
import { barCount, excerptScore } from '../src/score-excerpt.js'
import { FIXTURE_DIR } from '../src/shell/site-middleware.js'

const score = (slug: string): string => readFileSync(join(FIXTURE_DIR, 'site/scores', `${slug}.mus`), 'utf8')
const WASM = process.env.OVILLO_MUS_WASM ?? process.env.MUS_WASM ?? ''

describe('excerpts', () => {
  it('keeps the header and the first bars, and says the new length', () => {
    const s = score('hilo-de-luz')
    expect(barCount(s)).toBe(18)
    const ex = excerptScore(s, 2)
    expect(barCount(ex)).toBe(2)
    expect(ex).toContain('bars: 2')
    expect(ex).not.toContain('bars: 18')
    // Every header line before the first bar is kept, word for word but the count.
    const head = (t: string): string[] => t.split('\n').slice(0, t.split('\n').findIndex((l) => l.startsWith('bar ')))
    expect(head(ex)).toEqual(head(s).map((l) => l.replace('bars: 18', 'bars: 2')))
    expect(ex.split('\n').filter((l) => l.startsWith('bar '))).toEqual(s.split('\n').filter((l) => l.startsWith('bar ')).slice(0, 2))
  })

  it('asks for more bars than there are and gets the whole score', () => {
    const s = score('gigante-y-juguete')
    expect(barCount(excerptScore(s, 99))).toBe(barCount(s))
  })
})

describe.skipIf(!WASM || !existsSync(WASM))('the real engine on the excerpts', () => {
  it('every fixture score’s first bars check clean; one renders on its Worlds, with its energy and ledger', async () => {
    const bytes = readFileSync(WASM)
    const engine = await createMusWasmEngine({ wasm: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), port: createInProcessMusPort() })
    try {
      for (const slug of ['hilo-de-luz', 'gigante-y-juguete']) {
        const report = await engine.check(excerptScore(score(slug), 2))
        expect(report.clean, slug).toBe(true)
      }
      // Two bars: the canon's second World comes in during the second.
      const take = await engine.render(excerptScore(score('gigante-y-juguete'), 2))
      const worlds = take.receipt.ariadneWorlds ?? []
      expect(worlds.map((w) => w.instrument).sort()).toEqual(['gg', 'jj'])
      const trace = parseEnergyTrace(take.energy)
      expect(trace.bodies.map((b) => b.id)).toEqual(['strings', 'box', 'room'])
      expect([...trace.worlds].sort()).toEqual(['gg', 'jj'])
      expect(take.frames / take.sampleRate).toBeLessThan(12)
    } finally {
      engine.dispose()
    }
  }, 600_000)
})
