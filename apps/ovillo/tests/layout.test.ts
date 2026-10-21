/**
 * The pages as data: the built-in layouts validate against the closed face
 * catalogue, the fixture's :ux:config is exactly them, a piece layout binds to
 * its piece, and the routes round-trip.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseNT } from '@shrubbery/nucleus'
import {
  PIECE_PLACEHOLDER,
  ROUTE_NAMES,
  UX_LAYOUT_JSON,
  bindPieceLayout,
  defaultOvilloLayouts,
  layoutNTriples,
  surfaceIri,
  validateOvilloLayout,
} from '../src/layout.js'
import { OVILLO_FACE_CATALOGUE } from '../src/faces.js'
import { OVILLO_FACE_IDS } from '../src/face-ids.js'
import { parseRoute, routeHash } from '../src/routes.js'
import { FIXTURE_DIR } from '../src/shell/site-middleware.js'

describe('layouts', () => {
  const docs = defaultOvilloLayouts()

  it('there is one per route and each validates', () => {
    expect(Object.keys(docs).sort()).toEqual([...ROUTE_NAMES].sort())
    for (const route of ROUTE_NAMES) expect(validateOvilloLayout(docs[route]).ok, route).toBe(true)
  })

  it('every face a layout names is in the catalogue, and every catalogue face is used', () => {
    const named = new Set<string>()
    for (const doc of Object.values(docs)) {
      for (const node of Object.values(doc.nodes)) {
        if (node.kind === 'leaf') named.add(node.descriptor.faceId)
        if (node.kind === 'grid' && node.children.kind === 'fixed') for (const c of node.children.cells) named.add(c.descriptor.faceId)
      }
    }
    expect([...named].sort()).toEqual(Object.values(OVILLO_FACE_IDS).sort())
    expect(OVILLO_FACE_CATALOGUE.map((f) => f.faceId).sort()).toEqual(Object.values(OVILLO_FACE_IDS).sort())
  })

  it('a layout naming a face outside the catalogue is refused', () => {
    const bad = JSON.parse(JSON.stringify(docs.bench))
    bad.nodes['ovillo-bench'].descriptor.faceId = 'somebody.else.v1'
    expect(validateOvilloLayout(bad).ok).toBe(false)
  })

  it('the fixture’s :ux:config is the built-in layouts, byte for byte', () => {
    const file = readFileSync(join(FIXTURE_DIR, 'ux-config.nt'), 'utf8')
    expect(file).toBe(layoutNTriples(docs))
    const triples = parseNT(file)
    for (const route of ROUTE_NAMES) {
      const json = triples.find((t) => t.s === surfaceIri(route) && t.p === UX_LAYOUT_JSON)!.o.value
      expect(JSON.parse(json)).toEqual(docs[route])
    }
  })

  it('a piece layout binds to the piece in the route', () => {
    const iri = 'https://ovillo.sophia-labs.com/id/piece/hilo-de-luz'
    const bound = bindPieceLayout(docs.piece, iri)
    const grid = Object.values(bound.nodes)[0]
    expect(grid.kind).toBe('grid')
    if (grid.kind !== 'grid' || grid.children.kind !== 'fixed') throw new Error('not a fixed grid')
    expect(grid.children.cells.map((c) => c.descriptor.resource)).toEqual(grid.children.cells.map(() => ({ kind: 'iri', iri })))
    expect(JSON.stringify(bound)).not.toContain(PIECE_PLACEHOLDER)
    expect(validateOvilloLayout(bound).ok).toBe(true)
  })
})

describe('routes', () => {
  it('parse and hash round-trip; anything else is the gallery', () => {
    for (const r of [{ name: 'home' }, { name: 'piece', slug: 'hilo-de-luz' }, { name: 'bench' }, { name: 'tract' }, { name: 'score', slug: 'agua-mansa' }] as const) {
      expect(parseRoute(routeHash(r))).toEqual(r)
    }
    expect(parseRoute('')).toEqual({ name: 'home' })
    expect(parseRoute('#/piece/')).toEqual({ name: 'home' })
    expect(parseRoute('#/piece/<script>')).toEqual({ name: 'home' })
    expect(parseRoute('#/nowhere')).toEqual({ name: 'home' })
  })
})
