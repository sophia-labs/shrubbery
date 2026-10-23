/**
 * Shared wire predicate taxonomy.
 *
 * Lifted from Garden's frontend/lib/wire-predicates.ts as pure vocabulary so
 * read labels, picker UI, and future panel surfaces use one source of truth.
 */

import { localizeLabel, t } from './i18n/index.js'
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
    get description() { return t('What makes B real or possible?') },
    predicates: [
      {
        uri: `${MNEMO_NS}grounds`,
        get label() { return t('grounds') },
        get description() { return t('A provides the material or experiential foundation that keeps B from being empty abstraction') },
      },
      { uri: `${MNEMO_NS}requires`, get label() { return t('requires') }, get description() { return t('B cannot exist or function without A') } },
      { uri: `${MNEMO_NS}enables`, get label() { return t('enables') }, get description() { return t('A creates the conditions for B to be possible') } },
      { uri: `${MNEMO_NS}exemplifies`, get label() { return t('exemplifies') }, get description() { return t('A is a concrete instance that makes B real') } },
    ],
  },
  Critique: {
    icon: 'scale',
    get description() { return t('What does A say about B?') },
    predicates: [
      { uri: `${MNEMO_NS}supports`, get label() { return t('supports') }, get description() { return t('A provides evidence or argument for B') } },
      { uri: `${MNEMO_NS}contradicts`, get label() { return t('contradicts') }, get description() { return t('A opposes or undermines B') } },
      { uri: `${MNEMO_NS}qualifies`, get label() { return t('qualifies') }, get description() { return t('A modifies, limits, or adds nuance to B') } },
    ],
  },
  Genesis: {
    icon: 'zap',
    get description() { return t('How does A give rise to B?') },
    predicates: [
      { uri: `${MNEMO_NS}flowsInto`, get label() { return t('flows into') }, get description() { return t('A continues into or transforms into B') } },
      { uri: `${MNEMO_NS}produces`, get label() { return t('produces') }, get description() { return t('A brought B into existence') } },
      { uri: `${MNEMO_NS}intensifiesWith`, get label() { return t('intensifies with') }, get description() { return t('A and B amplify each other through contact') } },
    ],
  },
  Structure: {
    icon: 'layers',
    get description() { return t('How are A and B ordered or arranged?') },
    predicates: [
      { uri: `${MNEMO_NS}contains`, get label() { return t('contains') }, get description() { return t('A spatially or structurally includes B') } },
      { uri: `${MNEMO_NS}precedes`, get label() { return t('precedes') }, get description() { return t('A comes before B in time or sequence') } },
      { uri: `${MNEMO_NS}consequenceOf`, get label() { return t('consequence of') }, get description() { return t('B is an effect or result of A') } },
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
    { uri: DEFAULT_WIRE_PREDICATE_URI, get label() { return t('is related to') }, get description() { return t('General association') } },
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
  if (uri === DEFAULT_WIRE_PREDICATE_URI) return t('is related to')

  const known = getAllWirePredicates().find((p) => p.uri === uri)
  if (known) return known.label

  const legacy = LEGACY_PREDICATE_LABELS[uri]
  if (legacy) return localizeLabel(legacy)

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
