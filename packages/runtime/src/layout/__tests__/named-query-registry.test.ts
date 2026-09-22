import { describe, expect, it } from 'vitest'
import {
  DuplicateNamedQueryError,
  InvalidNamedQueryDefinitionError,
  NamedQueryRegistry,
  NamedQueryRegistrySealedError,
  NamedQueryResolutionError,
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
