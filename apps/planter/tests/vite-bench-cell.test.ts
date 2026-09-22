// @vitest-environment node

/**
 * vite-bench-cell.test.ts — MED-6: `benchCell()` is a FALLBACK, never a
 * second set of guessed defaults. It must resolve `undefined` (never a
 * hardcoded `127.0.0.1:7090` + `bench-token` guess) unless the caller
 * EXPLICITLY set both `GARDEND_PORT` and `GARDEND_TOKEN` — otherwise
 * `dynamicCellProxy`'s own honest structured 503 would be silently masked.
 */

import { describe, expect, it } from 'vitest'
import { benchCell } from '../vite-bench-cell.js'

describe('benchCell — dev-proxy fallback (MED-6: no guessed coordinates)', () => {
  it('resolves undefined when NEITHER GARDEND_PORT nor GARDEND_TOKEN is set (never a guessed default)', () => {
    expect(benchCell({})).toBeUndefined()
  })

  it('resolves undefined when only GARDEND_PORT is set (a half-specified override, not a guess to complete)', () => {
    expect(benchCell({ GARDEND_PORT: '7090' })).toBeUndefined()
  })

  it('resolves undefined when only GARDEND_TOKEN is set', () => {
    expect(benchCell({ GARDEND_TOKEN: 'bench-token' })).toBeUndefined()
  })

  it('resolves a real endpoint only when BOTH are explicitly set', () => {
    expect(benchCell({ GARDEND_PORT: '7090', GARDEND_TOKEN: 'bench-token' })).toEqual({
      apiUrl: 'http://127.0.0.1:7090',
      token: 'bench-token',
    })
  })

  it('GARDEND_HOST overrides the loopback host when the other two are explicit', () => {
    expect(
      benchCell({ GARDEND_HOST: '127.0.0.2', GARDEND_PORT: '9000', GARDEND_TOKEN: 'tok' }),
    ).toEqual({ apiUrl: 'http://127.0.0.2:9000', token: 'tok' })
  })
})
