/**
 * REAL INTEGRATION — renderAndArchive against a REAL headless gardend cell.
 * NO MOCKS: real chromium (via renderPortrait), real vite dev server, real
 * seed-san.vrm fixture, real gardend binary, real HTTP over the loopback.
 *
 * This is the S3-made-visible oracle: the mirror must (a) actually see the
 * VRM (not silently fall back to the procedural rig), (b) archive the PNG on
 * the cell via the real revision/original + navigation-metadata route pair
 * (see mirror-artifact.ts's module doc for why not inline `dataBase64` or
 * `upload_artifact`), and
 * (c) round-trip byte-for-byte + sha256 back out through the documented
 * `read_artifact` MCP tool.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLoopbackCellCaller, mcpText, renderAndArchive, type MirrorCellCaller } from '../mirror-artifact.js'
import { resolveGardendBin, spawnGardend, type GardendCell } from './support/spawn-gardend.js'

// node:path + fileURLToPath(import.meta.url), NOT `new URL(rel, import.meta.url)`
// — this suite runs under vitest's happy-dom environment, which shadows the
// global URL constructor and silently mis-resolves a `file:` base (the same
// hazard mirror.ts documents for its own HARNESS_DIR).
const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(TEST_DIR, '..', '..', 'fixtures', 'vrm', 'seed-san.vrm')
const GRAPH_ID = 'atelier-mirror-artifact-it'
const SIZE = { width: 320, height: 400 }
const RENDER_TIMEOUT_MS = 60_000

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

/** Population stddev of per-pixel-channel intensity — ~0 means a flat solid
 *  fill (the same oracle mirror.integration.test.ts uses to prove a real
 *  scene rendered, not a blank canvas). */
function channelStdDev(data: Buffer): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  const mean = sum / data.length
  let variance = 0
  for (let i = 0; i < data.length; i++) variance += (data[i] - mean) ** 2
  return Math.sqrt(variance / data.length)
}

describe('renderAndArchive — the mirror is an artifact (real cell, no mocks)', () => {
  let cell: GardendCell
  let caller: MirrorCellCaller

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary ` +
          `(no-mock rule). Set GARDEN_BIN, or build it in garden/src-tauri.`,
      )
    }
    if (!existsSync(FIXTURE)) throw new Error(`seed-san.vrm fixture not found at ${FIXTURE}`)

    cell = await spawnGardend()
    caller = createLoopbackCellCaller({ apiUrl: cell.apiUrl, token: cell.token })
    await caller.callTool('create_graph', { graph_id: GRAPH_ID, title: 'Atelier mirror-artifact IT' })
  }, 30_000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it(
    'renders a REAL VRM, archives it on the cell, and round-trips bytes + sha256 via read_artifact',
    async () => {
      const result = await renderAndArchive(
        {
          graphId: GRAPH_ID,
          modelPath: FIXTURE,
          appearance: { outfitTint: '#0f4c81', accentTint: '#e8a33d' },
          size: SIZE,
        },
        caller,
      )

      // (a) a REAL VRM loaded — not the procedural fallback rig.
      expect(result.status.status).toBe('ready')
      expect(result.status.error).toBeUndefined()
      expect(result.status.stats?.meshCount).toBeGreaterThan(0)
      expect(result.status.stats?.visibleMeshCount).toBeGreaterThan(0)

      // (b) the PNG decodes to the requested size and is non-trivial.
      const decoded = PNG.sync.read(Buffer.from(result.png))
      expect(decoded.width).toBe(SIZE.width)
      expect(decoded.height).toBe(SIZE.height)
      const stddev = channelStdDev(decoded.data)
      expect(stddev).toBeGreaterThan(10)

      // (c) read_artifact round-trips the exact bytes and sha256 back out.
      expect(result.artifactId).toBeTruthy()
      const readRes = await caller.callTool('read_artifact', { graphId: GRAPH_ID, artifactId: result.artifactId })
      const read = JSON.parse(mcpText(readRes)) as {
        kind: string
        mimeType: string
        sizeBytes: number
        dataBase64?: string
      }
      expect(read.kind).toBe('image')
      expect(read.mimeType).toBe('image/png')
      expect(read.sizeBytes).toBe(result.png.length)

      const roundTrip = Buffer.from(read.dataBase64 ?? '', 'base64')
      expect(roundTrip.equals(Buffer.from(result.png))).toBe(true)
      expect(createHash('sha256').update(roundTrip).digest('hex')).toBe(result.sha256)

      // (d) the workspace projection really landed under the strict
      // emporium-workspace SHACL contract. The optional nfo:fileSize triple is
      // absent because Garden currently materializes supplied sizes as
      // xsd:integer while that contract requires xsd:string; read_artifact's
      // manifest above remains the truthful size authority.
      const dumpRes = await caller.callTool('rdf_dump', { graphId: GRAPH_ID, format: 'trig' })
      const dump = JSON.parse(mcpText(dumpRes)) as { data?: string }
      expect(dump.data).toContain(`urn:mnemosyne:local:graph:${GRAPH_ID}:artifact:${result.artifactId}`)
      expect(dump.data).toContain('http://www.semanticdesktop.org/ontologies/2007/01/19/nie#mimeType')
      expect(dump.data).toContain('image/png')
      expect(dump.data).not.toContain('http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#fileSize')
    },
    RENDER_TIMEOUT_MS,
  )
})
