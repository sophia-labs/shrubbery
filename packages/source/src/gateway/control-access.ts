/** Canonical owner-qualified control-MCP grants. No credentials or network are owned here. */

export interface ControlAccessGrant {
  /** The complete typed principal, not a Cognito email or an unqualified subject. */
  readonly userId: string
  readonly role: 'viewer' | 'editor'
  readonly grantedAt: string
  readonly grantedBy: string
}

export interface ControlAccessPut {
  readonly role: 'viewer' | 'editor'
  readonly email?: string
  readonly displayName?: string
}

export type ControlAccessTool = 'manage_access' | 'get_sharing' | 'manage_share_links' | 'redeem_share_link'

export interface ControlAccessRequest {
  readonly jsonrpc: '2.0'
  readonly id: string
  readonly method: 'tools/call'
  readonly params: {
    readonly name: ControlAccessTool
    readonly arguments: Readonly<Record<string, unknown>>
  }
}

/** The single principal that means "every signed-in user". Viewer only. */
export const EVERYONE_AUTHENTICATED = 'everyone:authenticated'

/** A share link as the owner sees it. The token is never part of this view. */
export interface ControlShareLink {
  readonly linkId: string
  readonly role: 'viewer' | 'editor'
  readonly createdAt: string
  readonly createdBy: string
  readonly expiresAt: string | null
  readonly label: string | null
  readonly live: boolean
}

export interface ControlSharingState {
  /** True when every signed-in user can view the graph. */
  readonly everyone: boolean
  readonly links: readonly ControlShareLink[]
}

export interface ControlShareLinkCreate {
  readonly role: 'viewer' | 'editor'
  /** null = until revoked. */
  readonly expiresInSeconds?: number | null
  readonly label?: string
}

export interface ControlMintedShareLink {
  readonly link: ControlShareLink
  /** Shown exactly once; the gateway stores only its hash. */
  readonly token: string
}

export interface ControlRedeemedShareLink {
  readonly owner: string
  readonly graphId: string
  readonly role: 'viewer' | 'editor'
}

export interface ControlAccessOptions {
  /** A trusted explicit binding or an unambiguous authoritative directory result. */
  readonly resolveOwner: (graphId: string) => string | Promise<string>
  /** POST this request to the gateway root /control/mcp, with fresh authentication. */
  readonly request: (body: ControlAccessRequest) => Promise<unknown>
}

export class ControlAccessError extends Error {
  constructor(readonly code: number | undefined, message: string, readonly data?: unknown) {
    super(message)
    this.name = 'ControlAccessError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

export function accessUserPrincipal(value: string): string {
  if (typeof value !== 'string' || !/^user:[^\s]+$/u.test(value)) {
    throw new Error('Access requires a typed user principal (user:<subject>); email and bare subject IDs are not resolved.')
  }
  return value
}

function graphId(value: string): string {
  const id = value.trim()
  if (!id) throw new Error('Access graph id must not be empty')
  return id
}

/** Directory discovery must never choose the first of several owners for a slug. */
export function accessOwnerFromDirectory(value: unknown, requestedGraphId: string): string {
  const envelope = object(value)
  const rows = Array.isArray(value) ? value : envelope?.items
  if (!Array.isArray(rows)) throw new Error('Access owner directory is not an array or items envelope')
  const matches = rows.filter(row => object(row)?.graphId === requestedGraphId)
  if (!matches.length) throw new Error('Access owner binding is unavailable for this graph; refresh the workspace directory.')
  const owners = new Set(matches.map(row => {
    const owner = object(row)?.owner
    if (typeof owner !== 'string') throw new Error('Access graph directory row has no owner identity')
    return accessUserPrincipal(owner)
  }))
  if (owners.size !== 1) throw new Error('Access graph identity is ambiguous across owners')
  return [...owners][0]
}

function textResult(result: Record<string, unknown>): string {
  return Array.isArray(result.content)
    ? result.content.map(item => object(item)).filter(item => item?.type === 'text' && typeof item.text === 'string')
      .map(item => item!.text).join('\n')
    : ''
}

function resultValue(value: unknown, expectedId: string): unknown {
  const envelope = object(value)
  if (!envelope || envelope.jsonrpc !== '2.0' || envelope.id !== expectedId) {
    throw new Error('Access control returned an invalid JSON-RPC envelope or request identity')
  }
  if (envelope.error !== undefined) {
    const error = object(envelope.error)
    if (!error || !Number.isInteger(error.code) || typeof error.message !== 'string') {
      throw new Error('Access control returned a malformed JSON-RPC error')
    }
    throw new ControlAccessError(error.code as number, error.message, error.data)
  }
  const result = object(envelope.result)
  if (!result) throw new Error('Access control returned no result')
  if (result.isError === true) throw new ControlAccessError(undefined, textResult(result) || 'Access control tool failed')
  if (result.isError !== undefined && typeof result.isError !== 'boolean') {
    throw new Error('Access control returned an invalid isError flag')
  }
  if (!Object.hasOwn(result, 'structuredContent')) throw new Error('Access control returned no structuredContent')
  return result.structuredContent
}

function grant(value: unknown, owner: string, id: string): ControlAccessGrant {
  const row = object(value)
  const graph = object(row?.graph)
  if (!row || graph?.owner !== owner || graph.graphId !== id) {
    throw new Error('Access grant identity does not match the requested owner/graph')
  }
  if (
    !Number.isSafeInteger(row.generation) || (row.generation as number) < 0
    || !Number.isSafeInteger(row.grantedAtMs) || (row.grantedAtMs as number) < 0
    || typeof row.principal !== 'string' || typeof row.grantedBy !== 'string'
    || (row.role !== 'viewer' && row.role !== 'editor')
  ) throw new Error('Access control returned an invalid grant shape')
  const userId = accessUserPrincipal(row.principal)
  const grantedBy = accessUserPrincipal(row.grantedBy)
  if (userId === owner) throw new Error('Access control returned an owner as a delegated grant')
  const date = new Date(row.grantedAtMs as number)
  if (!Number.isFinite(date.getTime())) throw new Error('Access control returned an invalid grant timestamp')
  return { userId, role: row.role, grantedAt: date.toISOString(), grantedBy }
}

const SHARE_TOKEN = /^shr_[A-Za-z0-9_-]{43}$/u
const LINK_ID = /^[0-9a-f]{64}$/u

/** Accept only the gateway's share-token shape; anything else never leaves the page. */
export function shareLinkToken(value: string): string {
  const token = typeof value === 'string' ? value.trim() : ''
  if (!SHARE_TOKEN.test(token)) throw new Error('This share link is malformed or incomplete.')
  return token
}

function isoFromMs(value: unknown, what: string): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Share link returned an invalid ${what}`)
  return new Date(value as number).toISOString()
}

function shareLink(value: unknown, owner: string, id: string): ControlShareLink {
  const row = object(value)
  const graph = object(row?.graph)
  if (!row || graph?.owner !== owner || graph.graphId !== id) {
    throw new Error('Share link identity does not match the requested owner/graph')
  }
  if (typeof row.linkId !== 'string' || !LINK_ID.test(row.linkId)) throw new Error('Share link returned an invalid link id')
  if (row.role !== 'viewer' && row.role !== 'editor') throw new Error('Share link returned an invalid role')
  if (row.label !== undefined && typeof row.label !== 'string') throw new Error('Share link returned an invalid label')
  if (row.live !== undefined && typeof row.live !== 'boolean') throw new Error('Share link returned an invalid live flag')
  return {
    linkId: row.linkId,
    role: row.role,
    createdAt: isoFromMs(row.createdAtMs, 'creation time'),
    createdBy: accessUserPrincipal(row.createdBy as string),
    expiresAt: row.expiresAtMs === undefined || row.expiresAtMs === null ? null : isoFromMs(row.expiresAtMs, 'expiry'),
    label: typeof row.label === 'string' ? row.label : null,
    live: row.live === undefined ? true : row.live as boolean,
  }
}

/** Stable method names let app and reusable face consumers share one wire contract. */
export function createControlAccessClient(options: ControlAccessOptions) {
  let sequence = 0
  const owner = async (rawGraphId: string): Promise<string> =>
    accessUserPrincipal(await options.resolveOwner(graphId(rawGraphId)))
  const rpc = async (tool: ControlAccessTool, args: Readonly<Record<string, unknown>>) => {
    const requestId = `access-${++sequence}`
    const value = await options.request({
      jsonrpc: '2.0', id: requestId, method: 'tools/call',
      params: { name: tool, arguments: args },
    })
    return resultValue(value, requestId)
  }
  const callTool = async (tool: ControlAccessTool, rawGraphId: string, args: Readonly<Record<string, unknown>>) => {
    const id = graphId(rawGraphId)
    const selectedOwner = await owner(id)
    if (args.principal === selectedOwner) throw new Error('The workspace owner cannot be changed or removed through delegated access grants')
    const value = await rpc(tool, { owner: selectedOwner, graphId: id, ...args })
    return { value, owner: selectedOwner, graphId: id }
  }
  const call = (rawGraphId: string, args: Readonly<Record<string, unknown>>) =>
    callTool('manage_access', rawGraphId, args)
  return {
    owner,
    async list(id: string): Promise<readonly ControlAccessGrant[]> {
      const response = await call(id, { action: 'list' })
      if (!Array.isArray(response.value)) throw new Error('Access list structuredContent must be an array')
      const grants = response.value.map(row => grant(row, response.owner, response.graphId))
      if (new Set(grants.map(row => row.userId)).size !== grants.length) {
        throw new Error('Access control returned duplicate principal grants')
      }
      return grants
    },
    async put(id: string, rawPrincipal: string, request: ControlAccessPut): Promise<void> {
      const principal = accessUserPrincipal(rawPrincipal.trim())
      if (request.role !== 'viewer' && request.role !== 'editor') throw new Error('Access role must be viewer or editor')
      if (request.email?.trim() || request.displayName?.trim()) {
        throw new Error('Canonical access grants do not support email or display-name metadata; use an existing typed user ID.')
      }
      const response = await call(id, { action: 'grant', principal, role: request.role })
      const accepted = grant(response.value, response.owner, response.graphId)
      if (accepted.userId !== principal || accepted.role !== request.role) {
        throw new Error('Access grant acknowledgement does not match the requested principal/role')
      }
    },
    async remove(id: string, rawPrincipal: string): Promise<void> {
      const principal = accessUserPrincipal(rawPrincipal.trim())
      const response = await call(id, { action: 'revoke', principal })
      if (object(response.value)?.revoked !== true) throw new Error('Access revoke returned no confirmed acknowledgement')
    },
    /** Owner view: the everyone grant and share links (never tokens). */
    async sharing(id: string): Promise<ControlSharingState> {
      const response = await callTool('get_sharing', id, {})
      const value = object(response.value)
      const graph = object(value?.graph)
      if (!value || graph?.owner !== response.owner || graph.graphId !== response.graphId) {
        throw new Error('Sharing view identity does not match the requested owner/graph')
      }
      if (!Array.isArray(value.links)) throw new Error('Sharing view returned no link list')
      const everyone = value.everyone === null || value.everyone === undefined ? null : object(value.everyone)
      if (value.everyone !== null && value.everyone !== undefined
        && (everyone?.principal !== EVERYONE_AUTHENTICATED || everyone.role !== 'viewer')) {
        throw new Error('Sharing view returned an invalid everyone grant')
      }
      const links = value.links.map(link => shareLink(link, response.owner, response.graphId))
      if (new Set(links.map(link => link.linkId)).size !== links.length) throw new Error('Sharing view returned duplicate links')
      return { everyone: everyone !== null, links }
    },
    /** Let every signed-in user view the graph (Viewer only), or stop that. */
    async setEveryone(id: string, enabled: boolean): Promise<void> {
      if (enabled) {
        const response = await call(id, { action: 'grant', principal: EVERYONE_AUTHENTICATED, role: 'viewer' })
        const row = object(response.value)
        if (row?.principal !== EVERYONE_AUTHENTICATED || row.role !== 'viewer') {
          throw new Error('Everyone grant acknowledgement does not match the request')
        }
        return
      }
      const response = await call(id, { action: 'revoke', principal: EVERYONE_AUTHENTICATED })
      if (object(response.value)?.revoked !== true) throw new Error('Everyone revoke returned no confirmed acknowledgement')
    },
    async createLink(id: string, request: ControlShareLinkCreate): Promise<ControlMintedShareLink> {
      if (request.role !== 'viewer' && request.role !== 'editor') throw new Error('Share link role must be viewer or editor')
      const expires = request.expiresInSeconds ?? null
      if (expires !== null && (!Number.isSafeInteger(expires) || expires < 60 || expires > 31_536_000)) {
        throw new Error('Share link lifetime must be between one minute and one year')
      }
      const label = request.label?.trim()
      const response = await callTool('manage_share_links', id, {
        action: 'create',
        role: request.role,
        ...(expires === null ? {} : { expiresInSeconds: expires }),
        ...(label ? { label } : {}),
      })
      const value = object(response.value)
      const link = shareLink(value, response.owner, response.graphId)
      if (link.role !== request.role) throw new Error('Share link acknowledgement does not match the requested role')
      return { link, token: shareLinkToken(value?.token as string) }
    },
    async revokeLink(id: string, linkId: string): Promise<void> {
      if (!LINK_ID.test(linkId)) throw new Error('Share link id is invalid')
      const response = await callTool('manage_share_links', id, { action: 'revoke', linkId })
      if (object(response.value)?.revoked !== true) throw new Error('Share link revoke returned no confirmed acknowledgement')
    },
    /** Join through a link: the caller receives the link's role on its graph. */
    async redeem(rawToken: string): Promise<ControlRedeemedShareLink> {
      const token = shareLinkToken(rawToken)
      const value = object(await rpc('redeem_share_link', { token }))
      const graph = object(value?.graph)
      if (!value || typeof graph?.graphId !== 'string' || !graph.graphId || (value.role !== 'viewer' && value.role !== 'editor')) {
        throw new Error('Share link redemption returned an invalid grant')
      }
      return { owner: accessUserPrincipal(graph.owner as string), graphId: graph.graphId, role: value.role }
    },
  }
}

/** The page URL that carries a share token in its fragment (never sent to servers). */
export function shareLinkUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/u, '')
  return `${base}/#share=${shareLinkToken(token)}`
}

/** Read a share token from a location fragment such as `#share=shr_…`. */
export function shareTokenFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const value = new URLSearchParams(raw).get('share')
  if (!value) return null
  try {
    return shareLinkToken(value)
  } catch {
    return null
  }
}
