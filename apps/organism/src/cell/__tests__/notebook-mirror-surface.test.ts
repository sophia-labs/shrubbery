/** Same-graph mirror notifications must not manufacture a Surface remount. No network or source writes. */
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { AuthProvider, RestClient } from '@shrubbery/nucleus'
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import { createProvisionalSourceBundle, type SourceBundle } from '@shrubbery/source'
import { createStatScalarFace, defineWorkspaceSurfaceElement, createRawTextQueryResolver, type WorkspaceSurfaceElement } from '@shrubbery/runtime/layout'
import { createQueryHandleResourceAdapter } from '../../../../../packages/runtime/src/layout/faces/query-handle-resource-adapter.js'
import type { QueryBlockService } from '@shrubbery/runtime'
import { DocumentActivationManager, MemoryDocumentActivationStorage } from '../document-activation.js'
import { SourceMirrorRuntime } from '../source-mirror-runtime.js'
import { offlineWorkspaceOverlay, offlineWorkspaceOverlayKey } from '../offline-workspace-overlay.js'

const graphId = 'notebook-mirror-local-fixture'
let sequence = 0
const elements: HTMLElement[] = []
afterEach(async () => { elements.splice(0).forEach(element => element.remove()); await Promise.resolve() })
class FixtureAuth implements AuthProvider {
  subject = 'fixture-a'; authenticated = true
  token() { return undefined }
  userId() { return this.subject }
  isAuthenticated() { return this.authenticated }
  whenReady() { return Promise.resolve() }
  onChange() { return () => {} }
}
async function fixture() {
  const workspace = new Y.Doc()
  const bundle = await createProvisionalSourceBundle({ graphId, graphIncarnation: '11111111-1111-4111-8111-111111111111', workspaceUpdateBase64: Buffer.from(Y.encodeStateAsUpdate(workspace)).toString('base64') })
  workspace.destroy()
  let next: SourceBundle | Error = bundle
  const auth = new FixtureAuth()
  const runtime = new SourceMirrorRuntime({ auth, documentActivation: new DocumentActivationManager({ storage: new MemoryDocumentActivationStorage() }),
    caller: { async callTool(name) { if (name !== 'source_pull') throw new Error('ReadOnlyFixture'); if (next instanceof Error) throw next; return next } },
    liveRest: { async graphs() { throw new Error('NoGraphDirectory') }, async update() { throw new Error('NoSourceMutation') },
      async query() { return { resultType: 'solutions', variables: ['value'], rows: [{ value: '"7"' }] } } } as RestClient,
  })
  const manager = await runtime.open(graphId)
  return { auth, runtime, manager, bundle, next(value: SourceBundle | Error) { next = value } }
}

describe('notebook mirror → WorkspaceSurface resource identity', () => {
  it('retains a mounted face on same-graph pulling/complete/error while preserving the real error', async () => {
    const { runtime, manager, next } = await fixture()
    await manager.pull()
    const initialService = runtime.surfaceQueryService(graphId)
    let mounts = 0, disposals = 0
    const face = createStatScalarFace()
    const tag = `notebook-mirror-surface-${++sequence}`
    defineWorkspaceSurfaceElement(tag, [], {
      faces: [{ ...face, async mount(context) {
        mounts++; const view = await face.mount(context)
        return { ...view, dispose(reason) { disposals++; return view.dispose(reason) } }
      } }],
      createAdapters: resolve => [createQueryHandleResourceAdapter(face.resourceAdapterId, { run(g, q, n) { return (resolve() as QueryBlockService).run(g, q, n) } }, createRawTextQueryResolver())],
    })
    const documentModel: LayoutDocument = { schemaVersion: 1, layoutId: 'notebook-mirror-test', scope: 'session', graphId, rootNodeId: 'stat', createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z', nodes: {
      stat: { kind: 'leaf', id: 'stat', descriptorRevision: 0, descriptor: { schemaVersion: 1, faceId: 'stat.scalar', resource: { kind: 'query', graphId, queryId: 'SELECT (7 AS ?value) WHERE {}' }, params: { label: 'Synthetic result' } } },
    } }
    const surface = document.createElement(tag) as WorkspaceSurfaceElement
    elements.push(surface); document.body.append(surface)
    const draw = () => { surface.model = { build: () => ({ document: documentModel, bindings: new Map(), metadata: null, engineService: runtime.surfaceQueryService(graphId) }) } }
    draw(); await surface.whenReady()
    const first = surface.querySelector('sh-stat-scalar-view')
    expect(first).not.toBeNull()
    expect(mounts).toBe(1)
    const identities: QueryBlockService[] = []
    const stop = runtime.subscribe(() => { identities.push(runtime.surfaceQueryService(graphId)); draw() })
    await manager.pull(); await surface.whenReady()
    next(new Error('SyntheticSourceTemporarilyUnavailable'))
    await expect(manager.pull()).rejects.toThrow('SyntheticSourceTemporarilyUnavailable'); await surface.whenReady()
    stop()
    expect(manager.get().phase).toBe('error')
    expect(manager.get().error).toContain('SyntheticSourceTemporarilyUnavailable')
    expect(identities.length).toBeGreaterThanOrEqual(4)
    const observation = { sameService: identities.every(service => service === initialService), sameView: surface.querySelector('sh-stat-scalar-view') === first, mounts, disposals }
    expect(observation, JSON.stringify(observation))
      .toEqual({ sameService: true, sameView: true, mounts: 1, disposals: 0 })
  })

  it('invalidates on actual epoch, overlay, subject, graph and auth-state boundaries', async () => {
    const { runtime, manager, bundle, auth, next } = await fixture()
    await manager.pull()
    const original = runtime.surfaceQueryService(graphId)
    next({ ...bundle, epoch: 'fixture-epoch-2' })
    await manager.pull()
    const revised = runtime.surfaceQueryService(graphId)
    expect(revised).not.toBe(original)
    await manager.enqueue({ kind: 'graphMetadata', operationId: 'fixture-overlay-change', title: 'Local test-only overlay' })
    const overlay = runtime.surfaceQueryService(graphId)
    expect(overlay).not.toBe(revised)
    expect(offlineWorkspaceOverlayKey(bundle, manager.outboxRecords())).toBe(offlineWorkspaceOverlay(bundle, manager.outboxRecords()).key)
    expect(offlineWorkspaceOverlayKey(bundle, manager.outboxRecords())).not.toBe(offlineWorkspaceOverlayKey(bundle, []))
    expect(runtime.surfaceQueryService(`${graphId}-other`)).not.toBe(overlay)
    auth.subject = 'fixture-b'
    const other = runtime.surfaceQueryService(graphId)
    expect(other).not.toBe(overlay)
    auth.authenticated = false
    expect(runtime.surfaceQueryService(graphId)).not.toBe(other)
  })

  it('keeps live fallback identity through repeated failed initial hydration without suppressing retries', async () => {
    const { runtime, manager, next } = await fixture()
    const original = runtime.surfaceQueryService(graphId)
    next(new Error('SyntheticSourceUnavailable'))
    for (let index = 0; index < 3; index++) {
      await expect(manager.pull()).rejects.toThrow('SyntheticSourceUnavailable')
      expect(runtime.surfaceQueryService(graphId)).toBe(original)
    }
    expect(manager.get().complete).toBe(false)
    expect(manager.get().phase).toBe('error')
  })

  it('rejects a corrupt manifest without replacing cached testimony; a valid new manifest/epoch invalidates', async () => {
    const { runtime, manager, bundle, next } = await fixture()
    await manager.pull()
    const original = runtime.surfaceQueryService(graphId)
    next({ ...bundle, manifest: { ...bundle.manifest, sourceManifestHash: '0'.repeat(64) } })
    await expect(manager.pull()).rejects.toThrow(/manifest/i)
    expect(runtime.surfaceQueryService(graphId)).toBe(original)
    expect(manager.bundle()?.manifest.sourceManifestHash).toBe(bundle.manifest.sourceManifestHash)
    const revised = await createProvisionalSourceBundle({ graphId, graphIncarnation: bundle.graphIncarnation, workspaceUpdateBase64: bundle.workspace.updateBase64, title: 'Changed authoritative fixture content' })
    expect(revised.manifest.sourceManifestHash).not.toBe(bundle.manifest.sourceManifestHash)
    next({ ...revised, epoch: 'fixture-content-epoch-2' })
    await manager.pull()
    expect(runtime.surfaceQueryService(graphId)).not.toBe(original)
  })

  it('an incarnation mismatch fences the old snapshot and rotates the service instead of hiding the fault', async () => {
    const { runtime, manager, bundle, next } = await fixture()
    await manager.pull()
    const original = runtime.surfaceQueryService(graphId)
    const otherLife = await createProvisionalSourceBundle({ graphId, graphIncarnation: '22222222-2222-4222-8222-222222222222', workspaceUpdateBase64: bundle.workspace.updateBase64 })
    next(otherLife)
    await expect(manager.pull()).rejects.toThrow(/incarnation/i)
    expect(manager.get().fenced).toBe(true)
    expect(runtime.bundleFor(graphId)).toBeUndefined()
    expect(runtime.surfaceQueryService(graphId)).not.toBe(original)
  })
})
