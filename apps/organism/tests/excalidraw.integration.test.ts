/** Real gardend oracle for Excalidraw artifact revisions and scene wires. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { URL as NodeUrl } from 'node:url'
import type { ExcalidrawApi, ExcalidrawEngineContext } from '@shrubbery/runtime'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import {
  makeOrganismExcalidrawOptions,
  sceneWireSnapshotSparql,
  type ExcalidrawWorkspaceNode,
} from '../src/cell/excalidraw-cell-service.js'
import { buildSceneLinkRecord } from '../src/cell/excalidraw-scene-links.js'
import { createSidebarDocument } from '../src/cell/sidebar-mutations.js'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'

const GRAPH_ID = 'organism-excalidraw-it'
const ARTIFACT_ID = 'scene-oracle'
const MIME = 'application/vnd.excalidraw+json' as const
const SUPPORTS = 'http://mnemosyne.ai/vocab#supports'
const GARDEND_BIN = resolveGardendBin()

/** happy-dom's fetch can lose loopback Authorization; preserve exact headers. */
const nodeCellFetch: typeof fetch = async (input, init = {}) => {
  const url = new NodeUrl(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
  const headers = new Headers(init.headers)
  headers.set('origin', 'http://127.0.0.1')
  let body: Uint8Array | undefined
  if (typeof init.body === 'string') body = new TextEncoder().encode(init.body)
  else if (init.body instanceof URLSearchParams) body = new TextEncoder().encode(init.body.toString())
  if (body) headers.set('content-length', String(body.byteLength))

  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
    }, response => {
      const chunks: Uint8Array[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item))
          else if (value !== undefined) responseHeaders.set(name, value)
        }
        const responseBody = chunks.length ? Buffer.concat(chunks) : null
        resolve(new Response(responseBody, {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }))
      })
    })
    request.on('error', reject)
    if (init.signal) {
      if (init.signal.aborted) request.destroy(new DOMException('Aborted', 'AbortError'))
      else init.signal.addEventListener('abort', () => request.destroy(new DOMException('Aborted', 'AbortError')), { once: true })
    }
    if (body) request.write(body)
    request.end()
  })
}

function linkedRectangle(id: string, documentId: string, title: string, x: number) {
  return {
    id,
    type: 'rectangle',
    x,
    y: 40,
    width: 180,
    height: 90,
    link: `mnemosyne://document/${GRAPH_ID}/${documentId}`,
    customData: { mnemosyne: buildSceneLinkRecord('document', GRAPH_ID, documentId, title) },
  }
}

function sceneElements() {
  return [
    linkedRectangle('source-shape', 'doc-source', 'Source document', 20),
    linkedRectangle('target-shape', 'doc-target', 'Target document', 420),
    {
      id: 'support-arrow',
      type: 'arrow',
      x: 200,
      y: 85,
      width: 220,
      height: 0,
      startBinding: { elementId: 'source-shape' },
      endBinding: { elementId: 'target-shape' },
      customData: { mnemosyneArrow: { predicate: SUPPORTS } },
    },
  ]
}

function engineContext(elements: readonly unknown[]): ExcalidrawEngineContext {
  const api: ExcalidrawApi = {
    getSceneElements: () => elements,
    getAppState: () => ({}),
    getFiles: () => ({}),
    updateScene: () => {},
  }
  return {
    graphId: GRAPH_ID,
    artifactId: ARTIFACT_ID,
    elements,
    appState: {},
    files: {},
    selectedElementId: null,
    api,
  }
}

describe('Excalidraw — real gardend artifact/wire round trip', () => {
  let cell: GardendCell
  let contract: GardendContract
  let options: ReturnType<typeof makeOrganismExcalidrawOptions>
  const nodes: readonly ExcalidrawWorkspaceNode[] = [
    { kind: 'document', id: 'doc-source', title: 'Source document', graphId: GRAPH_ID },
    { kind: 'document', id: 'doc-target', title: 'Target document', graphId: GRAPH_ID },
  ]

  beforeAll(async () => {
    if (!existsSync(GARDEND_BIN)) {
      throw new Error(`gardend binary is required for Excalidraw integration: ${GARDEND_BIN}`)
    }
    cell = await spawnGardend({ bin: GARDEND_BIN })
    contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
      userId: 'organism-excalidraw-it',
    })
    await contract.mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Excalidraw IT' })
    await createSidebarDocument(contract.mcp, {
      graphId: GRAPH_ID, documentId: 'doc-source', title: 'Source document', parentId: null,
    })
    await createSidebarDocument(contract.mcp, {
      graphId: GRAPH_ID, documentId: 'doc-target', title: 'Target document', parentId: null,
    })
    options = makeOrganismExcalidrawOptions({
      contract,
      scope: { graphId: GRAPH_ID, artifactId: ARTIFACT_ID },
      getWorkspaceNodes: () => nodes,
      onOpenNode: () => {},
      fetch: nodeCellFetch,
    })
  }, 30_000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('persists, projects, materializes, hydrates, and re-saves a scene through the live cell', async () => {
    const initialElements = sceneElements()
    const initialJson = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'shrubbery-real-cell-oracle',
      elements: initialElements,
      appState: {},
      files: {},
    })
    await options.artifacts.save({
      graphId: GRAPH_ID,
      artifactId: ARTIFACT_ID,
      signal: new AbortController().signal,
      bytes: new TextEncoder().encode(initialJson),
      json: initialJson,
      mimeType: MIME,
      label: 'Initial scene',
      snapshot: engineContext(initialElements),
      projection: null,
    })
    const navigation = await nodeCellFetch(
      `${cell.apiUrl}/navigation/${encodeURIComponent(GRAPH_ID)}/artifacts/${encodeURIComponent(ARTIFACT_ID)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cell.token}`,
          'Content-Type': 'application/json',
          'X-User-ID': 'organism-excalidraw-it',
        },
        body: JSON.stringify({
          label: 'Scene oracle',
          originalFilename: 'scene-oracle.excalidraw',
          mimeType: MIME,
          status: 'ready',
          storageKey: `local://artifacts/${ARTIFACT_ID}/original/scene-oracle.excalidraw`,
        }),
      },
    )
    expect(navigation.ok).toBe(true)

    const loaded = await options.artifacts.load({
      graphId: GRAPH_ID, artifactId: ARTIFACT_ID, signal: new AbortController().signal,
    })
    expect(JSON.parse(new TextDecoder().decode(loaded as Uint8Array))).toMatchObject({
      source: 'shrubbery-real-cell-oracle', elements: expect.arrayContaining([expect.objectContaining({ id: 'support-arrow' })]),
    })

    const projected = await options.projection!.project({ ...engineContext(initialElements), reason: 'manual' })
    expect(projected.summary).toMatchObject({ anchors: 2, arrows: 1, wireCandidates: 1, diagnostics: 0 })
    const synced = await options.wires!.sync!(engineContext(initialElements))
    expect(synced).toMatchObject({ view: { wireSummary: { created: 1, skipped: 0 } } })

    const wireRead = await contract.rest.query(GRAPH_ID, sceneWireSnapshotSparql(GRAPH_ID)) as {
      rows?: Array<Record<string, string>>
    }
    expect(wireRead.rows).toHaveLength(1)
    expect(wireRead.rows?.[0]).toMatchObject({
      sourceDocument: expect.stringContaining('doc-source'),
      targetDocument: expect.stringContaining('doc-target'),
      predicate: `<${SUPPORTS}>`,
      sceneArtifactId: `"${ARTIFACT_ID}"`,
      sceneElementId: '"support-arrow"',
    })

    const anchorOnly = initialElements.filter(element => element.id !== 'support-arrow')
    const freshOptions = makeOrganismExcalidrawOptions({
      contract,
      scope: { graphId: GRAPH_ID, artifactId: ARTIFACT_ID },
      getWorkspaceNodes: () => nodes,
      onOpenNode: () => {},
      fetch: nodeCellFetch,
    })
    const hydrated = await freshOptions.wires!.hydrate!(engineContext(anchorOnly))
    expect(hydrated).toMatchObject({ save: true, message: 'Hydrated 1 scene wire' })
    const hydratedElements = (hydrated as { elements: readonly Record<string, unknown>[] }).elements
    expect(hydratedElements).toContainEqual(expect.objectContaining({
      type: 'arrow',
      startBinding: expect.objectContaining({ elementId: 'source-shape' }),
      endBinding: expect.objectContaining({ elementId: 'target-shape' }),
      customData: { mnemosyneWire: expect.objectContaining({ predicate: SUPPORTS }) },
    }))

    const hydratedJson = JSON.stringify({ type: 'excalidraw', version: 2, elements: hydratedElements, appState: {}, files: {} })
    await freshOptions.artifacts.save({
      graphId: GRAPH_ID,
      artifactId: ARTIFACT_ID,
      signal: new AbortController().signal,
      bytes: new TextEncoder().encode(hydratedJson),
      json: hydratedJson,
      mimeType: MIME,
      label: 'Hydrated scene',
      snapshot: engineContext(hydratedElements),
      projection: null,
    })
    const roundTrip = await freshOptions.artifacts.load({
      graphId: GRAPH_ID, artifactId: ARTIFACT_ID, signal: new AbortController().signal,
    })
    expect(JSON.parse(new TextDecoder().decode(roundTrip as Uint8Array)).elements).toContainEqual(
      expect.objectContaining({ type: 'arrow', customData: { mnemosyneWire: expect.objectContaining({ wireId: expect.any(String) }) } }),
    )
  }, 40_000)
})
