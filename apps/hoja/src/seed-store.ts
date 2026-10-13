export interface SeedSummary {
  readonly id: string
  readonly title: string
  readonly snippet: string
  readonly modified_ms: number
  readonly readOnly?: boolean
}

export interface SeedDoc {
  readonly id: string
  readonly title: string
  readonly markdown: string
  /** Native TipTap structure when the backend exposes it. */
  readonly json?: unknown
  /** Server revision this content was read at, when the backend has one. */
  readonly revision?: number
}

export interface SeedSaveInput {
  readonly markdown: string
  readonly json: unknown
  /**
   * The server revision the user last saw. Omitted: the store uses the
   * revision of its own last read/write. A cell refuses the write with a
   * SeedConflictError when someone else wrote since.
   */
  readonly expectedRevision?: number | null
}

export interface SeedSearchHit {
  readonly id: string
  readonly title: string
  readonly snippet: string
}

/** The document changed on the server since the user last saw it. */
export class SeedConflictError extends Error {
  constructor(readonly id: string, detail: string) {
    super(`This leaf changed elsewhere since you opened it (${detail}).`)
    this.name = 'SeedConflictError'
  }
}

export interface SeedSaveResult {
  readonly ok: boolean
  readonly title: string
  readonly snippet: string
  readonly modified_ms: number
  /** Server revision after this write, when the backend has one. */
  readonly revision?: number
}

/** A folder of `.sd` seeds and a Garden graph expose this same app contract. */
export interface SeedStore {
  readonly kind: 'soil' | 'cell'
  list(): Promise<readonly SeedSummary[]>
  read(id: string): Promise<SeedDoc>
  create(): Promise<{ id: string }>
  save(id: string, input: SeedSaveInput): Promise<SeedSaveResult>
  /** Current server revision, for refreshing an open leaf (cells only). */
  revisionOf?(id: string): Promise<number | null>
  /** Body search beyond titles (cells only). */
  search?(query: string): Promise<readonly SeedSearchHit[]>
}

export interface SoilStoreOptions {
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
}

/** Existing local-folder backend, isolated behind the SeedStore contract. */
export class SoilStore implements SeedStore {
  readonly kind = 'soil' as const
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: SoilStoreOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '')
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('SoilStore requires fetch')
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
  }

  async list(): Promise<readonly SeedSummary[]> {
    const data = await this.request<{ seeds: SeedSummary[] }>('GET', '/api/seeds')
    if (!Array.isArray(data.seeds)) throw new Error('soil seeds list has no seeds array')
    return data.seeds
  }

  read(id: string): Promise<SeedDoc> {
    return this.request('GET', `/api/seeds/${encodeURIComponent(requiredId(id))}`)
  }

  create(): Promise<{ id: string }> {
    return this.request('POST', '/api/seeds')
  }

  save(id: string, input: SeedSaveInput): Promise<SeedSaveResult> {
    return this.request('POST', `/api/seeds/${encodeURIComponent(requiredId(id))}`, input.json)
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`soil ${method} ${path}: ${response.status}`)
    return await response.json() as T
  }
}

export function requiredId(id: string): string {
  const value = id.trim()
  if (!value) throw new Error('seed id must not be empty')
  return value
}
