/**
 * seed-review-fixtures.mts — put something in the dev cell worth LOOKING at.
 *
 * `gardend:dev` seeds one document of plain paragraphs. That is the right
 * fixture for visual wire mode (several blocks to navigate) and the wrong one
 * for reviewing table styling or wire highlighting, neither of which has
 * anything to render against it.
 *
 * This adds, to the already-running dev cell:
 *   - a document containing a real TABLE with a header row and content, so the
 *     cell borders, the header tint, the left gutter and the drag grip are all
 *     on screen at once;
 *   - a second document, and a BLOCK-LEVEL wire into it, so the wires panel has
 *     a card whose hover can highlight a block and whose click can travel to
 *     one. A document-level wire is added beside it, because the two are
 *     supposed to look different: only the block-level one highlights.
 *
 * Run it AFTER `pnpm gardend:dev` is up (it reads that cell's coordinates from
 * .gardend-loopback.json) and before or during `pnpm dev`.
 *
 *   pnpm -C apps/organism exec tsx scripts/seed-review-fixtures.mts
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const ORGANISM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopback = JSON.parse(
  readFileSync(join(ORGANISM_DIR, '.gardend-loopback.json'), 'utf8'),
) as { mcpUrl: string; apiUrl: string; token: string; graphId: string }

const mcp = new LoopbackMcpClient({
  mcpUrl: loopback.mcpUrl,
  healthUrl: `${loopback.apiUrl}/health`,
  token: loopback.token,
  origin: 'http://127.0.0.1',
})
const call = (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  mcp.callTool(name, args) as Promise<Record<string, unknown>>

const graphId = loopback.graphId

const TABLE_DOC = 'doc-review-tables'
const TARGET_DOC = 'doc-review-wire-target'

await call('create_document', { graphId, documentId: TABLE_DOC, title: 'Tables — review fixture' })
// HTML, not Markdown. `write_document` parses HTML through gardend's
// html_to_tiptap, which knows <table>/<tr>/<th>/<td>; the Markdown path does
// NOT support GFM pipe tables and silently DROPS those rows — the first draft
// of this fixture wrote a pipe table and produced a document containing only
// the two paragraphs, which read in the app as "the table styling is broken"
// when nothing had ever been styled.
await call('write_document', {
  graphId,
  documentId: TABLE_DOC,
  content: [
    '<h1>Tables</h1>',
    '<p>A paragraph above the table, so the left gutter can be compared: the table should line up with THIS text, not sit further left.</p>',
    '<table>',
    '<tr><th>Predicate</th><th>Group</th><th>What it means</th></tr>',
    '<tr><td>grounds</td><td>Ground</td><td>the source is what the target rests on</td></tr>',
    '<tr><td>contradicts</td><td>Critique</td><td>the two cannot both stand</td></tr>',
    '<tr><td>flowsInto</td><td>Genesis</td><td>the source becomes the target</td></tr>',
    '</table>',
    '<p>A paragraph below, for the same comparison.</p>',
  ].join(''),
})

await call('create_document', { graphId, documentId: TARGET_DOC, title: 'Wire target — review fixture' })
await call('write_document', {
  graphId,
  documentId: TARGET_DOC,
  content: [
    '<h1>Wire target</h1>',
    '<p>Filler so the interesting block is not the first thing on screen — arriving here should SCROLL, not merely light up.</p>',
    '<p>Filler.</p>',
    '<p>Filler.</p>',
    '<p>Filler.</p>',
    '<p>Filler.</p>',
    '<p>Filler.</p>',
    '<p>THIS is the block the block-level wire points at. Arriving here should centre it and pulse once.</p>',
    '<p>Filler after, so the centring is visible.</p>',
  ].join(''),
})

/** query_blocks nests rows under results[].blocks, not a top-level `blocks`. */
async function blockIds(documentId: string): Promise<string[]> {
  const payload = await call('query_blocks', { graphId, documentId })
  const results = (payload.results ?? []) as Record<string, unknown>[]
  const blocks = (results[0]?.blocks ?? []) as Record<string, unknown>[]
  return blocks.map(block => String(block.block_id ?? block.blockId ?? '')).filter(Boolean)
}

const tableBlocks = await blockIds(TABLE_DOC)
const targetBlocks = await blockIds(TARGET_DOC)
// The paragraph above the table on one end; the marked block on the other.
const sourceBlockId = tableBlocks[1] ?? tableBlocks[0]
const targetBlockId = targetBlocks[targetBlocks.length - 2] ?? targetBlocks[targetBlocks.length - 1]

await call('create_wires', {
  graphId,
  wires: [
    {
      sourceDocumentId: TABLE_DOC,
      targetDocumentId: TARGET_DOC,
      sourceBlockId,
      targetBlockId,
      predicate: 'supports',
    },
    {
      sourceDocumentId: TABLE_DOC,
      targetDocumentId: TARGET_DOC,
      predicate: 'relatedTo',
    },
  ],
})

console.log(`
seeded into graph "${graphId}":

  ${TABLE_DOC}   — "Tables — review fixture"       (a table between two paragraphs)
  ${TARGET_DOC}  — "Wire target — review fixture"  (the far end of the wire)

  block-level wire  supports    ${sourceBlockId} -> ${targetBlockId}
  document-level    relatedTo   (no blocks — correctly highlights nothing)

Open "Tables — review fixture" and use the Wires panel.
`)
