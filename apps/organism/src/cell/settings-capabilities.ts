/** Server-authenticated UI admission; graph ACLs still authorize every graph call. */
export interface PhanesControlAuthorization {
  allowed(): boolean
  refresh(): Promise<boolean>
  assertAllowed(): Promise<void>
}

interface CapabilityAuth {
  token(): string | null | undefined
  userId(): string
  whenReady?(): Promise<void>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class HostedSettingsCapabilities implements PhanesControlAuthorization {
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private admittedSubject = ''
  private admittedToken = ''
  private phanesControl = false
  private generation = 0
  private pending: { subject: string; token: string; promise: Promise<boolean> } | null = null

  constructor(
    private readonly auth: CapabilityAuth,
    gatewayBaseUrl: string,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    const base = new URL(gatewayBaseUrl)
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('Invalid settings capability gateway URL')
    }
    this.endpoint = new URL('/me/capabilities', base).href
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
  }

  allowed(): boolean {
    return this.phanesControl
      && this.admittedSubject === this.auth.userId()
      && this.admittedToken === this.auth.token()
      && Boolean(this.admittedSubject && this.admittedToken)
  }

  async refresh(): Promise<boolean> {
    this.phanesControl = false
    try { await this.auth.whenReady?.() } catch { this.generation += 1; return false }
    const subject = this.auth.userId()
    const token = this.auth.token() ?? ''
    if (this.pending?.subject === subject && this.pending.token === token) return this.pending.promise
    const generation = ++this.generation
    this.phanesControl = false
    if (!subject || !token) return false
    const promise = (async () => {
      try {
        // Defer even a synchronous fetch failure until pending is installed.
        await Promise.resolve()
        const response = await this.fetchImpl(this.endpoint, {
          method: 'GET', headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store', credentials: 'omit', redirect: 'error',
        })
        if (!response.ok) return false
        const value: unknown = await response.json()
        if (generation !== this.generation || subject !== this.auth.userId() || token !== this.auth.token()) return false
        if (!record(value) || value.schema !== 'sophia.me.capabilities.v1' || value.subject !== subject
          || !record(value.capabilities) || typeof value.capabilities.phanesControl !== 'boolean') return false
        this.admittedSubject = subject
        this.admittedToken = token
        this.phanesControl = value.capabilities.phanesControl
        return this.allowed()
      } catch {
        // Missing, denied, malformed, or unreachable is no Phanes authority.
        return false
      } finally {
        if (generation === this.generation) this.pending = null
      }
    })()
    this.pending = { subject, token, promise }
    return promise
  }

  async assertAllowed(): Promise<void> {
    if (!await this.refresh() || !this.allowed()) throw new Error('Phanes control is not authorized for this session.')
  }
}

/** Fresh authenticated directory rows are UI hints, never substitutes for ACLs. */
export async function hostedGraphSettingsWritable(
  auth: CapabilityAuth,
  graphId: string,
  graphs: () => Promise<unknown>,
  /** The graph's owner when known: an id alone may name the account's graph and another owner's. */
  owner?: string,
): Promise<boolean> {
  const subject = auth.userId()
  const token = auth.token()
  if (!subject || !token) return false
  try {
    const rows = await graphs()
    if (!Array.isArray(rows) || subject !== auth.userId() || token !== auth.token()) return false
    const matching = rows.filter(row => record(row) && row.graphId === graphId && (!owner || row.owner === owner))
    return matching.length === 1 && (matching[0].role === 'owner' || matching[0].role === 'editor')
  } catch { return false }
}
