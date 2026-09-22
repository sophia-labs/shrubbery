/**
 * mirror-artifact.ts — S3 made VISIBLE: render the mirror, archive the PNG as
 * a real cell artifact, hand back its address. "The mirror is an artifact."
 *
 * MECHANISM:
 *   1. renderPortrait() (./mirror) — the real headless-Chromium render.
 *   2. write the PNG to a throwaway temp file (parity with a real upload's
 *      on-disk footprint; a natural seam if a future archive route wants a
 *      file path instead of inline base64).
 *   3. archive it on the cell via the injected `cell` caller's `putArtifact`:
 *      bytes go through the artifact revision/original route, then conforming
 *      navigation metadata goes through the workspace artifact route. This is
 *      NOT the MCP `upload_artifact` tool. See ARTIFACT ARCHIVE ROUTES below.
 *   4. read it back via `callTool('read_artifact', ...)` to confirm it
 *      actually landed, then return {artifactId, sha256, png, status}.
 *
 * ARTIFACT ARCHIVE ROUTES — real findings, not design choices. `upload_artifact`
 * (the MCP tool) submits an async `document.uploadIngest` job. Empirically
 * confirmed live against a real cell (2026-07-06, this session): a .png's
 * `local_upload_mime_type_for_filename` classifies it `application/octet-stream`
 * (not "markdown-ish"), so the job always takes the parser-pool branch and
 * FAILS outright — `job.status: "failed"`, error "document.uploadIngest: no
 * parser pool configured (set GARDEN_PARSER_URL)" — on a plain local cell with
 * no GARDEN_PARSER_URL (a headless Atelier cell has no parser pool and
 * shouldn't need one just to keep a mirror-image). Even past that, per
 * garden/src-tauri/src/crdt_engine/upload_ingest_ops.rs +
 * original_file_service.rs, `document.uploadIngest` writes original bytes
 * under `existing_document_dir(...).join("original")`, a DIFFERENT directory
 * than `read_artifact` reads (`artifact_original_dir`) — so the two tools are
 * not a matched pair for fresh binary content in this build regardless. This
 * reconfirms the finding already recorded in apps/atelier/tests/
 * vtuber-appearance-mirror.integration.test.ts's own module doc.
 *
 * The old one-request path put `dataBase64` directly through
 * `PUT /navigation/{graphId}/artifacts/{artifactId}`. Garden saves those bytes
 * correctly, but its navigation normalizer also injects numeric `sizeBytes`.
 * The workspace projection consequently emits `nfo:fileSize` as
 * `xsd:integer`, while the current `emporium-workspace` SHACL contract declares
 * that optional predicate as `xsd:string`. Validation therefore rejects the
 * desired graph. Coercing a measured byte count to an RDF string in Atelier
 * would merely hide that contract mismatch.
 *
 * The conforming route composition is:
 *   - `POST /artifacts/{graphId}/{artifactId}/revisions` writes the PNG via
 *     `save_artifact_original_file` into `artifact_original_dir`, the SAME
 *     directory `read_artifact` serves. It also records the initial archived
 *     revision and works when no prior original exists.
 *   - `PUT /navigation/{graphId}/artifacts/{artifactId}` receives metadata only:
 *     label, filename, MIME, ready status, and storage key. It deliberately
 *     omits the optional size property rather than manufacture an invalid RDF
 *     datatype. The authoritative measured size remains present in the
 *     original-file manifest returned by `read_artifact`.
 *
 * This module drives both real HTTP routes through the injected cell's
 * `putArtifact`, and reserves `callTool` for actual MCP tools
 * (`read_artifact` here).
 *
 * LAZY-IMPORT DISCIPLINE: this module imports ./mirror, which lazily imports
 * playwright+vite INSIDE renderPortrait — so this module is Node-only too,
 * reachable only server-side. The demo's browser JS never imports this file;
 * it POSTs to a server-side /mirror route (a vite plugin) that imports it in
 * the Node dev-server process. node:http (not fetch) for the same reason
 * loopback-mcp.ts documents: Node's undici drops the Authorization header on
 * loopback POSTs, so the bearer must go over node:http/https directly.
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPortrait, type RenderPortraitOptions } from './mirror.js'
import type { MnVtuberStatusDetail } from './mn-vtuber/types.js'

/** The MCP `tools/call` result envelope — content[0].text carries a JSON
 *  string body (mirrors apps/atelier's loopback-mcp.ts ToolsCallResult). */
export interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>
  [k: string]: unknown
}

/** The high-level archive input. `createLoopbackCellCaller` splits this into a
 *  byte-bearing revision request and a SHACL-conforming navigation metadata
 *  request; raw `dataBase64` never enters the workspace RDF projection. */
export interface PutArtifactBody {
  label?: string
  originalFilename: string
  mimeType: string
  dataBase64: string
}

export interface ArtifactRevisionBody {
  dataBase64: string
  mimeType: string
  filename: string
  label?: string
}

export interface NavigationArtifactBody {
  label?: string
  originalFilename: string
  mimeType: string
  status: 'ready'
  storageKey: string
}

export interface ArtifactArchiveRequests {
  revision: ArtifactRevisionBody
  navigation: NavigationArtifactBody
}

/**
 * Project one archive input onto Garden's two truthful write contracts.
 *
 * `sizeBytes` is intentionally absent from `navigation`: the current workspace
 * SHACL vocabulary types `nfo:fileSize` as a string, while Garden's workspace
 * materializer turns any supplied size into an integer literal. The original
 * file manifest, queried through `read_artifact`, remains the source of truth
 * for the measured byte count.
 */
export function buildArtifactArchiveRequests(artifactId: string, body: PutArtifactBody): ArtifactArchiveRequests {
  return {
    revision: {
      dataBase64: body.dataBase64,
      mimeType: body.mimeType,
      filename: body.originalFilename,
      label: body.label,
    },
    navigation: {
      label: body.label,
      originalFilename: body.originalFilename,
      mimeType: body.mimeType,
      status: 'ready',
      storageKey: `local://artifacts/${artifactId}/original/${body.originalFilename}`,
    },
  }
}

/**
 * What renderAndArchive needs from "a cell" — dependency-injected so this is
 * testable against a REAL cell (spawnGardend) and, in production, drives the
 * demo's own direct connection to the real gardend loopback (same apiUrl +
 * bearer recipe the demo's /cell proxy uses — see createLoopbackCellCaller
 * below) without this module ever knowing about HTTP, tokens, or origins.
 */
export interface MirrorCellCaller {
  /** POST an MCP tools/call. Used here for `read_artifact` — the one MCP
   *  tool that actually reads back what putArtifact wrote. */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>
  /** Archive bytes and register SHACL-conforming workspace metadata through
   *  the loopback's two real artifact routes. Not an MCP tool — see the module
   *  doc for why this, not `upload_artifact`, is the write path. */
  putArtifact(graphId: string, artifactId: string, body: PutArtifactBody): Promise<void>
}

export interface RenderAndArchiveOptions extends RenderPortraitOptions {
  /** The graph to archive the portrait into. */
  graphId: string
  /** Override the generated artifact id (tests want a stable, inspectable id). */
  artifactId?: string
  /** Label recorded on the artifact. */
  label?: string
}

export interface RenderAndArchiveResult {
  artifactId: string
  sha256: string
  png: Uint8Array
  /** The component's own terminal status detail, verbatim — see ./mirror's
   *  doc: 'ready' with stats means a real VRM loaded; 'fallback' | 'error'
   *  means the procedural rig rendered instead. Callers MUST check this. */
  status: MnVtuberStatusDetail
}

/** Extract the concatenated `text` body from an MCP tools/call content array
 *  (rdf_dump / read_artifact both return a single text content item whose
 *  body is a JSON envelope). Exported so callers (the demo route, tests)
 *  don't have to reimplement this. */
export function mcpText(result: McpToolResult): string {
  const content = result.content
  if (Array.isArray(content)) {
    return content
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('')
  }
  return JSON.stringify(result)
}

/**
 * Render the current appearance through the real mirror and archive the PNG
 * as a real cell artifact. Returns the artifact id, sha256, PNG bytes, and
 * the component's own render status.
 */
export async function renderAndArchive(
  opts: RenderAndArchiveOptions,
  cell: MirrorCellCaller,
): Promise<RenderAndArchiveResult> {
  const rendered = await renderPortrait(opts)

  const tmpDir = await mkdtemp(join(tmpdir(), 'atelier-mirror-'))
  try {
    const tmpPath = join(tmpDir, 'portrait.png')
    await writeFile(tmpPath, rendered.png)

    // Non-'ready' statuses (the procedural fallback rig, or a harness error)
    // are still archived — callers may legitimately want the artifact even
    // when it isn't a real VRM render (e.g. a demo's "show me what happened"
    // debug loop) — but the label says so, so the cell-side record isn't
    // indistinguishable from a genuine mirror portrait once it's out of this
    // call's return value. See RenderAndArchiveResult.status's doc: the
    // caller still MUST check `status` itself before treating this as "the
    // agent saw itself" — this is a labeling honesty fix, not a gate.
    const artifactId = opts.artifactId ?? `atelier-mirror-${randomUUID()}`
    const defaultLabel =
      rendered.status.status === 'ready' ? 'Atelier mirror portrait' : `Atelier mirror portrait (${rendered.status.status})`
    await cell.putArtifact(opts.graphId, artifactId, {
      label: opts.label ?? defaultLabel,
      originalFilename: 'portrait.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from(rendered.png).toString('base64'),
    })

    // Confirm it actually landed — via the documented read_artifact MCP tool
    // (see module doc: the one MCP tool that reads what putArtifact wrote).
    const readRes = await cell.callTool('read_artifact', { graphId: opts.graphId, artifactId })
    const read = JSON.parse(mcpText(readRes)) as { sizeBytes?: number }
    if (read.sizeBytes !== rendered.png.length) {
      throw new Error(
        `renderAndArchive: archived artifact size mismatch (rendered ${rendered.png.length} bytes, ` +
          `read_artifact reports ${String(read.sizeBytes)}) for artifact ${artifactId}`,
      )
    }

    return { artifactId, sha256: rendered.sha256, png: rendered.png, status: rendered.status }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

// ── the production MirrorCellCaller: a real gardend loopback, over node:http ──

/** apiUrl + bearer token, the same pair `.gardend-loopback.json` yields and
 *  the demo's own /cell proxy is configured from. */
export interface LoopbackCellTransport {
  apiUrl: string
  token: string
}

/**
 * Build a MirrorCellCaller that talks to a real gardend loopback directly —
 * `POST {apiUrl}/mcp` for tools/call, the artifact revision route for original
 * bytes, and the navigation-artifact route for RDF metadata. Used by both the
 * integration test (against a spawned throwaway cell) and the demo's
 * server-side /mirror route (against the real dev cell's loopback) — the only
 * difference is which apiUrl/token it's given.
 */
export function createLoopbackCellCaller(transport: LoopbackCellTransport): MirrorCellCaller {
  const base = transport.apiUrl.replace(/\/$/, '')
  let nextId = 1
  return {
    async callTool(name, args) {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      })
      const res = await nodeHttpRequest('POST', `${base}/mcp`, transport.token, body)
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`MCP HTTP ${res.status} for ${name}: ${res.text.slice(0, 500)}`)
      }
      const json = JSON.parse(res.text) as { result?: McpToolResult; error?: { message?: string } }
      if (json.error) throw new Error(`MCP error for ${name}: ${json.error.message ?? 'unknown'}`)
      return json.result ?? {}
    },
    async putArtifact(graphId, artifactId, body) {
      const requests = buildArtifactArchiveRequests(artifactId, body)
      const encodedGraphId = encodeURIComponent(graphId)
      const encodedArtifactId = encodeURIComponent(artifactId)

      const revisionRes = await nodeHttpRequest(
        'POST',
        `${base}/artifacts/${encodedGraphId}/${encodedArtifactId}/revisions`,
        transport.token,
        JSON.stringify(requests.revision),
      )
      if (revisionRes.status < 200 || revisionRes.status >= 300) {
        throw new Error(
          `POST artifact revision HTTP ${revisionRes.status} for ${artifactId}: ${revisionRes.text.slice(0, 500)}`,
        )
      }

      const navigationRes = await nodeHttpRequest(
        'PUT',
        `${base}/navigation/${encodedGraphId}/artifacts/${encodedArtifactId}`,
        transport.token,
        JSON.stringify(requests.navigation),
      )
      if (navigationRes.status < 200 || navigationRes.status >= 300) {
        throw new Error(
          `PUT navigation artifact HTTP ${navigationRes.status} for ${artifactId}: ${navigationRes.text.slice(0, 500)}`,
        )
      }
    },
  }
}

/** node:http(s) directly, bearer attached — Node's global fetch (undici)
 *  drops the Authorization header on loopback POSTs (documented finding in
 *  apps/atelier/src/cell/loopback-mcp.ts, duplicated here rather than
 *  imported so this package stays independent of the apps/atelier shell). */
async function nodeHttpRequest(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  token: string,
  body?: string,
): Promise<{ status: number; text: string }> {
  const u = new URL(url)
  const lib = u.protocol === 'https:' ? await import('node:https') : await import('node:http')
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Origin: 'http://127.0.0.1' }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = String(Buffer.byteLength(body))
  }
  return new Promise((resolve, reject) => {
    const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
