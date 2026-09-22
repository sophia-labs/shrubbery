/**
 * REAL INTEGRATION — the Atelier's S2 (`set_vtuber_appearance`) + S3 (the
 * mirror) loop, END TO END, against a REAL headless gardend cell. NO MOCKS.
 *
 *   0. SEED — a workspace with ONE mn-vtuber panel (:ux:config) PLUS a
 *      VtuberControlChannel bound to that panel (:ux:control), via the SAME
 *      admitted literal rdf_load form the other integration suites use.
 *      LIVE-READ both graphs through the shell contract, render, and assert
 *      the SEEDED tint/expression on the real <mn-vtuber> element.
 *   1. THE REJECTING calls run FIRST (pristine seed): a malformed hex tint and
 *      an unknown-channel target are both REJECTED by `applySetVtuberAppearance`
 *      — assert :ux:control is BYTE-FOR-BYTE unchanged (a full triple-line diff,
 *      not just a count) after each.
 *   2. THE VERB — `growVtuberAppearance` against the real cell: an accepted
 *      edit touching 3 of the 6 styling fields. Assert in the CELL (rdf_dump +
 *      line-diff, no SPARQL-count shortcut) that EXACTLY those 3 predicates
 *      changed and the other 3 are byte-identical before/after — proving the
 *      DELETE/INSERT/WHERE is scoped per-field, not a blanket appearance clear.
 *   3. REFLECT — re-read :ux:config + :ux:control, re-render: the live
 *      <mn-vtuber> element now carries the NEW values (and still the OLD
 *      values for the untouched fields).
 *   4. THE MIRROR — renderPortrait() (real headless Chromium + real Vite dev
 *      server + the real seed-san.vrm fixture) with the NOW-current appearance,
 *      then archive the PNG as a real artifact on the SAME cell and read it
 *      back — assert an exact byte/sha256 round trip.
 *
 * ARTIFACT-ROUND-TRIP NOTE (a real finding, not a design choice): the
 * `upload_artifact` MCP tool cannot be used to archive the portrait. Traced
 * against a live cell, `upload_artifact` → `document.uploadIngest`
 * (garden/src-tauri/src/crdt_engine/upload_ingest_ops.rs) (a) REQUIRES
 * `GARDEN_PARSER_URL` for any non-markdown/text upload (a PNG always takes
 * this branch — `local_upload_mime_type_for_filename` in ids.rs has no image
 * extensions, so it is never classified "markdown-ish"), and (b) even past
 * that, writes the original bytes under `existing_document_dir(...).join
 * ("original")` (original_file_service.rs::adopt_pending_original_file_service),
 * while `read_artifact` reads a DIFFERENT directory,
 * `artifact_original_dir(...)` (original_file_service.rs::
 * read_artifact_original_file) — confirmed empirically: `read_artifact` on a
 * document created by `upload_artifact` throws ENOENT on `manifest.json`. The
 * two tools are not a matched pair for fresh binary content in this build.
 * The write path that DOES pair with `read_artifact` is the loopback's own
 * navigation route `PUT /navigation/{graphId}/artifacts/{artifactId}`
 * (loopback_navigation_routes.rs::loopback_hosted_put_navigation_artifact,
 * scopes workspace.write.crdt + artifacts.write), which writes via
 * `save_artifact_original_file` into the SAME `artifact_original_dir` —
 * verified end to end (kind: 'image', dataBase64 round-trips byte-for-byte).
 * This suite drives that route directly (still the real cell, still no
 * mock — plain node:http against the same loopback + bearer token) as the
 * archive leg, then reads the result back through the documented
 * `read_artifact` MCP tool.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import * as http from 'node:http'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NS,
  parseNT,
  termToNT,
  triplesToNT,
  serializeConfigToTriples,
  serializeVtuberControlChannelsToTriples,
  selectVtuberControlChannel,
  uxControlGraphIri,
  type Triple,
  type VtuberControlChannel,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import {
  renderWorkspace,
  growVtuberAppearance,
  makeAppearanceGrowCell,
  sparqlUpdateArgs,
  type AppearanceGrowCell,
} from '@shrubbery/runtime'
import { renderPortrait } from '@shrubbery/atelier-vtuber/mirror'
import {
  spawnGardend,
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import { loadConfigFromCell, loadControlOverlayFromCell } from '../src/cell/session-store.js'
import { mcpText } from '../src/cell/loopback-mcp.js'

const GRAPH_ID = 'shrubbery-atelier-appearance-mirror-it'
const CHANNEL_ID = 'vtuber-main'
const PANEL_ID = 'panel-avatar'
const ARTIFACT_ID = 'atelier-portrait-appearance-mirror-it'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

// node:path + fileURLToPath(import.meta.url), NOT `new URL(rel, import.meta.url)`
// — this suite runs under vitest's happy-dom environment, which shadows the
// global URL constructor and silently mis-resolves a `file:` base (the same
// hazard mirror.ts documents and works around for its own HARNESS_DIR).
const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const VRM_FIXTURE = join(TEST_DIR, '..', '..', '..', 'packages', 'atelier', 'fixtures', 'vrm', 'seed-san.vrm')

/** ONE root, ONE panel, rendered by the real mn-vtuber component — no chrome. */
const AVATAR_CONFIG: WorkspaceConfig = {
  id: 'AtelierAvatarWorkspace',
  label: 'Atelier Avatar Workspace',
  renderedByComponent: 'app-shell',
  regions: {
    'region-center': {
      id: 'region-center',
      label: 'Center',
      childRegion: null,
      order: 1,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: true,
      // 0.99, not 1 — I6 requires the open interval (0,1) even for a lone spine
      // head with no siblings (validate.ts:82-96); 0.99 is the in-repo convention
      // for exactly this "one region, full bleed" shape (minimal-text-panel.ts:55).
      sizeFraction: 0.99,
      dockState: null,
      docksPanel: ['panel-avatar'],
      renderedByComponent: null,
    },
  },
  panels: {
    'panel-avatar': {
      id: 'panel-avatar',
      label: 'Avatar',
      renderedByComponent: 'mn-vtuber',
      dockState: 'docked',
      defaultVisible: true,
    },
  },
  dimensions: {},
  rootRegions: ['region-center'],
}

/** The SEEDED channel — deliberately gives all 6 styling fields a value so the
 *  ACCEPTED-edit test can prove an untouched field's triple is byte-identical
 *  before/after (not merely absent both times). */
const SEED_CHANNEL: VtuberControlChannel = {
  id: CHANNEL_ID,
  label: 'Assistant avatar',
  targetComponent: 'mn-vtuber',
  targetPanel: PANEL_ID,
  targetRegion: null,
  expression: 'neutral',
  cameraFrame: 'bust',
  appearance: {
    accentTint: '#111111',
    eyeTint: '#222222',
    hairTint: '#333333',
    outfitTint: '#444444',
    skinWarmth: 0.1,
  },
}

/** The verb edit — touches HALF the closed field set (expression, accentTint,
 *  skinWarmth), leaving eyeTint/hairTint/outfitTint untouched on purpose. */
const EDIT = { expression: 'excited' as const, accentTint: '#c0392b', skinWarmth: 0.4 }
const TOUCHED_LOCAL_KEYS = ['expression', 'accentTint', 'skinWarmth'] as const
const UNTOUCHED_LOCAL_KEYS = ['eyeTint', 'hairTint', 'outfitTint'] as const

// ── triple-line diffing over a live rdf_dump body (no SPARQL-count shortcut —
//    "exactly these predicates changed" needs the actual triples, not a total). ──

function tripleLine(t: Triple): string {
  return `<${t.s}> <${t.p}> ${termToNT(t.o)} .`
}
function tripleLineSet(nt: string): Set<string> {
  return new Set(parseNT(nt).map(tripleLine))
}
function predicateOf(line: string): string {
  const m = /^<[^>]+> <([^>]+)>/.exec(line)
  if (!m) throw new Error(`predicateOf: no predicate found in triple line: ${line}`)
  return m[1]
}
function findLineForKey(lines: Set<string>, localKey: string): string {
  const predicate = NS.sux + localKey
  const found = [...lines].find((l) => predicateOf(l) === predicate)
  if (!found) throw new Error(`findLineForKey: no '${localKey}' triple in the dumped graph`)
  return found
}

/**
 * A minimal node:http PUT to the loopback — the SAME "don't use fetch"
 * discipline loopback-mcp.ts documents (Node's global fetch/undici drops the
 * Authorization header on loopback requests; node:http keeps it). This drives
 * the navigation artifact REST route directly (see the module doc's ARTIFACT
 * finding) — there is no MCP tool wrapper for it, so no contract method exists
 * to reuse; this is the one place this suite talks to the cell outside /mcp.
 */
function putJson(
  apiUrl: string,
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const payload = JSON.stringify(body)
  const u = new URL(apiUrl + path)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${token}`,
          Origin: 'http://127.0.0.1',
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

describe('REAL INTEGRATION — Atelier S2 (set_vtuber_appearance) + S3 (mirror), end to end', () => {
  let cell: GardendCell
  let contract: GardendContract
  let appearanceCell: AppearanceGrowCell

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary ` +
          `(no-mock rule). Set GARDEN_BIN, or run the live cell: pnpm gardend:dev`,
      )
    }
    if (!existsSync(VRM_FIXTURE)) {
      throw new Error(`seed-san.vrm fixture not found at ${VRM_FIXTURE}`)
    }

    cell = await spawnGardend()
    const configNt = triplesToNT(serializeConfigToTriples(AVATAR_CONFIG))
    await createGraphAndSeedUxConfig(cell, GRAPH_ID, configNt)

    contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
    })

    // OUT-OF-BAND seed the :ux:control channel — the SAME admitted literal
    // rdf_load form the :ux:config seed uses (targetGraphIri, additive load).
    const controlNt = triplesToNT(serializeVtuberControlChannelsToTriples([SEED_CHANNEL]))
    await contract.mcp.toolsCall('rdf_load', {
      graphId: GRAPH_ID,
      data: controlNt,
      format: 'application/n-triples',
      targetGraphIri: uxControlGraphIri(GRAPH_ID),
    })

    // The AppearanceGrowCell port, wired to the real cell exactly as
    // set-appearance.ts's own doc comment prescribes for a shell.
    appearanceCell = makeAppearanceGrowCell({
      readControlOverlay: (graphId) => loadControlOverlayFromCell(contract, graphId),
      mutateGraph: async (graphId, update) => {
        await contract.mcp.toolsCall('sparql_update', sparqlUpdateArgs(graphId, update))
      },
    })
  }, 60000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('(0) SEED + LIVE-READ: the real <mn-vtuber> element renders the SEEDED tint/expression', async () => {
    const configRead = await loadConfigFromCell(contract, GRAPH_ID)
    const overlay = await loadControlOverlayFromCell(contract, GRAPH_ID)
    expect(Object.keys(overlay.channels)).toEqual([CHANNEL_ID])

    const dom = renderWorkspace(configRead.config, { vtuberControls: overlay })
    const el = dom.querySelector('mn-vtuber') as HTMLElement & Record<string, unknown>
    expect(el).not.toBeNull()
    expect(el.getAttribute('data-control-channel')).toBe(CHANNEL_ID)
    expect(el.expression).toBe('neutral')
    expect(el.cameraFrame).toBe('bust')
    expect(el.appearance).toEqual({
      accentTint: '#111111',
      eyeTint: '#222222',
      hairTint: '#333333',
      outfitTint: '#444444',
      skinWarmth: 0.1,
    })
  })

  // ── (1) THE REJECTING calls run FIRST, against the pristine seed. ───────────

  it('(1a) REJECTED — malformed hex tint — :ux:control is byte-for-byte unchanged', async () => {
    const before = tripleLineSet((await contract.restConcrete.dumpUxControl(GRAPH_ID)).data ?? '')
    const res = await growVtuberAppearance(appearanceCell, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { channelId: CHANNEL_ID },
      appearance: { accentTint: 'not-a-hex-color' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('fields')
    expect(res.error).toContain('accentTint')
    const after = tripleLineSet((await contract.restConcrete.dumpUxControl(GRAPH_ID)).data ?? '')
    expect(after).toEqual(before)
  })

  it('(1b) REJECTED — unknown channel target — :ux:control is byte-for-byte unchanged', async () => {
    const before = tripleLineSet((await contract.restConcrete.dumpUxControl(GRAPH_ID)).data ?? '')
    const res = await growVtuberAppearance(appearanceCell, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { channelId: 'vtuber-does-not-exist' },
      appearance: { expression: 'excited' },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('target')
    const after = tripleLineSet((await contract.restConcrete.dumpUxControl(GRAPH_ID)).data ?? '')
    expect(after).toEqual(before)
  })

  // ── (2) THE VERB — the accepted edit. ────────────────────────────────────────

  it('(2) ACCEPTED: growVtuberAppearance changes EXACTLY the 3 touched predicates', async () => {
    const before = tripleLineSet((await contract.restConcrete.dumpUxControl(GRAPH_ID)).data ?? '')

    const res = await growVtuberAppearance(appearanceCell, GRAPH_ID, {
      verb: 'set_vtuber_appearance',
      target: { channelId: CHANNEL_ID },
      appearance: EDIT,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.channelId).toBe(CHANNEL_ID)

    const after = tripleLineSet((await contract.restConcrete.dumpUxControl(GRAPH_ID)).data ?? '')
    const removed = [...before].filter((l) => !after.has(l))
    const added = [...after].filter((l) => !before.has(l))

    // Exactly one DELETE + one INSERT per touched predicate — nothing more.
    expect(removed.length).toBe(TOUCHED_LOCAL_KEYS.length)
    expect(added.length).toBe(TOUCHED_LOCAL_KEYS.length)
    for (const key of TOUCHED_LOCAL_KEYS) {
      const predicate = NS.sux + key
      expect(removed.filter((l) => predicateOf(l) === predicate)).toHaveLength(1)
      expect(added.filter((l) => predicateOf(l) === predicate)).toHaveLength(1)
    }

    // The 3 UNTOUCHED fields are byte-identical triples before and after — the
    // DELETE/INSERT/WHERE is scoped per-field, not a blanket appearance clear.
    for (const key of UNTOUCHED_LOCAL_KEYS) {
      expect(findLineForKey(after, key)).toBe(findLineForKey(before, key))
    }
  })

  // ── (3) REFLECT — re-read + re-render carries the NEW values. ──────────────

  it('(3) REFLECT: re-read + render — <mn-vtuber> carries the NEW values, keeps the OLD untouched ones', async () => {
    const configRead = await loadConfigFromCell(contract, GRAPH_ID)
    const overlay = await loadControlOverlayFromCell(contract, GRAPH_ID)
    const channel = selectVtuberControlChannel(overlay, { panelId: PANEL_ID })
    expect(channel).not.toBeNull()
    expect(channel?.expression).toBe('excited')
    expect(channel?.appearance?.accentTint).toBe('#c0392b')
    expect(channel?.appearance?.skinWarmth).toBe(0.4)
    // Untouched fields still carry the SEED values.
    expect(channel?.appearance?.eyeTint).toBe('#222222')
    expect(channel?.appearance?.hairTint).toBe('#333333')
    expect(channel?.appearance?.outfitTint).toBe('#444444')

    const dom = renderWorkspace(configRead.config, { vtuberControls: overlay })
    const el = dom.querySelector('mn-vtuber') as HTMLElement & Record<string, unknown>
    expect(el.expression).toBe('excited')
    expect((el.appearance as Record<string, unknown>).accentTint).toBe('#c0392b')
    expect((el.appearance as Record<string, unknown>).skinWarmth).toBe(0.4)
    expect((el.appearance as Record<string, unknown>).eyeTint).toBe('#222222')
  })

  // ── (4) THE MIRROR — real render, real archive, real byte round trip. ──────

  it(
    '(4) MIRROR: renders the current appearance and archives the portrait as a real cell artifact',
    async () => {
      const overlay = await loadControlOverlayFromCell(contract, GRAPH_ID)
      const channel = selectVtuberControlChannel(overlay, { panelId: PANEL_ID })
      expect(channel).not.toBeNull()

      const rendered = await renderPortrait({
        modelPath: VRM_FIXTURE,
        size: { width: 320, height: 400 },
        appearance: channel!.appearance,
        expression: channel!.expression,
        cameraFrame: channel!.cameraFrame,
      })

      // The mirror actually SAW the real VRM — not the procedural fallback rig.
      expect(rendered.status.status).toBe('ready')
      expect(rendered.status.stats?.meshCount).toBeGreaterThan(0)
      expect(rendered.status.stats?.visibleMeshCount).toBeGreaterThan(0)

      // ARCHIVE — via the loopback navigation route (see module doc: the ONE
      // write path that pairs with read_artifact for fresh binary content).
      const put = await putJson(cell.apiUrl, cell.token, `/navigation/${GRAPH_ID}/artifacts/${ARTIFACT_ID}`, {
        label: 'Atelier mirror portrait',
        originalFilename: 'portrait.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from(rendered.png).toString('base64'),
      })
      expect(
        put.status,
        `artifact PUT /navigation/${GRAPH_ID}/artifacts/${ARTIFACT_ID} returned ${put.status} — response body: ${put.text}`,
      ).toBe(200)

      // READ BACK — via the documented `read_artifact` MCP tool.
      const readRes = await contract.mcp.toolsCall('read_artifact', {
        graphId: GRAPH_ID,
        artifactId: ARTIFACT_ID,
      })
      const read = JSON.parse(mcpText(readRes)) as {
        kind: string
        mimeType: string
        sizeBytes: number
        dataBase64?: string
      }
      expect(read.kind).toBe('image')
      expect(read.mimeType).toBe('image/png')
      expect(read.sizeBytes).toBe(rendered.png.length)

      const roundTrip = Buffer.from(read.dataBase64 ?? '', 'base64')
      expect(roundTrip.equals(Buffer.from(rendered.png))).toBe(true)
      expect(createHash('sha256').update(roundTrip).digest('hex')).toBe(rendered.sha256)
    },
    60000,
  )
})
