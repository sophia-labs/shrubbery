// @vitest-environment node
/**
 * How the real shell learns whether a graph's cell serves Files (CONTRACT-files §1) and which incarnation its folder
 * views belong to (§7: "graphIncarnation: <from the read>"), without the offline mirror: one capabilities read, then,
 * only for a cell that advertises Files, one file-views read. Nothing else is probed. Also how the left tree's Files
 * section looks when Files is served. Over real HTTP to a server that speaks the contract.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FilePaneSection } from '@shrubbery/nucleus'
import { FilesClient } from '../files-contract.js'
import { FILES_SECTION_ACTION, FilesDiscovery, filesSidebarSections } from '../files-route.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

const servers: FilesContractServer[] = []
afterEach(async () => { for (const s of servers.splice(0)) await s.close() })

async function serve(options: Parameters<typeof startFilesContractServer>[0] = {}) {
  const server = await startFilesContractServer(options)
  servers.push(server)
  return { server, client: new FilesClient(contractFor(server), mcpFor(server)) }
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }

describe('FilesDiscovery', () => {
  it('a cell that advertises Files: one capabilities read and one file-views read, then ready with the cap and the live incarnation', async () => {
    const { server, client } = await serve({ graphIncarnation: 'inc-live-7', maxUploadBytes: 10 * 1024 * 1024 })
    let changes = 0
    const discovery = new FilesDiscovery(() => { changes += 1 })
    expect(discovery.state(client, server.graphId).status).toBe('loading')
    await settle()
    const state = discovery.state(client, server.graphId)
    expect(state).toMatchObject({ status: 'ready', graphIncarnation: 'inc-live-7', advert: { version: 1, maxUploadBytes: 10 * 1024 * 1024 } })
    expect(changes).toBeGreaterThan(0)
    expect(server.requests.map(r => `${r.method} ${r.path.split('?')[0]}`)).toEqual([
      'GET /api/capabilities', `GET /navigation/${server.graphId}/file-views`,
    ])
  })

  it('a cell older than the contract: absent after one request, nothing else probed', async () => {
    const { server, client } = await serve({ advertise: false })
    const discovery = new FilesDiscovery(() => {})
    discovery.state(client, server.graphId)
    await settle()
    expect(discovery.state(client, server.graphId)).toEqual({ status: 'absent' })
    expect(server.requests.map(r => r.path)).toEqual(['/api/capabilities'])
  })

  it('asks once per graph and client; another graph or another client is asked again', async () => {
    const { server, client } = await serve()
    const discovery = new FilesDiscovery(() => {})
    discovery.state(client, server.graphId)
    await settle()
    discovery.state(client, server.graphId)
    discovery.state(client, server.graphId)
    await settle()
    expect(server.requests.filter(r => r.path === '/api/capabilities')).toHaveLength(1)
    const other = new FilesClient(contractFor(server), mcpFor(server))
    discovery.state(other, server.graphId)
    await settle()
    expect(server.requests.filter(r => r.path === '/api/capabilities')).toHaveLength(2)
  })

  it('an unreachable cell is an error that hides Files; invalidate() lets the next ask try again', async () => {
    const { server } = await serve()
    const base = server.base
    await server.close()
    servers.splice(servers.indexOf(server), 1)
    const contract = { ...contractFor(server), runtime: { mode: () => 'hosted' as const, isGateway: () => true, graphBaseUrl: () => base } }
    const client = new FilesClient(contract, mcpFor(server))
    const discovery = new FilesDiscovery(() => {})
    discovery.state(client, 'g')
    await settle()
    expect(discovery.state(client, 'g').status).toBe('error')
    discovery.invalidate()
    expect(discovery.state(client, 'g').status).toBe('loading')
  })

  it('a file-views read that fails still serves Files, with no incarnation (the layout then cannot be saved)', async () => {
    const { server, client } = await serve({ failFileViews: true })
    const discovery = new FilesDiscovery(() => {})
    discovery.state(client, server.graphId)
    await settle()
    expect(discovery.state(client, server.graphId)).toMatchObject({ status: 'ready', graphIncarnation: '' })
  })
})

describe('FilesDiscovery never keeps a missing incarnation as a mode', () => {
  it('asks the file-views read again on a later look, and adopts the incarnation when it answers', async () => {
    const { server, client } = await serve({ failFileViews: true, graphIncarnation: 'inc-late' })
    let changes = 0
    const discovery = new FilesDiscovery(() => { changes += 1 }, { incarnationRetryMs: 0 })
    discovery.state(client, server.graphId)
    await settle()
    expect(discovery.state(client, server.graphId)).toMatchObject({ status: 'ready', graphIncarnation: '' })
    server.failFileViews = false
    discovery.state(client, server.graphId)
    await settle()
    expect(discovery.state(client, server.graphId)).toMatchObject({ status: 'ready', graphIncarnation: 'inc-late' })
    expect(server.requests.filter(r => r.path === '/api/capabilities')).toHaveLength(1)
    expect(changes).toBeGreaterThanOrEqual(2)
  })
})

describe('the Files section of the left tree', () => {
  const sections: FilePaneSection[] = [
    { id: 'tree', label: 'Workspace', icon: 'folder', nodes: [], count: 0, emptyLabel: 'Nothing here yet' },
    { id: 'tags', label: 'Tags', icon: 'tag', nodes: [] },
  ]

  it('is one tree and carries the Open Files action when the cell serves Files', () => {
    const shown = filesSidebarSections(sections, true)
    expect(shown[1]).toBe(sections[1])
    expect(shown[0]).toMatchObject({ id: 'tree', label: 'Workspace', icon: 'folder', emptyLabel: 'Nothing here yet',
      action: { id: FILES_SECTION_ACTION, label: 'Open Files' } })
  })

  it('is left exactly as it was when the cell does not', () => {
    expect(filesSidebarSections(sections, false)).toBe(sections)
  })
})
