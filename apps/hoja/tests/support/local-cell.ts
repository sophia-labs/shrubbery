/**
 * A real Garden cell for Hoja's regression tests: spawns `gardend` against a
 * throwaway profile and speaks MCP to its loopback server. Nothing here is a
 * stand-in for the cell — the documents, revisions, and conflicts are the
 * engine's own. Point GARDEND_BIN at a gardend binary (a garden checkout's
 * `src-tauri/target/debug/examples/gardend`); without one the cell suites skip
 * and say so.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type GatewayGraphInfo,
  GatewayMcpError,
  type GatewayMcpResult,
  gatewayMcpText,
} from '@shrubbery/source/gateway'
import type { CellStoreGateway } from '../../src/cell-store.js'

export function gardendBinary(): string | null {
  const configured = process.env.GARDEND_BIN?.trim()
  if (configured) return existsSync(configured) ? configured : null
  try {
    const found = execFileSync('which', ['gardend'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return found || null
  } catch {
    return null
  }
}

interface LoopbackManifest {
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly token: string
}

export class LocalCell {
  private nextId = 1

  private constructor(
    private readonly child: ChildProcess,
    private readonly root: string,
    readonly manifest: LoopbackManifest,
  ) {}

  static async start(binary: string): Promise<LocalCell> {
    const root = await mkdtemp(join(tmpdir(), 'hoja-cell-'))
    const profile = join(root, 'profile')
    const child = spawn(binary, [], {
      env: {
        ...process.env,
        GARDEN_PROFILE_DIR: profile,
        GARDEN_DURABLE_DIR: join(root, 'durable'),
        RUST_LOG: process.env.RUST_LOG ?? 'warn',
      },
      stdio: ['ignore', 'ignore', process.env.HOJA_CELL_LOGS === '1' ? 'inherit' : 'ignore'],
    })
    const manifestPath = join(profile, 'loopback.json')
    const deadline = Date.now() + 90_000
    for (;;) {
      if (child.exitCode !== null) throw new Error(`gardend exited early (${child.exitCode})`)
      try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as LoopbackManifest
        const cell = new LocalCell(child, root, manifest)
        const health = await fetch(`${manifest.apiUrl}/graphs`, { headers: cell.headers() })
        if (health.ok) return cell
      } catch { /* not ready yet */ }
      if (Date.now() > deadline) {
        child.kill('SIGKILL')
        throw new Error('gardend did not publish a loopback manifest within 90s')
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.manifest.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
  }

  async createGraph(graphId: string, title = graphId): Promise<GatewayGraphInfo> {
    const response = await fetch(`${this.manifest.apiUrl}/graphs`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ graph_id: graphId, title }),
    })
    if (!response.ok) throw new Error(`gardend POST /graphs ${response.status}: ${await response.text()}`)
    return { graphId, title, role: 'editor', cellState: 'running' }
  }

  /** Raw JSON-RPC tools/call, shaped like GatewayTransport.toolsCall. */
  async toolsCall(name: string, args: Readonly<Record<string, unknown>>): Promise<GatewayMcpResult> {
    const response = await fetch(this.manifest.mcpUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } }),
    })
    const body = await response.json() as { result?: GatewayMcpResult, error?: { code?: number, message?: string, data?: unknown } }
    if (body.error) throw new GatewayMcpError(name, body.error.code, body.error.data, body.error.message ?? 'unknown MCP error')
    if (!body.result) throw new Error(`gardend ${name} returned neither result nor error`)
    return body.result
  }

  /** Convenience for test assertions: the tool's JSON payload. */
  async call<T = Record<string, unknown>>(name: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    return JSON.parse(gatewayMcpText(await this.toolsCall(name, args))) as T
  }

  async markdown(graphId: string, documentId: string): Promise<string> {
    const value = await this.call<{ content: string }>('read_document', { graphId, documentId, format: 'markdown' })
    return value.content
  }

  async documentIds(graphId: string): Promise<string[]> {
    const value = await this.call<{ documents: Array<{ documentId: string }> }>('list_documents', { graphId, limit: 500 })
    return value.documents.map(row => row.documentId)
  }

  /** The CellStore seam, exactly as the hosted GatewayTransport fills it. */
  gateway(graphs: readonly GatewayGraphInfo[]): CellStoreGateway {
    return {
      graphs: async () => graphs,
      toolsCall: (_graphId, name, args) => this.toolsCall(name, args),
    }
  }

  async stop(): Promise<void> {
    if (this.child.exitCode === null) {
      const exited = new Promise(resolve => this.child.once('exit', resolve))
      this.child.kill('SIGTERM')
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 10_000))])
      if (this.child.exitCode === null) this.child.kill('SIGKILL')
    }
    await rm(this.root, { recursive: true, force: true })
  }
}

export function paragraphs(...lines: string[]): Record<string, unknown> {
  return {
    type: 'doc',
    content: lines.map(text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })),
  }
}
