import { describe, expect, it, vi } from 'vitest'
import { MNEMO_NS } from '@shrubbery/nucleus'
import type { ExcalidrawApi, ExcalidrawEngineContext } from '@shrubbery/runtime'
import {
  EXCALIDRAW_PREDICATE_OPTIONS,
  bytesToBase64,
  excalidrawLinkCandidates,
  makeOrganismExcalidrawOptions,
  sceneWireFromRow,
  sceneWireSnapshotSparql,
  type ExcalidrawCellContract,
  type ExcalidrawWorkspaceNode,
} from '../excalidraw-cell-service.js'
import { buildSceneLinkRecord } from '../excalidraw-scene-links.js'

const supports = `${MNEMO_NS}supports`

function fakeContract(query: (graphId: string, sparql: string) => Promise<unknown> = async () => ({ rows: [] })) {
  return {
    auth: {
      token: () => 'scene-token',
      userId: () => 'scene-user',
      isAuthenticated: () => true,
      whenReady: async () => {},
      onChange: () => () => {},
    },
    runtime: {
      mode: () => 'hosted' as const,
      isGateway: () => true,
      graphBaseUrl: (graphId: string) => `https://gateway.test/g/${graphId}`,
    },
    rest: { graphs: async () => [], query, update: async () => {} },
    mcp: { toolsCall: vi.fn(async () => ({ content: [] })) },
    wire: { create: vi.fn(), delete: vi.fn() },
    wireMode: {},
    crdt: {},
    ui: {},
  } as unknown as ExcalidrawCellContract
}

const workspaceNodes: readonly ExcalidrawWorkspaceNode[] = [
  { kind: 'document', id: 'doc-a', title: 'Document A', graphId: 'graph-a' },
  { kind: 'document', id: 'doc-b', title: 'Document B', graphId: 'graph-a' },
  { kind: 'artifact', id: 'image-a', title: 'Image A', graphId: 'graph-a', mimeType: 'image/png', wireDocumentId: 'image-doc-a' },
]

function rectangle(id: string, documentId: string, x: number) {
  return {
    id,
    type: 'rectangle',
    x,
    y: 20,
    width: 120,
    height: 60,
    link: `mnemosyne://document/graph-a/${documentId}`,
    customData: { mnemosyne: buildSceneLinkRecord('document', 'graph-a', documentId, documentId) },
  }
}

function context(elements: readonly unknown[], selectedElementId: string | null = null): ExcalidrawEngineContext {
  const api: ExcalidrawApi = {
    getSceneElements: () => elements,
    getAppState: () => ({}),
    getFiles: () => ({}),
    updateScene: () => {},
  }
  return {
    graphId: 'graph-a',
    artifactId: 'scene-a',
    elements,
    appState: {},
    files: {},
    selectedElementId,
    api,
    convertToExcalidrawElements: (skeleton) => skeleton,
    viewportCoordsToSceneCoords: (point) => ({ x: point.clientX, y: point.clientY }),
  }
}

function makeOptions(contract: ExcalidrawCellContract, fetchMock: typeof fetch, overrides: {
  onOpenNode?: ReturnType<typeof vi.fn>
} = {}) {
  return makeOrganismExcalidrawOptions({
    contract,
    scope: { graphId: 'graph-a', artifactId: 'scene-a' },
    getWorkspaceNodes: () => workspaceNodes,
    onOpenNode: overrides.onOpenNode ?? vi.fn(),
    fetch: fetchMock,
  })
}

describe('Organism Excalidraw cell service', () => {
  it('loads and saves real artifact revisions through the graph cell with auth', async () => {
    const scene = JSON.stringify({ type: 'excalidraw', version: 2, elements: [] })
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') return new Response('{}', { status: 201 })
      return new Response(scene, { headers: { 'content-type': 'application/vnd.excalidraw+json' } })
    })
    const options = makeOptions(fakeContract(), fetchMock)

    const bytes = await options.artifacts.load({ graphId: 'graph-a', artifactId: 'scene-a', signal: new AbortController().signal })
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(scene)
    await options.artifacts.save({
      graphId: 'graph-a',
      artifactId: 'scene-a',
      signal: new AbortController().signal,
      bytes: new TextEncoder().encode(scene),
      json: scene,
      mimeType: 'application/vnd.excalidraw+json',
      label: 'Edited',
      snapshot: context([]),
      projection: null,
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://gateway.test/g/graph-a/artifacts/graph-a/scene-a/download')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer scene-token', 'X-User-ID': 'scene-user',
    })
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://gateway.test/g/graph-a/artifacts/graph-a/scene-a/revisions')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      dataBase64: bytesToBase64(new TextEncoder().encode(scene)),
      mimeType: 'application/vnd.excalidraw+json',
      label: 'Edited',
    })
  })

  it('projects current workspace titles, selection affordances, and wire diagnostics', async () => {
    const contract = fakeContract()
    const options = makeOptions(contract, vi.fn<typeof fetch>())
    const elements = [
      rectangle('shape-a', 'doc-a', 0),
      rectangle('shape-b', 'doc-b', 250),
      {
        id: 'arrow-a', type: 'arrow', startBinding: { elementId: 'shape-a' }, endBinding: { elementId: 'shape-b' },
        customData: { mnemosyneArrow: { predicate: supports } },
      },
    ]
    const view = await options.projection!.project({ ...context(elements, 'shape-a'), reason: 'manual' })

    expect(view.summary).toMatchObject({ anchors: 2, arrows: 1, wireCandidates: 1, diagnostics: 2 })
    expect(view.diagnostics?.map((item) => item.code)).toEqual(['link-title-stale', 'link-title-stale'])
    expect(view.selectedElement).toMatchObject({
      id: 'shape-a', type: 'rectangle', linkKind: 'document', linkTargetId: 'doc-a',
      canOpenLink: true, canRemoveLink: true, canLink: false,
    })
    expect(view.wireSummary).toMatchObject({ missing: 1, hydratable: 0 })
    expect(EXCALIDRAW_PREDICATE_OPTIONS).toContainEqual({ value: supports, label: 'supports' })
    expect(excalidrawLinkCandidates(workspaceNodes, 'graph-a')).toContainEqual(expect.objectContaining({
      kind: 'artifact', id: 'image-a', title: 'Image A', mimeType: 'image/png',
    }))
  })

  it('bridges scene linking, opening, unlinking, predicates, and workspace node drops', async () => {
    const onOpenNode = vi.fn()
    const options = makeOptions(fakeContract(), vi.fn<typeof fetch>(), { onOpenNode })
    const elements = [{ id: 'shape-a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }]
    const base = context(elements, 'shape-a')

    const linked = await options.links!.linkSelected!(base, {
      elementId: 'shape-a', kind: 'document', id: 'doc-a', title: 'Document A',
    })
    expect(linked).toMatchObject({ save: true, message: 'Linked to Document A' })
    const linkedElements = (linked as { elements: readonly unknown[] }).elements
    expect(linkedElements[0]).toMatchObject({
      link: 'mnemosyne://document/graph-a/doc-a',
      customData: { mnemosyne: { id: 'doc-a', title: 'Document A' } },
    })

    await options.links!.openSelected!(context(linkedElements, 'shape-a'), { elementId: 'shape-a' })
    expect(onOpenNode).toHaveBeenCalledWith({ kind: 'document', graphId: 'graph-a', id: 'doc-a' })
    expect(options.links!.removeSelected!(context(linkedElements, 'shape-a'), { elementId: 'shape-a' })).toMatchObject({ save: true })

    const dropped = await options.links!.dropNode!(base, {
      node: { id: 'doc-b', kind: 'document', title: 'Document B' }, clientX: 200, clientY: 100,
    })
    expect(dropped).toMatchObject({ save: true, message: 'Added Document B' })
    expect((dropped as { elements: readonly unknown[] }).elements).toContainEqual(expect.objectContaining({
      type: 'rectangle', link: 'mnemosyne://document/graph-a/doc-b',
    }))
  })

  it('syncs missing arrow candidates as cell-native wires with scene provenance', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const contract = fakeContract(query)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 201 }))
    const options = makeOptions(contract, fetchMock)
    const elements = [
      rectangle('shape-a', 'doc-a', 0),
      rectangle('shape-b', 'doc-b', 250),
      {
        id: 'arrow-a', type: 'arrow', startBinding: { elementId: 'shape-a' }, endBinding: { elementId: 'shape-b' },
        customData: { mnemosyneArrow: { predicate: supports } },
      },
    ]

    const result = await options.wires!.sync!(context(elements))
    expect(result).toMatchObject({ message: 'Created 1 scene wire', view: { wireSummary: { created: 1, skipped: 0 } } })
    expect(query).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://gateway.test/g/graph-a/wires/graph-a/document/doc-a')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      target_graph_id: 'graph-a',
      target_document_id: 'doc-b',
      predicate: supports,
      sceneGraphId: 'graph-a',
      sceneArtifactId: 'scene-a',
      sceneElementId: 'arrow-a',
      sceneSourceElementId: 'shape-a',
      sceneTargetElementId: 'shape-b',
    })
  })

  it('reads the workspace projection wire vocabulary and hydrates scene-owned wires', async () => {
    const wireRow = {
      wire: '<urn:mnemosyne:local:graph:graph-a:wire:wire-1>',
      sourceDocument: '<urn:mnemosyne:local:graph:graph-a:document:doc-a>',
      targetDocument: '<urn:mnemosyne:local:graph:graph-a:document:doc-b>',
      targetGraph: '"graph-a"',
      predicate: `<${supports}>`,
      sceneGraphId: '"graph-a"',
      sceneArtifactId: '"scene-a"',
      sceneSourceElementId: '"shape-a"',
      sceneTargetElementId: '"shape-b"',
      sceneStableKey: '"stable-1"',
    }
    const query = vi.fn(async (_graphId: string, _sparql: string) => ({ rows: [wireRow] }))
    const options = makeOptions(fakeContract(query), vi.fn<typeof fetch>())
    const elements = [rectangle('shape-a', 'doc-a', 0), rectangle('shape-b', 'doc-b', 250)]

    const result = await options.wires!.hydrate!(context(elements))
    expect(result).toMatchObject({ save: true, message: 'Hydrated 1 scene wire' })
    expect((result as { elements: readonly Record<string, unknown>[] }).elements).toContainEqual(expect.objectContaining({
      type: 'arrow',
      startBinding: expect.objectContaining({ elementId: 'shape-a' }),
      endBinding: expect.objectContaining({ elementId: 'shape-b' }),
    }))
    expect(sceneWireSnapshotSparql('graph-a')).toContain('GRAPH <urn:mnemosyne:local:graph:graph-a:projection:workspace>')
    expect(sceneWireFromRow(wireRow)).toMatchObject({
      id: 'wire-1', sourceDocumentId: 'doc-a', targetDocumentId: 'doc-b', predicate: supports,
    })
  })
})
