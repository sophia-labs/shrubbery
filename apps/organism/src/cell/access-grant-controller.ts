/**
 * Hosted Cloud-2 member-grant controller.
 *
 * The reusable access component receives only this controller's immutable
 * projection. Authentication and owner-only mutations stay on the Organism
 * side of the shell boundary and use GatewayTransport's token-fresh methods.
 */

import type { ConfirmOpts } from '@shrubbery/nucleus'
import type {
  WorkspaceAccessAddDetail,
  WorkspaceAccessBusyAction,
  WorkspaceAccessGrant,
  WorkspaceAccessOptions,
  WorkspaceAccessRemoveDetail,
  WorkspaceAccessRole,
  WorkspaceAccessRoleChangeDetail,
} from '@shrubbery/runtime'
import type { GatewayAccessGrant, GatewayPutAccessRequest } from './gateway-transport.js'

export interface AccessGrantGateway {
  access(graphId: string): Promise<readonly GatewayAccessGrant[]>
  putAccess(graphId: string, userId: string, request: GatewayPutAccessRequest): Promise<void>
  deleteAccess(graphId: string, userId: string): Promise<void>
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

  constructor(private readonly options: OrganismAccessGrantControllerOptions) {}

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
    if (!scope || this.destroyed) return
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
    return scope
  }

  private async mutate(
    action: Exclude<WorkspaceAccessBusyAction, 'refresh'>,
    userId: string,
    operation: (scope: AccessGrantScope) => Promise<void>,
    notice: string,
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
      const rows = await scope.gateway.access(scope.graphId)
      if (generation !== this.generation) return
      this.applyGrants(rows)
      this.status = 'ready'
      this.notice = notice
    } catch (error) {
      if (generation !== this.generation) return
      this.status = this.grants.length > 0 ? 'ready' : 'error'
      const detail = errorMessage(error)
      this.error = mutationAccepted
        ? `The access change was accepted, but the member list could not be refreshed. Retry before making another change. ${detail}`
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
    if (!userId) {
      this.error = 'A stable member user ID is required.'
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
    await this.mutate(
      'add',
      userId,
      scope => scope.gateway.putAccess(scope.graphId, userId, {
        role: detail.role,
        ...(email ? { email } : {}),
        ...(displayName ? { displayName } : {}),
      }),
      `Added ${displayName || email || userId} as ${detail.role}.`,
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
        ...(grant.email ? { email: grant.email } : {}),
        ...(grant.displayName ? { displayName: grant.displayName } : {}),
      }),
      `Updated ${memberName(grant)} to ${detail.role}.`,
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
    let confirmed = false
    try {
      confirmed = await scope.ui.confirm({
        title: `Remove ${memberName(grant)}?`,
        message: `${memberName(grant)} will immediately lose ${grant.role} access to ${scope.graphTitle || scope.graphId}.`,
        confirmLabel: 'Remove member',
        cancelLabel: 'Cancel',
      })
    } catch (error) {
      this.error = errorMessage(error)
      this.requestRender()
      return
    }
    if (!confirmed || this.currentRole !== 'owner') return
    await this.mutate(
      'remove',
      userId,
      active => active.gateway.deleteAccess(active.graphId, userId),
      `Removed ${memberName(grant)}.`,
    )
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
