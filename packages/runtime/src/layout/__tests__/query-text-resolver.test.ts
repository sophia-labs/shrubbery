import { describe, expect, it } from 'vitest'
import {
  NamedQueryRegistry,
  NamedQueryResolutionError,
  createQueryTextResolver,
} from '../named-query-registry.js'

const locator = { kind: 'query' as const, graphId: 'observatory', queryId: 'SELECT * WHERE {}' }

function emptyRegistry(): NamedQueryRegistry {
  const registry = new NamedQueryRegistry()
  registry.seal()
  return registry
}

describe('QueryTextResolver', () => {
  it('distinguishes refused raw text from an unknown named query', () => {
    const resolver = createQueryTextResolver({ registry: emptyRegistry(), rawTextPolicy: 'named-only' })
    expect(() => resolver.resolve(locator)).toThrowError(NamedQueryResolutionError)
    try { resolver.resolve(locator) } catch (error) { expect(error).toMatchObject({ reason: 'raw-text-refused' }) }
    expect(() => resolver.resolve({ ...locator, queryId: 'urn:sophia:query:missing' })).toThrowError(NamedQueryResolutionError)
    try { resolver.resolve({ ...locator, queryId: 'urn:sophia:query:missing' }) } catch (error) { expect(error).toMatchObject({ reason: 'unknown-name' }) }
  })

  it('allows raw text and reports every raw resolution exactly once', () => {
    let count = 0
    const resolver = createQueryTextResolver({
      registry: emptyRegistry(),
      rawTextPolicy: 'allow-raw',
      onRawText: () => { count += 1 },
    })
    expect(resolver.resolve(locator)).toBe(locator.queryId)
    expect(resolver.resolve(locator)).toBe(locator.queryId)
    expect(resolver.resolve({ ...locator, queryId: 'SELECT * WHERE { ?s ?p ?o }' })).toContain('?s')
    expect(count).toBe(3)
  })

  it('routes named references through the registry without raw warnings', () => {
    const registry = emptyRegistry()
    // Bootstrap registries are sealed only after their definitions are loaded.
    const bootstrap = new NamedQueryRegistry()
    bootstrap.register({ name: 'urn:sophia:query:obs.example', text: 'ASK {{graphId}}', description: 'test' })
    bootstrap.seal()
    let count = 0
    const resolver = createQueryTextResolver({ registry: bootstrap, rawTextPolicy: 'allow-raw', onRawText: () => { count += 1 } })
    expect(resolver.resolve({ kind: 'query', graphId: 'obs-2', queryId: 'urn:sophia:query:obs.example' })).toBe('ASK obs-2')
    expect(count).toBe(0)
    expect(registry.isSealed).toBe(true)
  })
})
