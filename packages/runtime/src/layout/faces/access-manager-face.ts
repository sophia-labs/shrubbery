/**
 * access-manager-face.ts — the `access.manager` face (Wave 1, north star
 * §2.2/§3: "Elevate the 5 trapped faces" — the catalogue's own "second clean
 * 'data-driven ≠ face' illustration").
 *
 * WRAPS THE REAL `mn-access-manager` (`@shrubbery/components`) — today
 * mounted ONLY as `mn-top-bar`'s trigger+popover member-grant CRUD panel.
 * This face is a CHANGE OF MOUNT, not a rewrite: `mount()` drives the SAME
 * real component through the SAME real property/event contract
 * (`MnAccessManagerModel`, `mn-access-open`/`mn-access-refresh`/`mn-access-
 * add`/`mn-access-role-change`/`mn-access-remove`) — but with its new,
 * additive `embedded` property set (that component's own header: "an
 * ADDITIVE, opt-in mode... only the delivery form changes, never the
 * member-grant CRUD logic itself"). `packages/runtime` cannot statically
 * import `@shrubbery/components`'s class (`doc-history-face.ts`'s own header
 * states the same constraint), so — exactly like that file already does —
 * the element is created by TAG NAME and driven through a locally-typed
 * property bag.
 *
 * LIVE-VS-DERIVED VERDICT: DERIVED (task brief: "derived/stamp"). Member
 * grants (`GET /graphs/{id}/access`) are a fetch-on-demand, explicitly-
 * refetchable query (a "Refresh" button, a mutation-triggered reload), never
 * a subscribed/streaming resource. `compute()` bundles the real
 * `AccessGrantService` reference alongside its first-fetch snapshot — the
 * SAME "derived resource, live service reference for later re-fetch"
 * bundling `workspace-picker-face.ts` uses for the identical reason: no
 * cross-leaf sharing (each acquire is independent), but this ONE leaf still
 * needs to re-run add/role-change/remove/refresh against the SAME real
 * transport without re-acquiring a whole new broker lease.
 *
 * ORCHESTRATION: `apps/organism/src/cell/access-grant-controller.ts`'s
 * `OrganismAccessGrantController` already implements this exact generation-
 * guarded add/role-change/remove/refresh orchestration — but it lives in
 * `apps/organism`, an app `packages/runtime` cannot import (wrong dependency
 * direction; the SAME constraint `workspace-gateway-service.ts`'s own header
 * documents for `GatewayTransport`). This face's `mount()` therefore owns a
 * THIN, leaf-scoped mirror of that same orchestration shape (status/grants/
 * error/notice/busyUserId/busyAction, an owner-only mutation guard, a
 * refresh-after-mutate reload) — the same precedent `doc-history-face.ts`
 * sets: that face's own local `DocHistoryViewState` reload/refreshDiff loop
 * mirrors (never imports) `apps/organism/src/main.ts`'s app-local
 * `loadDocHistorySurface`/`refreshDocHistoryDiff` for the identical
 * cross-package reason.
 *
 * CONFIRM-BEFORE-REMOVE: the real controller calls `scope.ui.confirm(...)`
 * before removing a member; `mn-access-manager` itself has no confirm
 * affordance of its own (it just emits `mn-access-remove`). This face
 * accepts a REQUIRED `confirmRemove` dependency mirroring that shape — it
 * ALWAYS gates the remove, exactly like production (wave1 review r1 WRONG:
 * this dependency used to be optional, which meant an unwired caller removed
 * a member with zero confirmation — the opposite of "honest scope
 * trade-off"; a destructive action silently losing its own safety rail is a
 * regression, not a documented scope boundary).
 *
 * OWNER-GRANT GUARD: `access-grant-controller.ts`'s real `changeRole`/
 * `remove` both refuse an owner grant BEFORE calling their shared `mutate`
 * helper (distinct from, and in ADDITION to, `mutate`'s own "only an
 * owner-role CURRENT USER may mutate at all" gate) — this face's
 * `mn-access-role-change`/`mn-access-remove` handlers carry the identical
 * guard, byte-identical error strings included.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type {
  AccessGrantEntry,
  AccessGrantService,
  WorkspaceGraphRole,
} from '../../editor-services/workspace-gateway-service.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'

export const ACCESS_MANAGER_FACE_ID = 'access.manager'
export const ACCESS_MANAGER_RESOURCE_ADAPTER_ID = 'access.manager.access-service'

export interface AccessManagerParams {
  /** Declarative display fallback — `mn-access-manager` itself already falls back to `graphId` when this is absent. */
  readonly graphTitle?: string
}

/** The derived resource `access.manager`'s adapter computes — a fresh grant-list fetch bundled with the SAME real service for later add/role-change/remove/refresh (this file's own header). */
export interface AccessManagerResource {
  readonly graphId: string
  readonly status: 'ready' | 'error'
  readonly grants: readonly AccessGrantEntry[]
  readonly error: string
  readonly service: AccessGrantService
}

function isGraphLocator(locator: ResourceLocator): locator is Extract<ResourceLocator, { kind: 'graph' }> {
  return locator.kind === 'graph'
}

function accessResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isGraphLocator(locator)) {
    throw new Error(`access.manager: resource adapter given a non-graph locator (kind '${locator.kind}')`)
  }
  return resourceKeyTuple('graph-access', locator.graphId)
}

async function fetchAccessSnapshot(service: AccessGrantService, graphId: string): Promise<AccessManagerResource> {
  try {
    const grants = await service.list(graphId)
    return { graphId, status: 'ready', grants, error: '', service }
  } catch (error) {
    return { graphId, status: 'error', grants: [], error: error instanceof Error ? error.message : String(error), service }
  }
}

/**
 * `access.manager`'s DERIVED resource adapter (this file's own "LIVE-VS-
 * DERIVED VERDICT"). `compute()` never throws on a fetch failure — same
 * reasoning `workspace-picker-face.ts`'s own adapter documents: the REAL
 * component's error+retry UI should render, not the interpreter's generic
 * error leaf.
 */
export function createAccessManagerResourceAdapter(
  service: AccessGrantService,
): DerivedResourceAdapter<AccessManagerResource> {
  return {
    adapterId: ACCESS_MANAGER_RESOURCE_ADAPTER_ID,
    shape: 'derived',
    accepts: isGraphLocator,
    resourceKey: accessResourceKey,
    async compute(locator) {
      if (!isGraphLocator(locator)) throw new Error('unreachable: resourceKey already validated the kind')
      return fetchAccessSnapshot(service, locator.graphId)
    },
  }
}

function accessManagerConstraints(): LeafConstraints {
  // The panel owns its own internal `.embedded-panel` overflow:auto stage.
  return { minWidth: 280, minHeight: 220, overflow: 'clip' }
}

function graphTitleFromParams(descriptor: ViewDescriptor, fallback: string): string {
  const params = descriptor.params as AccessManagerParams | undefined
  return params?.graphTitle?.trim() || fallback
}

/** Real member identity — the SAME shape `MnAccessGrant` already declares in `@shrubbery/components`, kept local per this file's header. */
interface MnAccessGrantLike {
  readonly userId: string
  readonly role: WorkspaceGraphRole
  readonly grantedAt: string
  readonly grantedBy: string
  readonly email?: string
  readonly displayName?: string
}

interface MnAccessManagerModelLike {
  readonly graphId: string
  readonly graphTitle: string
  readonly currentRole: WorkspaceGraphRole | 'unknown'
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly grants: readonly MnAccessGrantLike[]
  readonly error?: string | null
  readonly notice?: string | null
  readonly busyUserId?: string | null
  readonly busyAction?: 'add' | 'role' | 'remove' | 'refresh' | null
}

/** The (loosely typed) property/event surface `mn-access-manager` exposes in `embedded` mode — mirrors that component's own real contract, kept local per this file's header. */
interface MnAccessManagerElement extends HTMLElement {
  embedded: boolean
  model: MnAccessManagerModelLike | null
}

interface AddDetail {
  readonly userId: string
  readonly role: 'viewer' | 'editor'
  readonly email?: string
  readonly displayName?: string
}
interface RoleChangeDetail {
  readonly userId: string
  readonly role: 'viewer' | 'editor'
}
interface RemoveDetail {
  readonly userId: string
}

export interface ConfirmRemoveOptions {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly cancelLabel: string
}

/** Minimal, mutable controller state for one mounted `access.manager` `FaceView` — the leaf-scoped mirror of `OrganismAccessGrantController`'s own state shape (this file's own header). */
interface AccessManagerViewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  grants: readonly AccessGrantEntry[]
  error: string
  notice: string
  busyUserId: string | null
  busyAction: 'add' | 'role' | 'remove' | 'refresh' | null
}

function memberName(grant: AccessGrantEntry): string {
  return grant.displayName?.trim() || grant.email?.trim() || grant.userId
}

function currentRoleOf(grants: readonly AccessGrantEntry[], currentUserId: string): WorkspaceGraphRole | 'unknown' {
  return grants.find((grant) => grant.userId === currentUserId)?.role ?? 'unknown'
}

/**
 * The `access.manager` `FaceRegistration`. `mount()` drives the REAL
 * `<mn-access-manager>` in `embedded` mode off a per-leaf state machine that
 * re-runs the SAME real `AccessGrantService` methods on every user action —
 * see this file's own "ORCHESTRATION" header section for why this mirrors,
 * rather than imports, `OrganismAccessGrantController`.
 *
 * `confirmRemove` is REQUIRED (wave1 review r1 WRONG fix — it used to be
 * optional, an "honest scope trade-off" this file's own header defended;
 * that trade-off let an unwired caller remove a member with ZERO
 * confirmation, which production's `OrganismAccessGrantController.remove`
 * never does). The caller MUST supply a real confirm implementation — the
 * harness backs it with the real `<mn-confirmation-dialog>` element, the
 * exact component `apps/organism/src/main.ts`'s own `confirmAction` drives.
 */
export function createAccessManagerFace(
  currentUserId: () => string,
  confirmRemove: (options: ConfirmRemoveOptions) => Promise<boolean>,
): FaceRegistration {
  return {
    faceId: ACCESS_MANAGER_FACE_ID,
    // A refetchable member-grant view with no meaningful local caret/
    // selection state worth protecting across a relocate — same
    // classification reasoning as `workspace-picker-face.ts` (task brief:
    // "derived/stamp"). In-flight add-form text is the one thing lost on a
    // relocate; the same trade-off `sparql.bindings-table` accepts for a
    // query leaf's own transient state.
    persistence: 'stamp',
    resourceAdapterId: ACCESS_MANAGER_RESOURCE_ADAPTER_ID,
    accepts: isGraphLocator,
    paramsSchema: closedParamsSchema({ graphTitle: { type: 'string', optional: true } }),
    constraints: accessManagerConstraints,
    mount(context) {
      const { target, descriptor, lease } = context
      if (descriptor.resource.kind !== 'graph') {
        throw new Error(`access.manager: unexpected resource kind '${descriptor.resource.kind}'`)
      }
      const { graphId } = descriptor.resource
      const resource = lease.value as AccessManagerResource
      const graphTitle = graphTitleFromParams(descriptor, graphId)

      const el = document.createElement('mn-access-manager') as MnAccessManagerElement
      el.embedded = true
      el.style.cssText = 'display:block;width:100%;height:100%;min-height:0;'

      let state: AccessManagerViewState = {
        status: resource.status,
        grants: resource.grants,
        error: resource.error,
        notice: '',
        busyUserId: null,
        busyAction: null,
      }
      let disposed = false
      let generation = 0

      function render(): void {
        el.model = {
          graphId,
          graphTitle,
          currentRole: currentRoleOf(state.grants, currentUserId()),
          status: state.status,
          grants: state.grants,
          error: state.error || null,
          notice: state.notice || null,
          busyUserId: state.busyUserId,
          busyAction: state.busyAction,
        }
      }

      async function reload(): Promise<void> {
        if (disposed) return
        const gen = ++generation
        state = { ...state, status: 'loading', busyAction: 'refresh', busyUserId: null, error: '', notice: '' }
        render()
        const snapshot = await fetchAccessSnapshot(resource.service, graphId)
        if (disposed || gen !== generation) return
        state = {
          status: snapshot.status,
          grants: snapshot.grants,
          error: snapshot.error,
          notice: '',
          busyUserId: null,
          busyAction: null,
        }
        render()
      }

      function ownerGuarded(): boolean {
        if (currentRoleOf(state.grants, currentUserId()) !== 'owner') {
          state = { ...state, error: 'Only the workspace owner can manage member access.', notice: '' }
          render()
          return false
        }
        return true
      }

      async function mutate(
        action: 'add' | 'role' | 'remove',
        userId: string,
        operation: () => Promise<void>,
        notice: string,
      ): Promise<void> {
        if (disposed || state.busyAction || !ownerGuarded()) return
        const gen = ++generation
        state = { ...state, busyAction: action, busyUserId: userId, error: '', notice: '' }
        render()
        let mutationAccepted = false
        try {
          await operation()
          mutationAccepted = true
          const snapshot = await fetchAccessSnapshot(resource.service, graphId)
          if (disposed || gen !== generation) return
          state = { status: snapshot.status, grants: snapshot.grants, error: snapshot.error, notice, busyUserId: null, busyAction: null }
        } catch (error) {
          if (disposed || gen !== generation) return
          const detail = error instanceof Error ? error.message : String(error)
          state = {
            ...state,
            status: state.grants.length > 0 ? 'ready' : 'error',
            busyUserId: null,
            busyAction: null,
            notice: '',
            error: mutationAccepted
              ? `The access change was accepted, but the member list could not be refreshed. Retry before making another change. ${detail}`
              : detail,
          }
        }
        render()
      }

      el.addEventListener('mn-access-open', () => {
        if (state.status === 'idle') void reload()
      })
      el.addEventListener('mn-access-refresh', () => { void reload() })
      el.addEventListener('mn-access-add', (event) => {
        const detail = (event as CustomEvent<AddDetail>).detail
        const userId = detail.userId.trim()
        if (!userId) {
          state = { ...state, error: 'A stable member user ID is required.' }
          render()
          return
        }
        if (state.grants.some((grant) => grant.userId === userId)) {
          state = { ...state, error: 'This user already has access. Change their role in the member list.' }
          render()
          return
        }
        const email = detail.email?.trim()
        const displayName = detail.displayName?.trim()
        void mutate(
          'add',
          userId,
          () => resource.service.put(graphId, userId, { role: detail.role, ...(email ? { email } : {}), ...(displayName ? { displayName } : {}) }),
          `Added ${displayName || email || userId} as ${detail.role}.`,
        )
      })
      el.addEventListener('mn-access-role-change', (event) => {
        const detail = (event as CustomEvent<RoleChangeDetail>).detail
        const userId = detail.userId.trim()
        const grant = state.grants.find((candidate) => candidate.userId === userId)
        if (!grant) {
          state = { ...state, error: 'That member is no longer present. Refresh the member list.' }
          render()
          return
        }
        // wave1 review r1 WRONG: production's real `changeRole` refuses an
        // owner grant BEFORE ever calling `mutate` (`access-grant-
        // controller.ts`'s own guard, same error string) — this face used to
        // skip straight to the generic no-op-on-same-role check, letting an
        // owner's role be silently downgraded through this leaf.
        if (grant.role === 'owner') {
          state = { ...state, error: 'The owner grant cannot be changed through the member access API.', notice: '' }
          render()
          return
        }
        if (grant.role === detail.role) return
        void mutate(
          'role',
          userId,
          () => resource.service.put(graphId, userId, {
            role: detail.role,
            ...(grant.email ? { email: grant.email } : {}),
            ...(grant.displayName ? { displayName: grant.displayName } : {}),
          }),
          `Updated ${memberName(grant)} to ${detail.role}.`,
        )
      })
      el.addEventListener('mn-access-remove', (event) => {
        const detail = (event as CustomEvent<RemoveDetail>).detail
        const userId = detail.userId.trim()
        // wave1 review r1 WRONG: production's real `remove()` checks
        // `ownerScope()` (current user must be owner) FIRST, before even
        // looking up the grant — this face used to defer that check to
        // AFTER the confirm dialog resolved (inside `mutate`), which is a
        // different, later place in the sequence than production runs it.
        // Matching the exact order matters: a non-owner removing the OWNER's
        // own grant must see "Only the workspace owner..." (this gate), not
        // "The owner grant cannot be removed" (the next one) — production's
        // own ordering, preserved here byte-for-byte.
        if (!ownerGuarded()) return
        const grant = state.grants.find((candidate) => candidate.userId === userId)
        if (!grant) {
          state = { ...state, error: 'That member is no longer present. Refresh the member list.' }
          render()
          return
        }
        // Same real guard `remove()` runs next — an owner grant is never
        // removable, full stop.
        if (grant.role === 'owner') {
          state = { ...state, error: 'The owner grant cannot be removed.', notice: '' }
          render()
          return
        }
        const proceed = async (): Promise<void> => {
          // `confirmRemove` is REQUIRED (wave1 review r1 WRONG: it used to be
          // optional, so an unwired harness removed ANY member — owner grant
          // included, per the guard above notwithstanding — with zero
          // confirmation; production always confirms, no exceptions).
          const confirmed = await confirmRemove({
            title: `Remove ${memberName(grant)}?`,
            message: `${memberName(grant)} will immediately lose ${grant.role} access to ${graphTitle}.`,
            confirmLabel: 'Remove member',
            cancelLabel: 'Cancel',
          })
          if (!confirmed) return
          // Re-check after the confirm resolves — the SAME defensive re-check
          // `access-grant-controller.ts`'s own `remove()` runs
          // (`this.currentRole !== 'owner'`) for the case role/grants moved
          // while the dialog was open.
          if (!ownerGuarded()) return
          await mutate('remove', userId, () => resource.service.remove(graphId, userId), `Removed ${memberName(grant)}.`)
        }
        void proceed()
      })

      render()
      target.replaceChildren(el)

      const view: FaceView = {
        focus(_request) {
          const focusTarget = el.shadowRoot?.querySelector<HTMLElement>('[name="access-user-id"], .refresh, .retry')
          if (focusTarget) {
            focusTarget.focus()
            return true
          }
          return false
        },
        blur() {},
        resize() {
          // <mn-access-manager>'s embedded `:host` fills 100%/100% via CSS;
          // the interpreter already sized `target`. MUST NOT write layout
          // state.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          el.remove()
        },
      }
      return view
    },
  }
}
