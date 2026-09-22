import { renderKoreaderFeed } from '@shrubbery/koreader'
import { readLoopbackManifest } from '@shrubbery/source/node'
import { describe, expect, it } from 'vitest'
import { loadGardenLibrary, loadGardenWorkspaceCatalogue } from './garden-client.js'

const manifestPath = process.env.GARDEN_LOOPBACK_MANIFEST ?? ''
const graphId = process.env.GARDEN_GRAPH_ID ?? ''
const documentSource = process.env.GARDEN_DOCUMENT_SOURCE === 'tiptap-xml'
  ? 'tiptap-xml'
  : 'hosted-blocks'
const liveConfigured = manifestPath !== '' && graphId !== ''

describe.skipIf(!liveConfigured)('live Gardend document projection', () => {
  it('renders a complete KOReader feed from authoritative Garden documents', async () => {
    const manifest = readLoopbackManifest(manifestPath)
    const workspaces = await loadGardenWorkspaceCatalogue({
      baseUrl: manifest.apiUrl,
      token: manifest.token,
    })
    expect(workspaces.some((workspace) => workspace.graphId === graphId)).toBe(true)
    const library = await loadGardenLibrary({
      baseUrl: manifest.apiUrl,
      graphId,
      token: manifest.token,
      title: `Live ${graphId}`,
      documentSource,
    })
    expect(library.documents.length).toBeGreaterThan(0)
    expect(library.documents.every((document) => document.graphId === graphId)).toBe(true)
    expect(Array.isArray(library.folders)).toBe(true)
    if (documentSource === 'tiptap-xml') {
      expect(library.documents.some((document) => document.blocks.length > 1)).toBe(true)
    }

    const artifact = renderKoreaderFeed(library, {
      generatedAt: '2026-07-31T00:00:00.000Z',
    })
    expect(artifact.manifest.documents).toHaveLength(library.documents.length)
    expect(artifact.manifest.navigation.folders).toEqual(library.folders)
    expect(artifact.files).toHaveLength(2 + (2 * library.documents.length))
    const paths = new Set(artifact.files.map((file) => file.path))
    for (const document of artifact.manifest.documents) {
      expect(paths.has(document.path)).toBe(true)
      expect(paths.has(document.modelPath)).toBe(true)
    }
  })
})
