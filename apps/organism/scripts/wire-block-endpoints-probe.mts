/**
 * wire-block-endpoints-probe.mts — do real wires carry BLOCK endpoints?
 *
 * The wire-highlight chain ends at a block id. A document-level wire has no
 * block to highlight, and that is correct and expected — but it means the
 * feature's reach is exactly "how many wires are block-level". If the answer
 * were "none", fixing the attribute would light up nothing and I would have
 * declared victory over a still-dark feature.
 *
 * Eschaton's own read: document-level wires are the MAJORITY, block-level ones
 * are the minority but the information-rich ones. This checks that the
 * block-level case actually survives the round trip through gardend — that a
 * wire created with source/target blocks comes back out of the wire bundle
 * with `localBlockId` / `otherBlockId` populated, in the bare form the editor
 * matches on.
 *
 * Run:  pnpm -C apps/organism exec tsx scripts/wire-block-endpoints-probe.mts
 */

import { spawnGardend } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const GRAPH_ID = `wire-endpoints-${Date.now()}`

let cell: Awaited<ReturnType<typeof spawnGardend>> | null = null
let mcp: LoopbackMcpClient
let blockLevelResolved = 0

const call = (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  mcp.callTool(name, args) as Promise<Record<string, unknown>>

try {
  cell = await spawnGardend()
  mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })

  await call('create_graph', { graph_id: GRAPH_ID, title: 'Wire endpoint probe' })

  const source = await call('create_document', { graphId: GRAPH_ID, title: 'Source document' })
  const target = await call('create_document', { graphId: GRAPH_ID, title: 'Target document' })
  const sourceId = String(source.documentId ?? source.id ?? '')
  const targetId = String(target.documentId ?? target.id ?? '')

  await call('write_document', {
    graphId: GRAPH_ID, documentId: sourceId,
    content: '# Source\n\nA paragraph that will be the wire source.\n\nAnother paragraph.',
  })
  await call('write_document', {
    graphId: GRAPH_ID, documentId: targetId,
    content: '# Target\n\nThe paragraph the wire points at.\n\nFiller.',
  })

  // Block ids are minted by the editor/projection, so ask rather than guess.
  const sourceBlocks = await call('query_blocks', { graphId: GRAPH_ID, documentId: sourceId })
  const targetBlocks = await call('query_blocks', { graphId: GRAPH_ID, documentId: targetId })
  // query_blocks nests its rows under results[].blocks, NOT a top-level
  // `blocks`. The first draft read payload.blocks, got undefined, wired two
  // EMPTY block ids, and then reported "no wire carries a block endpoint" —
  // a confident finding about the system that was entirely about the probe.
  const firstParagraph = (payload: Record<string, unknown>): string => {
    const results = (payload.results ?? []) as Record<string, unknown>[]
    const blocks = (results[0]?.blocks ?? payload.blocks ?? []) as Record<string, unknown>[]
    const paragraph = blocks.find(block => String(block.type ?? '') === 'paragraph')
    const chosen = paragraph ?? blocks[1] ?? blocks[0]
    return String(chosen?.block_id ?? chosen?.blockId ?? '')
  }
  const sourceBlockId = firstParagraph(sourceBlocks)
  const targetBlockId = firstParagraph(targetBlocks)
  console.log(`\nsource block: ${sourceBlockId}\ntarget block: ${targetBlockId}\n`)

  await call('create_wires', {
    graphId: GRAPH_ID,
    wires: [
      // The information-rich case: both ends pinned to a block.
      {
        sourceDocumentId: sourceId, targetDocumentId: targetId,
        sourceBlockId, targetBlockId, predicate: 'supports',
      },
      // The common case: document to document, no blocks at all.
      { sourceDocumentId: sourceId, targetDocumentId: targetId, predicate: 'relatedTo' },
    ],
  })

  const wires = await call('get_wires', { graphId: GRAPH_ID, documentId: sourceId })
  const rows = (wires.outgoing ?? wires.wires ?? []) as Record<string, unknown>[]
  console.log(`── ${rows.length} outgoing wires as the cell reports them ──`)
  for (const row of rows) {
    const sb = row.source_block_id ?? row.sourceBlockId ?? null
    const tb = row.target_block_id ?? row.targetBlockId ?? null
    console.log(
      `  ${String(row.predicate ?? '?').padEnd(38)}` +
        ` sourceBlock=${String(sb ?? '—').padEnd(26)} targetBlock=${String(tb ?? '—')}`,
    )
    if (sb || tb) blockLevelResolved += 1
  }

  console.log(
    '\nblock-level wires that came back with an endpoint:',
    blockLevelResolved,
    '\n(a document-level wire reporting no blocks is CORRECT — it has none to report)',
  )
} finally {
  await cell?.kill()
  console.log('\ncell down')
}

// The probe fails when the block-level wire loses its endpoints on the round
// trip, because that is the case the whole highlight chain depends on.
if (blockLevelResolved === 0) {
  console.error(
    '\nFAILED: no wire came back carrying a block endpoint.\n'
      + 'The highlight chain resolves a block id and has nothing to resolve, so\n'
      + 'hover-highlight and highlight-on-arrival would both stay dark even with\n'
      + 'the attribute fixed. Check create_wires accepted the block ids and that\n'
      + 'get_wires projects them back.',
  )
  process.exitCode = 1
}
