/**
 * session-store-validation.test.ts — the live READ boundary applies the SAME
 * invariants as the write/commit gate (grow.ts → validateConfig). NO MOCKS: we
 * drive the real production read path end-to-end over real N-Triples bodies —
 * serializeConfigToTriples → triplesToNT → (dumpUxConfig) → parseNT →
 * parseTriplesToConfig → validateConfig — through loadConfigFromCell and the
 * reactive store.
 *
 * A VALID config still loads and reports 'ready'. An INVALID config (here a
 * cyclic childRegion spine — the planFor stack-overflow the write gate's I2
 * rejects) is surfaced VERBATIM through the honest read-status channel
 * (status='error', error='config rejected: I2 …'), never returned as a
 * renderable config and never a silent fallback.
 */
import { describe, expect, it } from 'vitest'
import {
  GARDEN_DEFAULT,
  serializeConfigToTriples,
  triplesToNT,
  validateConfig,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import {
  MemoryCellConfigReadStorage,
  createSessionStore,
  loadConfigFromCell,
  type CellContract,
  type CellConfigReadStorage,
} from '../session-store.js'

/** Minimal cell contract whose only exercised surface is dumpUxConfig → { data: nt }. */
function fakeContract(nt: string): CellContract {
  return {
    restConcrete: {
      dumpUxConfig: async () => ({ data: nt }),
    },
  } as unknown as CellContract
}

/** N-Triples body for a config, via the REAL serializer the write path uses. */
const ntFor = (config: WorkspaceConfig): string => triplesToNT(serializeConfigToTriples(config))

/**
 * A config with a cyclic childRegion spine (region-a ⇄ region-b). Both edge
 * targets exist (so I3 passes) — the cycle is what validateConfig I2 catches,
 * the same walk that stops planFor from stack-overflowing on read.
 */
const CYCLIC_CONFIG: WorkspaceConfig = {
  id: 'CyclicUnderTest',
  label: 'Cyclic Under Test',
  renderedByComponent: 'app-shell',
  regions: {
    'region-a': {
      id: 'region-a',
      label: 'A',
      childRegion: 'region-b',
      order: 0,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: true,
      sizeFraction: 0.5,
      dockState: null,
      docksPanel: [],
      renderedByComponent: 'mn-top-bar',
    },
    'region-b': {
      id: 'region-b',
      label: 'B',
      childRegion: 'region-a',
      order: 1,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: false,
      sizeFraction: 0.5,
      dockState: null,
      docksPanel: [],
      renderedByComponent: 'mn-bottom-bar',
    },
  },
  panels: {},
  dimensions: {},
  rootRegions: [],
}

describe('loadConfigFromCell — validation parity with the write gate', () => {
  it('a VALID config (GARDEN_DEFAULT) loads through the real read path and reports ready', async () => {
    const store = createSessionStore({ contract: fakeContract(ntFor(GARDEN_DEFAULT)), graphId: 'valid' })
    await store.refresh()

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    // Byte-for-byte the valid path is unchanged: the parsed config round-trips.
    expect(state.read?.config.id).toBe(GARDEN_DEFAULT.id)
    expect(Object.keys(state.read?.config.regions ?? {}).length).toBe(
      Object.keys(GARDEN_DEFAULT.regions).length,
    )
    // A REAL parsed config is never flagged as the fallback.
    expect(state.read?.defaulted).toBe(false)
  })

  it('an INVALID (cyclic) config surfaces the I2 verdict verbatim through the error channel, not a renderable config', async () => {
    // Precondition: the write gate rejects this exact config with I2.
    const verdict = validateConfig(CYCLIC_CONFIG)
    expect(verdict.ok).toBe(false)

    const store = createSessionStore({ contract: fakeContract(ntFor(CYCLIC_CONFIG)), graphId: 'cyclic' })
    await store.refresh()

    const state = store.getState()
    expect(state.status).toBe('error')
    // No silent fallback: no renderable config leaks through on rejection.
    expect(state.read).toBeNull()
    // The verdict is surfaced verbatim, prefixed so the shell shows 'config rejected: …'.
    expect(state.error).toBe(`config rejected: ${verdict.ok ? '' : verdict.error}`)
    expect(state.error).toContain('I2 cyclic childRegion spine')
  })

  it('loadConfigFromCell throws the verbatim verdict on an invalid config (unit-level)', async () => {
    await expect(loadConfigFromCell(fakeContract(ntFor(CYCLIC_CONFIG)), 'cyclic')).rejects.toThrow(
      /^config rejected: I2 cyclic childRegion spine/,
    )
  })
})

describe('loadConfigFromCell — the ABSENT-config carve-out (defaulted read)', () => {
  it('a graph with NO sux:Workspace node (empty :ux:config) resolves to GARDEN_DEFAULT in memory', async () => {
    // The real production read path over an EMPTY triple set — the exact shape
    // a fresh / imported / legacy-migrated graph presents.
    const store = createSessionStore({ contract: fakeContract(''), graphId: 'fresh' })
    await store.refresh()

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    // The fallback is the canonical object ITSELF (same reference), so every
    // downstream consumer — planFor, the dashboard-marker walk, fragment
    // machinery — behaves exactly as with a seeded GardenDefault.
    expect(state.read?.config).toBe(GARDEN_DEFAULT)
    expect(state.read?.defaulted).toBe(true)
    // Honest provenance: the read reflects the cell as it really is.
    expect(state.read?.tripleCount).toBe(0)
  })

  it('non-Workspace triples without a Workspace node still fall back (absent means absent)', async () => {
    // A graph can hold OTHER data in :ux:config-adjacent reads; only the
    // presence of a sux:Workspace node makes a config real.
    const nt = '<urn:x> <http://sophia.ai/ux#localId> "stray" .'
    const read = await loadConfigFromCell(fakeContract(nt), 'stray')
    expect(read.config).toBe(GARDEN_DEFAULT)
    expect(read.defaulted).toBe(true)
    expect(read.tripleCount).toBe(1)
  })

  it('a MALFORMED config (Workspace present but invalid) still errors — NEVER falls back', async () => {
    // Falling back over a real config would mask corruption: the cyclic config
    // HAS a Workspace node, so it must surface the verdict, not GARDEN_DEFAULT.
    const store = createSessionStore({ contract: fakeContract(ntFor(CYCLIC_CONFIG)), graphId: 'cyclic' })
    await store.refresh()

    const state = store.getState()
    expect(state.status).toBe('error')
    expect(state.read).toBeNull()
    expect(state.error).toContain('I2 cyclic childRegion spine')
  })

  it('a LATER load that finds real config triples wins over the fallback (no persistence)', async () => {
    // One store, a cell whose :ux:config starts empty and then gains a real
    // config (the existing authoring flows' job — this path never writes).
    let cellNt = ''
    const contract = {
      restConcrete: {
        dumpUxConfig: async () => ({ data: cellNt }),
      },
    } as unknown as CellContract
    const store = createSessionStore({ contract, graphId: 'becomes-real' })

    await store.refresh()
    expect(store.getState().read?.defaulted).toBe(true)
    expect(store.getState().read?.config).toBe(GARDEN_DEFAULT)

    cellNt = ntFor(GARDEN_DEFAULT) // the graph now HAS real config triples
    await store.refresh()
    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.read?.defaulted).toBe(false)
    // Parsed from the cell this time — an equal config, not the fallback object.
    expect(state.read?.config).not.toBe(GARDEN_DEFAULT)
    expect(state.read?.config.id).toBe(GARDEN_DEFAULT.id)
  })
})

describe('session activation — validated workspace cache', () => {
  it('cold-boots from a user/graph-scoped cached workspace only when transport is unavailable', async () => {
    const offlineStorage = new MemoryCellConfigReadStorage()
    const live = createSessionStore({
      contract: fakeContract(ntFor(GARDEN_DEFAULT)),
      graphId: 'offline-boot',
      offlineStorage,
    })
    await live.refresh()

    const unavailable = {
      restConcrete: {
        dumpUxConfig: async () => { throw new TypeError('network unavailable') },
      },
    } as unknown as CellContract
    const cold = createSessionStore({
      contract: unavailable,
      graphId: 'offline-boot',
      offlineStorage,
    })
    await cold.refresh()

    expect(cold.getState()).toMatchObject({
      status: 'ready',
      error: null,
      read: {
        activationSource: 'indexeddb',
        offlineError: 'network unavailable',
      },
    })
    expect(cold.getState().read?.config.id).toBe(GARDEN_DEFAULT.id)
  })

  it('never hides malformed live configuration behind a previously valid cache', async () => {
    const offlineStorage = new MemoryCellConfigReadStorage()
    const valid = createSessionStore({
      contract: fakeContract(ntFor(GARDEN_DEFAULT)),
      graphId: 'malformed-wins',
      offlineStorage,
    })
    await valid.refresh()

    const malformed = createSessionStore({
      contract: fakeContract(ntFor(CYCLIC_CONFIG)),
      graphId: 'malformed-wins',
      offlineStorage,
    })
    await malformed.refresh()

    expect(malformed.getState().status).toBe('error')
    expect(malformed.getState().read).toBeNull()
    expect(malformed.getState().error).toMatch(/^config rejected:/)
  })

  it('cannot surface the previous user cache when identity changes during the IndexedDB read', async () => {
    const graphId = 'identity-boundary'
    const cachedRead = await loadConfigFromCell(fakeContract(ntFor(GARDEN_DEFAULT)), graphId)
    let releaseRead!: () => void
    let markReadStarted!: () => void
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve })
    const readGate = new Promise<void>(resolve => { releaseRead = resolve })
    const offlineStorage: CellConfigReadStorage = {
      async get(userId, requestedGraphId) {
        markReadStarted()
        await readGate
        return userId === 'user-a' && requestedGraphId === graphId ? cachedRead : undefined
      },
      async put() {},
      async delete() {},
    }
    let currentUser = 'user-a'
    const authEvents: { listener?: () => void } = {}
    const unavailable = {
      auth: {
        userId: () => currentUser,
        isAuthenticated: () => true,
        onChange(listener: () => void) {
          authEvents.listener = listener
          return () => { delete authEvents.listener }
        },
      },
      restConcrete: {
        dumpUxConfig: async () => { throw new TypeError('network unavailable') },
      },
    } as unknown as CellContract
    const store = createSessionStore({ contract: unavailable, graphId, offlineStorage })

    const refresh = store.refresh()
    await readStarted
    currentUser = 'user-b'
    authEvents.listener?.()
    releaseRead()
    await refresh

    expect(store.getState()).toEqual({ status: 'idle', read: null, error: null })
  })
})
