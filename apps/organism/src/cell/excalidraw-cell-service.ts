/** Concrete organism ↔ gardend adapter for the Excalidraw runtime. */

import type { MnNodeLinkCandidate, MnScenePredicateOption } from '@shrubbery/components'
import {
  getAllWirePredicates,
  type ShrubberyContract,
} from '@shrubbery/nucleus'
import {
  type ExcalidrawEngineContext,
  type ExcalidrawProjectionRequest,
  type ExcalidrawProjectionView,
  type ExcalidrawRuntimeOptions,
  type ExcalidrawSceneOperationResult,
  type ExcalidrawScope,
} from '@shrubbery/runtime'
import { createSidebarDocument, type SidebarMutationMcp } from './sidebar-mutations.js'
import {
  buildSceneLink,
  buildSceneLinkRecord,
  linkSceneElement,
  refreshSceneLinkTitles,
  sceneLinkTargetFromElement,
  sceneTitleLabel,
  unlinkSceneElement,
  type SceneLinkResolution,
  type SceneLinkTarget,
} from './excalidraw-scene-links.js'
import {
  projectSceneGraph,
  summarizeSceneProjection,
  type SceneGraphAnchor,
  type SceneGraphProjection,
  type SceneGraphWireCandidate,
} from './excalidraw-scene-projection.js'
import {
  applySceneWireHydration,
  endpointWireDocumentId,
  missingSceneWireCandidates,
  missingSceneWireHydrations,
  sceneWireProvenanceFields,
  upsertSceneArrowPredicate,
} from './excalidraw-scene-wires.js'

export interface ExcalidrawWorkspaceNode {
  readonly kind: 'document' | 'artifact'
  readonly id: string
  readonly title: string
  readonly graphId: string
  readonly mimeType?: string | null
  readonly wireDocumentId?: string | null
}

export interface ExcalidrawCellContract extends ShrubberyContract {
  readonly mcp: SidebarMutationMcp
}

export interface OrganismExcalidrawOptions {
  readonly contract: ExcalidrawCellContract
  readonly scope: ExcalidrawScope
  readonly getWorkspaceNodes: () => readonly ExcalidrawWorkspaceNode[]
  readonly onOpenNode: (target: SceneLinkTarget) => void | Promise<void>
  readonly onWorkspaceChanged?: () => void | Promise<void>
  readonly onArtifactSaved?: () => void | Promise<void>
  readonly onWiresChanged?: () => void | Promise<void>
  readonly fetch?: typeof fetch
}

export const EXCALIDRAW_PREDICATE_OPTIONS: readonly MnScenePredicateOption[] = getAllWirePredicates()
  .map(({ uri, label }) => ({ value: uri, label }))

export function excalidrawLinkCandidates(
  nodes: readonly ExcalidrawWorkspaceNode[],
  graphId: string,
): readonly MnNodeLinkCandidate[] {
  return nodes
    .filter((node) => node.graphId === graphId)
    .map((node) => ({
      kind: node.kind,
      id: node.id,
      title: node.title,
      ...(node.mimeType ? { mimeType: node.mimeType } : {}),
      iconName: node.kind === 'artifact' ? 'file' : 'file-text',
    }))
}

export function makeOrganismExcalidrawOptions(options: OrganismExcalidrawOptions): ExcalidrawRuntimeOptions {
  const { contract, scope } = options
  const fetchImpl = options.fetch ?? fetch
  let wires: Record<string, unknown>[] = []
  let wiresLoaded = false

  const resolveLinkedNode = (target: SceneLinkTarget): SceneLinkResolution | null => {
    if (target.graphId !== scope.graphId) return null
    const node = options.getWorkspaceNodes().find((item) =>
      item.graphId === target.graphId && item.kind === target.kind && item.id === target.id)
    return node
      ? { exists: true, title: node.title, wireDocumentId: node.kind === 'document' ? node.id : node.wireDocumentId, mimeType: node.mimeType }
      : { exists: false }
  }

  const refreshWires = async (force = false): Promise<Record<string, unknown>[]> => {
    if (wiresLoaded && !force) return wires
    const result = await contract.rest.query(scope.graphId, sceneWireSnapshotSparql(scope.graphId)) as {
      rows?: readonly Record<string, string>[]
    }
    wires = (result.rows ?? []).map(sceneWireFromRow).filter((wire): wire is Record<string, unknown> => !!wire)
    wiresLoaded = true
    return wires
  }

  const project = async (request: ExcalidrawProjectionRequest): Promise<ExcalidrawProjectionView> => {
    if (!wiresLoaded || request.reason === 'manual') await refreshWires(request.reason === 'manual')
    const projection = projectSceneGraph(request.elements, {
      graphId: scope.graphId,
      artifactId: scope.artifactId,
      resolveLinkedNode,
    })
    return projectionView(projection, request.selectedElementId, wires)
  }

  const selectedAnchor = (context: ExcalidrawEngineContext, elementId: string | null): SceneGraphAnchor | null => {
    const projection = projectSceneGraph(context.elements, {
      graphId: scope.graphId,
      artifactId: scope.artifactId,
      resolveLinkedNode,
    })
    return projection.anchors.find((anchor) => anchor.sceneElementId === elementId) ?? null
  }

  return {
    scope,
    artifacts: {
      async load({ signal }) {
        const response = await fetchImpl(artifactDownloadUrl(contract, scope), {
          headers: cellRequestHeaders(contract),
          cache: 'no-store',
          signal,
        })
        if (!response.ok) throw new Error(await responseError(response, 'scene artifact download failed'))
        return new Uint8Array(await response.arrayBuffer())
      },
      async save({ bytes, mimeType, label, signal }) {
        const response = await fetchImpl(artifactRevisionUrl(contract, scope), {
          method: 'POST',
          headers: { ...cellRequestHeaders(contract), 'Content-Type': 'application/json' },
          cache: 'no-store',
          signal,
          body: JSON.stringify({ dataBase64: bytesToBase64(bytes), mimeType, label }),
        })
        if (!response.ok) throw new Error(await responseError(response, 'scene artifact revision save failed'))
        await options.onArtifactSaved?.()
      },
    },
    projection: { project },
    links: {
      openElementLink(_context, { element }): boolean {
        const target = sceneLinkTargetFromElement(element)
        if (!target) return false
        void Promise.resolve(options.onOpenNode(target))
        return true
      },
      linkSelected(context, target): ExcalidrawSceneOperationResult {
        const elementId = target.elementId ?? context.selectedElementId
        if (!elementId) return { message: 'Select one scene element before linking' }
        return {
          elements: linkSceneElement(context.elements, elementId, buildSceneLinkRecord(target.kind, scope.graphId, target.id, target.title)),
          save: true,
          message: `Linked to ${target.title}`,
        }
      },
      async openSelected(context, intent) {
        const elementId = intent.elementId ?? context.selectedElementId
        const element = context.elements.find((item) => isRecord(item) && item.id === elementId)
        const target = sceneLinkTargetFromElement(element)
        if (!target) return { message: 'Selected element has no Mnemosyne link' }
        await options.onOpenNode(target)
        return { message: 'Linked node opened' }
      },
      refreshTitles(context): ExcalidrawSceneOperationResult {
        const result = refreshSceneLinkTitles(context.elements, resolveLinkedNode)
        return result.updated
          ? { elements: result.elements, save: true, message: `Refreshed ${result.updated} scene link title${result.updated === 1 ? '' : 's'}` }
          : { message: result.missing ? `${result.missing} linked target${result.missing === 1 ? ' is' : 's are'} missing` : 'Scene link titles are current' }
      },
      async recreateTarget(context, intent) {
        const anchor = selectedAnchor(context, intent.elementId ?? context.selectedElementId)
        if (!anchor || anchor.target.kind !== 'document' || anchor.target.graphId !== scope.graphId || anchor.targetExists !== false) {
          return { message: 'Selected link does not point to a missing local document' }
        }
        await createSidebarDocument(contract.mcp, {
          graphId: scope.graphId,
          documentId: anchor.target.id,
          title: anchor.title.trim() || anchor.target.id,
          parentId: null,
        })
        await options.onWorkspaceChanged?.()
        return { save: true, message: `Recreated ${anchor.title || anchor.target.id}` }
      },
      removeSelected(context, intent): ExcalidrawSceneOperationResult {
        const elementId = intent.elementId ?? context.selectedElementId
        if (!elementId) return { message: 'Select a linked scene element first' }
        return { elements: unlinkSceneElement(context.elements, elementId), save: true, message: 'Scene link removed' }
      },
      changePredicate(context, intent): ExcalidrawSceneOperationResult {
        const elementId = intent.elementId ?? context.selectedElementId
        if (!elementId) return { message: 'Select an arrow first' }
        return { elements: upsertSceneArrowPredicate(context.elements, elementId, intent.predicate), save: true, message: 'Wire predicate updated' }
      },
      dropNode(context, intent): ExcalidrawSceneOperationResult {
        const node = droppedWorkspaceNode(intent.node, scope.graphId)
        if (!node) return { message: 'Only document and artifact nodes can be added to a scene' }
        if (!context.convertToExcalidrawElements || !context.viewportCoordsToSceneCoords) {
          return { message: 'Excalidraw node creation helpers are unavailable' }
        }
        const point = context.viewportCoordsToSceneCoords({ clientX: intent.clientX, clientY: intent.clientY }, context.appState)
        const link = buildSceneLink(node.kind, scope.graphId, node.id)
        const record = buildSceneLinkRecord(node.kind, scope.graphId, node.id, node.title)
        const created = context.convertToExcalidrawElements([{
          type: 'rectangle',
          x: point.x - 100,
          y: point.y - 35,
          width: 200,
          height: 70,
          backgroundColor: '#ece9ff',
          strokeColor: '#6b5cff',
          roundness: { type: 3 },
          label: { text: sceneTitleLabel(node.title), fontSize: 16 },
          link,
          customData: { mnemosyne: record },
        }])
        const linked = created.filter(isRecord).map((element) => element.type === 'text'
          ? element
          : { ...element, link, customData: { ...(isRecord(element.customData) ? element.customData : {}), mnemosyne: record } })
        return { elements: [...context.elements, ...linked], save: true, message: `Added ${node.title}` }
      },
    },
    wires: {
      async sync(context) {
        const projection = projectSceneGraph(context.elements, { graphId: scope.graphId, artifactId: scope.artifactId, resolveLinkedNode })
        const snapshot = await refreshWires(true)
        const missing = missingSceneWireCandidates(projection.wireCandidates, snapshot)
        for (const candidate of missing) await createSceneWire(fetchImpl, contract, candidate, scope)
        if (missing.length) {
          await refreshWires(true)
          await options.onWiresChanged?.()
        }
        return {
          view: projectionView(projection, context.selectedElementId, wires, { created: missing.length, skipped: projection.wireCandidates.length - missing.length }),
          message: missing.length ? `Created ${missing.length} scene wire${missing.length === 1 ? '' : 's'}` : 'Scene wires are already synced',
        }
      },
      async hydrate(context) {
        const projection = projectSceneGraph(context.elements, { graphId: scope.graphId, artifactId: scope.artifactId, resolveLinkedNode })
        const snapshot = await refreshWires(true)
        const result = applySceneWireHydration(context.elements, projection, snapshot, { sceneGraphId: scope.graphId, sceneArtifactId: scope.artifactId })
        return result.hydrated.length
          ? { elements: result.elements, save: true, message: `Hydrated ${result.hydrated.length} scene wire${result.hydrated.length === 1 ? '' : 's'}` }
          : { message: 'No scene-backed wires are waiting to hydrate' }
      },
    },
  }
}

function projectionView(
  projection: SceneGraphProjection,
  selectedElementId: string | null,
  wires: readonly Record<string, unknown>[],
  operation?: { readonly created?: number; readonly skipped?: number },
): ExcalidrawProjectionView {
  const embedded = summarizeSceneProjection(projection)
  const anchor = projection.anchors.find((item) => item.sceneElementId === selectedElementId)
  const arrow = projection.arrows.find((item) => item.sceneElementId === selectedElementId)
  const selectedElement = selectedElementId ? {
    id: selectedElementId,
    type: anchor?.elementType ?? (arrow ? 'arrow' : null),
    label: anchor?.text ?? arrow?.label ?? null,
    linkKind: anchor?.target.kind ?? null,
    linkTargetId: anchor?.target.id ?? null,
    linkTitle: anchor?.title ?? null,
    predicate: arrow?.predicate ?? null,
    canRecreateTarget: !!anchor && anchor.target.kind === 'document' && anchor.target.graphId === projection.graphId && anchor.targetExists === false,
    canRemoveLink: !!anchor,
    canLink: !anchor,
    canOpenLink: !!anchor && anchor.targetExists !== false,
  } : null
  return {
    summary: { ...embedded.counts, searchText: embedded.searchText },
    diagnostics: projection.diagnostics.map((item) => ({
      code: item.code,
      message: item.message,
      sceneElementId: item.sceneElementId,
      severity: item.code === 'link-title-stale' ? 'warning' : 'error',
    })),
    selectedElement,
    wireSummary: {
      missing: missingSceneWireCandidates(projection.wireCandidates, wires).length,
      hydratable: missingSceneWireHydrations(projection, wires, { sceneGraphId: projection.graphId ?? '', sceneArtifactId: projection.artifactId ?? '' }).length,
      ...operation,
    },
    raw: projection,
    embedded,
  }
}

async function createSceneWire(
  fetchImpl: typeof fetch,
  contract: ExcalidrawCellContract,
  candidate: SceneGraphWireCandidate,
  scope: ExcalidrawScope,
): Promise<void> {
  const response = await fetchImpl(
    `${trimSlash(contract.runtime.graphBaseUrl(candidate.source.graphId))}/wires/${encodeURIComponent(candidate.source.graphId)}/document/${encodeURIComponent(endpointWireDocumentId(candidate.source))}`,
    {
      method: 'POST',
      headers: { ...cellRequestHeaders(contract), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_graph_id: candidate.target.graphId,
        target_document_id: endpointWireDocumentId(candidate.target),
        predicate: candidate.predicate,
        bidirectional: false,
        ...sceneWireProvenanceFields(candidate, { sceneGraphId: scope.graphId, sceneArtifactId: scope.artifactId }),
      }),
    },
  )
  if (!response.ok) throw new Error(await responseError(response, 'scene wire creation failed'))
}

export function sceneWireSnapshotSparql(graphId: string): string {
  if (/[<>]/.test(graphId)) throw new Error('Graph id contains invalid RDF IRI characters')
  const ws = `urn:mnemosyne:local:graph:${graphId}:projection:workspace`
  return [
    'PREFIX mnemo: <http://mnemosyne.ai/vocab#>',
    'SELECT ?wire ?sourceDocument ?targetDocument ?targetGraph ?predicate ?sceneGraphId ?sceneArtifactId',
    '       ?sceneElementId ?sceneSourceElementId ?sceneTargetElementId ?sceneStableKey',
    `WHERE { GRAPH <${ws}> {`,
    '  ?wire a mnemo:Wire ; mnemo:sourceDocument ?sourceDocument ; mnemo:targetDocument ?targetDocument .',
    '  OPTIONAL { ?wire mnemo:targetGraph ?targetGraph }',
    '  OPTIONAL { ?wire mnemo:predicate ?predicate }',
    '  OPTIONAL { ?wire mnemo:sceneGraphId ?sceneGraphId }',
    '  OPTIONAL { ?wire mnemo:sceneArtifactId ?sceneArtifactId }',
    '  OPTIONAL { ?wire mnemo:sceneElementId ?sceneElementId }',
    '  OPTIONAL { ?wire mnemo:sceneSourceElementId ?sceneSourceElementId }',
    '  OPTIONAL { ?wire mnemo:sceneTargetElementId ?sceneTargetElementId }',
    '  OPTIONAL { ?wire mnemo:sceneStableKey ?sceneStableKey }',
    '} } ORDER BY ?wire',
  ].join('\n')
}

export function sceneWireFromRow(row: Record<string, string>): Record<string, unknown> | null {
  const id = entityId(row.wire, 'wire')
  const sourceDocumentId = entityId(row.sourceDocument, 'document')
  const targetDocumentId = entityId(row.targetDocument, 'document')
  if (!id || !sourceDocumentId || !targetDocumentId) return null
  return {
    id,
    sourceDocumentId,
    targetDocumentId,
    targetGraphId: literal(row.targetGraph),
    predicate: iri(row.predicate) ?? literal(row.predicate),
    sceneGraphId: literal(row.sceneGraphId),
    sceneArtifactId: literal(row.sceneArtifactId),
    sceneElementId: literal(row.sceneElementId),
    sceneSourceElementId: literal(row.sceneSourceElementId),
    sceneTargetElementId: literal(row.sceneTargetElementId),
    sceneStableKey: literal(row.sceneStableKey),
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const hasB = index + 1 < bytes.length
    const hasC = index + 2 < bytes.length
    const b = hasB ? bytes[index + 1] : 0
    const c = hasC ? bytes[index + 2] : 0
    out += alphabet[a >> 2]
    out += alphabet[((a & 3) << 4) | (b >> 4)]
    out += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : '='
    out += hasC ? alphabet[c & 63] : '='
  }
  return out
}

function artifactDownloadUrl(contract: ExcalidrawCellContract, scope: ExcalidrawScope): string {
  return `${trimSlash(contract.runtime.graphBaseUrl(scope.graphId))}/artifacts/${encodeURIComponent(scope.graphId)}/${encodeURIComponent(scope.artifactId)}/download`
}
function artifactRevisionUrl(contract: ExcalidrawCellContract, scope: ExcalidrawScope): string { return `${artifactDownloadUrl(contract, scope).replace(/\/download$/, '')}/revisions` }
function cellRequestHeaders(contract: ExcalidrawCellContract): Record<string, string> {
  const headers: Record<string, string> = { 'X-User-ID': contract.auth.userId() }
  const token = contract.auth.token()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}
function trimSlash(value: string): string { return value.replace(/\/+$/, '') }
async function responseError(response: Response, fallback: string): Promise<string> { const detail = await response.text().catch(() => ''); return detail || `${fallback}: ${response.status}` }
function droppedWorkspaceNode(value: unknown, graphId: string): ExcalidrawWorkspaceNode | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const rawKind = stringValue(value.kind) ?? stringValue(value.type)
  const kind = rawKind === 'artifact' ? 'artifact' : rawKind === 'document' || rawKind === undefined ? 'document' : null
  if (!id || !kind) return null
  return { kind, id, graphId, title: stringValue(value.title) ?? stringValue(value.label) ?? id, mimeType: stringValue(value.mimeType) }
}
function entityId(term: string | undefined, kind: string): string | null {
  const value = iri(term)
  if (!value) return null
  const marker = `:${kind}:`
  const index = value.indexOf(marker)
  return index >= 0 ? value.slice(index + marker.length) : value
}
function iri(term: string | undefined): string | null { return term?.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : null }
function literal(term: string | undefined): string | null {
  if (!term) return null
  if (!term.startsWith('"')) return iri(term) ?? term
  let out = ''
  for (let i = 1; i < term.length; i += 1) {
    if (term[i] === '\\') { const next = term[++i]; out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next ?? ''; continue }
    if (term[i] === '"') break
    out += term[i]
  }
  return out
}
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
