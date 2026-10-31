/**
 * Board → ELK graph (DESIGN.md "Board → ELK graph"). Pure: the same elements and request give the same graph, on
 * this side and in gardend. Nothing here runs ELK; the runtime's host does, and `apply-layout.ts` reads the result.
 *
 * 1. The set: the given ids (an arrow is skipped, bound text means its container, a frame brings its children, an
 *    element in a group brings its outermost group's members), else every live shape.
 * 2. Units, what ELK moves as one node: an outermost group (`group:<id>`), a frame with child units (a compound), or
 *    one element. Group units are always top-level.
 * 3. Nodes from the units' rects; 4. edges from arrows bound at both ends to two different units, with the arrow's
 *    label; 5. model order from the current positions, so ELK keeps the person's rough arrangement.
 */
import {
  BOARD_LAYOUT_LIMITS,
  BoardLayoutError,
  type BoardLayoutRequestOptions,
  type ElkOptionValue,
  type ResolvedBoardLayoutOptions,
  framePaddingOption,
  layoutOptionsFor,
  resolveBoardLayoutOptions,
} from './presets.js'
import {
  type BoardElement,
  type Rect,
  bindingTarget,
  boundTextOf,
  isBoundText,
  isFrame,
  isLive,
  num,
  outermostGroup,
  rectOf,
  roundHalfAway,
  str,
} from './elements.js'

export interface ElkLabelJson {
  id?: string
  text?: string
  width?: number
  height?: number
  x?: number
  y?: number
}

export interface ElkPointJson {
  x: number
  y: number
}

export interface ElkSectionJson {
  id?: string
  startPoint: ElkPointJson
  endPoint: ElkPointJson
  bendPoints?: ElkPointJson[]
}

export interface ElkEdgeJson {
  id: string
  sources: string[]
  targets: string[]
  labels?: ElkLabelJson[]
  sections?: ElkSectionJson[]
}

export interface ElkNodeJson {
  id: string
  width?: number
  height?: number
  x?: number
  y?: number
  layoutOptions?: Record<string, ElkOptionValue>
  children?: ElkNodeJson[]
  edges?: ElkEdgeJson[]
  labels?: ElkLabelJson[]
}

export interface BoardLayoutRequest extends BoardLayoutRequestOptions {
  /** The elements to lay out; omitted (or null) for the whole board. */
  readonly ids?: readonly string[] | null
}

export type BoardLayoutUnitKind = 'element' | 'group' | 'frame'

export interface BoardLayoutUnit {
  readonly kind: BoardLayoutUnitKind
  /** The ELK node id: the element id, or `group:<groupId>`. */
  readonly nodeId: string
  /** The elements the unit moves: the element, the group's members, or the frame itself (its children are units). */
  readonly members: readonly string[]
  /** The unit's rect before layout. */
  readonly rect: Rect
  /** The compound's child node ids, for a frame unit. */
  readonly children: readonly string[]
  /** The frame unit holding this one, or null at the top level. */
  readonly parent: string | null
}

export interface BoardLayoutPlan {
  readonly options: ResolvedBoardLayoutOptions
  /** The graph handed to ELK (root id `root`). */
  readonly graph: ElkNodeJson
  /** Units by node id. */
  readonly units: ReadonlyMap<string, BoardLayoutUnit>
  /** The unit node id of every element in the set (members, frames, their bound text by container). */
  readonly unitOfElement: ReadonlyMap<string, string>
  /** The arrows that became ELK edges, in edge order. */
  readonly edgeArrows: readonly string[]
  /** Every element the layout may move (unit members and their bound text): the staleness check reads their versions. */
  readonly touched: readonly string[]
  readonly nodeCount: number
}

function unionRect(rects: readonly Rect[]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** A live element that can be laid out: not an arrow, not bound text. */
function isShape(el: BoardElement | undefined): el is BoardElement {
  return isLive(el) && el.type !== 'arrow' && !isBoundText(el)
}

/** Step 1: the set, as element ids in scene order. */
function chooseSet(elements: readonly BoardElement[], byId: ReadonlyMap<string, BoardElement>, ids: readonly string[] | null | undefined): Set<string> {
  const set = new Set<string>()
  if (ids === null || ids === undefined) {
    for (const el of elements) if (isShape(el)) set.add(el.id)
    return set
  }
  for (const id of ids) {
    const el = byId.get(id)
    if (!isLive(el)) throw new BoardLayoutError(`no live element '${id}' on this board`)
    if (el.type === 'arrow') continue
    if (isBoundText(el)) {
      const container = byId.get(String(el.containerId))
      if (isShape(container)) set.add(container.id)
      continue
    }
    set.add(el.id)
  }
  // Close over frames (their children) and outermost groups (their members) until nothing new comes in.
  const byGroup = new Map<string, string[]>()
  const byFrame = new Map<string, string[]>()
  for (const el of elements) {
    if (!isShape(el)) continue
    const group = outermostGroup(el)
    if (group) (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(el.id)
    const frame = str(el, 'frameId')
    if (frame) (byFrame.get(frame) ?? byFrame.set(frame, []).get(frame)!).push(el.id)
  }
  let grew = true
  while (grew) {
    grew = false
    for (const id of [...set]) {
      const el = byId.get(id)!
      const more = [...(isFrame(el) ? byFrame.get(id) ?? [] : []), ...(byGroup.get(outermostGroup(el) ?? '') ?? [])]
      for (const other of more) if (!set.has(other)) { set.add(other); grew = true }
    }
  }
  return set
}

/** Sort key per DESIGN step 5: rect centre, rounded half away from zero, cross-flow axis first; ties by id. */
function orderBy(options: ResolvedBoardLayoutOptions): (a: BoardLayoutUnit, b: BoardLayoutUnit) => number {
  const vertical = options.directional && (options.direction === 'down' || options.direction === 'up')
  return (a, b) => {
    const ka = keyOf(a.rect, vertical)
    const kb = keyOf(b.rect, vertical)
    return ka[0] - kb[0] || ka[1] - kb[1] || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)
  }
}

function keyOf(r: Rect, vertical: boolean): [number, number] {
  const cx = roundHalfAway(r.x + r.w / 2)
  const cy = roundHalfAway(r.y + r.h / 2)
  return vertical ? [cx, cy] : [cy, cx]
}

/**
 * Plan a layout of `elements` (the whole scene, deleted ones included): the set, its units, and the ELK graph. Throws
 * `BoardLayoutError` for an unknown option, a missing id, fewer than two units, or a limit passed.
 */
export function planBoardLayout(elements: readonly BoardElement[], request: BoardLayoutRequest = {}): BoardLayoutPlan {
  const options = resolveBoardLayoutOptions(request)
  const byId = new Map<string, BoardElement>()
  for (const el of elements) byId.set(el.id, el)
  const set = chooseSet(elements, byId, request.ids)

  // Step 2: units. Groups first (always top-level), then frames with child units, then single elements.
  const groupMembers = new Map<string, string[]>()
  for (const id of set) {
    const group = outermostGroup(byId.get(id)!)
    if (group) (groupMembers.get(group) ?? groupMembers.set(group, []).get(group)!).push(id)
  }
  const inGroup = new Set<string>([...groupMembers.values()].flat())
  const units = new Map<string, BoardLayoutUnit>()
  const unitOfElement = new Map<string, string>()
  for (const [group, members] of groupMembers) {
    const nodeId = `group:${group}`
    units.set(nodeId, { kind: 'group', nodeId, members, rect: unionRect(members.map((m) => rectOf(byId.get(m)!))), children: [], parent: null })
    for (const m of members) unitOfElement.set(m, nodeId)
  }
  // Elements outside groups, by the frame (in the set, outside groups) that holds them.
  const loose = [...set].filter((id) => !inGroup.has(id))
  const frames = new Set(loose.filter((id) => isFrame(byId.get(id)!)))
  const childrenOf = new Map<string, string[]>()
  for (const id of loose) {
    if (frames.has(id)) continue
    const frame = str(byId.get(id)!, 'frameId')
    if (frame && frames.has(frame)) (childrenOf.get(frame) ?? childrenOf.set(frame, []).get(frame)!).push(id)
  }
  for (const id of loose) {
    const el = byId.get(id)!
    const frame = str(el, 'frameId')
    const parent = !frames.has(id) && frame && frames.has(frame) && childrenOf.has(frame) ? frame : null
    const children = frames.has(id) ? childrenOf.get(id) ?? [] : []
    const kind: BoardLayoutUnitKind = children.length > 0 ? 'frame' : 'element'
    units.set(id, { kind, nodeId: id, members: [id], rect: rectOf(el), children, parent })
    unitOfElement.set(id, id)
  }
  if (units.size < 2) throw new BoardLayoutError('nothing to lay out: give at least two shapes')
  // Bound text belongs to its container's unit.
  for (const el of elements) {
    if (!isLive(el) || !isBoundText(el)) continue
    const unit = unitOfElement.get(String(el.containerId))
    if (unit) unitOfElement.set(el.id, unit)
  }

  // Steps 3 and 5: nodes, sorted at every level.
  const order = orderBy(options)
  const sorted = (nodeIds: readonly string[]): BoardLayoutUnit[] => nodeIds.map((n) => units.get(n)!).sort(order)
  const flatOrder: string[] = []
  const nodeOf = (unit: BoardLayoutUnit): ElkNodeJson => {
    flatOrder.push(unit.nodeId)
    const node: ElkNodeJson = { id: unit.nodeId, width: unit.rect.w, height: unit.rect.h }
    if (unit.kind === 'frame') {
      node.layoutOptions = framePaddingOption()
      node.children = sorted(unit.children).map(nodeOf)
    }
    return node
  }
  const topLevel = [...units.values()].filter((u) => u.parent === null).map((u) => u.nodeId)
  const children = sorted(topLevel).map(nodeOf)
  const index = new Map(flatOrder.map((id, i) => [id, i]))

  // Step 4: edges from every live arrow bound at both ends into two different units of the set.
  const edges: Array<{ edge: ElkEdgeJson; source: number; target: number }> = []
  for (const el of elements) {
    if (!isLive(el) || el.type !== 'arrow') continue
    const unitAt = (key: 'startBinding' | 'endBinding'): string | null => {
      const target = bindingTarget(el, key)
      if (target === null || !isLive(byId.get(target))) return null
      return unitOfElement.get(target) ?? null
    }
    const source = unitAt('startBinding')
    const target = unitAt('endBinding')
    if (source === null || target === null || source === target) continue
    const edge: ElkEdgeJson = { id: el.id, sources: [source], targets: [target] }
    const label = boundTextOf(byId, el)
    if (label) edge.labels = [{ id: label.id, text: String(label.text ?? ''), width: num(label, 'width'), height: num(label, 'height') }]
    edges.push({ edge, source: index.get(source)!, target: index.get(target)! })
  }
  edges.sort((a, b) => a.source - b.source || a.target - b.target || (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0))

  const nodeCount = units.size
  if (nodeCount > BOARD_LAYOUT_LIMITS.nodes) throw new BoardLayoutError(`too many shapes to lay out: ${nodeCount} nodes (the limit is ${BOARD_LAYOUT_LIMITS.nodes})`)
  if (edges.length > BOARD_LAYOUT_LIMITS.edges) throw new BoardLayoutError(`too many arrows to lay out: ${edges.length} edges (the limit is ${BOARD_LAYOUT_LIMITS.edges})`)

  const touched = new Set<string>()
  for (const unit of units.values()) for (const m of unit.members) touched.add(m)
  for (const [elementId] of unitOfElement) touched.add(elementId)

  return {
    options,
    graph: { id: 'root', layoutOptions: layoutOptionsFor(options), children, edges: edges.map((e) => e.edge) },
    units,
    unitOfElement,
    edgeArrows: edges.map((e) => e.edge.id),
    touched: [...touched],
    nodeCount,
  }
}

/** Count ELK nodes (compounds included) and edges of any graph: the host's own guard before it runs ELK. */
export function countElkGraph(graph: ElkNodeJson): { nodes: number; edges: number } {
  let nodes = 0
  let edges = graph.edges?.length ?? 0
  const walk = (n: ElkNodeJson): void => {
    for (const c of n.children ?? []) { nodes++; edges += c.edges?.length ?? 0; walk(c) }
  }
  walk(graph)
  return { nodes, edges }
}
