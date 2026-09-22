/**
 * gardend-dev.mts — spawn a REAL gardend cell for the live EMPORIUM app, then keep
 * it alive so a human can run `pnpm dev` and watch the live /emporium catalogue.
 *
 * The Emporium app reads the cell's GLOBAL vocab-catalogue routes
 * (GET /emporium/vocabs + /emporium/vocab/{name}/{version}) — these are served by
 * a CURRENT release gardend regardless of any graph's :ux:config, so this script
 * does NOT need to seed a workspace config (unlike apps/organism's). It simply:
 *   1. spawns a real headless gardend with a fresh temp profile (shared spawn
 *      helper from @shrubbery/source/node — U10 migration, single source of
 *      truth; @shrubbery/organism's own copy is deprecated-in-place),
 *   2. writes the loopback coordinates to apps/emporium/.gardend-loopback.json so
 *      vite.config.ts can read the random port + bearer SERVER-SIDE and proxy
 *      /cell/* same-origin (the token NEVER reaches browser JS),
 *   3. parks until SIGINT, then kills the cell + removes the temp profile.
 *
 * Run: pnpm gardend:dev   (then, in another terminal: pnpm dev)
 * Override binary: GARDEN_BIN=/path/to/gardend pnpm gardend:dev
 *
 * NO MOCK: this spawns the REAL release binary that serves /emporium. If the
 * binary is missing the spawn helper throws a clear error (never a faked cell).
 */

import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnGardend } from '@shrubbery/source/node'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EMPORIUM_DIR = resolve(__dirname, '..')
const LOOPBACK_OUT = join(EMPORIUM_DIR, '.gardend-loopback.json')

async function main(): Promise<void> {
  console.log('[gardend:dev] spawning a CURRENT release gardend (serves /emporium; fresh temp profile)…')
  const cell = await spawnGardend()
  console.log(`[gardend:dev] up: pid=${cell.pid} api=${cell.apiUrl} profile=${cell.profileDir}`)

  // Hand the coordinates to vite.config.ts (server-side only — never browser JS).
  writeFileSync(
    LOOPBACK_OUT,
    JSON.stringify(
      { apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port },
      null,
      2,
    ),
  )
  console.log(`[gardend:dev] wrote ${LOOPBACK_OUT}`)
  console.log('')
  console.log('  ➜  Now run, in another terminal:  pnpm dev')
  console.log('     the Emporium shell reads /cell/emporium/vocabs live and renders the catalogue.')
  console.log('')
  console.log('[gardend:dev] cell is live. Ctrl-C to stop (kills the cell + removes the temp profile).')

  const shutdown = async (): Promise<void> => {
    console.log('\n[gardend:dev] shutting down…')
    try {
      if (existsSync(LOOPBACK_OUT)) unlinkSync(LOOPBACK_OUT)
    } catch {
      /* ignore */
    }
    await cell.kill()
    console.log('[gardend:dev] cell killed, profile removed. bye.')
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  // Park forever.
  await new Promise<never>(() => {})
}

main().catch(err => {
  console.error('[gardend:dev] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
