/**
 * workspace-picker-face.ts — the `workspace.picker` face (Wave 1, north star
 * §2.2/§3: "Elevate the 5 trapped faces" — the catalogue's own "canonical
 * face-vs-chrome boundary case").
 *
 * WRAPS THE REAL `mn-workspace-selector` (`@shrubbery/components`) — today
 * mounted ONLY as `mn-top-bar`'s trigger+popover switcher. This face is a
 * CHANGE OF MOUNT, not a rewrite: `mount()` drives the SAME real component,
 * through the SAME real event contract (`mn-workspace-refresh`/`mn-workspace-
 * select`, `mn-workspace-selector-model.ts`'s own `MnWorkspaceIntentDetailMap`)
 * — but with its new, additive `embedded` property set (that component's own
 * header: "an ADDITIVE, opt-in mode... only WHICH delivery form wraps the
 * real content"). The catalogue is explicit that only the WORKSPACES
 * themselves are faceable — "the top-bar dropdown remains chrome" — so this
 * face elevates `mn-workspace-selector`'s embedded CONTENT as an independent
 * leaf; `mn-top-bar`'s own trigger+popover usage is untouched by this file.
 * `packages/runtime` cannot statically import `@shrubbery/components`'s
 * class (`doc-history-face.ts`'s own header states the same constraint), so
 * — exactly like that file already does — the element is created by TAG NAME
 * and driven through a locally-typed property bag.
 *
 * LIVE-VS-DERIVED VERDICT: DERIVED (task brief: "derived/stamp"). The
 * catalog (`GET /graphs`) is a fetch-on-demand, explicitly-refetchable query
 * (a "Retry" affordance, this face's own `mn-workspace-refresh` reload), never
 * a subscribed/streaming resource — the north star's own DERIVED definition.
 * `compute()` still bundles the real `WorkspaceCatalogService` reference
 * alongside its first-fetch snapshot (mirrors `doc-history-face.ts`'s own
 * `{roomLease, snapshots}` bundling of a live service beside computed data):
 * a derived resource has "no durable identity, no cross-leaf sharing" (design
 * `types.ts`), but this face still needs to re-run the SAME real fetch on a
 * user-triggered refresh without re-acquiring a whole new broker lease.
 *
 * SELECTION CALLBACK (task brief: "wire a real callback param, do not fork
 * navigation"): `createWorkspacePickerFace` takes a REAL `onSelectWorkspace`
 * dependency at REGISTRATION time (mirrors `createDocHistoryResourceAdapter`'s
 * own real production-dependency injection) — `mount()` forwards the SAME
 * `mn-workspace-select` event detail the top-bar dropdown already emits
 * today; this face invents no navigation logic of its own. KNOWN, DOCUMENTED
 * LIMITATION (production-shell integration is Wave 3, not this wave):
 * `mn-workspace-selector`'s own `pendingGraphId` "Switching to X…" spinner
 * only self-clears once the HOST reflects the switch back through
 * `activeGraphId` (its own `willUpdate`) — this face reads `activeGraphId`
 * from a closed, DECLARATIVE face param (`WorkspacePickerParams.activeGraphId`),
 * never from a live app-state subscription, so in a harness/host that never
 * re-mints this leaf's descriptor after a real switch, the spinner will not
 * self-clear. Reflecting the switch is exactly the shell-navigation wiring
 * "do not fork navigation" reserves for Wave 3 — inventing an optimistic
 * local echo here would misrepresent whether the real switch actually
 * completed, so this face deliberately does not.
 *
 * CREATE/DELETE (wave1 review r1 WRONG fix): both are now wired for real,
 * over the SAME real `WorkspaceCatalogService.create`/`.remove` — the exact
 * gateway routes `apps/organism/src/main.ts`'s own `createHostedWorkspace`/
 * `deleteHostedWorkspace` already drive. `createCapability` is genuinely
 * AVAILABLE; each projected row omits `capabilities` entirely, which is
 * `mn-workspace-selector-model.ts`'s own documented backward-compatible
 * path ("when omitted, the current owner-delete contract remains backwards
 * compatible") — the EXACT SAME real behavior production's own
 * `workspaceSummaries()` gets (it never sets `capabilities` either).
 * RENAME/LEAVE remain unwired, honestly: production itself has no
 * `onWorkspaceRename`/`onWorkspaceLeave` handler anywhere in `main.ts` — the
 * model's own "rename and leave are never inferred" rule means they stay
 * hidden with zero extra work on this face's part, not a deliberately
 * suppressed capability.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type {
  WorkspaceCatalogEntry,
  WorkspaceCatalogService,
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

export const WORKSPACE_PICKER_FACE_ID = 'workspace.picker'
export const WORKSPACE_PICKER_RESOURCE_ADAPTER_ID = 'workspace.picker.catalog-service'

/** A stable, content-free IRI marker — the catalog is a global resource, not scoped to any one graph (mirrors `SOPHIA_HOME_RESOURCE`'s own "content-free IRI, not a document" pattern, `@shrubbery/nucleus/layout`'s `types.ts`). */
export const WORKSPACE_CATALOG_IRI = 'urn:shrubbery:workspace-catalog'
export const WORKSPACE_CATALOG_RESOURCE: ResourceLocator = Object.freeze({ kind: 'iri', iri: WORKSPACE_CATALOG_IRI })

export interface WorkspacePickerParams {
  /** Declarative "mark this workspace active" hint — see this file's header for why it is NOT live-subscribed. */
  readonly activeGraphId?: string
}

/** The derived resource `workspace.picker`'s adapter computes — a fresh catalog fetch bundled with the SAME real service for later re-fetch (this file's own header). */
export interface WorkspaceCatalogResource {
  readonly status: 'ready' | 'error'
  readonly entries: readonly WorkspaceCatalogEntry[]
  readonly error: string
  readonly service: WorkspaceCatalogService
}

function isWorkspaceCatalogResource(locator: ResourceLocator): boolean {
  return locator.kind === 'iri' && locator.iri === WORKSPACE_CATALOG_IRI
}

function workspaceCatalogResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isWorkspaceCatalogResource(locator)) {
    throw new Error(`workspace.picker: resource adapter given an unexpected locator (kind '${locator.kind}')`)
  }
  return resourceKeyTuple('iri', WORKSPACE_CATALOG_IRI)
}

async function fetchCatalogSnapshot(service: WorkspaceCatalogService): Promise<WorkspaceCatalogResource> {
  try {
    const entries = await service.list()
    return { status: 'ready', entries, error: '', service }
  } catch (error) {
    return { status: 'error', entries: [], error: error instanceof Error ? error.message : String(error), service }
  }
}

/**
 * `workspace.picker`'s DERIVED resource adapter (this file's own "LIVE-VS-
 * DERIVED VERDICT"). `compute()` never throws on a fetch failure — it
 * captures the error into the returned snapshot so the REAL `mn-workspace-
 * selector` component renders its own error+retry UI, rather than the
 * interpreter's generic "resource unavailable" error leaf preempting it
 * (`sparql.bindings-table` reasons the same way about a CONSTRUCT/DESCRIBE
 * result: "an honest error, not a fabricated empty table").
 */
export function createWorkspacePickerResourceAdapter(
  service: WorkspaceCatalogService,
): DerivedResourceAdapter<WorkspaceCatalogResource> {
  return {
    adapterId: WORKSPACE_PICKER_RESOURCE_ADAPTER_ID,
    shape: 'derived',
    accepts: isWorkspaceCatalogResource,
    resourceKey: workspaceCatalogResourceKey,
    async compute() {
      return fetchCatalogSnapshot(service)
    },
  }
}

function workspacePickerConstraints(): LeafConstraints {
  // The selector owns its own internal `.embedded-menu` overflow:auto stage.
  return { minWidth: 220, minHeight: 160, overflow: 'clip' }
}

function activeGraphIdFromParams(descriptor: ViewDescriptor): string {
  const params = descriptor.params as WorkspacePickerParams | undefined
  return params?.activeGraphId ?? ''
}

/**
 * The projected `MnWorkspaceSummary`-shaped row `mn-workspace-selector`
 * renders — locally typed since `packages/runtime` cannot import
 * `@shrubbery/components` (this file's own header). `capabilities` is
 * OPTIONAL (wave1 review r1 WRONG fix: it used to be a required, always-
 * empty field, which — per `mn-workspace-selector-model.ts`'s own
 * `workspaceActionCapability` — actively OPTS OUT of the model's
 * backward-compatible owner-delete inference, silently reducing this face
 * BELOW the component's own bare-minimum default). Omitting it entirely
 * activates that inference — the EXACT SAME real behavior production's own
 * `apps/organism/src/main.ts` gets (`workspaceSummaries()` never sets
 * `capabilities` either).
 */
interface MnWorkspaceSummaryLike {
  readonly graphId: string
  readonly title: string
  readonly role: 'viewer' | 'editor' | 'owner'
  readonly cellState: 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
}

function projectSummary(entry: WorkspaceCatalogEntry): MnWorkspaceSummaryLike {
  return {
    graphId: entry.graphId,
    title: entry.title,
    role: entry.role,
    cellState: entry.cellState,
  }
}

const ENABLED_CREATE = Object.freeze({ available: true })

/** The (loosely typed) property/event surface `mn-workspace-selector` exposes in `embedded` mode — mirrors that component's own real contract, kept local per this file's header. */
interface MnWorkspaceSelectorElement extends HTMLElement {
  embedded: boolean
  workspaces: readonly MnWorkspaceSummaryLike[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  activeGraphId: string
  busyGraphId: string
  createCapability: { readonly available: boolean; readonly disabledReason?: string }
}

/** Minimal, mutable controller state for one mounted `workspace.picker` `FaceView`. */
interface WorkspacePickerViewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  entries: readonly WorkspaceCatalogEntry[]
  error: string
}

export interface WorkspaceDeleteConfirmOptions {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly cancelLabel: string
}

/**
 * Create/delete real dependencies (wave1 review r1 WRONG fix: this face used
 * to hard-disable both, "out of this wave's scope", even though
 * `WorkspaceCatalogService.create`/`.remove` — the exact real gateway routes
 * `apps/organism/src/main.ts`'s own `createHostedWorkspace`/
 * `deleteHostedWorkspace` already drive — were a one-line extension away).
 * REQUIRED, mirroring `access-manager-face.ts`'s/`doc-history-face.ts`'s own
 * required confirm dependencies: the caller supplies real UI, this face
 * never fabricates its own prompt/confirm affordance.
 */
export interface WorkspacePickerCapabilities {
  /** Prompts for a new workspace's title; `null` = cancelled. Mirrors `main.ts`'s own `promptForText` call inside `createHostedWorkspace`. */
  readonly promptCreateTitle: () => Promise<string | null>
  /** Confirms a delete; mirrors `deleteHostedWorkspace`'s own `confirmAction` call. */
  readonly confirmDelete: (options: WorkspaceDeleteConfirmOptions) => Promise<boolean>
}

/**
 * The `workspace.picker` `FaceRegistration`. `mount()` drives the REAL
 * `<mn-workspace-selector>` in `embedded` mode off a per-leaf state machine
 * that re-runs the SAME real `WorkspaceCatalogService.list()` on refresh
 * (mirrors `sophia-home-face.ts`'s "trivial durable marker" simplicity where
 * possible, `doc-history-face.ts`'s per-leaf reload loop where a real refetch
 * channel is needed). Create/delete now wired for real (see
 * `WorkspacePickerCapabilities`'s own doc comment) — rename/leave remain
 * genuinely out of scope: production itself never wires them either (main.ts
 * has no `onWorkspaceRename`/`onWorkspaceLeave` handler at all), so there is
 * no real behavior to mirror.
 */
export function createWorkspacePickerFace(
  onSelectWorkspace: (workspace: WorkspaceCatalogEntry) => void,
  capabilities: WorkspacePickerCapabilities,
): FaceRegistration {
  return {
    faceId: WORKSPACE_PICKER_FACE_ID,
    // A refetchable catalog view with no meaningful local caret/selection
    // state worth protecting across a relocate — `sparql.bindings-table`'s
    // own classification reasoning (task brief: "derived/stamp").
    persistence: 'stamp',
    resourceAdapterId: WORKSPACE_PICKER_RESOURCE_ADAPTER_ID,
    accepts: isWorkspaceCatalogResource,
    paramsSchema: closedParamsSchema({ activeGraphId: { type: 'string', optional: true } }),
    constraints: workspacePickerConstraints,
    mount(context) {
      const { target, descriptor, lease } = context
      const resource = lease.value as WorkspaceCatalogResource

      // `as unknown as` (not a direct `as`): an app that also depends on
      // `@shrubbery/components` (e.g. `apps/organism`) sees the REAL
      // `MnWorkspaceSelector` class through the global custom-element tag
      // map, and its real `MnWorkspaceCapabilities` type is not directly
      // assignable to this file's own narrower `MnWorkspaceSummaryLike`
      // (`packages/runtime` itself never sees that real type — this file's
      // own header). The indirection is exactly what TS's own error
      // suggests; the runtime tag-name creation is identical either way.
      const el = document.createElement('mn-workspace-selector') as unknown as MnWorkspaceSelectorElement
      el.embedded = true
      el.style.cssText = 'display:block;width:100%;height:100%;min-height:0;'
      const activeGraphId = activeGraphIdFromParams(descriptor)
      el.activeGraphId = activeGraphId
      el.createCapability = ENABLED_CREATE
      el.busyGraphId = ''

      let state: WorkspacePickerViewState = { status: resource.status, entries: resource.entries, error: resource.error }
      let disposed = false
      let requestSeq = 0
      let busyGraphId = ''

      function render(): void {
        el.status = state.status === 'ready' ? 'ready' : state.status === 'error' ? 'error' : 'loading'
        el.error = state.error
        el.workspaces = state.entries.map(projectSummary)
        el.busyGraphId = busyGraphId
      }

      async function reload(): Promise<void> {
        if (disposed) return
        const requestId = ++requestSeq
        state = { ...state, status: 'loading', error: '' }
        render()
        const snapshot = await fetchCatalogSnapshot(resource.service)
        if (disposed || requestId !== requestSeq) return
        state = { status: snapshot.status, entries: snapshot.entries, error: snapshot.error }
        render()
      }

      el.addEventListener('mn-workspace-refresh', () => { void reload() })
      el.addEventListener('mn-workspace-select', (event) => {
        const detail = (event as CustomEvent<{ workspace: MnWorkspaceSummaryLike }>).detail
        const match = state.entries.find((entry) => entry.graphId === detail.workspace.graphId)
        if (match) onSelectWorkspace(match)
      })
      el.addEventListener('mn-workspace-create', () => {
        const proceed = async (): Promise<void> => {
          const title = await capabilities.promptCreateTitle()
          // Production parity (`main.ts`'s `createHostedWorkspace`): a
          // cancelled OR empty title never creates (`if (!title) return`) —
          // production never mints an untitled workspace from this path.
          const trimmed = title?.trim() ?? ''
          if (!trimmed) return
          state = { ...state, error: '' }
          render()
          try {
            const created = await resource.service.create({ title: trimmed })
            await reload()
            if (disposed) return
            const match = state.entries.find((entry) => entry.graphId === created.graphId)
            // Production parity: the created workspace MUST appear in the
            // refreshed list — silently doing nothing would hide a real
            // control-plane fault behind a successful-looking click.
            if (!match) throw new Error(`Created workspace "${created.graphId}" was absent from the refreshed graph list.`)
            onSelectWorkspace(match)
          } catch (error) {
            if (disposed) return
            state = { ...state, error: error instanceof Error ? error.message : String(error) }
            render()
          }
        }
        void proceed()
      })
      el.addEventListener('mn-workspace-delete', (event) => {
        const detail = (event as CustomEvent<{ workspace: MnWorkspaceSummaryLike }>).detail
        const graphId = detail.workspace.graphId
        const match = state.entries.find((entry) => entry.graphId === graphId)
        // Defense-in-depth (never trust client-side gating alone — same
        // reasoning `access-manager-face.ts`'s own owner-grant guard gives):
        // the real component only offers the delete action on `role ===
        // 'owner'` rows, but this face re-checks the CURRENT fetched entry
        // rather than trusting the event's own (possibly stale) detail.
        if (!match || match.role !== 'owner') return
        // Production parity (`main.ts`'s `deleteHostedWorkspace`): refuse to
        // delete the workspace you are currently IN when no other editable
        // workspace remains to fall back to — otherwise the delete strands the
        // session with nothing editable. The face receives `activeGraphId`, so
        // it can (and must) reproduce the guard the imperative host enforces.
        const editableReplacement = state.entries.find(
          (entry) => entry.graphId !== graphId && entry.role !== 'viewer',
        )
        if (graphId === activeGraphId && !editableReplacement) {
          state = { ...state, error: 'Create another editable workspace before deleting the active workspace.' }
          render()
          return
        }
        const proceed = async (): Promise<void> => {
          const confirmed = await capabilities.confirmDelete({
            title: `Delete "${match.title || match.graphId}"?`,
            message: `Delete "${match.title || match.graphId}"? This permanently deletes its documents and artifacts.`,
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
          })
          if (!confirmed) return
          busyGraphId = graphId
          render()
          try {
            await resource.service.remove(graphId)
            busyGraphId = ''
            await reload()
            if (disposed) return
            // Production parity (`deleteHostedWorkspace`'s post-delete
            // switch): after deleting the ACTIVE workspace, move the session
            // onto an editable replacement — prefer a running cell, exactly
            // as production does after its own refresh. The pre-confirm
            // guard above guarantees a replacement existed, but the refetch
            // is the authority; if it vanished meanwhile, say so honestly.
            if (graphId === activeGraphId) {
              const replacement = state.entries.find((entry) => entry.role !== 'viewer' && entry.cellState === 'running')
                ?? state.entries.find((entry) => entry.role !== 'viewer')
              if (!replacement) throw new Error('Workspace deleted, but no editable workspace remains. Create a new workspace to continue.')
              onSelectWorkspace(replacement)
            }
          } catch (error) {
            if (disposed) return
            busyGraphId = ''
            state = { ...state, error: error instanceof Error ? error.message : String(error) }
            render()
          }
        }
        void proceed()
      })

      render()
      target.replaceChildren(el)

      const view: FaceView = {
        focus(_request) {
          const target = el.shadowRoot?.querySelector<HTMLElement>('.select:not(:disabled), .create:not(:disabled), .retry')
          if (target) {
            target.focus()
            return true
          }
          return false
        },
        blur() {},
        resize() {
          // <mn-workspace-selector>'s embedded `:host` fills 100%/100% via
          // CSS; the interpreter already sized `target`. MUST NOT write
          // layout state.
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
