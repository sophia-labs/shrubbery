/** Real notebook face, adapter, broker and collection timer; synthetic SELECT results only. */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { parseNT, parseTriplesToConfig, type AuthProvider, type RestClient, type WorkspaceConfig } from '@shrubbery/nucleus'
import type { LayoutDocument, ViewDescriptor } from '@shrubbery/nucleus/layout'
import { createCenterPanesState, projectCenterPanes, renderWorkspace, workspaceSurfaceReady, type QueryBlockResult, type QueryBlockService, type RenderWorkspaceOptions } from '@shrubbery/runtime'
import { FaceRegistry, LayoutInterpreter, LayoutResourceBroker, createRawTextQueryResolver, defineWorkspaceSurfaceElement, type WorkspaceSurfaceElement } from '@shrubbery/runtime/layout'
import { createComputeCellFace, createComputeCellResourceAdapter } from '../../../../packages/runtime/src/layout/faces/compute-cell-face.js'
import { createGridCollectionQueryResourceAdapter, GRID_COLLECTION_QUERY_ADAPTER_ID } from '../../../../packages/runtime/src/layout/faces/grid-collection-query-resource-adapter.js'
import { createAgentSessionFamilyFace, createAgentSessionFamilyResourceAdapter } from '../../../../packages/runtime/src/layout/faces/agent-session-family-face.js'
import { SourceMirrorRuntime } from '../cell/source-mirror-runtime.js'
import { DocumentActivationManager, MemoryDocumentActivationStorage } from '../cell/document-activation.js'
import { withNotebookWorkspaceShell } from '../cell/notebook-workspace-shell.js'
import { OrganismMobileShellController } from '../cell/mobile-shell-controller.js'
import { createShellContext } from '../cell/shell-context.js'
import appShellHtml from '../../index.html?raw'

const root = document.querySelector<HTMLElement>('#notebook-root')!
const query = new URLSearchParams(location.search)
const layout = query.get('layout') ?? 'reflow'
if (!['leaf', 'stack', 'reflow', 'collection', 'family-split', 'mirror', 'joined'].includes(layout)) throw new Error('UnknownFixtureLayout')
const graphId = layout === 'joined' ? 'prime-notebook-lab' : 'notebook-local-synthetic'
let items = ['urn:fixture:notebook:first', 'urn:fixture:notebook:last']
let resourceScope = 0, ready = false, error: string | null = null, disposed = false
let mounts = 0, disposals = 0, collectionReads = 0, cellReads = 0, familyReads = 0
const textLines = Array.from({ length: 28 }, (_, i) => `local read-only line ${i + 1}: ${'long_value_'.repeat(8)}`).join('\n')
function result(values: Record<string, string>): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns: Object.keys(values), rows: [Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { type: 'literal', value }]))], durationMs: 0, raw: null }
}
const service: QueryBlockService = {
  async run(requestGraphId, sparql) {
    if (disposed || requestGraphId !== graphId || !sparql.includes('SELECT')) throw new Error('FixtureReadOnlyBoundary')
    if (sparql.includes('?parentSessionId')) {
      familyReads++
      return result({ parentSessionId: 'synthetic-parent', parentState: 'open', projectionRevision: '17',
        directAcceptedChildren: '0', maxChildren: '4', occupiedChildren: '0', maxConcurrentChildren: '2',
        budgetCostSpentUsdMicros: '0', budgetCostReservedUsdMicros: '0', budgetCostRemainingUsdMicros: '1000000',
        budgetCostMaxUsdMicros: '1000000', budgetAccountRevision: '1', budgetAccountExhausted: 'false',
        relation: 'urn:fixture:relation', child: 'urn:fixture:child', childName: 'Synthetic read-only child with a deliberately long descriptive label',
        childSessionId: 'fixture-child-abcdef', childSessionState: 'open', depth: '1', registeredAt: '2026-09-07T00:00:00Z', registrationStatus: 'registered' })
    }
    if (sparql.includes('SELECT ?item')) {
      collectionReads++
      return { queryKind: 'select', resultKind: 'bindings', columns: ['item', 'graphId'], rows: items.map(value => ({ item: { type: 'uri', value }, graphId: { type: 'literal', value: graphId } })), totalRowCount: items.length, durationMs: 0, raw: null }
    }
    const iri = items.find(item => sparql.includes(`<${item}> a comp:ComputeCell`))
    if (!iri) throw new Error('UnknownSyntheticCell')
    cellReads++
    const ordinal = items.indexOf(iri)
    return result({ cellRef: `fixture:${ordinal}`, ordinal: String(ordinal), generation: '0', source: '# Past output testimony only; never executed\n' + textLines,
      status: 'ok', executionCount: String(ordinal + 1), startedAt: '1', completedAt: '2', durationMs: '1', cellDigest: `sha256:${iri}`,
      outputsJson: JSON.stringify([{ kind: 'stream', name: 'stdout', text: textLines }, { kind: 'display', data: { 'text/html': '<table style="width:1400px"><tr><td>Wide output remains internally scrollable</td><td>TABLE-END</td></tr></table>' } }, { kind: 'stream', name: 'stdout', text: `TAIL:${iri}` }]) })
  },
}
const face = createComputeCellFace()
const countedFace: typeof face = { ...face, async mount(context) {
  mounts++
  const view = await face.mount(context)
  return { ...view, dispose(reason) { disposals++; return view.dispose(reason) } }
} }
const registry = new FaceRegistry()
registry.register(countedFace)
registry.register(createAgentSessionFamilyFace())
registry.seal()
const broker = new LayoutResourceBroker()
broker.registerAdapter(createComputeCellResourceAdapter(service))
broker.registerAdapter(createGridCollectionQueryResourceAdapter(service, createRawTextQueryResolver()))
broker.registerAdapter(createAgentSessionFamilyResourceAdapter(service))
const interpreter = new LayoutInterpreter(root, { registry, broker, resourceScope: () => resourceScope, gridCollectionResourceAdapterId: GRID_COLLECTION_QUERY_ADAPTER_ID })
let capturedConfig: WorkspaceConfig | null = null, capturedFragment: LayoutDocument | null = null, capturedSurface = ''
let explicitRoute = false, routeEvents = 0, leftCollapsed = innerWidth < 700
let fragmentStatus: 'ready' | 'loading' | 'error' = 'ready'
const mobileController = layout === 'joined' ? new OrganismMobileShellController() : null
if (layout === 'joined') {
  const captured = window.__capturedNotebook
  if (!captured) throw new Error('CapturedLayoutRequired')
  capturedConfig = parseTriplesToConfig(parseNT(captured.nt))
  capturedFragment = captured.fragment
  capturedSurface = captured.surface
  const source = new DOMParser().parseFromString(appShellHtml, 'text/html')
  const shell = source.querySelector<HTMLElement>('.shell-pane')!, original = shell.querySelector('#host')!
  for (const style of source.querySelectorAll('head style')) document.head.append(document.importNode(style, true))
  document.querySelector('#fixture-label')!.remove()
  root.id = 'host'; original.replaceWith(root); document.body.prepend(document.adoptNode(shell))
  root.addEventListener('mn-navigate-home', () => { explicitRoute = false; routeEvents++; drawJoined() })
}
function drawJoined() {
  if (!capturedConfig || !capturedFragment) return
  const config = withNotebookWorkspaceShell(capturedConfig, { preferHostRoute: explicitRoute })
  const snapshot: RenderWorkspaceOptions = { app: 'garden', surface: true, leftCollapsed, rightCollapsed: true,
    panelLayout: { leftWidth: 240, onLeftCollapsedChange(value) { leftCollapsed = value; drawJoined() } },
    chrome: { activeApp: 'garden', runtimeMode: 'hosted', activeWorkspaceId: graphId, workspaces: [{ graphId, title: 'Prime notebook local fixture', role: 'owner', cellState: 'running' }], workspaceStatus: 'ready' },
    sidebar: { sections: [{ id: 'documents', label: 'Documents', nodes: [{ id: 'fixture-route', label: 'Local route discriminator', kind: 'document' }] }], status: 'ready', selectedId: explicitRoute ? 'fixture-route' : null,
      onNodeSelect: openJoinedRoute, onNodeOpen: openJoinedRoute },
    // Exercise the actual document-host route, not a generic Home leaf that
    // mobile intentionally hides. No provider or real document is opened:
    // this explicit error is the fixture's honest route-completion witness.
    centerPanes: explicitRoute ? { projection: projectCenterPanes(createCenterPanesState({ graphId,
      primaryLocation: { kind: 'document', graphId, documentId: 'fixture-route', title: 'Local route discriminator' } })),
      editorHosts: new Map([['center-primary', { binding: { get: () => ({ centerMode: 'document', graphId, documentId: 'fixture-route', status: 'error',
        error: 'Synthetic read-only document route: no provider is opened.', provider: null }), subscribe: () => () => {} } }]]) } : null,
    fragments: explicitRoute ? null : { queryService: service, regions: { 'region-center': { surfaceIri: capturedSurface,
      state: fragmentStatus === 'ready' ? { status: 'ready', doc: capturedFragment }
        : fragmentStatus === 'loading' ? { status: 'loading' } : { status: 'error', error: 'Synthetic notebook read unavailable' } } } },
  }
  renderWorkspace(config, { ...snapshot, container: root })
  mobileController?.update(createShellContext({ host: root, graphId, documentId: explicitRoute ? 'fixture-route' : null, app: 'garden', source: 'CELL_LIVE', deploymentMode: 'hosted', contract: null, location: window.location, rerender: drawJoined }), snapshot)
}
function openJoinedRoute() { explicitRoute = true; routeEvents++; if (innerWidth < 700) leftCollapsed = true; drawJoined() }
let mirror: SourceMirrorRuntime | null = null, mirrorSurface: WorkspaceSurfaceElement | null = null
let mirrorNotifications = 0, mirrorPulls = 0, mirrorServiceRotations = 0, stopMirror: (() => void) | null = null
let lastMirrorService: QueryBlockService | null = null
if (layout === 'mirror') {
  const auth: AuthProvider = { token: () => undefined, userId: () => 'notebook-fixture-subject', isAuthenticated: () => true, whenReady: async () => {}, onChange: () => () => {} }
  mirror = new SourceMirrorRuntime({ auth, documentActivation: new DocumentActivationManager({ storage: new MemoryDocumentActivationStorage() }),
    caller: { async callTool(name) { if (name !== 'source_pull') throw new Error('OnlySyntheticReadAllowed'); mirrorPulls++; throw new Error('SyntheticSourceUnavailable') } },
    liveRest: { async graphs() { throw new Error('NoDirectoryReads') }, async update() { throw new Error('NoUpdates') },
      async query(g, q) { await new Promise(resolve => setTimeout(resolve, 40)); const read = await service.run(g, q); if (read.resultKind !== 'bindings') throw new Error('ExpectedBindings'); return { rows: read.rows, variables: read.columns } },
    } as RestClient,
  })
  await mirror.open(graphId)
  defineWorkspaceSurfaceElement('notebook-mirror-surface', [], { faces: [countedFace], createAdapters: resolve => [
    createComputeCellResourceAdapter({ run(g, q, n) { return (resolve() as QueryBlockService).run(g, q, n) } }),
  ] })
  // Production Lit stamps this element through the HTML parser. Its existing
  // constructor writes host attributes, which direct createElement rejects
  // in Chromium; follow the production construction path in this fixture.
  root.innerHTML = '<notebook-mirror-surface></notebook-mirror-surface>'
  mirrorSurface = root.querySelector('notebook-mirror-surface') as WorkspaceSurfaceElement
  stopMirror = mirror.subscribe(() => { mirrorNotifications++; drawMirror() })
}
function drawMirror() {
  if (!mirror || !mirrorSurface) return
  const engineService = mirror.surfaceQueryService(graphId)
  if (lastMirrorService && engineService !== lastMirrorService) mirrorServiceRotations++
  lastMirrorService = engineService
  mirrorSurface.model = { build: () => ({ document: documentModel(), bindings: new Map(), metadata: null, engineService }) }
}
function descriptor(iri: string): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'compute.cell', resource: { kind: 'iri', iri }, params: { graphId } }
}
function documentModel(): LayoutDocument {
  return { schemaVersion: 1, layoutId: `fixture-${layout}`, scope: 'session', graphId, rootNodeId: layout === 'family-split' ? 'split' : 'notebook',
    createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', nodes: {
      ...(layout === 'family-split' ? {
        split: { kind: 'split' as const, id: 'split', axis: 'horizontal' as const, startNodeId: 'notebook', endNodeId: 'family', startBasisPoints: 6500 },
        family: { kind: 'leaf' as const, id: 'family', descriptorRevision: 0, descriptor: { schemaVersion: 1 as const, faceId: 'agent.session-family', resource: { kind: 'graph' as const, graphId, subjectIri: 'urn:fixture:parent' } } },
      } : {}),
      notebook: layout === 'leaf'
        ? { kind: 'leaf', id: 'notebook', descriptorRevision: 0, descriptor: descriptor(items[0]!) }
        : { kind: 'grid', id: 'notebook', flow: ['stack', 'collection', 'family-split', 'mirror'].includes(layout) ? 'stack' : 'reflow', minCellWidth: 640, gridRevision: 0,
          children: ['collection', 'family-split'].includes(layout)
            ? { kind: 'collection', collection: { kind: 'query', graphId, queryId: 'SELECT ?item WHERE { }' }, itemFaceId: 'compute.cell', itemParams: { graphId }, maxItems: 10, refreshSeconds: 1 }
            : { kind: 'fixed', cells: items.map((iri, i) => ({ id: `cell-${i}`, descriptor: descriptor(iri) })) } },
    } }
}
async function reconcile() {
  if (layout === 'joined') { drawJoined(); await workspaceSurfaceReady(root); return }
  if (mirrorSurface) { drawMirror(); await mirrorSurface.whenReady(); return }
  const box = root.getBoundingClientRect()
  const verdict = await interpreter.reconcile(documentModel(), { width: box.width, height: box.height })
  if (!verdict.ok) throw new Error(`FixtureLayoutRejected:${verdict.diagnostics.map(item => item.code).join(',')}`)
  await Promise.all([...root.querySelectorAll('sh-compute-cell-view')].map(view => view.updateComplete))
}
const bridge = {
  get state() { return { ready, error, disposed, mounts, disposals, collectionReads, cellReads, familyReads, resourceScope, items: [...items], leases: broker.diagnostics().outstandingLeases, mirrorNotifications, mirrorPulls, mirrorServiceRotations, explicitRoute, routeEvents, capturedLayoutId: capturedFragment?.layoutId, mobile: mobileController?.state } },
  async mirrorRetry() { if (!mirror || !mirrorSurface) throw new Error('NoMirrorFixture'); try { await (await mirror.open(graphId)).pull() } catch { /* State carries the deliberately failed read. */ } await mirrorSurface.whenReady() },
  async unchangedRender() { await reconcile() },
  async fragmentState(value: 'ready' | 'loading' | 'error') { if (layout !== 'joined' || !['ready', 'loading', 'error'].includes(value)) throw new Error('JoinedFragmentStateOnly'); fragmentStatus = value; await reconcile() },
  changeResult() { items = [items[0]!, 'urn:fixture:notebook:changed'] },
  async changeResourceScope() { resourceScope++; broker.clearRetained(); await reconcile() },
  async dispose() { if (disposed) return; stopMirror?.(); mirrorSurface?.remove(); mobileController?.destroy(); if (layout === 'joined') root.remove(); await interpreter.dispose(); await new Promise(resolve => setTimeout(resolve, 0)); broker.clearRetained(); disposed = true },
}
Object.defineProperty(window, '__notebookSurface', { value: bridge })
declare global { interface Window { readonly __notebookSurface: typeof bridge; readonly __capturedNotebook?: { readonly nt: string; readonly fragment: LayoutDocument; readonly surface: string } } }
try { await reconcile(); ready = true }
catch (cause) { error = cause instanceof Error ? cause.message : 'FixtureFailure'; const failure = document.querySelector<HTMLElement>('#fixture-error')!; failure.hidden = false; failure.textContent = error }
