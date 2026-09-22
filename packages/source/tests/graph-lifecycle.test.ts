import { describe, expect, it } from 'vitest'
import {
  GraphLifecycleManager,
  MemoryGraphLifecycleStorage,
  type GraphLifecycleTransport,
} from '../src/index.js'

class Transport implements GraphLifecycleTransport {
  readonly creates: string[] = []
  readonly deletes: string[] = []
  loseNextCreateAcknowledgement = false
  conflictDelete = false
  /** Rung 3 legacy regex path — a qualified phrase, no `code`. */
  codedDelete = false
  /** Rung 2 code path — a `GatewayHttpError`-SHAPED error (`.responseBody`
   *  JSON carrying `{code}`), the real production shape
   *  (`packages/source/src/gateway/gateway-transport.ts`), constructed here
   *  by hand rather than imported — existing-harness exception (master §6
   *  OQ-C5): this file's transport predates this work and is a literal
   *  object throwing literal strings, not the real `McpSourceSyncTransport`. */
  bareHttp409Delete = false

  async createGraph(request: {
    readonly graphId: string
    readonly title: string
    readonly graphIncarnation: string
    readonly operationId: string
  }) {
    this.creates.push(request.operationId)
    if (this.loseNextCreateAcknowledgement) {
      this.loseNextCreateAcknowledgement = false
      throw new Error('connection closed after commit')
    }
    return request
  }

  async deleteGraph(
    _graphId: string,
    request: { readonly expectedGraphIncarnation: string; readonly operationId: string },
  ): Promise<void> {
    this.deletes.push(request.operationId)
    if (this.conflictDelete) throw new Error('HTTP 409 stale graph incarnation')
    if (this.codedDelete) {
      const error = new Error(
        'Gateway DELETE /g/offline-graph failed with HTTP 409: {"error":"stale graph incarnation","code":"stale_graph_incarnation"}',
      ) as Error & { responseBody: string }
      error.responseBody = JSON.stringify({ error: 'stale graph incarnation', code: 'stale_graph_incarnation' })
      throw error
    }
    if (this.bareHttp409Delete) throw new Error('HTTP 409')
  }
}

describe('graph lifecycle outbox', () => {
  it('persists before delivery and retries a lost create acknowledgement with one identity', async () => {
    const storage = new MemoryGraphLifecycleStorage()
    const transport = new Transport()
    const first = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    await first.open()
    await first.enqueueCreate({
      graphId: 'offline-graph',
      graphIncarnation: '5b102b7a-0a64-45a5-a629-ad94b7d20eb7',
      operationId: 'client:create:1',
      title: 'Offline graph',
    })
    expect([...storage.intents.values()][0]).toMatchObject({ status: 'pending', attempts: 0 })

    transport.loseNextCreateAcknowledgement = true
    await first.flush()
    expect(first.records()[0]).toMatchObject({ status: 'pending', attempts: 1 })

    const cold = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    await cold.open()
    await cold.flush()
    expect(cold.records()[0]).toMatchObject({ status: 'applied', attempts: 2 })
    expect(transport.creates).toEqual(['client:create:1', 'client:create:1'])
  })

  it('keeps a stale delete conflict explicit and rejects operation-id reuse', async () => {
    const storage = new MemoryGraphLifecycleStorage()
    const transport = new Transport()
    transport.conflictDelete = true
    const manager = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    await manager.open()
    await manager.enqueueDelete({
      graphId: 'offline-graph',
      graphIncarnation: '5b102b7a-0a64-45a5-a629-ad94b7d20eb7',
      operationId: 'client:delete:1',
    })
    await manager.flush()
    expect(manager.records()[0]).toMatchObject({ status: 'conflict', attempts: 1 })
    await expect(manager.enqueueDelete({
      graphId: 'replacement',
      graphIncarnation: 'a46af6af-754d-4421-baa5-4a4a11337163',
      operationId: 'client:delete:1',
    })).rejects.toThrow('operationId client:delete:1 was reused')
  })

  it('classifies a coded fence identically to the legacy-regex-matched one (master §2.2, §6.4 coded-error sibling)', async () => {
    const storage = new MemoryGraphLifecycleStorage()
    const transport = new Transport()
    transport.codedDelete = true
    const manager = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    await manager.open()
    await manager.enqueueDelete({
      graphId: 'offline-graph',
      graphIncarnation: '5b102b7a-0a64-45a5-a629-ad94b7d20eb7',
      operationId: 'client:delete:coded',
    })
    await manager.flush()
    expect(manager.records()[0]).toMatchObject({ status: 'conflict', attempts: 1 })
  })

  it('a BARE "HTTP 409" no longer terminates the intent (master §2.2, C-D3 — deliberate behaviour change)', async () => {
    // Under the retired classifier (`/\b409\b|conflict|.../i`) this bare
    // status number alone terminated the intent as 'conflict' — the exact
    // overmatch C-D3 forbids. An unqualified status is never a
    // classification: `classifySourceFault` returns `{code: null}`,
    // `retryable(null) === true`, and the intent stays 'pending' — retried,
    // not guessed away.
    const storage = new MemoryGraphLifecycleStorage()
    const transport = new Transport()
    transport.bareHttp409Delete = true
    const manager = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    await manager.open()
    await manager.enqueueDelete({
      graphId: 'offline-graph',
      graphIncarnation: '5b102b7a-0a64-45a5-a629-ad94b7d20eb7',
      operationId: 'client:delete:bare409',
    })
    await manager.flush()
    expect(manager.records()[0]).toMatchObject({ status: 'pending', attempts: 1 })
  })

  it('rejects malformed lifecycle identities before durable acceptance', async () => {
    const storage = new MemoryGraphLifecycleStorage()
    const manager = new GraphLifecycleManager({
      userId: 'vera',
      storage,
      transport: new Transport(),
    })
    await manager.open()
    await expect(manager.enqueueCreate({
      graphId: 'offline-graph',
      graphIncarnation: 'not-a-uuid',
      operationId: 'client:create:1',
      title: 'Offline graph',
    })).rejects.toThrow('graphIncarnation must be a UUID')
    await expect(manager.enqueueCreate({
      graphId: 'offline-graph',
      graphIncarnation: '5b102b7a-0a64-45a5-a629-ad94b7d20eb7',
      operationId: 'contains whitespace',
      title: 'Offline graph',
    })).rejects.toThrow('operationId must be')
    expect(storage.intents.size).toBe(0)
  })
})
