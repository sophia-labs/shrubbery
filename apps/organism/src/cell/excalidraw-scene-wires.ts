import { getWirePredicateLabel } from '@shrubbery/nucleus'
import type {
  SceneGraphAnchor,
  SceneGraphProjection,
  SceneGraphWireCandidate,
} from './excalidraw-scene-projection.js'

export interface SceneWireSyncContext {
  readonly sceneGraphId: string
  readonly sceneArtifactId: string
}

export interface SceneWireSyncResult {
  readonly missing: readonly SceneGraphWireCandidate[]
  readonly skipped: readonly SceneGraphWireCandidate[]
}

export function missingSceneWireCandidates(
  candidates: readonly SceneGraphWireCandidate[],
  wiresSnapshot: Iterable<Record<string, unknown>>,
): SceneGraphWireCandidate[] {
  const existing = new Set<string>()
  for (const wire of wiresSnapshot) {
    const sourceDocumentId = entityIdValue(wire.sourceDocumentId ?? wire.source_document_id)
    const targetGraphId = stringValue(wire.targetGraphId ?? wire.target_graph_id)
    const targetDocumentId = entityIdValue(wire.targetDocumentId ?? wire.target_document_id)
    const predicate = stringValue(wire.predicate)
    if (!sourceDocumentId || !targetGraphId || !targetDocumentId || !predicate) continue
    existing.add(wireSignature({ sourceDocumentId, targetGraphId, targetDocumentId, predicate }))
  }
  return candidates.filter((candidate) => !existing.has(wireSignature({
    sourceDocumentId: endpointWireDocumentId(candidate.source),
    targetGraphId: candidate.target.graphId,
    targetDocumentId: endpointWireDocumentId(candidate.target),
    predicate: candidate.predicate,
  })))
}

export function sceneWireProvenanceFields(
  candidate: SceneGraphWireCandidate,
  context?: SceneWireSyncContext,
): Record<string, string> {
  if (!context?.sceneGraphId || !context.sceneArtifactId) return {}
  return {
    sceneGraphId: context.sceneGraphId,
    sceneArtifactId: context.sceneArtifactId,
    sceneElementId: candidate.sceneElementId,
    sceneSourceElementId: candidate.source.sceneElementId,
    sceneTargetElementId: candidate.target.sceneElementId,
    sceneStableKey: candidate.stableKey,
  }
}

export function sceneWireSyncSummary(
  candidates: readonly SceneGraphWireCandidate[],
  wiresSnapshot: Iterable<Record<string, unknown>>,
): SceneWireSyncResult {
  const missing = missingSceneWireCandidates(candidates, wiresSnapshot)
  const missingKeys = new Set(missing.map((candidate) => candidate.stableKey))
  return { missing, skipped: candidates.filter((candidate) => !missingKeys.has(candidate.stableKey)) }
}

export interface SceneWireHydrationContext {
  sceneGraphId: string
  sceneArtifactId: string
}

export interface SceneWireHydrationCandidate {
  wireId: string
  arrowElementId: string
  labelElementId: string
  stableKey: string
  source: SceneGraphAnchor
  target: SceneGraphAnchor
  predicate: string
  label: string
}

export interface SceneWireHydrationResult {
  elements: Record<string, unknown>[]
  hydrated: SceneWireHydrationCandidate[]
}

type SceneElementRecord = Record<string, unknown>

const DEFAULT_STROKE_COLOR = '#5b63d3'
const DEFAULT_LABEL_BACKGROUND = '#ffffff'
const DEFAULT_FONT_FAMILY = 5
const DEFAULT_LABEL_FONT_SIZE = 14
const ARROW_GAP = 10

export function missingSceneWireHydrations(
  projection: SceneGraphProjection,
  wiresSnapshot: Iterable<Record<string, unknown>>,
  context: SceneWireHydrationContext,
): SceneWireHydrationCandidate[] {
  const existingSignatures = new Set(
    projection.wireCandidates.map((candidate) => wireSignature({
      sourceDocumentId: endpointWireDocumentId(candidate.source),
      targetGraphId: candidate.target.graphId,
      targetDocumentId: endpointWireDocumentId(candidate.target),
      predicate: candidate.predicate,
    })),
  )
  const existingArrowIds = new Set(projection.arrows.map((arrow) => arrow.sceneElementId))
  const anchorsByElementId = new Map(projection.anchors.map((anchor) => [anchor.sceneElementId, anchor]))
  const anchorsByTarget = new Map<string, SceneGraphAnchor[]>()
  const anchorsByWireDocument = new Map<string, SceneGraphAnchor[]>()
  for (const anchor of projection.anchors) {
    const key = anchorTargetKey(anchor.target.graphId, anchor.target.id)
    anchorsByTarget.set(key, [...(anchorsByTarget.get(key) ?? []), anchor])
    if (anchor.wireDocumentId) {
      const wireKey = anchorTargetKey(anchor.target.graphId, anchor.wireDocumentId)
      anchorsByWireDocument.set(wireKey, [...(anchorsByWireDocument.get(wireKey) ?? []), anchor])
    }
  }

  const candidates: SceneWireHydrationCandidate[] = []
  for (const wire of wiresSnapshot) {
    const wireId = stringValue(wire.id) ?? stringValue(wire.wireId)
    const sceneArtifactId = entityIdValue(wire.sceneArtifactId ?? wire.scene_artifact_id)
    if (!wireId || sceneArtifactId !== context.sceneArtifactId) continue

    const sceneGraphId = stringValue(wire.sceneGraphId ?? wire.scene_graph_id)
    if (sceneGraphId && sceneGraphId !== context.sceneGraphId) continue

    const sourceDocumentId = entityIdValue(wire.sourceDocumentId ?? wire.source_document_id)
    const targetGraphId = stringValue(wire.targetGraphId ?? wire.target_graph_id)
    const targetDocumentId = entityIdValue(wire.targetDocumentId ?? wire.target_document_id)
    const predicate = stringValue(wire.predicate)
    if (!sourceDocumentId || !targetGraphId || !targetDocumentId || !predicate) continue

    const signature = wireSignature({
      sourceDocumentId,
      targetGraphId,
      targetDocumentId,
      predicate,
    })
    if (existingSignatures.has(signature)) continue

    const source = anchorForWireEndpoint({
      anchorsByElementId,
      anchorsByTarget,
      anchorsByWireDocument,
      preferredSceneElementId: stringValue(wire.sceneSourceElementId ?? wire.scene_source_element_id),
      graphId: context.sceneGraphId,
      documentId: sourceDocumentId,
    })
    const target = anchorForWireEndpoint({
      anchorsByElementId,
      anchorsByTarget,
      anchorsByWireDocument,
      preferredSceneElementId: stringValue(wire.sceneTargetElementId ?? wire.scene_target_element_id),
      graphId: targetGraphId,
      documentId: targetDocumentId,
    })
    if (!source?.bounds || !target?.bounds || source.sceneElementId === target.sceneElementId) continue

    const stableKey = stringValue(wire.sceneStableKey ?? wire.scene_stable_key) ?? `${wireId}|${signature}`
    const arrowElementId =
      stringValue(wire.sceneElementId ?? wire.scene_element_id) ?? stableElementId('mn-wire-arrow', stableKey)
    if (existingArrowIds.has(arrowElementId)) continue

    candidates.push({
      wireId,
      arrowElementId,
      labelElementId: stableElementId('mn-wire-label', stableKey),
      stableKey,
      source,
      target,
      predicate,
      label: getWirePredicateLabel(predicate),
    })
  }
  return candidates
}

export function applySceneWireHydration(
  elements: readonly unknown[],
  projection: SceneGraphProjection,
  wiresSnapshot: Iterable<Record<string, unknown>>,
  context: SceneWireHydrationContext,
): SceneWireHydrationResult {
  const existingElements = elements.filter(isRecord)
  const existingIds = new Set(existingElements.map((element) => stringValue(element.id)).filter((id): id is string => !!id))
  const hydrated = missingSceneWireHydrations(projection, wiresSnapshot, context)
    .filter((candidate) => !existingIds.has(candidate.arrowElementId) && !existingIds.has(candidate.labelElementId))
  if (hydrated.length === 0) return { elements: existingElements, hydrated: [] }

  const hydratedByAnchor = new Map<string, string[]>()
  for (const candidate of hydrated) {
    hydratedByAnchor.set(candidate.source.sceneElementId, [
      ...(hydratedByAnchor.get(candidate.source.sceneElementId) ?? []),
      candidate.arrowElementId,
    ])
    hydratedByAnchor.set(candidate.target.sceneElementId, [
      ...(hydratedByAnchor.get(candidate.target.sceneElementId) ?? []),
      candidate.arrowElementId,
    ])
  }

  const updatedElements = existingElements.map((element) => {
    const elementId = stringValue(element.id)
    if (!elementId) return element
    const arrowIds = hydratedByAnchor.get(elementId)
    if (!arrowIds?.length) return element
    return withBoundArrows(element, arrowIds)
  })

  for (const candidate of hydrated) {
    updatedElements.push(...buildHydratedWireElements(candidate, context))
  }

  return { elements: updatedElements, hydrated }
}

export function upsertSceneArrowPredicate(
  elements: readonly unknown[],
  arrowElementId: string,
  predicate: string,
): Record<string, unknown>[] {
  const records = elements.filter(isRecord)
  const arrow = records.find((element) => element.id === arrowElementId)
  if (!arrow || arrow.type !== 'arrow') return records

  const label = getWirePredicateLabel(predicate)
  const existingTextId = firstBoundTextId(arrow)
  const existingText = records.find((element) =>
    element.type === 'text'
    && (element.id === existingTextId || element.containerId === arrowElementId)
  )
  const labelElementId = stringValue(existingText?.id) ?? stableElementId('mn-arrow-label', arrowElementId)
  const labelPosition = labelPositionForArrow(arrow, label)
  let updatedExistingLabel = false

  const updated = records.map((element) => {
    if (element.id === arrowElementId) {
      return {
        ...withArrowPredicateCustomData(element, predicate, label),
        boundElements: withBoundText(element.boundElements, labelElementId),
      }
    }
    if (element.id === labelElementId || (element.type === 'text' && element.containerId === arrowElementId)) {
      updatedExistingLabel = true
      return withArrowLabelText(element, arrowElementId, predicate, label)
    }
    return element
  })

  if (!updatedExistingLabel) {
    updated.push(newArrowPredicateLabelElement(labelElementId, arrowElementId, predicate, label, labelPosition))
  }
  return updated
}

function buildHydratedWireElements(
  candidate: SceneWireHydrationCandidate,
  context: SceneWireHydrationContext,
): SceneElementRecord[] {
  const start = edgePoint(candidate.source.bounds!, center(candidate.target.bounds!))
  const end = edgePoint(candidate.target.bounds!, center(candidate.source.bounds!))
  const dx = end.x - start.x
  const dy = end.y - start.y
  const midpoint = { x: start.x + dx / 2, y: start.y + dy / 2 }
  const labelWidth = Math.max(72, candidate.label.length * 7.5)
  const labelHeight = DEFAULT_LABEL_FONT_SIZE * 1.45
  const customData = mnemosyneWireCustomData(candidate, context)

  const arrow = {
    ...baseElement(candidate.arrowElementId, 'arrow', start.x, start.y, Math.abs(dx), Math.abs(dy)),
    strokeColor: DEFAULT_STROKE_COLOR,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    roughness: 1,
    roundness: { type: 2 },
    points: [[0, 0], [dx, dy]],
    lastCommittedPoint: null,
    startBinding: { elementId: candidate.source.sceneElementId, focus: 0, gap: ARROW_GAP },
    endBinding: { elementId: candidate.target.sceneElementId, focus: 0, gap: ARROW_GAP },
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
    boundElements: [{ id: candidate.labelElementId, type: 'text' }],
    customData,
  }
  const label = {
    ...baseElement(
      candidate.labelElementId,
      'text',
      midpoint.x - labelWidth / 2,
      midpoint.y - labelHeight / 2,
      labelWidth,
      labelHeight,
    ),
    strokeColor: '#1f2a44',
    backgroundColor: DEFAULT_LABEL_BACKGROUND,
    fillStyle: 'solid',
    text: candidate.label,
    originalText: candidate.label,
    fontSize: DEFAULT_LABEL_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: candidate.arrowElementId,
    autoResize: true,
    lineHeight: 1.25,
    customData: {
      ...customData,
      mnemosyneWire: {
        ...(customData.mnemosyneWire as Record<string, unknown>),
        role: 'label',
      },
    },
  }
  return [arrow, label]
}

function firstBoundTextId(arrow: SceneElementRecord): string | null {
  if (!Array.isArray(arrow.boundElements)) return null
  for (const item of arrow.boundElements) {
    if (isRecord(item) && item.type === 'text') return stringValue(item.id)
  }
  return null
}

function withBoundText(boundElements: unknown, labelElementId: string): Record<string, string>[] {
  const current = Array.isArray(boundElements) ? boundElements.filter(isRecord) : []
  const normalized = current.flatMap((item) => {
    const id = stringValue(item.id)
    const type = stringValue(item.type)
    return id && type ? [{ id, type }] : []
  })
  const hasLabel = normalized.some((item) => item.type === 'text' && item.id === labelElementId)
  return [
    ...normalized,
    ...(hasLabel ? [] : [{ id: labelElementId, type: 'text' }]),
  ]
}

function withArrowPredicateCustomData(
  element: SceneElementRecord,
  predicate: string,
  label: string,
): SceneElementRecord {
  const customData = isRecord(element.customData) ? { ...element.customData } : {}
  if (isRecord(customData.mnemosyneWire)) {
    customData.mnemosyneWire = { ...customData.mnemosyneWire, predicate, label }
  } else {
    customData.mnemosyneArrow = { ...(isRecord(customData.mnemosyneArrow) ? customData.mnemosyneArrow : {}), predicate, label }
  }
  return { ...element, customData }
}

function withArrowLabelText(
  element: SceneElementRecord,
  arrowElementId: string,
  predicate: string,
  label: string,
): SceneElementRecord {
  return {
    ...element,
    text: label,
    originalText: label,
    containerId: arrowElementId,
    customData: withLabelCustomData(element.customData, predicate, label),
  }
}

function newArrowPredicateLabelElement(
  labelElementId: string,
  arrowElementId: string,
  predicate: string,
  label: string,
  position: { x: number; y: number; width: number; height: number },
): SceneElementRecord {
  return {
    ...baseElement(labelElementId, 'text', position.x, position.y, position.width, position.height),
    strokeColor: '#1f2a44',
    backgroundColor: DEFAULT_LABEL_BACKGROUND,
    fillStyle: 'solid',
    text: label,
    originalText: label,
    fontSize: DEFAULT_LABEL_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: arrowElementId,
    autoResize: true,
    lineHeight: 1.25,
    customData: withLabelCustomData(null, predicate, label),
  }
}

function withLabelCustomData(customDataValue: unknown, predicate: string, label: string): Record<string, unknown> {
  const customData = isRecord(customDataValue) ? { ...customDataValue } : {}
  customData.mnemosyneArrow = {
    ...(isRecord(customData.mnemosyneArrow) ? customData.mnemosyneArrow : {}),
    predicate,
    label,
    role: 'label',
  }
  return customData
}

function labelPositionForArrow(
  arrow: SceneElementRecord,
  label: string,
): { x: number; y: number; width: number; height: number } {
  const x = numberValue(arrow.x) ?? 0
  const y = numberValue(arrow.y) ?? 0
  const points = Array.isArray(arrow.points) ? arrow.points.filter(Array.isArray) : []
  const first = points[0] ?? [0, 0]
  const last = points[points.length - 1] ?? [
    numberValue(arrow.width) ?? 0,
    numberValue(arrow.height) ?? 0,
  ]
  const labelWidth = Math.max(72, label.length * 7.5)
  const labelHeight = DEFAULT_LABEL_FONT_SIZE * 1.45
  const firstX = numberValue(first[0]) ?? 0
  const firstY = numberValue(first[1]) ?? 0
  const lastX = numberValue(last[0]) ?? 0
  const lastY = numberValue(last[1]) ?? 0
  const midX = x + (firstX + lastX) / 2
  const midY = y + (firstY + lastY) / 2
  return {
    x: midX - labelWidth / 2,
    y: midY - labelHeight / 2,
    width: labelWidth,
    height: labelHeight,
  }
}

function mnemosyneWireCustomData(
  candidate: SceneWireHydrationCandidate,
  context: SceneWireHydrationContext,
): Record<string, unknown> {
  return {
    mnemosyneWire: {
      managed: true,
      wireId: candidate.wireId,
      sceneGraphId: context.sceneGraphId,
      sceneArtifactId: context.sceneArtifactId,
      sceneElementId: candidate.arrowElementId,
      sceneSourceElementId: candidate.source.sceneElementId,
      sceneTargetElementId: candidate.target.sceneElementId,
      sceneStableKey: candidate.stableKey,
      sourceDocumentId: anchorWireDocumentId(candidate.source),
      targetGraphId: candidate.target.target.graphId,
      targetDocumentId: anchorWireDocumentId(candidate.target),
      predicate: candidate.predicate,
    },
  }
}

function baseElement(
  id: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SceneElementRecord {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: positiveHash(id),
    version: 1,
    versionNonce: 0,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  }
}

function withBoundArrows(element: SceneElementRecord, arrowIds: readonly string[]): SceneElementRecord {
  const current = Array.isArray(element.boundElements) ? element.boundElements.filter(isRecord) : []
  const existingArrowIds = new Set(
    current
      .filter((item) => item.type === 'arrow')
      .map((item) => stringValue(item.id))
      .filter((id): id is string => !!id),
  )
  const additions = arrowIds
    .filter((arrowId) => !existingArrowIds.has(arrowId))
    .map((arrowId) => ({ id: arrowId, type: 'arrow' }))
  if (additions.length === 0) return element
  return { ...element, boundElements: [...current, ...additions] }
}

function anchorForWireEndpoint(input: {
  anchorsByElementId: Map<string, SceneGraphAnchor>
  anchorsByTarget: Map<string, SceneGraphAnchor[]>
  anchorsByWireDocument: Map<string, SceneGraphAnchor[]>
  preferredSceneElementId: string | null
  graphId: string
  documentId: string
}): SceneGraphAnchor | null {
  if (input.preferredSceneElementId) {
    const preferred = input.anchorsByElementId.get(input.preferredSceneElementId)
    if (
      preferred
      && preferred.target.graphId === input.graphId
      && anchorWireDocumentId(preferred) === input.documentId
    ) {
      return preferred
    }
  }
  const candidates = uniqueAnchors([
    ...(input.anchorsByWireDocument.get(anchorTargetKey(input.graphId, input.documentId)) ?? []),
    ...(input.anchorsByTarget.get(anchorTargetKey(input.graphId, input.documentId)) ?? []),
  ])
  return candidates.length === 1 ? candidates[0] : null
}

function anchorWireDocumentId(anchor: SceneGraphAnchor): string {
  return anchor.wireDocumentId || anchor.target.id
}

export function endpointWireDocumentId(endpoint: { wireDocumentId: string | null; id: string }): string {
  return endpoint.wireDocumentId || endpoint.id
}

function uniqueAnchors(anchors: readonly SceneGraphAnchor[]): SceneGraphAnchor[] {
  const seen = new Set<string>()
  const unique: SceneGraphAnchor[] = []
  for (const anchor of anchors) {
    if (seen.has(anchor.sceneElementId)) continue
    seen.add(anchor.sceneElementId)
    unique.push(anchor)
  }
  return unique
}

function center(bounds: NonNullable<SceneGraphAnchor['bounds']>): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function edgePoint(
  bounds: NonNullable<SceneGraphAnchor['bounds']>,
  toward: { x: number; y: number },
): { x: number; y: number } {
  const c = center(bounds)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : Math.abs((bounds.width / 2) / dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : Math.abs((bounds.height / 2) / dy)
  const scale = Math.min(scaleX, scaleY)
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}

function wireSignature(input: {
  sourceDocumentId: string
  targetGraphId: string
  targetDocumentId: string
  predicate: string
}): string {
  return [
    input.sourceDocumentId,
    input.targetGraphId,
    input.targetDocumentId,
    input.predicate,
  ].join('|')
}

function anchorTargetKey(graphId: string, documentId: string): string {
  return `${graphId}|${documentId}`
}

function stableElementId(prefix: string, stableKey: string): string {
  return `${prefix}-${positiveHash(stableKey).toString(36)}`
}

function positiveHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function entityIdValue(value: unknown): string | null {
  const text = stringValue(value)
  if (!text) return null
  const match = text.match(/:(?:document|artifact):([^:]+)$/)
  return match ? match[1] : text
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is SceneElementRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
