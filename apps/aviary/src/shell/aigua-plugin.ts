/**
 * aigua-plugin.ts — SHELL-SIDE: the Vite plugin that IS AVIARY's backend.
 *
 * Three same-origin routes, and nothing else:
 *
 *   GET /graph/library.nt     the `aig:` projection of the aigua library
 *   GET /graph/ux-config.nt   the `sux:` projection of AVIARY's own layout
 *   GET /media/<relpath>      the real .wav / .png bytes, with Range support
 *
 * WHY A MIDDLEWARE AND NOT `server.fs.allow`. `fs.allow` + `/@fs/…` would serve
 * the audio, but it puts an absolute machine path in the browser's DOM and
 * gives the shell nowhere to put the projection. This middleware keeps the
 * library root a SERVER-SIDE fact: the browser only ever sees
 * `/media/samples/x.wav`, and the same route family serves the triples. Range
 * support is hand-rolled because `<audio>` seeking needs 206 responses.
 *
 * NOTHING IS COPIED. The aigua directory is read in place and never written to.
 *
 * NO SILENT FALLBACKS. A missing library root, an unreadable manifest, or a
 * traversal attempt all answer with a real status and the real message; none of
 * them answers with an empty graph or a placeholder file.
 *
 * DEPENDENCY DISCIPLINE. This module is reachable from `vite.config.ts`, so it
 * imports only node builtins and the dependency-free media-types module; the
 * RDF projection arrives as an injected `GraphProjector` (in the dev server,
 * loaded through Vite's module graph — see `graph-projector.ts`). A test can
 * inject the same real projector directly.
 */

import { createReadStream, statSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { mediaTypeOf } from './media-types.js'
import type { GraphProjector } from './graph-projector.js'

export interface AiguaPluginOptions {
  /** Absolute path to the aigua field-recording directory. */
  readonly root: string
}

const NT_CONTENT_TYPE = 'application/n-triples; charset=utf-8'
const TEXT = 'text/plain; charset=utf-8'

/** Text response with no caching — the projection must follow the directory. */
function sendText(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/** Resolve a URL path under `root`, refusing anything that escapes it.
 *  Returns null on traversal — the caller answers 403, never a guess. */
export function resolveUnderRoot(root: string, relPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(relPath)
  } catch {
    return null
  }
  if (decoded === '' || decoded.includes('\0') || isAbsolute(decoded)) return null
  const full = resolve(root, normalize(decoded))
  const prefix = root.endsWith(sep) ? root : root + sep
  return full.startsWith(prefix) ? full : null
}

/** Serve a file with HTTP Range support (audio seeking needs 206). */
function serveFile(req: IncomingMessage, res: ServerResponse, absPath: string, contentType: string): void {
  let size: number
  try {
    size = statSync(absPath).size
  } catch (e) {
    sendText(res, 404, TEXT, `AVIARY: no such media file: ${absPath}\n${String(e)}`)
    return
  }

  res.setHeader('Content-Type', contentType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-cache')

  const range = req.headers.range
  const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (match) {
    const hasStart = match[1] !== ''
    const hasEnd = match[2] !== ''
    let start = hasStart ? Number(match[1]) : 0
    let end = hasEnd ? Number(match[2]) : size - 1
    if (!hasStart && hasEnd) {
      // suffix range: `bytes=-N` → the LAST N bytes
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      return
    }
    end = Math.min(end, size - 1)
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', String(end - start + 1))
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(absPath, { start, end }).pipe(res)
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Length', String(size))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(absPath).pipe(res)
}

/** How the middleware gets at the RDF projection. Async because the dev server
 *  resolves it lazily through Vite; a test hands over the real module directly. */
export type ProjectorLoader = () => Promise<GraphProjector>

/**
 * The AVIARY backend as connect middleware — used by the Vite dev server and by
 * a test's own `node:http` server, so the browser path and the test path run
 * the SAME code. There is no test-only backend.
 */
export function aiguaMiddleware(root: string, loadProjector: ProjectorLoader) {
  return function aiguaHandler(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    const graph = path === '/graph/library.nt' ? 'library' : path === '/graph/ux-config.nt' ? 'ux' : null
    if (graph !== null) {
      loadProjector()
        .then((projector) => {
          const body = graph === 'library' ? projector.libraryNt(root) : projector.uxConfigNt()
          sendText(res, 200, NT_CONTENT_TYPE, body)
        })
        .catch((e: unknown) => {
          // 503 with the real message, never 200-with-an-empty-graph: the read
          // seam must see a genuine failure it can surface verbatim.
          sendText(res, 503, TEXT, e instanceof Error ? `${e.name}: ${e.message}` : String(e))
        })
      return
    }

    if (path.startsWith('/media/')) {
      const rel = path.slice('/media/'.length)
      const abs = resolveUnderRoot(root, rel)
      if (abs === null) {
        sendText(res, 403, TEXT, `AVIARY: refusing to serve outside the library root: ${rel}`)
        return
      }
      const type = mediaTypeOf(rel)
      if (type === null) {
        sendText(res, 415, TEXT, `AVIARY: not a media file this shell serves: ${rel}`)
        return
      }
      serveFile(req, res, abs, type)
      return
    }

    next()
  }
}

/** The Vite plugin wrapper. Warns loudly at boot when the library root is not
 *  where it was expected — a warning plus honest 503s, never a fake library. */
export function aiguaPlugin(options: AiguaPluginOptions): Plugin {
  const root = resolve(options.root)
  return {
    name: 'aviary-aigua',
    configureServer(server) {
      try {
        statSync(join(root, 'instrument.json'))
      } catch {
        server.config.logger.warn(
          `[aviary] no instrument.json under ${root} — /graph/library.nt will answer 503 with the real error. ` +
            'Set AIGUA_DIR to the aigua field-recording directory.',
        )
      }
      const loadProjector: ProjectorLoader = () =>
        server.ssrLoadModule('/src/shell/graph-projector.ts') as Promise<GraphProjector>
      server.middlewares.use(aiguaMiddleware(root, loadProjector))
    },
  }
}
