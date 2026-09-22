/**
 * store-scope.test.ts — proves StoreScope/BranchContext resolve root regions
 * BYTE-FOR-BYTE the same as the real interpreter, over the REAL GARDEN_DEFAULT.
 *
 * No mocks: a real in-memory ShrubberyStore<WorkspaceConfig> holds the real
 * frozen config; rootRegionsForScope rides the real resolveRootRegions seam.
 */
import { describe, it, expect } from 'vitest'
import {
  GARDEN_DEFAULT,
  resolveRootRegions,
  rootRegionsForScope,
  type BranchContext,
  type StoreScope,
  type ShrubberyStore,
  type StoreState,
  type WorkspaceConfig,
} from '../index.js'

/** A REAL minimal ShrubberyStore<WorkspaceConfig> in a fixed state (no mock). */
function fixedStore(state: StoreState<WorkspaceConfig>): ShrubberyStore<WorkspaceConfig> {
  return {
    get: () => state,
    subscribe: () => () => {},
    refresh: async () => {},
  }
}

function readyScope(config: WorkspaceConfig, branch: BranchContext): StoreScope {
  return { config: fixedStore({ status: 'ready', read: config, error: null }), branch }
}

describe('rootRegionsForScope — matches resolveRootRegions on the real config', () => {
  it('default branch ({}) === resolveRootRegions(GARDEN_DEFAULT)', () => {
    const scope = readyScope(GARDEN_DEFAULT, {})
    expect(rootRegionsForScope(scope)).toEqual(resolveRootRegions(GARDEN_DEFAULT))
    // The real default garden spine.
    expect(rootRegionsForScope(scope)).toEqual(['region-top-bar', 'region-left-rail', 'region-bottom-bar'])
  })

  it("branch {app:'choreograph'} === resolveRootRegions(GARDEN_DEFAULT,'choreograph')", () => {
    const scope = readyScope(GARDEN_DEFAULT, { app: 'choreograph' })
    expect(rootRegionsForScope(scope)).toEqual(resolveRootRegions(GARDEN_DEFAULT, 'choreograph'))
    // The real choreograph set (verified present in garden-default).
    expect(rootRegionsForScope(scope)).toEqual(['region-top-bar', 'region-choreo-center', 'region-bottom-bar'])
  })

  it("an unknown app falls back to the default spine (interpreter parity)", () => {
    const scope = readyScope(GARDEN_DEFAULT, { app: 'garden' })
    expect(rootRegionsForScope(scope)).toEqual(resolveRootRegions(GARDEN_DEFAULT, 'garden'))
    expect(rootRegionsForScope(scope)).toEqual(resolveRootRegions(GARDEN_DEFAULT))
  })

  it('non-ready store ⇒ null (no fake config)', () => {
    const idle: StoreScope = {
      config: fixedStore({ status: 'idle', read: null, error: null }),
      branch: {},
    }
    expect(rootRegionsForScope(idle)).toBeNull()

    const loading: StoreScope = {
      config: fixedStore({ status: 'loading', read: null, error: null }),
      branch: { app: 'choreograph' },
    }
    expect(rootRegionsForScope(loading)).toBeNull()

    const errored: StoreScope = {
      config: fixedStore({ status: 'error', read: null, error: 'cell unreachable' }),
      branch: {},
    }
    expect(rootRegionsForScope(errored)).toBeNull()
  })

  it('ready status but null read ⇒ null (defensive: never resolves a fake config)', () => {
    const readyNull: StoreScope = {
      config: fixedStore({ status: 'ready', read: null, error: null }),
      branch: {},
    }
    expect(rootRegionsForScope(readyNull)).toBeNull()
  })
})
