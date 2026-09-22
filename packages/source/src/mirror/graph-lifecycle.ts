/**
 * Durable offline graph lifecycle intents.
 *
 * Graph membership lives above any one graph's source ledger, so create/delete
 * use a small control-plane outbox of their own. The graph id is a stable
 * logical name; graphIncarnation fences one lifetime of that name; operationId
 * makes at-least-once delivery converge after a lost acknowledgement.
 */

import { classifySourceFault, retryable } from './source-fault.js'

export type GraphLifecycleIntentKind = 'create' | 'delete'
export type GraphLifecycleIntentStatus = 'pending' | 'applied' | 'conflict'

export interface GraphLifecycleIntent {
  readonly key: string
  readonly userId: string
  readonly kind: GraphLifecycleIntentKind
  readonly graphId: string
  readonly graphIncarnation: string
  readonly operationId: string
  readonly title?: string
  readonly status: GraphLifecycleIntentStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly attempts: number
  readonly error?: string
}

export interface GraphLifecycleStorage {
  putGraphLifecycleIntent(intent: GraphLifecycleIntent): Promise<void>
  listGraphLifecycleIntents(userId: string): Promise<readonly GraphLifecycleIntent[]>
}

export interface GraphLifecycleTransport {
  createGraph(request: {
    readonly graphId: string
    readonly title: string
    readonly graphIncarnation: string
    readonly operationId: string
  }): Promise<{
    readonly graphId: string
    readonly graphIncarnation?: string
    readonly operationId?: string
  }>
  deleteGraph(
    graphId: string,
    request: {
      readonly expectedGraphIncarnation: string
      readonly operationId: string
    },
  ): Promise<void>
}

export interface GraphLifecycleManagerOptions {
  readonly userId: string
  readonly storage: GraphLifecycleStorage
  readonly transport: GraphLifecycleTransport
  readonly now?: () => number
}

function required(value: string, label: string): string {
  const result = value.trim()
  if (!result) throw new Error(`GraphLifecycle: ${label} is required`)
  return result
}

function lifetimeId(value: string): string {
  const result = required(value, 'graphIncarnation')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error('GraphLifecycle: graphIncarnation must be a UUID')
  }
  return result
}

function operationId(value: string): string {
  const result = required(value, 'operationId')
  if (result.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(result)) {
    throw new Error(
      'GraphLifecycle: operationId must be <=160 characters of [A-Za-z0-9._:-]',
    )
  }
  return result
}

function intentKey(userId: string, operationId: string): string {
  return `${encodeURIComponent(userId)}\u001f${operationId}`
}

/**
 * FIXED (master §2.2, C-D3). The version this replaces matched a bare
 * `/\b409\b|conflict/i` — an unqualified status number or the bare word
 * "conflict" classified as a lifecycle fault on a guess. Now code-first via
 * the shared taxonomy: `retryable(classifySourceFault(error).code) === false`
 * — only `FENCE_CODES`/`PERMANENT_CODES` terminate an intent as `'conflict'`;
 * everything else (including an unqualified `HTTP 409`, `null`) stays
 * `'pending'` and is retried. Deliberate behaviour change: an authority that
 * says only `HTTP 409` used to terminate the intent; now it does not,
 * because a bare 409 is not a classification (the safe direction — retried,
 * not guessed away).
 */
function conflictError(error: unknown): boolean {
  return retryable(classifySourceFault(error).code) === false
}

export class GraphLifecycleManager {
  private readonly userId: string
  private readonly now: () => number
  private intents: GraphLifecycleIntent[] = []
  private active: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: GraphLifecycleManagerOptions) {
    this.userId = required(options.userId, 'userId')
    this.now = options.now ?? Date.now
  }

  async open(): Promise<readonly GraphLifecycleIntent[]> {
    return this.serialize(async () => {
      this.intents = [...await this.options.storage.listGraphLifecycleIntents(this.userId)]
      return this.records()
    })
  }

  records(): readonly GraphLifecycleIntent[] {
    return [...this.intents].sort(
      (left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key),
    )
  }

  async enqueueCreate(input: {
    readonly graphId: string
    readonly graphIncarnation: string
    readonly operationId: string
    readonly title: string
  }): Promise<GraphLifecycleIntent> {
    return this.enqueue({
      kind: 'create',
      graphId: required(input.graphId, 'graphId'),
      graphIncarnation: lifetimeId(input.graphIncarnation),
      operationId: operationId(input.operationId),
      title: required(input.title, 'title'),
    })
  }

  async enqueueDelete(input: {
    readonly graphId: string
    readonly graphIncarnation: string
    readonly operationId: string
  }): Promise<GraphLifecycleIntent> {
    return this.enqueue({
      kind: 'delete',
      graphId: required(input.graphId, 'graphId'),
      graphIncarnation: lifetimeId(input.graphIncarnation),
      operationId: operationId(input.operationId),
    })
  }

  async flush(): Promise<readonly GraphLifecycleIntent[]> {
    return this.serialize(async () => {
      const pending = this.records().filter(intent => intent.status === 'pending')
      for (const intent of pending) {
        try {
          if (intent.kind === 'create') {
            const result = await this.options.transport.createGraph({
              graphId: intent.graphId,
              title: required(intent.title ?? '', 'title'),
              graphIncarnation: intent.graphIncarnation,
              operationId: intent.operationId,
            })
            if (result.graphId !== intent.graphId
              || (result.graphIncarnation !== undefined
                && result.graphIncarnation !== intent.graphIncarnation)
              || (result.operationId !== undefined && result.operationId !== intent.operationId)) {
              throw new Error('GraphLifecycle: create acknowledgement has a different identity')
            }
          } else {
            await this.options.transport.deleteGraph(intent.graphId, {
              expectedGraphIncarnation: intent.graphIncarnation,
              operationId: intent.operationId,
            })
          }
          await this.replace({
            ...intent,
            status: 'applied',
            updatedAt: this.now(),
            attempts: intent.attempts + 1,
            error: undefined,
          })
        } catch (error) {
          await this.replace({
            ...intent,
            status: conflictError(error) ? 'conflict' : 'pending',
            updatedAt: this.now(),
            attempts: intent.attempts + 1,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return this.records()
    })
  }

  private async enqueue(
    input: Omit<GraphLifecycleIntent, 'key' | 'userId' | 'status' | 'createdAt' | 'updatedAt' | 'attempts'>,
  ): Promise<GraphLifecycleIntent> {
    const existing = this.intents.find(intent => intent.operationId === input.operationId)
    if (existing) {
      if (existing.kind !== input.kind
        || existing.graphId !== input.graphId
        || existing.graphIncarnation !== input.graphIncarnation
        || existing.title !== input.title) {
        throw new Error(`GraphLifecycle: operationId ${input.operationId} was reused`)
      }
      return existing
    }
    const now = this.now()
    const intent: GraphLifecycleIntent = {
      ...input,
      key: intentKey(this.userId, input.operationId),
      userId: this.userId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
    }
    // Persistence is the acceptance point: callers may update UI only after
    // this transaction completes.
    await this.options.storage.putGraphLifecycleIntent(intent)
    this.intents.push(intent)
    return intent
  }

  private async replace(intent: GraphLifecycleIntent): Promise<void> {
    await this.options.storage.putGraphLifecycleIntent(intent)
    const index = this.intents.findIndex(candidate => candidate.key === intent.key)
    if (index < 0) this.intents.push(intent)
    else this.intents[index] = intent
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.active.then(task, task)
    this.active = next.then(() => undefined, () => undefined)
    return next
  }
}

export class MemoryGraphLifecycleStorage implements GraphLifecycleStorage {
  readonly intents = new Map<string, GraphLifecycleIntent>()

  async putGraphLifecycleIntent(intent: GraphLifecycleIntent): Promise<void> {
    this.intents.set(intent.key, intent)
  }

  async listGraphLifecycleIntents(userId: string): Promise<readonly GraphLifecycleIntent[]> {
    return [...this.intents.values()].filter(intent => intent.userId === userId)
  }
}
