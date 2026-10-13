import { describe, expect, it } from 'vitest'

import {
  FEATURE_AUDIENCE,
  FEATURE_TEST_SUBJECTS,
  isEnabled,
  isOperatorSubject,
  localFeatureOptIns,
  OPERATOR_SUBJECTS,
} from '../src/features.js'

const VERA = 'e9e949fe-0091-7015-0ab8-10bf259084ab'

describe('features — hoja-v2 audience gate', () => {
  it('is released to everyone (2026-09-23); the operator allowlist is unchanged', () => {
    expect(FEATURE_AUDIENCE['hoja-v2']).toBe('everyone')
    expect(OPERATOR_SUBJECTS).toEqual([VERA])
  })

  it('hosted: every session sees it — operator, any other user, and anonymous (Hoja then asks to sign in)', () => {
    expect(isEnabled('hoja-v2', { mode: 'hosted', userId: VERA })).toBe(true)
    expect(isEnabled('hoja-v2', { mode: 'hosted', userId: 'f0000000-0091-7015-0ab8-10bf259084ab' })).toBe(true)
    expect(isEnabled('hoja-v2', { mode: 'hosted', userId: '' })).toBe(true)
    expect(isEnabled('hoja-v2', { mode: 'hosted', userId: null })).toBe(true)
  })

  it('the Hoja QA account entry is retired (the mechanism stays)', () => {
    expect(FEATURE_TEST_SUBJECTS['hoja-v2']).toEqual([])
    expect(isOperatorSubject('4999d9ce-3091-70d0-9c80-7bed4a0fc77d')).toBe(false)
  })

  it('local (no Cognito): still off unless the build opts in — a local build may not ship /hoja/', () => {
    expect(isEnabled('hoja-v2', { mode: 'local' })).toBe(false)
    expect(isEnabled('hoja-v2', { mode: 'local', userId: VERA })).toBe(false)
    expect(isEnabled('hoja-v2', { mode: 'local', localOptIns: localFeatureOptIns({ VITE_SHRUBBERY_FEATURES: ' other , hoja-v2' }) })).toBe(true)
  })
})

describe('features — choreograph stays operator-only', () => {
  it('hosted: operator only; a build opt-in cannot widen it; a gateway audience claim wins', () => {
    expect(FEATURE_AUDIENCE['choreograph']).toBe('operator')
    expect(isEnabled('choreograph', { mode: 'hosted', userId: VERA })).toBe(true)
    expect(isEnabled('choreograph', { mode: 'hosted', userId: 'someone-else' })).toBe(false)
    expect(isEnabled('choreograph', { mode: 'hosted', userId: 'someone-else', localOptIns: ['choreograph'] })).toBe(false)
    expect(isEnabled('choreograph', { mode: 'hosted', userId: 'someone-else', audience: 'operator' })).toBe(true)
    expect(isEnabled('choreograph', { mode: 'hosted', userId: VERA, audience: 'everyone' })).toBe(false)
  })
})

describe('features — helpers', () => {
  it('parses VITE_SHRUBBERY_FEATURES defensively', () => {
    expect(localFeatureOptIns(undefined)).toEqual([])
    expect(localFeatureOptIns({ VITE_SHRUBBERY_FEATURES: 1 })).toEqual([])
    expect(localFeatureOptIns({ VITE_SHRUBBERY_FEATURES: 'a,,b ' })).toEqual(['a', 'b'])
    expect(isOperatorSubject(undefined)).toBe(false)
  })
})
