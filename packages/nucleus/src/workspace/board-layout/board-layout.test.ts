/**
 * The board layout plan over the parity fixture (plans/2026-10-30-elk-layout/fixture-board.excalidraw: a Freud
 * dream-work sketch drawn by the pinned Excalidraw, with a frame, a group, labelled arrows, an elbow arrow, and an
 * arrow out to a shape left outside the selection). Pure: no ELK here; the runtime's tests run the engine end to end.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from './fixture-board.json'
import {
  BOARD_LAYOUT_PRESETS,
  type BoardElement,
  BoardLayoutError,
  applyBoardLayout,
  countElkGraph,
  layoutOptionsFor,
  outlinePoint,
  planBoardLayout,
  rectOf,
  rerouteArrow,
  resolveBoardLayoutOptions,
  roundHalfAway,
} from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const ELEMENTS = (fixture as unknown as { elements: BoardElement[] }).elements
const byId = new Map(ELEMENTS.map((e) => [e.id, e]))
/** The fixture's selection: every live element that is not an arrow or bound text, except "waking". */
const SELECTION = ELEMENTS.filter((e) => e.isDeleted !== true && e.type !== 'arrow' && !(e.type === 'text' && e.containerId) && e.id !== 'waking').map((e) => e.id)

/** sha256 of the hub's presets.json (plans/2026-10-30-elk-layout/presets.json), the copy gardend also carries. */
const PRESETS_SHA256 = 'a3fac592a2a52e13f6ab767204022f0108637e1dcd613326aa27245a142f15bf'

describe('presets', () => {
  it('are the hub copy, byte for byte', () => {
    const local = readFileSync(join(here, 'presets.json'))
    expect(createHash('sha256').update(local).digest('hex')).toBe(PRESETS_SHA256)
    const hub = join(process.env.SOPHIA_HUB_DIR ?? join(homedir(), 'dev/sophia'), 'plans/2026-10-30-elk-layout/presets.json')
    if (existsSync(hub)) expect(readFileSync(hub).equals(local)).toBe(true)
  })

  it('merge common, style and direction, and scale only the spacing keys', () => {
    const flow = layoutOptionsFor(resolveBoardLayoutOptions({}))
    expect(flow['elk.algorithm']).toBe('layered')
    expect(flow['elk.direction']).toBe('RIGHT')
    expect(flow['elk.randomSeed']).toBe(1)
    expect(flow['elk.json.edgeCoords']).toBe('ROOT')
    const loose = layoutOptionsFor(resolveBoardLayoutOptions({ spacing: 'loose' }))
    expect(loose['elk.spacing.nodeNode']).toBe(64)
    expect(loose['elk.layered.spacing.nodeNodeBetweenLayers']).toBeCloseTo(115.2, 10)
    expect(loose['elk.spacing.edgeLabel']).toBe(6)
    const tree = layoutOptionsFor(resolveBoardLayoutOptions({ style: 'tree' }))
    expect(tree['elk.direction']).toBe('DOWN')
    // Radial and grid take no direction, whatever the request says.
    expect(layoutOptionsFor(resolveBoardLayoutOptions({ style: 'radial', direction: 'down' }))['elk.direction']).toBeUndefined()
    expect(layoutOptionsFor(resolveBoardLayoutOptions({ style: 'grid' }))['elk.algorithm']).toBe('rectpacking')
  })

  it('refuse an unknown style, direction or spacing, naming it', () => {
    expect(() => resolveBoardLayoutOptions({ style: 'spiral' })).toThrow(/unknown layout style 'spiral'/)
    expect(() => resolveBoardLayoutOptions({ direction: 'sideways' })).toThrow(/unknown layout direction 'sideways'/)
    expect(() => resolveBoardLayoutOptions({ spacing: 'roomy' })).toThrow(/unknown layout spacing 'roomy'/)
  })
})

describe('board to graph, on the fixture', () => {
  const plan = planBoardLayout(ELEMENTS, { ids: SELECTION })

  it('makes units: the group, the frame as a compound of its children, and single shapes', () => {
    const units = [...plan.units.values()].map((u) => `${u.kind}:${u.nodeId}${u.children.length ? `[${[...u.children].sort().join(',')}]` : ''}`).sort()
    expect(units).toEqual([
      'element:condensation',
      'element:displacement',
      'element:dreamwork',
      'element:latent',
      'element:representability',
      'element:revision',
      'frame:mechanisms[condensation,displacement,representability]',
      'group:group:g-manifest',
    ])
    expect(plan.units.get('group:g-manifest')!.members).toEqual(['manifest', 'remembered'])
    expect(plan.units.get('condensation')!.parent).toBe('mechanisms')
    // Bound text belongs to its container's unit; the left-out shape belongs to none.
    const manifestLabel = ELEMENTS.find((e) => e.containerId === 'manifest')!.id
    expect(plan.unitOfElement.get(manifestLabel)).toBe('group:g-manifest')
    expect(plan.unitOfElement.has('waking')).toBe(false)
  })

  it('gives the root the flow preset and the frame its padding', () => {
    expect(plan.graph.id).toBe('root')
    expect(plan.graph.layoutOptions).toEqual(layoutOptionsFor(resolveBoardLayoutOptions({})))
    const frame = plan.graph.children!.find((n) => n.id === 'mechanisms')!
    expect(frame.layoutOptions).toEqual({ 'elk.padding': '[top=56,left=24,bottom=24,right=24]' })
    expect(frame.children!.map((c) => c.id)).toEqual(['condensation', 'displacement', 'representability'])
    const group = plan.graph.children!.find((n) => n.id === 'group:g-manifest')!
    const r = [rectOf(byId.get('manifest')!), rectOf(byId.get('remembered')!)]
    expect(group.width).toBeCloseTo(Math.max(...r.map((x) => x.x + x.w)) - Math.min(...r.map((x) => x.x)), 9)
    expect(countElkGraph(plan.graph)).toEqual({ nodes: 8, edges: 8 })
  })

  it('orders nodes by their centres, cross-flow axis first, so ELK keeps the sketch', () => {
    const centres = (ids: readonly string[]) => ids.map((id) => {
      const u = plan.units.get(id)!
      return [roundHalfAway(u.rect.y + u.rect.h / 2), roundHalfAway(u.rect.x + u.rect.w / 2)] as const
    })
    const top = plan.graph.children!.map((n) => n.id)
    const keys = centres(top)
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1]![0] < keys[i]![0] || (keys[i - 1]![0] === keys[i]![0] && keys[i - 1]![1] <= keys[i]![1])).toBe(true)
    // Downward, the horizontal axis comes first.
    const down = planBoardLayout(ELEMENTS, { ids: SELECTION, direction: 'down' })
    const xs = down.graph.children!.map((n) => roundHalfAway(down.units.get(n.id)!.rect.x + down.units.get(n.id)!.rect.w / 2))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  it('turns arrows bound into two units into edges, with their labels, and leaves the arrow out to "waking" alone', () => {
    const edges = plan.graph.edges!
    expect(edges.map((e) => e.id).sort()).toEqual(['a-cond', 'a-cond-m', 'a-disp', 'a-disp-m', 'a-latent', 'a-repr', 'a-repr-m', 'a-rev'])
    const latent = edges.find((e) => e.id === 'a-latent')!
    expect(latent.sources).toEqual(['latent'])
    expect(latent.targets).toEqual(['dreamwork'])
    expect(latent.labels).toHaveLength(1)
    expect(latent.labels![0]!.text).toBe('worked by')
    // An arrow into a group member points at the group's node.
    expect(edges.find((e) => e.id === 'a-rev')!.targets).toEqual(['group:g-manifest'])
    // Edge order: by the source's place in the node order, then the target's, then the arrow id.
    const order = new Map<string, number>()
    const walk = (nodes: readonly { id: string; children?: readonly { id: string }[] }[]) => {
      for (const n of nodes) { order.set(n.id, order.size); walk((n.children ?? []) as never) }
    }
    walk(plan.graph.children!)
    const keyOf = (e: (typeof edges)[number]) => [order.get(e.sources[0]!)!, order.get(e.targets[0]!)!]
    for (let i = 1; i < edges.length; i++) {
      const [a, b] = [keyOf(edges[i - 1]!), keyOf(edges[i]!)]
      expect(a[0]! < b[0]! || (a[0] === b[0] && a[1]! <= b[1]!)).toBe(true)
    }
  })

  it('takes a frame with its children and a group member with its group', () => {
    const viaFrame = planBoardLayout(ELEMENTS, { ids: ['mechanisms', 'latent'] })
    expect([...viaFrame.units.keys()].sort()).toEqual(['condensation', 'displacement', 'latent', 'mechanisms', 'representability'])
    const viaGroup = planBoardLayout(ELEMENTS, { ids: ['remembered', 'waking'] })
    expect([...viaGroup.units.keys()].sort()).toEqual(['group:g-manifest', 'waking'])
    // Bound text stands for its container; an arrow in the ids is skipped.
    const label = ELEMENTS.find((e) => e.containerId === 'latent')!.id
    expect([...planBoardLayout(ELEMENTS, { ids: [label, 'dreamwork', 'a-latent'] }).units.keys()].sort()).toEqual(['dreamwork', 'latent'])
  })

  it('lays out the whole board without ids', () => {
    const whole = planBoardLayout(ELEMENTS)
    expect(whole.units.has('waking')).toBe(true)
    expect(whole.graph.edges!.map((e) => e.id)).toContain('a-wake')
  })

  it('refuses nothing to lay out, a missing id, and too many shapes', () => {
    expect(() => planBoardLayout(ELEMENTS, { ids: ['latent'] })).toThrow(BoardLayoutError)
    expect(() => planBoardLayout(ELEMENTS, { ids: ['latent'] })).toThrow(/nothing to lay out/)
    expect(() => planBoardLayout(ELEMENTS, { ids: ['latent', 'ghost'] })).toThrow(/no live element 'ghost'/)
    const many: BoardElement[] = Array.from({ length: BOARD_LAYOUT_PRESETS.limits.nodes + 1 }, (_, i) => ({
      id: `r${i}`, type: 'rectangle', x: i * 10, y: 0, width: 5, height: 5, version: 1, versionNonce: 1,
    }))
    expect(() => planBoardLayout(many)).toThrow(/too many shapes to lay out: 1001 nodes \(the limit is 1000\)/)
  })
})

describe('result to board, with a hand-written result', () => {
  it('anchors, moves units, routes edges as elbow arrows with orbit bindings, and re-routes the rest', () => {
    const ids = ['latent', 'dreamwork', 'waking']
    const plan = planBoardLayout(ELEMENTS, { ids })
    // A result ELK could give: three nodes in a row, a right-angled route from latent to dreamwork.
    const result = {
      id: 'root',
      children: [
        { id: 'latent', x: 12, y: 30, width: 180, height: 64 },
        { id: 'dreamwork', x: 300, y: 130, width: 180, height: 64 },
        { id: 'waking', x: 600, y: 30, width: 180, height: 64 },
      ],
      edges: [{
        id: 'a-latent', sources: ['latent'], targets: ['dreamwork'],
        sections: [{ startPoint: { x: 192, y: 62 }, bendPoints: [{ x: 246, y: 62 }, { x: 246, y: 162 }], endPoint: { x: 300, y: 162 } }],
        labels: [{ id: ELEMENTS.find((e) => e.containerId === 'a-latent')!.id, x: 200, y: 100, width: 60, height: 20 }],
      }],
    }
    const change = applyBoardLayout(ELEMENTS, plan, result)
    const before = Math.min(...[...plan.units.values()].map((u) => u.rect.x))
    const beforeY = Math.min(...[...plan.units.values()].map((u) => u.rect.y))
    expect(change.delta).toEqual({ x: before - 12, y: beforeY - 30 })
    // latent is the top-left unit and ELK's top-left node: the anchor puts it back where it was, so it is not written.
    expect(change.elements.has('latent')).toBe(false)
    const dream = change.elements.get('dreamwork')!
    expect([dream.x, dream.y]).toEqual([300 + change.delta.x, 130 + change.delta.y])
    // The container's label moved by the container's translation.
    const label = ELEMENTS.find((e) => e.containerId === 'dreamwork')!
    const moved = change.elements.get(label.id)!
    expect((moved.x as number) - (label.x as number)).toBeCloseTo((dream.x as number) - (byId.get('dreamwork')!.x as number), 9)
    expect((moved.y as number) - (label.y as number)).toBeCloseTo((dream.y as number) - (byId.get('dreamwork')!.y as number), 9)
    // The edge is ELK's route, all right angles: an elbow arrow.
    const arrow = change.elements.get('a-latent')!
    expect(arrow.elbowed).toBe(true)
    expect(arrow.fixedSegments).toEqual([])
    expect(arrow.points).toEqual([[0, 0], [54, 0], [54, 100], [108, 100]])
    expect([arrow.width, arrow.height]).toEqual([108, 100])
    expect(arrow.roundness).toBeNull()
    // The start leaves latent's right side at mid-height: fixedPoint [1, 0.5] is stored as [1, 0.5001], as Excalidraw does.
    expect(arrow.startBinding).toEqual({ elementId: 'latent', mode: 'orbit', fixedPoint: [1, 0.5001] })
    expect(arrow.endBinding).toEqual({ elementId: 'dreamwork', mode: 'orbit', fixedPoint: [0, 0.5001] })
    // The arrow's label sits on ELK's label box.
    const arrowLabel = change.elements.get(ELEMENTS.find((e) => e.containerId === 'a-latent')!.id)!
    expect((arrowLabel.x as number) + (arrowLabel.width as number) / 2).toBeCloseTo(230 + change.delta.x, 9)
    // a-cond leaves dreamwork for condensation (outside the set): re-routed straight, as gardend's reroute does.
    const cond = change.elements.get('a-cond')!
    expect(cond.elbowed).toBe(false)
    expect((cond.points as unknown[]).length).toBe(2)
    const after = new Map(ELEMENTS.map((e) => [e.id, change.elements.get(e.id) ?? e]))
    const start = outlinePoint(after.get('dreamwork')!, [rectOf(after.get('condensation')!).x + 90, rectOf(after.get('condensation')!).y + 32])
    expect(cond.x).toBeCloseTo(start[0], 9)
    expect(cond.y).toBeCloseTo(start[1], 9)
    // Arrows touching nothing in the set are untouched; so is the shape left out of it.
    expect(change.elements.has('a-cond-m')).toBe(false)
    expect(change.elements.has('condensation')).toBe(false)
  })

  it('rerouteArrow is gardend\'s reroute: outline points BIND_GAP outside, aimed at the other centre', () => {
    const out = rerouteArrow(byId, 'a-wake')
    const arrow = out[0]!
    const manifest = rectOf(byId.get('manifest')!)
    const waking = rectOf(byId.get('waking')!)
    // manifest (1180,330 180×64) → waking (1500,640 180×64): the exit is on manifest's bottom side.
    const [sx, sy] = outlinePoint(byId.get('manifest')!, [waking.x + 90, waking.y + 32])
    expect(arrow.x).toBe(sx)
    expect(arrow.y).toBe(sy)
    expect(sy).toBeGreaterThan(manifest.y + manifest.h)
    expect(arrow.elbowed).toBe(false)
    expect(arrow.roundness).toBeNull()
  })
})
