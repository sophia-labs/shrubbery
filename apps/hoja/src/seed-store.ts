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
}

export interface SeedSaveInput {
  readonly markdown: string
  readonly json: unknown
}

export interface SeedSaveResult {
  readonly ok: boolean
  readonly title: string
  readonly snippet: string
  readonly modified_ms: number
}

/** A folder of `.sd` seeds and a Garden graph expose this same app contract. */
export interface SeedStore {
  readonly kind: 'soil' | 'cell'
  list(): Promise<readonly SeedSummary[]>
  read(id: string): Promise<SeedDoc>
  create(): Promise<{ id: string }>
  save(id: string, input: SeedSaveInput): Promise<SeedSaveResult>
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
