/**
 * `buildScene`: the canvas input made into a plain `SceneSnapshot` the engine port computes over.
 *
 * Pure and memoisable. The authority fences of the foundation live here: a node, placement,
 * contest, draft or connection that does not belong to the input's scope (owner, graph,
 * incarnation) throws, exactly as `projectFileCanvas` of the version-1 adapter did, so a forged or
 * stale reference can never become a card the reducer would emit an intent for.
 *
 * Stable auto-placement (G4): a card without a placement record sits in a slot of a fixed lattice.
 * The slot is assigned once, in arrival order, to a key the builder has not seen, and kept for as
 * long as the key stays present. Creating a folder, importing a file or reloading the projection
 * therefore never moves an existing card; only a drag or Tidy up does.
 */
import {
  filePlacementKey, fileKey, folderViewKey,
  type FileCanvasInput, type FileCanvasView, type FileKey, type FilePlacementRecord, type FolderViewScope,
  type PlacementCandidate, type PlacementContest, type WorkspaceFileRef,
} from '../folder-view-contract.js'
import type { SceneCard, SceneConnector, SceneSnapshot } from './engine-port.js'
import { createSlotOccupancy, slotRect, translateRect, type Pt, type Rect, type Size } from './geometry.js'

export type IconSize = FileCanvasView['iconSize']

/** Card boxes and glyph boxes per `iconSize`. `top` is the glyph's inset from the card's top edge. */
export const CARD_METRICS: Readonly<Record<IconSize, { readonly w: number; readonly h: number; readonly glyph: number; readonly top: number }>> =
  Object.freeze({
    small: { w: 96, h: 88, glyph: 32, top: 8 },
    medium: { w: 144, h: 128, glyph: 64, top: 12 },
    large: { w: 200, h: 176, glyph: 96, top: 16 },
  })

/** Space between slots, and the lattice's margin from the scene origin. */
export const CARD_GAP = 16
/** `--mn-files-grid-step`: the grid step for snapping and for keyboard nudging. */
export const GRID_STEP = 8
export const DEFAULT_SLOT_COLUMNS = 4

export function glyphRectOf(rect: Rect, size: IconSize): Rect {
  const m = CARD_METRICS[size]
  return { x: rect.x + (rect.w - m.glyph) / 2, y: rect.y + m.top, w: m.glyph, h: m.glyph }
}

/** Keys of cards that are not files are derived, and cannot collide with `fileKey` (a five-element tuple). */
export function ghostKey(file: FileKey, candidateId: string): FileKey {
  return JSON.stringify(['ghost', file, candidateId])
}
export function draftKey(draftId: string): FileKey {
  return JSON.stringify(['draft', draftId])
}

/** The slots the builder has handed out for one scope, so a re-projection does not move a card. */
export interface AutoSlots {
  readonly scopeKey: string
  readonly slots: ReadonlyMap<FileKey, Pt>
  /** Keys that were cards in the previous build: only these are never re-slotted. */
  readonly present: ReadonlySet<FileKey>
}

export interface BuildSceneOptions {
  readonly autoSlots?: AutoSlots | null
  readonly gap?: number
  readonly slotColumns?: number
}

export interface BuiltScene {
  readonly scene: SceneSnapshot
  readonly autoSlots: AutoSlots
}

function validRef(scope: FolderViewScope, ref: WorkspaceFileRef): boolean {
  // `folderViewKey(scope)` has already refused an incomplete scope, so equality with it is completeness.
  return (ref.kind === 'folder' || ref.kind === 'document' || ref.kind === 'artifact') && !!ref.id?.trim() &&
    ref.ownerId === scope.ownerId && ref.graphId === scope.graphId && ref.graphIncarnation === scope.graphIncarnation
}

function finite(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n) }

/** The candidate whose position the real card takes: the earliest of this tab's, else the earliest. */
export function chosenCandidate(contest: PlacementContest): PlacementCandidate | null {
  const byTime = (a: PlacementCandidate, b: PlacementCandidate) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const own = contest.candidates.filter((c) => c.origin === 'this-tab').sort(byTime)
  return own[0] ?? [...contest.candidates].sort(byTime)[0] ?? null
}

export function buildScene(input: FileCanvasInput, options: BuildSceneOptions = {}): BuiltScene {
  const { scope } = input
  const gap = options.gap ?? CARD_GAP
  const columns = Math.max(1, Math.floor(options.slotColumns ?? DEFAULT_SLOT_COLUMNS))
  const iconSize: IconSize = input.view?.iconSize ?? 'medium'
  const metrics = CARD_METRICS[iconSize]
  const size: Size = { w: metrics.w, h: metrics.h }
  const scopeKey = folderViewKey(scope)

  const nodes = new Map<FileKey, { readonly file: WorkspaceFileRef; readonly label: string }>()
  for (const node of input.nodes) {
    if (!validRef(scope, node.file) || !node.label.trim()) throw new Error('Invalid or cross-scope file canvas node')
    const key = fileKey(node.file)
    if (nodes.has(key)) throw new Error('Duplicate file canvas identity')
    nodes.set(key, node)
  }

  const placementByKey = new Map<FileKey, FilePlacementRecord>()
  for (const placement of input.placements) {
    const key = fileKey(placement.file)
    if (filePlacementKey(placement) !== `${scopeKey}/${placement.file.kind}/${encodeURIComponent(placement.file.id)}` || !nodes.has(key)) {
      throw new Error('Placement does not belong to a projected file and scope')
    }
    if (placementByKey.has(key)) throw new Error('Duplicate file placement')
    placementByKey.set(key, placement)
  }

  const contestByKey = new Map<FileKey, PlacementContest>()
  for (const contest of input.contests ?? []) {
    if (!validRef(scope, contest.file)) throw new Error('Invalid or cross-scope placement contest')
    const key = fileKey(contest.file)
    if (contestByKey.has(key)) throw new Error('Duplicate placement contest')
    const ids = new Set<string>()
    for (const c of contest.candidates) {
      if (!c.id.trim() || ids.has(c.id) || !finite(c.x) || !finite(c.y)) throw new Error('Invalid placement candidate')
      ids.add(c.id)
    }
    // A contest for a file that is not in this folder is not drawn here.
    if (nodes.has(key) && contest.candidates.length) contestByKey.set(key, contest)
  }

  const draftIds = new Set<string>()
  for (const draft of input.drafts ?? []) {
    if (!draft.draftId.trim() || draftIds.has(draft.draftId) || !finite(draft.placement.x) || !finite(draft.placement.y)) {
      throw new Error('Invalid file canvas draft')
    }
    draftIds.add(draft.draftId)
  }

  const states = input.placementStates ?? {}
  const lockedByState = (key: FileKey) => states[key] === 'pending' || states[key] === 'contested'
  const lattice = { size, gap, columns }
  const occupancy = createSlotOccupancy(lattice)

  type Entry = { key: FileKey; ref: WorkspaceFileRef; label: string; pos: Pt | null; placed: boolean; locked: boolean }
  const entries: Entry[] = []
  const ghosts: SceneCard[] = []
  const memory = options.autoSlots && options.autoSlots.scopeKey === scopeKey ? options.autoSlots : null

  for (const [key, node] of nodes) {
    const contest = contestByKey.get(key)
    const placement = placementByKey.get(key)
    let pos: Pt | null = null
    if (contest) {
      const chosen = chosenCandidate(contest)!
      pos = { x: chosen.x, y: chosen.y }
      for (const candidate of contest.candidates) {
        if (candidate === chosen) continue
        const rect: Rect = { x: candidate.x, y: candidate.y, w: size.w, h: size.h }
        ghosts.push({ key: ghostKey(key, candidate.id), kind: node.file.kind === 'folder' ? 'folder' : 'file', role: 'ghost',
          ref: node.file, label: node.label, rect, glyph: glyphRectOf(rect, iconSize), placed: true, locked: true,
          ghost: { candidateId: candidate.id, origin: candidate.origin, label: candidate.label, at: candidate.at }, draftId: null })
        occupancy.add(rect)
      }
    } else if (placement) pos = { x: placement.x, y: placement.y }
    if (pos) occupancy.add({ x: pos.x, y: pos.y, w: size.w, h: size.h })
    entries.push({ key, ref: node.file, label: node.label, pos, placed: pos !== null, locked: !!contest || lockedByState(key) })
  }

  const draftCards: SceneCard[] = (input.drafts ?? []).map((draft) => {
    const rect: Rect = { x: draft.placement.x, y: draft.placement.y, w: size.w, h: size.h }
    occupancy.add(rect)
    return { key: draftKey(draft.draftId), kind: 'folder', role: 'draft', ref: null, label: draft.label, rect,
      glyph: glyphRectOf(rect, iconSize), placed: true, locked: false, ghost: null, draftId: draft.draftId }
  })

  // Slots: keep what a continuing key already has, then let a returning key reclaim its old slot if
  // it is still free, then give each new key (in arrival order) the first free slot.
  const slots = new Map<FileKey, Pt>(memory?.slots ?? [])
  const present = memory?.present ?? new Set<FileKey>()
  for (const e of entries) if (e.placed) slots.delete(e.key)
  const unplaced = entries.filter((e) => !e.placed)
  const settled = new Set<FileKey>()
  const claim = (e: Entry, slot: Pt): void => {
    occupancy.add({ x: slot.x, y: slot.y, w: size.w, h: size.h })
    e.pos = slot
    settled.add(e.key)
  }
  for (const e of unplaced) {
    const slot = slots.get(e.key)
    if (slot && present.has(e.key)) claim(e, slot)
  }
  for (const e of unplaced) {
    const slot = slots.get(e.key)
    if (!settled.has(e.key) && slot && occupancy.isRectFree({ x: slot.x, y: slot.y, w: size.w, h: size.h })) claim(e, slot)
  }
  let cursor = 0
  for (const e of unplaced) {
    if (settled.has(e.key)) continue
    cursor = occupancy.firstFree(cursor)
    const rect = slotRect(lattice, cursor)
    claim(e, { x: rect.x, y: rect.y })
    slots.set(e.key, e.pos!)
  }

  const cards: SceneCard[] = entries.map((e): SceneCard => {
    const rect: Rect = { x: e.pos!.x, y: e.pos!.y, w: size.w, h: size.h }
    return { key: e.key, kind: e.ref.kind === 'folder' ? 'folder' : 'file', role: 'real', ref: e.ref, label: e.label, rect,
      glyph: glyphRectOf(rect, iconSize), placed: e.placed, locked: e.locked, ghost: null, draftId: null }
  })
  const all = [...cards, ...ghosts, ...draftCards]

  return {
    scene: {
      cards: all, byKey: new Map(all.map((card) => [card.key, card])),
      connectors: input.connectionsVisible === false ? [] : buildConnectors(input, scope, new Set(cards.map((c) => c.key))),
      cardSize: size, grid: input.view?.snapToGrid ? GRID_STEP : null, slotColumns: columns,
    },
    autoSlots: { scopeKey, slots, present: new Set(nodes.keys()) },
  }
}

function buildConnectors(input: FileCanvasInput, scope: FolderViewScope, visible: ReadonlySet<FileKey>): SceneConnector[] {
  const source = input.connections ?? (input.wires ?? []).map((w) => ({ id: w.id, source: w.source, target: w.target, label: w.label }))
  const ids = new Set<string>()
  const out: SceneConnector[] = []
  for (const c of source) {
    if (!c.id.trim() || ids.has(c.id) || !validRef(scope, c.source) || !validRef(scope, c.target)) {
      throw new Error('Invalid or cross-scope file connection')
    }
    ids.add(c.id)
    const from = fileKey(c.source)
    const to = fileKey(c.target)
    // A relation can outlive folder membership; only visible endpoints are drawn here.
    if (from === to || !visible.has(from) || !visible.has(to)) continue
    out.push({ id: c.id, from, to, label: c.label })
  }
  return out
}

/** A builder that remembers auto-slots for the current scope and returns the same snapshot for the same input object. */
export interface SceneBuilder {
  build(input: FileCanvasInput): SceneSnapshot
  /** Forget the slots (a new scope forgets them by itself). */
  reset(): void
  readonly autoSlots: AutoSlots | null
}

export function createSceneBuilder(options: Omit<BuildSceneOptions, 'autoSlots'> = {}): SceneBuilder {
  let memory: AutoSlots | null = null
  let lastInput: FileCanvasInput | null = null
  let lastScene: SceneSnapshot | null = null
  return {
    build(input) {
      if (input === lastInput && lastScene) return lastScene
      const built = buildScene(input, { ...options, autoSlots: memory })
      memory = built.autoSlots
      lastInput = input
      lastScene = built.scene
      return built.scene
    },
    reset() { memory = null; lastInput = null; lastScene = null },
    get autoSlots() { return memory },
  }
}

/**
 * The snapshot with `keys` translated by `delta`: what a drag frame routes over. With
 * `connectors: 'touching'` only connectors with an endpoint in `keys` remain, since only those change.
 */
export function moveCards(
  scene: SceneSnapshot, keys: readonly FileKey[], delta: Pt, options: { readonly connectors?: 'all' | 'touching' } = {},
): SceneSnapshot {
  const moving = new Set(keys)
  const cards = scene.cards.map((card) => moving.has(card.key)
    ? { ...card, rect: translateRect(card.rect, delta), glyph: translateRect(card.glyph, delta) } : card)
  const connectors = options.connectors === 'touching'
    ? scene.connectors.filter((c) => moving.has(c.from) || moving.has(c.to)) : scene.connectors
  return { ...scene, cards, byKey: new Map(cards.map((card) => [card.key, card])), connectors }
}
