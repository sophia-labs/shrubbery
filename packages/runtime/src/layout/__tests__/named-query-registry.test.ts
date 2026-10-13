import { describe, expect, it } from 'vitest'
import {
  DuplicateNamedQueryError,
  InvalidNamedQueryDefinitionError,
  NamedQueryRegistry,
  NamedQueryRegistrySealedError,
  NamedQueryResolutionError,
  createQueryTextResolver,
  isEmbeddableFocusIri,
  isEmbeddableGraphId,
  isNamedQueryRef,
} from '../named-query-registry.js'

const definition = {
  name: 'urn:sophia:query:obs.example',
  text: 'SELECT * WHERE { GRAPH <urn:mnemosyne:local:graph:{{graphId}:x> { ?s ?p ?o } }',
  description: 'test query',
} as const

function invalid(name: string, text: string, description = 'test query'): InvalidNamedQueryDefinitionError {
  const registry = new NamedQueryRegistry()
  try {
    registry.register({ name, text, description })
  } catch (error) {
    if (error instanceof InvalidNamedQueryDefinitionError) return error
    throw error
  }
  throw new Error('expected invalid definition')
}

describe('NamedQueryRegistry', () => {
  it('accepts only the URN grammar, not bare dotted names or raw text', () => {
    expect(isNamedQueryRef(definition.name)).toBe(true)
    for (const value of ['obs.freshness', 'urn:sophia:query:', 'urn:sophia:query:Obs', 'urn:sophia:query:obs..x', 'urn:sophia:query:9obs', 'SELECT * WHERE {}']) {
      expect(isNamedQueryRef(value)).toBe(false)
      expect(invalid(value, 'SELECT * WHERE {}').reason).toBe('bad-name')
    }
  })

  it('rejects unknown placeholders and empty fields in contract order', () => {
    expect(invalid(definition.name, 'SELECT {{metricIri}}', 'x').reason).toBe('unknown-placeholder')
    expect(invalid(definition.name, '   ', 'x').reason).toBe('empty-text')
    expect(invalid(definition.name, 'SELECT * WHERE {}', '  ').reason).toBe('empty-description')
  })

  it('rejects duplicates and registrations after sealing', () => {
    const registry = new NamedQueryRegistry()
    registry.register(definition)
    expect(() => registry.register(definition)).toThrow(DuplicateNamedQueryError)
    registry.seal()
    expect(() => registry.register({ ...definition, name: 'urn:sophia:query:other' })).toThrow(NamedQueryRegistrySealedError)
    expect(registry.isSealed).toBe(true)
  })

  it('resolves every graph placeholder and returns stable sorted names', () => {
    const registry = new NamedQueryRegistry()
    registry.register({ ...definition, text: '{{graphId}}/{{graphId}}' })
    registry.register({ ...definition, name: 'urn:sophia:query:aaa', text: 'x' })
    expect(registry.resolve(definition.name, 'observatory')).toBe('observatory/observatory')
    expect(registry.names()).toEqual(['urn:sophia:query:aaa', definition.name].sort())
    expect(registry.get(definition.name)).not.toBe(definition)
    expect(Object.isFrozen(registry.get(definition.name))).toBe(true)
  })

  it('refuses unsafe graph ids before lookup and allows the gateway-safe grammar', () => {
    expect(isEmbeddableGraphId('observatory')).toBe(true)
    expect(isEmbeddableGraphId('obs-2')).toBe(true)
    for (const graphId of ['a b', 'a>b', '<x>', '', 'a'.repeat(41)]) expect(isEmbeddableGraphId(graphId)).toBe(false)
    const registry = new NamedQueryRegistry()
    registry.register(definition)
    expect(() => registry.resolve(definition.name, '<x>')).toThrowError(NamedQueryResolutionError)
    try {
      registry.resolve(definition.name, '<x>')
    } catch (error) {
      expect(error).toMatchObject({ reason: 'unsafe-graph-id' })
    }
  })
})

describe('NamedQueryRegistry — the {{focus}} placeholder (el Despacho W1)', () => {
  const FOCUS = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas:cuenta:sirin-g-slice-accepted'
  const focused = {
    name: 'urn:sophia:query:cuenta.children',
    text: 'SELECT ?item WHERE { GRAPH ?g { ?item ?edge <{{focus}}> } }',
    description: 'beads pointing at the focus',
  } as const

  it('registers a focus-bearing definition and reports usesFocus; still refuses unknown placeholders', () => {
    const registry = new NamedQueryRegistry()
    registry.register(focused)
    registry.register(definition)
    expect(registry.usesFocus(focused.name)).toBe(true)
    expect(registry.usesFocus(definition.name)).toBe(false)
    expect(registry.usesFocus('urn:sophia:query:never.registered')).toBe(false)
    expect(invalid('urn:sophia:query:x', 'SELECT {{cursor}}').reason).toBe('unknown-placeholder')
  })

  it('substitutes the focus into a named query and refuses a missing or unsafe one, in that order', () => {
    const registry = new NamedQueryRegistry()
    registry.register(focused)
    expect(registry.resolve(focused.name, 'sophia-cluster', FOCUS)).toBe(
      `SELECT ?item WHERE { GRAPH ?g { ?item ?edge <${FOCUS}> } }`,
    )
    expect(() => registry.resolve(focused.name, 'sophia-cluster')).toThrowError(NamedQueryResolutionError)
    try {
      registry.resolve(focused.name, 'sophia-cluster')
    } catch (error) {
      expect(error).toMatchObject({ reason: 'missing-focus' })
    }
    try {
      registry.resolve(focused.name, 'sophia-cluster', 'urn:x> } } DROP ALL #')
    } catch (error) {
      expect(error).toMatchObject({ reason: 'unsafe-focus' })
    }
    // A definition WITHOUT the placeholder ignores a supplied focus.
    registry.register(definition)
    expect(registry.resolve(definition.name, 'observatory', FOCUS)).not.toContain(FOCUS)
  })

  it('gates the focus grammar: absolute IRIs only, none of the splice-breaking characters', () => {
    expect(isEmbeddableFocusIri(FOCUS)).toBe(true)
    expect(isEmbeddableFocusIri('https://sophia.ai/x#y')).toBe(true)
    for (const focus of ['', 'sirin-g-slice-accepted', 'urn:a b', 'urn:a"b', "urn:a'b", 'urn:a<b>', 'urn:a\\b', 'urn:{{focus}}', 'urn:a|b', `urn:${'a'.repeat(2001)}`]) {
      expect(isEmbeddableFocusIri(focus), focus).toBe(false)
    }
  })

  it('the resolver honours the placeholder in raw text under allow-raw and refuses it without a focus', () => {
    const registry = new NamedQueryRegistry()
    registry.register(focused)
    registry.seal()
    const resolver = createQueryTextResolver({ registry, rawTextPolicy: 'allow-raw' })
    const raw = 'SELECT ?p ?o WHERE { GRAPH ?g { <{{focus}}> ?p ?o } }'
    expect(resolver.resolve({ kind: 'query', graphId: 'sophia-cluster', queryId: raw, focus: FOCUS })).toBe(
      `SELECT ?p ?o WHERE { GRAPH ?g { <${FOCUS}> ?p ?o } }`,
    )
    expect(() => resolver.resolve({ kind: 'query', graphId: 'sophia-cluster', queryId: raw })).toThrowError(
      NamedQueryResolutionError,
    )
    expect(resolver.resolve({ kind: 'query', graphId: 'sophia-cluster', queryId: focused.name, focus: FOCUS })).toContain(FOCUS)
    // Raw text WITHOUT the placeholder is untouched by a supplied focus.
    expect(resolver.resolve({ kind: 'query', graphId: 'sophia-cluster', queryId: 'SELECT 1', focus: FOCUS })).toBe('SELECT 1')
  })
})
