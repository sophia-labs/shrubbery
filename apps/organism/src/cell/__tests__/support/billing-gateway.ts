/**
 * A real HTTP server that speaks the gateway's /billing/* account wire the way
 * platform-next `choreograph_account_routes.rs` (live `b75333258e36`) projects
 * it. There is no fetch double anywhere in the billing tests: every SPA request
 * crosses a real socket, and this server records what it received (the method,
 * the path, the bearer, the body), so a test can assert the wire itself rather
 * than a call count.
 *
 * The SPA origin differs from this server's under happy-dom, so the server
 * answers CORS and preflights like the real gateway. happy-dom also strips
 * `Authorization` when a request says `credentials: 'omit'` (a real browser does
 * not), so tests that assert the bearer run in the node environment.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly authorization: string | undefined
  readonly contentType: string | undefined
  readonly rawBody: string
  readonly body: unknown
}

export interface Answer {
  readonly status: number
  readonly body?: unknown
  /** Raw text instead of JSON, for an upstream that answers with prose. */
  readonly text?: string
}

export type Programmed = (request: RecordedRequest) => Answer | Promise<Answer>

export const DEFAULT_CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_billing_loopback'

export class BillingGateway {
  readonly requests: RecordedRequest[] = []
  base = ''
  userId = 'alice'
  balanceMicroUsd = 12_340_000
  lifetimeUsageMicroUsd = 1_234
  initialized = true
  accountTier = 'free'
  subscriptionStatus = 'none'
  canManage: boolean | null | undefined = false
  /** Answers `POST /billing/checkout`; the default is a Stripe Checkout URL. */
  checkout: Programmed | undefined
  /** Answers `GET /billing/credits/history`; the default is 404 (route not shipped). */
  history: Programmed | undefined
  /** Answers `POST /billing/portal`; the default is 404. */
  portal: Programmed | undefined
  /** Runs before each balance answer with the 1-based count of balance reads. */
  onBalanceRead: ((reads: number) => void) | undefined
  /** When set, the balance answers this status with prose instead of the ledger (an upstream failing). */
  balanceStatus: number | undefined
  /**
   * What the backend says of the credits regime on the balance (Vera, 2026-10-03). Each is absent from the
   * answer unless set, as on an older backend; `creditsStartDate` may be any form the backend could send.
   */
  feeBps: number | undefined
  gateMode: 'observe' | 'enforce' | undefined
  creditsStartDate: string | number | undefined
  balanceReads = 0
  private server: Server | undefined

  async start(): Promise<void> {
    const server = createServer((request, response) => { void this.handle(request, response) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    this.server = server
    this.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    this.server = undefined
  }

  /** A clean slate between tests; the server keeps listening. */
  reset(): void {
    this.requests.length = 0
    this.userId = 'alice'
    this.balanceMicroUsd = 12_340_000
    this.lifetimeUsageMicroUsd = 1_234
    this.initialized = true
    this.accountTier = 'free'
    this.subscriptionStatus = 'none'
    this.canManage = false
    this.checkout = undefined
    this.history = undefined
    this.portal = undefined
    this.onBalanceRead = undefined
    this.balanceStatus = undefined
    this.feeBps = undefined
    this.gateMode = undefined
    this.creditsStartDate = undefined
    this.balanceReads = 0
  }

  paths(): string[] {
    return this.requests.map(request => `${request.method} ${request.path}`)
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': '*',
      'cache-control': 'no-store',
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const rawBody = Buffer.concat(chunks).toString('utf8')
    const url = new URL(request.url ?? '/', 'http://loopback.invalid')
    const recorded: RecordedRequest = {
      method: request.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      rawBody,
      body: rawBody ? JSON.parse(rawBody) : undefined,
    }
    this.requests.push(recorded)
    const answer = await this.answer(recorded)
    if (answer.text !== undefined) {
      response.writeHead(answer.status, { ...headers, 'content-type': 'text/plain' })
      response.end(answer.text)
      return
    }
    response.writeHead(answer.status, { ...headers, 'content-type': 'application/json' })
    response.end(answer.body === undefined ? '' : JSON.stringify(answer.body))
  }

  private async answer(request: RecordedRequest): Promise<Answer> {
    switch (request.path) {
      case '/billing/balance':
        this.balanceReads += 1
        this.onBalanceRead?.(this.balanceReads)
        if (this.balanceStatus !== undefined) return { status: this.balanceStatus, text: 'private upstream diagnostic' }
        return {
          status: 200,
          body: {
            userId: this.userId,
            balanceMicroUsd: this.balanceMicroUsd,
            lifetimeUsageMicroUsd: this.lifetimeUsageMicroUsd,
            initialized: this.initialized,
            ...(this.feeBps === undefined ? {} : { feeBps: this.feeBps }),
            ...(this.gateMode === undefined ? {} : { gateMode: this.gateMode }),
            ...(this.creditsStartDate === undefined ? {} : { creditsStartDate: this.creditsStartDate }),
          },
        }
      case '/billing/subscription':
        return {
          status: 200,
          body: {
            userId: this.userId,
            tier: 'free',
            accountTier: this.accountTier,
            status: this.subscriptionStatus,
            currentPeriodEnd: null,
            canManage: this.canManage,
          },
        }
      case '/billing/usage':
        return { status: 200, body: { userId: this.userId, totalMicroUsd: 123, eventCount: 1, fromTs: 1, toTs: 2 } }
      case '/billing/checkout':
        return this.checkout
          ? await this.checkout(request)
          : { status: 200, body: { url: DEFAULT_CHECKOUT_URL, checkout_url: DEFAULT_CHECKOUT_URL } }
      case '/billing/credits/history':
        return this.history ? await this.history(request) : { status: 404, body: { error: { code: 'not_found' } } }
      case '/billing/portal':
        return this.portal ? await this.portal(request) : { status: 404, body: { error: { code: 'not_found' } } }
      default:
        return { status: 404, body: { error: { code: 'not_found' } } }
    }
  }
}
