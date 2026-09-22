/**
 * mirror.ts — render_portrait: the Atelier's mirror.
 *
 * A headless, real-WebGL render of the mn-vtuber puppet to PNG bytes, so a
 * sightless agent can look at itself (S3 of the ratified Atelier design — the
 * keystone "the mirror is an artifact" affordance).
 *
 * MECHANISM — the honest path with the least machinery:
 *   1. Boot a throwaway Vite dev server in-process (no config file on disk)
 *      rooted at `mirror-harness/` — a two-file harness (index.html +
 *      entry.ts) whose entry imports THIS package's real `mn-vtuber.js` (the
 *      identical module a real host imports — not a stub) and mounts one
 *      `<mn-vtuber>` with the requested properties, animate=false.
 *   2. Serve the caller's .vrm bytes same-origin at MODEL_ROUTE (GLTFLoader
 *      fetches by URL; a real browser's fetch() won't reach an arbitrary
 *      file:// path, so the bytes have to come from an http route).
 *   3. Launch real headless Chromium (playwright), inject the render config
 *      via an init script, navigate, and wait — EVENT-DRIVEN, no sleeps —
 *      for the component's own `mn-vtuber-status` event to reach a terminal
 *      state (`ready` | `fallback` | `error`); the harness itself then waits
 *      two animation frames so the canvas has actually painted that state
 *      before signalling Node.
 *   4. Screenshot the page (viewport pinned to the requested box, DPR pinned
 *      to 1 for determinism), hash the PNG, tear everything down.
 *
 * LAZY-IMPORT DISCIPLINE: playwright and vite are dynamically imported
 * INSIDE renderPortrait, never at module top level. This file is reached
 * only via the package's `./mirror` subpath export — the main `.` and
 * `./vtuber` entries never import it. A consumer that never calls
 * renderPortrait never pays for a browser or a dev server in their
 * dependency graph.
 *
 * THE FALLBACK TRAP: a missing/broken model silently renders the procedural
 * fallback rig instead of throwing — that's the component's designed
 * resilience for a live host, but it would be a lie for a mirror, whose
 * entire point is knowing whether the agent is really seeing ITSELF. So the
 * returned `status` is the component's own MnVtuberStatusDetail, verbatim:
 * `status: 'ready'` with real `stats` means a real VRM loaded; `status:
 * 'fallback' | 'error'` (stats undefined) means the procedural rig rendered
 * instead. A PNG comes back either way — callers MUST check this field.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  MnVtuberAppearance,
  MnVtuberCameraFrame,
  MnVtuberExpressionPreset,
  MnVtuberStatusDetail,
} from './mn-vtuber/types.js'

export interface RenderPortraitOptions {
  /** Absolute path to a .vrm file on disk. Mutually exclusive with
   * `modelUrl` — served same-origin from the harness's own throwaway dev
   * server, since a real browser won't `fetch()` an arbitrary file:// path. */
  modelPath?: string
  /** A URL the headless page can fetch directly, bypassing the file-serving
   * middleware. Mutually exclusive with `modelPath`. */
  modelUrl?: string
  appearance?: MnVtuberAppearance
  expression?: MnVtuberExpressionPreset
  cameraFrame?: MnVtuberCameraFrame
  size?: { width: number; height: number }
}

export interface RenderPortraitResult {
  png: Uint8Array
  sha256: string
  width: number
  height: number
  /** The component's own terminal status detail, verbatim — distinguishes a
   * real VRM load (`status: 'ready'`, `stats` present) from the procedural
   * fallback rig (`status: 'fallback' | 'error'`, `stats` undefined). */
  status: MnVtuberStatusDetail
}

interface MirrorHarnessConfig {
  modelUrl: string
  appearance?: MnVtuberAppearance
  expression?: MnVtuberExpressionPreset
  cameraFrame?: MnVtuberCameraFrame
  width: number
  height: number
}

// NOTE: deliberately node:path + fileURLToPath(import.meta.url), NOT
// `new URL('./mirror-harness/', import.meta.url)`. The global `URL` this
// package's tests run under (happy-dom, for the DOM-mounting suites) shadows
// the ambient constructor and resolves a relative URL against its fake
// `http://localhost/` document location instead of a `file:` base — silently
// wrong, not an error, so it has to be avoided rather than caught.
const HARNESS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'mirror-harness')
const MODEL_ROUTE = '/__mirror-model__'
const DEFAULT_SIZE = { width: 512, height: 640 }
const READY_TIMEOUT_MS = 30_000

export async function renderPortrait(opts: RenderPortraitOptions): Promise<RenderPortraitResult> {
  if (!opts.modelPath && !opts.modelUrl) {
    throw new Error('renderPortrait: one of modelPath or modelUrl is required')
  }
  if (opts.modelPath && opts.modelUrl) {
    throw new Error('renderPortrait: modelPath and modelUrl are mutually exclusive')
  }
  const { width, height } = opts.size ?? DEFAULT_SIZE

  // Lazy — see the module doc. Nothing above this line touches either package.
  const [{ createServer }, { chromium }] = await Promise.all([
    import('vite'),
    import('playwright'),
  ])

  const server = await createServer({
    configFile: false,
    root: HARNESS_DIR,
    clearScreen: false,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    // Registering the model route via server.middlewares.use() AFTER
    // createServer() resolves lands it AFTER Vite's own internal middlewares
    // (including its SPA history-fallback, which serves index.html for any
    // unmatched extension-less path) — so the model route would never be
    // reached. A plugin's configureServer hook runs its own `.use()` calls
    // BEFORE Vite installs its internal middlewares, which is what actually
    // gets this route matched first.
    plugins: opts.modelPath
      ? [
          {
            name: 'mirror-model-server',
            configureServer(devServer) {
              const modelPath = opts.modelPath!
              devServer.middlewares.use(MODEL_ROUTE, (_req, res) => {
                readFile(modelPath)
                  .then((bytes) => {
                    res.setHeader('content-type', 'application/octet-stream')
                    res.setHeader('cache-control', 'no-store')
                    res.end(bytes)
                  })
                  .catch((error: unknown) => {
                    res.statusCode = 404
                    res.end(`renderPortrait: could not read modelPath ${modelPath}: ${String(error)}`)
                  })
              })
            },
          },
        ]
      : [],
  })

  await server.listen()
  try {
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') {
      throw new Error('renderPortrait: vite dev server did not report a TCP address')
    }
    const baseUrl = `http://127.0.0.1:${address.port}/`

    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
      const page = await context.newPage()

      let resolveReady!: (detail: MnVtuberStatusDetail) => void
      let rejectReady!: (error: Error) => void
      const ready = new Promise<MnVtuberStatusDetail>((res, rej) => {
        resolveReady = res
        rejectReady = rej
      })
      await page.exposeFunction('__mirrorReport', (detail: MnVtuberStatusDetail) => resolveReady(detail))
      page.on('pageerror', (error) => rejectReady(new Error(`renderPortrait: harness page error: ${error.message}`)))

      const harnessConfig: MirrorHarnessConfig = {
        modelUrl: opts.modelPath ? MODEL_ROUTE : opts.modelUrl!,
        appearance: opts.appearance,
        expression: opts.expression,
        cameraFrame: opts.cameraFrame,
        width,
        height,
      }
      await page.addInitScript((injected) => {
        ;(window as unknown as { __mirrorConfig: unknown }).__mirrorConfig = injected
      }, harnessConfig)

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

      let timeoutHandle!: ReturnType<typeof setTimeout>
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`renderPortrait: timed out after ${READY_TIMEOUT_MS}ms waiting for mn-vtuber to reach a terminal status (model: ${harnessConfig.modelUrl})`)),
          READY_TIMEOUT_MS,
        )
      })
      const status = await Promise.race([ready, timeout])
      // Successful races leave the timer live otherwise — clear it so it
      // can't hold the process open or paper over cleanup issues.
      clearTimeout(timeoutHandle)

      const screenshot = await page.screenshot({ type: 'png' })
      const png = Uint8Array.from(screenshot)
      const sha256 = createHash('sha256').update(screenshot).digest('hex')
      const dims = pngDimensions(png) ?? { width, height }

      return { png, sha256, width: dims.width, height: dims.height, status }
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}

/** Minimal IHDR read — the same technique glb-inspect.ts uses for embedded
 * VRM thumbnail PNGs, duplicated here (not imported) so this module's only
 * cross-file dependency stays the mn-vtuber types. Gives an honest width /
 * height straight from the bytes we're about to hand back, rather than
 * trusting the requested size blindly. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24) return null
  for (let i = 0; i < signature.length; i++) if (bytes[i] !== signature[i]) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
}
