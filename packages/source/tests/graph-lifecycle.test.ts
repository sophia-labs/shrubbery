import { describe, expect, it } from 'vitest'
import {
  GatewayHttpError,
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
  /** The account is at its workspace limit: every create is refused `403 quota_exceeded`. */
  atQuota = false

  async createGraph(request: {
    readonly graphId: string
    readonly title: string
    readonly graphIncarnation: string
    readonly operationId: string
  }) {
    this.creates.push(request.operationId)
    if (this.atQuota) {
      // The gateway's real refusal (POST /graphs, 403), through the real error class.
      throw new GatewayHttpError('POST', 'https://gateway.test/graphs', 403, '{"error":"graph quota exceeded","code":"quota_exceeded"}')
    }
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

  it('keeps a create refused at the workspace limit, refused and retained, until Retry or Discard', async () => {
    const storage = new MemoryGraphLifecycleStorage()
    const transport = new Transport()
    transport.atQuota = true
    const manager = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    await manager.open()
    await manager.enqueueCreate({
      graphId: 'test-50398592',
      graphIncarnation: '5b102b7a-0a64-45a5-a629-ad94b7d20eb7',
      operationId: 'graph:create:quota',
      title: 'Test',
    })
    await manager.flush()
    expect(manager.records()[0]).toMatchObject({ status: 'conflict', errorCode: 'quota_exceeded', attempts: 1 })
    // Refused is final: a later flush (every Home load) does not send it again.
    await manager.flush()
    expect(transport.creates).toEqual(['graph:create:quota'])
    expect(storage.intents.size).toBe(1)

    // Retry, once the limit is raised: the same identity, pending, then applied.
    transport.atQuota = false
    await expect(manager.retry('graph:create:quota')).resolves.toMatchObject({ status: 'pending', errorCode: undefined })
    await manager.flush()
    expect(manager.records()[0]).toMatchObject({ status: 'applied', attempts: 2 })
    expect(transport.creates).toEqual(['graph:create:quota', 'graph:create:quota'])
    await expect(manager.discard('graph:create:quota')).rejects.toThrow('not been applied')
  })

  it('discards a refused local creation, and only that one', async () => {
    const storage = new MemoryGraphLifecycleStorage()
    const transport = new Transport()
    transport.atQuota = true
    const manager = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    await manager.open()
    for (const [operationId, graphIncarnation] of [
      ['graph:create:a', '5b102b7a-0a64-45a5-a629-ad94b7d20eb7'],
      ['graph:create:b', '6c213c8b-1b75-46b6-b73a-be05c8e31fc8'],
    ] as const) {
      await manager.enqueueCreate({ graphId: operationId.slice(-1), graphIncarnation, operationId, title: 'T' })
    }
    await manager.flush()
    await manager.discard('graph:create:a')
    expect(manager.records().map(intent => intent.operationId)).toEqual(['graph:create:b'])
    expect([...storage.intents.values()].map(intent => intent.operationId)).toEqual(['graph:create:b'])
    const cold = new GraphLifecycleManager({ userId: 'vera', storage, transport })
    expect((await cold.open()).map(intent => intent.operationId)).toEqual(['graph:create:b'])
  })
})
