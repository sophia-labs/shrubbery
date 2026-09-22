// @vitest-environment happy-dom

/**
 * poll-confession.test.ts — MED-1: "give the live adapters a suggestedPollMs
 * named constant... have the SPA use config.pollMs ?? suggestedPollMs, and
 * render the active interval in the status strip; a source that resolves NO
 * interval while declaring 'poll' must visibly confess ... rather than
 * silently not polling. Test both paths."
 *
 * Two things are pure and directly unit-testable without a live TripleSource:
 *   - `resolvePollOption` (main.ts) — the config.pollMs ?? suggestedPollMs
 *     resolution, including the 'none' confession when NEITHER resolves
 *     (a legitimate scenario for a third-party TripleSource that declares
 *     'poll' but supplies no suggestedPollMs — none of THIS package's own
 *     adapters can produce it any more, per poll.ts's DEFAULT_SUGGESTED_POLL_MS,
 *     but the interface allows it and the host must still confess honestly).
 *   - `createStatusStrip().update()` — the chip's rendering of both a real
 *     interval and the 'none' confession.
 */

import { describe, expect, it } from 'vitest'
import { resolvePollOption } from '../src/main.js'
import { createStatusStrip } from '../src/status-strip.js'
import type { Testimony } from '../src/testimony.js'

describe('resolvePollOption', () => {
  it("'static' liveness never has a poll concept — always undefined, regardless of pollMs/suggestedPollMs", () => {
    expect(resolvePollOption({ liveness: 'static', suggestedPollMs: 9000 }, { pollMs: 500 })).toBeUndefined()
    expect(resolvePollOption({ liveness: 'static' }, {})).toBeUndefined()
  })

  it("'poll' liveness: boot pollMs wins over the adapter's suggestedPollMs", () => {
    expect(resolvePollOption({ liveness: 'poll', suggestedPollMs: 5000 }, { pollMs: 1500 })).toBe(1500)
  })

  it("'poll' liveness: falls back to the adapter's suggestedPollMs when boot pollMs is absent", () => {
    expect(resolvePollOption({ liveness: 'poll', suggestedPollMs: 5000 }, {})).toBe(5000)
  })

  it("'poll' liveness with NO resolvable interval anywhere confesses 'none' — never silently undefined", () => {
    expect(resolvePollOption({ liveness: 'poll' }, {})).toBe('none')
  })
})

describe('status strip — renders the active poll interval, or confesses its absence (MED-1)', () => {
  const T: Testimony = {
    readAt: 1_000_000,
    readAtIso: new Date(1_000_000).toISOString(),
    graphIri: 'urn:example:g',
    tripleCount: 3,
    source: 'gardend-local',
    liveness: 'poll',
  }

  it('renders the numeric interval', () => {
    const strip = createStatusStrip()
    strip.update(T, { pollMs: 5000 }, 1_030_000)
    expect(strip.element.querySelector('.mn-kind')!.getAttribute('data-poll-ms')).toBe('5000')
    expect(strip.element.textContent).toContain('poll 5000ms')
  })

  it("confesses 'no poll interval — showing a single read' when none resolves", () => {
    const strip = createStatusStrip()
    strip.update(T, { pollMs: 'none' }, 1_030_000)
    expect(strip.element.querySelector('.mn-kind')!.getAttribute('data-poll-ms')).toBe('none')
    expect(strip.element.textContent).toContain('no poll interval — showing a single read')
  })

  it('omits the poll segment entirely when pollMs option is not supplied (a static source)', () => {
    const strip = createStatusStrip()
    const staticTestimony: Testimony = { ...T, source: 'static-nt', liveness: 'static' }
    strip.update(staticTestimony, {}, 1_030_000)
    expect(strip.element.querySelector('.mn-kind')!.hasAttribute('data-poll-ms')).toBe(false)
    expect(strip.element.textContent).toBe('read just now · static-nt · static')
  })
})
