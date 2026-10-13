import { describe, expect, it, vi } from 'vitest'
import { GARDEN_DEFAULT, createSelectionBus, parseNT, parseTriplesToConfig, serializeConfigToTriples, triplesToNT, type NavResource } from '@shrubbery/nucleus'
import { installEdgeInterpreter } from '../../../../../packages/runtime/src/edge-interpreter.js'
import LEGACY_NT from '../fixtures/garden-default-before-interaction-edges.ux.nt?raw'
import { loadConfigFromCell, MemoryCellConfigReadStorage, createSessionStore, type CellContract } from '../session-store.js'
import { withChoreographModesRegion } from '../choreograph-region-compat.js'

const readContract = (nt: string): CellContract => ({ restConcrete: { dumpUxConfig: vi.fn(async () => ({ data: nt })) } }) as unknown as CellContract
const canonical = (nt: string) => triplesToNT(parseNT(nt)).split('\n').sort().join('\n')

describe('exact pre-edge default compatibility, not a generic missing-edge fallback', () => {
  it('pins the observed old 239 facts; does not follow future default drift silently', () => {
    const { edges: _edges, ...beforeEdges } = GARDEN_DEFAULT
    expect(parseNT(LEGACY_NT)).toHaveLength(239)
    // Restore the four later default changes exactly: modes v1 renamed the
    // Choreograph region, its app spine dropped Garden's bottom bar, the
    // Mithras skin (2026-09-23) added one skin value, and the Hotdog Stand
    // skin (2026-10-02) added another, after it.
    const choreo = beforeEdges.regions['region-choreo-center']!
    const skin = beforeEdges.dimensions['dim-skin']!
    expect(skin.values.slice(-2).map(value => value.literalValue)).toEqual(['mithras', 'hotdog-stand'])
    const preModes = {
      ...beforeEdges,
      dimensions: {
        ...beforeEdges.dimensions,
        'dim-skin': {
          ...skin,
          values: skin.values.filter(value => value.literalValue !== 'mithras' && value.literalValue !== 'hotdog-stand'),
        },
      },
      appRootRegions: {
        ...beforeEdges.appRootRegions,
        choreograph: ['region-top-bar', 'region-choreo-center', 'region-bottom-bar'],
      },
      regions: {
        ...beforeEdges.regions,
        'region-choreo-center': { ...choreo, renderedByComponent: 'wf-studio-shell', label: 'Choreograph Center (Studio)' },
      },
    }
    expect(choreo.renderedByComponent).toBe('choreo-modes-surface')
    expect(canonical(LEGACY_NT)).toBe(canonical(triplesToNT(serializeConfigToTriples(preModes))))
  })

  it('restores only the six edges in memory, with exact raw provenance and no write capability', async () => {
    const contract = readContract(LEGACY_NT)
    const read = await loadConfigFromCell(contract, 'synthetic-legacy')
    expect(read).toMatchObject({ defaulted: false, tripleCount: 239, nt: LEGACY_NT, interactionCompatibility: 'legacy-default-v1' })
    const { edges, ...rest } = read.config
    expect(edges).toEqual(GARDEN_DEFAULT.edges)
    // Read-time projection only: the stored wf-studio-shell region reads as the modes surface.
    expect(rest).toEqual(withChoreographModesRegion(parseTriplesToConfig(parseNT(LEGACY_NT))))
    expect(contract.restConcrete.dumpUxConfig).toHaveBeenCalledTimes(1)
    expect(parseNT(read.nt)).toHaveLength(239)
  })

  it('survives serialization order and reaches the actual navigation interpreter', async () => {
    const reordered = triplesToNT([...parseNT(LEGACY_NT)].reverse())
    const read = await loadConfigFromCell(readContract(reordered), 'synthetic-legacy')
    const callbacks = new Set<(value: unknown) => void>(), opened: NavResource[] = []
    const dispose = installEdgeInterpreter(read.config, {
      'face:sidebar': { onOpen(cb) { callbacks.add(cb); return () => { callbacks.delete(cb) } }, toResource(raw) { return { graphId: 'synthetic-legacy', documentId: String(raw) } } },
      'face:editor': { navigate(resource) { opened.push(resource) } },
    }, createSelectionBus())
    for (const cb of [...callbacks]) cb('document-a')
    expect(opened).toEqual([{ graphId: 'synthetic-legacy', documentId: 'document-a' }])
    dispose(); expect(callbacks.size).toBe(0)
    expect(read.nt).toBe(reordered)
  })

  it.each([
    ['custom label', LEGACY_NT.replace('Garden Default Workspace', 'My workspace')],
    ['custom size', LEGACY_NT.replace('"0.6"', '"0.61"')],
    ['unknown fact', LEGACY_NT + '\n<urn:custom> <urn:predicate> "kept" .'],
    ['partial edge', LEGACY_NT + '\n<http://sophia.ai/ux#GardenDefault> <http://sophia.ai/ux#hasConfigEdge> <urn:incomplete> .'],
    ['duplicate fact', LEGACY_NT + '\n' + triplesToNT([parseNT(LEGACY_NT)[0]])],
    ['missing nonessential fact', triplesToNT(parseNT(LEGACY_NT).filter(t => !(t.s.endsWith('#GardenDefault') && t.p.endsWith('#label'))))],
  ])('does not repair %s', async (_label, nt) => {
    const read = await loadConfigFromCell(readContract(nt), 'synthetic-custom')
    expect(read.interactionCompatibility).toBeUndefined()
    expect(read.config.edges).toBeUndefined()
    expect(read.nt).toBe(nt)
  })

  it('keeps explicit no-interaction config and existing complete configs unchanged', async () => {
    for (const config of [GARDEN_DEFAULT, { ...GARDEN_DEFAULT, edges: [] }]) {
      const read = await loadConfigFromCell(readContract(triplesToNT(serializeConfigToTriples(config))), 'synthetic-explicit')
      expect(read.config).toEqual(config)
      expect(read.interactionCompatibility).toBeUndefined()
    }
  })

  it('uses the same exact compatibility for an old offline cached read', async () => {
    const storage = new MemoryCellConfigReadStorage()
    const raw = await loadConfigFromCell(readContract(LEGACY_NT), 'synthetic-offline')
    const { interactionCompatibility: _compatibility, ...old } = raw
    await storage.put('local-organism', 'synthetic-offline', { ...old, config: parseTriplesToConfig(parseNT(LEGACY_NT)) })
    const contract = { restConcrete: { dumpUxConfig: async () => { throw Error('offline') } } } as unknown as CellContract
    const store = createSessionStore({ contract, graphId: 'synthetic-offline', offlineStorage: storage })
    await store.refresh()
    expect(store.getState().read).toMatchObject({ activationSource: 'indexeddb', interactionCompatibility: 'legacy-default-v1', readAt: raw.readAt, nt: LEGACY_NT })
    expect(store.getState().read?.config.edges).toEqual(GARDEN_DEFAULT.edges)
    store.stopPoll()
  })
})
