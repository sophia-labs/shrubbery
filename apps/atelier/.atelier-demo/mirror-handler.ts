/**
 * mirror-handler.ts — the /mirror route's actual work, split out of
 * vite.config.ts on purpose: vite's OWN config file is loaded through a
 * minimal Node-native ESM path (not the dev server's module graph), which
 * can't resolve workspace packages that lean on bundler-style extensionless
 * imports (@shrubbery/nucleus's own internals, same as @shrubbery/atelier-
 * vtuber's) — confirmed empirically: importing @shrubbery/nucleus directly
 * from vite.config.ts crashes `pnpm atelier-demo` at config-load time with
 * `ERR_MODULE_NOT_FOUND` on nucleus's own `./workspace/index.js`. This module
 * is instead loaded at REQUEST time via `server.ssrLoadModule(...)` from the
 * plugin's configureServer hook, which routes it through vite's normal
 * resolve pipeline (the same one the browser side already uses) — so these
 * imports work exactly like they do in main.ts.
 */
import { resolve } from 'node:path'
import {
  parseNT,
  parseVtuberControlOverlay,
  uxControlGraphIri,
  type VtuberControlChannel,
} from '@shrubbery/nucleus'
import type { MnVtuberAppearance, MnVtuberCameraFrame, MnVtuberExpressionPreset, MnVtuberStatusDetail } from '@shrubbery/atelier-vtuber'
import {
  createLoopbackCellCaller,
  mcpText,
  renderAndArchive,
  type MirrorCellCaller,
} from '@shrubbery/atelier-vtuber/mirror-artifact'

export const GRAPH = 'atelier-dev'
const CHANNEL_ID = 'demo-avatar'

export interface MirrorRequestBody {
  appearance?: MnVtuberAppearance
  expression?: MnVtuberExpressionPreset
  cameraFrame?: MnVtuberCameraFrame
  /** Filename of a committed fixture (e.g. "seed-san.vrm") — defaults to
   *  seed-san.vrm. Validated against a plain filename pattern before it ever
   *  touches the filesystem. */
  fixture?: string
}

export interface MirrorResponseBody {
  artifactId: string
  sha256: string
  pngBase64: string
  status: MnVtuberStatusDetail
}

/**
 * Render the current appearance through the real mirror and archive it on
 * the cell. Missing appearance/expression/cameraFrame are reflected live from
 * the cell's own :ux:control channel (CHANNEL_ID) — the same channel
 * main.ts's controls panel writes to — so a bare "render mirror" click shows
 * exactly what the avatar panel is currently displaying.
 */
export async function runMirror(
  loopback: { apiUrl: string; token: string },
  body: MirrorRequestBody,
  fixturesDir: string,
): Promise<MirrorResponseBody> {
  const cell = createLoopbackCellCaller({ apiUrl: loopback.apiUrl, token: loopback.token })

  let appearance = body.appearance
  let expression = body.expression
  let cameraFrame = body.cameraFrame
  if (!appearance) {
    const channel = await readSeededChannel(cell)
    appearance = appearance ?? channel?.appearance
    expression = expression ?? channel?.expression
    cameraFrame = cameraFrame ?? channel?.cameraFrame
  }

  const fixture = body.fixture && /^[\w.-]+\.vrm$/.test(body.fixture) ? body.fixture : 'seed-san.vrm'
  const modelPath = resolve(fixturesDir, fixture)

  const result = await renderAndArchive(
    { graphId: GRAPH, modelPath, appearance, expression, cameraFrame, size: { width: 320, height: 400 } },
    cell,
  )
  return {
    artifactId: result.artifactId,
    sha256: result.sha256,
    pngBase64: Buffer.from(result.png).toString('base64'),
    status: result.status,
  }
}

/** Read the seeded demo channel (CHANNEL_ID) straight off the cell's own
 *  :ux:control N-Triples — the SAME rdf_dump + parseVtuberControlOverlay
 *  round trip main.ts's reflectFromCell uses client-side, run here
 *  server-side. */
async function readSeededChannel(cell: MirrorCellCaller): Promise<VtuberControlChannel | undefined> {
  const dump = await cell.callTool('rdf_dump', {
    graphId: GRAPH,
    sourceGraphIri: uxControlGraphIri(GRAPH),
    format: 'application/n-triples',
  })
  const dumpJson = JSON.parse(mcpText(dump)) as { data?: string }
  const overlay = parseVtuberControlOverlay(parseNT(dumpJson.data ?? ''))
  return overlay.channels[CHANNEL_ID]
}
