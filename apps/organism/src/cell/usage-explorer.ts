import { localeSource } from '@shrubbery/nucleus'
export interface UsageEvent {
  id: string; source: 'sirin' | 'cloud-1'; ts: number; recordedAt: string; timezone: 'utc' | 'unspecified'
  provider: string; model: string; status: string; surface: string | null; graphId: string | null; sessionId: string | null
  fundingSource: 'platform' | 'user' | null
  inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; totalTokens: number | null
  costMicroUsd: number; providerCostMicroUsd: number | null; providerReportedCostMicroUsd: number | null; markupMicroUsd: number | null
}
export interface UsageCoverage { source: string; eventCount: number; firstTs: number | null; lastTs: number | null; state: string; capturedAt: string | null }
export interface UsagePage { items: UsageEvent[]; nextCursor: string | null; coverage: UsageCoverage[] }
export interface UsageReader { page(after?: string): Promise<UsagePage> }
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
export class HostedUsageExplorer implements UsageReader {
  private readonly base: URL
  private readonly fetchImpl: typeof fetch
  constructor(private readonly auth: { userId(): string; token(): string | null | undefined; whenReady?(): Promise<void> }, gatewayBaseUrl: string, fetchImpl = globalThis.fetch) {
    this.base = new URL(gatewayBaseUrl)
    if (!['https:', 'http:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('Invalid usage gateway.')
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
  }
  async page(after?: string): Promise<UsagePage> {
    await this.auth.whenReady?.()
    const subject = this.auth.userId(), token = this.auth.token()
    if (!subject || !token) throw new Error('Sign in to view usage history.')
    const query = new URLSearchParams({ limit: '200', ...(after ? { after } : {}) })
    const response = await this.fetchImpl(new URL('/billing/usage/events?' + query, this.base), {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again.' : `Usage history could not be loaded (${response.status}).`)
    const v: unknown = await response.json()
    if (subject !== this.auth.userId() || token !== this.auth.token()) throw new Error('Your account session changed. Refresh usage.')
    if (!record(v) || v.schema !== 'sophia.usage-explorer.v1' || v.userId !== subject || !integer(v.fromTs) || !integer(v.toTs) || v.fromTs >= v.toTs || !Array.isArray(v.items) || v.items.length > 200 || !Array.isArray(v.coverage) || v.coverage.length !== 2) throw new Error('Invalid usage response.')
    for (const row of v.items) {
      if (!record(row) || !['sirin', 'cloud-1'].includes(String(row.source)) || typeof row.id !== 'string' || !row.id.startsWith(`${row.source}:`) || !['utc', 'unspecified'].includes(String(row.timezone)) || !integer(row.ts) || row.ts < v.fromTs || row.ts >= v.toTs || !integer(row.costMicroUsd)) throw new Error('Invalid usage event.')
      for (const key of ['recordedAt', 'model', 'provider', 'status']) if (typeof row[key] !== 'string') throw new Error('Invalid usage event.')
      for (const key of ['surface', 'graphId', 'sessionId']) if (row[key] !== null && typeof row[key] !== 'string') throw new Error('Invalid usage field.')
      if (![null, 'platform', 'user'].includes(row.fundingSource as null | string)) throw new Error('Invalid usage funding source.')
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'providerCostMicroUsd', 'providerReportedCostMicroUsd', 'markupMicroUsd']) if (row[key] !== null && !integer(row[key])) throw new Error('Invalid usage amount.')
    }
    const sources = new Set<string>()
    for (const c of v.coverage) {
      if (!record(c) || !['sirin', 'cloud-1'].includes(String(c.source)) || sources.has(String(c.source)) || !integer(c.eventCount) || typeof c.state !== 'string' || (c.capturedAt !== null && typeof c.capturedAt !== 'string')) throw new Error('Invalid usage coverage.')
      for (const key of ['firstTs', 'lastTs']) if (c[key] !== null && !integer(c[key])) throw new Error('Invalid coverage date.')
      sources.add(String(c.source))
    }
    if (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(v.nextCursor))) throw new Error('Invalid usage cursor.')
    return { items: v.items as unknown as UsageEvent[], nextCursor: v.nextCursor as string | null, coverage: v.coverage as unknown as UsageCoverage[] }
  }
}
/** One share of the recorded usage: its cost and how many events made it. */
export interface UsageSplitPart { readonly costMicroUsd: number; readonly events: number }
/**
 * The recorded usage by who paid. The balance is debited by this service's platform-funded rows
 * and by nothing else, so those are "deducted"; rows that ran on the person's own key are not;
 * and a row with no funding source, or from the earlier service, is imported history, never deducted here.
 */
export interface UsageSplit { readonly deducted: UsageSplitPart; readonly ownKey: UsageSplitPart; readonly imported: UsageSplitPart }
export function splitUsageTotals(rows: readonly UsageEvent[]): UsageSplit {
  const split = {
    deducted: { costMicroUsd: 0, events: 0 },
    ownKey: { costMicroUsd: 0, events: 0 },
    imported: { costMicroUsd: 0, events: 0 },
  }
  for (const row of rows) {
    // Earlier-service history was deducted in the earlier service whatever funding it carries, and a row with
    // no funding source is imported too: only a platform-funded row of this service is deducted from this balance.
    const part = row.fundingSource === 'user'
      ? split.ownKey
      : row.source === 'cloud-1' || row.fundingSource !== 'platform' ? split.imported : split.deducted
    part.costMicroUsd += row.costMicroUsd
    part.events += 1
  }
  return split
}
export const usageMoney = (n: number | null): string => n === null ? 'Unknown' : new Intl.NumberFormat(localeSource.get(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n / 1_000_000)
export function usageCsv(rows: UsageEvent[]): string {
  const fields: (keyof UsageEvent)[] = ['id', 'source', 'recordedAt', 'timezone', 'provider', 'model', 'status', 'surface', 'graphId', 'sessionId', 'fundingSource', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'costMicroUsd', 'providerCostMicroUsd', 'providerReportedCostMicroUsd', 'markupMicroUsd']
  const escape = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"' }
  return '\ufeff' + [fields.join(','), ...rows.map(row => fields.map(key => escape(row[key])).join(','))].join('\r\n')
}
