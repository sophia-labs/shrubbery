/**
 * presence-projection.ts — the CRDT-awareness aggregation + self-profile
 * mutation logic, hoisted into `@shrubbery/runtime` so the `presence.
 * inspector` P2 face (`layout/faces/presence-inspector-face.ts`, north star
 * §2.2/§3's "5 trapped faces" wave) can drive REAL, non-mocked presence data
 * from inside a package that cannot import an app.
 *
 * WHY THIS FILE EXISTS (mirrors `editor-services/document-snapshot-
 * service.ts`'s own precedent, verbatim rationale): `apps/organism/src/cell/
 * chrome-controller.ts`'s `projectPresence` and `apps/organism/src/cell/
 * crdt-presence.ts`'s `updateLocalPresenceProfile` already implement this
 * EXACT aggregation/mutation over a real CRDT-awareness instance for the
 * production bottom-bar chrome — but both are private, app-local functions
 * apps/organism owns. The presence.inspector face needs the SAME logic from
 * inside `@shrubbery/runtime`, which cannot import an app. This module hoists
 * that logic to the same real behavior, decoupled from any one app's
 * controller class.
 *
 * `apps/organism/src/cell/chrome-controller.ts` and `crdt-presence.ts`'s own
 * copies are UNTOUCHED by this file (this wave's rule is "change of mount,
 * not rewrite" — de-duplicating the shell's inline copy in favor of this one
 * is a separate, later cleanup, exactly as `document-snapshot-service.ts`'s
 * own header already establishes for the analogous REST-transport hoist).
 * Every branch below is byte-for-byte the same aggregation contract
 * `chrome-controller.ts`'s `projectPresence` already exercises in production
 * (identity grouping by `humanId`, connection-epoch/publishedAt tie-breaking,
 * the "invalid rich metadata falls back to a legacy per-awareness-client
 * identity" branch) plus `crdt-presence.ts`'s `updateLocalPresenceProfile`
 * (self-rename/recolor, immutable identity/type) — wave1 review r1 WRONG:
 * this file used to hoist EVERY guard clause of that mutation EXCEPT its
 * `writePresenceProfile` localStorage side effect, so a self-rename/recolor
 * made through this leaf silently failed to survive a reconnect even though
 * the byte-identical edit made through chrome persisted. Fixed below: the
 * SAME storage key format (`garden.presence.profile.v1:{humanId}`), real
 * `window.localStorage` by default, injectable for tests.
 */

/** Duck-typed CRDT-awareness surface — mirrors `chrome-controller.ts`'s own local `AwarenessLike`. */
export interface PresenceAwarenessLike {
  readonly clientID?: number
  getStates(): Map<number, unknown>
  getLocalState?(): Record<string, unknown> | null
  setLocalState?(state: Record<string, unknown> | null): void
  setLocalStateField?(field: string, value: unknown): void
  on(event: 'change', callback: () => void): void
  off(event: 'change', callback: () => void): void
}

export type PresenceActorType = 'human' | 'agent'

export interface PresenceSession {
  readonly awarenessClientId: string
  readonly clientId: string
  readonly deviceId: string | null
  readonly connectionEpoch: number
  readonly hasCursor: boolean
  readonly isLocal: boolean
}

/**
 * One aggregated logical person — structurally a superset of
 * `@shrubbery/components`'s `ChromePresencePerson` (packages/runtime cannot
 * import `@shrubbery/components`; every field the real `<mn-presence-
 * inspector>` element's `.person` property reads is present here under the
 * same name, so a value of this shape is directly assignable to it with no
 * translation — mirrors `doc-history-face.ts`'s own `DocHistorySnapshot`
 * mirroring precedent).
 */
export interface PresencePerson {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly humanId: string | null
  readonly sessionCount: number
  readonly deviceCount: number
  readonly isSelf: boolean
  readonly clientIds: readonly string[]
  readonly type: PresenceActorType
  readonly sessions: readonly PresenceSession[]
}

export const PRESENCE_COLORS: readonly string[] = Object.freeze([
  '#e11d48',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#c026d3',
])

interface PresenceCandidate {
  readonly awarenessClientId: string
  readonly name: string
  readonly color: string
  readonly humanId: string | null
  readonly deviceId: string | null
  readonly clientId: string
  readonly connectionEpoch: number
  readonly publishedAt: number
  readonly logicalKey: string
  readonly isLocalAwarenessClient: boolean
  readonly type: PresenceActorType
  readonly hasCursor: boolean
}

function awarenessLike(value: unknown): PresenceAwarenessLike | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PresenceAwarenessLike>
  return typeof candidate.getStates === 'function'
    && typeof candidate.on === 'function'
    && typeof candidate.off === 'function'
    ? candidate as PresenceAwarenessLike
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function presenceCandidate(
  awarenessClientId: number,
  raw: unknown,
  localAwarenessClientId?: number,
): PresenceCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const user = (raw as { user?: unknown }).user
  if (!user || typeof user !== 'object') return null
  const name = nonEmptyString((user as { name?: unknown }).name)
  const color = nonEmptyString((user as { color?: unknown }).color)
  if (!name || !color || !/^#[0-9a-f]{6}$/i.test(color)) return null
  const type: PresenceActorType = (user as { type?: unknown }).type === 'agent' ? 'agent' : 'human'
  const cursor = (raw as { cursor?: unknown }).cursor
  const hasCursor = Boolean(cursor && typeof cursor === 'object'
    && 'anchor' in cursor && 'head' in cursor)

  const metadata = (raw as { presence?: unknown }).presence
  if (!metadata || typeof metadata !== 'object') {
    const legacyId = String(awarenessClientId)
    return {
      awarenessClientId: legacyId,
      name,
      color,
      humanId: null,
      deviceId: null,
      clientId: legacyId,
      connectionEpoch: 0,
      publishedAt: 0,
      logicalKey: `legacy:${legacyId}`,
      isLocalAwarenessClient: awarenessClientId === localAwarenessClientId,
      type,
      hasCursor,
    }
  }

  const humanId = nonEmptyString((metadata as { humanId?: unknown }).humanId)
  const deviceId = nonEmptyString((metadata as { deviceId?: unknown }).deviceId)
  const clientId = nonEmptyString((metadata as { clientId?: unknown }).clientId)
  const connectionEpoch = finiteNonNegativeInteger(
    (metadata as { connectionEpoch?: unknown }).connectionEpoch,
  )
  const publishedAt = finiteNonNegativeInteger((metadata as { publishedAt?: unknown }).publishedAt)
  if (!humanId || !deviceId || !clientId || connectionEpoch == null) {
    const legacyId = String(awarenessClientId)
    return {
      awarenessClientId: legacyId,
      name,
      color,
      humanId: null,
      deviceId: null,
      clientId: legacyId,
      connectionEpoch: 0,
      publishedAt: 0,
      logicalKey: `legacy:${legacyId}`,
      isLocalAwarenessClient: awarenessClientId === localAwarenessClientId,
      type,
      hasCursor,
    }
  }
  return {
    awarenessClientId: String(awarenessClientId),
    name,
    color,
    humanId,
    deviceId,
    clientId,
    connectionEpoch,
    publishedAt: publishedAt ?? 0,
    logicalKey: `${humanId}\u0000${deviceId}\u0000${clientId}`,
    isLocalAwarenessClient: awarenessClientId === localAwarenessClientId,
    type,
    hasCursor,
  }
}

function candidateIsNewer(candidate: PresenceCandidate, current: PresenceCandidate): boolean {
  if (candidate.connectionEpoch !== current.connectionEpoch) {
    return candidate.connectionEpoch > current.connectionEpoch
  }
  if (candidate.publishedAt !== current.publishedAt) return candidate.publishedAt > current.publishedAt
  return candidate.awarenessClientId.localeCompare(current.awarenessClientId) > 0
}

/** Aggregate a real (or duck-typed fake) CRDT-awareness instance's raw client states into logical people. */
export function projectPresence(awareness: unknown): PresencePerson[] {
  const source = awarenessLike(awareness)
  if (!source) return []
  const logicalSessions = new Map<string, PresenceCandidate>()
  for (const [clientId, raw] of source.getStates()) {
    const candidate = presenceCandidate(clientId, raw, source.clientID)
    if (!candidate) continue
    const current = logicalSessions.get(candidate.logicalKey)
    if (!current || candidateIsNewer(candidate, current)) {
      logicalSessions.set(candidate.logicalKey, candidate)
    }
  }

  const humans = new Map<string, PresenceCandidate[]>()
  for (const candidate of logicalSessions.values()) {
    const key = candidate.humanId
      ? `${candidate.type === 'agent' ? 'agent' : 'human'}:${candidate.humanId}`
      : candidate.logicalKey
    const sessions = humans.get(key) ?? []
    sessions.push(candidate)
    humans.set(key, sessions)
  }

  const result: PresencePerson[] = []
  for (const [groupId, sessions] of humans) {
    const canonical = sessions.reduce((best, candidate) => {
      if (candidate.isLocalAwarenessClient !== best.isLocalAwarenessClient) {
        return candidate.isLocalAwarenessClient ? candidate : best
      }
      return candidateIsNewer(candidate, best) ? candidate : best
    })
    result.push({
      id: canonical.humanId ? groupId : canonical.awarenessClientId,
      name: canonical.name,
      color: canonical.color,
      humanId: canonical.humanId,
      sessionCount: sessions.length,
      deviceCount: new Set(sessions.map(session => session.deviceId ?? session.clientId)).size,
      isSelf: sessions.some(session => session.isLocalAwarenessClient),
      clientIds: sessions.map(session => session.clientId).sort(),
      type: canonical.type,
      sessions: sessions
        .map(session => ({
          awarenessClientId: session.awarenessClientId,
          clientId: session.clientId,
          deviceId: session.deviceId,
          connectionEpoch: session.connectionEpoch,
          hasCursor: session.hasCursor,
          isLocal: session.isLocalAwarenessClient,
        }))
        .sort((left, right) => left.clientId.localeCompare(right.clientId)),
    })
  }
  return result.sort((a, b) =>
    Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** True iff `awareness` exposes a real local-state read+write pair (mirrors `chrome-controller.ts`'s own `canEditSelfPresence`). */
export function canEditSelfPresence(awareness: unknown): boolean {
  const source = awarenessLike(awareness)
  return Boolean(source?.getLocalState && (source.setLocalState || source.setLocalStateField))
}

function validPresenceColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export interface PresenceProfilePatch {
  readonly name?: string
  readonly color?: string
}

/**
 * Minimal storage seam — structurally IDENTICAL to `apps/organism/src/cell/
 * crdt-presence.ts`'s own (unexported) `PresenceStorage`, so the real
 * `window.localStorage` (or any object satisfying this shape) is directly
 * assignable with zero adapter code.
 */
export interface PresenceProfileStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// Byte-identical to `crdt-presence.ts`'s own (private) `PROFILE_KEY_PREFIX`/
// `profileKey` — REQUIRED, not incidental: a profile edit made through this
// face must land under the EXACT key `crdt-presence.ts`'s own
// `PresenceIdentityController` reads back on the next reconnect (same
// storage, same origin, same key), or the edit silently fails to survive a
// reload. Diverging this string is the actual bug wave1 review r1 WRONG
// found (persistence was dropped entirely, not just re-keyed).
const PRESENCE_PROFILE_KEY_PREFIX = 'garden.presence.profile.v1:'

// Mirror `crdt-presence.ts`'s own `browserStorage`: *accessing*
// `window.localStorage` can itself throw under browser storage policy (private
// mode / disabled storage), not just `setItem`. Reading it in a bare default
// argument would let that throw escape `updateLocalPresenceProfile` — the very
// "awareness stays live even when persistence is unavailable" tolerance the
// try/catch in `writePresenceProfile` was meant to give. Degrade to null here
// too, at the point of access.
function defaultPresenceStorage(): PresenceProfileStorage | null {
  try {
    if (typeof window === 'undefined') return null
    const storage = window.localStorage
    return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : null
  } catch {
    return null
  }
}

function presenceProfileKey(humanId: string): string {
  return `${PRESENCE_PROFILE_KEY_PREFIX}${encodeURIComponent(humanId.trim() || 'local-user')}`
}

function writePresenceProfile(
  humanId: string,
  profile: { readonly name: string; readonly color: string },
  storage: PresenceProfileStorage | null | undefined,
): void {
  try {
    storage?.setItem(presenceProfileKey(humanId), JSON.stringify(profile))
  } catch {
    // Awareness remains live even if browser policy makes persistence unavailable
    // (same tolerance `crdt-presence.ts`'s own `writePresenceProfile` gives).
  }
}

/**
 * Update the real local awareness profile — self-rename/recolor only.
 * Stable identity and actor type are deliberately immutable here: this
 * control changes presentation, not authorization or lifecycle ownership.
 * Same guard clauses as `crdt-presence.ts`'s `updateLocalPresenceProfile`,
 * INCLUDING its localStorage persistence side effect (wave1 review r1 WRONG:
 * this used to omit it, so a self-rename/recolor made through the LEAF
 * silently failed to survive a reconnect even though the identical edit made
 * through chrome did). `storage` defaults to the real `window.localStorage`
 * when available — pass `null` explicitly to skip persistence (tests).
 */
export function updateLocalPresenceProfile(
  awareness: unknown,
  patch: PresenceProfilePatch,
  storage: PresenceProfileStorage | null = defaultPresenceStorage(),
): { readonly name: string; readonly color: string } | null {
  const source = awarenessLike(awareness)
  const local = source?.getLocalState?.()
  if (!local || typeof local !== 'object') return null
  const rawUser = (local as { user?: unknown }).user
  if (!rawUser || typeof rawUser !== 'object') return null
  const current = rawUser as { type?: unknown; userId?: unknown; name?: unknown; color?: unknown }
  if (current.type === 'agent') return null
  const humanId = typeof current.userId === 'string' && current.userId.trim() ? current.userId.trim() : null
  const currentName = typeof current.name === 'string' ? current.name.trim() : ''
  const currentColor = validPresenceColor(current.color) ? current.color : null
  if (!humanId || !currentName || !currentColor) return null

  const requestedName = patch.name === undefined ? currentName : patch.name.trim()
  const requestedColor = patch.color === undefined ? currentColor : patch.color
  if (!requestedName || requestedName.length > 80 || !validPresenceColor(requestedColor)) return null
  const nextUser = { ...current, userId: humanId, name: requestedName, color: requestedColor, type: 'human' as const }

  const rawPresence = (local as { presence?: unknown }).presence
  const nextPresence = rawPresence && typeof rawPresence === 'object'
    ? { ...rawPresence as Record<string, unknown>, publishedAt: Date.now() }
    : rawPresence
  if (typeof source!.setLocalState === 'function') {
    source!.setLocalState({ ...local, user: nextUser, ...(nextPresence === undefined ? {} : { presence: nextPresence }) })
  } else {
    source!.setLocalStateField!('user', nextUser)
    if (nextPresence !== undefined) source!.setLocalStateField!('presence', nextPresence)
  }
  writePresenceProfile(humanId, { name: nextUser.name, color: nextUser.color }, storage)
  return { name: nextUser.name, color: nextUser.color }
}
