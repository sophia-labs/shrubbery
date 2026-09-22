import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIRE_PREDICATE_NAME,
  DEFAULT_WIRE_PREDICATE_URI,
  MNEMO_NS,
  PREDICATE_GROUPS,
  getAllWirePredicates,
  getWirePredicateCategory,
  getWirePredicateLabel,
  normalizeWirePredicateUri,
} from '../wire-predicates.js'

describe('wire predicate taxonomy', () => {
  it('keeps the Garden predicate groups and default relation label in one pure module', () => {
    expect(Object.keys(PREDICATE_GROUPS)).toEqual(['Ground', 'Critique', 'Genesis', 'Structure'])
    expect(getAllWirePredicates().map((p) => p.uri)).toContain(`${MNEMO_NS}supports`)
    expect(getWirePredicateLabel(DEFAULT_WIRE_PREDICATE_URI)).toBe('is related to')
    expect(getWirePredicateLabel(DEFAULT_WIRE_PREDICATE_NAME)).toBe('is related to')
  })

  it('normalizes bare names, known URIs, legacy URIs, and unknown camel-case predicates', () => {
    expect(normalizeWirePredicateUri('supports')).toBe(`${MNEMO_NS}supports`)
    expect(getWirePredicateCategory(`${MNEMO_NS}supports`)).toBe('Critique')
    expect(getWirePredicateLabel(`${MNEMO_NS}partOf`)).toBe('is part of')
    expect(getWirePredicateLabel(`${MNEMO_NS}newPredicateKind`)).toBe('new predicate kind')
  })
})
