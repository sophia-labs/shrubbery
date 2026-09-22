// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import '../mn-graph-three.js'
import {
  layoutGardenDocument,
  layoutGardenWorkspace,
  wireCategoryForPredicate,
  type MnGraphThree,
  type MnGraphThreeEdge,
  type MnGraphThreeNode,
} from '../mn-graph-three.js'

type Skin = 'garden' | 'emporium'

const NODES: MnGraphThreeNode[] = [
  { id: 'graph:g', label: 'Garden', kind: 'graph' },
  { id: 'folder:a', label: 'Ideas', kind: 'folder', parentId: 'graph:g' },
  { id: 'doc:a', label: 'A', kind: 'document', parentId: 'folder:a' },
]

const EDGES: MnGraphThreeEdge[] = [
  { id: 'contains:1', from: 'graph:g', to: 'folder:a', predicate: 'contains', kind: 'predicate' },
  { id: 'contains:2', from: 'folder:a', to: 'doc:a', predicate: 'contains', kind: 'predicate' },
]

async function mount(skin: Skin, props: Partial<MnGraphThree> = {}): Promise<MnGraphThree> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-graph-three') as MnGraphThree
  Object.assign(el, props)
  host.appendChild(el)
  for (let index = 0; index < 4; index += 1) {
    await el.updateComplete
    await Promise.resolve()
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  return el
}

function styleText(el: HTMLElement): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map((style) => (style as { cssText?: string }).cssText ?? '').join('\n')
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
})

describe('mn-graph-three — controlled Garden renderer', () => {
  it('registers a real custom element and accepts the rich controlled scene contract', async () => {
    expect(customElements.get('mn-graph-three')).toBeDefined()
    const el = await mount('garden', {
      nodes: NODES,
      edges: EDGES,
      interactive: true,
      viewMode: 'workspace',
      selectedNodeId: 'doc:a',
    })
    expect(el.nodes).toEqual(NODES)
    expect(el.edges).toEqual(EDGES)
    expect(el.viewMode).toBe('workspace')
    expect(el.selectedNodeId).toBe('doc:a')
    expect(el.shadowRoot?.querySelector('.stage')?.getAttribute('role')).toBe('img')
  })

  it('renders an honest WebGL fallback in happy-dom instead of faking a canvas', async () => {
    const el = await mount('garden', { nodes: NODES, edges: EDGES })
    expect(el.shadowRoot?.querySelector('canvas')).toBeNull()
    expect(el.shadowRoot?.querySelector('.headless')?.textContent).toContain('waiting for WebGL')
  })

  it('mirrors ambient skin and keeps the full-screen control opt-in', async () => {
    const emp = await mount('emporium', { nodes: NODES, edges: EDGES, fullscreenable: true })
    const garden = await mount('garden', { nodes: NODES, edges: EDGES })
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(emp.shadowRoot?.querySelector('.graph-tool')).not.toBeNull()
    expect(garden.hasAttribute('data-skin')).toBe(false)
    expect(garden.shadowRoot?.querySelector('.graph-tool')).toBeNull()
  })
})

describe('Garden scene model — deterministic behavior', () => {
  it('lays a hierarchy into stable weighted radial rings', () => {
    const first = layoutGardenWorkspace(NODES, EDGES)
    const second = layoutGardenWorkspace(NODES, EDGES)
    expect([...first]).toEqual([...second])
    expect(first.get('graph:g')).toEqual({ x: 0, y: 1.15, z: 0 })
    expect(first.get('doc:a')?.y).toBeLessThan(first.get('folder:a')?.y ?? 0)
  })

  it('honors both contains and inverse partOf hierarchy predicates', () => {
    const inverse = layoutGardenWorkspace(NODES, [
      { from: 'folder:a', to: 'graph:g', predicate: 'partOf' },
      { from: 'doc:a', to: 'folder:a', predicate: 'partOf' },
    ])
    expect(inverse.get('doc:a')?.y).toBeLessThan(inverse.get('folder:a')?.y ?? 0)
  })

  it('lays document blocks on the twelve-block helix and fans portals outside it', () => {
    const nodes: MnGraphThreeNode[] = [
      { id: 'b1', kind: 'heading', order: 0 },
      { id: 'b2', kind: 'paragraph', order: 1 },
      { id: 'p1', kind: 'portal', parentId: 'b2' },
    ]
    const positions = layoutGardenDocument(nodes)
    expect(positions.get('b1')).toEqual({ x: 3.8, y: 0, z: 0 })
    expect(positions.get('b2')?.y).toBeCloseTo(-0.28)
    expect(Math.hypot(positions.get('b2')!.x, positions.get('b2')!.z)).toBeCloseTo(3.8)
    expect(Math.hypot(positions.get('p1')!.x, positions.get('p1')!.z)).toBeCloseTo(7.3)
  })

  it('keeps Garden semantic-wire categories separate from labels', () => {
    expect(wireCategoryForPredicate('http://mnemosyne.ai/vocab#supports')).toBe('quality')
    expect(wireCategoryForPredicate('urn:test:unknown')).toBe('default')
  })
})

describe('mn-graph-three — implementation and skin contract', () => {
  const source = readFileSync(join(process.cwd(), 'src/mn-graph-three.ts'), 'utf8')
  const css = styleText(document.createElement('mn-graph-three'))

  it('uses the Garden perspective/orbit/raycast scene rather than the generic sphere graph', () => {
    expect(source).toContain('new THREE.WebGLRenderer')
    expect(source).toContain('new THREE.PerspectiveCamera')
    expect(source).toContain('new OrbitControls')
    expect(source).toContain('new THREE.Raycaster')
    expect(source).toContain('new THREE.MeshToonMaterial')
    expect(source).toContain('layoutGardenWorkspace')
    expect(source).toContain('layoutGardenDocument')
    expect(source).toContain('mn-graph-node-select')
    expect(source).toContain('mn-graph-node-activate')
    expect(source).not.toContain('sphereLayout')
  })

  it('keeps chrome skin-aware while preserving the deliberate paper-craft world', () => {
    expect(css).toMatch(/--mn-color-accent/)
    expect(css).toMatch(/--mn-color-border-subtle/)
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)/)
    expect(css).toContain('#2a3328')
  })
})
