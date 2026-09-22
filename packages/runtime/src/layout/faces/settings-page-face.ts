/**
 * settings-page-face.ts — the `settings.page` face (Wave 1, north star
 * §2.2/§3: "Elevate the 5 trapped faces").
 *
 * WRAPS THE REAL `mn-settings-page` (`@shrubbery/components`) — today reached
 * ONLY via `apps/organism/src/cell/app-routes.ts`'s full-page
 * `window.location.assign('/settings')` route (catalogue: "94KB master-detail
 * workbench... reached ONLY via full-page navigation, never as an in-shell
 * popover or spine leaf"). This face is a CHANGE OF MOUNT, not a rewrite:
 * `mount()` below drives the exact same component through the exact same
 * property/event contract `app-routes.ts`'s `renderSettingsRoute` already
 * uses (`status`/`error`/`activeSection`/`userName`/`userEmail`/`sections`,
 * and the eight `mn-settings-*` events) — just imperatively, inside a leaf
 * wrapper, driven by a per-leaf controller instead of `renderSettingsRoute`'s
 * lit-html `draw()`/`refresh()`/`mutate()` closures (same reasoning as
 * `doc-history-face.ts`'s own controller: this face's `mount()` IS the
 * controller). `mn-settings-page`'s OWN internal master-detail navigation,
 * its 13 real sections, and every real backing effect stay entirely its own
 * business — this file adds no settings business logic of its own, and
 * `mn-settings-page.ts` itself is untouched. `packages/runtime` cannot
 * statically import `@shrubbery/components` (see `doc-history-face.ts`'s own
 * header for why), so — like `app-routes.ts` itself does with lit-html, and
 * like `doc-history-face.ts` does imperatively — this file creates the
 * element by TAG NAME and drives it through a locally-typed property bag
 * structurally mirroring the real component's props/events 1:1.
 *
 * `showClose` (wave1 review r1 WRONG fix): `mn-settings-page` now carries the
 * SAME additive, opt-in `showClose` toggle `mn-doc-history-panel` already
 * has (default `true`, preserving the full-page route's own real "back to
 * workspace"/"×" behavior byte-for-byte). This file used to leave BOTH close
 * controls visibly rendered while treating `mn-settings-close` as a
 * permanent no-op — a dead, clickable control, not an honest scope boundary
 * ("a leaf has no close_leaf channel" is true, but the fix is to not RENDER
 * a control that promises one, not to render it and silently ignore
 * clicks). `mount()` below sets `showClose = false`; the `mn-settings-close`
 * listener stays registered (defensive no-op, same posture `doc-history-
 * face.ts` keeps for its own `mn-doc-history-close`) but is now genuinely
 * unreachable since the component renders neither control.
 *
 * LIVE-VS-DERIVED VERDICT: DURABLE. Unlike `doc.history`'s snapshot list
 * (explicitly fetch-on-demand/refetchable), settings carries a single,
 * request-scoped SNAPSHOT of many real backing services (auth, billing,
 * provider secrets, local-AI, graph ops) that legitimately wants to be ONE
 * shared instance across every simultaneously-open `settings.page` leaf —
 * two leaves editing the SAME settings service must observe each other's
 * writes (design's own "two leaves on the same document share one exact
 * provider" property, generalized here to "one exact settings-service
 * instance" instead of a CRDT room). The resource adapter therefore treats
 * the injected `SettingsPageService` as a `durable` resource: `load()`
 * returns the SAME service reference for every acquire of the well-known
 * settings resource (mirrors `sophia-home-face.ts`'s trivial marker adapter
 * — there is no per-key variance to key on, since there is exactly one
 * settings resource); `dispose()` is a no-op (the CALLER, not this face,
 * owns the service instance's lifetime — same reasoning `sophia.home`'s
 * adapter gives).
 *
 * Resource locator: `{ kind: 'iri', iri: 'urn:sophia:settings' }` — a
 * well-known, content-free identity marker, same family as Phase 1's own
 * `SOPHIA_HOME_RESOURCE` (`urn:sophia:home`). Settings has no per-document or
 * per-graph identity in the real production route today (`SettingsAppRoute`
 * carries only a `sectionId`, no `graphId`) — an `iri` locator is the
 * honest, existing closed-union kind for "the one workspace-singleton
 * settings surface," not an overload of `document`/`query`/`chat`/`graph`'s
 * OWN identity fields.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import {
  closedParamsSchema,
  type DurableResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'

export const SETTINGS_PAGE_FACE_ID = 'settings.page'
export const SETTINGS_PAGE_RESOURCE_ADAPTER_ID = 'settings.page.service'
export const SETTINGS_PAGE_IRI = 'urn:sophia:settings'

/**
 * The 13 real `MnSettingsSectionId` values `mn-settings-page.ts` itself
 * enumerates (`packages/components/src/mn-settings-page.ts`'s own type,
 * whose declaration also carries a `| string` escape hatch this face's
 * CLOSED params schema deliberately does not — a leaf's durable, portable
 * intent names one of the real, known sections, never an arbitrary string).
 */
export const SETTINGS_PAGE_SECTION_IDS = [
  'account',
  'appearance',
  'interface',
  'billing',
  'usage',
  'history',
  'graph-ops',
  'imports',
  'api-keys',
  'api-mcp',
  'local-ai',
  'experimental',
  'privacy',
] as const

export type SettingsPageSectionId = (typeof SETTINGS_PAGE_SECTION_IDS)[number]

export interface SettingsPageParams {
  readonly section?: SettingsPageSectionId
}

// ── the real component's structural mirror (packages/runtime cannot import
// @shrubbery/components — see this file's own header) ──────────────────────

export type SettingsPageStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SettingsPageTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

export interface SettingsPageMetric {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly detail?: string | null
  readonly tone?: SettingsPageTone
}

export interface SettingsPageToggle {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly checked: boolean
  readonly disabled?: boolean
}

export interface SettingsPageOption {
  readonly value: string
  readonly label: string
}

export interface SettingsPageSelect {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly value: string
  readonly options: readonly SettingsPageOption[]
  readonly disabled?: boolean
}

export interface SettingsPageSecret {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly configured: boolean
  readonly provider?: string | null
  readonly disabled?: boolean
}

export interface SettingsPageJob {
  readonly id: string
  readonly label: string
  readonly status: string
  readonly detail?: string | null
  readonly progress?: number | null
  readonly actionLabel?: string | null
  readonly disabled?: boolean
}

export interface SettingsPageAction {
  readonly id: string
  readonly label: string
  readonly description?: string | null
  readonly icon?: string | null
  readonly variant?: 'default' | 'danger'
  readonly disabled?: boolean
}

export interface SettingsPageSection {
  readonly id: string
  readonly title: string
  readonly description?: string | null
  readonly wide?: boolean
  readonly metrics?: readonly SettingsPageMetric[]
  readonly toggles?: readonly SettingsPageToggle[]
  readonly selects?: readonly SettingsPageSelect[]
  readonly secrets?: readonly SettingsPageSecret[]
  readonly jobs?: readonly SettingsPageJob[]
  readonly actions?: readonly SettingsPageAction[]
  readonly notes?: readonly string[]
}

export interface SettingsPageToggleChangeDetail {
  readonly sectionId: string
  readonly settingId: string
  readonly checked: boolean
}

export interface SettingsPageSelectChangeDetail {
  readonly sectionId: string
  readonly settingId: string
  readonly value: string
}

export interface SettingsPageActionDetail {
  readonly sectionId: string
  readonly actionId: string
}

export interface SettingsPageSecretActionDetail {
  readonly sectionId: string
  readonly secretId: string
  readonly action: 'configure' | 'delete'
}

export interface SettingsPageJobActionDetail {
  readonly sectionId: string
  readonly jobId: string
}

export interface SettingsPageSnapshot {
  readonly userName: string
  readonly userEmail: string
  readonly sections: readonly SettingsPageSection[]
}

/**
 * The injected real backing service — structurally mirrors `apps/organism/
 * src/cell/settings-service.ts`'s `OrganismSettingsService` 1:1 (a value of
 * that real, production `DefaultOrganismSettingsService` shape is directly
 * assignable here with no adapter code, exactly like `DocumentSnapshotService`
 * mirrors organism's inline REST calls). `packages/runtime` cannot import
 * `apps/organism` (apps depend on packages, never the reverse) — the CALLER
 * (the harness today; production-shell integration is Wave 3) constructs the
 * real service and injects it via `createSettingsPageResourceAdapter`.
 */
export interface SettingsPageService {
  load(): Promise<SettingsPageSnapshot>
  toggle(detail: SettingsPageToggleChangeDetail): Promise<void>
  select(detail: SettingsPageSelectChangeDetail): Promise<void>
  secret(detail: SettingsPageSecretActionDetail): Promise<void>
  action(detail: SettingsPageActionDetail): Promise<void>
  job(detail: SettingsPageJobActionDetail): Promise<void>
  /** Optional live-operation invalidation (job progress, errors, history refresh) — mirrors `OrganismSettingsService.subscribe`. */
  subscribe?(callback: () => void): () => void
}

/** The (loosely typed) property/event surface `mn-settings-page` exposes — mirrors `app-routes.ts`'s `renderSettingsRoute` binding 1:1, plus `showClose` (this file's own header — wave1 review r1 WRONG fix). */
interface MnSettingsPageElement extends HTMLElement {
  status: SettingsPageStatus
  error: string
  activeSection: string
  userName: string
  userEmail: string
  sections: readonly SettingsPageSection[]
  showClose: boolean
}

function isSettingsResource(locator: ResourceLocator): boolean {
  return locator.kind === 'iri' && locator.iri === SETTINGS_PAGE_IRI
}

function settingsResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isSettingsResource(locator)) {
    throw new Error(`settings.page: resource adapter given an unexpected locator (kind '${locator.kind}')`)
  }
  return resourceKeyTuple('iri', SETTINGS_PAGE_IRI)
}

/** A trivial durable resource: the caller's own service instance, shared verbatim — no per-key variance, nothing to fetch or dispose here (the CALLER owns the service's lifetime). */
export function createSettingsPageResourceAdapter(service: SettingsPageService): DurableResourceAdapter<SettingsPageService> {
  return {
    adapterId: SETTINGS_PAGE_RESOURCE_ADAPTER_ID,
    shape: 'durable',
    accepts: isSettingsResource,
    resourceKey: settingsResourceKey,
    async load() {
      return service
    },
    dispose() {
      // The injected service outlives any one leaf; this face never owns tearing it down.
    },
  }
}

function settingsPageConstraints(): LeafConstraints {
  // The real component owns its own internal nav-column/detail-pane scroll
  // regions — 'clip' avoids a redundant outer scrollbar (same reasoning as
  // doc-history-face.ts's own constraints).
  return { minWidth: 420, minHeight: 320, overflow: 'clip' }
}

function isKnownSection(value: unknown): value is SettingsPageSectionId {
  return typeof value === 'string' && (SETTINGS_PAGE_SECTION_IDS as readonly string[]).includes(value)
}

function initialSectionFromParams(descriptor: ViewDescriptor): SettingsPageSectionId {
  const params = descriptor.params as SettingsPageParams | undefined
  return isKnownSection(params?.section) ? params!.section! : 'account'
}

/**
 * The `settings.page` `FaceRegistration`. `mount()` creates the REAL
 * `<mn-settings-page>` driven off a per-leaf controller that calls the real
 * `SettingsPageService` on every user action, mirroring `app-routes.ts`'s own
 * `draw`/`refresh`/`mutate` closures but targeting the mounted element
 * imperatively.
 */
export function createSettingsPageFace(): FaceRegistration {
  return {
    faceId: SETTINGS_PAGE_FACE_ID,
    // Carries real local navigation state (which section is active, in-flight
    // status) a user would not want silently discarded across a move/swap/
    // focus handoff — same reasoning doc-history-face.ts gives.
    persistence: 'persistent-relocatable',
    resourceAdapterId: SETTINGS_PAGE_RESOURCE_ADAPTER_ID,
    accepts: isSettingsResource,
    paramsSchema: closedParamsSchema({
      section: { type: 'enum', values: [...SETTINGS_PAGE_SECTION_IDS], optional: true },
    }),
    constraints: settingsPageConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const service = lease.value as SettingsPageService

      const page = document.createElement('mn-settings-page') as MnSettingsPageElement
      page.style.cssText = 'display:block;width:100%;height:100%;min-height:0;'
      page.status = 'loading'
      page.error = ''
      page.activeSection = initialSectionFromParams(descriptor)
      page.userName = ''
      page.userEmail = ''
      page.sections = []
      // No channel to request close_leaf — chrome owns that (this file's own
      // header, wave1 review r1 WRONG fix): hide BOTH real close controls
      // rather than rendering one that silently does nothing on click.
      page.showClose = false
      target.replaceChildren(page)

      let disposed = false
      let requestSeq = 0
      let unsubscribe: () => void = () => undefined

      async function mutate(effect: () => Promise<void>): Promise<void> {
        try {
          await effect()
          await refresh(false)
        } catch (error) {
          if (disposed) return
          page.status = 'error'
          page.error = error instanceof Error ? error.message : String(error)
        }
      }

      async function refresh(showLoading = true): Promise<void> {
        const requestId = ++requestSeq
        if (showLoading) page.status = 'loading'
        page.error = ''
        try {
          const snapshot = await service.load()
          if (disposed || requestId !== requestSeq) return
          page.userName = snapshot.userName
          page.userEmail = snapshot.userEmail
          page.sections = snapshot.sections
          page.status = 'ready'
        } catch (error) {
          if (disposed || requestId !== requestSeq) return
          page.status = 'error'
          page.error = error instanceof Error ? error.message : String(error)
          page.sections = []
        }
      }

      page.addEventListener('mn-settings-section-change', (event) => {
        const detail = (event as CustomEvent<{ sectionId: string }>).detail
        page.activeSection = detail.sectionId
      })
      page.addEventListener('mn-settings-toggle-change', (event) => {
        const detail = (event as CustomEvent<SettingsPageToggleChangeDetail>).detail
        void mutate(() => service.toggle(detail))
      })
      page.addEventListener('mn-settings-select-change', (event) => {
        const detail = (event as CustomEvent<SettingsPageSelectChangeDetail>).detail
        void mutate(() => service.select(detail))
      })
      page.addEventListener('mn-settings-secret-action', (event) => {
        const detail = (event as CustomEvent<SettingsPageSecretActionDetail>).detail
        void mutate(() => service.secret(detail))
      })
      page.addEventListener('mn-settings-action', (event) => {
        const detail = (event as CustomEvent<SettingsPageActionDetail>).detail
        void mutate(() => service.action(detail))
      })
      page.addEventListener('mn-settings-job-action', (event) => {
        const detail = (event as CustomEvent<SettingsPageJobActionDetail>).detail
        void mutate(() => service.job(detail))
      })
      page.addEventListener('mn-settings-refresh', () => {
        void refresh()
      })
      // No-op: a leaf has no "close the leaf" channel to request (see this
      // file's own header) — closing is a shell/chrome close_leaf operation.
      page.addEventListener('mn-settings-close', () => {})

      void refresh()
      if (service.subscribe) {
        let queued = false
        unsubscribe = service.subscribe(() => {
          if (queued || disposed) return
          queued = true
          queueMicrotask(() => {
            queued = false
            if (!disposed) void refresh(false)
          })
        })
      }

      const view: FaceView = {
        focus(_request) {
          const pageWithFocus = page as unknown as { focus?: () => void }
          pageWithFocus.focus?.()
          return true
        },
        blur() {},
        resize() {
          // The page fills 100%/100% via its own :host CSS — no-op.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribe()
          page.remove()
        },
      }
      return view
    },
  }
}
