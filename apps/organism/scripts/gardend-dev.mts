/**
 * gardend-dev.mts — spawn + seed a REAL gardend cell for the live organism, then
 * keep it alive so a human can run `pnpm dev` and watch the live-read.
 *
 * What it does (the proven recipe, via the shell-side spawn helper):
 *   1. spawns a real headless gardend with a fresh temp profile,
 *   2. creates the graph + seeds the real 275-triple :ux:config body,
 *   3. writes the loopback coordinates to apps/organism/.gardend-loopback.json
 *      (so vite.config.ts can read the random port + bearer SERVER-SIDE and
 *      proxy /cell/* same-origin — the token NEVER reaches browser JS),
 *   4. parks until SIGINT, then kills the cell + removes the temp profile.
 *
 * Run: pnpm gardend:dev   (then, in another terminal: pnpm dev)
 * Override binary: GARDEN_BIN=/path/to/gardend pnpm gardend:dev
 * Graph id: GARDEN_GRAPH_ID=my-graph pnpm gardend:dev   (default: organism-dev)
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import { WebSocket as NodeWebSocket } from 'ws'
import { spawnGardend, createGraphAndSeedUxConfig, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import { LoopbackCrdtBackend } from '../src/cell/loopback-crdt-backend.js'

// The Y.Doc XML fragment the live editor binds via Collaboration (mirrors
// @shrubbery/runtime's COLLAB_FIELD = 'content', collab/live-editor.ts:133).
// Inlined as a literal so this tsx script does NOT import the @shrubbery/runtime
// barrel — that pulls in the Lit-decorated editor-host, which plain tsx (no Vite
// decorator transform) cannot load ("Unsupported decorator location: field").
const COLLAB_FIELD = 'content'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORGANISM_DIR = resolve(__dirname, '..')
const LOOPBACK_OUT = join(ORGANISM_DIR, '.gardend-loopback.json')

const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const SEED_NT_PATH = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')

const GRAPH_ID = process.env.GARDEN_GRAPH_ID ?? 'organism-dev'
const SAMPLE_DOC_ID = 'doc-welcome'

// `ws` as the base WebSocket ctor (Node has no global WebSocket here; the backend
// wraps it with the bearer.<token> subprotocol).
const WS = NodeWebSocket as unknown as new (url: string | URL, protocols?: string | string[]) => unknown

const SAMPLE_PARAGRAPHS = [
  'Welcome to your local Garden cell. This is a real, live document — type freely and it syncs to the cell.',
  'Each paragraph is a block. To make a wire: press Mod+Shift+; to open the predicate menu, pick a predicate and a direction (R cycles forward / reverse / bidirectional), then Enter.',
  'In visual wire mode the cursor becomes a crosshair, this block glows as the source, and J / K move the target highlight. Enter connects; Escape cancels.',
  'Wiring is the most polemical thing Garden does — try connecting this block to another, or to a different document with Cmd+O.',
]

/**
 * Seed ONE sample document so the organism always has something to open (and to
 * exercise visual wire mode on — multiple blocks to navigate). create_document
 * materializes the TipTapDocument into :projection:workspace; then we open the
 * doc-sync room and insert a few paragraphs into the COLLAB_FIELD fragment (the
 * field the live editor binds via Collaboration). Best-effort: if the content
 * insert fails, the empty document still exists and can be typed into.
 */
async function seedSampleDoc(cell: GardendCell, graphId: string): Promise<void> {
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_document', { graphId, documentId: SAMPLE_DOC_ID, title: 'Welcome to Garden' })
  console.log(`[gardend:dev] created sample document "${SAMPLE_DOC_ID}"`)

  try {
    const backend = new LoopbackCrdtBackend({ mcpUrl: cell.mcpUrl, token: cell.token, WebSocketPolyfill: WS })
    const doc = new Y.Doc()
    const handle = backend.open({ kind: 'doc', graphId, docId: SAMPLE_DOC_ID }, doc)
    await Promise.race([
      handle.whenSynced,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sync timeout')), 12000)),
    ])
    const frag = doc.getXmlFragment(COLLAB_FIELD)
    if (frag.length === 0) {
      const els = SAMPLE_PARAGRAPHS.map((text) => {
        const p = new Y.XmlElement('paragraph')
        p.insert(0, [new Y.XmlText(text)])
        return p
      })
      frag.insert(0, els)
      // Let the update flush to the cell room before tearing the provider down.
      await new Promise((r) => setTimeout(r, 1500))
      console.log(`[gardend:dev] seeded ${els.length} paragraphs into "${SAMPLE_DOC_ID}"`)
    }
    backend.destroyAll()
  } catch (e) {
    console.warn(`[gardend:dev] sample-doc content seed skipped (${e instanceof Error ? e.message : e}); the empty doc still exists`)
  }
}

async function main(): Promise<void> {
  const seed = readFileSync(SEED_NT_PATH, 'utf8')
  console.log('[gardend:dev] spawning real gardend (fresh temp profile)…')
  const cell = await spawnGardend()
  console.log(`[gardend:dev] up: pid=${cell.pid} api=${cell.apiUrl} profile=${cell.profileDir}`)

  console.log(`[gardend:dev] seeding :ux:config of graph "${GRAPH_ID}" with the real 275-triple body…`)
  const iri = await createGraphAndSeedUxConfig(cell, GRAPH_ID, seed)
  console.log(`[gardend:dev] seeded ${iri}`)

  // Seed a sample document so the organism has something to open immediately
  // (and visual wire mode has multiple blocks to navigate).
  await seedSampleDoc(cell, GRAPH_ID)

  // Hand the coordinates to vite.config.ts (server-side only).
  writeFileSync(
    LOOPBACK_OUT,
    JSON.stringify({ apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId: GRAPH_ID }, null, 2),
  )
  console.log(`[gardend:dev] wrote ${LOOPBACK_OUT}`)
  console.log('')
  console.log('  ➜  Now run, in another terminal:  pnpm dev')
  console.log('     then pick the "gardend cell (live)" source in the organism.')
  console.log(`     graph_id = ${GRAPH_ID} · a "Welcome to Garden" doc is already seeded — open it.`)
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
