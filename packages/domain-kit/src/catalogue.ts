import { contentDigest, requireText } from './canonical.js'
import type { DomainNamedQueryDefinition, DomainQueryCatalogue } from './types.js'

export const NAMED_QUERY_REF_PATTERN = /^urn:sophia:query:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/
export const GRAPH_ID_PLACEHOLDER = '{{graphId}}'
export const EMBEDDABLE_GRAPH_ID_PATTERN = /^[a-z0-9-]{1,40}$/

export function buildDomainQueryCatalogue(
  domain: string,
  definitions: readonly DomainNamedQueryDefinition[],
): DomainQueryCatalogue {
  const normalizedDomain = domainSlug(domain)
  if (definitions.length === 0) throw new Error('domain query catalogue must contain at least one named query')
  const seen = new Set<string>()
  const queries = definitions.map((definition) => {
    validateDefinition(normalizedDomain, definition)
    if (seen.has(definition.name)) throw new Error(`duplicate named query '${definition.name}'`)
    seen.add(definition.name)
    return Object.freeze({ ...definition })
  })
  const openGroundingGaps = [...new Set(queries.flatMap((query) => query.opensGroundingGap ?? []))].sort()
  const seed = { schema: 'sophia.domain-query-catalogue.v1' as const, domain: normalizedDomain, openGroundingGaps, queries }
  return Object.freeze({ ...seed, digest: contentDigest(seed) })
}

export function resolveDomainNamedQuery(
  catalogue: DomainQueryCatalogue,
  name: string,
  graphId: string,
): string {
  if (!EMBEDDABLE_GRAPH_ID_PATTERN.test(graphId)) throw new Error(`graph id '${graphId}' cannot be embedded safely`)
  if (!NAMED_QUERY_REF_PATTERN.test(name)) throw new Error('raw SPARQL text is not accepted as a query name')
  const definition = catalogue.queries.find((candidate) => candidate.name === name)
  if (!definition) throw new Error(`named query '${name}' is not present in the sealed ${catalogue.domain} catalogue`)
  return definition.text.replaceAll(GRAPH_ID_PLACEHOLDER, graphId)
}

export function domainCatalogueHeader(catalogue: DomainQueryCatalogue): string {
  const lines = [
    `# ${catalogue.domain} named-query catalogue`,
    '',
    `Digest: \`${catalogue.digest}\``,
    '',
    '## Reader questions',
    '',
    ...catalogue.queries.flatMap((query) => [`- \`${query.name}\` — ${query.readerQuestion}`, `  ${query.description}`]),
    '',
    '## Open grounding gaps',
    '',
  ]
  if (catalogue.openGroundingGaps.length === 0) lines.push('- None declared.')
  else lines.push(...catalogue.openGroundingGaps.map((gap) => `- ${gap}`))
  return `${lines.join('\n')}\n`
}

function validateDefinition(domain: string, definition: DomainNamedQueryDefinition): void {
  const name = requireText(definition.name, 'named query name')
  if (!NAMED_QUERY_REF_PATTERN.test(name) || !name.startsWith(`urn:sophia:query:${domain}.`)) {
    throw new Error(`named query '${name}' is outside urn:sophia:query:${domain}.*`)
  }
  requireText(definition.readerQuestion, `${name} readerQuestion`)
  requireText(definition.description, `${name} description`)
  const text = requireText(definition.text, `${name} text`)
  if (/\b(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)\b/i.test(text)) {
    throw new Error(`named query '${name}' is not read-only`)
  }
  const placeholders = /\{\{([^}]*)\}\}/g
  for (const match of text.matchAll(placeholders)) {
    if (match[1] !== 'graphId') throw new Error(`named query '${name}' uses unknown placeholder '${match[1]}'`)
  }
}

function domainSlug(value: string): string {
  const domain = requireText(value, 'domain')
  if (!/^[a-z][a-z0-9-]*$/.test(domain)) throw new Error('domain must match [a-z][a-z0-9-]*')
  return domain
}
