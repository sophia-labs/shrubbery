/**
 * The tree follows the workspace: REAL INTEGRATION over a spawned gardend, no mocks.
 *
 * The page is the shell's own contract (`createGardendContract`, the self-host shape: the cell's key, a WebSocket),
 * its complete local copy (SourceMirrorRuntime, pulled with `source_pull`), and the tree read exactly as the shell
 * reads it (`loadSidebarSections` over `contract.rest`, which answers from that copy). The follower is wired as
 * `main.ts` wires it: the shared EditorRoomPool's workspace room, and `followAuthority` on each change. Another
 * writer (a second MCP client with the same key, as an agent or Sophia's chat would be) creates, renames, moves,
 * trashes and writes documents; the tree must show each tree change within seconds, and a body write must not
 * cost a pull.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket as NodeWebSocket } from 'ws'
import { EditorRoomPool } from '@shrubbery/runtime'
import type { SidebarNode } from '@shrubbery/runtime'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { loadSidebarSections, TREE_SECTION_ID } from '../src/cell/sidebar-documents.js'
import { followWorkspaceTree, treeShows, type TreeChange, type TreeExpectation } from '../src/cell/workspace-follow.js'

const GRAPH = 'shrubbery-tree-follow-it'
const GARDEN_BIN = resolveGardendBin()
const WS = NodeWebSocket as unknown as new (url: string | URL, protocols?: string | string[]) => unknown

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** The tree as the shell reads it: its nodes by id. */
async function treeNodes(contract: GardendContract): Promise<Map<string, SidebarNode>> {
  const sections = await loadSidebarSections(contract.rest, GRAPH, null)
  const nodes = new Map<string, SidebarNode>()
  const walk = (list: readonly SidebarNode[] | undefined): void => {
    for (const node of list ?? []) {
      nodes.set(node.id, node)
      walk(node.children)
    }
  }
  walk(sections.find(section => section.id === TREE_SECTION_ID)?.nodes)
  return nodes
}

/** The tree as the shell shows it: "Folder/Document" paths, sorted. */
async function treePaths(contract: GardendContract): Promise<string[]> {
  const sections = await loadSidebarSections(contract.rest, GRAPH, null)
  const tree = sections.find(section => section.id === TREE_SECTION_ID)
  const paths: string[] = []
  const walk = (nodes: readonly SidebarNode[] | undefined, prefix: string): void => {
    for (const node of nodes ?? []) {
      const path = `${prefix}${node.label}`
      if (node.kind === 'folder') walk(node.children, `${path}/`)
      else paths.push(path)
    }
  }
  walk(tree?.nodes, '')
  return paths.sort()
}

/** The shell's follow (main.ts followWorkspaceChange): a pull that begins now, the tree read again, checked. */
async function follow(contract: GardendContract, change: TreeChange): Promise<boolean> {
  await contract.sourceMirror.followAuthority(GRAPH)
  const nodes = await treeNodes(contract)
  return treeShows(change.expectations(), id => nodes.get(id) ?? null)
}

/**
 * A real HTTP front for the cell that holds every `source_pull` answer for `holdMs` after the cell gave it, so a
 * pull's copy is taken before a write that lands while the answer is held (everything else passes straight).
 */
async function pullHoldingFront(cellApiUrl: string, holdMs: number): Promise<{ readonly url: string; close(): Promise<void> }> {
  const target = new URL(cellApiUrl)
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const held = body.includes('"source_pull"')
      const upstream = httpRequest({
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: target.host },
      }, answer => {
        const parts: Buffer[] = []
        answer.on('data', chunk => parts.push(chunk as Buffer))
        answer.on('end', () => {
          const send = (): void => {
            res.writeHead(answer.statusCode ?? 502, answer.headers)
            res.end(Buffer.concat(parts))
          }
          if (held) setTimeout(send, holdMs)
          else send()
        })
      })
      upstream.on('error', error => {
        res.writeHead(502)
        res.end(String(error))
      })
      upstream.end(body)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('REAL INTEGRATION — the tree follows writes made outside the page', () => {
  let cell: GardendCell
  let page: GardendContract
  let elsewhere: LoopbackMcpClient
  let pool: EditorRoomPool
  let follows = 0
  let stop: (() => void) | null = null

  /** Wait until the tree (read from the page's local copy) satisfies `ok`; the copy must stay the source. */
  async function treeUntil(ok: (paths: string[]) => boolean, label: string, timeoutMs = 10_000): Promise<{ paths: string[]; ms: number }> {
    const started = Date.now()
    let paths: string[] = []
    while (Date.now() - started < timeoutMs) {
      expect(page.sourceMirror.bundleFor(GRAPH), 'the tree reads the local copy').toBeDefined()
      paths = await treePaths(page)
      if (ok(paths)) return { paths, ms: Date.now() - started }
      await sleep(100)
    }
    throw new Error(`${label}: the tree did not follow within ${timeoutMs} ms; it shows ${JSON.stringify(paths)}`)
  }

  const call = (name: string, args: Record<string, unknown>): Promise<unknown> => elsewhere.toolsCall(name, args)

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) {
      throw new Error(`gardend binary not found at ${GARDEN_BIN}. This test requires the real binary; set GARDEN_BIN.`)
    }
    cell = await spawnGardend()
    const transport = { mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' }
    elsewhere = new LoopbackMcpClient(transport)
    await call('create_graph', { graph_id: GRAPH, title: 'Tree follow' })
    await call('create_folder', { graphId: GRAPH, folderId: 'folder-parts', name: 'Parts' })
    await call('create_document', { graphId: GRAPH, documentId: 'doc-alpha', title: 'Alpha' })
    page = createGardendContract({ transport, crdtWebSocketPolyfill: WS })
    await page.sourceMirror.sync(GRAPH)
    pool = new EditorRoomPool(page.crdt)
  }, 60_000)

  afterAll(async () => {
    stop?.()
    pool?.destroyAll()
    if (cell) await cell.kill()
  })

  it('without following, the local copy (and so the tree) misses a write made elsewhere', async () => {
    expect(await treePaths(page)).toEqual(['Alpha'])
    await call('create_document', { graphId: GRAPH, documentId: 'doc-unseen', title: 'Unseen' })
    await sleep(1500)
    expect(await treePaths(page)).toEqual(['Alpha'])
  })

  it('following the workspace room, the tree shows a created document, then the one it had missed', async () => {
    stop = followWorkspaceTree({
      pool,
      auth: page.auth,
      graphId: GRAPH,
      onChange: change => {
        follows += 1
        return follow(page, change)
      },
      unavailable: error => { throw error },
    })
    // The room is shared: a probe lease on it says when the follower's room is in sync.
    const probe = pool.acquire({ kind: 'workspace', graphId: GRAPH }, 'probe')
    await probe.provider.whenSynced
    probe.release()
    expect(pool.snapshot().rooms.map(room => [room.kind, room.refCount])).toEqual([['workspace', 1]])

    await call('create_document', { graphId: GRAPH, documentId: 'doc-beta', title: 'Beta' })
    const { ms } = await treeUntil(paths => paths.includes('Beta'), 'create')
    expect(await treePaths(page)).toEqual(['Alpha', 'Beta', 'Unseen'])
    expect(follows).toBeGreaterThanOrEqual(1)
    expect(ms).toBeLessThan(5000)
  })

  it('a rename, a move into a folder and a trash follow', async () => {
    await call('rename', { graph_id: GRAPH, entity_type: 'document', entity_id: 'doc-beta', new_name: 'Beta (renamed)' })
    await treeUntil(paths => paths.includes('Beta (renamed)') && !paths.includes('Beta'), 'rename')
    await call('move_documents', { graphId: GRAPH, documentIds: ['doc-beta'], parentId: 'folder-parts' })
    await treeUntil(paths => paths.includes('Parts/Beta (renamed)'), 'move')
    await call('delete_document', { graphId: GRAPH, documentId: 'doc-unseen' })
    const { paths } = await treeUntil(paths => !paths.includes('Unseen'), 'trash')
    expect(paths).toEqual(['Alpha', 'Parts/Beta (renamed)'])
  })

  it('a body write is not a tree change: no follow, no pull', async () => {
    await sleep(800)
    const before = follows
    await call('write_document', { graph_id: GRAPH, document_id: 'doc-alpha', content: '# Alpha\n\nA body written elsewhere.' })
    await sleep(1500)
    expect(follows).toBe(before)
  })

  it('a stream of writes is followed write by write; a burst in one call, once', async () => {
    await sleep(800)
    let before = follows
    // gardend applies workspace writes one at a time, ~1-2 s each even when six are sent at once: each is a change
    // of its own, followed by itself (a pull of this graph takes ~0.2 s).
    await Promise.all([1, 2, 3, 4, 5, 6].map(index => call('create_document', {
      graphId: GRAPH, documentId: `doc-burst-${index}`, title: `Burst ${index}`,
    })))
    await treeUntil(paths => [1, 2, 3, 4, 5, 6].every(index => paths.includes(`Burst ${index}`)), 'stream')
    await sleep(600)
    expect(follows - before).toBeGreaterThanOrEqual(1)
    expect(follows - before).toBeLessThanOrEqual(6)
    // Six entries moved by one call land in the room together: one follow.
    await sleep(800)
    before = follows
    await call('move_documents', { graphId: GRAPH, documentIds: [1, 2, 3, 4, 5, 6].map(index => `doc-burst-${index}`), parentId: 'folder-parts' })
    await treeUntil(paths => [1, 2, 3, 4, 5, 6].every(index => paths.includes(`Parts/Burst ${index}`)), 'burst')
    await sleep(600)
    expect(follows - before).toBe(1)
  })

  it('a hidden page holds the change and follows it when shown', async () => {
    await sleep(800)
    const before = follows
    setVisibility('hidden')
    try {
      await call('create_document', { graphId: GRAPH, documentId: 'doc-hidden', title: 'While hidden' })
      await sleep(1500)
      expect(follows).toBe(before)
      expect(await treePaths(page)).not.toContain('While hidden')
    } finally {
      setVisibility('visible')
    }
    await treeUntil(paths => paths.includes('While hidden'), 'shown again')
    expect(follows).toBe(before + 1)
  })

  it('a change announced while a pull is under way is pulled again after it', async () => {
    // A second page whose pulls are answered 6 s late: its first pull's copy is taken before the write below.
    const front = await pullHoldingFront(cell.apiUrl, 6000)
    try {
      const slow = createGardendContract({
        transport: { mcpUrl: `${front.url}/mcp`, healthUrl: `${front.url}/health`, token: cell.token, origin: 'http://127.0.0.1' },
      })
      await slow.sourceMirror.sync(GRAPH)
      slow.sourceMirror.backgroundSync(GRAPH)
      await sleep(500)
      await call('create_document', { graphId: GRAPH, documentId: 'doc-mid-pull', title: 'Mid pull' })
      // The room's announcement, while the first pull is still held: it resolves once a later pull has landed.
      await slow.sourceMirror.followAuthority(GRAPH)
      expect(slow.sourceMirror.bundleFor(GRAPH), 'the second page reads its local copy').toBeDefined()
      expect(JSON.stringify(await loadSidebarSections(slow.rest, GRAPH, null))).toContain('Mid pull')
    } finally {
      await front.close()
    }
  })

  it('stopped, it follows nothing and lets go of its room lease', async () => {
    stop?.()
    stop = null
    expect(pool.snapshot().rooms).toEqual([])
    const before = follows
    await call('create_document', { graphId: GRAPH, documentId: 'doc-after', title: 'After stop' })
    await sleep(1200)
    expect(follows).toBe(before)
    expect(await treePaths(page)).not.toContain('After stop')
  })

  it('a copy that does not show the change yet is asked again until it does, from what the room says', async () => {
    // The follower above is stopped: this one alone follows. Its first answer stands for a pull that came back
    // before gardend wrote the tree's projection: no pull, so the copy still has the old tree.
    const asked: (readonly TreeExpectation[])[] = []
    let calls = 0
    const confirming = followWorkspaceTree({
      pool,
      auth: page.auth,
      graphId: GRAPH,
      confirmDelaysMs: [300, 600],
      onChange: async change => {
        calls += 1
        asked.push(change.expectations())
        if (calls === 1) {
          const nodes = await treeNodes(page)
          return treeShows(change.expectations(), id => nodes.get(id) ?? null)
        }
        return follow(page, change)
      },
    })
    try {
      const probe = pool.acquire({ kind: 'workspace', graphId: GRAPH }, 'probe-confirm')
      await probe.provider.whenSynced
      probe.release()
      await call('rename', { graph_id: GRAPH, entity_type: 'document', entity_id: 'doc-alpha', new_name: 'Alpha (asked twice)' })
      await treeUntil(paths => paths.includes('Alpha (asked twice)'), 'confirmed rename')
      await sleep(1200)
      expect(calls).toBe(2)
      expect(asked[0]).toEqual([{ id: 'doc-alpha', kind: 'document', present: true, label: 'Alpha (asked twice)', parentId: null }])
      // A trash: the room says absent.
      calls = 0
      asked.length = 0
      await call('delete_document', { graphId: GRAPH, documentId: 'doc-after' })
      await treeUntil(paths => !paths.includes('After stop'), 'confirmed trash')
      await sleep(1200)
      expect(calls).toBe(2)
      expect(asked[0]).toEqual([expect.objectContaining({ id: 'doc-after', kind: 'document', present: false })])
    } finally {
      confirming()
    }
  })
})
