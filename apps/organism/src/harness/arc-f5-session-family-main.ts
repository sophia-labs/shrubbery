/**
 * Dev-only Arc F5 receipt page. It mounts the production `agent.session-family`
 * Face through the production registry/broker/interpreter and the real
 * QueryBlockService -> LoopbackRestClient -> same-origin gardend MCP path.
 */
import '@shrubbery/tokens/tokens.css'
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import { makeQueryBlockService } from '@shrubbery/runtime'
import {
  createAgentSessionFamilyFace,
  createAgentSessionFamilyResourceAdapter,
  FaceRegistry,
  LayoutInterpreter,
  LayoutResourceBroker,
  type ShAgentSessionFamilyView,
} from '@shrubbery/runtime/layout'
import { applySkinTheme } from '@shrubbery/tokens'
import { LoopbackRestClient } from '../cell/gardend-contract.js'
import { LoopbackMcpClient } from '../cell/loopback-mcp.js'

applySkinTheme({ skin: 'garden', theme: 'light' })

const root = document.querySelector<HTMLElement>('#arc-f5-session-family-root')
if (!root) throw new Error('Arc F5 family harness root is missing')

const graphId = window.__arcF5SessionFamilyCoordinates?.graphId.trim() ?? ''
const parentSessionIri = window.__arcF5SessionFamilyCoordinates?.parentSessionIri.trim() ?? ''
if (!graphId || !parentSessionIri) {
  throw new Error('Arc F5 family harness requires injected graph and parent coordinates')
}

const mcp = new LoopbackMcpClient({ mcpUrl: '/cell/mcp', healthUrl: '/cell/health' })
const service = makeQueryBlockService(new LoopbackRestClient(mcp))
const registry = new FaceRegistry()
registry.register(createAgentSessionFamilyFace())
registry.seal()
const broker = new LayoutResourceBroker()
broker.registerAdapter(createAgentSessionFamilyResourceAdapter(service))
const interpreter = new LayoutInterpreter(root, { registry, broker })

const layout: LayoutDocument = {
  schemaVersion: 1,
  layoutId: 'arc-f5-session-family-receipt',
  scope: 'workspace',
  graphId,
  rootNodeId: 'family',
  nodes: {
    family: {
      kind: 'leaf',
      id: 'family',
      descriptor: {
        schemaVersion: 1,
        faceId: 'agent.session-family',
        resource: { kind: 'graph', graphId, subjectIri: parentSessionIri },
      },
      descriptorRevision: 0,
    },
  },
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
}

try {
  await interpreter.reconcile(layout, { width: root.clientWidth, height: root.clientHeight })
  const view = root.querySelector<ShAgentSessionFamilyView>('sh-agent-session-family-view')
  if (!view) throw new Error('Arc F5 family Face did not mount')
  window.__arcF5SessionFamilyHarness = { interpreter, view }
  document.body.dataset.arcF5SessionFamilyReady = 'true'
} catch (error) {
  document.body.dataset.arcF5SessionFamilyError = error instanceof Error ? error.message : String(error)
  throw error
}

declare global {
  interface Window {
    __arcF5SessionFamilyCoordinates?: {
      readonly graphId: string
      readonly parentSessionIri: string
    }
    __arcF5SessionFamilyHarness?: {
      readonly interpreter: LayoutInterpreter
      readonly view: ShAgentSessionFamilyView
    }
  }
}
