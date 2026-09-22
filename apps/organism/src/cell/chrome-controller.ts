import type { CrdtProviderLifecycle, ProviderHandle } from '@shrubbery/nucleus'
import type {
  SidebarNode,
  SidebarSection,
  WorkspaceChromeBreadcrumb,
  WorkspaceChromeDocumentStats,
  WorkspaceChromePresencePerson,
} from '@shrubbery/runtime'
import {
  updateLocalPresenceProfile,
  type LocalPresenceProfilePatch,
  type PresenceActorType,
} from './crdt-presence.js'

interface AwarenessLike {
  readonly clientID?: number
  getStates(): Map<number, unknown>
  getLocalState?(): Record<string, unknown> | null
  setLocalState?(state: Record<string, unknown> | null): void
  setLocalStateField?(field: string, value: unknown): void
  on(event: 'change', callback: () => void): void
  off(event: 'change', callback: () => void): void
}

export interface OrganismChromePresenceSession {
  readonly awarenessClientId: string
  readonly clientId: string
  readonly deviceId: string | null
  readonly connectionEpoch: number
  readonly hasCursor: boolean
  readonly isLocal: boolean
}

export interface OrganismChromePresencePerson extends WorkspaceChromePresencePerson {
  /** Stable account/human identity; null only for legacy awareness payloads. */
  readonly humanId: string | null
  /** Number of legitimate logical tabs represented by this one human avatar. */
  readonly sessionCount: number
  readonly deviceCount: number
  readonly isSelf: boolean
  readonly clientIds: readonly string[]
  readonly type: PresenceActorType
  readonly sessions: readonly OrganismChromePresenceSession[]
}

export interface OrganismChromeSnapshotInput {
  readonly graphId: string
  readonly graphTitle?: string | null
  readonly documentId?: string | null
  readonly documentTitle?: string | null
  readonly sidebarSections?: readonly SidebarSection[]
  readonly editorText?: string | null
  readonly selectedCharacters?: number
  readonly blockType?: string | null
}

export interface OrganismChromeSnapshot {
  readonly breadcrumbs: readonly WorkspaceChromeBreadcrumb[]
  readonly itemCount: number
  readonly documentStats: WorkspaceChromeDocumentStats | null
  readonly presence: readonly WorkspaceChromePresencePerson[]
  readonly syncState: 'idle' | 'connecting' | 'synced' | 'reconnecting' | 'disconnected' | 'error'
  readonly runtimeMode: 'local' | 'hosted'
  readonly openPresenceId: string | null
  readonly followedPresenceClientId: string | null
  readonly selfPresenceEditable: boolean
  readonly presenceOverflowOpen: boolean
}

export interface OrganismChromeControllerOptions {
  readonly runtimeMode: 'local' | 'hosted'
  readonly requestRender: () => void
}

function awarenessLike(value: unknown): AwarenessLike | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AwarenessLike>
  return typeof candidate.getStates === 'function' &&
    typeof candidate.on === 'function' &&
    typeof candidate.off === 'function'
    ? candidate as AwarenessLike
    : null
}

function itemCount(nodes: readonly SidebarNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.kind === 'document' || node.kind === 'artifact') count += 1
    count += itemCount(node.children ?? [])
  }
  return count
}

export function sidebarItemCount(sections: readonly SidebarSection[] = []): number {
  return sections.reduce((total, section) => total + itemCount(section.nodes ?? []), 0)
}

export function projectDocumentStats(
  text: string | null | undefined,
  selectedCharacters = 0,
  blockType?: string | null,
): WorkspaceChromeDocumentStats | null {
  if (text == null) return null
  const trimmed = text.trim()
  const words = trimmed ? (trimmed.match(/\S+/gu)?.length ?? 0) : 0
  return {
    words,
    characters: Array.from(text).length,
    selectedCharacters: Math.max(0, selectedCharacters),
    blockType: blockType?.trim() || null,
    // Same 200wpm baseline as the OG bottom bar's formatReadingTime().
    readingTimeMinutes: words > 0 ? Math.ceil(words / 200) : 0,
  }
}

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
    // Invalid rich metadata is not identity evidence. Keep the otherwise-valid
    // visual state isolated by Yjs client ID; never name-deduplicate it.
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

export function projectPresence(awareness: unknown): OrganismChromePresencePerson[] {
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

  const result: OrganismChromePresencePerson[] = []
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

export class OrganismChromeController {
  private provider: ProviderHandle | null = null
  private awareness: AwarenessLike | null = null
  private unsubscribeLifecycle: (() => void) | null = null
  private everSynchronized = false
  private syncState: OrganismChromeSnapshot['syncState'] = 'idle'
  private renderQueued = false
  private destroyed = false
  private openPresenceId: string | null = null
  private followedPresenceClientId: string | null = null
  private presenceOverflowOpen = false
  private readonly onAwarenessChange = (): void => this.requestRender()

  constructor(private readonly options: OrganismChromeControllerOptions) {}

  private requestRender(): void {
    if (this.destroyed || this.renderQueued) return
    this.renderQueued = true
    queueMicrotask(() => {
      this.renderQueued = false
      if (!this.destroyed) this.options.requestRender()
    })
  }

  bindProvider(provider: ProviderHandle | null): void {
    if (provider === this.provider) return
    this.awareness?.off('change', this.onAwarenessChange)
    this.unsubscribeLifecycle?.()
    this.unsubscribeLifecycle = null
    this.provider = provider
    this.awareness = awarenessLike(provider?.awareness)
    this.awareness?.on('change', this.onAwarenessChange)
    this.everSynchronized = false
    if (!provider) {
      this.syncState = 'idle'
      this.openPresenceId = null
      this.followedPresenceClientId = null
      this.presenceOverflowOpen = false
    } else {
      const project = (lifecycle: CrdtProviderLifecycle): void => {
        if (provider !== this.provider) return
        this.everSynchronized ||= lifecycle.synchronized
        const next = lifecycle.connection === 'connected' && lifecycle.synchronized
          ? 'synced'
          : !lifecycle.shouldConnect && lifecycle.connection === 'disconnected'
            ? 'disconnected'
            : this.everSynchronized
              ? 'reconnecting'
              : 'connecting'
        if (next === this.syncState) return
        this.syncState = next
        this.requestRender()
      }
      project(provider.lifecycle.get())
      this.unsubscribeLifecycle = provider.lifecycle.subscribe(project)
    }
    this.requestRender()
  }

  snapshot(input: OrganismChromeSnapshotInput): OrganismChromeSnapshot {
    const presence = projectPresence(this.provider?.awareness)
    if (this.openPresenceId && !presence.some(person => person.id === this.openPresenceId)) {
      this.openPresenceId = null
    }
    if (this.followedPresenceClientId && !presence.some(person =>
      person.sessions.some(session => session.clientId === this.followedPresenceClientId))) {
      this.followedPresenceClientId = null
    }
    const breadcrumbs: WorkspaceChromeBreadcrumb[] = [{
      id: input.graphId,
      label: input.graphTitle?.trim() || input.graphId,
      kind: 'graph',
      current: !input.documentId,
    }]
    if (input.documentId) {
      breadcrumbs.push({
        id: input.documentId,
        label: input.documentTitle?.trim() || input.documentId,
        kind: 'document',
        current: true,
      })
    }
    return {
      breadcrumbs,
      itemCount: sidebarItemCount(input.sidebarSections),
      documentStats: projectDocumentStats(
        input.editorText,
        input.selectedCharacters,
        input.blockType,
      ),
      presence,
      syncState: this.syncState,
      runtimeMode: this.options.runtimeMode,
      openPresenceId: this.openPresenceId,
      followedPresenceClientId: this.followedPresenceClientId,
      selfPresenceEditable: this.canEditSelfPresence(),
      presenceOverflowOpen: this.presenceOverflowOpen,
    }
  }

  openPresence(personId: string): void {
    const id = personId.trim()
    this.openPresenceId = this.openPresenceId === id ? null : id || null
    this.presenceOverflowOpen = false
    this.requestRender()
  }

  closePresence(): void {
    if (!this.openPresenceId) return
    this.openPresenceId = null
    this.requestRender()
  }

  setPresenceOverflowOpen(open: boolean): void {
    this.presenceOverflowOpen = open
    if (open) this.openPresenceId = null
    this.requestRender()
  }

  setFollowedPresenceClient(clientId: string, following: boolean): void {
    const id = clientId.trim()
    this.followedPresenceClientId = following && id ? id : null
    this.requestRender()
  }

  updateSelfPresence(personId: string, patch: LocalPresenceProfilePatch): boolean {
    const person = projectPresence(this.provider?.awareness).find(candidate => candidate.id === personId)
    if (!person?.isSelf || person.type !== 'human' || !this.awareness) return false
    const updated = updateLocalPresenceProfile(this.awareness as AwarenessLike & {
      setLocalStateField(field: string, value: unknown): void
    }, patch)
    if (!updated) return false
    this.requestRender()
    return true
  }

  interactionState(): Pick<OrganismChromeSnapshot,
    'openPresenceId' | 'followedPresenceClientId' | 'selfPresenceEditable' | 'presenceOverflowOpen'> {
    return {
      openPresenceId: this.openPresenceId,
      followedPresenceClientId: this.followedPresenceClientId,
      selfPresenceEditable: this.canEditSelfPresence(),
      presenceOverflowOpen: this.presenceOverflowOpen,
    }
  }

  private canEditSelfPresence(): boolean {
    return Boolean(this.awareness?.getLocalState
      && (this.awareness.setLocalState || this.awareness.setLocalStateField))
  }

  destroy(): void {
    this.awareness?.off('change', this.onAwarenessChange)
    this.unsubscribeLifecycle?.()
    this.unsubscribeLifecycle = null
    this.awareness = null
    this.provider = null
    this.everSynchronized = false
    this.syncState = 'idle'
    this.openPresenceId = null
    this.followedPresenceClientId = null
    this.presenceOverflowOpen = false
    this.destroyed = true
  }
}

function shadowRootsBelow(root: ParentNode): ShadowRoot[] {
  const roots: ShadowRoot[] = []
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      roots.push(element.shadowRoot)
      roots.push(...shadowRootsBelow(element.shadowRoot))
    }
  }
  return roots
}

/**
 * Mark and reveal the exact logical tab cursor selected by the controlled
 * inspector. Cursor widgets carry this stable key from their awareness user
 * payload; names and colors are intentionally never used as identity.
 */
export function revealFollowedPresenceCursor(
  root: ParentNode,
  clientId: string | null,
): HTMLElement | null {
  const scopes: ParentNode[] = [root, ...shadowRootsBelow(root)]
  const cursors = scopes.flatMap(scope =>
    [...scope.querySelectorAll<HTMLElement>('.ProseMirror-yjs-cursor')])
  for (const cursor of cursors) cursor.removeAttribute('data-presence-followed')
  if (!clientId) return null
  const target = cursors.find(cursor => cursor.dataset.presenceClientId === clientId) ?? null
  if (!target) return null
  target.dataset.presenceFollowed = 'true'
  target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  return target
}
