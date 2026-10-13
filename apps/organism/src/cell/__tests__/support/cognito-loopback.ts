/**
 * A real HTTP server that speaks the Cognito Identity Provider JSON protocol
 * (`X-Amz-Target: AWSCognitoIdentityProviderService.<Action>`, HTTP 400 with
 * `{"__type", "message"}` for a refusal) so the SPA's real CognitoAuthSession can
 * be driven end to end without a fetch double. The session's endpoint is fixed to
 * cognito-idp.<region>.amazonaws.com, so its `fetch` option is pointed at this
 * server: a real socket, a real request, only the address differs.
 *
 * Answers are queued per action and consumed in order. An action with nothing
 * queued answers 500 loudly: a test that reaches Cognito unplanned is a bug in the
 * test, and must not pass by accident.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface CognitoCall {
  readonly action: string
  readonly body: Record<string, unknown>
}

export interface CognitoAnswer {
  readonly status?: number
  readonly body: unknown
  /** Hold the answer this long (a slow network), so a test can act while a request is in flight. */
  readonly delayMs?: number
}

function base64Url(value: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** An unsigned JWT: the session reads claims, it does not verify signatures. */
export function jwt(claims: Record<string, unknown>): string {
  return `${base64Url({ alg: 'none' })}.${base64Url(claims)}.signature`
}

/** The body of a successful USER_PASSWORD_AUTH. */
export function authenticationResult(claims: Record<string, unknown> = {}): { AuthenticationResult: Record<string, unknown> } {
  return {
    AuthenticationResult: {
      AccessToken: 'access-token',
      IdToken: jwt({ sub: 'user-1', email: 'vera@example.test', exp: Math.floor(Date.now() / 1000) + 3600, ...claims }),
      RefreshToken: 'refresh-token',
      ExpiresIn: 3600,
    },
  }
}

export class CognitoLoopback {
  base = ''
  readonly calls: CognitoCall[] = []
  private readonly queues = new Map<string, CognitoAnswer[]>()
  private server: Server | undefined

  async start(): Promise<void> {
    const server = createServer((request, response) => { void this.handle(request, response) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    this.server = server
    this.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    this.server = undefined
  }

  reset(): void {
    this.calls.length = 0
    this.queues.clear()
  }

  /** Queue what `action` will answer, in order. */
  enqueue(action: string, ...answers: CognitoAnswer[]): void {
    this.queues.set(action, [...(this.queues.get(action) ?? []), ...answers])
  }

  /** A refusal in Cognito's own wire shape. */
  static refusal(body: { readonly __type: string; readonly message: string }): CognitoAnswer {
    return { status: 400, body }
  }

  actions(): string[] {
    return this.calls.map(call => call.action)
  }

  callsTo(action: string): CognitoCall[] {
    return this.calls.filter(call => call.action === action)
  }

  /** A fetch that sends whatever the session posts to this server instead of the AWS endpoint. */
  fetch(): typeof fetch {
    return (async (_input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(this.base, init)) as typeof fetch
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': '*',
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const target = String(request.headers['x-amz-target'] ?? '')
    const action = target.split('.').pop() ?? ''
    this.calls.push({ action, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} })
    const answer = this.queues.get(action)?.shift()
    if (!answer) {
      response.writeHead(500, { ...headers, 'content-type': 'application/x-amz-json-1.1' })
      response.end(JSON.stringify({ __type: 'TestHarnessError', message: `nothing queued for ${action}` }))
      return
    }
    if (answer.delayMs) await new Promise(resolve => setTimeout(resolve, answer.delayMs))
    response.writeHead(answer.status ?? 200, { ...headers, 'content-type': 'application/x-amz-json-1.1' })
    response.end(JSON.stringify(answer.body))
  }
}
