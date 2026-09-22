/**
 * grow-turn-driver.test.ts — REAL no-mock test of the DETERMINISTIC GROW-DRIVER (N0a).
 *
 * The driver is exercised against a REAL in-memory GrowCell port — NOT a vi.fn.
 * The port holds a WorkspaceConfig and implements the two cell operations with the
 * SAME production nucleus functions grow() expects on the real cell:
 *   - readConfig  = serialize the held config → N-Triples → parseNT →
 *     parseTriplesToConfig (a genuine RDF round-trip, the loadConfigFromCell path).
 *   - loadDelta   = parse the additive N-Triples delta + UNION it into the held
 *     triples (rdf_load is additive into the named graph) → re-parse to a config.
 * So grow() runs its REAL catalog gate, REAL spine gate, REAL additive-delta guard,
 * and a REAL rdf_load-equivalent write; the driver narrates the REAL result.
 *
 * Asserts:
 *   1. A matching phrase drives a REAL grow() (the held config actually GROWS — the
 *      new chrome region appears) and emits the right ChatEvent sequence:
 *      turn_start → tool_call('grow_interface', verbSpec) → tool_result(ok) →
 *      text ack → done. Exactly one terminal done.
 *   2. Phrase normalization (punctuation/case/whitespace) still matches.
 *   3. A NO-match turn emits turn_start → text(capability list) → done, and does
 *      NOT grow (no write reaches the port).
 *   4. Re-running the SAME phrase is idempotent (empty additive delta) and the ack
 *      says so — still ok, no error.
 */

import { describe, it, expect } from 'vitest'
import {
  minimalTextPanelConfig,
  serializeConfigToTriples,
  parseTriplesToConfig,
  triplesToNT,
  parseNT,
  type WorkspaceConfig,
  type Triple,
} from '@shrubbery/nucleus'
import type { ChatEvent } from '@shrubbery/chat-kernel'
import { makeGrowTurnDriver } from '../grow-turn-driver.js'
import type { GrowCell } from '../../grow/grow.js'

/** Canonical N-Triples line of one triple (set-membership key, like grow's). */
const lineOf = (t: Triple): string => triplesToNT([t])

/**
 * A REAL in-memory GrowCell — the held config IS the cell's :ux:config state.
 * readConfig does a genuine serialize → NT → parse round-trip; loadDelta unions the
 * additive delta in (the rdf_load contract: never deletes). No mock anywhere.
 */
function makeInMemoryCell(seed: WorkspaceConfig): {
  port: GrowCell
  /** Snapshot the cell's current config (post-round-trip), for assertions. */
  current(): WorkspaceConfig
  /** How many loadDelta writes have happened (to prove a no-match never writes). */
  writeCount(): number
} {
  // The cell stores its named-graph triples as a deduped line set (rdf_load semantics).
  let lines = new Set<string>(serializeConfigToTriples(seed).map(lineOf))
  let writes = 0

  const readConfig = async (_graphId: string): Promise<WorkspaceConfig> => {
    // Reconstruct N-Triples from the stored lines, then run the production parse.
    const nt = [...lines].join('\n')
    return parseTriplesToConfig(parseNT(nt))
  }

  const loadDelta = async (_graphId: string, nt: string, _targetGraphIri: string): Promise<void> => {
    writes += 1
    // Additive union — rdf_load appends into the named graph, never clears.
    const next = new Set(lines)
    for (const t of parseNT(nt)) next.add(lineOf(t))
    lines = next
  }

  return {
    port: { readConfig, loadDelta },
    current: () => parseTriplesToConfig(parseNT([...lines].join('\n'))),
    writeCount: () => writes,
  }
}

/** Drain a driver's event stream into an array (the host-side consume loop). */
async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

const GRAPH_ID = 'atelier-test'

describe('makeGrowTurnDriver — a phrase drives a REAL grow() + emits the right ChatEvents', () => {
  it('a matching phrase GROWS the real config and emits turn_start → tool_call → tool_result(ok) → text → done', async () => {
    const cell = makeInMemoryCell(minimalTextPanelConfig())
    // The seed has NO top-bar root.
    expect(cell.current().rootRegions).not.toContain('region-top-bar')

    const drive = makeGrowTurnDriver(cell.port, GRAPH_ID)
    const events = await collect(drive('give me a top bar'))

    // (a) The REAL side effect happened: the config GREW — region-top-bar is now a
    //     rooted region rendered by mn-top-bar (the W0 grow).
    const grown = cell.current()
    expect(grown.rootRegions).toContain('region-top-bar')
    expect(grown.regions['region-top-bar']?.renderedByComponent).toBe('mn-top-bar')
    expect(cell.writeCount()).toBe(1)

    // (b) The exact ChatEvent sequence (real events, not vi.fn).
    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'tool_call',
      'tool_result',
      'text',
      'done',
    ])

    const call = events[1]
    expect(call.type).toBe('tool_call')
    if (call.type === 'tool_call') {
      expect(call.gate).toBe('grow_interface')
      expect(call.args).toEqual({
        verb: 'add_root_region',
        regionId: 'region-top-bar',
        component: 'mn-top-bar',
      })
    }

    const res = events[2]
    expect(res.type).toBe('tool_result')
    if (res.type === 'tool_result') {
      expect(res.gate).toBe('grow_interface')
      expect(res.is_error).toBe(false)
      // result is JSON of { ok, delta } — the delta is the additive append.
      const parsed = JSON.parse(res.result) as { ok: boolean; delta: string }
      expect(parsed.ok).toBe(true)
      expect(parsed.delta.length).toBeGreaterThan(0)
    }

    const ack = events[3]
    expect(ack.type).toBe('text')
    if (ack.type === 'text') expect(ack.content).toContain('your interface just grew')

    const done = events[4]
    expect(done.type).toBe('done')
    // Exactly one terminal event.
    expect(events.filter((e) => e.type === 'done').length).toBe(1)
  })

  it('normalizes punctuation/case/whitespace and still matches (and still grows)', async () => {
    const cell = makeInMemoryCell(minimalTextPanelConfig())
    const drive = makeGrowTurnDriver(cell.port, GRAPH_ID)

    const events = await collect(drive('  Give me a  FOOTER!  '))

    expect(cell.current().rootRegions).toContain('region-bottom-bar')
    expect(cell.writeCount()).toBe(1)
    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'tool_call',
      'tool_result',
      'text',
      'done',
    ])
    const call = events[1]
    if (call.type === 'tool_call') expect(call.args.regionId).toBe('region-bottom-bar')
  })

  it('a NO-match turn emits turn_start → text(capability list) → done and NEVER writes', async () => {
    const cell = makeInMemoryCell(minimalTextPanelConfig())
    const before = cell.current()
    const drive = makeGrowTurnDriver(cell.port, GRAPH_ID)

    const events = await collect(drive('what is the meaning of life'))

    // No grow happened.
    expect(cell.writeCount()).toBe(0)
    expect(cell.current().rootRegions).toEqual(before.rootRegions)

    expect(events.map((e) => e.type)).toEqual(['turn_start', 'text', 'done'])
    const help = events[1]
    expect(help.type).toBe('text')
    if (help.type === 'text') {
      // It lists what it CAN add (the first phrase of each intent).
      expect(help.content).toContain('give me a top bar')
      expect(help.content).toContain('I can grow your interface')
    }
  })

  it('re-running the SAME phrase is IDEMPOTENT (empty delta, no second write) — ok, no duplicate', async () => {
    // IDEMPOTENCY: addRootRegion no-ops when the region is already rooted, so a
    // re-run produces an EMPTY additive delta; grow() short-circuits (no rdf_load)
    // and returns { ok:true, delta:'' }. The driver narrates "already there" rather
    // than appending a duplicate root entry. grow() never errors; the cell is
    // written exactly ONCE across two identical phrases.
    const cell = makeInMemoryCell(minimalTextPanelConfig())
    const drive = makeGrowTurnDriver(cell.port, GRAPH_ID)

    await collect(drive('add an app bar')) // first grow — the real write
    expect(cell.current().rootRegions).toContain('region-app-bar')
    expect(cell.writeCount()).toBe(1)

    const events = await collect(drive('add an app bar')) // second — idempotent no-op

    // No duplicate root entry, and no second write to the cell.
    expect(cell.current().rootRegions.filter((r) => r === 'region-app-bar')).toHaveLength(1)
    expect(cell.writeCount()).toBe(1)

    const res = events[2]
    expect(res.type).toBe('tool_result')
    if (res.type === 'tool_result') {
      // Idempotent re-run: ok, NOT an error, and the delta is empty.
      expect(res.is_error).toBe(false)
      const parsed = JSON.parse(res.result) as { ok: boolean; delta: string }
      expect(parsed.ok).toBe(true)
      expect(parsed.delta.trim()).toBe('')
    }
    const ack = events[events.length - 2]
    if (ack.type === 'text') expect(ack.content).toContain('already there')
    const done = events[events.length - 1]
    expect(done.type).toBe('done')
  })
})
