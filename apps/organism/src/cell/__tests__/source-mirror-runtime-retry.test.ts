import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { AuthProvider, RestClient } from '@shrubbery/nucleus'
import {
  createProvisionalSourceBundle,
  MemoryGraphLifecycleStorage,
  MemorySourceMirrorStorage,
  sourceOperationDigest,
  type GraphLifecycleStorage,
  type SourceMirrorStorage,
  type SourceOperation,
  type SourcePushResult,
  type SourceSyncToolCaller,
} from '@shrubbery/source'
import {
  DocumentActivationManager,
  MemoryDocumentActivationStorage,
} from '../document-activation.js'
import { SourceMirrorRuntime } from '../source-mirror-runtime.js'

class FixedAuth implements AuthProvider {
  token(): string { return 'offline-retry-token' }
  userId(): string { return 'offline-retry-user' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => {} }
}

function combinedStorage(): SourceMirrorStorage & GraphLifecycleStorage {
  const mirror = new MemorySourceMirrorStorage()
  const lifecycle = new MemoryGraphLifecycleStorage()
  return {
    readMirror: key => mirror.readMirror(key),
    commitMirror: record => mirror.commitMirror(record),
    putOutbox: record => mirror.putOutbox(record),
    listOutbox: key => mirror.listOutbox(key),
    putGraphLifecycleIntent: intent => lifecycle.putGraphLifecycleIntent(intent),
    listGraphLifecycleIntents: userId => lifecycle.listGraphLifecycleIntents(userId),
  }
}

describe('SourceMirrorRuntime delivery retry', () => {
  it('retries a transient source push until the durable intent has a receipt', async () => {
    const graphId = 'retry-graph'
    const graphIncarnation = '11111111-1111-4111-8111-111111111111'
    const operation: SourceOperation = {
      kind: 'graphMetadata',
      operationId: 'retry-operation',
      title: 'Retried title',
    }
    const workspace = new Y.Doc()
    const bundle = await createProvisionalSourceBundle({
      graphId,
      graphIncarnation,
      workspaceUpdateBase64: Buffer.from(
        Y.encodeStateAsUpdate(workspace),
      ).toString('base64'),
    })
    workspace.destroy()

    let pushAttempts = 0
    const caller: SourceSyncToolCaller = {
      async callTool(name, args) {
        if (name === 'source_pull') return bundle
        if (name !== 'source_push') throw new Error(`unexpected tool ${name}`)
        pushAttempts += 1
        if (pushAttempts === 1) throw new Error('transient 503 while cell wakes')
        const pushed = args.operations as readonly SourceOperation[]
        const receipts = await Promise.all(pushed.map(async item => ({
          operationId: item.operationId,
          digest: await sourceOperationDigest(item),
          acceptedRevision: 1,
          status: 'applied' as const,
          duplicate: false,
          outcome: { outcome: 'applied' },
        })))
        const result: SourcePushResult = {
          ok: true,
          graphId,
          graphIncarnation,
          revision: 1,
          receipts,
        }
        return result
      },
    }
    const unavailable = vi.fn(async () => {
      throw new Error('live REST is not used by this proof')
    })
    const runtime = new SourceMirrorRuntime({
      auth: new FixedAuth(),
      caller,
      liveRest: {
        graphs: unavailable,
        query: unavailable,
        update: unavailable,
      } as unknown as RestClient,
      documentActivation: new DocumentActivationManager({
        storage: new MemoryDocumentActivationStorage(),
      }),
      storage: combinedStorage(),
    })
    const manager = await runtime.open(graphId)
    await manager.bootstrap(bundle)
    await manager.enqueue(operation)

    runtime.backgroundSync(graphId)

    await vi.waitFor(() => {
      expect(pushAttempts).toBe(2)
      expect(manager.get().pending).toBe(0)
      expect(manager.outboxRecords()).toEqual([
        expect.objectContaining({
          status: 'applied',
          attempts: 2,
          operation,
        }),
      ])
    }, { timeout: 2_000, interval: 25 })
  })

  it('retries a transient first pull until proactive hydration is complete', async () => {
    const graphId = 'first-pull-retry-graph'
    const graphIncarnation = '22222222-2222-4222-8222-222222222222'
    const workspace = new Y.Doc()
    const bundle = await createProvisionalSourceBundle({
      graphId,
      graphIncarnation,
      workspaceUpdateBase64: Buffer.from(
        Y.encodeStateAsUpdate(workspace),
      ).toString('base64'),
    })
    workspace.destroy()

    let pullAttempts = 0
    const caller: SourceSyncToolCaller = {
      async callTool(name) {
        if (name !== 'source_pull') throw new Error(`unexpected tool ${name}`)
        pullAttempts += 1
        if (pullAttempts === 1) throw new Error('transient 503 while cell wakes')
        return bundle
      },
    }
    const unavailable = vi.fn(async () => {
      throw new Error('live REST is not used by this proof')
    })
    const runtime = new SourceMirrorRuntime({
      auth: new FixedAuth(),
      caller,
      liveRest: {
        graphs: unavailable,
        query: unavailable,
        update: unavailable,
      } as unknown as RestClient,
      documentActivation: new DocumentActivationManager({
        storage: new MemoryDocumentActivationStorage(),
      }),
      storage: combinedStorage(),
    })
    const manager = await runtime.open(graphId)
    expect(manager.get().complete).toBe(false)

    runtime.backgroundSync(graphId)

    await vi.waitFor(() => {
      expect(pullAttempts).toBe(2)
      expect(manager.get()).toMatchObject({
        phase: 'complete',
        complete: true,
        graphIncarnation,
      })
    }, { timeout: 2_000, interval: 25 })
  })
})
