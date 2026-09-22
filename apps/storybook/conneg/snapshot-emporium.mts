/**
 * snapshot-emporium.mts — regenerate the captured-real /emporium snapshot.
 *
 * Spawns a CURRENT release gardend (via the organism's spawnGardend, which now
 * defaults to the release example binary that serves /emporium), curls the three
 * registry routes, and rewrites ./emporium-snapshot/*.json with the verbatim cell
 * output. Run when the registry changes:
 *
 *   pnpm --dir apps/storybook curl-emporium:snapshot
 *
 * This is the ONLY thing that writes the snapshot — the fixtures are real cell
 * captures, never hand-edited. NO MOCKS: a missing binary fails loudly.
 */

import { writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnGardend, resolveGardendBin } from '../../organism/src/cell/spawn-gardend.js'

const SNAP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'emporium-snapshot')

async function getJson(base: string, token: string, path: string): Promise<unknown> {
  const u = new URL(base + path)
  const lib = await import('node:http')
  return new Promise((resolveP, reject) => {
    const req = lib.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (data += c))
        res.on('end', () => (res.statusCode === 200 ? resolveP(JSON.parse(data)) : reject(new Error(`${path} → HTTP ${res.statusCode}`))))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function main(): Promise<void> {
  const bin = resolveGardendBin()
  if (!existsSync(bin)) throw new Error(`gardend release binary not found at ${bin} (set GARDEN_BIN)`)
  const cell = await spawnGardend()
  try {
    const vocabs = (await getJson(cell.apiUrl, cell.token, '/emporium/vocabs')) as {
      vocabularies?: Array<{ name: string; version: string }>
    }
    writeFileSync(resolve(SNAP_DIR, 'vocabs.json'), JSON.stringify(vocabs, null, 2) + '\n')
    for (const v of vocabs.vocabularies ?? []) {
      const pack = await getJson(cell.apiUrl, cell.token, `/emporium/vocab/${v.name}/${v.version}`)
      writeFileSync(resolve(SNAP_DIR, `vocab.${v.name}.${v.version}.json`), JSON.stringify(pack, null, 2) + '\n')
      // eslint-disable-next-line no-console
      console.log(`captured ${v.name}@${v.version}`)
    }
    // eslint-disable-next-line no-console
    console.log(`snapshot written to ${SNAP_DIR}`)
  } finally {
    await cell.kill()
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
