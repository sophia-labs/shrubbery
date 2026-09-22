/** Garden-compatible Excalidraw scene projection, ported from cf0cb960. */

import {
  DEFAULT_WIRE_PREDICATE_URI,
  getAllWirePredicates,
  getWirePredicateLabel,
} from '@shrubbery/nucleus'
import {
  parseSceneLink,
  type SceneLinkRecord,
  type SceneLinkResolution,
  type SceneLinkResolver,
  type SceneLinkTarget,
} from './excalidraw-scene-links.js'

export type SceneGraphDiagnosticCode =
  | 'malformed-link'
  | 'malformed-link-record'
  | 'link-record-mismatch'
  | 'link-target-missing'
  | 'link-title-stale'
  | 'arrow-missing-binding'
  | 'arrow-unlinked-endpoint'
  | 'wire-unsupported-endpoint'

export interface SceneGraphBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface SceneGraphAnchor {
  readonly sceneElementId: string
  readonly elementType: string
  readonly target: SceneLinkTarget
  readonly title: string
  readonly text: string | null
  readonly frameId: string | null
  readonly bounds: SceneGraphBounds | null
  readonly targetExists: boolean | null
  readonly workspaceTitle: string | null
  readonly wireDocumentId: string | null
}
export interface SceneGraphArrow {
  readonly sceneElementId: string
  readonly startElementId: string | null
  readonly endElementId: string | null
  readonly label: string | null
  readonly predicate: string
  readonly frameId: string | null
}
export interface SceneGraphText { readonly sceneElementId: string; readonly text: string; readonly containerId: string | null; readonly frameId: string | null }
export interface SceneGraphFrame { readonly sceneElementId: string; readonly title: string; readonly bounds: SceneGraphBounds | null }
export interface SceneGraphWireEndpoint extends SceneLinkTarget {
  readonly sceneElementId: string
  readonly title: string
  readonly wireDocumentId: string | null
}
export interface SceneGraphWireCandidate {
  readonly sceneElementId: string
  readonly stableKey: string
  readonly source: SceneGraphWireEndpoint
  readonly target: SceneGraphWireEndpoint
  readonly predicate: string
  readonly label: string | null
}
export interface SceneGraphDiagnostic {
  readonly code: SceneGraphDiagnosticCode
  readonly sceneElementId: string
  readonly message: string
  readonly relatedElementIds?: readonly string[]
}
export interface SceneGraphProjection {
  readonly graphId: string | null
  readonly artifactId: string | null
  readonly anchors: readonly SceneGraphAnchor[]
  readonly arrows: readonly SceneGraphArrow[]
  readonly wireCandidates: readonly SceneGraphWireCandidate[]
  readonly text: readonly SceneGraphText[]
  readonly frames: readonly SceneGraphFrame[]
  readonly diagnostics: readonly SceneGraphDiagnostic[]
}
export interface ProjectSceneGraphOptions {
  readonly graphId?: string | null
  readonly artifactId?: string | null
  readonly includeDeleted?: boolean
  readonly resolveLinkedNode?: SceneLinkResolver
}

interface NormalizedElement { readonly raw: Record<string, unknown>; readonly id: string; readonly type: string; readonly frameId: string | null }
const MNEMOSYNE_SCHEME = 'mnemosyne://'

export function projectSceneGraph(sceneOrElements: unknown, options: ProjectSceneGraphOptions = {}): SceneGraphProjection {
  const elements = normalizeElements(sceneOrElements, options.includeDeleted ?? false)
  const diagnostics: SceneGraphDiagnostic[] = []
  const textByContainer = new Map<string, string[]>()
  const text: SceneGraphText[] = []
  const frames: SceneGraphFrame[] = []

  for (const element of elements) {
    if (element.type !== 'text') continue
    const value = stringValue(element.raw.text)?.trim()
    if (!value) continue
    const containerId = stringValue(element.raw.containerId)
    text.push({ sceneElementId: element.id, text: value, containerId, frameId: element.frameId })
    if (containerId) textByContainer.set(containerId, [...(textByContainer.get(containerId) ?? []), value])
  }
  for (const element of elements) {
    if (element.type === 'frame') frames.push({ sceneElementId: element.id, title: labelForElement(element, textByContainer) ?? element.id, bounds: boundsForElement(element.raw) })
  }

  const anchors: SceneGraphAnchor[] = []
  const anchorsByElementId = new Map<string, SceneGraphAnchor>()
  for (const element of elements) {
    const linked = linkForElement(element, diagnostics)
    if (!linked) continue
    const label = labelForElement(element, textByContainer)
    const title = linked.record?.title?.trim() || label || linked.target.id
    const resolution = options.resolveLinkedNode?.(linked.target) ?? null
    const workspaceTitle = resolution?.exists && resolution.title?.trim() ? resolution.title.trim() : null
    const wireDocumentId = wireDocumentIdForTarget(linked.target, resolution)
    if (resolution && !resolution.exists) {
      diagnostics.push({ code: 'link-target-missing', sceneElementId: element.id, message: 'Linked Mnemosyne node is missing from the current workspace.' })
    } else if (workspaceTitle && linked.record?.title && linked.record.title !== workspaceTitle) {
      diagnostics.push({ code: 'link-title-stale', sceneElementId: element.id, message: 'Linked scene title is stale.' })
    }
    const anchor: SceneGraphAnchor = {
      sceneElementId: element.id,
      elementType: element.type,
      target: linked.target,
      title,
      text: label,
      frameId: element.frameId,
      bounds: boundsForElement(element.raw),
      targetExists: resolution ? resolution.exists : null,
      workspaceTitle,
      wireDocumentId,
    }
    anchors.push(anchor)
    anchorsByElementId.set(element.id, anchor)
  }

  const arrows: SceneGraphArrow[] = []
  const wireCandidates: SceneGraphWireCandidate[] = []
  for (const element of elements) {
    if (element.type !== 'arrow') continue
    const startElementId = bindingElementId(element.raw.startBinding)
    const endElementId = bindingElementId(element.raw.endBinding)
    const label = labelForElement(element, textByContainer)
    const predicate = predicateForArrowCustomData(element.raw.customData) ?? predicateForArrowLabel(label)
    arrows.push({ sceneElementId: element.id, startElementId, endElementId, label, predicate, frameId: element.frameId })
    if (!startElementId || !endElementId) {
      diagnostics.push({ code: 'arrow-missing-binding', sceneElementId: element.id, message: 'Arrow is missing a start or end binding.', relatedElementIds: [startElementId, endElementId].filter((id): id is string => !!id) })
      continue
    }
    const source = anchorsByElementId.get(startElementId)
    const target = anchorsByElementId.get(endElementId)
    if (!source || !target) {
      diagnostics.push({ code: 'arrow-unlinked-endpoint', sceneElementId: element.id, message: 'Arrow endpoint is not linked to a Mnemosyne node.', relatedElementIds: [startElementId, endElementId] })
      continue
    }
    if (!source.wireDocumentId || !target.wireDocumentId) {
      diagnostics.push({ code: 'wire-unsupported-endpoint', sceneElementId: element.id, message: 'Only anchors backed by documents can currently compile into Mnemosyne wires.', relatedElementIds: [source.sceneElementId, target.sceneElementId] })
      continue
    }
    wireCandidates.push({
      sceneElementId: element.id,
      stableKey: stableWireKey(element.id, source, target, predicate),
      source: endpointFromAnchor(source),
      target: endpointFromAnchor(target),
      predicate,
      label,
    })
  }

  return { graphId: options.graphId ?? null, artifactId: options.artifactId ?? null, anchors, arrows, wireCandidates, text, frames, diagnostics }
}

export function predicateForArrowLabel(label: string | null | undefined): string {
  const value = label?.trim()
  if (!value) return DEFAULT_WIRE_PREDICATE_URI
  const normalized = normalizePredicateText(value)
  for (const predicate of getAllWirePredicates()) {
    const localName = predicate.uri.split('#').pop() ?? predicate.uri
    if ([predicate.uri, localName, predicate.label].some((candidate) => normalizePredicateText(candidate) === normalized)) return predicate.uri
  }
  return DEFAULT_WIRE_PREDICATE_URI
}

function predicateForArrowCustomData(customData: unknown): string | null {
  if (!isRecord(customData)) return null
  const wire = isRecord(customData.mnemosyneWire) ? customData.mnemosyneWire : null
  const arrow = isRecord(customData.mnemosyneArrow) ? customData.mnemosyneArrow : null
  return stringValue(wire?.predicate) ?? stringValue(arrow?.predicate)
}

function normalizeElements(sceneOrElements: unknown, includeDeleted: boolean): NormalizedElement[] {
  const elements = Array.isArray(sceneOrElements) ? sceneOrElements : isRecord(sceneOrElements) && Array.isArray(sceneOrElements.elements) ? sceneOrElements.elements : []
  return elements.flatMap((value) => {
    if (!isRecord(value) || (!includeDeleted && value.isDeleted === true)) return []
    const id = stringValue(value.id)
    if (!id) return []
    return [{ raw: value, id, type: stringValue(value.type) ?? 'unknown', frameId: stringValue(value.frameId) }]
  })
}

function linkForElement(element: NormalizedElement, diagnostics: SceneGraphDiagnostic[]): { target: SceneLinkTarget; record: SceneLinkRecord | null } | null {
  const linkValue = stringValue(element.raw.link)
  const parsedLink = parseSceneLink(linkValue)
  const recordResult = linkRecordForElement(element.raw.customData)
  if (linkValue?.startsWith(MNEMOSYNE_SCHEME) && !parsedLink) diagnostics.push({ code: 'malformed-link', sceneElementId: element.id, message: 'Element has a malformed Mnemosyne link URI.' })
  if (recordResult === 'malformed') diagnostics.push({ code: 'malformed-link-record', sceneElementId: element.id, message: 'Element has malformed customData.mnemosyne link metadata.' })
  const record = recordResult && recordResult !== 'malformed' ? recordResult : null
  if (!record && !parsedLink) return null
  if (record && parsedLink && !sameTarget(record, parsedLink)) diagnostics.push({ code: 'link-record-mismatch', sceneElementId: element.id, message: 'Element link URI and customData.mnemosyne point at different nodes.' })
  return { target: record ? { kind: record.kind, graphId: record.graphId, id: record.id } : parsedLink!, record }
}

function linkRecordForElement(customData: unknown): SceneLinkRecord | 'malformed' | null {
  if (!isRecord(customData)) return null
  const value = customData.mnemosyne
  if (value === undefined || value === null) return null
  if (!isRecord(value)) return 'malformed'
  const kind = stringValue(value.kind)
  const graphId = stringValue(value.graphId)
  const id = stringValue(value.id)
  if ((kind !== 'document' && kind !== 'artifact') || !graphId || !id) return 'malformed'
  return { kind, graphId, id, title: stringValue(value.title) ?? '' }
}

function labelForElement(element: NormalizedElement, textByContainer: Map<string, string[]>): string | null {
  const direct = stringValue(element.raw.text)?.trim()
  if (direct) return direct
  const label = isRecord(element.raw.label) ? stringValue(element.raw.label.text)?.trim() : null
  if (label) return label
  return textByContainer.get(element.id)?.join(' ').trim() || null
}

function sameTarget(a: SceneLinkTarget, b: SceneLinkTarget): boolean { return a.kind === b.kind && a.graphId === b.graphId && a.id === b.id }
function bindingElementId(value: unknown): string | null { return isRecord(value) ? stringValue(value.elementId) : null }
function boundsForElement(value: Record<string, unknown>): SceneGraphBounds | null {
  const x = numberValue(value.x); const y = numberValue(value.y); const width = numberValue(value.width); const height = numberValue(value.height)
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height }
}
function endpointFromAnchor(anchor: SceneGraphAnchor): SceneGraphWireEndpoint { return { ...anchor.target, sceneElementId: anchor.sceneElementId, title: anchor.title, wireDocumentId: anchor.wireDocumentId } }
function stableWireKey(arrowId: string, source: SceneGraphAnchor, target: SceneGraphAnchor, predicate: string): string { return [arrowId, wireTargetKey(source), wireTargetKey(target), predicate].join('|') }
function wireTargetKey(anchor: SceneGraphAnchor): string { return `${anchor.target.kind}:${anchor.target.graphId}:${anchor.target.id}:wire-document:${anchor.wireDocumentId ?? anchor.target.id}` }
function wireDocumentIdForTarget(target: SceneLinkTarget, resolution: SceneLinkResolution | null): string | null {
  if (resolution && !resolution.exists) return null
  if (target.kind === 'document') return target.id
  return resolution?.exists ? stringValue(resolution.wireDocumentId) : null
}
function normalizePredicateText(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null }
function numberValue(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }

export interface SceneProjectionSummary {
  readonly schemaVersion: 1
  readonly graphId: string | null
  readonly artifactId: string | null
  readonly projectedAt: string
  readonly counts: { readonly anchors: number; readonly arrows: number; readonly wireCandidates: number; readonly text: number; readonly frames: number; readonly diagnostics: number }
  readonly anchors: readonly { readonly sceneElementId: string; readonly kind: string; readonly graphId: string; readonly id: string; readonly title: string; readonly frameId: string | null; readonly targetExists: boolean | null; readonly workspaceTitle: string | null; readonly wireDocumentId: string | null }[]
  readonly frames: readonly { readonly sceneElementId: string; readonly title: string }[]
  readonly text: readonly { readonly sceneElementId: string; readonly text: string; readonly frameId: string | null; readonly containerId: string | null }[]
  readonly wireCandidates: readonly { readonly sceneElementId: string; readonly sourceKind: string; readonly sourceId: string; readonly sourceDocumentId: string; readonly targetGraphId: string; readonly targetKind: string; readonly targetId: string; readonly targetDocumentId: string; readonly predicate: string; readonly label: string | null }[]
  readonly diagnostics: readonly { readonly code: string; readonly sceneElementId: string; readonly message: string }[]
  readonly searchText: string
}

export function summarizeSceneProjection(projection: SceneGraphProjection, projectedAt: Date = new Date()): SceneProjectionSummary {
  const base = {
    schemaVersion: 1 as const,
    graphId: projection.graphId,
    artifactId: projection.artifactId,
    projectedAt: projectedAt.toISOString(),
    counts: { anchors: projection.anchors.length, arrows: projection.arrows.length, wireCandidates: projection.wireCandidates.length, text: projection.text.length, frames: projection.frames.length, diagnostics: projection.diagnostics.length },
    anchors: projection.anchors.map((a) => ({ sceneElementId: a.sceneElementId, kind: a.target.kind, graphId: a.target.graphId, id: a.target.id, title: a.title, frameId: a.frameId, targetExists: a.targetExists, workspaceTitle: a.workspaceTitle, wireDocumentId: a.wireDocumentId })),
    frames: projection.frames.map((f) => ({ sceneElementId: f.sceneElementId, title: f.title })),
    text: projection.text.map((t) => ({ sceneElementId: t.sceneElementId, text: t.text, frameId: t.frameId, containerId: t.containerId })),
    wireCandidates: projection.wireCandidates.map((c) => ({ sceneElementId: c.sceneElementId, sourceKind: c.source.kind, sourceId: c.source.id, sourceDocumentId: c.source.wireDocumentId || c.source.id, targetGraphId: c.target.graphId, targetKind: c.target.kind, targetId: c.target.id, targetDocumentId: c.target.wireDocumentId || c.target.id, predicate: c.predicate, label: c.label ?? getWirePredicateLabel(c.predicate) })),
    diagnostics: projection.diagnostics.map((d) => ({ code: d.code, sceneElementId: d.sceneElementId, message: d.message })),
  }
  return { ...base, searchText: sceneProjectionSearchText(base) }
}

export function sceneProjectionSearchText(summary: Omit<SceneProjectionSummary, 'searchText'>): string {
  return [
    `Scene ${summary.artifactId ?? ''}`.trim(),
    ...summary.frames.map((f) => `Frame: ${f.title}`),
    ...summary.anchors.map((a) => `Anchor: ${a.title} (${a.kind}:${a.id})`),
    ...summary.text.map((t) => `Text: ${t.text}`),
    ...summary.wireCandidates.map((w) => `Wire: ${w.sourceDocumentId} ${w.label ?? w.predicate} ${w.targetDocumentId}`),
    ...summary.diagnostics.map((d) => `Diagnostic: ${d.code} ${d.message}`),
  ].filter(Boolean).join('\n')
}
