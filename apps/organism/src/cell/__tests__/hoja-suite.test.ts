import { describe, expect, it } from 'vitest'

import { choreographRouteAppLinks, choreographSuiteHref, hojaSuiteHref, suiteAppLinks } from '../hoja-suite.js'

const VERA = 'e9e949fe-0091-7015-0ab8-10bf259084ab'

describe('hojaSuiteHref — the Garden picker entry for Hoja is open to every hosted user', () => {
  it('hosted operator gets /hoja/ (and the dev server URL under vite dev)', () => {
    expect(hojaSuiteHref({ deploymentMode: 'hosted', userId: VERA, env: {}, dev: false })).toBe('/hoja/')
    expect(hojaSuiteHref({ deploymentMode: 'hosted', userId: VERA, env: {}, dev: true })).toBe('http://127.0.0.1:5190/')
  })

  it('every other hosted user gets it too (hoja-v2 = everyone)', () => {
    expect(hojaSuiteHref({ deploymentMode: 'hosted', userId: 'another-sub', env: {}, dev: false })).toBe('/hoja/')
    expect(hojaSuiteHref({ deploymentMode: 'hosted', userId: '', env: {}, dev: false })).toBe('/hoja/')
  })

  it('playground/desktop: off by default, on with VITE_SHRUBBERY_FEATURES=hoja-v2', () => {
    expect(hojaSuiteHref({ deploymentMode: 'playground', userId: null, env: {}, dev: false })).toBe('')
    expect(hojaSuiteHref({ deploymentMode: 'playground', userId: null, env: { VITE_SHRUBBERY_FEATURES: 'hoja-v2' }, dev: false })).toBe('/hoja/')
  })
})

describe('suiteAppLinks — one gated catalogue, pointed at the current workspace', () => {
  const base = { deploymentMode: 'hosted' as const, env: {}, dev: false }

  it('operator on a Garden-only workspace: Choreograph (route) + Hoja, both carrying ?graph=', () => {
    expect(suiteAppLinks({ ...base, userId: VERA, graphId: 'angels', shellApps: ['garden'] }).map(l => [l.id, l.href])).toEqual([
      ['choreograph', '/choreograph?graph=angels'],
      ['hoja', '/hoja/?graph=angels'],
    ])
  })

  it('a workspace config that declares Choreograph keeps its in-graph tab (no duplicate link)', () => {
    expect(suiteAppLinks({ ...base, userId: VERA, graphId: 'angels', shellApps: ['garden', 'choreograph'] }).map(l => l.id)).toEqual(['hoja'])
  })

  it('non-operators get Hoja but not Choreograph', () => {
    expect(suiteAppLinks({ ...base, userId: 'another-sub', graphId: 'g', shellApps: ['garden'] }).map(l => [l.id, l.href])).toEqual([['hoja', '/hoja/?graph=g']])
    expect(choreographSuiteHref({ ...base, userId: 'another-sub' })).toBe('')
  })

  it('local builds: off unless the build opts in per feature', () => {
    const local = { deploymentMode: 'playground' as const, userId: null, dev: false, graphId: 'g' }
    expect(suiteAppLinks({ ...local, env: {} })).toEqual([])
    expect(suiteAppLinks({ ...local, env: { VITE_SHRUBBERY_FEATURES: 'choreograph' } }).map(l => l.id)).toEqual(['choreograph'])
  })

  it('the Choreograph route leads back to Garden in the same workspace, then Hoja', () => {
    expect(choreographRouteAppLinks({ ...base, userId: VERA, graphId: 'angels' }).map(l => [l.id, l.href])).toEqual([
      ['garden', '/?graph=angels'],
      ['hoja', '/hoja/?graph=angels'],
    ])
    expect(choreographRouteAppLinks({ ...base, userId: 'another-sub', graphId: '' }).map(l => [l.id, l.href])).toEqual([['garden', '/'], ['hoja', '/hoja/']])
  })
})
