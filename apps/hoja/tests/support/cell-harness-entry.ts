/**
 * Browser entry for scripts/hoja-cell-harness.mts: the real Hoja app and the
 * real CellStore, bound to a real gardend cell through the harness's Vite
 * proxy (which only adds the loopback token and optional fault injection).
 */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/hoja'
import '@shrubbery/components/top-bar'
import { type GatewayGraphInfo, GatewayHttpError, GatewayMcpError, type GatewayMcpResult } from '@shrubbery/source/gateway'
import { CellStore } from '../../src/cell-store.js'
import { HojaApp } from '../../src/hoja-app.js'

const graphs = await (await fetch('/__cell/graphs')).json() as GatewayGraphInfo[]
let nextId = 1
// The app's unload-keepalive seam (absent before the 2026-09-23 fixes).
const unloadModule = '/src/unload.ts'
const unload = await import(/* @vite-ignore */ unloadModule).catch(() => null) as null | { withUnloadKeepalive(init: RequestInit): RequestInit }

async function toolsCall(_graphId: string, name: string, args: Readonly<Record<string, unknown>>): Promise<GatewayMcpResult> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } })
  const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body }
  const response = await fetch('/__cell/mcp', unload ? unload.withUnloadKeepalive(init) : init)
  const text = await response.text()
  if (!response.ok) throw new GatewayHttpError('POST', '/__cell/mcp', response.status, text)
  const value = JSON.parse(text) as { result?: GatewayMcpResult, error?: { code?: number, message?: string, data?: unknown } }
  if (value.error) throw new GatewayMcpError(name, value.error.code, value.error.data, value.error.message ?? 'unknown MCP error')
  return value.result!
}

const app = new HojaApp()
const params = new URL(window.location.href).searchParams
const poll = Number(params.get('pollMs'))
if (poll > 0) (app as unknown as { revisionPollMs: number }).revisionPollMs = poll
app.store = new CellStore({ gateway: { graphs: async () => graphs, toolsCall }, location: window.location, storage: window.sessionStorage })
document.getElementById('app')!.append(app)
