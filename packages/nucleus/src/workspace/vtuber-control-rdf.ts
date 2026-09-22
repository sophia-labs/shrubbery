/**
 * vtuber-control-rdf.ts - semantic control overlay for mn-vtuber surfaces.
 *
 * This is deliberately separate from ux-rdf.ts. The layout graph says which
 * component tag belongs in which panel/region; this overlay says which durable
 * control channel drives a VTuber component once the host renders it.
 *
 * Pure: no DOM, no component imports, no stores, no network.
 */

import {
  I,
  L,
  Lbool,
  Ldec,
  compareTriples,
  isIri,
  type Term,
  type Triple,
} from './rdf-model.js'
import { NS, iriFor } from './ux-rdf.js'

const RDF_TYPE = NS.rdf + 'type'
const RDFS_LABEL = NS.rdfs + 'label'
const sux = (local: string): string => NS.sux + local

const GRAPH_ROOT = (graphId: string): string => `urn:mnemosyne:local:graph:${graphId}`

/**
 * `urn:mnemosyne:local:graph:{graph_id}:ux:control` - low-frequency component
 * control bindings. High-frequency audio/pose samples belong in stream/session
 * channels named by these triples, not directly in the graph.
 */
export const uxControlGraphIri = (graphId: string): string => `${GRAPH_ROOT(graphId)}:ux:control`

export type VtuberControlCameraFrame = 'portrait' | 'bust' | 'full'
export type VtuberControlExpressionPreset = 'neutral' | 'focused' | 'excited' | 'strained'
export type VtuberControlMaterialMode = 'capture-safe' | 'source' | 'diagnostic'

export interface VtuberControlAppearance {
  readonly accentTint?: string
  readonly eyeTint?: string
  readonly hairTint?: string
  readonly outfitTint?: string
  readonly skinWarmth?: number
}

/**
 * Durable, graph-addressable control channel for an mn-vtuber surface.
 *
 * The scalar fields intentionally mirror the backend-free custom element API so
 * the runtime can reflect the parsed object into element properties without
 * teaching the layout graph about props.
 */
export interface VtuberControlChannel {
  readonly id: string
  readonly label?: string
  readonly targetComponent?: 'mn-vtuber' | string
  readonly targetPanel?: string | null
  readonly targetRegion?: string | null
  readonly modelUrl?: string
  readonly expression?: VtuberControlExpressionPreset
  readonly material?: VtuberControlMaterialMode
  readonly cameraFrame?: VtuberControlCameraFrame
  readonly animated?: boolean
  readonly fallback?: boolean
  readonly mouth?: number
  readonly blink?: number
  readonly lookX?: number
  readonly lookY?: number
  readonly scale?: number
  readonly appearance?: VtuberControlAppearance
  /** Pointer to a host-owned pose stream/session, not per-frame pose samples. */
  readonly poseSource?: string
  /** Pointer to a host-owned lipsync/audio envelope source. */
  readonly lipsyncSource?: string
  /** Pointer to a host-owned gaze/cursor/head-tracking source. */
  readonly gazeSource?: string
  /** Pointer to a host-owned clock/timeline source. */
  readonly clockSource?: string
  /** Optional sink id for status/load/error events emitted by the component. */
  readonly statusSink?: string
}

export interface VtuberControlOverlay {
  readonly channels: Readonly<Record<string, VtuberControlChannel>>
}

export interface VtuberControlTarget {
  readonly panelId?: string | null
  readonly regionId?: string | null
}

/**
 * Serialize VTuber control channels into a deterministic triple list.
 *
 * Canonical binding shape:
 *   <panel-or-region> sux:controlChannel <channel>
 *   <channel> rdf:type sux:VTuberControlChannel
 *
 * Channel fields then describe low-frequency state and stream pointers.
 */
export function serializeVtuberControlOverlayToTriples(overlay: VtuberControlOverlay): Triple[] {
  return serializeVtuberControlChannelsToTriples(Object.values(overlay.channels))
}

export function serializeVtuberControlChannelsToTriples(
  channels: readonly VtuberControlChannel[],
): Triple[] {
  const out: Triple[] = []
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o })

  for (const channel of channels) {
    const C = iriFor(channel.id)
    add(C, RDF_TYPE, I(sux('VTuberControlChannel')))
    add(C, sux('localId'), L(channel.id))
    if (channel.label !== undefined) add(C, RDFS_LABEL, L(channel.label))
    add(C, sux('targetComponent'), L(channel.targetComponent ?? 'mn-vtuber'))

    if (channel.targetPanel) {
      add(iriFor(channel.targetPanel), sux('controlChannel'), I(C))
      add(C, sux('targetPanel'), I(iriFor(channel.targetPanel)))
    }
    if (channel.targetRegion) {
      add(iriFor(channel.targetRegion), sux('controlChannel'), I(C))
      add(C, sux('targetRegion'), I(iriFor(channel.targetRegion)))
    }

    addString(add, C, 'modelUrl', channel.modelUrl)
    addString(add, C, 'expression', channel.expression)
    addString(add, C, 'material', channel.material)
    addString(add, C, 'cameraFrame', channel.cameraFrame)
    addBool(add, C, 'animated', channel.animated)
    addBool(add, C, 'fallback', channel.fallback)
    addNumber(add, C, 'mouth', channel.mouth)
    addNumber(add, C, 'blink', channel.blink)
    addNumber(add, C, 'lookX', channel.lookX)
    addNumber(add, C, 'lookY', channel.lookY)
    addNumber(add, C, 'scale', channel.scale)

    addString(add, C, 'accentTint', channel.appearance?.accentTint)
    addString(add, C, 'eyeTint', channel.appearance?.eyeTint)
    addString(add, C, 'hairTint', channel.appearance?.hairTint)
    addString(add, C, 'outfitTint', channel.appearance?.outfitTint)
    addNumber(add, C, 'skinWarmth', channel.appearance?.skinWarmth)

    addString(add, C, 'poseSource', channel.poseSource)
    addString(add, C, 'lipsyncSource', channel.lipsyncSource)
    addString(add, C, 'gazeSource', channel.gazeSource)
    addString(add, C, 'clockSource', channel.clockSource)
    addString(add, C, 'statusSink', channel.statusSink)
  }

  return out.sort(compareTriples)
}

export function parseVtuberControlOverlay(triples: readonly Triple[]): VtuberControlOverlay {
  const bySubject = new Map<string, Map<string, Term[]>>()
  for (const t of triples) {
    let preds = bySubject.get(t.s)
    if (!preds) bySubject.set(t.s, (preds = new Map()))
    const key = predicateKey(t.p)
    const arr = preds.get(key)
    if (arr) arr.push(t.o)
    else preds.set(key, [t.o])
  }

  const channelIris = new Set<string>()
  for (const [s, preds] of bySubject) {
    const types = preds.get('type') ?? []
    if (types.some((t) => t.type === 'iri' && localId(bySubject, t.value) === 'VTuberControlChannel')) {
      channelIris.add(s)
    }
  }
  for (const t of triples) {
    if (t.p === sux('controlChannel') && isIri(t.o)) channelIris.add(t.o.value)
  }

  const channels: Record<string, VtuberControlChannel> = {}
  for (const iri of [...channelIris].sort()) {
    const preds = bySubject.get(iri)
    const id = localId(bySubject, iri)
    const targetFromBinding = inferTargetFromBinding(triples, iri)
    const appearance = appearanceOf(preds)
    channels[id] = {
      id,
      ...(lit(preds, 'label') !== undefined ? { label: lit(preds, 'label') } : {}),
      targetComponent: lit(preds, 'targetComponent') ?? 'mn-vtuber',
      targetPanel: iriRef(bySubject, preds, 'targetPanel') ?? targetFromBinding.targetPanel ?? null,
      targetRegion: iriRef(bySubject, preds, 'targetRegion') ?? targetFromBinding.targetRegion ?? null,
      ...(lit(preds, 'modelUrl') !== undefined ? { modelUrl: lit(preds, 'modelUrl') } : {}),
      ...(enumValue(preds, 'expression', EXPRESSION_PRESETS) !== undefined
        ? { expression: enumValue(preds, 'expression', EXPRESSION_PRESETS) }
        : {}),
      ...(enumValue(preds, 'material', MATERIAL_MODES) !== undefined
        ? { material: enumValue(preds, 'material', MATERIAL_MODES) }
        : {}),
      ...(enumValue(preds, 'cameraFrame', CAMERA_FRAMES) !== undefined
        ? { cameraFrame: enumValue(preds, 'cameraFrame', CAMERA_FRAMES) }
        : {}),
      ...(boolOf(preds, 'animated') !== undefined ? { animated: boolOf(preds, 'animated') } : {}),
      ...(boolOf(preds, 'fallback') !== undefined ? { fallback: boolOf(preds, 'fallback') } : {}),
      ...(boundedNumber(preds, 'mouth', 0, 1) !== undefined ? { mouth: boundedNumber(preds, 'mouth', 0, 1) } : {}),
      ...(boundedNumber(preds, 'blink', 0, 1) !== undefined ? { blink: boundedNumber(preds, 'blink', 0, 1) } : {}),
      ...(boundedNumber(preds, 'lookX', -1, 1) !== undefined ? { lookX: boundedNumber(preds, 'lookX', -1, 1) } : {}),
      ...(boundedNumber(preds, 'lookY', -1, 1) !== undefined ? { lookY: boundedNumber(preds, 'lookY', -1, 1) } : {}),
      ...(boundedNumber(preds, 'scale', 0.1, 4) !== undefined ? { scale: boundedNumber(preds, 'scale', 0.1, 4) } : {}),
      ...(appearance ? { appearance } : {}),
      ...(lit(preds, 'poseSource') !== undefined ? { poseSource: lit(preds, 'poseSource') } : {}),
      ...(lit(preds, 'lipsyncSource') !== undefined ? { lipsyncSource: lit(preds, 'lipsyncSource') } : {}),
      ...(lit(preds, 'gazeSource') !== undefined ? { gazeSource: lit(preds, 'gazeSource') } : {}),
      ...(lit(preds, 'clockSource') !== undefined ? { clockSource: lit(preds, 'clockSource') } : {}),
      ...(lit(preds, 'statusSink') !== undefined ? { statusSink: lit(preds, 'statusSink') } : {}),
    }
  }

  return { channels }
}

/**
 * Select the channel that drives a rendered VTuber surface. Panel bindings win
 * over region bindings because content regions usually resolve through their
 * first docked panel, while chrome/standalone regions bind directly.
 */
export function selectVtuberControlChannel(
  overlay: VtuberControlOverlay | null | undefined,
  target: VtuberControlTarget,
): VtuberControlChannel | null {
  if (!overlay) return null
  const channels = Object.values(overlay.channels)
  if (target.panelId) {
    const panelMatch = channels.find((channel) => channel.targetPanel === target.panelId)
    if (panelMatch) return panelMatch
  }
  if (target.regionId) {
    const regionMatch = channels.find((channel) => channel.targetRegion === target.regionId)
    if (regionMatch) return regionMatch
  }
  return null
}

function addString(
  add: (s: string, p: string, o: Term) => void,
  subject: string,
  local: string,
  value: string | undefined,
): void {
  if (value !== undefined) add(subject, sux(local), L(value))
}

function addBool(
  add: (s: string, p: string, o: Term) => void,
  subject: string,
  local: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) add(subject, sux(local), Lbool(value))
}

function addNumber(
  add: (s: string, p: string, o: Term) => void,
  subject: string,
  local: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) add(subject, sux(local), Ldec(value))
}

function predicateKey(predicate: string): string {
  if (predicate === RDF_TYPE) return 'type'
  if (predicate === RDFS_LABEL) return 'label'
  return predicate.startsWith(NS.sux) ? predicate.slice(NS.sux.length) : predicate
}

function localId(bySubject: Map<string, Map<string, Term[]>>, iri: string): string {
  const one = bySubject.get(iri)?.get('localId')?.[0]
  if (one?.type === 'literal') return one.value
  return iri.startsWith(NS.sux) ? iri.slice(NS.sux.length) : iri
}

function lit(preds: Map<string, Term[]> | undefined, key: string): string | undefined {
  const t = preds?.get(key)?.[0]
  return t?.type === 'literal' ? t.value : undefined
}

function iriRef(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
  key: string,
): string | undefined {
  const t = preds?.get(key)?.[0]
  return t?.type === 'iri' ? localId(bySubject, t.value) : undefined
}

function boolOf(preds: Map<string, Term[]> | undefined, key: string): boolean | undefined {
  const value = lit(preds, key)
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function boundedNumber(
  preds: Map<string, Term[]> | undefined,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const raw = lit(preds, key)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

function enumValue<const T extends readonly string[]>(
  preds: Map<string, Term[]> | undefined,
  key: string,
  allowed: T,
): T[number] | undefined {
  const value = lit(preds, key)
  return value !== undefined && (allowed as readonly string[]).includes(value) ? value : undefined
}

function appearanceOf(preds: Map<string, Term[]> | undefined): VtuberControlAppearance | undefined {
  const accentTint = lit(preds, 'accentTint')
  const eyeTint = lit(preds, 'eyeTint')
  const hairTint = lit(preds, 'hairTint')
  const outfitTint = lit(preds, 'outfitTint')
  const skinWarmth = boundedNumber(preds, 'skinWarmth', -1, 1)
  if (
    accentTint === undefined &&
    eyeTint === undefined &&
    hairTint === undefined &&
    outfitTint === undefined &&
    skinWarmth === undefined
  ) {
    return undefined
  }
  return {
    ...(accentTint !== undefined ? { accentTint } : {}),
    ...(eyeTint !== undefined ? { eyeTint } : {}),
    ...(hairTint !== undefined ? { hairTint } : {}),
    ...(outfitTint !== undefined ? { outfitTint } : {}),
    ...(skinWarmth !== undefined ? { skinWarmth } : {}),
  }
}

function inferTargetFromBinding(
  triples: readonly Triple[],
  channelIri: string,
): Pick<VtuberControlChannel, 'targetPanel' | 'targetRegion'> {
  for (const t of triples) {
    if (t.p !== sux('controlChannel') || !isIri(t.o) || t.o.value !== channelIri) continue
    const id = t.s.startsWith(NS.sux) ? t.s.slice(NS.sux.length) : t.s
    if (id.startsWith('panel-')) return { targetPanel: id }
    if (id.startsWith('region-')) return { targetRegion: id }
  }
  return {}
}

const CAMERA_FRAMES = ['portrait', 'bust', 'full'] as const
const EXPRESSION_PRESETS = ['neutral', 'focused', 'excited', 'strained'] as const
const MATERIAL_MODES = ['capture-safe', 'source', 'diagnostic'] as const
