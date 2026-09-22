/**
 * gardend-dev.mts — spawn + seed a REAL gardend cell for the live atelier, then
 * keep it alive so a human can run `pnpm dev` and watch the minimal one-text-panel
 * live-read — and prove the grow gesture by hand.
 *
 * What it does (the proven recipe, via the shell-side spawn helper):
 *   1. spawns a real headless gardend with a fresh temp profile,
 *   2. creates the graph + seeds the MINIMAL one-text-panel :ux:config body
 *      (minimalTextPanelConfig → serialize → N-Triples),
 *   3. writes the loopback coordinates to apps/atelier/.gardend-loopback.json (so
 *      vite.config.ts can read the random port + bearer SERVER-SIDE and proxy
 *      /cell/* same-origin — the token NEVER reaches browser JS),
 *   4. prints the EXACT out-of-band grow command (the additive RootEntry delta for
 *      region-top-bar) so you can watch the DOM grow under the 3s poll,
 *   5. parks until SIGINT, then kills the cell + removes the temp profile.
 *
 * Run: pnpm gardend:dev   (then, in another terminal: pnpm dev)
 * Override binary: GARDEN_BIN=/path/to/gardend pnpm gardend:dev
 */

import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  minimalTextPanelConfig,
  grownTextPanelConfig,
  serializeConfigToTriples,
  triplesToNT,
  uxConfigGraphIri,
} from '@shrubbery/nucleus'
import { spawnGardend, createGraphAndSeedUxConfig } from '../src/cell/spawn-gardend.js'
import { growDeltaNT } from '../tests/grow-delta.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ATELIER_DIR = resolve(__dirname, '..')
const LOOPBACK_OUT = join(ATELIER_DIR, '.gardend-loopback.json')

const GRAPH_ID = process.env.GARDEN_GRAPH_ID ?? 'atelier-dev'

async function main(): Promise<void> {
  const seedNT = triplesToNT(serializeConfigToTriples(minimalTextPanelConfig()))
  console.log('[gardend:dev] spawning real gardend (fresh temp profile)…')
  const cell = await spawnGardend()
  console.log(`[gardend:dev] up: pid=${cell.pid} api=${cell.apiUrl} profile=${cell.profileDir}`)

  console.log(`[gardend:dev] seeding minimal one-text-panel :ux:config of graph "${GRAPH_ID}"…`)
  const iri = await createGraphAndSeedUxConfig(cell, GRAPH_ID, seedNT)
  console.log(`[gardend:dev] seeded ${iri}`)

  // Hand the coordinates to vite.config.ts (server-side only).
  writeFileSync(
    LOOPBACK_OUT,
    JSON.stringify(
      { apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId: GRAPH_ID },
      null,
      2,
    ),
  )
  console.log(`[gardend:dev] wrote ${LOOPBACK_OUT}`)

  // The exact out-of-band grow write, as a copy-pasteable curl, so a human can
  // watch the DOM grow live under the 3s poll. This is the SAME admitted literal
  // rdf_load form the seed uses, with only the additive RootEntry delta as the body.
  const delta = growDeltaNT(minimalTextPanelConfig(), grownTextPanelConfig())
  const grow = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'rdf_load',
      arguments: {
        graphId: GRAPH_ID,
        data: delta,
        format: 'application/n-triples',
        targetGraphIri: uxConfigGraphIri(GRAPH_ID),
      },
    },
  }
  console.log('')
  console.log('  ➜  Now run, in another terminal:  pnpm dev   (then open http://localhost:5181)')
  console.log('     You will see ONE text region, no chrome.')
  console.log('')
  console.log('  ➜  To GROW it (a top bar appears within ≤3s, no UI action), run:')
  console.log(
    `     curl -s -X POST ${cell.mcpUrl} -H 'Authorization: Bearer ${cell.token}' ` +
      `-H 'Content-Type: application/json' -d '${JSON.stringify(grow)}'`,
  )
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
