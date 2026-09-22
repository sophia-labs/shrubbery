/**
 * Real gardend oracle for Settings operations.
 *
 * One disposable profile exercises every backend-supported Settings route:
 * ordinary document handoff, three archive import jobs, graph duplicate, TriG
 * export, graph-archive import, restore-point capture/list, and confirmed restore.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL as NodeUrl } from 'node:url'
import { gzipSync, strToU8, zipSync } from 'fflate'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import { GardendSettingsOperations } from '../src/cell/settings-operations.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'

const GRAPH_ID = 'organism-settings-it'
const GARDEND_BIN = resolveGardendBin()

function escapeMultipartValue(value: string): string {
  return value.replace(/["\r\n]/g, character => character === '"' ? '%22' : '')
}

async function encodeMultipart(form: FormData): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = `----shrubbery-settings-${crypto.randomUUID()}`
  const chunks: Uint8Array[] = []
  const encoder = new TextEncoder()
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      chunks.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(name)}"\r\n\r\n${value}\r\n`,
      ))
      continue
    }
    chunks.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartValue(name)}"; filename="${escapeMultipartValue(value.name)}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`,
    ))
    chunks.push(new Uint8Array(await value.arrayBuffer()))
    chunks.push(encoder.encode('\r\n'))
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

/** Preserve bearer headers and multipart bytes across happy-dom -> loopback. */
const nodeCellFetch: typeof fetch = async (input, init = {}) => {
  const url = new NodeUrl(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
  const headers = new Headers(init.headers)
  let body: Uint8Array | undefined
  if (init.body instanceof FormData) {
    const multipart = await encodeMultipart(init.body)
    body = multipart.body
    headers.set('content-type', multipart.contentType)
  } else if (typeof init.body === 'string') {
    body = new TextEncoder().encode(init.body)
  }
  if (body) headers.set('content-length', String(body.byteLength))
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
    }, response => {
      const chunks: Uint8Array[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item))
          else if (value !== undefined) responseHeaders.set(name, value)
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }))
      })
    })
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(new TextEncoder().encode(value).slice(0, length), offset)
}

function tarEntry(name: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(512)
  writeAscii(header, 0, 100, name)
  writeAscii(header, 100, 8, '0000644\0')
  writeAscii(header, 108, 8, '0000000\0')
  writeAscii(header, 116, 8, '0000000\0')
  writeAscii(header, 124, 12, `${data.byteLength.toString(8).padStart(11, '0')}\0`)
  writeAscii(header, 136, 12, '00000000000\0')
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeAscii(header, 257, 6, 'ustar\0')
  writeAscii(header, 263, 2, '00')
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  const paddedSize = Math.ceil(data.byteLength / 512) * 512
  const entry = new Uint8Array(512 + paddedSize)
  entry.set(header)
  entry.set(data, 512)
  return entry
}

function graphArchive(): Uint8Array {
  const manifest = strToU8(JSON.stringify({
    version: 1,
    format: 'mnemosyne-graph-export',
    source_user_id: 'default',
    source_graph_id: 'archive-source',
    source_graph_title: 'Imported Archive Oracle',
    source_graph_description: 'Deterministic Settings integration fixture',
    includes_artifacts: false,
    files: {
      rdf: 'rdf/data.nq',
      workspace: '',
      documents_dir: 'crdt/documents/',
    },
  }))
  const rdf = strToU8('<urn:settings:subject> <urn:settings:predicate> "archive-value" <urn:mnemosyne:user:default:graph:archive-source:user:rdf> .\n')
  const entries = [tarEntry('manifest.json', manifest), tarEntry('rdf/data.nq', rdf)]
  const tar = new Uint8Array(entries.reduce((total, entry) => total + entry.byteLength, 1024))
  let offset = 0
  for (const entry of entries) {
    tar.set(entry, offset)
    offset += entry.byteLength
  }
  return gzipSync(tar)
}

function binaryPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function zipFile(name: string, entries: Record<string, Uint8Array>): File {
  return new File([binaryPart(zipSync(entries))], name, { type: 'application/zip' })
}

describe('Settings operations — real gardend', () => {
  let cell: GardendCell
  let mcp: LoopbackMcpClient

  beforeAll(async () => {
    if (!existsSync(GARDEND_BIN)) throw new Error(`gardend binary is required: ${GARDEND_BIN}`)
    cell = await spawnGardend({ bin: GARDEND_BIN })
    mcp = new LoopbackMcpClient({
      mcpUrl: cell.mcpUrl,
      healthUrl: `${cell.apiUrl}/health`,
      token: cell.token,
      origin: 'http://127.0.0.1',
    })
    await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Settings IT' })
  }, 30_000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('executes the complete backend-supported Settings action matrix against one disposable profile', async () => {
    const files: Array<readonly File[]> = [
      [new File(['# Settings File\n\nImported through Settings.\n'], 'settings-file.md', { type: 'text/markdown' })],
      [zipFile('obsidian.zip', {
        'Oracle.md': strToU8('# Obsidian Oracle\n\nLinks to [[Shared Page]].'),
        'Shared Page.md': strToU8('# Shared Page\n\nObsidian target.'),
      })],
      [zipFile('notion.zip', {
        'Notion Oracle aaaaaaaabbbbccccddddeeeeeeeeeeee.md': strToU8('# Notion Oracle\n\nNotion body.'),
        'Notion Table.csv': strToU8('Name,Status\nGarden,Ready\n'),
      })],
      [zipFile('roam.zip', {
        'roam-export.json': strToU8(JSON.stringify([{
          title: 'Roam Oracle',
          children: [{ string: 'Roam body with [[Roam Target]]' }],
        }, {
          title: 'Roam Target',
          children: [{ string: 'Target body' }],
        }])),
      })],
      [new File([binaryPart(graphArchive())], 'garden-archive.tar.gz', { type: 'application/gzip' })],
    ]
    const saved: Array<{ blob: Blob; filename: string }> = []
    const prompts = new Map<string, string>([
      ['New graph ID', 'settings-duplicate'],
      ['New graph title (optional)', 'Settings Duplicate'],
      ['Imported graph ID', 'settings-archive-import'],
      ['Imported graph title (optional)', 'Settings Archive Import'],
      ['Restore point label (optional)', 'Before Settings Restore'],
    ])
    const contract: Pick<ShrubberyContract, 'auth' | 'runtime' | 'ui'> = {
      auth: {
        token: () => cell.token,
        userId: () => 'settings-integration-user',
        isAuthenticated: () => true,
        whenReady: () => Promise.resolve(),
        onChange: () => () => undefined,
      },
      runtime: {
        mode: () => 'local',
        isGateway: () => false,
        graphBaseUrl: () => cell.apiUrl,
      },
      ui: {
        confirm: async () => true,
        icon: () => ({}) as never,
        presenceColors: [],
      },
    }
    const operations = new GardendSettingsOperations(contract, GRAPH_ID, null, 'local', {
      fetch: nodeCellFetch,
      transferOptions: {
        fetch: nodeCellFetch,
        pollIntervalMs: 25,
        jobTimeoutMs: 60_000,
      },
      pickFiles: async () => files.shift() ?? null,
      prompt: async message => prompts.get(message) ?? '',
      confirm: async () => true,
      save: (blob, filename) => saved.push({ blob, filename }),
      pollIntervalMs: 25,
      jobTimeoutMs: 60_000,
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    })

    for (const actionId of ['import-files', 'import-obsidian', 'import-notion', 'import-roam'] as const) {
      await operations.action({ sectionId: 'imports', actionId })
      expect(operations.snapshot().current, actionId).toMatchObject({ status: 'succeeded', progress: 100 })
    }

    await operations.action({ sectionId: 'graph-ops', actionId: 'export-graph' })
    expect(operations.snapshot().current).toMatchObject({ status: 'succeeded' })
    expect(saved).toHaveLength(1)
    expect(saved[0]!.filename).toBe(`${GRAPH_ID}.trig`)
    expect(await saved[0]!.blob.text()).toContain('mnemosyne')

    await operations.action({ sectionId: 'graph-ops', actionId: 'duplicate-graph' })
    expect(operations.snapshot().current).toMatchObject({
      status: 'succeeded',
      detail: expect.stringContaining('settings-duplicate'),
    })

    await operations.action({ sectionId: 'graph-ops', actionId: 'import-graph' })
    expect(operations.snapshot().current).toMatchObject({
      status: 'succeeded',
      detail: expect.stringContaining('settings-archive-import'),
    })

    await operations.ensureHistoryLoaded()
    expect(operations.snapshot().historyStatus).toBe('ready')
    await operations.action({ sectionId: 'history', actionId: 'create-restore-point' })
    expect(operations.snapshot().current).toMatchObject({ status: 'succeeded' })
    const restorePoint = operations.snapshot().restorePoints.find(point => point.label === 'Before Settings Restore')
    expect(restorePoint).toBeDefined()
    await operations.action({ sectionId: 'history', actionId: `restore-point:${restorePoint!.restorePointId}` })
    expect(operations.snapshot().current).toMatchObject({
      status: 'succeeded',
      detail: expect.stringContaining(restorePoint!.restorePointId),
    })

    const workspace = await mcp.toolsCall('get_workspace', { graph_id: GRAPH_ID }) as {
      structuredContent?: { documents?: Array<{ title?: string }> }
    }
    const titles = workspace.structuredContent?.documents?.map(document => document.title) ?? []
    expect(titles).toEqual(expect.arrayContaining([
      'settings-file',
      'Oracle',
      'Notion Oracle',
      'Roam Oracle',
    ]))

    const graphsResponse = await nodeCellFetch(`${cell.apiUrl}/graphs/catalog`, {
      headers: { Authorization: `Bearer ${cell.token}`, 'X-User-ID': 'settings-integration-user' },
    })
    expect(graphsResponse.ok).toBe(true)
    const graphPayload = await graphsResponse.json() as { graphs?: Array<{ graph_id?: string; id?: string }> } | Array<{ graph_id?: string; id?: string }>
    const graphs = Array.isArray(graphPayload) ? graphPayload : graphPayload.graphs ?? []
    const graphIds = graphs.map(graph => graph.graph_id ?? graph.id)
    expect(graphIds).toEqual(expect.arrayContaining([GRAPH_ID, 'settings-duplicate', 'settings-archive-import']))
  }, 180_000)
})
