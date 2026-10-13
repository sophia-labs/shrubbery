/**
 * inbox-reading.test.ts — the pure fold of real result rows into an
 * `InboxReading` (el Despacho W4). Rows are shaped exactly as the cell's
 * SELECT bindings arrive; the gates are the real open gates of
 * sophia-cluster's cuentas projection as read on 2026-09-16.
 *
 * What these tests hold to: ready is COMPUTED (an unknown blocker is NOT
 * done), the order is ready-then-priority-then-oldest, an office name enters
 * a query only as an escaped literal, and a reader clears only their own
 * readings — an empty reader clears nothing.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import { CTA_NS } from '../cuenta-reading.js'
import { COR_NS } from '../seat-reading.js'
import {
  correoGraphIri,
  cuentasGraphIri,
  inboxGatesQuery,
  inboxLettersQuery,
  inboxReturnsQuery,
  readInbox,
  rendicionLocalId,
  sparqlStringLiteral,
} from '../inbox-reading.js'

const CUENTAS = cuentasGraphIri('sophia-cluster')
const CORREO = correoGraphIri('sophia-cluster')
const SOPHIA_SEAT = `${CORREO}:seat:sophia`
const GATE_NAME = `${CUENTAS}:cuenta:despacho-g-name`
const GATE_DORMANT = `${CUENTAS}:cuenta:despacho-d-choreograph-dormant`
const WAVE_W2 = `${CUENTAS}:cuenta:despacho-w2`

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string, datatype?: string) {
  return datatype ? { type: 'literal' as const, value, datatype } : { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}
const empty = bindings([], [])

describe('the inbox query shapes', () => {
  it('name their graph explicitly so a room mirror answers them locally', () => {
    expect(inboxGatesQuery(CUENTAS, 'vera')).toContain(`GRAPH <${CUENTAS}>`)
    expect(inboxLettersQuery(CORREO, [SOPHIA_SEAT])).toContain(`GRAPH <${CORREO}>`)
    expect(inboxReturnsQuery(CUENTAS, 'vera')).toContain(`GRAPH <${CUENTAS}>`)
  })

  it('ask only for OPEN gates of beadKind gate held by the office, with each blocker’s own status', () => {
    const q = inboxGatesQuery(CUENTAS, 'vera')
    expect(q).toContain(`<${CTA_NS}beadKind> "gate"`)
    expect(q).toContain(`<${CTA_NS}status> "open"`)
    expect(q).toContain(`<${CTA_NS}owner> "vera"`)
    expect(q).toContain(`VALUES ?edge { <${CTA_NS}needs> <${CTA_NS}gatedBy> }`)
  })

  it('ask only for unanswered questions and requests — no reply, no acknowledgement', () => {
    const q = inboxLettersQuery(CORREO, [SOPHIA_SEAT])
    expect(q).toContain('VALUES ?kind { "question" "request" }')
    expect(q).toContain(`FILTER NOT EXISTS { ?reply <${COR_NS}replyTo> ?letter }`)
    expect(q).toContain(`FILTER NOT EXISTS { ?ack <${COR_NS}acknowledges> ?letter }`)
    expect(q).toContain(`VALUES ?to { <${SOPHIA_SEAT}> }`)
  })

  it('clear returns only by the reader’s OWN testimony, and clear nothing when there is no reader', () => {
    const withReader = inboxReturnsQuery(CUENTAS, 'e9e949fe-0091-7015-0ab8-10bf259084ab')
    expect(withReader).toContain(`<${CTA_NS}reader> "e9e949fe-0091-7015-0ab8-10bf259084ab"`)
    expect(withReader).toContain(`<${CTA_NS}forRendicion> ?r`)
    // A reader does not need to read back their own account.
    expect(withReader).toContain('FILTER(?witness != "e9e949fe-0091-7015-0ab8-10bf259084ab")')

    const anonymous = inboxReturnsQuery(CUENTAS, '')
    expect(anonymous).not.toContain('FILTER NOT EXISTS')
    expect(anonymous).not.toContain('FILTER(?witness')
  })

  it('escape an office name into a literal — a quote or a backslash cannot leave the string', () => {
    expect(sparqlStringLiteral('ve"ra')).toBe('"ve\\"ra"')
    expect(sparqlStringLiteral('back\\slash')).toBe('"back\\\\slash"')
    expect(sparqlStringLiteral('two\nlines')).toBe('"two\\nlines"')
    expect(inboxGatesQuery(CUENTAS, 'ev"il')).toContain('<http://mnemosyne.dev/cuentas#owner> "ev\\"il"')
  })
})

describe('readInbox — gates', () => {
  it('computes ready from the blockers and puts ready gates first', () => {
    const gates = bindings(
      ['gate', 'title', 'priority', 'createdAt', 'dep', 'depStatus'],
      [
        // blocked: one blocker still open
        { gate: uri(GATE_DORMANT), title: lit('the dormant agents'), priority: lit('1'), createdAt: lit('2026-09-16T05:00:00Z'), dep: uri(WAVE_W2), depStatus: lit('open') },
        // ready: no blockers at all
        { gate: uri(GATE_NAME), title: lit('the name'), priority: lit('2'), createdAt: lit('2026-09-16T04:00:00Z') },
      ],
    )
    const reading = readInbox('vera', [SOPHIA_SEAT], 'vera-sub', gates, empty, empty)
    expect(reading.gates.map((g) => g.iri)).toEqual([GATE_NAME, GATE_DORMANT])
    expect(reading.gates[0]!.ready).toBe(true)
    expect(reading.gates[1]!.ready).toBe(false)
    expect(reading.counts).toEqual({ gates: 2, ready: 1, letters: 0, returns: 0 })
  })

  it('treats a blocker of UNKNOWN status as not done — an unread dependency never makes a gate ready', () => {
    const gates = bindings(
      ['gate', 'title', 'dep', 'depStatus'],
      [{ gate: uri(GATE_NAME), title: lit('the name'), dep: uri(`${CUENTAS}:cuenta:vanished`) }],
    )
    const reading = readInbox('vera', [], '', gates, empty, empty)
    expect(reading.gates[0]!.ready).toBe(false)
    expect(reading.gates[0]!.blockers).toEqual([{ target: `${CUENTAS}:cuenta:vanished`, status: null }])
  })

  it('folds one gate’s many blocker rows into one gate, ready only when every blocker is done', () => {
    const gates = bindings(
      ['gate', 'title', 'dep', 'depStatus'],
      [
        { gate: uri(GATE_NAME), title: lit('the name'), dep: uri(WAVE_W2), depStatus: lit('done') },
        { gate: uri(GATE_NAME), title: lit('the name'), dep: uri(GATE_DORMANT), depStatus: lit('done') },
      ],
    )
    const reading = readInbox('vera', [], '', gates, empty, empty)
    expect(reading.gates).toHaveLength(1)
    expect(reading.gates[0]!.blockers).toHaveLength(2)
    expect(reading.gates[0]!.ready).toBe(true)
  })

  it('orders equal-readiness gates by priority, then oldest first', () => {
    const gates = bindings(
      ['gate', 'title', 'priority', 'createdAt'],
      [
        { gate: uri(`${CUENTAS}:cuenta:c`), title: lit('c'), createdAt: lit('2026-09-16T01:00:00Z') },
        { gate: uri(`${CUENTAS}:cuenta:a`), title: lit('a'), priority: lit('0'), createdAt: lit('2026-09-16T03:00:00Z') },
        { gate: uri(`${CUENTAS}:cuenta:b`), title: lit('b'), priority: lit('0'), createdAt: lit('2026-09-16T02:00:00Z') },
      ],
    )
    const reading = readInbox('vera', [], '', gates, empty, empty)
    // priority 0 before unknown; within priority 0, the older one first.
    expect(reading.gates.map((g) => g.title)).toEqual(['b', 'a', 'c'])
    expect(reading.gates[2]!.priority).toBeNull()
  })
})

describe('readInbox — letters and returns', () => {
  it('reads a letter with its sender title and excerpt, de-duplicated by subject', () => {
    const letters = bindings(
      ['letter', 'from', 'fromTitle', 'to', 'kind', 'at', 'excerpt', 'conversation'],
      [
        {
          letter: uri(`${CORREO}:letter:ask-20260913`),
          from: uri(`${CORREO}:seat:chat-archive`),
          fromTitle: lit('Chat Demi — conversation continuity'),
          to: uri(SOPHIA_SEAT),
          kind: lit('question'),
          at: lit('2026-09-13T20:11:15Z'),
          excerpt: lit('# Chat Demi — first return'),
          conversation: lit('chat-claude-20260913'),
        },
        { letter: uri(`${CORREO}:letter:ask-20260913`), from: uri(`${CORREO}:seat:chat-archive`), to: uri(SOPHIA_SEAT), kind: lit('question'), at: lit('2026-09-13T20:11:15Z') },
      ],
    )
    const reading = readInbox('vera', [SOPHIA_SEAT], '', empty, letters, empty)
    expect(reading.letters).toHaveLength(1)
    expect(reading.letters[0]!.fromTitle).toBe('Chat Demi — conversation continuity')
    expect(reading.letters[0]!.kind).toBe('question')
  })

  it('reads an account with its word and the title of the bead it closed', () => {
    const returns = bindings(
      ['r', 'forCuenta', 'forTitle', 'verdict', 'witness', 'summary', 'renderedAt', 'word'],
      [
        {
          r: uri(`${CUENTAS}:rendicion:despacho-w1-proof-gate-r1`),
          forCuenta: uri(`${CUENTAS}:cuenta:despacho-w1-proof-gate`),
          forTitle: lit('Vera’s word — the surface can close a gate'),
          verdict: lit('done'),
          witness: lit('e9e949fe-0091-7015-0ab8-10bf259084ab'),
          summary: lit('Word given from el Despacho: yes.'),
          renderedAt: lit('2026-09-16T01:28:16Z'),
          word: lit('yes'),
        },
      ],
    )
    const reading = readInbox('vera', [], 'demi', empty, empty, returns)
    expect(reading.returns).toHaveLength(1)
    expect(reading.returns[0]!.word).toBe('yes')
    expect(reading.returns[0]!.forTitle).toBe('Vera’s word — the surface can close a gate')
    expect(reading.counts.returns).toBe(1)
  })

  it('carries the owner, the convened seats and the reader through the fold unchanged', () => {
    const reading = readInbox('vera', [SOPHIA_SEAT], 'vera-sub', empty, empty, empty)
    expect(reading.owner).toBe('vera')
    expect(reading.seats).toEqual([SOPHIA_SEAT])
    expect(reading.reader).toBe('vera-sub')
    expect(reading.counts).toEqual({ gates: 0, ready: 0, letters: 0, returns: 0 })
  })

  it('survives a result that is not bindings at all', () => {
    const boolean = { queryKind: 'ask', resultKind: 'boolean', boolean: true, durationMs: 1, raw: null } as unknown as QueryBlockResult
    const reading = readInbox('vera', [], '', boolean, boolean, boolean)
    expect(reading.counts).toEqual({ gates: 0, ready: 0, letters: 0, returns: 0 })
  })
})

describe('rendicionLocalId', () => {
  it('reads the local id of an account subject, and refuses anything else', () => {
    expect(rendicionLocalId(`${CUENTAS}:rendicion:despacho-w1-proof-gate-r1`)).toBe('despacho-w1-proof-gate-r1')
    expect(rendicionLocalId(`${CUENTAS}:cuenta:despacho-g-name`)).toBeNull()
    expect(rendicionLocalId('not an iri')).toBeNull()
    expect(rendicionLocalId(`${CUENTAS}:rendicion:`)).toBeNull()
  })
})
