import type { ResourceLocator } from '@shrubbery/nucleus/layout'

export type QueryLocator = Extract<ResourceLocator, { kind: 'query' }>

export const NAMED_QUERY_URN_PREFIX = 'urn:sophia:query:'
export const NAMED_QUERY_REF_PATTERN = /^urn:sophia:query:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/
export function isNamedQueryRef(queryId: string): boolean {
  return NAMED_QUERY_REF_PATTERN.test(queryId)
}

export const GRAPH_ID_PLACEHOLDER = '{{graphId}}'
export const EMBEDDABLE_GRAPH_ID_PATTERN = /^[a-z0-9-]{1,40}$/
export function isEmbeddableGraphId(graphId: string): boolean {
  return EMBEDDABLE_GRAPH_ID_PATTERN.test(graphId)
}

export interface NamedQueryDefinition {
  readonly name: string
  readonly text: string
  readonly description: string
}

export class DuplicateNamedQueryError extends Error {
  constructor(readonly name: string) {
    super(`named query '${name}' is already registered`)
    this.name = 'DuplicateNamedQueryError'
  }
}

export class NamedQueryRegistrySealedError extends Error {
  constructor(readonly name: string) {
    super(`named-query registry is sealed — cannot register '${name}' after boot`)
    this.name = 'NamedQueryRegistrySealedError'
  }
}

export type InvalidNamedQueryReason = 'bad-name' | 'empty-text' | 'unknown-placeholder' | 'empty-description'

export class InvalidNamedQueryDefinitionError extends Error {
  constructor(readonly name: string, readonly reason: InvalidNamedQueryReason) {
    super(`invalid named query '${name}': ${reason}`)
    this.name = 'InvalidNamedQueryDefinitionError'
  }
}

export type NamedQueryResolutionFailure = 'unknown-name' | 'raw-text-refused' | 'unsafe-graph-id'

export class NamedQueryResolutionError extends Error {
  constructor(readonly reason: NamedQueryResolutionFailure, message: string) {
    super(message)
    this.name = 'NamedQueryResolutionError'
  }
}

export class NamedQueryRegistry {
  private readonly byName = new Map<string, NamedQueryDefinition>()
  private sealed = false

  register(definition: NamedQueryDefinition): void {
    if (this.sealed) throw new NamedQueryRegistrySealedError(definition.name)
    if (this.byName.has(definition.name)) throw new DuplicateNamedQueryError(definition.name)
    if (!isNamedQueryRef(definition.name)) {
      throw new InvalidNamedQueryDefinitionError(definition.name, 'bad-name')
    }
    if (definition.text.trim().length === 0) {
      throw new InvalidNamedQueryDefinitionError(definition.name, 'empty-text')
    }
    if (definition.description.trim().length === 0) {
      throw new InvalidNamedQueryDefinitionError(definition.name, 'empty-description')
    }
    const placeholders = /\{\{([^}]*)\}\}/g
    let match: RegExpExecArray | null
    while ((match = placeholders.exec(definition.text)) !== null) {
      if (match[1] !== 'graphId') {
        throw new InvalidNamedQueryDefinitionError(definition.name, 'unknown-placeholder')
      }
    }
    this.byName.set(definition.name, Object.freeze({ ...definition }))
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  get(name: string): NamedQueryDefinition | undefined {
    return this.byName.get(name)
  }

  names(): readonly string[] {
    return [...this.byName.keys()].sort()
  }

  seal(): void {
    this.sealed = true
  }

  get isSealed(): boolean {
    return this.sealed
  }

  resolve(name: string, graphId: string): string {
    if (!isEmbeddableGraphId(graphId)) {
      throw new NamedQueryResolutionError('unsafe-graph-id', `graph id '${graphId}' cannot be embedded in a named query`)
    }
    const definition = this.byName.get(name)
    if (!definition) {
      throw new NamedQueryResolutionError('unknown-name', `named query '${name}' is not registered`)
    }
    return definition.text.replaceAll(GRAPH_ID_PLACEHOLDER, graphId)
  }
}

export type RawQueryTextPolicy = 'named-only' | 'allow-raw'

export interface QueryTextResolverOptions {
  readonly registry: NamedQueryRegistry
  readonly rawTextPolicy: RawQueryTextPolicy
  readonly onRawText?: (locator: QueryLocator) => void
}

export interface QueryTextResolver {
  resolve(locator: QueryLocator): string
}

export function createQueryTextResolver(options: QueryTextResolverOptions): QueryTextResolver {
  return {
    resolve(locator) {
      if (isNamedQueryRef(locator.queryId)) return options.registry.resolve(locator.queryId, locator.graphId)
      if (options.rawTextPolicy === 'allow-raw') {
        options.onRawText?.(locator)
        return locator.queryId
      }
      throw new NamedQueryResolutionError('raw-text-refused', 'raw SPARQL text is not allowed by this query resolver')
    },
  }
}

export function createRawTextQueryResolver(): QueryTextResolver {
  const registry = new NamedQueryRegistry()
  registry.seal()
  return createQueryTextResolver({ registry, rawTextPolicy: 'allow-raw' })
}
