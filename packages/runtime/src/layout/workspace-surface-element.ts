/**
 * A small generic custom-element shell that binds code-owned face definitions
 * to a data-only LayoutDocument. Garden supplies the closed face catalogue and
 * a pure model builder; this module owns no Garden component knowledge.
 */
import { nothing, render } from 'lit'
import type {
  LayoutDocument,
  LayoutSplitNode,
  LayoutTabsNode,
  ResourceLocator,
  ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { FaceRegistry } from './face-registry.js'
import { LayoutResourceBroker } from './resource-broker.js'
import {
  LayoutSurfaceController,
  type SurfaceActiveTabChange,
  type SurfaceDividerPolicy,
  type SurfaceRatioChange,
} from './surface-host.js'
import {
  closedParamsSchema,
  type ClosedFaceParamsSchema,
  type FacePersistence,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceAdapter,
} from './types.js'

export const WORKSPACE_SURFACE_BINDING_ADAPTER_ID = 'workspace.surface.binding-store'
export const WORKSPACE_SURFACE_BINDING_PARAMS = closedParamsSchema({
  bindingId: { type: 'string' },
})

export interface WorkspaceBoundFaceDefinition<T = unknown> {
  readonly faceId: string
  readonly persistence: FacePersistence
  readonly accepts: (locator: ResourceLocator) => boolean
  readonly paramsSchema?: ClosedFaceParamsSchema
  readonly constraints?: (descriptor: ViewDescriptor) => LeafConstraints
  /** May decorate the interpreter-owned target and returns its Lit body. */
  readonly render: (target: HTMLElement, value: T, descriptor: ViewDescriptor) => unknown
  readonly focus?: (target: HTMLElement, value: T) => boolean | Promise<boolean>
  readonly blur?: (target: HTMLElement, value: T) => void | Promise<void>
}

export interface WorkspaceSurfaceBuild<TMeta = unknown> {
  readonly document: LayoutDocument
  /**
   * Immutable face values for this build. Returning the exact same map object
   * from a later build explicitly means its keys and values are unchanged;
   * the host may therefore skip subscribed face paints while still reconciling
   * the new document geometry. Return a new map for every semantic value or
   * options change, including a refresh whose entries happen to compare equal.
   */
  readonly bindings: ReadonlyMap<string, unknown>
  readonly metadata: TMeta
  /**
   * The live backend service the ENGINE faces' resource adapters resolve
   * through for THIS build (see `WorkspaceSurfaceEngineExtension`). Opaque to
   * this generic element — it only stores the reference; the definition-time
   * `createAdapters` factory is what knows the concrete service shape. Omit
   * (or null) when the session has no backend: an engine-face acquire then
   * fails honestly into the interpreter's own error leaf, never a blank pane.
   */
  readonly engineService?: unknown
}

export interface WorkspaceSurfaceModel<TMeta = unknown> {
  readonly build: (width: number, height: number) => WorkspaceSurfaceBuild<TMeta>
  readonly dividerPolicy?: (
    split: LayoutSplitNode,
    box: SurfaceRatioChange['splitBox'],
    metadata: TMeta,
  ) => SurfaceDividerPolicy
  readonly onRatioChange?: (change: SurfaceRatioChange, metadata: TMeta) => void
  readonly onActiveTabChange?: (change: SurfaceActiveTabChange, metadata: TMeta) => void
}

export interface WorkspaceSurfaceElement<TMeta = unknown> extends HTMLElement {
  model: WorkspaceSurfaceModel<TMeta> | null
  whenReady(): Promise<void>
  surfaceDocument(): LayoutDocument | null
}

class WorkspaceSurfaceBindingStore {
  private readonly values = new Map<string, WorkspaceSurfaceBindingRecord>()
  private readonly listeners = new Map<string, Set<WorkspaceSurfaceBindingListener>>()
  private source: ReadonlyMap<string, unknown> | null = null

  /**
   * The face ids this store carries bindings FOR — the bound-face catalogue.
   * A leaf whose face is NOT in this set (an engine face: `stat.scalar`,
   * `sparql.bindings-table`, …) resolves its value through the resource
   * broker, not this store, so `setAll` must not demand a `bindingId` for it.
   */
  constructor(private readonly boundFaceIds: ReadonlySet<string>) {}

  get(bindingId: string, descriptor: ViewDescriptor): unknown {
    const record = this.values.get(bindingId)
    if (!record || !bindingMatchesDescriptor(record, descriptor)) {
      throw new Error(`${descriptor.faceId}: binding '${bindingId}' does not match its descriptor resource`)
    }
    return record.value
  }

  setAll(values: ReadonlyMap<string, unknown>, document: LayoutDocument): void {
    // Map identity is the model's narrow stability signal. We still rebuild
    // and validate the descriptor records below so a document may add, remove,
    // or replace leaves while reusing its immutable values. Only listener
    // notification is skipped when the model deliberately returns the exact
    // same binding set for a geometry-only build.
    const notify = values !== this.source
    const next = new Map<string, WorkspaceSurfaceBindingRecord>()
    const bind = (descriptor: ViewDescriptor): void => {
      if (!this.boundFaceIds.has(descriptor.faceId)) return
      const bindingId = bindingIdFromDescriptor(descriptor)
      if (!values.has(bindingId)) {
        throw new Error(`${descriptor.faceId}: binding '${bindingId}' is missing from the Surface build`)
      }
      next.set(bindingId, {
        faceId: descriptor.faceId,
        resourceKey: locatorKey(descriptor.resource),
        value: values.get(bindingId),
      })
    }
    for (const node of Object.values(document.nodes)) {
      if (node.kind === 'leaf') {
        bind(node.descriptor)
        continue
      }
      // Fixed grid cells are first-class Resource × Face descriptors too;
      // they merely live inside the grid node rather than `nodes` as leaves.
      // Collection cells are intentionally excluded: their descriptors are
      // derived at runtime from query rows and cannot name shell bindings.
      if (node.kind === 'grid' && node.children.kind === 'fixed') {
        for (const cell of node.children.cells) bind(cell.descriptor)
      }
    }
    this.source = values
    this.values.clear()
    for (const [bindingId, record] of next) {
      this.values.set(bindingId, record)
      if (!notify) continue
      for (const listener of this.listeners.get(bindingId) ?? []) {
        if (bindingMatchesDescriptor(record, listener.descriptor)) listener.paint(record.value)
      }
    }
  }

  subscribe(bindingId: string, descriptor: ViewDescriptor, paint: (value: unknown) => void): () => void {
    let listeners = this.listeners.get(bindingId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(bindingId, listeners)
    }
    const listener = { descriptor, paint }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(bindingId)
    }
  }
}

interface WorkspaceSurfaceBindingRecord {
  readonly faceId: string
  readonly resourceKey: string
  readonly value: unknown
}

interface WorkspaceSurfaceBindingListener {
  readonly descriptor: ViewDescriptor
  readonly paint: (value: unknown) => void
}

function bindingMatchesDescriptor(
  record: WorkspaceSurfaceBindingRecord,
  descriptor: ViewDescriptor,
): boolean {
  return record.faceId === descriptor.faceId && record.resourceKey === locatorKey(descriptor.resource)
}

function adapterIdForFace(faceId: string): string {
  return `${WORKSPACE_SURFACE_BINDING_ADAPTER_ID}:${faceId}`
}

function locatorKey(locator: ResourceLocator): string {
  switch (locator.kind) {
    case 'document': return JSON.stringify(['document', locator.graphId, locator.documentId])
    case 'graph': return JSON.stringify(['graph', locator.graphId, locator.subjectIri ?? null])
    case 'query': return JSON.stringify(['query', locator.graphId, locator.queryId, locator.revision ?? null])
    case 'chat': return JSON.stringify(['chat', locator.graphId, locator.sessionId])
    case 'iri': return JSON.stringify(['iri', locator.iri])
  }
}

function bindingIdFromDescriptor(descriptor: ViewDescriptor): string {
  const bindingId = descriptor.params?.bindingId
  if (typeof bindingId !== 'string' || bindingId.length === 0) {
    throw new Error(`${descriptor.faceId}: params.bindingId is required`)
  }
  return bindingId
}

function focusFirst(target: HTMLElement): boolean {
  const candidate = target.querySelector<HTMLElement>(
    '[autofocus], input, textarea, select, button, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
  )
  if (!candidate) return false
  candidate.focus()
  return true
}

function createBoundFace(
  definition: WorkspaceBoundFaceDefinition,
  store: WorkspaceSurfaceBindingStore,
): FaceRegistration {
  return {
    faceId: definition.faceId,
    persistence: definition.persistence,
    resourceAdapterId: adapterIdForFace(definition.faceId),
    accepts: definition.accepts,
    paramsSchema: definition.paramsSchema ?? WORKSPACE_SURFACE_BINDING_PARAMS,
    constraints: definition.constraints,
    mount({ target, descriptor }) {
      const bindingId = bindingIdFromDescriptor(descriptor)
      let value = store.get(bindingId, descriptor)
      let disposed = false
      // Keep Lit's root-part bookkeeping on a face-owned anchor instead of
      // the interpreter-owned leaf wrapper. LayoutInterpreter deliberately
      // clears that wrapper when descriptorRevision changes; if Lit stores
      // its part on the wrapper itself, the next face reuses a stale part
      // whose marker nodes have been removed and refuses to paint.
      const renderAnchor = document.createComment('workspace-face-end')
      target.appendChild(renderAnchor)
      const paint = (next: unknown): void => {
        value = next
        if (!disposed) render(definition.render(target, next, descriptor), target, { renderBefore: renderAnchor })
      }
      paint(value)
      const unsubscribe = store.subscribe(bindingId, descriptor, paint)
      const view: FaceView = {
        focus() {
          return definition.focus?.(target, value) ?? focusFirst(target)
        },
        blur() {
          if (definition.blur) return definition.blur(target, value)
          const active = target.ownerDocument.activeElement
          if (active instanceof HTMLElement && target.contains(active)) active.blur()
        },
        resize() {
          // Interpreter-owned target geometry is authoritative; bound faces
          // fill it through normal component CSS.
        },
        serialize() {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribe()
          render(nothing, target, { renderBefore: renderAnchor })
          target.replaceChildren()
          // The interpreter owns geometry and every data-layout-* marker on
          // this wrapper. A face may decorate the remaining attributes, so
          // clear only that face-owned namespace when it is replaced.
          for (const name of target.getAttributeNames()) {
            if (name === 'style' || name.startsWith('data-layout-')) continue
            target.removeAttribute(name)
          }
        },
      }
      return view
    },
  }
}

/**
 * The Stage-A unification seam: FULL `FaceRegistration`s (engine faces —
 * query-backed, broker-resolved) registered on the SAME sealed registry as the
 * bound workspace faces, so one interpreter mounts both. The element itself
 * stays service-agnostic: `createAdapters` receives a RESOLVER for the current
 * build's `engineService` (an opaque reference the model supplies per build)
 * and is called exactly once per element instance, at construction — the
 * closed-catalogue discipline is untouched.
 */
export interface WorkspaceSurfaceEngineExtension {
  readonly faces: readonly FaceRegistration[]
  readonly createAdapters: (resolveService: () => unknown) => readonly ResourceAdapter[]
  /** Passed through to the interpreter for collection-bound grids. */
  readonly gridCollectionResourceAdapterId?: string
}

/**
 * Define the generic element once with a closed code-owned face catalogue.
 * Repeated calls are idempotent, which keeps renderWorkspace's lazy Surface
 * branch safe across tests and multiple host containers.
 */
export function defineWorkspaceSurfaceElement(
  tagName: string,
  catalogue: readonly WorkspaceBoundFaceDefinition[],
  engine?: WorkspaceSurfaceEngineExtension,
): void {
  if (customElements.get(tagName)) return

  class ShWorkspaceSurfaceElement extends HTMLElement implements WorkspaceSurfaceElement {
    private readonly store = new WorkspaceSurfaceBindingStore(
      new Set(catalogue.map((definition) => definition.faceId)),
    )
    private readonly registry = new FaceRegistry()
    private readonly broker = new LayoutResourceBroker()
    /** The CURRENT build's engine service — engine-face adapters resolve through this holder at acquire time. */
    private readonly engineServiceHolder: { current: unknown } = { current: null }
    /** Host-owned resource generation; changes are remount boundaries even for byte-identical descriptors. */
    private engineServiceEpoch = 0
    private controller: LayoutSurfaceController | null = null
    private currentBuild: WorkspaceSurfaceBuild | null = null
    private currentModel: WorkspaceSurfaceModel | null = null
    private readonly descriptorRevisions = new Map<string, { signature: string; revision: number }>()
    /**
     * Session-local tab choices layered over pure model rebuilds. The model is
     * allowed to return the same authored document for every size/data pass;
     * without this overlay, any such pass resets a user's active tab to the
     * seed's default. `tabsRevision` remains the conflict clock: a newer
     * authored revision supersedes the retained choice.
     */
    private readonly activeTabs = new Map<string, Pick<LayoutTabsNode, 'activeNodeId' | 'tabsRevision'>>()
    private activeTabsDocumentKey: string | null = null
    private measuredWidth = 0
    private measuredHeight = 0
    private rebuildEpoch = 0

    constructor() {
      super()
      for (const definition of catalogue) {
        // One named adapter per face preserves the broker's authority seam:
        // a face can acquire only the locator kinds/prefixes its code-owned
        // registration explicitly accepts, never an arbitrary Surface
        // binding merely because another face knows how to render it.
        const adapter: ResourceAdapter<WorkspaceSurfaceBindingStore> = {
          adapterId: adapterIdForFace(definition.faceId),
          shape: 'durable',
          accepts: definition.accepts,
          resourceKey: locatorKey,
          load: async () => this.store,
          dispose: () => {},
        }
        this.broker.registerAdapter(adapter)
        this.registry.register(createBoundFace(definition, this.store))
      }
      if (engine) {
        // Engine faces are FULL FaceRegistrations mounting through the broker
        // — same sealed registry, same interpreter, no nested engine. Their
        // adapters resolve the CURRENT build's service through the holder, so
        // a session swap re-routes the next acquire with no re-registration.
        for (const registration of engine.faces) this.registry.register(registration)
        for (const adapter of engine.createAdapters(() => this.engineServiceHolder.current)) {
          this.broker.registerAdapter(adapter)
        }
      }
      this.registry.seal()
      this.style.cssText = 'display:block;position:relative;flex:1 1 auto;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;'
      this.dataset.workspaceSurface = 'true'
    }

    connectedCallback(): void {
      this.ensureController()
      // The model may have created the controller while this custom element
      // was still detached. Re-measure synchronously now that its full
      // workspace ancestors exist; ResizeObserver alone is not a reliable
      // detached → connected notification in every browser.
      this.controller?.measureNow()
      this.rebuild()
    }

    disconnectedCallback(): void {
      queueMicrotask(() => {
        if (this.isConnected) return
        const controller = this.controller
        this.controller = null
        void controller?.dispose().finally(() => {
          // Every face lease is released by controller disposal first; now
          // drop warm derived snapshots so a detached/session-retired Surface
          // cannot retain graph-scoped data until its ordinary idle timeout.
          this.broker.clearRetained()
        })
      })
    }

    get model(): WorkspaceSurfaceModel | null {
      return this.currentModel
    }

    set model(next: WorkspaceSurfaceModel | null) {
      this.currentModel = next
      this.ensureController()
      this.rebuild()
    }

    async whenReady(): Promise<void> {
      // Lit may connect the custom element before its `.model` property part
      // is committed. Yield once, then follow rebuild epochs until the newest
      // model and its interpreter pass are both settled. Returning the
      // controller's already-resolved bootstrap promise here used to let
      // shell hooks race the first face mount.
      await Promise.resolve()
      for (;;) {
        if (!this.currentModel) return
        const controller = this.controller
        const build = this.currentBuild
        if (!controller) return
        if (!build) {
          await Promise.resolve()
          continue
        }
        const epoch = this.rebuildEpoch
        await controller.whenReady()
        await Promise.resolve()
        if (epoch === this.rebuildEpoch && build === this.currentBuild) return
      }
    }

    surfaceDocument(): LayoutDocument | null {
      return this.controller?.currentDocument() ?? this.currentBuild?.document ?? null
    }

    private ensureController(): void {
      if (this.controller) return
      this.controller = new LayoutSurfaceController(this, {
        registry: this.registry,
        broker: this.broker,
        dividerThickness: 1,
        resourceScope: engine ? () => this.engineServiceEpoch : undefined,
        gridCollectionResourceAdapterId: engine?.gridCollectionResourceAdapterId,
        dividerPolicy: (split, box) =>
          this.currentBuild && this.currentModel?.dividerPolicy
            ? this.currentModel.dividerPolicy(split, box, this.currentBuild.metadata)
            : { enabled: true },
        onRatioChange: (change) => {
          if (this.currentBuild && this.currentModel?.onRatioChange) {
            this.currentModel.onRatioChange(change, this.currentBuild.metadata)
          }
        },
        onActiveTabChange: (change) => {
          const documentKey = this.tabStateDocumentKey(change.document)
          if (this.activeTabsDocumentKey !== documentKey) {
            this.activeTabs.clear()
            this.activeTabsDocumentKey = documentKey
          }
          this.activeTabs.set(change.tabs.id, {
            activeNodeId: change.tabs.activeNodeId,
            tabsRevision: change.tabs.tabsRevision,
          })
          if (this.currentBuild && this.currentModel?.onActiveTabChange) {
            this.currentModel.onActiveTabChange(change, this.currentBuild.metadata)
          }
        },
        onSizeChange: (width, height) => {
          this.measuredWidth = width
          this.measuredHeight = height
          this.rebuild()
        },
      })
    }

    private rebuild(): void {
      const model = this.currentModel
      const controller = this.controller
      if (!model || !controller) return
      const raw = model.build(this.measuredWidth, this.measuredHeight)
      const nextEngineService = raw.engineService ?? null
      if (engine && !Object.is(this.engineServiceHolder.current, nextEngineService)) {
        // A session/auth service change is a hard resource-scope boundary.
        // Retire old warm stores before the interpreter remounts leaves and
        // grid bindings under the incremented generation.
        this.engineServiceEpoch += 1
        this.broker.clearRetained()
      }
      this.engineServiceHolder.current = nextEngineService
      const built: WorkspaceSurfaceBuild = {
        ...raw,
        document: this.withDescriptorRevisions(this.withActiveTabState(raw.document)),
      }
      this.currentBuild = built
      // The service is live BEFORE setDocument(): leaf mounts acquire through
      // the broker synchronously with this build.
      this.store.setAll(built.bindings, built.document)
      controller.setDocument(built.document)
      const epoch = ++this.rebuildEpoch
      void controller.whenReady().then(() => {
        if (epoch !== this.rebuildEpoch || !this.isConnected) return
        this.dispatchEvent(new CustomEvent('sh-workspace-surface-ready', {
          bubbles: true,
          composed: true,
          detail: { layoutId: built.document.layoutId },
        }))
      })
    }

    private tabStateDocumentKey(document: LayoutDocument): string {
      return JSON.stringify([document.layoutId, document.graphId, document.scope, document.rootNodeId])
    }

    /**
     * Reapply locally newer tab state when a pure Surface model rebuilds from
     * its authored seed. This is deliberately narrower than general document
     * mutation: only `activeNodeId` + its `tabsRevision` survive, only while
     * the layout/graph/root identity is stable, and only while the selected
     * child still exists in the incoming tab set.
     */
    private withActiveTabState(document: LayoutDocument): LayoutDocument {
      const documentKey = this.tabStateDocumentKey(document)
      if (this.activeTabsDocumentKey !== documentKey) {
        this.activeTabs.clear()
        this.activeTabsDocumentKey = documentKey
      }

      let changed = false
      let nodes: Record<string, LayoutDocument['nodes'][string]> | null = null
      const incomingTabs = new Set<string>()
      for (const [nodeId, node] of Object.entries(document.nodes)) {
        if (node.kind !== 'tabs') continue
        incomingTabs.add(nodeId)
        const retained = this.activeTabs.get(nodeId)
        const retainedChildStillExists = retained
          ? node.tabs.some((tab) => tab.nodeId === retained.activeNodeId)
          : false

        if (!retained || !retainedChildStillExists || node.tabsRevision > retained.tabsRevision) {
          this.activeTabs.set(nodeId, {
            activeNodeId: node.activeNodeId,
            tabsRevision: node.tabsRevision,
          })
          continue
        }

        if (node.activeNodeId === retained.activeNodeId && node.tabsRevision === retained.tabsRevision) continue
        nodes ??= { ...document.nodes }
        nodes[nodeId] = {
          ...node,
          activeNodeId: retained.activeNodeId,
          tabsRevision: retained.tabsRevision,
        }
        changed = true
      }

      for (const nodeId of this.activeTabs.keys()) {
        if (!incomingTabs.has(nodeId)) this.activeTabs.delete(nodeId)
      }
      return changed && nodes ? { ...document, nodes } : document
    }

    private withDescriptorRevisions(document: LayoutDocument): LayoutDocument {
      let changed = false
      const nodes: Record<string, LayoutDocument['nodes'][string]> = {}
      for (const [nodeId, node] of Object.entries(document.nodes)) {
        if (node.kind !== 'leaf') {
          nodes[nodeId] = node
          continue
        }
        const signature = JSON.stringify(node.descriptor)
        const previous = this.descriptorRevisions.get(nodeId)
        const revision = previous
          ? previous.signature === signature
            ? previous.revision
            : previous.revision + 1
          : node.descriptorRevision
        this.descriptorRevisions.set(nodeId, { signature, revision })
        if (revision === node.descriptorRevision) {
          nodes[nodeId] = node
        } else {
          changed = true
          nodes[nodeId] = { ...node, descriptorRevision: revision }
        }
      }
      return changed ? { ...document, nodes } : document
    }
  }

  customElements.define(tagName, ShWorkspaceSurfaceElement)
}
