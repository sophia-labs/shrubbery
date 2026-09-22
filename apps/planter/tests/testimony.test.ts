// @vitest-environment node

/**
 * testimony.test.ts — MED-3: liveness-aware capture wording. A 'static'
 * fossil is CAPTURED at a fixed point in the past; a 'poll'/'push' source
 * genuinely reads live. Every body block (footer, turtle capture comment,
 * both stale variants) must say so honestly — never "read live" for a
 * source that structurally cannot have an ongoing connection.
 */

import { describe, expect, it } from 'vitest'
import {
  staleCaptureMarkdown,
  staleCaptureTurtleComment,
  testimonyCaptureComment,
  testimonyFooter,
  type Testimony,
} from '../src/testimony.js'

const STATIC_T: Testimony = {
  readAt: Date.parse('2026-07-01T12:00:00Z'),
  readAtIso: '2026-07-01T12:00:00.000Z',
  graphIri: 'urn:example:g',
  tripleCount: 227,
  source: 'static-nt',
  liveness: 'static',
  endpoint: 'fixture:garden-default.ux.nt',
}

const LIVE_T: Testimony = {
  ...STATIC_T,
  source: 'gardend-local',
  liveness: 'poll',
  endpoint: 'http://127.0.0.1:7090/mcp',
}

describe('testimonyFooter — liveness-aware wording (MED-3)', () => {
  it("a 'static' fossil is CAPTURED, never 'read live'", () => {
    const footer = testimonyFooter(STATIC_T)
    expect(footer).toContain('captured')
    expect(footer).toContain('from fixture:garden-default.ux.nt')
    expect(footer).toContain('(static fossil)')
    expect(footer).not.toContain('read live')
    expect(footer).toContain('227 triples in <urn:example:g> (static)')
  })

  it("a 'poll' source genuinely reads live", () => {
    const footer = testimonyFooter(LIVE_T)
    expect(footer).toContain('read live from http://127.0.0.1:7090/mcp at')
    expect(footer).not.toContain('captured')
    expect(footer).not.toContain('static fossil')
    expect(footer).toContain('227 triples in <urn:example:g> (poll)')
  })
})

describe('testimonyCaptureComment — the turtle capture block, liveness-aware (MED-3)', () => {
  it("a 'static' fossil's comment block says CAPTURED", () => {
    const comment = testimonyCaptureComment(STATIC_T)
    expect(comment).toContain('# captured 2026-07-01T12:00:00.000Z from fixture:garden-default.ux.nt (static fossil)')
  })

  it("a 'poll' source's comment block says read live", () => {
    const comment = testimonyCaptureComment(LIVE_T)
    expect(comment).toContain('# read live from http://127.0.0.1:7090/mcp at 2026-07-01T12:00:00.000Z')
  })
})

describe('stale-capture blocks — liveness-aware wording (MED-3)', () => {
  it('staleCaptureMarkdown carries the same honest verb', () => {
    expect(staleCaptureMarkdown(STATIC_T)).toContain('captured')
    expect(staleCaptureMarkdown(STATIC_T)).toContain('(static fossil)')
    expect(staleCaptureMarkdown(LIVE_T)).toContain('read live from')
  })

  it('staleCaptureTurtleComment carries the same honest verb', () => {
    expect(staleCaptureTurtleComment(STATIC_T)).toContain('# captured')
    expect(staleCaptureTurtleComment(STATIC_T)).toContain('(static fossil)')
    expect(staleCaptureTurtleComment(LIVE_T)).toContain('# read live from')
  })
})
