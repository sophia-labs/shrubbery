/**
 * The record field model every object card draws (MO object-face integration spec WS1 §6.4/§6.9), shared by
 * `card.object` (the source register's JSON records) and the typed-object face (`typedObjectModel`, an RDF resource
 * typed by an Emporium class). It moved here from `@shrubbery/runtime`'s `card-object-face.ts` on 2026-10-20 so the
 * two cards converge on one field model instead of forking it; runtime re-exports both names from their old places.
 *
 * Pure: no DOM, no network, no Lit.
 */

import type { DisplayKind } from '../kinds/index.js'

/** One already-resolved, already-formatted record field (WS1 §6.4). */
export interface ObjectCardField {
  /** short display label (§6.9) */
  readonly label: string
  /** the untruncated key / predicate IRI (title=) */
  readonly fullLabel: string
  /** already-formatted display text */
  readonly value: string
  /** the seven shipped kinds only */
  readonly kind: DisplayKind
  /** metric only */
  readonly unit?: string
  /** reference only */
  readonly href?: string
  /** JSON null / no value — renders an em dash */
  readonly absent?: boolean
  /** object/array rendered as compact JSON prose */
  readonly nested?: boolean
}

/** The ONLY schemes `inferFieldKind` ever classifies as `reference`. Closed. */
export const SAFE_REFERENCE_SCHEMES = ['http', 'https', 'mailto', 'urn'] as const
const SAFE_REFERENCE_SCHEME = /^(http|https|mailto|urn):/i

/** A value a card may draw as a link: one of the closed safe schemes, never `javascript:` or a bare word. */
export function isSafeReferenceValue(value: string): boolean {
  return SAFE_REFERENCE_SCHEME.test(value) && value.includes(':')
}

/** Pure. The CLOSED inference rule set — code, never data (§6.9). */
export function inferFieldKind(value: unknown): DisplayKind {
  if (value === null || value === undefined) return 'state'
  if (typeof value === 'number' && Number.isFinite(value)) return 'metric'
  if (typeof value === 'boolean') return 'state'
  if (typeof value === 'string') {
    if (isSafeReferenceValue(value)) return 'reference'
    if (value.includes('\n') || value.length > 120) return 'prose'
    return 'state'
  }
  // array / object
  return 'prose'
}
