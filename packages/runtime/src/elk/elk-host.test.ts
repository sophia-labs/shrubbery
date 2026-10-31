/**
 * The ELK host on its in-thread engine: the real elkjs 0.12.0 (`elk.bundled.js`), no Worker under vitest. The Worker
 * path is exercised in a real browser by apps/organism/scripts/whiteboard-layout-browser.mts.
 */
import { describe, expect, it } from 'vitest'
import type { ElkNodeJson } from '@shrubbery/nucleus/board-layout'
import { createElkHost, ElkLayoutError, stripElkHashes } from './elk-host.js'

function chain(n: number): ElkNodeJson {
  return {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.json.shapeCoords': 'ROOT', 'elk.json.edgeCoords': 'ROOT' },
    children: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, width: 100, height: 40 })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, sources: [`n${i}`], targets: [`n${i + 1}`] })),
  }
}

function hasHash(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasHash)
  if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => k === '$H' || hasHash(v))
  return false
}

describe('the ELK host, in-thread', () => {
  it('lays a chain out left to right, with routes, and without GWT hash ids', async () => {
    const host = createElkHost({ inThread: true })
    const graph = chain(4)
    const result = await host.layout(graph)
    expect(host.mode).toBe('in-thread')
    const xs = result.children!.map((c) => c.x!)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(new Set(xs).size).toBe(4)
    expect(result.edges!.every((e) => (e.sections?.length ?? 0) > 0)).toBe(true)
    expect(hasHash(result)).toBe(false)
    // ELK was handed a copy: the caller's graph is as it was.
    expect(graph.children![0]!.x).toBeUndefined()
    host.dispose()
  })

  it('is deterministic: the same graph gives the same layout, run after run and engine after engine', async () => {
    const a = createElkHost({ inThread: true })
    const b = createElkHost({ inThread: true })
    const graph = chain(6)
    const first = JSON.stringify(await a.layout(graph))
    expect(JSON.stringify(await a.layout(graph))).toBe(first)
    expect(JSON.stringify(await b.layout(graph))).toBe(first)
  })

  it('refuses a graph over the limits before running ELK', async () => {
    const host = createElkHost({ inThread: true })
    await expect(host.layout(chain(1001))).rejects.toMatchObject({ name: 'ElkLayoutError', kind: 'limit' })
    expect(host.mode).toBeNull()
  })

  it('reports a layout past its deadline, and the next layout still runs', async () => {
    const host = createElkHost({ inThread: true })
    const late = host.layout(chain(30), { deadlineMs: 0 })
    await expect(late).rejects.toBeInstanceOf(ElkLayoutError)
    await expect(late).rejects.toMatchObject({ kind: 'deadline' })
    const next = await host.layout(chain(3))
    expect(next.children).toHaveLength(3)
  })

  it('turns an ELK failure into an engine error', async () => {
    const host = createElkHost({ inThread: true })
    const broken: ElkNodeJson = { id: 'root', children: [{ id: 'a', width: 10, height: 10 }], edges: [{ id: 'e', sources: ['a'], targets: ['nowhere'] }] }
    await expect(host.layout(broken)).rejects.toMatchObject({ kind: 'engine' })
  })

  it('stripElkHashes removes $H at every depth and keeps everything else', () => {
    expect(stripElkHashes({ id: 'r', $H: 1, children: [{ id: 'a', $H: 2, labels: [{ $H: 3, text: 't' }] }] })).toEqual({ id: 'r', children: [{ id: 'a', labels: [{ text: 't' }] }] })
  })
})
