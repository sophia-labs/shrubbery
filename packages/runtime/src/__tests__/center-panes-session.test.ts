import { describe, expect, it } from 'vitest'
import {
  CenterPanesSessionRepository,
  centerPanesSessionStorageKey,
  decodeCenterPanesSession,
  encodeCenterPanesSession,
  type CenterPanesSessionStorage,
} from '../center-panes-session.js'
import {
  createCenterPanesState,
  navigateCenterPane,
  openCenterPane,
  resizeCenterPanes,
  setCenterPanesPosture,
} from '../center-panes-model.js'
import type { CenterPaneDocumentLocation } from '../center-panes-contract.js'

const documentLocation = (graphId: string, documentId: string): CenterPaneDocumentLocation => ({
  kind: 'document',
  graphId,
  documentId,
  title: documentId,
})

function memoryStorage(seed?: Map<string, string>): CenterPanesSessionStorage & { data: Map<string, string> } {
  const data = seed ?? new Map<string, string>()
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }
}

function richState(graphId = 'garden') {
  let state = createCenterPanesState({
    graphId,
    primaryLocation: documentLocation(graphId, 'alpha'),
  })
  state = openCenterPane(state, {
    paneId: state.primary.id,
    placement: 'active',
    location: documentLocation(graphId, 'alpha-2'),
  })
  state = openCenterPane(state, {
    paneId: state.primary.id,
    placement: 'split',
    location: documentLocation(graphId, 'beta'),
  })
  state = navigateCenterPane(state, state.primary.id, 'back')
  state = resizeCenterPanes(state, 63.25)
  return setCenterPanesPosture(state, 'right-collapsed')
}

describe('center-pane mux session persistence', () => {
  it('round-trips pane addresses, independent history, focus, divider, and posture', () => {
    const state = richState()
    expect(decodeCenterPanesSession(encodeCenterPanesSession('garden', state), 'garden'))
      .toEqual(state)
  })

  it('fails closed for corrupt, stale-version, and cross-graph state', () => {
    expect(decodeCenterPanesSession('{broken', 'garden')).toBeNull()
    expect(decodeCenterPanesSession(JSON.stringify({ version: 0, graphId: 'garden', state: richState() }), 'garden'))
      .toBeNull()
    expect(decodeCenterPanesSession(encodeCenterPanesSession('garden', richState()), 'other'))
      .toBeNull()

    const crossGraph = richState() as unknown as { primary: { current: { graphId: string } } }
    crossGraph.primary.current.graphId = 'other'
    expect(() => encodeCenterPanesSession('garden', crossGraph as never)).toThrow(/outside its graph/)
  })

  it('keeps graph sessions separate in one tab', () => {
    const storage = memoryStorage()
    const repository = new CenterPanesSessionRepository(storage)
    repository.save('alpha', richState('alpha'))
    repository.save('beta', richState('beta'))

    expect(repository.load('alpha')?.primary.current).toMatchObject({ graphId: 'alpha' })
    expect(repository.load('beta')?.primary.current).toMatchObject({ graphId: 'beta' })
    expect(storage.data.size).toBe(2)
    expect(centerPanesSessionStorageKey('a:b')).not.toBe(centerPanesSessionStorageKey('a/b'))
  })

  it('models Duplicate Tab as an initial clone with independent later authority', () => {
    const originalStorage = memoryStorage()
    const original = new CenterPanesSessionRepository(originalStorage)
    const initial = richState()
    original.save('garden', initial)

    // Browsers clone sessionStorage into a newly opened tab, then the stores
    // diverge. This is the desired pane-session behavior (unlike presence IDs).
    const duplicateStorage = memoryStorage(new Map(originalStorage.data))
    const duplicate = new CenterPanesSessionRepository(duplicateStorage)
    expect(duplicate.load('garden')).toEqual(initial)

    const changed = resizeCenterPanes(initial, 28)
    duplicate.save('garden', changed)
    expect(duplicate.load('garden')?.dividerPercent).toBe(28)
    expect(original.load('garden')?.dividerPercent).toBe(63.25)
  })

  it('treats unavailable storage as non-fatal shell state', () => {
    const repository = new CenterPanesSessionRepository(null)
    expect(repository.load('garden')).toBeNull()
    expect(repository.save('garden', richState())).toBe(false)
    expect(() => repository.clear('garden')).not.toThrow()
  })
})
