import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const feedRoot = resolve(process.env.SOPHIA_KOREADER_FEED_DIR ?? join(appRoot, 'dist', 'feed'))
const port = positiveInteger(process.env.PORT, 8787)
const host = process.env.HOST ?? '0.0.0.0'

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const rawPath = requestUrl.pathname === '/' ? '/index.xhtml' : requestUrl.pathname
    const decoded = decodeURIComponent(rawPath)
    const normalized = normalize(decoded).replace(/^[/\\]+/, '')
    const candidate = resolve(feedRoot, normalized)
    const relation = relative(feedRoot, candidate)
    if (relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Forbidden\n')
      return
    }
    const metadata = await stat(candidate)
    if (!metadata.isFile()) throw new Error('not a file')
    const body = await readFile(candidate)
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { etag })
      response.end()
      return
    }
    response.writeHead(200, {
      'content-type': contentType(candidate),
      'content-length': body.byteLength,
      'cache-control': 'private, max-age=0, must-revalidate',
      etag,
    })
    if (request.method === 'HEAD') response.end()
    else response.end(body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found\n')
  }
})

server.listen(port, host, () => {
  console.log(`Serving ${feedRoot}`)
  console.log(`Manifest: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/manifest.json`)
})

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? Number.NaN : Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json':
      return 'application/json; charset=utf-8'
    case '.xhtml':
      return 'application/xhtml+xml; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

