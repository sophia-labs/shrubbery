/**
 * Pure catalog projection and capability grammar for <mn-workspace-selector>.
 *
 * The host owns catalog reads and every effect. This module only turns the
 * host's controlled summaries into stable owned/shared groups and answers
 * which explicitly supported management intents may be presented.
 */

export type MnWorkspaceRole = 'viewer' | 'editor' | 'owner'
export type MnWorkspaceCellState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
export type MnWorkspaceSelectorStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnWorkspaceGroupKind = 'owned' | 'shared'
export type MnWorkspaceManagementAction = 'rename' | 'delete' | 'leave'

/**
 * `available: false` means the operation is absent from the selector. It must
 * not be rendered as a pretend disabled control. `disabledReason` is only for
 * a real operation that the host supports but cannot perform right now.
 */
export interface MnWorkspaceActionCapability {
  readonly available: boolean
  readonly disabledReason?: string
}

export interface MnWorkspaceCapabilities {
  readonly rename?: MnWorkspaceActionCapability
  readonly delete?: MnWorkspaceActionCapability
  readonly leave?: MnWorkspaceActionCapability
}

/**
 * My mirror's relation to this graph's LIFETIME (master §3 Slice 7, WS3 D2).
 * Distinct from `MnWorkspaceCellState`, which describes the CELL
 * (starting/running/stopping/stopped/error) — "moved on without you" is not
 * a property of the cell, it is the relation between this client's mirror
 * and this graph id's current lifetime. A separate optional field keeps
 * both vocabularies honest rather than collapsing a lifetime truth into the
 * continuity/cell-state register (the exact terminology collapse the
 * codebase's own `DocumentConflictReason` already committed, and the one
 * this product's language must not inherit).
 */
export interface MnWorkspaceLifetimeState {
  readonly kind: 'moved-on'
  /** Short form of the incarnation this client's mirror still holds. */
  readonly previousIncarnation: string
  readonly parkedDocuments: number
  readonly parkedOperations: number
}

export interface MnWorkspaceSummary {
  readonly graphId: string
  /**
   * The host's identity for this workspace when it differs from the graph id: graph ids are unique only per
   * owner, so another account's graph with one of this account's ids carries an owner-qualified key. Selection,
   * busy and active state compare keys; absent, the key is the graph id.
   */
  readonly key?: string
  readonly title: string
  readonly role: MnWorkspaceRole
  readonly cellState: MnWorkspaceCellState
  /** Who shared it: the owner's name on a graph this account does not own (never an email). */
  readonly ownerName?: string | null
  /**
   * A retained local creation, not a confirmed hosted ACL or cell. `reason: 'quota_exceeded'`: the cloud refused it
   * because the account is at its workspace limit (the host may offer Retry and Discard).
   */
  readonly localCreation?: {
    readonly status: 'pending' | 'conflict'
    readonly error?: string
    readonly reason?: 'quota_exceeded'
  }
  /** Account-local recency used by entry surfaces; never inferred by Shrubbery. */
  readonly lastOpenedAt?: number | null
  /** A quiet catalog testimony supplied by the account/ACL authority. */
  readonly memberCount?: number | null
  /** Optional host-authored hierarchy, from broadest segment to workspace. */
  readonly path?: readonly string[]
  /** An honest shell-owned gate, e.g. viewer reads are not exposed yet. */
  readonly disabled?: boolean
  readonly disabledReason?: string
  /**
   * Explicit management surface. When omitted, the current owner-delete
   * contract remains backwards compatible; rename and leave are never inferred.
   * Passing an object (including `{}`) opts into strict explicit capabilities.
   */
  readonly capabilities?: MnWorkspaceCapabilities
  /**
   * Present only when this client holds work for a life this graph no
   * longer has. The workspace stays SELECTABLE — confessing absence means
   * listing it, not greying it out (Law VI's own reversed-filter doctrine).
   */
  readonly lifetime?: MnWorkspaceLifetimeState | null
}

export interface MnWorkspaceDetail {
  readonly workspace: MnWorkspaceSummary
}

/** Exact intent boundary consumed by the shell adapter. */
export interface MnWorkspaceIntentDetailMap {
  readonly 'mn-workspace-refresh': Readonly<Record<string, never>>
  readonly 'mn-workspace-select': MnWorkspaceDetail
  readonly 'mn-workspace-create': Readonly<Record<string, never>>
  readonly 'mn-workspace-rename': MnWorkspaceDetail
  readonly 'mn-workspace-delete': MnWorkspaceDetail
  readonly 'mn-workspace-leave': MnWorkspaceDetail
}

export type MnWorkspaceIntentName = keyof MnWorkspaceIntentDetailMap

export interface MnWorkspaceCatalogGroup {
  readonly kind: MnWorkspaceGroupKind
  readonly label: 'My Workspaces' | 'Shared with me'
  readonly workspaces: readonly MnWorkspaceSummary[]
}

export interface MnWorkspaceCatalogProjection {
  readonly groups: readonly MnWorkspaceCatalogGroup[]
  readonly owned: readonly MnWorkspaceSummary[]
  readonly shared: readonly MnWorkspaceSummary[]
}

const UNAVAILABLE: MnWorkspaceActionCapability = Object.freeze({ available: false })
const AVAILABLE: MnWorkspaceActionCapability = Object.freeze({ available: true })

/** Stable partition: the host's order is preserved within each role group. */
export function projectWorkspaceCatalog(
  workspaces: readonly MnWorkspaceSummary[],
): MnWorkspaceCatalogProjection {
  const owned: MnWorkspaceSummary[] = []
  const shared: MnWorkspaceSummary[] = []
  for (const workspace of workspaces) {
    if (workspace.role === 'owner') owned.push(workspace)
    else shared.push(workspace)
  }

  const groups: MnWorkspaceCatalogGroup[] = []
  if (owned.length > 0) groups.push({ kind: 'owned', label: 'My Workspaces', workspaces: owned })
  if (shared.length > 0) groups.push({ kind: 'shared', label: 'Shared with me', workspaces: shared })
  return { groups, owned, shared }
}

/**
 * Resolve a real host capability. Rename and leave are never role-inferred.
 * Owner-delete is the sole legacy default because that event is already wired
 * by the current hosted adapter; strict adapters should pass `capabilities`.
 */
export function workspaceActionCapability(
  workspace: MnWorkspaceSummary,
  action: MnWorkspaceManagementAction,
): MnWorkspaceActionCapability {
  if (workspace.localCreation) return UNAVAILABLE
  if (workspace.capabilities !== undefined) {
    return workspace.capabilities[action] ?? UNAVAILABLE
  }
  return action === 'delete' && workspace.role === 'owner' ? AVAILABLE : UNAVAILABLE
}

/** A workspace's identity among the listed ones: its key when the host gives one, else its graph id. */
export function workspaceKey(workspace: Pick<MnWorkspaceSummary, 'graphId' | 'key'>): string {
  return workspace.key || workspace.graphId
}

/**
 * Two listed workspaces with the same name or id are told apart by who shared them: another account's reads
 * "Onboarding · from idle" (the account's own keeps its plain title). `base` is the title the caller shows.
 */
export function workspaceDisambiguatedTitle(
  workspace: MnWorkspaceSummary,
  all: readonly MnWorkspaceSummary[],
  base: string,
  fromOwner: (title: string, name: string) => string,
): string {
  const name = workspace.ownerName?.trim()
  if (!name || workspace.role === 'owner') return base
  const key = workspaceKey(workspace)
  const folded = base.trim().toLocaleLowerCase()
  const clash = all.some(other => workspaceKey(other) !== key && (
    other.graphId === workspace.graphId
    || (other.title.trim() || other.graphId).toLocaleLowerCase() === folded
  ))
  return clash ? fromOwner(base, name) : base
}

/** The quiet hierarchy shown under a title. Empty segments never become UI. */
export function workspaceDisplayPath(workspace: MnWorkspaceSummary): readonly string[] {
  const explicit = workspace.path?.map(segment => segment.trim()).filter(Boolean) ?? []
  if (explicit.length > 0) return explicit
  const title = workspace.title.trim()
  return title && title !== workspace.graphId ? [workspace.graphId] : []
}

export function workspaceLifecycleLabel(state: MnWorkspaceCellState): string | null {
  switch (state) {
    case 'starting': return 'Starting cell'
    case 'stopping': return 'Stopping cell'
    case 'stopped': return 'Cell asleep'
    case 'error': return 'Cell unavailable'
    case 'running': return null
  }
}

/** `null` when the lifetime is unremarkable. Never inferred from `cellState`
 *  — a lifetime truth and a cell-liveness truth are different axes (WS-1). */
export function workspaceLifetimeLabel(
  lifetime: MnWorkspaceLifetimeState | null | undefined,
): string | null {
  return lifetime?.kind === 'moved-on' ? 'Moved on without you' : null
}
