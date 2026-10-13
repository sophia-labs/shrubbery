/**
 * Self-host mode: this bundle served by a person's own gardend, same origin, at `/`.
 *
 * Chosen at BUILD time (`VITE_SHRUBBERY_SELF_HOST=1`, `pnpm build:selfhost`). The hosted build never
 * reads `/self-host.json`: on the hosted edge an unknown path can answer the app shell with a 200.
 *
 * The seam is the desktop app's local mode. There, Tauri hands the shell a loopback manifest and
 * the ordinary gardend contract takes over. Here the manifest is the page's own origin plus
 * `GET /self-host.json`, which says how the person got in:
 *   - `cloudflare-access`: Cloudflare Access is the login. The edge attaches its signed header to
 *     every request (the browser carries the Access cookie, WebSockets included), so the shell sends
 *     no Authorization and no bearer subprotocol. Sign out is Access's own logout path.
 *   - `key`: the open-URL `gardend serve` printed, `http://127.0.0.1:<port>/#key=<token>`. The key is
 *     stored in this browser and the fragment stripped; then it travels as `Authorization: Bearer`
 *     and the `bearer.<token>` WebSocket subprotocol, exactly as in local mode.
 * A page on a loopback origin (`127.0.0.1`, `localhost`) is always the person's own computer talking
 * to gardend directly: no Cloudflare edge is in the path, so it signs in with the key even when
 * gardend says `cloudflare-access` (gardend takes a valid bearer before looking for an Access pass).
 *
 * Nothing here talks to a gateway, Cognito or Choreograph.
 */

import type { MnSettingsActionDetail, MnSettingsSection } from '@shrubbery/components'
import { createGardendContract, type GardendContract } from './gardend-contract.js'
import type { LoopbackTransport } from './loopback-mcp.js'
import { CELL_ERROR_PANEL_CLASS } from './default-workspace-ui.js'
import {
  DefaultOrganismSettingsService,
  createDefaultSettingsService,
  type DefaultSettingsServiceOptions,
  type OrganismSettingsSnapshot,
} from './settings-service.js'
import { openLocalCellGraph } from './tauri-local-bootstrap.js'

export const SELF_HOST_DESCRIPTOR_PATH = '/self-host.json'
export const SELF_HOST_KEY_STORAGE_KEY = 'sophia.self-host.key'
export const CLOUDFLARE_ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout'
const DESCRIPTOR_KIND = 'gardend-self-host'

export type SelfHostAuthMode = 'cloudflare-access' | 'key'

/** `GET /self-host.json` (gardend serves it, public, no auth). */
export interface SelfHostDescriptor {
  readonly kind: typeof DESCRIPTOR_KIND
  readonly version: string
  readonly auth: SelfHostAuthMode
  /** Filled when a valid Access JWT came with the request. */
  readonly user: { readonly email: string } | null
}

/** The page is on this computer's loopback, where no Cloudflare edge can add an Access pass. */
export function isLoopbackOrigin(origin: string): boolean {
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

/**
 * How this page signs in: gardend's mode, except on a loopback origin, where the key is the only
 * credential that can reach gardend (Access attaches its pass at the Cloudflare edge, not here).
 */
export function selfHostSignIn(descriptor: Pick<SelfHostDescriptor, 'auth'>, origin: string): SelfHostAuthMode {
  return descriptor.auth === 'cloudflare-access' && isLoopbackOrigin(origin) ? 'key' : descriptor.auth
}

/** The self-host build flag, read the same way as `VITE_SHRUBBERY_FLOW_APP`. */
export function selfHostBuild(env: Readonly<Record<string, unknown>> | undefined): boolean {
  const value = env?.VITE_SHRUBBERY_SELF_HOST
  return typeof value === 'string' && value.trim() === '1'
}

export function parseSelfHostDescriptor(value: unknown): SelfHostDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${SELF_HOST_DESCRIPTOR_PATH} is not a JSON object`)
  }
  const record = value as Record<string, unknown>
  if (record.kind !== DESCRIPTOR_KIND) {
    throw new Error(`${SELF_HOST_DESCRIPTOR_PATH} is not a gardend self-host descriptor (kind ${JSON.stringify(record.kind)})`)
  }
  if (record.auth !== 'cloudflare-access' && record.auth !== 'key') {
    throw new Error(`${SELF_HOST_DESCRIPTOR_PATH} names an unknown auth mode ${JSON.stringify(record.auth)}`)
  }
  const rawUser = record.user
  const email = rawUser && typeof rawUser === 'object' && !Array.isArray(rawUser)
    ? (rawUser as Record<string, unknown>).email
    : undefined
  return {
    kind: DESCRIPTOR_KIND,
    version: typeof record.version === 'string' ? record.version : '',
    auth: record.auth,
    user: typeof email === 'string' && email.trim() ? { email: email.trim() } : null,
  }
}

export async function readSelfHostDescriptor(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<SelfHostDescriptor> {
  const response = await fetchImpl(SELF_HOST_DESCRIPTOR_PATH, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`${SELF_HOST_DESCRIPTOR_PATH} answered HTTP ${response.status}. Is this page served by gardend?`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`${SELF_HOST_DESCRIPTOR_PATH} did not answer JSON. Is this page served by gardend?`)
  }
  return parseSelfHostDescriptor(body)
}

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The `key` part of a fragment such as `#key=abc` or `#key=abc&evidence=x`; the token is taken verbatim. */
export function keyFromFragment(hash: string): { readonly key: string | null; readonly rest: string } {
  const parts = hash.replace(/^#/, '').split('&').filter(Boolean)
  let key: string | null = null
  const rest: string[] = []
  for (const part of parts) {
    if (part.startsWith('key=')) {
      let value = part.slice(4)
      try { value = decodeURIComponent(value) } catch { /* keep it as typed */ }
      key = value.trim() || null
    } else {
      rest.push(part)
    }
  }
  return { key, rest: rest.join('&') }
}

/** Pull a key out of whatever the person pasted: the whole open-URL, a `#key=…` fragment, or the bare key. */
export function keyFromPastedText(text: string): string | null {
  const value = text.trim()
  if (!value) return null
  const hashAt = value.indexOf('#')
  if (hashAt >= 0) return keyFromFragment(value.slice(hashAt)).key
  if (value.startsWith('key=')) return keyFromFragment(value).key
  // A bare key is one token-shaped word; an address without a fragment is not a key.
  return /^[A-Za-z0-9._~+=-]+$/.test(value) ? value : null
}

/**
 * Take `#key=<token>` from the address on first load: store it, strip it from the address (other
 * fragment parts stay), and return the key in effect, the URL's first, else the one already stored.
 */
export function claimSelfHostKey(
  url: URL,
  storage: KeyStorage | null,
  replaceUrl: (url: string) => void,
): string | null {
  const { key, rest } = keyFromFragment(url.hash)
  if (/(^#|&)key=/.test(url.hash)) {
    replaceUrl(`${url.pathname}${url.search}${rest ? `#${rest}` : ''}`)
  }
  if (key) {
    try { storage?.setItem(SELF_HOST_KEY_STORAGE_KEY, key) } catch { /* the key still works for this load */ }
    return key
  }
  try { return storage?.getItem(SELF_HOST_KEY_STORAGE_KEY)?.trim() || null } catch { return null }
}

export function forgetSelfHostKey(storage: KeyStorage | null): void {
  try { storage?.removeItem(SELF_HOST_KEY_STORAGE_KEY) } catch { /* nothing stored */ }
}

/** The same-origin transport: gardend's API at the root, absolute so every REST base is non-empty. */
export function selfHostTransport(origin: string, token: string | undefined): LoopbackTransport {
  const root = origin.replace(/\/+$/, '')
  return {
    mcpUrl: `${root}/mcp`,
    healthUrl: `${root}/health`,
    ...(token ? { token } : {}),
    transport: 'fetch',
  }
}

export interface SelfHostSession {
  readonly descriptor: SelfHostDescriptor
  readonly origin: string
  /** How this page signed in ({@link selfHostSignIn}): a loopback page uses the key even under Access. */
  readonly auth: SelfHostAuthMode
  /** The key this browser holds (key mode only). Cloudflare Access mode sends no bearer at all. */
  readonly token: string | undefined
  /** Who the cell sees: the Access email, else this self-host. */
  readonly userId: string
  readonly email: string | null
  signOut(): void
}

let activeSession: SelfHostSession | null = null

/** The session the self-host boot established, or null in every other build and boot path. */
export function activeSelfHostSession(): SelfHostSession | null {
  return activeSession
}

function createSession(
  descriptor: SelfHostDescriptor,
  auth: SelfHostAuthMode,
  origin: string,
  token: string | undefined,
  storage: KeyStorage | null,
  assign: (url: string) => void,
): SelfHostSession {
  const email = auth === 'cloudflare-access' ? descriptor.user?.email ?? null : null
  return {
    descriptor,
    origin,
    auth,
    token,
    userId: email ?? 'garden-self-host',
    email,
    signOut() {
      if (auth === 'cloudflare-access') {
        assign(CLOUDFLARE_ACCESS_LOGOUT_PATH)
        return
      }
      forgetSelfHostKey(storage)
      assign('/')
    },
  }
}

/**
 * gardend refusing an act the person's grant does not cover: MCP answers JSON-RPC -32003
 * "loopback token missing required scope …", REST answers HTTP 403.
 */
export function isPermissionRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  const status = (error as { status?: unknown }).status
  return code === -32003 || code === 403 || status === 403 || /missing required scope/.test(error.message)
}

export class SelfHostAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SelfHostAccessError'
  }
}

/**
 * One cheap authenticated call (`initialize`) before anything else, so a revoked key turns into the
 * key screen rather than a workspace error, and a person Access admitted but gardend did not gets a
 * plain sentence.
 */
async function probeAccess(transport: LoopbackTransport, fetchImpl: typeof fetch): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (transport.token) headers.Authorization = `Bearer ${transport.token}`
  const response = await fetchImpl(transport.mcpUrl, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'self-host-probe',
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sophia-self-host', version: '1' } },
    }),
  })
  if (response.ok) return
  const body = await response.text().catch(() => '')
  throw new SelfHostAccessError(
    `gardend answered HTTP ${response.status} at ${transport.mcpUrl}${body ? `: ${body.slice(0, 300)}` : ''}`,
    response.status,
  )
}

export type SelfHostBoot =
  | {
      readonly kind: 'ready'
      readonly session: SelfHostSession
      readonly contract: GardendContract
      readonly graphId: string
      readonly seededUxConfig: boolean
      /** False once gardend has refused this person a graph write (they are a member, not an admin). */
      readonly mayCreateGraphs: boolean
    }
  | { readonly kind: 'needs-key'; readonly reason: 'missing' | 'rejected' }

export interface SelfHostBootOptions {
  readonly location: Pick<Location, 'href' | 'origin'>
  readonly storage: KeyStorage | null
  readonly replaceUrl: (url: string) => void
  readonly assign: (url: string) => void
  readonly requestedGraphId?: string | null
  readonly storedGraphId?: string | null
  readonly fetch?: typeof fetch
}

/** Resolve the self-host's own gardend and return the normal live-cell contract on a chosen graph. */
export async function bootstrapSelfHostCell(options: SelfHostBootOptions): Promise<SelfHostBoot> {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const descriptor = await readSelfHostDescriptor(fetchImpl)
  const url = new URL(options.location.href)
  const origin = options.location.origin
  const auth = selfHostSignIn(descriptor, origin)
  let token: string | undefined
  if (auth === 'key') {
    token = claimSelfHostKey(url, options.storage, options.replaceUrl) ?? undefined
    if (!token) return { kind: 'needs-key', reason: 'missing' }
  } else if (/(^#|&)key=/.test(url.hash)) {
    // A key link opened through Access: the key is not needed, and must not linger in the address.
    claimSelfHostKey(url, null, options.replaceUrl)
  }

  const transport = selfHostTransport(origin, token)
  try {
    await probeAccess(transport, fetchImpl)
  } catch (error) {
    if (error instanceof SelfHostAccessError && auth === 'key' && error.status === 401) {
      forgetSelfHostKey(options.storage)
      return { kind: 'needs-key', reason: 'rejected' }
    }
    if (error instanceof SelfHostAccessError && auth === 'cloudflare-access' && (error.status === 401 || error.status === 403)) {
      throw new Error(
        `Cloudflare Access let you in, but this Sophia did not accept the sign-in${descriptor.user?.email ? ` for ${descriptor.user.email}` : ''}. `
        + `Ask its owner to add your email to gardend's Access settings.\n\n${error.message}`,
      )
    }
    throw error
  }

  const session = createSession(descriptor, auth, origin, token, options.storage, options.assign)
  const contract = createGardendContract({ transport, userId: session.userId })
  const { graphId, seededUxConfig, refused } = await openLocalCellGraph(contract, {
    requestedGraphId: options.requestedGraphId,
    storedGraphId: options.storedGraphId,
    // A member (an Access login outside the admin list, or a scoped key) may not load RDF or
    // create graphs: the layout seed is skipped and the built-in default layout is shown.
    tolerateRefusal: isPermissionRefusal,
  })
  activeSession = session
  return { kind: 'ready', session, contract, graphId, seededUxConfig, mayCreateGraphs: !refused }
}

/** The short screen shown when a key-mode self-host is opened without its key. */
export function renderSelfHostKeyScreen(
  host: HTMLElement,
  options: {
    readonly reason: 'missing' | 'rejected'
    readonly onKey: (key: string) => void
  },
): HTMLElement {
  const doc = host.ownerDocument
  for (const child of Array.from(host.children)) {
    if (child.classList.contains('boot-placeholder') || child.classList.contains('self-host-key')) child.remove()
  }
  const panel = doc.createElement('section')
  // Same frame as the cell error panel, so it reads as part of the app.
  panel.className = `${CELL_ERROR_PANEL_CLASS} self-host-key`
  panel.setAttribute('aria-labelledby', 'self-host-key-title')

  const title = doc.createElement('div')
  title.id = 'self-host-key-title'
  title.className = `${CELL_ERROR_PANEL_CLASS}__title`
  title.textContent = 'Open Sophia with your link'
  panel.appendChild(title)

  const lines = options.reason === 'rejected'
    ? [
        'This browser had a key, but your Sophia did not accept it. It may have been revoked.',
        'Open the link that `gardend serve` printed when it started, or paste it here.',
      ]
    : [
        'This Sophia runs on your own computer, and this browser does not have its key yet.',
        'Open the link that `gardend serve` printed when it started (it ends in #key=…), or paste it here.',
      ]
  for (const line of lines) {
    const p = doc.createElement('p')
    p.style.cssText = 'max-width:min(480px,90%);margin:0;font-size:14px;line-height:1.5'
    p.textContent = line
    panel.appendChild(p)
  }

  const form = doc.createElement('form')
  form.className = 'self-host-key__form'
  const input = doc.createElement('input')
  input.type = 'password'
  input.autocomplete = 'off'
  input.placeholder = 'http://127.0.0.1:…/#key=…'
  input.setAttribute('aria-label', 'Sophia link or key')
  input.style.cssText = 'width:100%;box-sizing:border-box;font:inherit;padding:6px 8px'
  const submit = doc.createElement('button')
  submit.type = 'submit'
  submit.className = `${CELL_ERROR_PANEL_CLASS}__retry`
  submit.textContent = 'Open'
  const problem = doc.createElement('p')
  problem.className = `${CELL_ERROR_PANEL_CLASS}__message`
  problem.setAttribute('role', 'status')
  problem.hidden = true
  form.style.cssText = 'width:min(480px,90%);display:flex;flex-direction:column;align-items:center;gap:8px'
  form.append(input, submit, problem)
  form.addEventListener('submit', event => {
    event.preventDefault()
    const key = keyFromPastedText(input.value)
    if (!key) {
      problem.hidden = false
      problem.textContent = 'That does not look like the link. It ends in #key= followed by the key.'
      return
    }
    options.onKey(key)
  })
  panel.appendChild(form)
  host.appendChild(panel)
  return panel
}

/**
 * Start again from the root with a pasted key in the address, as if the person had opened the link.
 * (`reloadAt` must really reload: a change of fragment alone does not.)
 */
export function acceptPastedSelfHostKey(key: string, reloadAt: (url: string) => void): void {
  reloadAt(`/#key=${encodeURIComponent(key)}`)
}

function selfHostAccountSection(section: MnSettingsSection, session: SelfHostSession): MnSettingsSection {
  const signOut = session.auth === 'cloudflare-access'
    ? { id: 'sign-out', label: 'Sign out', description: 'End the Cloudflare Access sign-in in this browser.', variant: 'danger' as const }
    : { id: 'sign-out', label: 'Forget this key', description: 'Remove the key from this browser. Open the link gardend serve printed to come back.', variant: 'danger' as const }
  return {
    ...section,
    metrics: [
      ...(section.metrics ?? []).map(metric => metric.id === 'runtime'
        ? { ...metric, value: 'Self-hosted' }
        : metric.id === 'identity' && session.email ? { ...metric, value: session.email } : metric),
      { id: 'sign-in', label: 'Sign-in', value: session.auth === 'cloudflare-access' ? 'Cloudflare Access' : 'Key' },
    ],
    actions: [...(section.actions ?? []).filter(action => action.id !== 'sign-out'), signOut],
  }
}

/** Settings over a self-host: the Access identity (or the key), and a way out of it. */
export class SelfHostSettingsService extends DefaultOrganismSettingsService {
  constructor(options: DefaultSettingsServiceOptions, private readonly session: SelfHostSession) {
    super(options)
  }

  override async load(): Promise<OrganismSettingsSnapshot> {
    const snapshot = await super.load()
    return {
      ...snapshot,
      userName: this.session.email ?? snapshot.userName,
      userEmail: this.session.email ?? snapshot.userEmail,
      sections: snapshot.sections.map(section => section.id === 'account'
        ? selfHostAccountSection(section, this.session)
        : section),
    }
  }

  override async action(detail: MnSettingsActionDetail): Promise<void> {
    if (detail.actionId === 'sign-out') {
      this.session.signOut()
      return
    }
    await super.action(detail)
  }
}

/** The settings service for the shell: the self-host one when this boot is a self-host. */
export function createShellSettingsService(options: DefaultSettingsServiceOptions): DefaultOrganismSettingsService {
  const session = activeSelfHostSession()
  return session ? new SelfHostSettingsService(options, session) : createDefaultSettingsService(options)
}
