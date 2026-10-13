/**
 * Hosted canonical control-MCP member-grant controller.
 *
 * The reusable access component receives only this controller's immutable
 * projection. Authentication and owner-only mutations stay on the Organism
 * side of the shell boundary and use GatewayTransport's token-fresh methods.
 */

import type { ConfirmOpts } from '@shrubbery/nucleus'
import {
  accessUserPrincipal,
  shareLinkUrl,
  type ControlMintedShareLink,
  type ControlShareLinkCreate,
  type ControlSharingState,
} from '@shrubbery/source/access-control'
import type {
  WorkspaceAccessAddDetail,
  WorkspaceAccessBusyAction,
  WorkspaceAccessGrant,
  WorkspaceAccessOptions,
  WorkspaceAccessRemoveDetail,
  WorkspaceAccessRole,
  WorkspaceAccessRoleChangeDetail,
  WorkspaceAccessSharing,
  WorkspaceEveryoneChangeDetail,
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
}

export interface OrganismAccessGrantControllerOptions {
  readonly requestRender: () => void
  /** Origin for share-link URLs; defaults to the page origin. */
  readonly linkOrigin?: () => string
}

function memberName(grant: WorkspaceAccessGrant): string {
  return grant.displayName?.trim() || grant.email?.trim() || grant.userId
}

function projectGrant(grant: GatewayAccessGrant): WorkspaceAccessGrant {
  return Object.freeze({
    userId: grant.userId,
    role: grant.role,
    grantedAt: grant.grantedAt,
    grantedBy: grant.grantedBy,
    ...(grant.email ? { email: grant.email } : {}),
    ...(grant.displayName ? { displayName: grant.displayName } : {}),
  })
}

function projectGrants(grants: readonly GatewayAccessGrant[]): readonly WorkspaceAccessGrant[] {
  return Object.freeze(grants.map(projectGrant).sort((left, right) => {
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

  constructor(private readonly options: OrganismAccessGrantControllerOptions) {}

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
    this.resetSharing()
  }

  private applyGrants(rows: readonly GatewayAccessGrant[]): void {
    this.grants = projectGrants(rows)
    const scope = this.scope
    const ownGrant = scope
      ? this.grants.find(grant => grant.userId === scope.currentUserId)
      : null
    this.currentRole = ownGrant?.role ?? scope?.roleHint ?? 'unknown'
  }

  async open(): Promise<void> {
    if (this.status !== 'idle') return
    await this.refresh()
  }

  async refresh(): Promise<void> {
    const scope = this.scope
    if (!scope || this.destroyed || (this.busyAction && this.busyAction !== 'refresh')) return
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

  /** Owner-only: read the everyone grant and share links. Failure never hides people. */
  private async loadSharing(scope: AccessGrantScope, generation: number): Promise<void> {
    const gateway = sharingGateway(scope.gateway)
    if (!gateway || this.currentRole !== 'owner') {
      this.resetSharing()
      return
    }
    this.sharingStatus = 'loading'
    this.sharingError = null
    this.requestRender()
    try {
      const state = await gateway.sharing(scope.graphId)
      if (generation !== this.generation || this.destroyed) return
      this.sharingState = state
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
      this.sharingState = state
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

  dismissLink(): void {
    this.createdLinkUrl = null
    this.requestRender()
  }

  private sharingSnapshot(): WorkspaceAccessSharing | null {
    const scope = this.scope
    if (!scope || !sharingGateway(scope.gateway) || this.currentRole !== 'owner' || this.sharingStatus === 'idle') return null
    return Object.freeze({
      status: this.sharingStatus,
      everyone: this.sharingState?.everyone ?? false,
      links: Object.freeze((this.sharingState?.links ?? []).map(link => Object.freeze({
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
