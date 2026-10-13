/**
 * despacho-query-catalog.test.ts — el Despacho's named queries register into
 * the ONE sealed shell registry beside the Observatory's and source-sync's;
 * every focus-bearing one reports `usesFocus`; resolution splices a real
 * focus IRI and the graph id through the runtime's gates; and the grid
 * contract (`?item` per row) holds in every text.
 */
import { describe, expect, it } from 'vitest'
import { NamedQueryResolutionError } from '@shrubbery/runtime/layout'
import { DESPACHO_NAMED_QUERIES, DESPACHO_QUERY } from './despacho-query-catalog.js'
import { createShellNamedQueryRegistry } from './shell-named-query-registry.js'

const SEAT = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo:seat:sophia'

describe('the Despacho named queries in the shell registry', () => {
  it('register all sixteen under disjoint prefixes and seal', () => {
    const registry = createShellNamedQueryRegistry()
    for (const name of Object.values(DESPACHO_QUERY)) expect(registry.has(name)).toBe(true)
    expect(DESPACHO_NAMED_QUERIES).toHaveLength(16)
    expect(() => registry.register({ name: 'urn:sophia:query:despacho.late', text: 'SELECT ?item WHERE {}', description: 'late' })).toThrow()
  })

  it('carry the focus where they should, and bind ?item in every text', () => {
    const registry = createShellNamedQueryRegistry()
    expect(registry.usesFocus(DESPACHO_QUERY.children)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.seatInbox)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.seatRuns)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.letterThread)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.related)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.openGates)).toBe(false)
    // W4: a seat's own inbox and held work are focus-driven; the ROOMS are not
    // (an inbox is nobody's subject — whose it is comes from closed params).
    expect(registry.usesFocus(DESPACHO_QUERY.inboxUnanswered)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.inboxAwaitingWord)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.myWorkHeld)).toBe(true)
    expect(registry.usesFocus(DESPACHO_QUERY.myWorkGatedOn)).toBe(true)
    // W11: the gallery queries take no focus — they list the whole cast.
    expect(registry.usesFocus(DESPACHO_QUERY.galleryAll)).toBe(false)
    expect(registry.resolve(DESPACHO_QUERY.galleryKeepers, 'sophia-cluster')).toContain('"keeper"')
    expect(registry.resolve(DESPACHO_QUERY.galleryAll, 'sophia-cluster')).toContain('ORDER BY DESC(BOUND(?last)) DESC(?last) DESC(?in) ?item')
    for (const definition of DESPACHO_NAMED_QUERIES) expect(definition.text).toContain('?item')
  })

  it('scope W4’s four to the focus seat, and say in the text what the office join rests on', () => {
    const registry = createShellNamedQueryRegistry()
    const unanswered = registry.resolve(DESPACHO_QUERY.inboxUnanswered, 'sophia-cluster', SEAT)
    expect(unanswered).toContain('VALUES ?kind { "question" "request" }')
    expect(unanswered).toContain('FILTER NOT EXISTS { ?reply <http://sophia.ai/correo#replyTo> ?item }')
    expect(unanswered).toContain('FILTER NOT EXISTS { ?ack <http://sophia.ai/correo#acknowledges> ?item }')
    expect(unanswered).not.toContain('{{')

    // The three office-joined shapes read the seat's OWN id and join it to
    // cta:owner — no guessed match, which is why they are empty today.
    for (const name of [DESPACHO_QUERY.inboxAwaitingWord, DESPACHO_QUERY.myWorkHeld, DESPACHO_QUERY.myWorkGatedOn]) {
      const text = registry.resolve(name, 'sophia-cluster', SEAT)
      expect(text).toContain(`<${SEAT}> <http://sophia.ai/correo#seatId> ?office`)
      expect(text).toContain('<http://mnemosyne.dev/cuentas#owner> ?office')
      expect(text).not.toContain('{{')
    }

    const definitions = new Map(DESPACHO_NAMED_QUERIES.map((d) => [d.name, d]))
    // The emptiness is documented where a reader of the catalogue will meet it.
    expect(definitions.get(DESPACHO_QUERY.inboxAwaitingWord)!.description.toLowerCase()).toContain('empty')
    expect(definitions.get(DESPACHO_QUERY.myWorkHeld)!.description.toLowerCase()).toContain('empty')
    expect(definitions.get(DESPACHO_QUERY.myWorkGatedOn)!.description.toLowerCase()).toContain('empty')
  })

  it('resolve with the graph id and the focus spliced in, and refuse without a focus', () => {
    const registry = createShellNamedQueryRegistry()
    const inbox = registry.resolve(DESPACHO_QUERY.seatInbox, 'sophia-cluster', SEAT)
    expect(inbox).toContain('urn:mnemosyne:local:graph:sophia-cluster:projection:correo')
    expect(inbox).toContain(`<http://sophia.ai/correo#to> <${SEAT}>`)
    expect(inbox).not.toContain('{{')
    const related = registry.resolve(DESPACHO_QUERY.related, 'sophia-cluster', SEAT)
    expect(related).toContain('projection:cuentas')
    expect(related).toContain('projection:correo')
    expect(related).toContain('ORDER BY ?rank ?priority DESC(?at) ?item')
    expect(() => registry.resolve(DESPACHO_QUERY.letterThread, 'sophia-cluster')).toThrow(NamedQueryResolutionError)
    expect(() => registry.resolve(DESPACHO_QUERY.letterThread, 'sophia-cluster', 'not an iri')).toThrow(NamedQueryResolutionError)
  })
})
