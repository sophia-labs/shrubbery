/**
 * Hosted canonical control-MCP member-grant controller.
 *
 * The reusable access component receives only this controller's immutable
 * projection. Authentication and owner-only mutations stay on the Organism
 * side of the shell boundary and use GatewayTransport's token-fresh methods.
 */

import { t, type ConfirmOpts } from '@shrubbery/nucleus'
import {
  accessEmail,
  accessUserPrincipal,
  leaveRefusalMessage,
  publicViewUrl,
  shareLinkUrl,
  type ControlMintedShareLink,
  type ControlPerson,
  type ControlPublicLink,
  type ControlPublicLinkCreate,
  type ControlShareLinkCreate,
  type ControlShareWithEmailResult,
  type ControlSharingState,
} from '@shrubbery/source/access-control'
import type {
  WorkspaceAccessAddDetail,
  WorkspaceAccessBusyAction,
  WorkspaceAccessGrant,
  WorkspaceAccessInvitationCancelDetail,
  WorkspaceAccessInviteDetail,
  WorkspaceAccessInviteResult,
  WorkspaceAccessOptions,
  WorkspaceAccessRemoveDetail,
  WorkspaceAccessRole,
  WorkspaceAccessRoleChangeDetail,
  WorkspaceAccessSharing,
  WorkspaceEveryoneChangeDetail,
  WorkspaceGeneralAccess,
  WorkspaceGeneralAccessChangeDetail,
  WorkspaceShareLinkCreateDetail,
  WorkspaceShareLinkRevokeDetail,
  WorkspaceSharingBusyAction,
} from '@shrubbery/runtime'
import type { GatewayAccessGrant, GatewayPutAccessRequest } from './gateway-transport.js'

export interface AccessGrantGateway {
  access(graphId: string): Promise<readonly GatewayAccessGrant[]>
  putAccess(graphId: string, userId: string, request: GatewayPutAccessRequest): Promise<void>
  deleteAccess(graphId: string, userId: string): Promise<void>
  /** Optional sharing capability; absent gateways keep the member-only dialog. */
  sharing?(graphId: string): Promise<ControlSharingState>
  setEveryoneAccess?(graphId: string, enabled: boolean): Promise<void>
  createShareLink?(graphId: string, request: ControlShareLinkCreate): Promise<ControlMintedShareLink>
  revokeShareLink?(graphId: string, linkId: string): Promise<void>
  /** Add a person by email (grant a known account, else invite). Absent: the dialog adds typed user ids only. */
  shareWithEmail?(graphId: string, email: string, role: 'viewer' | 'editor'): Promise<ControlShareWithEmailResult>
  cancelInvitation?(graphId: string, invitationId: string): Promise<void>
  /** "Anyone with the link can view"; revoked with revokeShareLink. */
  createPublicLink?(graphId: string, request?: ControlPublicLinkCreate): Promise<ControlPublicLink>
  /** Leave a graph someone shared with this account. Absent: the dialog offers no Leave. */
  leaveGraph?(graphId: string): Promise<void>
}

type SharingGateway = Required<Pick<AccessGrantGateway, 'sharing' | 'setEveryoneAccess' | 'createShareLink' | 'revokeShareLink'>>

function sharingGateway(gateway: AccessGrantGateway): SharingGateway | null {
  return typeof gateway.sharing === 'function'
    && typeof gateway.setEveryoneAccess === 'function'
    && typeof gateway.createShareLink === 'function'
    && typeof gateway.revokeShareLink === 'function'
    ? gateway as SharingGateway
    : null
}

export interface AccessGrantUi {
  confirm(options: ConfirmOpts): Promise<boolean>
}

export interface AccessGrantScope {
  readonly gateway: AccessGrantGateway
  readonly ui: AccessGrantUi
  readonly graphId: string
  readonly graphTitle: string
  readonly currentUserId: string
  readonly roleHint?: WorkspaceAccessRole | 'unknown'
  /** The signed-in person's name and email: the owner's own row, and who an invitation note is from. */
  readonly currentUserName?: string
  readonly currentUserEmail?: string
  /** The graph's owner (`user:<sub>`): the graph's address names it, since ids are unique only per owner. */
  readonly owner?: string
  /** After leaving: the graph is no longer this account's to open (the host goes Home and reads the catalog). */
  readonly onLeft?: () => void
}

export interface OrganismAccessGrantControllerOptions {
  readonly requestRender: () => void
  /** Origin for share-link URLs; defaults to the page origin. */
  readonly linkOrigin?: () => string
}

function memberName(grant: WorkspaceAccessGrant): string {
  return grant.displayName?.trim() || grant.email?.trim() || grant.userId
}

function projectGrant(grant: GatewayAccessGrant, people: ReadonlyMap<string, ControlPerson>): WorkspaceAccessGrant {
  const person = people.get(grant.userId)
  const email = grant.email || person?.email || ''
  const displayName = grant.displayName || person?.name || ''
  return Object.freeze({
    userId: grant.userId,
    role: grant.role,
    grantedAt: grant.grantedAt,
    grantedBy: grant.grantedBy,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
  })
}

function projectGrants(
  grants: readonly GatewayAccessGrant[],
  people: ReadonlyMap<string, ControlPerson>,
): readonly WorkspaceAccessGrant[] {
  return Object.freeze(grants.map(grant => projectGrant(grant, people)).sort((left, right) => {
    if (left.role === 'owner' && right.role !== 'owner') return -1
    if (right.role === 'owner' && left.role !== 'owner') return 1
    return memberName(left).localeCompare(memberName(right)) || left.userId.localeCompare(right.userId)
  }))
}

function errorMessage(error: unknown): string {
  const status = error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : null
  if (status === 403) return 'Only the workspace owner can manage member access.'
  if (status === 404) return 'This workspace is unavailable or you no longer have access.'
  if (status === 401) return 'Your hosted session expired. Sign in again, then retry.'
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (code === -32004) return 'This workspace is unavailable or this session cannot list its access grants. (graph not found)'
  if (code === -32003) return `Access management was refused. ${error instanceof Error ? error.message : String(error)}`
  return error instanceof Error ? error.message : String(error)
}

function emailOrNull(value: string): string | null {
  try {
    return accessEmail(value)
  } catch {
    return null
  }
}

/** General access, one choice. A live public link wins: it reaches more people than the everyone grant. */
export function generalAccessOf(state: Pick<ControlSharingState, 'everyone' | 'publicLink'>): WorkspaceGeneralAccess {
  if (state.publicLink?.live) return 'public'
  return state.everyone ? 'signed-in' : 'restricted'
}

export class OrganismAccessGrantController {
  private scope: AccessGrantScope | null = null
  private generation = 0
  private status: WorkspaceAccessOptions['status'] = 'idle'
  private grants: readonly WorkspaceAccessGrant[] = Object.freeze([])
  private currentRole: WorkspaceAccessOptions['currentRole'] = 'unknown'
  private error: string | null = null
  private notice: string | null = null
  private busyUserId: string | null = null
  private busyAction: WorkspaceAccessBusyAction | null = null
  private renderQueued = false
  private destroyed = false
  private sharingStatus: WorkspaceAccessSharing['status'] = 'idle'
  private sharingState: ControlSharingState | null = null
  private sharingBusy: WorkspaceSharingBusyAction | null = null
  private sharingError: string | null = null
  private createdLinkUrl: string | null = null
  /** The gateway rows last read, and the names `get_sharing` gives them. */
  private rows: readonly GatewayAccessGrant[] = Object.freeze([])
  private people = new Map<string, ControlPerson>()
  private inviteResult: WorkspaceAccessInviteResult | null = null
  private openRequests = 0
  private openRequest: number | null = null

  constructor(private readonly options: OrganismAccessGrantControllerOptions) {}

  private origin(): string {
    return (this.options.linkOrigin?.() ?? globalThis.location?.origin ?? '').replace(/\/+$/u, '')
  }

  /**
   * The graph's own address: it opens for people with access (and asks anyone else to sign in). It names the
   * owner, since whoever opens it may hold a graph with the same id.
   */
  private graphUrl(scope: AccessGrantScope): string {
    const owner = scope.owner?.trim()
    return `${this.origin()}/g/${encodeURIComponent(scope.graphId)}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`
  }

  /** A graph someone shared with this account, through a gateway that can leave it. */
  private canLeave(): boolean {
    return (this.currentRole === 'viewer' || this.currentRole === 'editor')
      && typeof this.scope?.gateway.leaveGraph === 'function'
  }

  /**
   * Leave a graph someone shared with this account, after a confirm. Refused for access that comes only through
   * everyone signed in (the gateway says why); on success the host goes Home.
   */
  async leave(): Promise<void> {
    const scope = this.scope
    if (!scope || this.destroyed || this.busyAction || !this.canLeave()) return
    // Every render re-sets the scope (a fresh object for the same graph), so "still this graph" is the gateway
    // and the graph id, not the object.
    const sameGraph = (): boolean => !this.destroyed
      && this.scope?.gateway === scope.gateway && this.scope.graphId === scope.graphId
    const name = scope.graphTitle || scope.graphId
    let confirmed = false
    try {
      confirmed = await scope.ui.confirm({
        title: t('sharing.leaveTitle', { name }),
        message: t('sharing.leaveMessage'),
        confirmLabel: t('sharing.leaveConfirm'),
        cancelLabel: t('Cancel'),
      })
    } catch (error) {
      if (!sameGraph()) return
      this.error = errorMessage(error)
      this.requestRender()
      return
    }
    if (!confirmed || !sameGraph() || this.busyAction) return
    this.busyAction = 'leave'
    this.error = null
    this.notice = null
    this.requestRender()
    try {
      await scope.gateway.leaveGraph!(scope.graphId)
      if (this.destroyed) return
      this.busyAction = null
      this.requestRender()
      ;(this.scope ?? scope).onLeft?.()
    } catch (error) {
      if (!sameGraph()) return
      this.busyAction = null
      this.error = leaveRefusalMessage(error)
      this.requestRender()
    }
  }

  private inviteMessage(scope: AccessGrantScope, email: string): string {
    return t('sharing.inviteMessage', {
      inviter: scope.currentUserName?.trim() || scope.currentUserEmail?.trim() || t('sharing.inviterFallback'),
      graph: scope.graphTitle || scope.graphId,
      url: this.graphUrl(scope),
      email,
    })
  }

  private resetSharing(): void {
    this.sharingStatus = 'idle'
    this.sharingState = null
    this.sharingBusy = null
    this.sharingError = null
    this.createdLinkUrl = null
  }

  private requestRender(): void {
    if (this.destroyed || this.renderQueued) return
    this.renderQueued = true
    queueMicrotask(() => {
      this.renderQueued = false
      if (!this.destroyed) this.options.requestRender()
    })
  }

  setScope(scope: AccessGrantScope | null): void {
    const previous = this.scope
    const roleHint = scope?.roleHint ?? 'unknown'
    const sameAuthority = previous?.gateway === scope?.gateway
      && previous?.ui === scope?.ui
      && previous?.graphId === scope?.graphId
      && previous?.currentUserId === scope?.currentUserId
    const sameRoleHint = (previous?.roleHint ?? 'unknown') === roleHint
    if (sameAuthority && sameRoleHint) {
      // Cosmetic projection changes (for example a refreshed graph title) must
      // not invalidate an in-flight request. Async staleness is generation-
      // based, so retaining the authority while replacing this snapshot is safe.
      this.scope = scope
      if (this.currentRole === 'unknown' && roleHint !== 'unknown') this.currentRole = roleHint
      return
    }
    this.scope = scope
    this.generation += 1
    this.status = 'idle'
    this.grants = Object.freeze([])
    this.currentRole = roleHint
    this.error = null
    this.notice = null
    this.busyUserId = null
    this.busyAction = null
    this.rows = Object.freeze([])
    this.people = new Map()
    this.inviteResult = null
    this.openRequest = null
    this.resetSharing()
  }

  private applyGrants(rows: readonly GatewayAccessGrant[]): void {
    this.rows = rows
    const scope = this.scope
    const ownGrant = scope ? rows.find(grant => grant.userId === scope.currentUserId) : null
    this.currentRole = ownGrant?.role ?? scope?.roleHint ?? 'unknown'
    // The owner is not a delegated grant, so the gateway never lists them: the owner's own row is drawn here,
    // first, the way a sharing dialog shows who owns the thing.
    const ownerRow: readonly GatewayAccessGrant[] = scope && this.currentRole === 'owner' && !ownGrant
      ? [{
          userId: scope.currentUserId,
          role: 'owner',
          grantedAt: '',
          grantedBy: scope.currentUserId,
          ...(scope.currentUserEmail?.trim() ? { email: scope.currentUserEmail.trim() } : {}),
          ...(scope.currentUserName?.trim() ? { displayName: scope.currentUserName.trim() } : {}),
        }]
      : []
    this.grants = projectGrants([...ownerRow, ...rows], this.people)
  }

  async open(): Promise<void> {
    if (this.status !== 'idle') return
    await this.refresh()
  }

  /** Open the dialog from outside (Home's Share button lands here with `?access=1`). */
  requestOpen(): void {
    if (!this.scope || this.destroyed) return
    this.openRequest = ++this.openRequests
    this.requestRender()
    void this.open()
  }

  async refresh(): Promise<void> {
    const scope = this.scope
    if (!scope || this.destroyed || (this.busyAction && this.busyAction !== 'refresh')) return
    if (this.currentRole === 'viewer' || this.currentRole === 'editor') {
      // Only the owner may list who has access. Everyone else sees their own role and the graph's link.
      this.status = 'ready'
      this.error = null
      this.requestRender()
      return
    }
    const generation = ++this.generation
    this.status = 'loading'
    this.error = null
    this.notice = null
    this.busyAction = 'refresh'
    this.busyUserId = null
    this.requestRender()
    try {
      const rows = await scope.gateway.access(scope.graphId)
      if (generation !== this.generation) return
      this.applyGrants(rows)
      this.status = 'ready'
      void this.loadSharing(scope, generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.status = 'error'
      this.error = errorMessage(error)
    } finally {
      if (generation === this.generation) {
        this.busyAction = null
        this.busyUserId = null
        this.requestRender()
      }
    }
  }

  private ownerScope(): AccessGrantScope | null {
    const scope = this.scope
    if (!scope) return null
    if (this.currentRole !== 'owner') {
      this.error = 'Only the workspace owner can manage member access.'
      this.notice = null
      this.requestRender()
      return null
    }
    if (this.status !== 'ready') {
      this.error = this.error || 'Refresh the member list before making an access change.'
      this.notice = null
      this.requestRender()
      return null
    }
    return scope
  }

  private async mutate(
    action: Exclude<WorkspaceAccessBusyAction, 'refresh'>,
    userId: string,
    operation: (scope: AccessGrantScope) => Promise<void>,
    notice: string,
    confirmedBy: (rows: readonly GatewayAccessGrant[]) => boolean,
  ): Promise<void> {
    const scope = this.ownerScope()
    if (!scope || this.destroyed || this.busyAction) return
    const generation = ++this.generation
    this.busyAction = action
    this.busyUserId = userId
    this.error = null
    this.notice = null
    this.requestRender()
    let mutationAccepted = false
    try {
      await operation(scope)
      mutationAccepted = true
      if (generation !== this.generation) return
      const rows = await scope.gateway.access(scope.graphId)
      if (generation !== this.generation) return
      this.applyGrants(rows)
      if (!confirmedBy(rows)) throw new Error('The refreshed list does not yet confirm the requested grant state.')
      this.status = 'ready'
      this.notice = notice
      void this.loadSharing(scope, generation, true)
    } catch (error) {
      if (generation !== this.generation) return
      this.status = 'error'
      const detail = errorMessage(error)
      this.error = mutationAccepted
        ? `The access change was accepted, but current membership could not be confirmed. Refresh before making another change. ${detail}`
        : detail
    } finally {
      if (generation === this.generation) {
        this.busyAction = null
        this.busyUserId = null
        this.requestRender()
      }
    }
  }

  async add(detail: WorkspaceAccessAddDetail): Promise<void> {
    const userId = detail.userId.trim()
    try {
      accessUserPrincipal(userId)
    } catch (error) {
      this.error = errorMessage(error)
      this.requestRender()
      return
    }
    if (detail.role !== 'viewer' && detail.role !== 'editor') {
      this.error = 'Member role must be viewer or editor.'
      this.requestRender()
      return
    }
    if (this.grants.some(grant => grant.userId === userId)) {
      this.error = 'This user already has access. Change their role in the member list.'
      this.requestRender()
      return
    }
    const email = detail.email?.trim()
    const displayName = detail.displayName?.trim()
    if (email || displayName) {
      this.error = 'Access grants do not support email or display-name metadata; use a typed user ID.'
      this.requestRender()
      return
    }
    await this.mutate(
      'add',
      userId,
      scope => scope.gateway.putAccess(scope.graphId, userId, {
        role: detail.role,
      }),
      `Added ${userId} as ${detail.role}.`,
      rows => rows.some(row => row.userId === userId && row.role === detail.role),
    )
  }

  async changeRole(detail: WorkspaceAccessRoleChangeDetail): Promise<void> {
    const userId = detail.userId.trim()
    const grant = this.grants.find(candidate => candidate.userId === userId)
    if (!grant) {
      this.error = 'That member is no longer present. Refresh the member list.'
      this.requestRender()
      return
    }
    if (grant.role === 'owner') {
      this.error = 'The owner grant cannot be changed through the member access API.'
      this.requestRender()
      return
    }
    if (detail.role !== 'viewer' && detail.role !== 'editor') {
      this.error = 'Member role must be viewer or editor.'
      this.requestRender()
      return
    }
    if (grant.role === detail.role) return
    await this.mutate(
      'role',
      userId,
      scope => scope.gateway.putAccess(scope.graphId, userId, {
        role: detail.role,
      }),
      `Updated ${memberName(grant)} to ${detail.role}.`,
      rows => rows.some(row => row.userId === userId && row.role === detail.role),
    )
  }

  async remove(detail: WorkspaceAccessRemoveDetail): Promise<void> {
    const scope = this.ownerScope()
    if (!scope || this.destroyed || this.busyAction) return
    const userId = detail.userId.trim()
    const grant = this.grants.find(candidate => candidate.userId === userId)
    if (!grant) {
      this.error = 'That member is no longer present. Refresh the member list.'
      this.requestRender()
      return
    }
    if (grant.role === 'owner') {
      this.error = 'The owner grant cannot be removed.'
      this.requestRender()
      return
    }
    const generation = this.generation
    let confirmed = false
    try {
      confirmed = await scope.ui.confirm({
        title: `Remove ${memberName(grant)}?`,
        message: `${memberName(grant)} will immediately lose ${grant.role} access to ${scope.graphTitle || scope.graphId}.`,
        confirmLabel: 'Remove member',
        cancelLabel: 'Cancel',
      })
    } catch (error) {
      if (this.destroyed || generation !== this.generation) return
      this.error = errorMessage(error)
      this.requestRender()
      return
    }
    if (!confirmed || this.destroyed || generation !== this.generation || this.currentRole !== 'owner') return
    await this.mutate(
      'remove',
      userId,
      active => active.gateway.deleteAccess(active.graphId, userId),
      `Removed ${memberName(grant)}.`,
      rows => !rows.some(row => row.userId === userId),
    )
  }

  /** Adopt a sharing view: its general access, links, invitations, and the names of the people with access. */
  private adoptSharing(state: ControlSharingState): void {
    this.sharingState = state
    this.people = new Map(state.people.map(row => [row.userId, row.person] as const))
    this.applyGrants(this.rows)
  }

  /** Owner-only: read general access, links, invitations and names. Failure never hides people. */
  private async loadSharing(scope: AccessGrantScope, generation: number, quiet = false): Promise<void> {
    const gateway = sharingGateway(scope.gateway)
    if (!gateway || this.currentRole !== 'owner') {
      this.resetSharing()
      return
    }
    if (!quiet || this.sharingStatus !== 'ready') this.sharingStatus = 'loading'
    this.sharingError = null
    this.requestRender()
    try {
      const state = await gateway.sharing(scope.graphId)
      if (generation !== this.generation || this.destroyed) return
      this.adoptSharing(state)
      this.sharingStatus = 'ready'
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return
      this.sharingStatus = 'error'
      this.sharingError = `Sharing settings are unavailable. ${errorMessage(error)}`
    } finally {
      if (generation === this.generation) this.requestRender()
    }
  }

  private async mutateSharing(
    action: WorkspaceSharingBusyAction,
    operation: (gateway: SharingGateway, scope: AccessGrantScope) => Promise<void>,
    notice: string,
  ): Promise<void> {
    const scope = this.scope
    const gateway = scope ? sharingGateway(scope.gateway) : null
    if (!scope || !gateway || this.destroyed || this.sharingBusy || this.currentRole !== 'owner' || this.sharingStatus !== 'ready') return
    const generation = this.generation
    this.sharingBusy = action
    this.sharingError = null
    this.notice = null
    this.requestRender()
    try {
      await operation(gateway, scope)
      if (generation !== this.generation || this.destroyed) return
      const state = await gateway.sharing(scope.graphId)
      if (generation !== this.generation || this.destroyed) return
      this.adoptSharing(state)
      this.notice = notice
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return
      this.sharingError = errorMessage(error)
    } finally {
      if (generation === this.generation) {
        this.sharingBusy = null
        this.requestRender()
      }
    }
  }

  async setEveryone(detail: WorkspaceEveryoneChangeDetail): Promise<void> {
    const scope = this.scope
    if (!scope || this.sharingState?.everyone === detail.enabled) return
    if (detail.enabled) {
      let confirmed = false
      try {
        confirmed = await scope.ui.confirm({
          title: 'Let anyone signed in view this workspace?',
          message: `Every Garden account will be able to find and read ${scope.graphTitle || scope.graphId}. They will not be able to edit it. You can turn this off at any time.`,
          confirmLabel: 'Allow viewing',
          cancelLabel: 'Cancel',
        })
      } catch (error) {
        this.sharingError = errorMessage(error)
        this.requestRender()
        return
      }
      if (!confirmed) {
        this.requestRender()
        return
      }
    }
    await this.mutateSharing(
      'everyone',
      (gateway, active) => gateway.setEveryoneAccess(active.graphId, detail.enabled),
      detail.enabled ? 'Anyone signed in can now view this workspace.' : 'Only people with access can open this workspace now.',
    )
  }

  async createLink(detail: WorkspaceShareLinkCreateDetail): Promise<void> {
    if (detail.role !== 'viewer' && detail.role !== 'editor') return
    await this.mutateSharing(
      'link-create',
      async (gateway, active) => {
        const minted = await gateway.createShareLink(active.graphId, {
          role: detail.role,
          expiresInSeconds: detail.expiresInSeconds,
        })
        const origin = this.options.linkOrigin?.() ?? globalThis.location?.origin ?? ''
        this.createdLinkUrl = shareLinkUrl(origin, minted.token)
      },
      `Created a ${detail.role} link. Copy it now; it is shown only once.`,
    )
  }

  async revokeLink(detail: WorkspaceShareLinkRevokeDetail): Promise<void> {
    const scope = this.scope
    const link = this.sharingState?.links.find(candidate => candidate.linkId === detail.linkId)
    if (!scope || !link) return
    let confirmed = false
    try {
      confirmed = await scope.ui.confirm({
        title: 'Revoke this share link?',
        message: `Nobody new will be able to join ${scope.graphTitle || scope.graphId} with this ${link.role} link. People who already joined keep their access until you remove them.`,
        confirmLabel: 'Revoke link',
        cancelLabel: 'Cancel',
      })
    } catch (error) {
      this.sharingError = errorMessage(error)
      this.requestRender()
      return
    }
    if (!confirmed) return
    await this.mutateSharing(
      'link-revoke',
      (gateway, active) => gateway.revokeShareLink(active.graphId, detail.linkId),
      'Share link revoked.',
    )
  }

  /** Add people by email: a known account is granted at once (and named); anyone else is invited. */
  async invite(detail: WorkspaceAccessInviteDetail): Promise<void> {
    const scope = this.ownerScope()
    if (!scope || this.destroyed || this.busyAction) return
    const gateway = scope.gateway
    if (typeof gateway.shareWithEmail !== 'function') {
      this.error = t('sharing.inviteUnavailable')
      this.requestRender()
      return
    }
    const email = emailOrNull(detail.email)
    if (!email) {
      this.error = t('sharing.invalidEmail')
      this.requestRender()
      return
    }
    if (detail.role !== 'viewer' && detail.role !== 'editor') {
      this.error = 'Member role must be viewer or editor.'
      this.requestRender()
      return
    }
    const generation = ++this.generation
    this.busyAction = 'add'
    this.busyUserId = null
    this.error = null
    this.notice = null
    this.inviteResult = null
    this.requestRender()
    try {
      const result = await gateway.shareWithEmail(scope.graphId, email, detail.role)
      if (generation !== this.generation || this.destroyed) return
      if (result.outcome === 'granted') {
        this.people.set(result.grant.userId, result.person)
        const granted: WorkspaceAccessInviteResult = {
          outcome: 'granted', email, name: result.person.name, role: result.grant.role,
        }
        this.inviteResult = granted
        const rows = await gateway.access(scope.graphId)
        if (generation !== this.generation || this.destroyed) return
        this.applyGrants(rows)
        this.status = 'ready'
      } else {
        const invited: WorkspaceAccessInviteResult = {
          outcome: 'invited', email, role: result.invitation.role, message: this.inviteMessage(scope, email),
        }
        this.inviteResult = invited
      }
      void this.loadSharing(scope, generation, true)
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return
      this.error = errorMessage(error)
    } finally {
      if (generation === this.generation) {
        this.busyAction = null
        this.requestRender()
      }
    }
  }

  async cancelInvitation(detail: WorkspaceAccessInvitationCancelDetail): Promise<void> {
    const scope = this.scope
    const invitation = this.sharingState?.invitations.find(candidate => candidate.invitationId === detail.invitationId)
    if (!scope || !invitation) return
    if (typeof scope.gateway.cancelInvitation !== 'function') {
      this.sharingError = t('sharing.inviteUnavailable')
      this.requestRender()
      return
    }
    await this.mutateSharing(
      'invitation-cancel',
      async (_gateway, active) => { await active.gateway.cancelInvitation?.(active.graphId, invitation.invitationId) },
      t('sharing.invitationCancelled', { email: invitation.email }),
    )
    if (this.inviteResult?.email === invitation.email && !this.sharingState?.invitations.some(row => row.email === invitation.email)) {
      this.inviteResult = null
      this.requestRender()
    }
  }

  /**
   * General access, one choice. Restricted clears the everyone grant and revokes the public link; anyone
   * signed in sets the grant and revokes the link; anyone with the link creates it and clears the grant.
   * Widening asks first; narrowing does not.
   */
  async setGeneralAccess(detail: WorkspaceGeneralAccessChangeDetail): Promise<void> {
    const scope = this.scope
    const state = this.sharingState
    const target = detail.access
    if (!scope || !state || this.sharingBusy || (target !== 'restricted' && target !== 'signed-in' && target !== 'public')) return
    if (generalAccessOf(state) === target) return
    if (target === 'public' && typeof scope.gateway.createPublicLink !== 'function') {
      this.sharingError = t('sharing.publicUnavailable')
      this.requestRender()
      return
    }
    const name = scope.graphTitle || scope.graphId
    if (target !== 'restricted') {
      let confirmed = false
      try {
        confirmed = await scope.ui.confirm(target === 'public'
          ? {
              title: t('sharing.confirmPublicTitle'),
              message: t('sharing.confirmPublicMessage', { name }),
              confirmLabel: t('sharing.allowViewing'),
              cancelLabel: t('Cancel'),
            }
          : {
              title: t('sharing.confirmSignedInTitle'),
              message: t('sharing.confirmSignedInMessage', { name }),
              confirmLabel: t('sharing.allowViewing'),
              cancelLabel: t('Cancel'),
            })
      } catch (error) {
        this.sharingError = errorMessage(error)
        this.requestRender()
        return
      }
      if (!confirmed) {
        // The radio the person clicked goes back to the current choice.
        this.requestRender()
        return
      }
    }
    const current = state.publicLink
    const live = current && current.live ? current : null
    await this.mutateSharing(
      'general',
      async (gateway, active) => {
        if (target === 'public') {
          if (!live) await active.gateway.createPublicLink?.(active.graphId)
          if (state.everyone) await gateway.setEveryoneAccess(active.graphId, false)
          return
        }
        if (target === 'signed-in' && !state.everyone) await gateway.setEveryoneAccess(active.graphId, true)
        if (target === 'restricted' && state.everyone) await gateway.setEveryoneAccess(active.graphId, false)
        if (live) await gateway.revokeShareLink(active.graphId, live.linkId)
      },
      target === 'public'
        ? t('sharing.generalPublicNotice')
        : target === 'signed-in' ? t('sharing.generalSignedInNotice') : t('sharing.generalRestrictedNotice'),
    )
  }

  dismissLink(): void {
    this.createdLinkUrl = null
    this.requestRender()
  }

  private sharingSnapshot(): WorkspaceAccessSharing | null {
    const scope = this.scope
    if (!scope || !sharingGateway(scope.gateway) || this.currentRole !== 'owner' || this.sharingStatus === 'idle') return null
    const state = this.sharingState
    const candidate = state ? state.publicLink : null
    const publicLink = candidate && candidate.live ? candidate : null
    return Object.freeze({
      status: this.sharingStatus,
      everyone: state?.everyone ?? false,
      generalAccess: state ? generalAccessOf(state) : 'restricted',
      publicLinkUrl: publicLink ? publicViewUrl(this.origin(), publicLink.token) : null,
      invitations: Object.freeze((state?.invitations ?? []).map(invitation => Object.freeze({
        invitationId: invitation.invitationId,
        email: invitation.email,
        role: invitation.role,
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      }))),
      links: Object.freeze((state?.links ?? []).map(link => Object.freeze({
        linkId: link.linkId,
        role: link.role,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        label: link.label,
        live: link.live,
      }))),
      createdLinkUrl: this.createdLinkUrl,
      busyAction: this.sharingBusy,
      error: this.sharingError,
    })
  }

  snapshot(): WorkspaceAccessOptions | null {
    const scope = this.scope
    if (!scope) return null
    return Object.freeze({
      graphId: scope.graphId,
      graphTitle: scope.graphTitle,
      currentRole: this.currentRole,
      status: this.status,
      grants: this.grants,
      error: this.error,
      notice: this.notice,
      busyUserId: this.busyUserId,
      busyAction: this.busyAction,
      onOpen: () => { void this.open() },
      onRefresh: () => { void this.refresh() },
      onAdd: (detail: WorkspaceAccessAddDetail) => { void this.add(detail) },
      onRoleChange: (detail: WorkspaceAccessRoleChangeDetail) => { void this.changeRole(detail) },
      onRemove: (detail: WorkspaceAccessRemoveDetail) => { void this.remove(detail) },
      sharing: this.sharingSnapshot(),
      onEveryoneChange: (detail: WorkspaceEveryoneChangeDetail) => { void this.setEveryone(detail) },
      onLinkCreate: (detail: WorkspaceShareLinkCreateDetail) => { void this.createLink(detail) },
      onLinkRevoke: (detail: WorkspaceShareLinkRevokeDetail) => { void this.revokeLink(detail) },
      onLinkDismiss: () => { this.dismissLink() },
      currentUserId: scope.currentUserId,
      memberLinkUrl: this.graphUrl(scope),
      inviteResult: this.inviteResult,
      openRequest: this.openRequest,
      onInvite: (detail: WorkspaceAccessInviteDetail) => { void this.invite(detail) },
      onInvitationCancel: (detail: WorkspaceAccessInvitationCancelDetail) => { void this.cancelInvitation(detail) },
      onGeneralAccessChange: (detail: WorkspaceGeneralAccessChangeDetail) => { void this.setGeneralAccess(detail) },
      canLeave: this.canLeave(),
      onLeave: () => { void this.leave() },
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.generation += 1
    this.scope = null
    this.grants = Object.freeze([])
    this.busyAction = null
    this.busyUserId = null
  }
}
