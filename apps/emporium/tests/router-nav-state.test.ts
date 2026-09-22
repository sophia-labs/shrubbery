/**
 * router-nav-state.test.ts — pins the Emporium nav-state invariant WITHOUT infra.
 *
 * The hash-router (router.ts) is the shell's only nav state, and its grammar
 * MIRRORS the live curl URL grammar (/emporium, /emporium/{pack},
 * /emporium/{pack}/{class}). This test pins that mapping in BOTH directions
 * (parse ↔ serialize roundtrip) and drives the LIVE router against a REAL
 * happy-dom window — navigate stamps location.hash, a real hashchange notifies
 * subscribers, and unsubscribe stops them. No gardend, no mocks: pure UI state.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { parseRoute, routeToHash, createRouter, type Route } from '../src/router.js'

describe('parseRoute — the curl URL grammar → a discriminated Route', () => {
  it('an empty / rootless hash resolves to the catalogue (tolerant root)', () => {
    expect(parseRoute('')).toEqual({ kind: 'catalogue' })
    expect(parseRoute('#')).toEqual({ kind: 'catalogue' })
    expect(parseRoute('#/emporium')).toEqual({ kind: 'catalogue' })
    // A hash that is not under /emporium is not our IA ⇒ catalogue, never a fake route.
    expect(parseRoute('#/somewhere/else')).toEqual({ kind: 'catalogue' })
  })

  it('one segment under emporium ⇒ a pack route', () => {
    expect(parseRoute('#/emporium/workflow')).toEqual({ kind: 'pack', pack: 'workflow' })
  })

  it('two segments under emporium ⇒ a class deep-link route', () => {
    expect(parseRoute('#/emporium/workflow/AgentNode')).toEqual({
      kind: 'class',
      pack: 'workflow',
      cls: 'AgentNode',
    })
  })

  it('decodes percent-encoded segments (a pack name with a hyphen survives verbatim)', () => {
    expect(parseRoute('#/emporium/sophia-memory-core')).toEqual({
      kind: 'pack',
      pack: 'sophia-memory-core',
    })
    expect(parseRoute('#/emporium/some%20pack/Some%2FClass')).toEqual({
      kind: 'class',
      pack: 'some pack',
      cls: 'Some/Class',
    })
  })
})

describe('routeToHash ↔ parseRoute — a lossless roundtrip (crumb/rail click ⇒ curl-able resource)', () => {
  const routes: Route[] = [
    { kind: 'catalogue' },
    { kind: 'pack', pack: 'workflow' },
    { kind: 'pack', pack: 'sophia-memory-core' },
    { kind: 'class', pack: 'workflow', cls: 'AgentNode' },
  ]
  it('every route serializes to a hash that parses back to the same route', () => {
    for (const r of routes) {
      expect(parseRoute(routeToHash(r))).toEqual(r)
    }
  })
  it('serializes to the exact curl path grammar the cell serves', () => {
    expect(routeToHash({ kind: 'catalogue' })).toBe('#/emporium')
    expect(routeToHash({ kind: 'pack', pack: 'workflow' })).toBe('#/emporium/workflow')
    expect(routeToHash({ kind: 'class', pack: 'workflow', cls: 'AgentNode' })).toBe(
      '#/emporium/workflow/AgentNode',
    )
  })
})

describe('createRouter — a LIVE router bound to a REAL window', () => {
  beforeEach(() => {
    window.location.hash = ''
  })

  it('current() reflects the window hash at any moment', () => {
    window.location.hash = '#/emporium/workflow/AgentNode'
    const router = createRouter(window)
    expect(router.current()).toEqual({ kind: 'class', pack: 'workflow', cls: 'AgentNode' })
  })

  it('subscribe fires immediately with the current route', () => {
    window.location.hash = '#/emporium/workflow'
    const router = createRouter(window)
    const seen: Route[] = []
    const off = router.subscribe((r) => seen.push(r))
    expect(seen).toEqual([{ kind: 'pack', pack: 'workflow' }])
    off()
  })

  it('navigate stamps location.hash with the serialized route', () => {
    const router = createRouter(window)
    router.navigate({ kind: 'class', pack: 'workflow', cls: 'AgentNode' })
    expect(window.location.hash).toBe('#/emporium/workflow/AgentNode')
    expect(router.current()).toEqual({ kind: 'class', pack: 'workflow', cls: 'AgentNode' })
  })

  it('a real hashchange event re-parses the hash and notifies subscribers', () => {
    const router = createRouter(window)
    const seen: Route[] = []
    const off = router.subscribe((r) => seen.push(r)) // fires once immediately (catalogue)
    window.location.hash = '#/emporium/sophia-memory-core'
    window.dispatchEvent(new Event('hashchange'))
    expect(seen[seen.length - 1]).toEqual({ kind: 'pack', pack: 'sophia-memory-core' })
    off()
  })

  it('navigating to the CURRENT route still notifies (same-hash direct emit)', () => {
    window.location.hash = '#/emporium/workflow'
    const router = createRouter(window)
    const seen: Route[] = []
    const off = router.subscribe((r) => seen.push(r)) // immediate fire (pack:workflow)
    router.navigate({ kind: 'pack', pack: 'workflow' }) // same hash ⇒ direct emit
    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual({ kind: 'pack', pack: 'workflow' })
    off()
  })

  it('unsubscribe stops further notifications', () => {
    const router = createRouter(window)
    const seen: Route[] = []
    const off = router.subscribe((r) => seen.push(r))
    off()
    window.location.hash = '#/emporium/workflow'
    window.dispatchEvent(new Event('hashchange'))
    expect(seen).toHaveLength(1) // only the immediate fire; nothing after unsubscribe.
  })
})
