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

/**
 * The FOCUS placeholder (el Despacho, plans/2026-09-15-despacho-design.md
 * §4/§7). A focus-driven surface's queries name the subject under the cursor
 * as `{{focus}}`; the SESSION supplies the IRI (`QueryLocator.focus`, stamped
 * by the shell's focus binding at load time) and this module substitutes it —
 * exactly the `{{graphId}}` discipline, with its own embeddability gate.
 */
export const FOCUS_PLACEHOLDER = '{{focus}}'
/**
 * An embeddable focus is an ABSOLUTE IRI (scheme + `:` + non-empty rest) with
 * none of the characters that could close or perturb the `<…>` it is spliced
 * into: no whitespace, quotes, angle brackets, backslashes, braces, pipes,
 * carets or backticks (RFC 3987's excluded set plus the placeholder braces).
 * Bounded so a hostile query string cannot smuggle a megabyte into SPARQL.
 */
export const EMBEDDABLE_FOCUS_IRI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s"'<>\\{}|^`]{1,2000}$/
export function isEmbeddableFocusIri(focus: string): boolean {
  return EMBEDDABLE_FOCUS_IRI_PATTERN.test(focus)
}

/** True when `text` (raw SPARQL or a named definition's body) carries the focus placeholder. */
export function queryTextUsesFocus(text: string): boolean {
  return text.includes(FOCUS_PLACEHOLDER)
}

/**
 * Splice `focus` into every `{{focus}}` in `text` — the ONE substitution site
 * for both resolver paths (named and raw), so the gate cannot be bypassed by
 * either. Throws the same typed `NamedQueryResolutionError` the graph-id gate
 * throws: a focus-bearing query with NO focus is `missing-focus` (an honest
 * "this room has no cursor" error, never a query over the literal
 * placeholder); an unsafe one is `unsafe-focus`.
 */
export function substituteFocus(text: string, focus: string | undefined): string {
  if (!queryTextUsesFocus(text)) return text
  if (focus === undefined) {
    throw new NamedQueryResolutionError('missing-focus', 'this query needs a focus, but the session supplied none')
  }
  if (!isEmbeddableFocusIri(focus)) {
    throw new NamedQueryResolutionError('unsafe-focus', `focus '${focus}' is not an embeddable absolute IRI`)
  }
  return text.replaceAll(FOCUS_PLACEHOLDER, focus)
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

export type NamedQueryResolutionFailure =
  | 'unknown-name'
  | 'raw-text-refused'
  | 'unsafe-graph-id'
  | 'missing-focus'
  | 'unsafe-focus'

export class NamedQueryResolutionError extends Error {
  constructor(readonly reason: NamedQueryResolutionFailure, message: string) {
    super(message)
    this.name = 'NamedQueryResolutionError'
  }
}

/** The closed set of placeholders a named definition may carry. */
const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set(['graphId', 'focus'])

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
      if (!KNOWN_PLACEHOLDERS.has(match[1])) {
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

  /** True when the registered definition carries `{{focus}}` (false for an unknown name — `resolve` is the gate that reports that). */
  usesFocus(name: string): boolean {
    const definition = this.byName.get(name)
    return definition ? queryTextUsesFocus(definition.text) : false
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

  resolve(name: string, graphId: string, focus?: string): string {
    if (!isEmbeddableGraphId(graphId)) {
      throw new NamedQueryResolutionError('unsafe-graph-id', `graph id '${graphId}' cannot be embedded in a named query`)
    }
    const definition = this.byName.get(name)
    if (!definition) {
      throw new NamedQueryResolutionError('unknown-name', `named query '${name}' is not registered`)
    }
    return substituteFocus(definition.text.replaceAll(GRAPH_ID_PLACEHOLDER, graphId), focus)
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
      if (isNamedQueryRef(locator.queryId)) {
        return options.registry.resolve(locator.queryId, locator.graphId, locator.focus)
      }
      if (options.rawTextPolicy === 'allow-raw') {
        options.onRawText?.(locator)
        // Raw text already flows verbatim under this policy; splicing a
        // GATED absolute IRI into it is strictly narrower than what the
        // policy admits, so the focus placeholder is honoured here too.
        return substituteFocus(locator.queryId, locator.focus)
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
