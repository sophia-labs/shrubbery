/**
 * mn-graph-three — controlled Garden paper-craft renderer.
 *
 * This component preserves Garden's observable 3-D scene language (weighted
 * workspace rings, document helix, semantic mycelium, portals, particles and
 * orbit/selection behavior) without preserving Garden's store ownership. The
 * host projects every node, edge, mode and durable selection into properties;
 * the component owns only GPU and ephemeral presentation state and emits user
 * intents. It never reads a store, performs navigation, or talks to a backend.
 * The WebGL renderer/canvas lives for the component's full connected lifetime;
 * controlled projection changes dispose and rebuild scene objects in place so
 * layout or data churn cannot reset the context, camera, or OrbitControls.
 *
 * `mn-graph` remains the deterministic SVG vocabulary graph. This renderer is
 * the non-relocatable WebGL surface used by the manifested graph panel.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import type { MnGraphEdge, MnGraphNode } from './mn-graph.js'

interface LayoutPoint {
  x: number
  y: number
  z?: number
}

interface NodeView {
  readonly node: MnGraphThreeNode
  readonly group: THREE.Group
  readonly hit: THREE.Mesh
  readonly label: HTMLDivElement
  readonly radius: number
  readonly basePosition: THREE.Vector3
  readonly baseScale: THREE.Vector3
  readonly baseColor: number
}

interface EdgeView {
  readonly id: string
  readonly edge: MnGraphThreeEdge
  readonly curve: THREE.CubicBezierCurve3
  readonly material: THREE.MeshBasicMaterial
  readonly hit: THREE.Mesh
  readonly particles: readonly THREE.Mesh[]
  readonly particleOffsets: number[]
  readonly particleTrails: readonly (readonly THREE.Mesh[])[]
  readonly speed: number
  readonly category: WireCategory
}

interface Palette {
  readonly accent: number
  readonly accentStrong: number
  readonly border: number
  readonly surface: number
  readonly text: string
  readonly muted: string
  readonly wire: number
}

export type MnGraphThreeDimension = '2d' | '3d'
export type MnGraphThreeViewMode = 'workspace' | 'document'
export type MnGraphThreeNodeKind =
  | 'graph'
  | 'folder'
  | 'document'
  | 'read-only-document'
  | 'artifact'
  | 'tag'
  | 'portal'
  | 'heading'
  | 'paragraph'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'blockquote'
  | 'code'
  | 'footnote'
  | 'image'
  | 'math'
  | 'table'
  | 'query'
  | 'horizontal-rule'
  | 'unknown'

export interface MnGraphThreeNode extends MnGraphNode {
  readonly kind?: MnGraphThreeNodeKind | string
  readonly parentId?: string | null
  readonly graphId?: string | null
  readonly documentId?: string | null
  readonly ingestedDocumentId?: string | null
  readonly blockId?: string | null
  readonly order?: number | null
  readonly depth?: number | null
  readonly snippet?: string | null
  readonly readOnly?: boolean
  readonly checked?: boolean | null
}

export type WireCategory =
  | 'default'
  | 'quantity'
  | 'quality'
  | 'relation'
  | 'modality'
  | 'connective'
  | 'disjunctive'
  | 'conjunctive'

export interface MnGraphThreeEdge extends MnGraphEdge {
  readonly id?: string
  readonly predicateLabel?: string
  readonly bidirectional?: boolean
  readonly category?: WireCategory
}

export interface MnGraphThreePoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

const NODE_RADIUS = 0.34
const MIN_WORLD = 4.4
const CAMERA_FOCUS_LERP_SPEED = 0.06
const HELIX_RADIUS = 3.8
const WORKSPACE_SPREAD_SCALE = 0.4
const WORKSPACE_BASE_RING_RADIUS = 1.3
const WORKSPACE_RING_RADIUS_STEP = 1.65
const WORKSPACE_RING_VERTICAL_DROP = 2
const WORKSPACE_RING_VERTICAL_JITTER = 0.5
const GARDEN_BACKGROUND = 0x2a3328
const GARDEN_CREAM = 0xf8faf5
const GARDEN_PARCHMENT = 0xe8eddf
const GARDEN_STONE = 0x6b7568

const WIRE_COLORS: Record<WireCategory, number> = {
  default: 0x8a9180,
  quantity: 0x7d9b8a,
  quality: 0xb8937a,
  relation: 0x9a8bb0,
  modality: 0x8ba5b8,
  connective: 0xa3b87a,
  disjunctive: 0xc49a7c,
  conjunctive: 0xb88a9a,
}

const PREDICATE_CATEGORIES: Readonly<Record<string, WireCategory>> = {
  partOf: 'quantity',
  contains: 'quantity',
  exemplifies: 'quantity',
  supports: 'quality',
  contradicts: 'quality',
  qualifies: 'quality',
  causeOf: 'relation',
  consequenceOf: 'relation',
  relatedTo: 'relation',
  requires: 'modality',
  enables: 'modality',
  precedes: 'modality',
  flowsInto: 'connective',
  produces: 'connective',
  divergesFrom: 'disjunctive',
  branchesTo: 'disjunctive',
  consumesWith: 'conjunctive',
  intensifiesWith: 'conjunctive',
}

interface ParticleBehavior {
  readonly count: number
  readonly speedMultiplier: number
  readonly motion: 'continuous' | 'bidirectional' | 'stepping' | 'wobble'
  readonly scale: 'swell' | 'uniform' | 'grow'
  readonly trail: boolean
  readonly opacity: 'steady' | 'flicker'
}

const CATEGORY_PARTICLES: Readonly<Record<WireCategory, ParticleBehavior>> = {
  default: { count: 3, speedMultiplier: 1, motion: 'continuous', scale: 'swell', trail: false, opacity: 'steady' },
  quantity: { count: 3, speedMultiplier: 0.7, motion: 'continuous', scale: 'uniform', trail: false, opacity: 'steady' },
  quality: { count: 4, speedMultiplier: 0.9, motion: 'bidirectional', scale: 'swell', trail: false, opacity: 'flicker' },
  relation: { count: 3, speedMultiplier: 0.8, motion: 'bidirectional', scale: 'swell', trail: false, opacity: 'steady' },
  modality: { count: 4, speedMultiplier: 0.5, motion: 'stepping', scale: 'uniform', trail: false, opacity: 'steady' },
  connective: { count: 5, speedMultiplier: 1.3, motion: 'continuous', scale: 'swell', trail: true, opacity: 'steady' },
  disjunctive: { count: 3, speedMultiplier: 1.1, motion: 'wobble', scale: 'uniform', trail: false, opacity: 'steady' },
  conjunctive: { count: 4, speedMultiplier: 0.7, motion: 'continuous', scale: 'grow', trail: false, opacity: 'steady' },
}

function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function random01(seed: number): number {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) % 10000) / 10000
}

function resolveNodes(nodes: readonly MnGraphThreeNode[], edges: readonly MnGraphThreeEdge[]): MnGraphThreeNode[] {
  const byId = new Map<string, MnGraphThreeNode>()
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  for (const edge of edges) {
    if (!byId.has(edge.from)) byId.set(edge.from, { id: edge.from })
    if (!byId.has(edge.to)) byId.set(edge.to, { id: edge.to })
  }
  return [...byId.values()]
}

function forceLayout(nodes: readonly MnGraphThreeNode[], edges: readonly MnGraphThreeEdge[]): Map<string, LayoutPoint> {
  const points = new Map<string, LayoutPoint>()
  const count = Math.max(1, nodes.length)
  const startRadius = Math.max(1.1, Math.sqrt(count) * 0.86)
  nodes.forEach((node, index) => {
    const seed = hash(node.id)
    const angle = (index / count) * Math.PI * 2 + random01(seed) * 0.45
    points.set(node.id, {
      x: Math.cos(angle) * startRadius * (0.75 + random01(seed + 17) * 0.5),
      y: Math.sin(angle) * startRadius * (0.75 + random01(seed + 31) * 0.5),
    })
  })

  const velocities = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]))
  const validEdges = edges.filter((edge) => points.has(edge.from) && points.has(edge.to) && edge.from !== edge.to)
  for (let step = 0; step < 240; step += 1) {
    const temperature = 0.12 * (1 - step / 240)
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = points.get(nodes[i].id)!
        const b = points.get(nodes[j].id)!
        const av = velocities.get(nodes[i].id)!
        const bv = velocities.get(nodes[j].id)!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = 0.1 + random01(hash(nodes[i].id + nodes[j].id)) * 0.1
          dy = 0.1
          d2 = dx * dx + dy * dy
        }
        const force = 0.095 / d2
        av.x += dx * force
        av.y += dy * force
        bv.x -= dx * force
        bv.y -= dy * force
      }
    }

    for (const edge of validEdges) {
      const a = points.get(edge.from)!
      const b = points.get(edge.to)!
      const av = velocities.get(edge.from)!
      const bv = velocities.get(edge.to)!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.max(0.001, Math.hypot(dx, dy))
      const desired = edge.kind === 'wire' ? 1.55 : 1.9
      const pull = (distance - desired) * 0.018
      const fx = (dx / distance) * pull
      const fy = (dy / distance) * pull
      av.x += fx
      av.y += fy
      bv.x -= fx
      bv.y -= fy
    }

    for (const node of nodes) {
      const p = points.get(node.id)!
      const v = velocities.get(node.id)!
      v.x += -p.x * 0.004
      v.y += -p.y * 0.004
      p.x += v.x * temperature
      p.y += v.y * temperature
      v.x *= 0.76
      v.y *= 0.76
    }
  }

  if (nodes.length === 1) points.set(nodes[0].id, { x: 0, y: 0 })
  return points
}

function edgeParentMap(
  nodes: readonly MnGraphThreeNode[],
  edges: readonly MnGraphThreeEdge[],
): Map<string, string> {
  const ids = new Set(nodes.map((node) => node.id))
  const parents = new Map<string, string>()
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue
    const predicate = edge.predicate.split(/[\/#:]/).pop()?.toLowerCase() ?? ''
    if ((predicate === 'contains' || predicate === 'parent') && edge.from !== edge.to) {
      parents.set(edge.to, edge.from)
    } else if (predicate === 'partof' && edge.from !== edge.to) {
      parents.set(edge.from, edge.to)
    }
  }
  for (const node of nodes) {
    if (node.parentId && ids.has(node.parentId) && node.parentId !== node.id && !parents.has(node.id)) {
      parents.set(node.id, node.parentId)
    }
  }
  return parents
}

function leafCount(
  id: string,
  children: ReadonlyMap<string, readonly string[]>,
  trail: ReadonlySet<string> = new Set(),
): number {
  if (trail.has(id)) return 1
  const descendants = children.get(id) ?? []
  if (descendants.length === 0) return 1
  const nextTrail = new Set(trail)
  nextTrail.add(id)
  return descendants.reduce((sum, child) => sum + leafCount(child, children, nextTrail), 0)
}

/** Deterministic controlled counterpart of Garden's weighted radial workspace layout. */
export function layoutGardenWorkspace(
  nodes: readonly MnGraphThreeNode[],
  edges: readonly MnGraphThreeEdge[],
): Map<string, MnGraphThreePoint> {
  const positions = new Map<string, MnGraphThreePoint>()
  if (nodes.length === 0) return positions
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const parents = edgeParentMap(nodes, edges)
  const children = new Map<string, string[]>()
  for (const node of nodes) children.set(node.id, [])
  for (const [child, parent] of parents) children.get(parent)?.push(child)

  const graphRoots = nodes.filter((node) => node.kind === 'graph')
  for (const root of graphRoots) positions.set(root.id, { x: 0, y: 1.15, z: 0 })

  const graphChildIds = new Set(graphRoots.flatMap((root) => children.get(root.id) ?? []))
  const roots = nodes
    .filter((node) => node.kind !== 'graph' && (!parents.has(node.id) || graphChildIds.has(node.id)))
    .map((node) => node.id)
  const totalNodeCount = Math.max(1, nodes.length - graphRoots.length)
  const spreadFactor = Math.max(1, Math.sqrt(totalNodeCount / 8)) * WORKSPACE_SPREAD_SCALE
  const visited = new Set<string>()

  const place = (
    ids: readonly string[],
    startAngle: number,
    endAngle: number,
    depth: number,
    parentPosition: MnGraphThreePoint | null,
  ): void => {
    const candidates = ids.filter((id) => !visited.has(id) && byId.has(id))
    if (candidates.length === 0) return
    const weights = candidates.map((id) => Math.pow(Math.max(1, leafCount(id, children)), 0.6))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let cumulative = 0
    candidates.forEach((id, index) => {
      visited.add(id)
      const sliceStart = startAngle + (cumulative / totalWeight) * (endAngle - startAngle)
      cumulative += weights[index]
      const sliceEnd = startAngle + (cumulative / totalWeight) * (endAngle - startAngle)
      const sliceWidth = sliceEnd - sliceStart
      const jitter = (random01(hash(id)) - 0.5) * Math.min(sliceWidth * 0.25, 0.2)
      const angle = (sliceStart + sliceEnd) / 2 + jitter
      const baseRadius = (WORKSPACE_BASE_RING_RADIUS + depth * WORKSPACE_RING_RADIUS_STEP) * spreadFactor
      const radius = baseRadius + (random01(hash(id) + 1) - 0.5) * 0.4
      const point = {
        x: Math.cos(angle) * radius + (parentPosition?.x ?? 0),
        y: -depth * WORKSPACE_RING_VERTICAL_DROP +
          (random01(hash(id) + 2) - 0.5) * WORKSPACE_RING_VERTICAL_JITTER,
        z: Math.sin(angle) * radius + (parentPosition?.z ?? 0),
      }
      positions.set(id, point)
      const padding = sliceWidth * 0.1
      place(children.get(id) ?? [], sliceStart + padding, sliceEnd - padding, depth + 1, point)
    })
  }

  place(roots, 0, Math.PI * 2, 0, { x: 0, y: 0, z: 0 })
  const stragglers = nodes.filter((node) => node.kind !== 'graph' && !visited.has(node.id)).map((node) => node.id)
  place(stragglers, 0, Math.PI * 2, 0, { x: 0, y: 0, z: 0 })
  return positions
}

/** Fixed-radius document helix with cross-document portals fanned outside it. */
export function layoutGardenDocument(nodes: readonly MnGraphThreeNode[]): Map<string, MnGraphThreePoint> {
  const positions = new Map<string, MnGraphThreePoint>()
  const blocks = nodes
    .filter((node) => node.kind !== 'portal')
    .map((node, index) => ({ node, index }))
    .sort((a, b) => (a.node.order ?? a.index) - (b.node.order ?? b.index))
  const angleStep = (Math.PI * 2) / 12
  blocks.forEach(({ node }, index) => {
    const angle = index * angleStep
    positions.set(node.id, {
      x: HELIX_RADIUS * Math.cos(angle),
      y: index === 0 ? 0 : -index * 0.28,
      z: HELIX_RADIUS * Math.sin(angle),
    })
  })

  const portalsByAnchor = new Map<string, MnGraphThreeNode[]>()
  const fallbackAnchor = blocks[0]?.node.id ?? ''
  for (const portal of nodes.filter((node) => node.kind === 'portal')) {
    const anchor = portal.parentId && positions.has(portal.parentId) ? portal.parentId : fallbackAnchor
    const group = portalsByAnchor.get(anchor) ?? []
    group.push(portal)
    portalsByAnchor.set(anchor, group)
  }
  for (const [anchorId, portals] of portalsByAnchor) {
    const anchor = positions.get(anchorId) ?? { x: HELIX_RADIUS, y: 0, z: 0 }
    const baseAngle = Math.atan2(anchor.z, anchor.x)
    portals.forEach((portal, index) => {
      const offset = portals.length === 1 ? 0 : (index / (portals.length - 1) - 0.5) * Math.PI * 0.35
      const angle = baseAngle + offset
      positions.set(portal.id, {
        x: Math.cos(angle) * (HELIX_RADIUS + 3.5),
        y: anchor.y,
        z: Math.sin(angle) * (HELIX_RADIUS + 3.5),
      })
    })
  }
  return positions
}

function layoutForView(
  nodes: readonly MnGraphThreeNode[],
  edges: readonly MnGraphThreeEdge[],
  dimension: MnGraphThreeDimension,
  viewMode: MnGraphThreeViewMode,
): Map<string, LayoutPoint> {
  if (dimension === '2d') {
    const points = forceLayout(nodes, edges)
    for (const point of points.values()) point.z = 0
    return points
  }
  return viewMode === 'document'
    ? layoutGardenDocument(nodes)
    : layoutGardenWorkspace(nodes, edges)
}

export function wireCategoryForPredicate(predicate: string): WireCategory {
  const fragment = predicate.split(/[\/#:]/).pop() ?? predicate
  return PREDICATE_CATEGORIES[fragment] ?? 'default'
}

function curveFor(
  edge: MnGraphThreeEdge,
  positions: Map<string, LayoutPoint>,
  edgeIndex: number,
  viewMode: MnGraphThreeViewMode,
  nodes: ReadonlyMap<string, MnGraphThreeNode>,
): THREE.CubicBezierCurve3 | null {
  const source = positions.get(edge.from)
  const target = positions.get(edge.to)
  if (!source || !target) return null
  const sourceZ = source.z ?? 0
  const targetZ = target.z ?? 0
  if (edge.from === edge.to) {
    const r = NODE_RADIUS * 2.5
    return new THREE.CubicBezierCurve3(
      new THREE.Vector3(source.x + NODE_RADIUS, source.y, sourceZ),
      new THREE.Vector3(source.x + r, source.y + r, sourceZ + 0.2),
      new THREE.Vector3(source.x - r, source.y + r, sourceZ + 0.2),
      new THREE.Vector3(source.x - NODE_RADIUS, source.y, sourceZ),
    )
  }
  const from = new THREE.Vector3(source.x, source.y, sourceZ)
  const to = new THREE.Vector3(target.x, target.y, targetZ)
  const delta = to.clone().sub(from)
  const distance = Math.max(0.001, delta.length())
  const start = from.clone().add(delta.clone().normalize().multiplyScalar(NODE_RADIUS))
  const end = to.clone().add(delta.clone().normalize().multiplyScalar(-NODE_RADIUS))

  if (edge.kind === 'wire') {
    const seed = hash(`${edge.id ?? ''}|${edge.from}|${edge.predicate}|${edge.to}|${edgeIndex}`)
    const jitterA = (random01(seed + 10) - 0.5) * distance * 0.25
    const jitterB = (random01(seed + 11) - 0.5) * distance * 0.25
    const portal = nodes.get(edge.from)?.kind === 'portal' || nodes.get(edge.to)?.kind === 'portal'
    if (viewMode === 'document' && !portal) {
      const midY = (start.y + end.y) / 2
      return new THREE.CubicBezierCurve3(
        start,
        new THREE.Vector3(start.x * 0.15 + jitterA, midY, start.z * 0.15 + jitterB),
        new THREE.Vector3(end.x * 0.15 - jitterB, midY, end.z * 0.15 - jitterA),
        end,
      )
    }
    if (viewMode === 'document' && portal) {
      const radial = new THREE.Vector3(start.x, 0, start.z).normalize()
      const tangent = new THREE.Vector3(-radial.z, 0, radial.x)
      const sign = random01(seed + 12) > 0.5 ? 1 : -1
      const mid = start.clone().lerp(end, 0.5)
      const bow = distance * 0.55 * sign
      const first = mid.clone().addScaledVector(tangent, bow + jitterA * 0.2)
      const second = mid.clone().addScaledVector(tangent, bow - jitterB * 0.2)
      first.y += distance * 0.18
      second.y += distance * 0.18
      return new THREE.CubicBezierCurve3(start, first, second, end)
    }
    const dipY = Math.min(start.y, end.y) - distance * 0.2
    return new THREE.CubicBezierCurve3(
      start,
      new THREE.Vector3(start.x + delta.x * 0.33 + jitterA, dipY, start.z + delta.z * 0.33 + jitterB),
      new THREE.Vector3(start.x + delta.x * 0.66 - jitterB, dipY, start.z + delta.z * 0.66 - jitterA),
      end,
    )
  }

  const lift = Math.max(0.12, distance * 0.15)
  return new THREE.CubicBezierCurve3(
    start,
    from.clone().lerp(to, 0.34).add(new THREE.Vector3(0, lift, 0)),
    from.clone().lerp(to, 0.66).add(new THREE.Vector3(0, lift, 0)),
    end,
  )
}

function cssColorToHex(value: string, fallback: number): number {
  const color = value.trim()
  if (!color) return fallback
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const raw = hex[1]
    const expanded = raw.length === 3 ? raw.split('').map((c) => `${c}${c}`).join('') : raw
    return Number.parseInt(expanded, 16)
  }
  const rgb = color.match(/rgba?\(([^)]+)\)/i)
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()))
    if ([r, g, b].every((n) => Number.isFinite(n))) return (r << 16) + (g << 8) + b
  }
  return fallback
}

function cssColorString(value: string, fallback: string): string {
  const color = value.trim()
  return color && !color.startsWith('color-mix(') ? color : fallback
}

@customElement('mn-graph-three')
export class MnGraphThree extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      min-width: 0;
      min-height: 240px;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .shell {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: inherit;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #d8e2dc);
      border-radius: var(--mn-radius-surface, 8px);
      background:
        radial-gradient(circle at 14% 18%, rgba(184, 209, 146, 0.1), transparent 30%),
        #2a3328;
      box-sizing: border-box;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal-backdrop, 1300);
      background: rgba(8, 13, 18, 0.48);
      backdrop-filter: blur(2px);
    }

    :host([data-fullscreen]) .shell {
      position: fixed;
      inset: clamp(10px, 3vw, 28px);
      z-index: var(--mn-z-modal, 1400);
      width: auto;
      height: auto;
      min-height: 0;
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #2f7d5f));
      box-shadow: var(--mn-shadow-modal, 0 24px 72px rgba(15, 23, 42, 0.36));
    }

    .stage {
      position: absolute;
      inset: 0;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      touch-action: none;
    }

    .stage canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .labels {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .accessible-nodes {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .accessible-nodes ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .node-label-overlay {
      position: absolute;
      max-width: 18ch;
      padding: 3px 6px;
      border: 1px solid color-mix(in srgb, var(--mn-color-border-subtle, #d8e2dc) 72%, transparent);
      border-radius: var(--mn-radius-control, 6px);
      background: color-mix(in srgb, var(--mn-color-surface-raised, #fff) 86%, transparent);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
      translate: -50% -50%;
      user-select: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    .node-label-overlay.selected {
      opacity: 1;
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #2f7d5f));
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2f7d5f));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 18%, transparent);
    }

    .headless {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: var(--mn-space-6, 24px);
      color: #d4e4be;
      font-size: var(--mn-text-xs, 12px);
      text-align: center;
      pointer-events: none;
    }

    .headless:empty {
      display: none;
    }

    .graph-tool {
      position: absolute;
      z-index: 2;
      top: 8px;
      right: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid var(--mn-color-border-subtle, #d8e2dc);
      border-radius: var(--mn-radius-control, 6px);
      background: rgba(26, 31, 24, 0.78);
      color: #d4e4be;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
    }

    .graph-tool:hover,
    .graph-tool:focus-visible {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #2f7d5f));
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2f7d5f));
      outline: none;
    }

    .node-tooltip {
      position: absolute;
      z-index: 8;
      max-width: min(280px, calc(100% - 24px));
      padding: 8px 10px;
      border: 1px solid rgba(184, 209, 146, 0.42);
      border-radius: 7px;
      background: rgba(26, 31, 24, 0.94);
      color: #f8faf5;
      font-size: 12px;
      line-height: 1.35;
      box-shadow: 0 9px 24px rgba(0, 0, 0, 0.28);
      pointer-events: none;
      transform: translate(12px, 12px);
    }

    .tooltip-kind {
      margin-bottom: 2px;
      color: #b8d192;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .node-card {
      position: absolute;
      z-index: 9;
      width: min(270px, calc(100% - 16px));
      padding: 14px;
      border: 1px solid rgba(184, 209, 146, 0.52);
      border-radius: 10px;
      background: rgba(31, 38, 29, 0.97);
      color: #f8faf5;
      box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    }

    .node-card header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }

    .node-card .badge {
      color: #b8d192;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .node-card h3 {
      margin: 0;
      font: 600 17px/1.25 var(--mn-font-prose, Georgia, serif);
    }

    .node-card blockquote {
      margin: 10px 0;
      padding-left: 10px;
      border-left: 2px solid rgba(184, 209, 146, 0.5);
      color: #d4e4be;
      font: 12px/1.45 var(--mn-font-prose, Georgia, serif);
    }

    .card-close,
    .card-open,
    .edge-nav {
      border: 1px solid rgba(184, 209, 146, 0.42);
      background: rgba(90, 104, 88, 0.38);
      color: #f8faf5;
      cursor: pointer;
    }

    .card-close {
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }

    .card-open {
      width: 100%;
      margin-top: 12px;
      padding: 8px 10px;
      border-radius: 6px;
      font-weight: 700;
    }

    .edge-nav {
      position: absolute;
      z-index: 7;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      font-size: 17px;
    }

    :host([data-skin='emporium']) .shell {
      border-radius: var(--mn-radius-none, 0);
    }
  `

  /** Same graph node contract as mn-graph. */
  @property({ attribute: false }) nodes: MnGraphThreeNode[] = []
  /** Same directed edge contract as mn-graph. */
  @property({ attribute: false }) edges: MnGraphThreeEdge[] = []
  /** Raycast nodes and emit `mn-graph-node-select` when a node is activated. */
  @property({ type: Boolean }) interactive = false
  /** Enable Garden-style low-motion wire particles. */
  @property({ type: Boolean }) animated = true
  /** Show an icon-only control that expands the graph into a full-screen modal. */
  @property({ type: Boolean }) fullscreenable = false
  /** Accessible label for the figure. */
  @property({ type: String }) hint = ''
  /** Top-down compatibility view or the Garden perspective scene. */
  @property({ type: String }) dimension: MnGraphThreeDimension = '3d'
  /** Whole-workspace hierarchy or the active document's block helix. */
  @property({ type: String, attribute: 'view-mode', reflect: true }) viewMode: MnGraphThreeViewMode = 'workspace'
  /** Shell-owned editor/graph selection reflected into the scene. */
  @property({ type: String, attribute: 'selected-node-id' }) selectedNodeId = ''

  @state() private _fullscreen = false
  @state() private _tooltip: { x: number; y: number; label: string; kind: string } | null = null
  @state() private _expanded: { node: MnGraphThreeNode; x: number; y: number } | null = null
  @state() private _edgeZone: string | null = null

  private _stage: HTMLDivElement | null = null
  private _renderer: THREE.WebGLRenderer | null = null
  private _scene: THREE.Scene | null = null
  private _camera: THREE.PerspectiveCamera | null = null
  private _controls: OrbitControls | null = null
  private _raycaster = new THREE.Raycaster()
  private _nodeViews = new Map<string, NodeView>()
  private _edgeViews: EdgeView[] = []
  private _labels: HTMLDivElement | null = null
  private _resizeObserver: ResizeObserver | null = null
  private _raf = 0
  private _clock = new THREE.Clock()
  private _hoveredNodeId = ''
  private _hoveredEdgeId = ''
  private _dragStart: { x: number; y: number } | null = null
  private _dragging = false
  private _cameraFocusTarget: THREE.Vector3 | null = null
  private _selectedNodeId = ''
  private _edgePanTimer = 0
  private _sceneSignature = ''
  private _webGLAvailable: boolean | null = null

  protected firstUpdated(): void {
    this._sceneSignature = this._currentSceneSignature()
    this._rebuild(true)
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.addEventListener('keydown', this._onDocumentKeyDown)
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('nodes') || changed.has('edges') || changed.has('dimension') || changed.has('viewMode')) {
      this._tooltip = null
    }
    if (changed.has('dimension') || changed.has('viewMode')) {
      this._expanded = null
    } else if ((changed.has('nodes') || changed.has('edges')) && this._expanded) {
      const replacement = resolveNodes(this.nodes, this.edges).find((node) => node.id === this._expanded?.node.id)
      this._expanded = replacement ? { ...this._expanded, node: replacement } : null
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('hint')) {
      this.renderRoot.querySelector('.stage')?.setAttribute('aria-label', this.hint || 'Graph network')
    }
    if (changed.has('nodes') || changed.has('edges') || changed.has('dimension') || changed.has('viewMode')) {
      const signature = this._currentSceneSignature()
      if (signature !== this._sceneSignature) {
        this._sceneSignature = signature
        this._rebuild(changed.has('dimension') || changed.has('viewMode'))
      }
    }
    if (changed.has('animated')) this._syncAnimation()
    if (changed.has('selectedNodeId')) {
      this._selectedNodeId = this.selectedNodeId
      this._refreshHighlights()
      this._renderFrame()
    }
  }

  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('keydown', this._onDocumentKeyDown)
    this._cleanup()
    super.disconnectedCallback()
  }

  private _hasWebGL(): boolean {
    try {
      const canvas = document.createElement('canvas')
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
    } catch {
      return false
    }
  }

  private _supportsWebGL(): boolean {
    if (this._webGLAvailable == null) this._webGLAvailable = this._hasWebGL()
    return this._webGLAvailable
  }

  private _currentSceneSignature(): string {
    return JSON.stringify({
      nodes: this.nodes,
      edges: this.edges,
      dimension: this.dimension,
      viewMode: this.viewMode,
    })
  }

  private _palette(): Palette {
    const style = getComputedStyle(this)
    const accent = style.getPropertyValue('--mn-color-accent')
    const accentStrong = style.getPropertyValue('--mn-color-text-accent-strong')
    const border = style.getPropertyValue('--mn-color-border-accent')
    const surface = style.getPropertyValue('--mn-color-surface-raised')
    const text = style.getPropertyValue('--mn-color-text-primary')
    const muted = style.getPropertyValue('--mn-color-text-tertiary')
    return {
      accent: cssColorToHex(accent, 0x2f7d5f),
      accentStrong: cssColorToHex(accentStrong, 0x1f553f),
      border: cssColorToHex(border, 0x89b99f),
      surface: cssColorToHex(surface, 0xffffff),
      text: cssColorString(text, '#111827'),
      muted: cssColorString(muted, '#6b7280'),
      wire: 0xc99a3a,
    }
  }

  private _setHeadless(message: string): void {
    const fallback = this.renderRoot.querySelector<HTMLElement>('.headless')
    if (fallback && fallback.textContent !== message) fallback.textContent = message
  }

  private _rebuild(recenter = false): void {
    this._stage = this.renderRoot?.querySelector('.stage') as HTMLDivElement | null
    if (!this._stage) return

    const resolvedNodes = resolveNodes(this.nodes, this.edges)
    if (!resolvedNodes.length) {
      this._cleanup()
      this._setHeadless('No graph nodes.')
      return
    }
    if (!this._supportsWebGL()) {
      this._cleanup()
      this._setHeadless('Three.js graph renderer is waiting for WebGL in this environment.')
      return
    }
    this._setHeadless('')

    const palette = this._palette()
    const initialized = this._ensureRenderer()
    if (!initialized) return
    this._clearScene()

    this._scene = new THREE.Scene()
    this._scene.background = new THREE.Color(GARDEN_BACKGROUND)
    this._scene.fog = new THREE.Fog(GARDEN_BACKGROUND, 40, 100)

    this._scene.add(new THREE.AmbientLight(0xffffff, 1.8))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(5, 10, 5)
    this._scene.add(key)
    const rim = new THREE.DirectionalLight(0xffffff, 0.85)
    rim.position.set(-5, 3, -8)
    this._scene.add(rim)
    this._createBackgroundTexture()

    this._syncControlsForView()

    const positions = layoutForView(resolvedNodes, this.edges, this._dimension(), this.viewMode)
    this._buildEdges(positions)
    this._buildNodes(resolvedNodes, positions, palette)
    this._resize()
    if (recenter) this.recenter()
    else this._renderFrame()
    this._syncAnimation()
  }

  private _ensureRenderer(): boolean {
    if (this._renderer && this._camera && this._controls && this._labels) return true
    if (!this._stage) return false
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      })
    } catch {
      this._setHeadless('Three.js graph renderer is waiting for WebGL in this environment.')
      return false
    }
    renderer.setClearColor(GARDEN_BACKGROUND, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.setAttribute('aria-hidden', 'true')
    this._stage.appendChild(renderer.domElement)
    this._renderer = renderer

    const labels = document.createElement('div')
    labels.className = 'labels'
    this._stage.appendChild(labels)
    this._labels = labels

    this._camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    this._camera.position.set(0, 14, 18)
    this._controls = new OrbitControls(this._camera, renderer.domElement)
    this._controls.enableDamping = true
    this._controls.dampingFactor = 0.05
    this._controls.enablePan = true
    this._controls.autoRotateSpeed = 0.08
    this._syncControlsForView()
    this._installEvents(renderer.domElement)
    this._resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this._resize())
      : null
    this._resizeObserver?.observe(this._stage)
    this._clock.start()
    return true
  }

  private _syncControlsForView(): void {
    if (!this._controls) return
    this._controls.minDistance = this.viewMode === 'document' ? 2 : 5
    this._controls.maxDistance = this.viewMode === 'document' ? 60 : 35
    this._controls.maxPolarAngle = this.viewMode === 'document' ? Math.PI : Math.PI * 0.8
    this._controls.autoRotate = this.animated && this.viewMode === 'workspace'
  }

  private _syncAnimation(): void {
    if (this._controls) this._controls.autoRotate = this.animated && this.viewMode === 'workspace'
    if (!this.animated && this._raf) {
      window.cancelAnimationFrame(this._raf)
      this._raf = 0
    }
    if (this.animated && this._renderer && this._scene && this._camera && !this._raf) this._tick()
    else this._renderFrame()
  }

  private _createBackgroundTexture(): void {
    if (!this._scene) return
    const count = 200
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3
      const radius = 15 + random01(index * 13 + 7) * 25
      const theta = random01(index * 17 + 3) * Math.PI * 2
      const phi = Math.acos(2 * random01(index * 19 + 11) - 1)
      positions[offset] = radius * Math.sin(phi) * Math.cos(theta)
      positions[offset + 1] = radius * Math.sin(phi) * Math.sin(theta) - 5
      positions[offset + 2] = radius * Math.cos(phi)
      const brightness = 0.25 + random01(index * 23 + 5) * 0.15
      colors[offset] = brightness * 0.85
      colors[offset + 1] = brightness
      colors[offset + 2] = brightness * 0.75
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this._scene.add(new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.08,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true,
      }),
    ))
  }

  private _nodeShape(node: MnGraphThreeNode, palette: Palette): {
    geometry: THREE.BufferGeometry
    color: number
    radius: number
    scale: THREE.Vector3
    rotation: THREE.Euler
    wireframe?: boolean
    opacity?: number
  } {
    const kind = node.kind ?? 'unknown'
    const scale = new THREE.Vector3(1, 1, 1)
    const rotation = new THREE.Euler()
    let radius = NODE_RADIUS
    let geometry: THREE.BufferGeometry
    let color = GARDEN_STONE
    let wireframe = false
    let opacity = 1

    if (this._dimension() === '2d') {
      return {
        geometry: new THREE.CircleGeometry(radius, 40),
        color: kind === 'graph' ? palette.accent : GARDEN_PARCHMENT,
        radius,
        scale,
        rotation,
      }
    }

    if (this.viewMode === 'workspace') {
      if (kind === 'folder') {
        radius = 0.46
        geometry = new THREE.TorusGeometry(radius * 0.62, radius * 0.24, 10, 20)
        rotation.x = -Math.PI * 0.35
        rotation.z = random01(hash(node.id) + 50) * 0.3 - 0.15
        color = 0x9cbd6a
      } else if (kind === 'artifact') {
        geometry = new THREE.IcosahedronGeometry(radius * 0.8, 0)
        rotation.set(
          random01(hash(node.id) + 52) * Math.PI * 2,
          random01(hash(node.id) + 53) * Math.PI * 2,
          random01(hash(node.id) + 54) * Math.PI * 2,
        )
        color = node.documentId || node.ingestedDocumentId ? 0x9cbd6a : 0xb8d192
      } else if (kind === 'graph') {
        radius = 0.42
        geometry = new THREE.DodecahedronGeometry(radius, 0)
        color = palette.accent
      } else if (kind === 'tag') {
        geometry = new THREE.TetrahedronGeometry(radius * 0.72, 0)
        color = 0xd4e4be
      } else if (kind === 'read-only-document' || node.readOnly) {
        geometry = new THREE.SphereGeometry(radius * 0.75, 16, 12)
        scale.set(0.9, 0.6, 1)
        color = 0xd4e4be
        opacity = 0.72
      } else {
        geometry = new THREE.BoxGeometry(radius * 1.1, radius * 0.2, radius * 1.4)
        rotation.y = random01(hash(node.id) + 50) * Math.PI * 0.4 - 0.2
        rotation.z = (random01(hash(node.id) + 51) - 0.5) * 0.12
        color = GARDEN_PARCHMENT
      }
    } else if (kind === 'heading') {
      radius = 0.5
      geometry = new THREE.SphereGeometry(radius, 16, 16)
      scale.set(1, 0.7, 0.6)
      color = 0xb8d192
    } else if (kind === 'paragraph') {
      geometry = new THREE.SphereGeometry(radius * 0.8, 12, 12)
      scale.set(1.1, 0.8, 1)
      color = GARDEN_PARCHMENT
    } else if (kind === 'bullet') {
      geometry = new THREE.SphereGeometry(radius * 0.5, 12, 12)
      color = 0x9cbd6a
    } else if (kind === 'ordered') {
      geometry = new THREE.SphereGeometry(radius * 0.55, 12, 12)
      color = 0x7fa647
    } else if (kind === 'task') {
      geometry = new THREE.OctahedronGeometry(radius * 0.55, 0)
      color = node.checked ? 0x658538 : 0xb8d192
    } else if (kind === 'blockquote') {
      geometry = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.15, 16)
      color = 0xd4e4be
    } else if (kind === 'code') {
      geometry = new THREE.BoxGeometry(radius, radius * 0.3, radius * 0.7)
      color = 0x5a6858
    } else if (kind === 'footnote') {
      geometry = new THREE.SphereGeometry(radius * 0.35, 12, 12)
      scale.set(0.8, 1.2, 0.8)
      color = 0xd4e4be
    } else if (kind === 'portal') {
      geometry = new THREE.SphereGeometry(radius * 0.75, 12, 12)
      color = GARDEN_PARCHMENT
      wireframe = true
      opacity = 0.42
    } else if (kind === 'image') {
      geometry = new THREE.BoxGeometry(radius * 1.15, radius * 0.12, radius * 0.9)
      color = 0xd4e4be
    } else if (kind === 'math') {
      geometry = new THREE.DodecahedronGeometry(radius * 0.65, 0)
      color = 0x9a8bb0
    } else if (kind === 'table') {
      geometry = new THREE.BoxGeometry(radius * 0.9, radius * 0.18, radius * 0.9)
      color = 0x8ba5b8
    } else if (kind === 'query') {
      geometry = new THREE.ConeGeometry(radius * 0.55, radius, 8)
      color = 0xa3b87a
    } else if (kind === 'horizontal-rule') {
      geometry = new THREE.BoxGeometry(radius * 1.3, radius * 0.08, radius * 0.08)
      color = 0x8a9180
    } else {
      geometry = new THREE.SphereGeometry(radius * 0.6, 12, 12)
      color = GARDEN_STONE
    }
    return { geometry, color, radius, scale, rotation, wireframe, opacity }
  }

  private _buildNodes(nodes: readonly MnGraphThreeNode[], positions: Map<string, LayoutPoint>, palette: Palette): void {
    const scene = this._scene!
    const wiredCategories = new Map<string, WireCategory>()
    for (const edge of this.edges) {
      if (edge.kind !== 'wire') continue
      const category = edge.category ?? wireCategoryForPredicate(edge.predicate)
      if (!wiredCategories.has(edge.from)) wiredCategories.set(edge.from, category)
      if (!wiredCategories.has(edge.to)) wiredCategories.set(edge.to, category)
    }
    for (const node of nodes) {
      const point = positions.get(node.id) ?? { x: 0, y: 0 }
      const shape = this._nodeShape(node, palette)
      const group = new THREE.Group()
      group.position.set(point.x, point.y, (point.z ?? 0) + 0.02)
      group.rotation.copy(shape.rotation)
      group.scale.copy(shape.scale)
      const hit = new THREE.Mesh(
        shape.geometry,
        new THREE.MeshToonMaterial({
          color: shape.color,
          transparent: (shape.opacity ?? 1) < 1,
          opacity: shape.opacity ?? 1,
          wireframe: shape.wireframe ?? false,
        }),
      )
      hit.userData = { nodeId: node.id }
      group.add(hit)
      const wiredCategory = wiredCategories.get(node.id)
      if (wiredCategory) {
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(shape.radius * 1.1, shape.radius * 1.28, 32),
          new THREE.MeshBasicMaterial({
            color: WIRE_COLORS[wiredCategory],
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
          }),
        )
        halo.rotation.x = Math.PI / 2
        group.add(halo)
      }
      if (node.kind === 'document' || node.kind === 'code' || node.kind === 'image') {
        hit.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(shape.geometry, 20),
          new THREE.LineBasicMaterial({ color: 0x2a2f29, transparent: true, opacity: 0.62 }),
        ))
      }
      scene.add(group)

      const label = document.createElement('div')
      label.className = 'node-label-overlay'
      label.dataset.nodeId = node.id
      label.textContent = node.label ?? node.id
      label.title = node.note ?? node.label ?? node.id
      label.style.color = '#f8faf5'
      this._labels?.appendChild(label)

      this._nodeViews.set(node.id, {
        node,
        group,
        hit,
        label,
        radius: shape.radius,
        basePosition: group.position.clone(),
        baseScale: shape.scale.clone(),
        baseColor: shape.color,
      })
    }
    this._refreshHighlights()
  }

  private _buildEdges(positions: Map<string, LayoutPoint>): void {
    const scene = this._scene!
    const nodes = new Map(resolveNodes(this.nodes, this.edges).map((node) => [node.id, node] as const))
    this.edges.forEach((edge, index) => {
      const curve = curveFor(edge, positions, index, this.viewMode, nodes)
      if (!curve) return
      const category = edge.category ?? wireCategoryForPredicate(edge.predicate)
      const color = edge.kind === 'wire' ? WIRE_COLORS[category] : GARDEN_STONE
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: edge.kind === 'wire' ? 0.55 : 0.48,
      })
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, edge.kind === 'wire' ? 28 : 16, edge.kind === 'wire' ? 0.028 : 0.007, 6, false),
        material,
      )
      const edgeId = edge.id ?? `${edge.kind ?? 'predicate'}:${edge.from}:${edge.predicate}:${edge.to}:${index}`
      tube.userData = { edgeId, edge }
      scene.add(tube)

      const hit = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, edge.kind === 'wire' ? 0.11 : 0.055, 6, false),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      )
      hit.userData = { edgeId, edge }
      scene.add(hit)

      if (edge.kind === 'wire' && !edge.bidirectional) {
        const arrowPoint = curve.getPointAt(edge.kind === 'wire' ? 0.85 : 0.92)
        const tangent = curve.getTangentAt(edge.kind === 'wire' ? 0.85 : 0.92).normalize()
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(edge.kind === 'wire' ? 0.035 : 0.025, edge.kind === 'wire' ? 0.085 : 0.06, 5),
          material.clone(),
        )
        arrow.position.copy(arrowPoint)
        arrow.setRotationFromQuaternion(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent),
        )
        scene.add(arrow)
      }

      const behavior = CATEGORY_PARTICLES[category]
      const particleCount = edge.kind === 'wire' ? behavior.count : 0
      const particles: THREE.Mesh[] = []
      const particleOffsets: number[] = []
      const particleTrails: THREE.Mesh[][] = []
      for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
        const particle = new THREE.Mesh(
          this._particleGeometry(category),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
        )
        scene.add(particle)
        particles.push(particle)
        particleOffsets.push(particleIndex / Math.max(1, particleCount))
        const trails: THREE.Mesh[] = []
        if (behavior.trail) {
          for (let trailIndex = 1; trailIndex <= 3; trailIndex += 1) {
            const trail = new THREE.Mesh(
              this._particleGeometry(category),
              new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.8 * (1 - trailIndex * 0.25),
              }),
            )
            trail.scale.setScalar(1 - trailIndex * 0.2)
            scene.add(trail)
            trails.push(trail)
          }
        }
        particleTrails.push(trails)
      }
      this._edgeViews.push({
        id: edgeId,
        edge,
        curve,
        material,
        hit,
        particles,
        particleOffsets,
        particleTrails,
        speed: edge.kind === 'wire' ? 0.055 * behavior.speedMultiplier : 0,
        category,
      })
    })
  }

  private _particleGeometry(category: WireCategory): THREE.BufferGeometry {
    if (category === 'quality') return new THREE.OctahedronGeometry(0.022, 0)
    if (category === 'quantity') return new THREE.CylinderGeometry(0.022, 0.022, 0.007, 8)
    if (category === 'disjunctive') return new THREE.TetrahedronGeometry(0.022, 0)
    return new THREE.SphereGeometry(0.022, 6, 6)
  }

  private _installEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', this._onPointerDown)
    canvas.addEventListener('pointermove', this._onPointerMove)
    canvas.addEventListener('pointerup', this._onPointerUp)
    canvas.addEventListener('pointercancel', this._onPointerUp)
    canvas.addEventListener('dblclick', this._onDoubleClick)
    canvas.addEventListener('mouseleave', this._onPointerLeave)
  }

  private _removeEvents(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('pointerdown', this._onPointerDown)
    canvas.removeEventListener('pointermove', this._onPointerMove)
    canvas.removeEventListener('pointerup', this._onPointerUp)
    canvas.removeEventListener('pointercancel', this._onPointerUp)
    canvas.removeEventListener('dblclick', this._onDoubleClick)
    canvas.removeEventListener('mouseleave', this._onPointerLeave)
  }

  private _resize(): void {
    if (!this._stage || !this._renderer || !this._camera) return
    const width = Math.max(1, this._stage.clientWidth || this._stage.getBoundingClientRect().width || 640)
    const height = Math.max(1, this._stage.clientHeight || this._stage.getBoundingClientRect().height || 360)
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this._renderer.setSize(width, height, false)
    this._camera.aspect = width / height
    this._camera.updateProjectionMatrix()
    this._renderFrame()
  }

  /** Public imperative seam used by the controlled panel's Center View action. */
  recenter(): void {
    if (!this._camera || !this._controls) return
    this._cameraFocusTarget = null
    const box = new THREE.Box3()
    for (const view of this._nodeViews.values()) box.expandByPoint(view.basePosition)
    const empty = box.isEmpty()
    const center = empty ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())
    const size = empty ? new THREE.Vector3(MIN_WORLD, MIN_WORLD, MIN_WORLD) : box.getSize(new THREE.Vector3())
    const span = Math.max(MIN_WORLD, size.x, size.y, size.z)
    const fov = THREE.MathUtils.degToRad(this._camera.fov)
    const distance = Math.max(8, (span / (2 * Math.tan(fov / 2))) * 1.45)
    const direction = this.viewMode === 'document'
      ? new THREE.Vector3(6, 5, 12).normalize()
      : new THREE.Vector3(0, 14, 18).normalize()
    this._camera.position.copy(center).addScaledVector(direction, distance)
    this._camera.up.set(0, 1, 0)
    this._camera.lookAt(center)
    this._controls.target.copy(center)
    this._controls.autoRotate = this.animated && this.viewMode === 'workspace'
    this._controls.update()
    this._renderFrame()
  }

  private _dimension(): MnGraphThreeDimension {
    return this.dimension === '3d' ? '3d' : '2d'
  }

  private _tick = (): void => {
    this._renderFrame()
    if (this.animated) this._raf = window.requestAnimationFrame(this._tick)
  }

  private _renderFrame = (): void => {
    if (!this._renderer || !this._scene || !this._camera || !this._stage) return
    const elapsed = this._clock.getElapsedTime()
    for (const view of this._nodeViews.values()) {
      const phase = random01(hash(view.node.id) + 70) * Math.PI * 2
      const speed = 0.3 + random01(hash(view.node.id) + 71) * 0.3
      const amplitude = this.viewMode === 'workspace' ? 0.04 : 0.025
      view.group.position.y = view.basePosition.y + Math.sin(elapsed * speed + phase) * amplitude
    }
    for (const edge of this._edgeViews) {
      const behavior = CATEGORY_PARTICLES[edge.category]
      edge.particles.forEach((particle, index) => {
        const offset = edge.particleOffsets[index]
        let t = (elapsed * edge.speed + offset) % 1
        if (behavior.motion === 'bidirectional') {
          t = Math.sin(elapsed * edge.speed * Math.PI * 2 + offset * Math.PI * 2) * 0.5 + 0.5
        } else if (behavior.motion === 'stepping') {
          t = Math.floor(t * 5) / 5
        } else if (behavior.motion === 'wobble') {
          t = Math.max(0, Math.min(1, t + Math.sin(elapsed * 3 + offset * 10) * 0.05))
        }
        const point = edge.curve.getPointAt(t)
        particle.position.copy(point)
        const scale = behavior.scale === 'grow'
          ? 0.5 + t * 0.8
          : behavior.scale === 'swell'
            ? 0.8 + Math.sin(elapsed * 2 + offset * 10) * 0.3
            : 1
        particle.scale.setScalar(scale)
        if (behavior.opacity === 'flicker') {
          ;(particle.material as THREE.MeshBasicMaterial).opacity =
            0.4 + (Math.sin(elapsed * 17 + offset * 23) * 0.5 + 0.5) * 0.4
        }
        edge.particleTrails[index]?.forEach((trail, trailIndex) => {
          const trailT = Math.max(0, Math.min(1, t - (trailIndex + 1) * 0.025))
          trail.position.copy(edge.curve.getPointAt(trailT))
        })
      })
      if (edge.id !== this._hoveredEdgeId) {
        edge.material.opacity = edge.edge.kind === 'wire'
          ? 0.5 + Math.sin(elapsed * 0.8 + edge.particleOffsets[0]) * 0.07
          : 0.48
      }
    }
    if (this._cameraFocusTarget && this._controls) {
      this._controls.target.lerp(this._cameraFocusTarget, CAMERA_FOCUS_LERP_SPEED)
      if (this._controls.target.distanceToSquared(this._cameraFocusTarget) < 0.0001) {
        this._controls.target.copy(this._cameraFocusTarget)
        this._cameraFocusTarget = null
      }
    }
    this._controls?.update()
    this._renderer.render(this._scene, this._camera)
    this._positionLabels()
  }

  private _positionLabels(): void {
    if (!this._stage || !this._camera) return
    const width = this._stage.clientWidth || 1
    const height = this._stage.clientHeight || 1
    for (const view of this._nodeViews.values()) {
      const pos = view.group.position.clone()
      pos.project(this._camera)
      const x = (pos.x * 0.5 + 0.5) * width
      const y = (-pos.y * 0.5 + 0.5) * height
      view.label.style.left = `${x}px`
      view.label.style.top = `${y}px`
      view.label.style.visibility = pos.z < 1 ? 'visible' : 'hidden'
      view.label.classList.toggle(
        'selected',
        view.node.id === (this.selectedNodeId || this._selectedNodeId) || view.node.id === this._hoveredNodeId,
      )
    }
  }

  private _hitAt(clientX: number, clientY: number): { node: NodeView | null; edge: EdgeView | null } | null {
    if (!this._renderer || !this._camera) return null
    const rect = this._renderer.domElement.getBoundingClientRect()
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    const y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
    this._raycaster.setFromCamera(new THREE.Vector2(x, y), this._camera)
    const hits = this._raycaster.intersectObjects([...this._nodeViews.values()].map((view) => view.hit), false)
    const nodeId = hits[0]?.object.userData?.nodeId
    const node = typeof nodeId === 'string' ? this._nodeViews.get(nodeId) ?? null : null
    if (node) return { node, edge: null }
    const edgeHits = this._raycaster.intersectObjects(this._edgeViews.map((view) => view.hit), false)
    const edgeId = edgeHits[0]?.object.userData?.edgeId
    const edge = typeof edgeId === 'string'
      ? this._edgeViews.find((view) => view.id === edgeId) ?? null
      : null
    return { node: null, edge }
  }

  private _onPointerDown = (event: PointerEvent): void => {
    if (!this.interactive || !this._renderer) return
    this._renderer.domElement.setPointerCapture(event.pointerId)
    this._dragStart = { x: event.clientX, y: event.clientY }
    this._dragging = false
  }

  private _onPointerMove = (event: PointerEvent): void => {
    if (!this.interactive || !this._renderer || !this._stage) return
    if (this._dragStart) {
      const total = Math.hypot(event.clientX - this._dragStart.x, event.clientY - this._dragStart.y)
      if (total > 4) {
        this._dragging = true
        this._tooltip = null
        if (this._controls) this._controls.autoRotate = false
      }
    }
    if (!this._dragging) this._updateHover(event)
    this._updateEdgeZone(event)
    this._renderFrame()
  }

  private _onPointerUp = (event: PointerEvent): void => {
    if (!this.interactive || !this._renderer) return
    if (!this._dragging) {
      const hit = this._hitAt(event.clientX, event.clientY)
      if (hit?.node) this._selectNode(hit.node.node, event)
      else if (hit?.edge) this._selectEdge(hit.edge.edge)
      else this._clearSelection()
    }
    if (this._renderer.domElement.hasPointerCapture(event.pointerId)) {
      this._renderer.domElement.releasePointerCapture(event.pointerId)
    }
    this._dragStart = null
    this._dragging = false
    this._renderFrame()
  }

  private _selectNode(node: MnGraphThreeNode, event: PointerEvent): void {
    this._selectedNodeId = node.id
    this._cameraFocusTarget = this._nodeViews.get(node.id)?.group.position.clone() ?? null
    if (this._controls) this._controls.autoRotate = false
    this._refreshHighlights()
    this.dispatchEvent(new CustomEvent<MnGraphThreeNode>('mn-graph-node-select', {
      detail: node,
      bubbles: true,
      composed: true,
    }))
    if (node.kind === 'folder') {
      this._activateNode(node)
      return
    }
    const expandable = ['document', 'read-only-document', 'artifact', 'portal', 'tag'].includes(node.kind ?? '')
    if (expandable && this._stage) {
      const rect = this._stage.getBoundingClientRect()
      const cardWidth = Math.min(270, Math.max(180, rect.width - 16))
      const x = Math.max(8, Math.min(event.clientX - rect.left + 16, rect.width - cardWidth - 8))
      const y = Math.max(8, Math.min(event.clientY - rect.top + 16, rect.height - 190))
      this._expanded = { node, x, y }
      this._tooltip = null
    } else {
      this._expanded = null
    }
  }

  private _selectEdge(edge: MnGraphThreeEdge): void {
    this.dispatchEvent(new CustomEvent<MnGraphThreeEdge>('mn-graph-edge-select', {
      detail: edge,
      bubbles: true,
      composed: true,
    }))
  }

  private _activateNode(node: MnGraphThreeNode): void {
    this._expanded = null
    this.dispatchEvent(new CustomEvent<MnGraphThreeNode>('mn-graph-node-activate', {
      detail: node,
      bubbles: true,
      composed: true,
    }))
  }

  private _activateAccessibleNode(node: MnGraphThreeNode): void {
    this._selectedNodeId = node.id
    this._cameraFocusTarget = this._nodeViews.get(node.id)?.group.position.clone() ?? null
    if (this._controls) this._controls.autoRotate = false
    this._refreshHighlights()
    this.dispatchEvent(new CustomEvent<MnGraphThreeNode>('mn-graph-node-select', {
      detail: node,
      bubbles: true,
      composed: true,
    }))
    this._activateNode(node)
  }

  private _clearSelection(): void {
    this._selectedNodeId = ''
    this._expanded = null
    this._tooltip = null
    this._refreshHighlights()
  }

  private _onDoubleClick = (event: MouseEvent): void => {
    const hit = this._hitAt(event.clientX, event.clientY)
    if (hit?.node) this._activateNode(hit.node.node)
    else this.recenter()
  }

  private _updateHover(event: PointerEvent): void {
    if (!this._renderer) return
    const rect = this._renderer.domElement.getBoundingClientRect()
    const hit = this._hitAt(event.clientX, event.clientY)
    const nodeId = hit?.node?.node.id ?? ''
    const edgeId = hit?.edge?.id ?? ''
    if (nodeId !== this._hoveredNodeId || edgeId !== this._hoveredEdgeId) {
      this._hoveredNodeId = nodeId
      this._hoveredEdgeId = edgeId
      this._refreshHighlights()
    }
    if (hit?.node) {
      const node = hit.node.node
      this._tooltip = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        label: node.label ?? node.id,
        kind: (node.kind ?? 'node').replaceAll('-', ' '),
      }
    } else if (hit?.edge) {
      const edge = hit.edge.edge
      const source = this._nodeViews.get(edge.from)?.node.label ?? edge.from
      const target = this._nodeViews.get(edge.to)?.node.label ?? edge.to
      this._tooltip = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        label: `${source} · ${edge.predicateLabel ?? edge.predicate} ${edge.bidirectional ? '↔' : '→'} ${target}`,
        kind: edge.kind === 'wire' ? 'semantic wire' : 'hierarchy',
      }
    } else {
      this._tooltip = null
    }
    this._renderer.domElement.style.cursor = hit?.node || hit?.edge ? 'pointer' : 'grab'
  }

  private _refreshHighlights(): void {
    const selected = this.selectedNodeId || this._selectedNodeId
    const hoveredEdge = this._edgeViews.find((edge) => edge.id === this._hoveredEdgeId)
    for (const view of this._nodeViews.values()) {
      const connected = !!hoveredEdge && (hoveredEdge.edge.from === view.node.id || hoveredEdge.edge.to === view.node.id)
      const hovered = view.node.id === this._hoveredNodeId
      const active = view.node.id === selected
      const material = view.hit.material as THREE.MeshToonMaterial
      material.color.setHex(hovered || active ? GARDEN_CREAM : connected ? 0xd4e4be : view.baseColor)
      const multiplier = hovered ? 1.15 : active ? 1.22 : connected ? 1.1 : 1
      view.group.scale.copy(view.baseScale).multiplyScalar(multiplier)
      view.label.classList.toggle('selected', hovered || active)
    }
    for (const edge of this._edgeViews) {
      const hovered = edge.id === this._hoveredEdgeId
      edge.material.opacity = hovered ? 1 : edge.edge.kind === 'wire' ? 0.55 : 0.48
      edge.material.color.setHex(hovered ? 0xffffff : edge.edge.kind === 'wire' ? WIRE_COLORS[edge.category] : GARDEN_STONE)
    }
  }

  private _updateEdgeZone(event: PointerEvent): void {
    if (this.viewMode !== 'document' || !this._renderer || this._expanded) {
      this._edgeZone = null
      return
    }
    const rect = this._renderer.domElement.getBoundingClientRect()
    const nx = (event.clientX - rect.left) / Math.max(1, rect.width)
    const ny = (event.clientY - rect.top) / Math.max(1, rect.height)
    const threshold = 0.18
    const north = ny < threshold
    const south = ny > 1 - threshold
    const west = nx < threshold
    const east = nx > 1 - threshold
    this._edgeZone = north && west ? 'nw'
      : north && east ? 'ne'
      : south && west ? 'sw'
      : south && east ? 'se'
      : north ? 'n'
      : south ? 's'
      : west ? 'w'
      : east ? 'e'
      : null
  }

  private _onPointerLeave = (): void => {
    this._hoveredNodeId = ''
    this._hoveredEdgeId = ''
    this._tooltip = null
    this._edgeZone = null
    this._stopEdgePan()
    this._refreshHighlights()
  }

  private _panCamera(direction: string): void {
    if (!this._camera || !this._controls) return
    const forward = this._controls.target.clone().sub(this._camera.position)
    forward.y = 0
    if (forward.lengthSq() < 0.0001) return
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const delta = new THREE.Vector3()
    if (direction.includes('n')) delta.addScaledVector(forward, 1.5)
    if (direction.includes('s')) delta.addScaledVector(forward, -1.5)
    if (direction.includes('e')) delta.addScaledVector(right, 1.5)
    if (direction.includes('w')) delta.addScaledVector(right, -1.5)
    this._camera.position.add(delta)
    this._controls.target.add(delta)
    this._controls.update()
    this._renderFrame()
  }

  private _startEdgePan(direction: string, event: PointerEvent): void {
    event.stopPropagation()
    this._panCamera(direction)
    this._stopEdgePan()
    this._edgePanTimer = window.setInterval(() => this._panCamera(direction), 80)
  }

  private _stopEdgePan(): void {
    if (!this._edgePanTimer) return
    window.clearInterval(this._edgePanTimer)
    this._edgePanTimer = 0
  }

  private _edgeZoneStyle(zone: string): string {
    const styles: Readonly<Record<string, string>> = {
      n: 'top:24px;left:50%;transform:translateX(-50%)',
      s: 'bottom:24px;left:50%;transform:translateX(-50%)',
      e: 'right:24px;top:50%;transform:translateY(-50%)',
      w: 'left:24px;top:50%;transform:translateY(-50%)',
      ne: 'top:24px;right:24px',
      nw: 'top:24px;left:24px',
      se: 'bottom:24px;right:24px',
      sw: 'bottom:24px;left:24px',
    }
    return styles[zone] ?? ''
  }

  private _edgeZoneArrow(zone: string): string {
    const arrows: Readonly<Record<string, string>> = {
      n: '↑', s: '↓', e: '→', w: '←', ne: '↗', nw: '↖', se: '↘', sw: '↙',
    }
    return arrows[zone] ?? ''
  }

  private _onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    if (this._expanded) {
      event.preventDefault()
      this._expanded = null
      return
    }
    if (this._fullscreen) {
      event.preventDefault()
      this._setFullscreen(false)
    }
  }

  private _setFullscreen(value: boolean): void {
    if (this._fullscreen === value) return
    this._fullscreen = value
    this.toggleAttribute('data-fullscreen', value)
    if (value) {
      this.setAttribute('role', 'dialog')
      this.setAttribute('aria-modal', 'true')
    } else {
      this.removeAttribute('role')
      this.removeAttribute('aria-modal')
    }
    void this.updateComplete.then(() => this._resize())
  }

  private _clearScene(): void {
    this._scene?.traverse((object) => {
      const mesh = object as THREE.Mesh
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      geometry?.dispose()
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material?.dispose()
    })
    this._renderer?.renderLists.dispose()
    this._scene = null
    this._labels?.replaceChildren()
    this._nodeViews.clear()
    this._edgeViews = []
    this._hoveredNodeId = ''
    this._hoveredEdgeId = ''
  }

  private _cleanup(): void {
    if (this._raf) {
      window.cancelAnimationFrame(this._raf)
      this._raf = 0
    }
    this._resizeObserver?.disconnect()
    this._resizeObserver = null
    this._stopEdgePan()
    this._clearScene()
    this._controls?.dispose()
    this._controls = null
    if (this._renderer) {
      this._removeEvents(this._renderer.domElement)
      this._renderer.domElement.remove()
      this._renderer.dispose()
    }
    this._labels?.remove()
    this._labels = null
    this._renderer = null
    this._camera = null
    this._stage = null
    this._cameraFocusTarget = null
    this._hoveredNodeId = ''
    this._hoveredEdgeId = ''
  }

  override render(): TemplateResult {
    return html`
      ${this._fullscreen ? html`<div class="modal-backdrop" @click=${() => this._setFullscreen(false)}></div>` : nothing}
      <div class="shell">
        <div class="stage" role="img" aria-label="Graph network"></div>
        ${this.interactive && this.nodes.length > 0
          ? html`<nav class="accessible-nodes" aria-label="Graph nodes">
              <ul>
                ${this.nodes.map((node) => html`<li>
                  <button
                    type="button"
                    data-accessible-node=${node.id}
                    aria-label=${node.label ?? node.id}
                    @click=${() => this._activateAccessibleNode(node)}
                  >${node.label ?? node.id}</button>
                </li>`)}
              </ul>
            </nav>`
          : nothing}
        ${this.fullscreenable
          ? html`<button
              class="graph-tool"
              type="button"
              aria-label=${this._fullscreen ? 'Exit full screen graph' : 'Open full screen graph'}
              title=${this._fullscreen ? 'Exit full screen' : 'Open full screen'}
              @click=${() => this._setFullscreen(!this._fullscreen)}
            >
              ${icon(this._fullscreen ? 'minimize' : 'fullscreen', { size: 16 })}
            </button>`
          : nothing}
        ${this._edgeZone
          ? html`<button
              class="edge-nav"
              type="button"
              style=${this._edgeZoneStyle(this._edgeZone)}
              aria-label=${`Pan ${this._edgeZone}`}
              title=${`Pan ${this._edgeZone}`}
              @pointerdown=${(event: PointerEvent) => this._startEdgePan(this._edgeZone!, event)}
              @pointerup=${this._stopEdgePan}
              @pointercancel=${this._stopEdgePan}
              @pointerleave=${this._stopEdgePan}
            >${this._edgeZoneArrow(this._edgeZone)}</button>`
          : nothing}
        ${this._tooltip
          ? html`<div
              class="node-tooltip"
              style=${`left:${this._tooltip.x}px;top:${this._tooltip.y}px`}
              role="status"
            >
              <div class="tooltip-kind">${this._tooltip.kind}</div>
              ${this._tooltip.label}
            </div>`
          : nothing}
        ${this._expanded
          ? html`<article
              class="node-card"
              style=${`left:${this._expanded.x}px;top:${this._expanded.y}px`}
              @pointerdown=${(event: Event) => event.stopPropagation()}
              @click=${(event: Event) => event.stopPropagation()}
            >
              <header>
                <span class="badge">${(this._expanded.node.kind ?? 'node').replaceAll('-', ' ')}</span>
                <button
                  class="card-close"
                  type="button"
                  aria-label="Close graph card"
                  @click=${() => { this._expanded = null }}
                >×</button>
              </header>
              <h3>${this._expanded.node.label ?? this._expanded.node.id}</h3>
              ${this._expanded.node.snippet
                ? html`<blockquote>${this._expanded.node.snippet}</blockquote>`
                : nothing}
              <button
                class="card-open"
                type="button"
                @click=${() => this._activateNode(this._expanded!.node)}
              >Open ${this._expanded.node.kind === 'artifact' ? 'artifact' : this._expanded.node.kind === 'tag' ? 'tag' : 'document'} →</button>
            </article>`
          : nothing}
        <div class="headless"></div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-graph-three': MnGraphThree
  }
}
