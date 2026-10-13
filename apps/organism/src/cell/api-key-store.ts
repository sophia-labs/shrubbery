/**
 * Reactive self-owned API-key state.
 *
 * The one-time secret is held only in memory in a non-JSON value. This store
 * never touches browser storage, and its snapshots intentionally redact that
 * value when a generic serializer or diagnostic collector encounters them.
 */

import {
  ApiKeyError,
  validateApiKeyCreateRequest,
  type ApiKeyCreateRequest,
  type ApiKeyDeleteResponse,
  type ApiKeyMetadata,
} from './api-key-contract.js'
import type { ApiKeyClient } from './api-key-client.js'
import { randomUUID } from '@shrubbery/nucleus/web-crypto'

export type ApiKeyStoreStatus = 'idle' | 'loading' | 'ready' | 'creating' | 'deleting' | 'unavailable' | 'unauthenticated' | 'error'
export type ApiKeyStoreCode =
  | 'authentication'
  | 'authorization'
  | 'cognito_human_required'
  | 'api_key_authority_unavailable'
  | 'idempotency_key_required'
  | 'application_json_required'
  | 'api_key_payload_too_large'
  | 'invalid_json'
  | 'duplicate_field'
  | 'invalid_api_key_request'
  | 'invalid_scope'
  | 'invalid_graph_allowlist'
  | 'duplicate_graph'
  | 'idempotency_key_reused'
  | 'api_key_quota_exceeded'
  | 'api_keys_erased'
  | 'api_key_not_found'
  | 'api_key_inactive'
  | 'one_time_secret_unavailable'
  | 'unknown'

/**
 * A presentation-only, in-memory secret wrapper. JSON and incidental string
 * coercion cannot expose the credential; the component must explicitly call
 * `reveal()` to put it into a visible, selectable password field.
 */
export class OneTimeApiKeySecret {
  readonly #value: string
  constructor(value: string) { this.#value = value }

  reveal(): string { return this.#value }
  toJSON(): undefined { return undefined }
  toString(): string { return '[REDACTED API KEY]' }
}
export interface ApiKeyStoreSnapshot {
  readonly status: ApiKeyStoreStatus
  readonly apiKeys: readonly ApiKeyMetadata[]
  readonly code: ApiKeyStoreCode | null
  readonly httpStatus: number | null
  /** Non-null while a failed create may be retried byte-for-byte. */
  readonly operationId: string | null
  /** Never persisted; JSON serialization omits its plaintext. */
  readonly oneTimeSecret: OneTimeApiKeySecret | null
  readonly secretKeyId: string | null
  readonly secretCopied: boolean
  readonly replayedCreate: boolean
  readonly deleteResult: ApiKeyDeleteResponse | null
}

export type ApiKeyStoreListener = (snapshot: ApiKeyStoreSnapshot) => void

interface PendingCreate {
  readonly operationId: string
  readonly idempotencyKey: string
  readonly request: ApiKeyCreateRequest
}

interface PendingDelete {
  readonly keyId: string
}

function newOperationId(): string {
  return randomUUID()
}

function knownCode(value: string): value is Exclude<ApiKeyStoreCode, 'unknown'> {
  return new Set<Exclude<ApiKeyStoreCode, 'unknown'>>([
    'authentication', 'authorization', 'cognito_human_required', 'api_key_authority_unavailable',
    'idempotency_key_required', 'application_json_required', 'api_key_payload_too_large',
    'invalid_json', 'duplicate_field', 'invalid_api_key_request', 'invalid_scope',
    'invalid_graph_allowlist', 'duplicate_graph', 'idempotency_key_reused',
    'api_key_quota_exceeded', 'api_keys_erased', 'api_key_not_found', 'api_key_inactive',
  ]).has(value as Exclude<ApiKeyStoreCode, 'unknown'>)
}

function codeFor(error: unknown): ApiKeyStoreCode {
  if (error instanceof ApiKeyError) {
    if (knownCode(error.code)) return error.code
    if (error.status === 401) return 'authentication'
    if (error.status === 403) return 'authorization'
    if (error.status >= 500) return 'api_key_authority_unavailable'
  }
  return 'unknown'
}

function statusFor(code: ApiKeyStoreCode): ApiKeyStoreStatus {
  if (code === 'authentication' || code === 'cognito_human_required') return 'unauthenticated'
  if (code === 'authorization' || code === 'api_key_authority_unavailable') return 'unavailable'
  return 'error'
}

function statusCode(error: unknown): number | null {
  return error instanceof ApiKeyError ? error.status : null
}

function mergeKey(keys: readonly ApiKeyMetadata[], key: ApiKeyMetadata): readonly ApiKeyMetadata[] {
  const byId = new Map(keys.map(existing => [existing.keyId, existing]))
  byId.set(key.keyId, key)
  return [...byId.values()].sort((left, right) => right.createdAtUnixSeconds - left.createdAtUnixSeconds)
}

export class ApiKeyStore {
  private secretEpoch = 0
  private current: ApiKeyStoreSnapshot = {
    status: 'idle', apiKeys: [], code: null, httpStatus: null, operationId: null,
    oneTimeSecret: null, secretKeyId: null, secretCopied: false, replayedCreate: false,
    deleteResult: null,
  }
  private pendingCreate: PendingCreate | null = null
  private pendingDelete: PendingDelete | null = null
  private readonly listeners = new Set<ApiKeyStoreListener>()
  private loading: Promise<void> | null = null
  private creating: Promise<void> | null = null
  private deleting: Promise<void> | null = null

  constructor(private readonly client: ApiKeyClient) {}

  snapshot(): ApiKeyStoreSnapshot { return this.current }

  subscribe(listener: ApiKeyStoreListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async load(): Promise<void> {
    if (this.loading) return this.loading
    this.current = { ...this.current, status: 'loading', code: null, httpStatus: null, deleteResult: null }
    this.emit()
    this.loading = this.client.list().then(apiKeys => {
      this.current = {
        ...this.current, status: 'ready', apiKeys: [...apiKeys], code: null, httpStatus: null,
        operationId: this.pendingCreate?.operationId ?? null, deleteResult: null,
      }
      this.emit()
    }).catch(error => {
      const code = codeFor(error)
      this.current = { ...this.current, status: statusFor(code), code, httpStatus: statusCode(error) }
      this.emit()
      throw error
    }).finally(() => { this.loading = null })
    return this.loading
  }

  async create(request: ApiKeyCreateRequest): Promise<void> {
    if (this.creating) return this.creating
    const normalized = validateApiKeyCreateRequest(request)
    const pending = this.pendingCreate && JSON.stringify(this.pendingCreate.request) === JSON.stringify(normalized)
      ? this.pendingCreate
      : { operationId: newOperationId(), idempotencyKey: newOperationId(), request: Object.freeze(normalized) }
    this.pendingCreate = pending
    this.creating = this.runCreate(pending).finally(() => { this.creating = null })
    return this.creating
  }

  /** Exact idempotency replay: it reuses the original validated bytes and key. */
  async retryCreate(): Promise<void> {
    if (this.creating) return this.creating
    if (!this.pendingCreate) return
    this.creating = this.runCreate(this.pendingCreate).finally(() => { this.creating = null })
    return this.creating
  }

  async remove(keyId: string): Promise<void> {
    if (this.deleting) return this.deleting
    const id = keyId.trim()
    if (!id) return
    const pending = { keyId: id }
    this.pendingDelete = pending
    this.deleting = this.runDelete(pending).finally(() => { this.deleting = null })
    return this.deleting
  }

  async retryDelete(): Promise<void> {
    if (this.deleting || !this.pendingDelete) return this.deleting ?? Promise.resolve()
    this.deleting = this.runDelete(this.pendingDelete).finally(() => { this.deleting = null })
    return this.deleting
  }

  markSecretCopied(): void {
    if (!this.current.oneTimeSecret) return
    this.current = { ...this.current, secretCopied: true }
    this.emit()
  }

  /** Explicit acknowledgement permanently drops the plaintext from UI state. */
  acknowledgeSecret(): void {
    if (!this.current.oneTimeSecret) return
    this.current = {
      ...this.current,
      oneTimeSecret: null,
      secretKeyId: null,
      secretCopied: false,
    }
    this.emit()
  }

  /**
   * Drop a one-time secret when its Account Settings owner ends. This is kept
   * distinct from ordinary presentation updates: a routine re-render must not
   * erase a freshly-created secret before the user can acknowledge it.
   */
  discardOneTimeSecret(): void {
    this.secretEpoch += 1
    if (!this.current.oneTimeSecret) return
    this.current = {
      ...this.current,
      oneTimeSecret: null,
      secretKeyId: null,
      secretCopied: false,
    }
    this.emit()
  }

  private async runCreate(pending: PendingCreate): Promise<void> {
    const secretEpoch = this.secretEpoch
    this.current = {
      ...this.current, status: 'creating', code: null, httpStatus: null,
      operationId: pending.operationId, replayedCreate: false, deleteResult: null,
    }
    this.emit()
    try {
      const result = await this.client.create(pending.request, pending.idempotencyKey)
      const oneTimeSecret = secretEpoch !== this.secretEpoch || result.secret === null ? null : new OneTimeApiKeySecret(result.secret)
      this.pendingCreate = null
      this.current = {
        ...this.current,
        status: 'ready', apiKeys: mergeKey(this.current.apiKeys, result.apiKey),
        code: result.replayed && !oneTimeSecret ? 'one_time_secret_unavailable' : null,
        httpStatus: null, operationId: null, oneTimeSecret, secretKeyId: oneTimeSecret ? result.apiKey.keyId : null,
        secretCopied: false, replayedCreate: result.replayed,
      }
      this.emit()
    } catch (error) {
      const code = codeFor(error)
      this.current = {
        ...this.current, status: statusFor(code), code, httpStatus: statusCode(error),
        operationId: pending.operationId,
      }
      this.emit()
      throw error
    }
  }

  private async runDelete(pending: PendingDelete): Promise<void> {
    this.current = { ...this.current, status: 'deleting', code: null, httpStatus: null, deleteResult: null }
    this.emit()
    try {
      const result = await this.client.remove(pending.keyId)
      this.pendingDelete = null
      this.current = {
        ...this.current, status: 'ready', apiKeys: mergeKey(this.current.apiKeys, result.apiKey),
        code: null, httpStatus: null, deleteResult: result,
      }
      this.emit()
    } catch (error) {
      const code = codeFor(error)
      this.current = { ...this.current, status: statusFor(code), code, httpStatus: statusCode(error) }
      this.emit()
      throw error
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current)
  }
}

export function createApiKeyStore(client: ApiKeyClient): ApiKeyStore {
  return new ApiKeyStore(client)
}
