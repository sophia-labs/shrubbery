/**
 * letter-reading.test.ts — the pure fold of real result rows into a
 * `LetterReading` (el Despacho W2). Rows are shaped as the cell's SELECT
 * bindings arrive, after the real letter `chat-claude-first-return-20260913`
 * (an answer to the sophia seat, with a replyTo) as read on 2026-09-15.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import { COR_NS } from '../seat-reading.js'
import {
  letterAcksQuery,
  letterLocalId,
  letterPartiesQuery,
  letterPropertiesQuery,
  letterRepliesQuery,
  readLetter,
} from '../letter-reading.js'

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const LETTER = `${G}:letter:chat-claude-first-return-20260913`
const PARENT = `${G}:letter:sophia-chat-claude-commission-20260913`
const SOPHIA = `${G}:seat:sophia`
const CHAT = `${G}:seat:chat-archive`

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string) {
  return { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}

const propsRows: QueryBlockRow[] = [
  { p: uri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), o: uri(`${COR_NS}Letter`) },
  { p: uri(`${COR_NS}messageId`), o: lit('chat-claude-first-return-20260913') },
  { p: uri(`${COR_NS}from`), o: uri(CHAT) },
  { p: uri(`${COR_NS}to`), o: uri(SOPHIA) },
  { p: uri(`${COR_NS}conversation`), o: lit('chat-archive-20260913') },
  { p: uri(`${COR_NS}letterKind`), o: lit('answer') },
  { p: uri(`${COR_NS}at`), o: lit('2026-09-13T23:46:50.295Z') },
  { p: uri(`${COR_NS}bodyPath`), o: lit('notes/2026-09-13-chat/RETURN.md') },
  { p: uri(`${COR_NS}bodySha256`), o: lit('4e8197b0c63fafbd50263f9be05ff7657131804397860e98aaaaaaaaaaaaaaaa') },
  { p: uri(`${COR_NS}excerpt`), o: lit('# Chat Demi — first return. Milestone 1 proven…') },
  { p: uri(`${COR_NS}replyTo`), o: uri(PARENT) },
  { p: uri(`${COR_NS}provenance`), o: lit('sophia-chat-claude-commission-20260913') },
  { p: uri(`${COR_NS}attestation`), o: lit('operator-attested-local') },
]

describe('the letter query shapes', () => {
  it('name the subject, scan every named graph, and order threads by time', () => {
    expect(letterPropertiesQuery(LETTER)).toBe(`SELECT ?p ?o WHERE { GRAPH ?g { <${LETTER}> ?p ?o } } LIMIT 200`)
    expect(letterPartiesQuery(LETTER)).toContain(`<${LETTER}> <${COR_NS}from> ?from ; <${COR_NS}to> ?to`)
    expect(letterRepliesQuery(LETTER)).toContain(`?r <${COR_NS}replyTo> <${LETTER}>`)
    expect(letterRepliesQuery(LETTER)).toContain('ORDER BY ?at ?r')
    expect(letterAcksQuery(LETTER)).toContain(`?a <${COR_NS}acknowledges> <${LETTER}>`)
    expect(letterLocalId(LETTER)).toBe('chat-claude-first-return-20260913')
    expect(letterLocalId(SOPHIA)).toBeNull()
  })
})

describe('readLetter', () => {
  it('folds the four results into one page with parties, thread and acknowledgement', () => {
    const parties = bindings(
      ['from', 'fromTitle', 'to', 'toTitle', 'replyTo', 'replyKind', 'replyAt', 'replyFrom', 'replyFromTitle', 'replyExcerpt'],
      [
        {
          from: uri(CHAT),
          fromTitle: lit('Chat Demi — conversation continuity'),
          to: uri(SOPHIA),
          toTitle: lit('Demi of Sophia — convenor'),
          replyTo: uri(PARENT),
          replyKind: lit('request'),
          replyAt: lit('2026-09-13T20:00:00.000Z'),
          replyFrom: uri(SOPHIA),
          replyFromTitle: lit('Demi of Sophia — convenor'),
          replyExcerpt: lit('Commission: pilot the Eva…'),
        },
      ],
    )
    const replies = bindings(
      ['r', 'kind', 'at', 'from', 'fromTitle', 'excerpt'],
      [{ r: uri(`${G}:letter:sophia-ack-20260914`), kind: lit('observation'), at: lit('2026-09-14T01:00:00.000Z'), from: uri(SOPHIA), fromTitle: lit('Demi of Sophia — convenor'), excerpt: lit('Received.') }],
    )
    const acks = bindings(['a', 'actor', 'actorTitle', 'at'], [{ a: uri(`${G}:ack:chat-claude-first-return-20260913`), actor: uri(SOPHIA), actorTitle: lit('Demi of Sophia — convenor'), at: lit('2026-09-14T00:05:00.000Z') }])
    const reading = readLetter(LETTER, bindings(['p', 'o'], propsRows), parties, replies, acks)
    expect(reading.found).toBe(true)
    expect(reading.isLetter).toBe(true)
    expect(reading.kind).toBe('answer')
    expect(reading.conversation).toBe('chat-archive-20260913')
    expect(reading.from).toEqual({ iri: CHAT, title: 'Chat Demi — conversation continuity' })
    expect(reading.to).toEqual({ iri: SOPHIA, title: 'Demi of Sophia — convenor' })
    expect(reading.excerpt).toBe('# Chat Demi — first return. Milestone 1 proven…')
    expect(reading.bodyPath).toBe('notes/2026-09-13-chat/RETURN.md')
    expect(reading.bodySha256).toMatch(/^4e8197b0/)
    expect(reading.provenance).toEqual(['sophia-chat-claude-commission-20260913'])
    expect(reading.replyTo).toEqual({ iri: PARENT, kind: 'request', at: '2026-09-13T20:00:00.000Z', from: { iri: SOPHIA, title: 'Demi of Sophia — convenor' }, excerpt: 'Commission: pilot the Eva…' })
    expect(reading.replies).toHaveLength(1)
    expect(reading.replies[0]!.from?.iri).toBe(SOPHIA)
    expect(reading.acks).toEqual([{ iri: `${G}:ack:chat-claude-first-return-20260913`, actor: { iri: SOPHIA, title: 'Demi of Sophia — convenor' }, at: '2026-09-14T00:05:00.000Z' }])
  })

  it('reads a letter with no parties row, no replies and no acknowledgement honestly', () => {
    const empty = bindings([], [])
    const reading = readLetter(LETTER, bindings(['p', 'o'], propsRows), empty, empty, empty)
    expect(reading.from).toBeNull()
    expect(reading.to).toBeNull()
    expect(reading.replyTo).toBeNull()
    expect(reading.replies).toEqual([])
    expect(reading.acks).toEqual([])
  })

  it('is honest about a missing subject and about a non-letter', () => {
    const empty = bindings([], [])
    expect(readLetter('urn:x:nothing', bindings(['p', 'o'], []), empty, empty, empty).found).toBe(false)
    const seat = readLetter(SOPHIA, bindings(['p', 'o'], [{ p: uri(`${COR_NS}seatId`), o: lit('sophia') }]), empty, empty, empty)
    expect(seat.found).toBe(true)
    expect(seat.isLetter).toBe(false)
  })
})
