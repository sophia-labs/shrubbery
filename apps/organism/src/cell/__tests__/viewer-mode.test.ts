/**
 * Viewer mode (NO MOCKS): the shell's read-only projection for a hosted graph shared as a Viewer, and the
 * Viewer-rooms probe through the real GatewayTransport against a gateway twin that speaks the cell's `/health`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus'
import { GatewayHttpError, GatewayTransport } from '../gateway-transport.js'
import { resolveHostedEntry } from '../hosted-entry-route.js'
import {
  isViewerRoomsUnsupported,
  probeViewerRooms,
  viewerDocumentAccess,
  viewerDropRefusal,
  viewerRoomsMessage,
  viewerRoomsSupportFromHealth,
  viewerSidebarRefusal,
} from '../viewer-mode.js'

class TestAuth implements AuthProvider {
  token(): string { return 'viewer-token' }
  userId(): string { return 'user:viewer' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => undefined }
}

/** A gateway twin: GET /graphs lists one Viewer graph; the graph route answers the cell's /health. */
function gatewayTwin(health: unknown, status = 200) {
  const urls: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    urls.push(url.pathname)
    if (url.pathname === '/graphs') {
      return Response.json([{ owner: 'user:vera', graphId: 'shared', title: 'Shared', lifecycleState: 'active', role: 'viewer' }])
    }
    if (url.pathname === '/o/user%3Avera/g/shared/health') return Response.json(health, { status })
    return Response.json({ error: 'unhandled' }, { status: 404 })
  })
  const gateway = new GatewayTransport({ gatewayBaseUrl: 'https://gateway.test', auth: new TestAuth(), fetch: fetch as typeof globalThis.fetch })
  return { gateway, urls }
}

describe('viewer mode', () => {
  it('opens every document view-only with no Make Editable', () => {
    expect(viewerDocumentAccess()).toEqual({ readOnly: true, makeEditable: false, readOnlyLabel: 'View only' })
  })

  it('refuses every tree action that writes, with a notice, and lets refresh through', () => {
    expect(viewerSidebarRefusal({ action: 'refresh' })).toBeNull()
    for (const action of ['new-document', 'new-workflow', 'new-whiteboard', 'upload', 'new-folder', 'node-menu', 'rename', 'move', 'delete'] as const) {
      expect(viewerSidebarRefusal({ action })).toBe('You can view this graph. Only its owner and editors can change it.')
    }
    expect(viewerDropRefusal()).toContain('Only its owner and editors')
  })

  it('opens a Viewer graph asked for by path or ?graph=, instead of refusing it', async () => {
    const graphs = [{ graphId: 'shared', title: 'Shared', role: 'viewer' as const, cellState: 'running' as const }]
    await expect(resolveHostedEntry({ location: new URL('https://garden.test/g/shared'), loadGraphs: async () => graphs }))
      .resolves.toEqual({ kind: 'graph', graphId: 'shared' })
    await expect(resolveHostedEntry({ location: new URL('https://garden.test/?graph=shared'), loadGraphs: async () => graphs }))
      .resolves.toEqual({ kind: 'graph', graphId: 'shared' })
  })

  it('reads Viewer-room support from a cell /health answer', () => {
    expect(viewerRoomsSupportFromHealth({ status: 'ok', capabilities: ['viewer-rooms-v1'] })).toBe('supported')
    expect(viewerRoomsSupportFromHealth({ status: 'ok' })).toBe('unsupported')
    expect(viewerRoomsSupportFromHealth({ status: 'ok', capabilities: [] })).toBe('unsupported')
    expect(viewerRoomsSupportFromHealth({ code: 'graph_activating' })).toBe('unknown')
    expect(viewerRoomsSupportFromHealth(null)).toBe('unknown')
  })

  it('probes the cell /health through the owner-qualified graph route', async () => {
    const old = gatewayTwin({ status: 'ok' })
    await old.gateway.graphs()
    await expect(probeViewerRooms(() => old.gateway.getJson('shared', '/health'))).resolves.toBe('unsupported')
    expect(old.urls).toEqual(['/graphs', '/o/user%3Avera/g/shared/health'])

    const fixed = gatewayTwin({ status: 'ok', capabilities: ['viewer-rooms-v1'] })
    await fixed.gateway.graphs()
    await expect(probeViewerRooms(() => fixed.gateway.getJson('shared', '/health'))).resolves.toBe('supported')

    const down = gatewayTwin({ error: 'unavailable' }, 503)
    await down.gateway.graphs()
    await expect(probeViewerRooms(() => down.gateway.getJson('shared', '/health'))).resolves.toBe('unknown')
  })

  it('turns the gateway\'s 403 viewer_rooms_unsupported into the plan\'s words, and nothing else', () => {
    const refused = new GatewayHttpError('GET', 'https://gateway.test/o/user%3Avera/g/shared/hocuspocus/docs/shared/d', 403, '{"error":"viewer_rooms_unsupported"}')
    expect(isViewerRoomsUnsupported(refused)).toBe(true)
    expect(viewerRoomsMessage(refused)).toBe('This graph\'s engine is being updated; viewers can open it soon.')
    expect(viewerRoomsMessage(refused.message)).toBe('This graph\'s engine is being updated; viewers can open it soon.')
    expect(isViewerRoomsUnsupported(new GatewayHttpError('GET', 'https://gateway.test/x', 403, '{"error":"forbidden"}'))).toBe(false)
    expect(isViewerRoomsUnsupported(new GatewayHttpError('GET', 'https://gateway.test/x', 500, 'viewer_rooms_unsupported'))).toBe(false)
    expect(viewerRoomsMessage('graph not found')).toBeNull()
    expect(viewerRoomsMessage(null)).toBeNull()
  })
})
