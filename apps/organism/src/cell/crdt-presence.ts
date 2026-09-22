/**
 * Shell-owned CRDT presence identity and lifecycle.
 *
 * `user` remains the yCursorPlugin-compatible visual payload. `presence` is the
 * lifecycle payload: stable human identity, stable browser/device identity,
 * stable tab/client identity, physical room location, and a monotonically
 * increasing connection epoch. Gardend uses the latter to supersede only an
 * old incarnation of the same logical tab; two tabs owned by one human remain
 * legitimate peers.
 */

export interface AwarenessWriter {
  setLocalStateField(field: string, value: unknown): void
  setLocalState?(state: Record<string, unknown> | null): void
  getLocalState?(): Record<string, unknown> | null
}

export type PresenceActorType = 'human' | 'agent'

export interface PresenceUser {
  readonly userId: string
  readonly name: string
  readonly color: string
  readonly type: PresenceActorType
  /** Stable logical tab identity, also copied onto cursor DOM by the editor. */
  readonly clientId?: string
  /** Stable browser/profile identity; explanatory only, never used to collapse tabs. */
  readonly deviceId?: string
}

export type PresenceRoomKind = 'workspace' | 'document'

export interface PresenceRoomLocation {
  readonly graphId: string
  readonly kind: PresenceRoomKind
  readonly documentId?: string
}

export interface CrdtPresenceRoom {
  readonly graphId: string
  readonly kind: 'workspace' | 'doc'
  readonly docId?: string
}

export interface PresenceLifecycleIdentity {
  readonly schemaVersion: 1
  readonly humanId: string
  readonly deviceId: string
  readonly clientId: string
  readonly connectionEpoch: number
  readonly room: PresenceRoomLocation
  readonly publishedAt: number
}

export interface LocalPresenceState {
  readonly user: PresenceUser
  readonly presence: PresenceLifecycleIdentity
}

export interface PresenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface PresenceIdentityControllerOptions {
  /** Stable browser/profile identity. Inject this in deterministic journeys. */
  readonly deviceId?: string
  /** Stable top-level browsing-context identity. Inject this for multi-tab tests. */
  readonly clientId?: string
  readonly deviceStorage?: PresenceStorage | null
  readonly clientStorage?: PresenceStorage | null
  /** Cross-tab lease store used to detect sessionStorage copied by Duplicate Tab/window.open. */
  readonly clientLeaseStorage?: PresenceStorage | null
  /** Deterministic browsing-context owner for collision tests. */
  readonly clientLeaseOwnerId?: string
  readonly navigationType?: 'navigate' | 'reload' | 'back_forward' | 'prerender' | null
  readonly createId?: () => string
  readonly now?: () => number
}

export const PRESENCE_COLORS = Object.freeze([
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#c026d3',
])

const DEVICE_ID_KEY = 'garden.presence.device-id.v1'
const CLIENT_ID_KEY = 'garden.presence.client-id.v1'
const CONNECTION_EPOCH_KEY = 'garden.presence.connection-epoch.v1'
const PROFILE_KEY_PREFIX = 'garden.presence.profile.v1:'
const CLIENT_LEASE_KEY_PREFIX = 'garden.presence.client-lease.v1:'
const CLIENT_LEASE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const PAGE_LEASE_OWNER_ID = randomId()

interface ClientLease {
  readonly ownerId: string
  readonly claimedAt: number
}

interface ClaimedClientLease {
  readonly storage: PresenceStorage
  readonly key: string
  readonly ownerId: string
}

const claimedClientLeases = new Map<string, ClaimedClientLease>()
let clientLeaseLifecycleInstalled = false

export interface LocalPresenceProfile {
  readonly name: string
  readonly color: string
}

export interface LocalPresenceProfilePatch {
  readonly name?: string
  readonly color?: string
}

function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): PresenceStorage | null {
  try {
    const storage = globalThis[kind]
    return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : null
  } catch {
    return null
  }
}

function storedIdentity(
  explicit: string | undefined,
  storage: PresenceStorage | null,
  key: string,
  create: () => string,
): string {
  if (explicit?.trim()) return explicit.trim()
  try {
    const existing = storage?.getItem(key)?.trim()
    if (existing) return existing
    const next = create()
    storage?.setItem(key, next)
    return next
  } catch {
    return create()
  }
}

function leaseKey(clientId: string): string {
  return `${CLIENT_LEASE_KEY_PREFIX}${encodeURIComponent(clientId)}`
}

function readClientLease(storage: PresenceStorage, key: string): ClientLease | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as { ownerId?: unknown; claimedAt?: unknown }
    return typeof value.ownerId === 'string'
      && value.ownerId.trim()
      && typeof value.claimedAt === 'number'
      && Number.isFinite(value.claimedAt)
      ? { ownerId: value.ownerId, claimedAt: value.claimedAt }
      : null
  } catch {
    return null
  }
}

function releaseClientLease(claim: ClaimedClientLease): void {
  try {
    const current = readClientLease(claim.storage, claim.key)
    if (current?.ownerId !== claim.ownerId) return
    if (typeof claim.storage.removeItem === 'function') claim.storage.removeItem(claim.key)
    else claim.storage.setItem(claim.key, '')
  } catch {
    // A stale lease is safe: the next page creates a fresh logical tab ID.
  }
}

function installClientLeaseLifecycle(): void {
  if (clientLeaseLifecycleInstalled || typeof globalThis.addEventListener !== 'function') return
  clientLeaseLifecycleInstalled = true
  globalThis.addEventListener('pagehide', (event: Event) => {
    if ((event as PageTransitionEvent).persisted) return
    for (const claim of claimedClientLeases.values()) releaseClientLease(claim)
    claimedClientLeases.clear()
  })
}

function browserNavigationType(): PresenceIdentityControllerOptions['navigationType'] {
  try {
    const entry = globalThis.performance?.getEntriesByType?.('navigation')[0] as
      | { readonly type?: unknown }
      | undefined
    return entry?.type === 'reload'
      || entry?.type === 'back_forward'
      || entry?.type === 'prerender'
      || entry?.type === 'navigate'
      ? entry.type
      : null
  } catch {
    return null
  }
}

function claimClientIdentity(options: {
  readonly candidate: string
  readonly explicit: boolean
  readonly clientStorage: PresenceStorage | null
  readonly leaseStorage: PresenceStorage | null
  readonly ownerId: string
  readonly navigationType: PresenceIdentityControllerOptions['navigationType']
  readonly create: () => string
  readonly now: () => number
}): string {
  if (options.explicit || !options.leaseStorage) return options.candidate
  let clientId = options.candidate
  const now = options.now()
  const existing = readClientLease(options.leaseStorage, leaseKey(clientId))
  const collision = existing
    && existing.ownerId !== options.ownerId
    && now - existing.claimedAt < CLIENT_LEASE_MAX_AGE_MS
    && options.navigationType !== 'reload'
  if (collision) {
    clientId = options.create()
    try {
      options.clientStorage?.setItem(CLIENT_ID_KEY, clientId)
      options.clientStorage?.setItem(CONNECTION_EPOCH_KEY, '0')
    } catch {
      // The in-memory regenerated identity still prevents this live collision.
    }
  }
  const key = leaseKey(clientId)
  try {
    options.leaseStorage.setItem(key, JSON.stringify({ ownerId: options.ownerId, claimedAt: now }))
    claimedClientLeases.set(key, { storage: options.leaseStorage, key, ownerId: options.ownerId })
    installClientLeaseLifecycle()
  } catch {
    // Server ownership remains the fallback if cross-tab storage is unavailable.
  }
  return clientId
}

function validEpoch(value: string | null | undefined): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function localPresenceUser(humanId: string, displayName = humanId): PresenceUser {
  return localPresenceUserWithColor(humanId, displayName)
}

function localPresenceUserWithColor(
  humanId: string,
  displayName = humanId,
  color?: string,
): PresenceUser {
  const stableHumanId = humanId.trim() || 'local-user'
  const name = displayName.trim() || 'You'
  return {
    userId: stableHumanId,
    name,
    color: validPresenceColor(color)
      ? color
      : PRESENCE_COLORS[hash(stableHumanId) % PRESENCE_COLORS.length],
    type: 'human',
  }
}

function profileKey(humanId: string): string {
  return `${PROFILE_KEY_PREFIX}${encodeURIComponent(humanId.trim() || 'local-user')}`
}

function validPresenceColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function readPresenceProfile(
  humanId: string,
  storage: PresenceStorage | null,
): LocalPresenceProfile | null {
  try {
    const raw = storage?.getItem(profileKey(humanId))
    if (!raw) return null
    const value = JSON.parse(raw) as { name?: unknown; color?: unknown }
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (!name || !validPresenceColor(value.color)) return null
    return { name, color: value.color }
  } catch {
    return null
  }
}

function writePresenceProfile(
  humanId: string,
  profile: LocalPresenceProfile,
  storage: PresenceStorage | null,
): void {
  try {
    storage?.setItem(profileKey(humanId), JSON.stringify(profile))
  } catch {
    // Awareness remains live even if browser policy makes persistence unavailable.
  }
}

export function presenceRoomLocation(room: CrdtPresenceRoom): PresenceRoomLocation {
  return room.kind === 'doc'
    ? { graphId: room.graphId, kind: 'document', ...(room.docId ? { documentId: room.docId } : {}) }
    : { graphId: room.graphId, kind: 'workspace' }
}

/** One controller per browser/tab shell. Its epoch survives reloads in session storage. */
export class PresenceIdentityController {
  readonly deviceId: string
  readonly clientId: string
  private readonly clientStorage: PresenceStorage | null
  private readonly profileStorage: PresenceStorage | null
  private readonly clientLease: ClaimedClientLease | null
  private readonly now: () => number
  private connectionEpoch: number

  constructor(options: PresenceIdentityControllerOptions = {}) {
    const create = options.createId ?? randomId
    const now = options.now ?? Date.now
    const deviceStorage = options.deviceStorage === undefined
      ? browserStorage('localStorage')
      : options.deviceStorage
    this.profileStorage = deviceStorage
    this.clientStorage = options.clientStorage === undefined
      ? browserStorage('sessionStorage')
      : options.clientStorage
    this.deviceId = storedIdentity(options.deviceId, deviceStorage, DEVICE_ID_KEY, create)
    const clientCandidate = storedIdentity(options.clientId, this.clientStorage, CLIENT_ID_KEY, create)
    const leaseStorage = options.clientLeaseStorage === undefined
      ? deviceStorage
      : options.clientLeaseStorage
    const leaseOwnerId = options.clientLeaseOwnerId?.trim() || PAGE_LEASE_OWNER_ID
    this.clientId = claimClientIdentity({
      candidate: clientCandidate,
      explicit: Boolean(options.clientId?.trim()),
      clientStorage: this.clientStorage,
      leaseStorage,
      ownerId: leaseOwnerId,
      navigationType: options.navigationType === undefined
        ? browserNavigationType()
        : options.navigationType,
      create,
      now,
    })
    this.clientLease = leaseStorage && !options.clientId?.trim()
      ? { storage: leaseStorage, key: leaseKey(this.clientId), ownerId: leaseOwnerId }
      : null
    this.connectionEpoch = validEpoch(this.clientStorage?.getItem(CONNECTION_EPOCH_KEY))
    this.now = now
  }

  next(humanId: string, room: PresenceRoomLocation, displayName = humanId): LocalPresenceState {
    if (this.clientLease) {
      try {
        this.clientLease.storage.setItem(this.clientLease.key, JSON.stringify({
          ownerId: this.clientLease.ownerId,
          claimedAt: this.now(),
        }))
      } catch {
        // Identity is already selected; lifecycle cleanup remains server-owned.
      }
    }
    this.connectionEpoch += 1
    try {
      this.clientStorage?.setItem(CONNECTION_EPOCH_KEY, String(this.connectionEpoch))
    } catch {
      // Storage can disappear mid-session (private mode / policy changes).
      // The in-memory monotonic epoch remains authoritative for this process.
    }
    const profile = readPresenceProfile(humanId, this.profileStorage)
    const baseUser = localPresenceUserWithColor(
      humanId,
      profile?.name ?? displayName,
      profile?.color,
    )
    const user: PresenceUser = {
      ...baseUser,
      clientId: this.clientId,
      deviceId: this.deviceId,
    }
    return {
      user,
      presence: {
        schemaVersion: 1,
        humanId: user.userId,
        deviceId: this.deviceId,
        clientId: this.clientId,
        connectionEpoch: this.connectionEpoch,
        room,
        publishedAt: this.now(),
      },
    }
  }
}

/**
 * Update the real local awareness profile and persist it for reconnects.
 * Stable identity and actor type are deliberately immutable here: this control
 * changes presentation, not authorization or lifecycle ownership.
 */
export function updateLocalPresenceProfile(
  awareness: AwarenessWriter,
  patch: LocalPresenceProfilePatch,
  options: { readonly storage?: PresenceStorage | null; readonly now?: () => number } = {},
): PresenceUser | null {
  const local = awareness.getLocalState?.()
  if (!local || typeof local !== 'object') return null
  const rawUser = local.user
  if (!rawUser || typeof rawUser !== 'object') return null
  const current = rawUser as Partial<PresenceUser>
  if (current.type === 'agent') return null
  const humanId = typeof current.userId === 'string' && current.userId.trim()
    ? current.userId.trim()
    : null
  const currentName = typeof current.name === 'string' ? current.name.trim() : ''
  const currentColor = validPresenceColor(current.color) ? current.color : null
  if (!humanId || !currentName || !currentColor) return null

  const requestedName = patch.name === undefined ? currentName : patch.name.trim()
  const requestedColor = patch.color === undefined ? currentColor : patch.color
  if (!requestedName || requestedName.length > 80 || !validPresenceColor(requestedColor)) return null
  const nextUser: PresenceUser = {
    ...current,
    userId: humanId,
    name: requestedName,
    color: requestedColor,
    type: 'human',
  }
  const storage = options.storage === undefined ? browserStorage('localStorage') : options.storage
  writePresenceProfile(humanId, { name: nextUser.name, color: nextUser.color }, storage)

  const rawPresence = local.presence
  const nextPresence = rawPresence && typeof rawPresence === 'object'
    ? { ...rawPresence as Record<string, unknown>, publishedAt: (options.now ?? Date.now)() }
    : rawPresence
  if (typeof awareness.setLocalState === 'function') {
    awareness.setLocalState({
      ...local,
      user: nextUser,
      ...(nextPresence === undefined ? {} : { presence: nextPresence }),
    })
  } else {
    awareness.setLocalStateField('user', nextUser)
    if (nextPresence !== undefined) awareness.setLocalStateField('presence', nextPresence)
  }
  return nextUser
}

export function installLocalPresence(
  awareness: AwarenessWriter,
  state: LocalPresenceState,
): PresenceUser
export function installLocalPresence(awareness: AwarenessWriter, userId: string): PresenceUser
export function installLocalPresence(
  awareness: AwarenessWriter,
  stateOrUserId: LocalPresenceState | string,
): PresenceUser {
  if (typeof stateOrUserId === 'string') {
    const user = localPresenceUser(stateOrUserId)
    awareness.setLocalStateField('user', user)
    return user
  }
  awareness.setLocalStateField('user', stateOrUserId.user)
  awareness.setLocalStateField('presence', stateOrUserId.presence)
  return stateOrUserId.user
}

/** Cooperative teardown. Hard-close cleanup is owned by gardend's socket seam. */
export function clearLocalPresence(awareness: AwarenessWriter): void {
  if (typeof awareness.setLocalState === 'function') {
    awareness.setLocalState(null)
    return
  }
  awareness.setLocalStateField('presence', null)
  awareness.setLocalStateField('user', null)
}
