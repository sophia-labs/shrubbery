/**
 * Shared wire predicate taxonomy.
 *
 * Lifted from Garden's frontend/lib/wire-predicates.ts as pure vocabulary so
 * read labels, picker UI, and future panel surfaces use one source of truth.
 */

export interface PredicateDef {
  readonly uri: string
  readonly label: string
  readonly description?: string
}

export interface PredicateCategoryDef {
  readonly predicates: readonly PredicateDef[]
  /** Lucide icon name in Garden; Shrubbery callers may ignore it. */
  readonly icon: string
  readonly description?: string
}

export const MNEMO_NS = 'http://mnemosyne.ai/vocab#'
export const DEFAULT_WIRE_PREDICATE_NAME = 'relatedTo'
export const DEFAULT_WIRE_PREDICATE_URI = `${MNEMO_NS}${DEFAULT_WIRE_PREDICATE_NAME}`

export const PREDICATE_GROUPS: Readonly<Record<string, PredicateCategoryDef>> = {
  Ground: {
    icon: 'circle',
    description: 'What makes B real or possible?',
    predicates: [
      {
        uri: `${MNEMO_NS}grounds`,
        label: 'grounds',
        description: 'A provides the material or experiential foundation that keeps B from being empty abstraction',
      },
      { uri: `${MNEMO_NS}requires`, label: 'requires', description: 'B cannot exist or function without A' },
      { uri: `${MNEMO_NS}enables`, label: 'enables', description: 'A creates the conditions for B to be possible' },
      { uri: `${MNEMO_NS}exemplifies`, label: 'exemplifies', description: 'A is a concrete instance that makes B real' },
    ],
  },
  Critique: {
    icon: 'scale',
    description: 'What does A say about B?',
    predicates: [
      { uri: `${MNEMO_NS}supports`, label: 'supports', description: 'A provides evidence or argument for B' },
      { uri: `${MNEMO_NS}contradicts`, label: 'contradicts', description: 'A opposes or undermines B' },
      { uri: `${MNEMO_NS}qualifies`, label: 'qualifies', description: 'A modifies, limits, or adds nuance to B' },
    ],
  },
  Genesis: {
    icon: 'zap',
    description: 'How does A give rise to B?',
    predicates: [
      { uri: `${MNEMO_NS}flowsInto`, label: 'flows into', description: 'A continues into or transforms into B' },
      { uri: `${MNEMO_NS}produces`, label: 'produces', description: 'A brought B into existence' },
      { uri: `${MNEMO_NS}intensifiesWith`, label: 'intensifies with', description: 'A and B amplify each other through contact' },
    ],
  },
  Structure: {
    icon: 'layers',
    description: 'How are A and B ordered or arranged?',
    predicates: [
      { uri: `${MNEMO_NS}contains`, label: 'contains', description: 'A spatially or structurally includes B' },
      { uri: `${MNEMO_NS}precedes`, label: 'precedes', description: 'A comes before B in time or sequence' },
      { uri: `${MNEMO_NS}consequenceOf`, label: 'consequence of', description: 'B is an effect or result of A' },
    ],
  },
}

export const LEGACY_PREDICATE_LABELS: Readonly<Record<string, string>> = {
  [`${MNEMO_NS}isWiredTo`]: 'is wired to',
  [`${MNEMO_NS}partOf`]: 'is part of',
  [`${MNEMO_NS}causeOf`]: 'causes',
  [`${MNEMO_NS}divergesFrom`]: 'diverges from',
  [`${MNEMO_NS}branchesTo`]: 'branches to',
  [`${MNEMO_NS}consumesWith`]: 'consumes with',
  [`${MNEMO_NS}synthesizes`]: 'synthesizes',
}

export function getAllWirePredicates(): readonly PredicateDef[] {
  return [
    { uri: DEFAULT_WIRE_PREDICATE_URI, label: 'is related to', description: 'General association' },
    ...Object.values(PREDICATE_GROUPS).flatMap((category) => category.predicates),
  ]
}

export function normalizeWirePredicateUri(predicate: string): string {
  return predicate.startsWith('http://') || predicate.startsWith('https://') || predicate.startsWith('urn:')
    ? predicate
    : `${MNEMO_NS}${predicate}`
}

export function getWirePredicateLabel(predicate: string): string {
  const uri = normalizeWirePredicateUri(predicate)
  if (uri === DEFAULT_WIRE_PREDICATE_URI) return 'is related to'

  const known = getAllWirePredicates().find((p) => p.uri === uri)
  if (known) return known.label

  const legacy = LEGACY_PREDICATE_LABELS[uri]
  if (legacy) return legacy

  const local = uri.startsWith(MNEMO_NS) ? uri.slice(MNEMO_NS.length) : uri.split(/[\/#]/).pop() ?? uri
  return local
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
}

export function getWirePredicateCategory(predicate: string): string | null {
  const uri = normalizeWirePredicateUri(predicate)
  if (uri === DEFAULT_WIRE_PREDICATE_URI) return null
  for (const [categoryName, category] of Object.entries(PREDICATE_GROUPS)) {
    if (category.predicates.some((p) => p.uri === uri)) return categoryName
  }
  return null
}

export function findWirePredicate(predicate: string): PredicateDef | null {
  const uri = normalizeWirePredicateUri(predicate)
  return getAllWirePredicates().find((p) => p.uri === uri) ?? null
}
