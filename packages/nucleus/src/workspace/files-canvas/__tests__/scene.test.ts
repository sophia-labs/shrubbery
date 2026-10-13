// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fileKey, type FileCanvasInput, type PlacementContest } from '../../folder-view-contract.js'
import { CARD_GAP, CARD_METRICS, DEFAULT_SLOT_COLUMNS, GRID_STEP, buildScene, chosenCandidate, createSceneBuilder, draftKey, ghostKey, glyphRectOf, moveCards } from '../scene.js'
import { rectContainsRect, rectsIntersect } from '../geometry.js'
import { ALL_CAPS, connection, emptySession, file, folder, inputOf, keyOf, placement, scope } from './support/fixtures.js'

const M = CARD_METRICS.medium
const slotAt = (i: number) => ({ x: 16 + (i % 4) * 160, y: 16 + Math.floor(i / 4) * 144 })

describe('buildScene: cards', () => {
  it('makes one real card per node at its placement, with a glyph box inside the card', () => {
    const { scene } = buildScene(inputOf([{ id: 'a', x: 350, y: 220 }, { id: 'F', folder: true, x: 40, y: 60 }]))
    expect(scene.cards.map((c) => [c.label, c.kind, c.role, c.rect.x, c.rect.y, c.placed, c.locked])).toEqual([
      ['a.pdf', 'file', 'real', 350, 220, true, false], ['F.pdf', 'folder', 'real', 40, 60, true, false],
    ])
    for (const c of scene.cards) {
      expect(c.rect).toMatchObject({ w: M.w, h: M.h })
      expect(rectContainsRect(c.rect, c.glyph)).toBe(true)
      expect(c.glyph).toEqual(glyphRectOf(c.rect, 'medium'))
      expect(scene.byKey.get(c.key)).toBe(c)
    }
    expect(scene.cardSize).toEqual({ w: 144, h: 128 })
    expect(scene.grid).toBeNull()
    expect(scene.slotColumns).toBe(DEFAULT_SLOT_COLUMNS)
  })

  it('sizes cards by iconSize and sets the grid from snapToGrid', () => {
    for (const [iconSize, size] of [['small', [96, 88]], ['medium', [144, 128]], ['large', [200, 176]]] as const) {
      const { scene } = buildScene(inputOf([{ id: 'a', x: 0, y: 0 }], { view: { iconSize, snapToGrid: true } }))
      expect(scene.cardSize).toEqual({ w: size[0], h: size[1] })
      expect(scene.grid).toBe(GRID_STEP)
      expect(scene.cards[0]!.glyph.w).toBe(CARD_METRICS[iconSize].glyph)
    }
  })

  it('keys real cards by fileKey and the other cards by keys that cannot collide with it', () => {
    const f = file('a')
    expect(keyOf(f)).toBe(JSON.stringify(['owner', 'files', 'inc-1', 'document', 'a']))
    expect(fileKey(f)).toBe(keyOf(f))
    expect(ghostKey(keyOf(f), 'one')).not.toBe(keyOf(f))
    expect(JSON.parse(ghostKey(keyOf(f), 'one'))).toHaveLength(3)
    expect(JSON.parse(draftKey('d'))).toHaveLength(2)
  })

  it('rejects what the version-1 projection rejected: forged, cross-scope and duplicate references', () => {
    const base = inputOf([{ id: 'a', x: 0, y: 0 }])
    expect(() => buildScene({ ...base, nodes: [{ file: { ...file('a'), graphId: 'other' }, label: 'a' }], placements: [] })).toThrow('cross-scope')
    expect(() => buildScene({ ...base, nodes: [{ file: file('a'), label: '  ' }], placements: [] })).toThrow('Invalid')
    expect(() => buildScene({ ...base, nodes: [{ file: file('a'), label: 'a' }, { file: file('a'), label: 'b' }], placements: [] })).toThrow('Duplicate')
    expect(() => buildScene({ ...base, placements: [placement({ ...file('a'), graphIncarnation: 'old' }, 0, 0)] })).toThrow()
    expect(() => buildScene({ ...base, placements: [placement(file('ghost'), 0, 0)] })).toThrow('Placement does not belong')
    expect(() => buildScene({ ...base, placements: [placement(file('a'), 0, 0), placement(file('a'), 5, 5)] })).toThrow('Duplicate file placement')
    expect(() => buildScene({ ...base, placements: [placement(file('a'), Number.NaN, 0)] })).toThrow()
  })

  it('derives wire geometry only from visible endpoints and rejects a stale or forged endpoint', () => {
    const input = inputOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }], { connections: [connection('c1', file('a'), file('b'), 'describes')] })
    expect(buildScene(input).scene.connectors).toEqual([{ id: 'c1', from: keyOf(file('a')), to: keyOf(file('b')), label: 'describes' }])
    expect(buildScene({ ...input, nodes: input.nodes.slice(0, 1), placements: input.placements.slice(0, 1) }).scene.connectors).toEqual([])
    expect(buildScene({ ...input, connectionsVisible: false }).scene.connectors).toEqual([])
    expect(() => buildScene({ ...input, connections: [connection('c1', file('a'), { ...file('b'), graphIncarnation: 'stale' })] })).toThrow()
    expect(() => buildScene({ ...input, connections: [connection('c1', file('a'), file('b')), connection('c1', file('b'), file('a'))] })).toThrow()
    expect(buildScene({ ...input, connections: [connection('self', file('a'), file('a'))] }).scene.connectors).toEqual([])
  })

  it('still reads version-1 wires when there are no connections', () => {
    const legacy: FileCanvasInput = { ...inputOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }]),
      wires: [{ id: 'w', source: file('a'), target: file('b'), label: 'old' }], capabilities: undefined, canEdit: true }
    expect(buildScene(legacy).scene.connectors.map((c) => [c.id, c.label])).toEqual([['w', 'old']])
  })
})

describe('buildScene: stable auto-placement (nothing moves unless dragged or tidied)', () => {
  const fresh = (ids: string[], over: Partial<FileCanvasInput> = {}) => inputOf(ids.map((id) => ({ id })), over)

  it('puts cards without a placement on the slot lattice in arrival order', () => {
    const { scene } = buildScene(fresh(['a', 'b', 'c', 'd', 'e']))
    expect(scene.cards.map((c) => [c.rect.x, c.rect.y, c.placed])).toEqual([0, 1, 2, 3, 4].map((i) => [slotAt(i).x, slotAt(i).y, false]))
  })

  it('leaves slots around a placed card alone: placed cards claim their space first', () => {
    const { scene } = buildScene(inputOf([{ id: 'p', x: 16, y: 16 }, { id: 'u1' }, { id: 'u2' }]))
    expect(scene.byKey.get(keyOf(file('u1')))!.rect).toMatchObject(slotAt(1))
    expect(scene.byKey.get(keyOf(file('u2')))!.rect).toMatchObject(slotAt(2))
  })

  it('does not move any existing card when a new one arrives, in the middle or at the end of the input order', () => {
    const builder = createSceneBuilder()
    const first = builder.build(fresh(['a', 'b', 'c']))
    const before = new Map(first.cards.map((c) => [c.key, c.rect]))
    for (const ids of [['a', 'b', 'c', 'new'], ['new', 'a', 'b', 'c'], ['a', 'new', 'b', 'c']]) {
      const b = createSceneBuilder()
      b.build(fresh(['a', 'b', 'c']))
      const after = b.build(fresh(ids))
      for (const [key, rect] of before) expect(after.byKey.get(key)!.rect, `${ids.join()}`).toEqual(rect)
      expect(after.byKey.get(keyOf(file('new')))!.rect).toMatchObject(slotAt(3))
    }
  })

  it('keeps every card in place through a draft, its commit, and the real folder arriving at the same slot', () => {
    const builder = createSceneBuilder()
    const base = builder.build(fresh(['a', 'b', 'c']))
    const rects = new Map(base.cards.map((c) => [c.key, c.rect]))
    const drafting = builder.build(fresh(['a', 'b', 'c'], { drafts: [{ draftId: 'd1', kind: 'folder', label: 'Untitled folder', placement: slotAt(3) }] }))
    for (const [key, rect] of rects) expect(drafting.byKey.get(key)!.rect).toEqual(rect)
    const draft = drafting.byKey.get(draftKey('d1'))!
    expect([draft.role, draft.kind, draft.draftId, draft.rect.x, draft.rect.y]).toEqual(['draft', 'folder', 'd1', slotAt(3).x, slotAt(3).y])
    const created = builder.build(inputOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'New', folder: true, x: slotAt(3).x, y: slotAt(3).y }]))
    for (const [key, rect] of rects) expect(created.byKey.get(key)!.rect).toEqual(rect)
  })

  it('a card that goes away leaves a hole the next new card fills; the others stay put', () => {
    const builder = createSceneBuilder()
    const first = builder.build(fresh(['a', 'b', 'c', 'd']))
    const second = builder.build(fresh(['a', 'c', 'd']))
    for (const id of ['a', 'c', 'd']) expect(second.byKey.get(keyOf(file(id)))!.rect).toEqual(first.byKey.get(keyOf(file(id)))!.rect)
    const third = builder.build(fresh(['a', 'c', 'd', 'e']))
    expect(third.byKey.get(keyOf(file('e')))!.rect).toMatchObject(slotAt(1))
  })

  it('gives a returning card its old slot back if it is still free, and a new one if it is not', () => {
    const builder = createSceneBuilder()
    const first = builder.build(fresh(['a', 'b', 'c']))
    builder.build(fresh(['a', 'c']))
    const back = builder.build(fresh(['a', 'b', 'c']))
    expect(back.byKey.get(keyOf(file('b')))!.rect).toEqual(first.byKey.get(keyOf(file('b')))!.rect)

    const b2 = createSceneBuilder()
    b2.build(fresh(['a', 'b', 'c']))
    b2.build(fresh(['a', 'c']))
    b2.build(fresh(['a', 'c', 'x']))                  // x takes b's old slot
    const returned = b2.build(fresh(['a', 'b', 'c', 'x']))
    const rects = returned.cards.map((c) => c.rect)
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsIntersect(rects[i]!, rects[j]!)).toBe(false)
  })

  it('does not move a card a person dropped something on top of', () => {
    const builder = createSceneBuilder()
    const first = builder.build(fresh(['a', 'b']))
    const slotB = first.byKey.get(keyOf(file('b')))!.rect
    const second = builder.build(inputOf([{ id: 'a' }, { id: 'b' }, { id: 'dropped', x: slotB.x + 20, y: slotB.y + 10 }]))
    expect(second.byKey.get(keyOf(file('b')))!.rect).toEqual(slotB)
  })

  it('forgets the slots when the scope changes, and returns the same snapshot for the same input object', () => {
    const builder = createSceneBuilder()
    const input = fresh(['a', 'b'])
    expect(builder.build(input)).toBe(builder.build(input))
    const other = { ...fresh(['b', 'a']), scope: { ...scope, folderId: 'elsewhere' } }
    const moved = builder.build({ ...other, nodes: other.nodes.map((n) => n), placements: [] })
    expect(moved.byKey.get(keyOf(file('b')))!.rect).toMatchObject(slotAt(0))
    builder.reset()
    expect(builder.autoSlots).toBeNull()
  })

  it('fits the lattice to a pane: slotColumns decides the width of new slots', () => {
    const { scene } = buildScene(fresh(['a', 'b', 'c', 'd', 'e']), { slotColumns: 2 })
    expect(scene.slotColumns).toBe(2)
    expect(scene.cards.map((c) => [c.rect.x, c.rect.y])).toEqual([[16, 16], [176, 16], [16, 160], [176, 160], [16, 304]])
  })
})

describe('buildScene: contested placements as ghosts', () => {
  const contest: PlacementContest = { file: file('a'), candidates: [
    { id: 'theirs', x: 500, y: 40, origin: 'other', label: 'other tab', at: 100 },
    { id: 'mine', x: 20, y: 40, origin: 'this-tab', label: 'this tab', at: 200 },
    { id: 'third', x: 700, y: 400, origin: 'other', label: 'another tab', at: 50 },
  ] }
  const input = inputOf([{ id: 'a', x: 999, y: 999 }, { id: 'b', x: 300, y: 300 }], { contests: [contest] })

  it('draws the real card at this tab\'s candidate and a ghost per other candidate', () => {
    const { scene } = buildScene(input)
    expect(chosenCandidate(contest)!.id).toBe('mine')
    const real = scene.byKey.get(keyOf(file('a')))!
    expect([real.role, real.rect.x, real.rect.y, real.locked]).toEqual(['real', 20, 40, true])
    const ghosts = scene.cards.filter((c) => c.role === 'ghost')
    expect(ghosts.map((g) => [g.ghost!.candidateId, g.rect.x, g.rect.y, g.ghost!.origin, g.ghost!.label, g.ghost!.at, g.locked, g.key]).sort()).toEqual([
      ['theirs', 500, 40, 'other', 'other tab', 100, true, ghostKey(keyOf(file('a')), 'theirs')],
      ['third', 700, 400, 'other', 'another tab', 50, true, ghostKey(keyOf(file('a')), 'third')],
    ].sort())
    for (const g of ghosts) expect(g.ref).toEqual(file('a'))
    expect(scene.byKey.get(keyOf(file('b')))!.locked).toBe(false)
  })

  it('falls back to the earliest candidate when none is this tab\'s', () => {
    const none: PlacementContest = { file: file('a'), candidates: contest.candidates.filter((c) => c.origin === 'other') }
    expect(chosenCandidate(none)!.id).toBe('third')
    expect(chosenCandidate({ file: file('a'), candidates: [] })).toBeNull()
  })

  it('locks only the file whose state is pending or contested, and not a rejected or applied one', () => {
    const states = { [keyOf(file('a'))]: 'pending', [keyOf(file('b'))]: 'rejected', [keyOf(file('c'))]: 'contested', [keyOf(file('d'))]: 'applied' } as const
    const { scene } = buildScene(inputOf(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })), { placementStates: states }))
    expect(scene.cards.map((c) => [c.label, c.locked])).toEqual([['a.pdf', true], ['b.pdf', false], ['c.pdf', true], ['d.pdf', false], ['e.pdf', false]])
  })

  it('ignores a contest for a file that is not in this folder, and rejects a forged one', () => {
    const elsewhere = { file: file('gone'), candidates: contest.candidates }
    expect(buildScene(inputOf([{ id: 'a', x: 0, y: 0 }], { contests: [elsewhere] })).scene.cards).toHaveLength(1)
    expect(() => buildScene(inputOf([{ id: 'a', x: 0, y: 0 }], { contests: [{ file: { ...file('a'), ownerId: 'someone' }, candidates: contest.candidates }] }))).toThrow()
    expect(() => buildScene(inputOf([{ id: 'a', x: 0, y: 0 }], { contests: [{ file: file('a'), candidates: [{ ...contest.candidates[0]!, x: Number.NaN }] }] }))).toThrow()
  })
})

describe('buildScene: drafts', () => {
  it('draws a draft as a pending folder card at its slot, above the files, and keeps auto-slots off it', () => {
    const { scene } = buildScene(inputOf([{ id: 'a' }, { id: 'b' }], { drafts: [{ draftId: 'd', kind: 'folder', label: 'Untitled folder', placement: slotAt(1) }] }))
    expect(scene.cards.at(-1)!.role).toBe('draft')
    expect(scene.byKey.get(keyOf(file('b')))!.rect).toMatchObject(slotAt(2))
  })
  it('rejects duplicate draft ids and non-finite placements', () => {
    const d = { draftId: 'd', kind: 'folder', label: 'x', placement: { x: 0, y: 0 } } as const
    expect(() => buildScene(inputOf([], { drafts: [d, d] }))).toThrow()
    expect(() => buildScene(inputOf([], { drafts: [{ ...d, placement: { x: Number.NaN, y: 0 } }] }))).toThrow()
  })
})

describe('moveCards', () => {
  it('translates the named cards and, for a drag frame, keeps only the connectors that touch them', () => {
    const input = inputOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }, { id: 'c', x: 600, y: 0 }],
      { connections: [connection('ab', file('a'), file('b')), connection('bc', file('b'), file('c'))] })
    const { scene } = buildScene(input)
    const moved = moveCards(scene, [keyOf(file('a'))], { x: 10, y: 20 }, { connectors: 'touching' })
    expect(moved.byKey.get(keyOf(file('a')))!.rect).toMatchObject({ x: 10, y: 20 })
    expect(moved.byKey.get(keyOf(file('a')))!.glyph).toEqual({ ...scene.byKey.get(keyOf(file('a')))!.glyph, x: scene.byKey.get(keyOf(file('a')))!.glyph.x + 10, y: scene.byKey.get(keyOf(file('a')))!.glyph.y + 20 })
    expect(moved.byKey.get(keyOf(file('b')))).toBe(scene.byKey.get(keyOf(file('b'))))
    expect(moved.connectors.map((c) => c.id)).toEqual(['ab'])
    expect(moveCards(scene, [keyOf(file('a'))], { x: 1, y: 1 }).connectors).toHaveLength(2)
    expect(scene.byKey.get(keyOf(file('a')))!.rect).toMatchObject({ x: 0, y: 0 })
  })
})

// A smoke check that the capability fixtures themselves are what the reducer tests assume.
it('ALL_CAPS grants every verb and the empty session selects nothing', () => {
  expect(Object.values(ALL_CAPS).every(Boolean)).toBe(true)
  expect(emptySession.selected).toEqual([])
  expect(CARD_GAP).toBe(16)
  expect(folder('x').kind).toBe('folder')
})
