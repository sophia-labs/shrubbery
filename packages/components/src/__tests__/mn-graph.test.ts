/**
 * REAL mn-graph test — the general, skin-aware LAYERED DAG / class-graph view in
 * BOTH skins. NO MOCKS.
 *
 * Asserts: one <g.node> per resolved node (explicit + edge-endpoint), one
 * <g.edge> per edge, the predicate/wire kind discriminator (solid vs dashed via a
 * structural class, NOT color), nodes DERIVED from edge endpoints when `nodes` is
 * empty, the LAYERED layout (a target sits in a later column than its source), the
 * interactive `mn-graph-node-select` event payload (the node), an empty graph
 * renders NOTHING (no faked baseline), the connector/node colors route to the
 * skin ACCENT role token (no hardcoded color), and the host mirrors the ambient
 * skin (square node boxes under Emporium).
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-graph.js'
import type { MnGraph, MnGraphNode, MnGraphEdge } from '../mn-graph.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']

const NODES: MnGraphNode[] = [
  { id: 'AgentNode', note: 'an agent run node' },
  { id: 'Workflow' },
]
const EDGES: MnGraphEdge[] = [
  { from: 'AgentNode', to: 'Workflow', predicate: 'wf:partOfWorkflow', kind: 'predicate', note: 'workflow doc URI' },
  { from: 'AgentNode', to: 'AgentNode', predicate: 'flowsInto', kind: 'wire', note: 'trace edges' },
]

async function mount(skin: Skin, props: Partial<MnGraph> = {}): Promise<MnGraph> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-graph') as MnGraph
  Object.assign(el, props)
  host.appendChild(el)
  await el.updateComplete
  return el
}

function styleText(el: HTMLElement): string {
  const styles = (el.constructor as { styles?: unknown }).styles
  const list = Array.isArray(styles) ? styles : styles ? [styles] : []
  return list.map((s) => (s as { cssText?: string }).cssText ?? '').join('\n')
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-skin')
})

describe('mn-graph — renders nodes + edges (real element, both skins)', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] renders one node group per node + one edge group per edge`, async () => {
      const el = await mount(skin, { nodes: NODES, edges: EDGES })
      expect(el.shadowRoot!.querySelectorAll('g.node').length).toBe(2)
      expect(el.shadowRoot!.querySelectorAll('g.edge').length).toBe(2)
    })

    it(`[skin=${skin}] renders NOTHING with no nodes and no edges`, async () => {
      const el = await mount(skin, { nodes: [], edges: [] })
      expect(el.shadowRoot!.querySelector('svg')).toBeNull()
    })

    it(`[skin=${skin}] each node box carries its data-node id + label`, async () => {
      const el = await mount(skin, { nodes: NODES, edges: EDGES })
      const agent = el.shadowRoot!.querySelector('g.node[data-node="AgentNode"]')
      expect(agent).not.toBeNull()
      expect(agent!.querySelector('.node-label')?.textContent?.trim()).toBe('AgentNode')
      expect(agent!.querySelector('rect.node-box')).not.toBeNull()
    })

    it(`[skin=${skin}] derives NODES from edge endpoints when nodes is empty (tagged derived)`, async () => {
      const el = await mount(skin, { nodes: [], edges: EDGES })
      // Both endpoints (AgentNode + Workflow) become real node boxes (no dangling line).
      const agent = el.shadowRoot!.querySelector('g.node[data-node="AgentNode"]')
      expect(agent).not.toBeNull()
      expect(el.shadowRoot!.querySelector('g.node[data-node="Workflow"]')).not.toBeNull()
      // …and they are tagged `derived` (discovered, not in the explicit node set).
      expect(agent!.getAttribute('data-node-origin')).toBe('derived')
    })

    it(`[skin=${skin}] explicit nodes are tagged origin=explicit (the primary set)`, async () => {
      // AgentNode + Workflow are explicit; the wire self-loop adds no new node here.
      const el = await mount(skin, { nodes: NODES, edges: EDGES })
      const explicit = el.shadowRoot!.querySelectorAll('g.node[data-node-origin="explicit"]')
      expect(explicit.length).toBe(2)
      expect(el.shadowRoot!.querySelectorAll('g.node[data-node-origin="derived"]').length).toBe(0)
    })

    it(`[skin=${skin}] distinguishes explicit vs derived when an edge endpoint is NOT a declared node`, async () => {
      // One explicit class node + an edge to an undeclared endpoint (a wire doc kind).
      const el = await mount(skin, {
        nodes: [{ id: 'NodeDoc' }],
        edges: [{ from: 'NodeDoc', to: 'OutputDoc', predicate: 'produces', kind: 'wire' }],
      })
      expect(
        el.shadowRoot!.querySelector('g.node[data-node="NodeDoc"]')!.getAttribute('data-node-origin'),
      ).toBe('explicit')
      expect(
        el.shadowRoot!.querySelector('g.node[data-node="OutputDoc"]')!.getAttribute('data-node-origin'),
      ).toBe('derived')
    })

    it(`[skin=${skin}] wire edges get the dashed-connector structural class; predicate edges don't`, async () => {
      const el = await mount(skin, { nodes: NODES, edges: EDGES })
      const predEdge = el.shadowRoot!.querySelector('g.edge[data-edge-kind="predicate"]')
      const wireEdge = el.shadowRoot!.querySelector('g.edge[data-edge-kind="wire"]')
      expect(predEdge?.classList.contains('predicate')).toBe(true)
      expect(wireEdge?.classList.contains('wire')).toBe(true)
    })

    it(`[skin=${skin}] LAYERED layout: a forward edge's target sits in a later column than its source`, async () => {
      const el = await mount(skin, { nodes: NODES, edges: EDGES })
      const agentRect = el.shadowRoot!
        .querySelector('g.node[data-node="AgentNode"] rect.node-box')!
        .getAttribute('x')
      const wfRect = el.shadowRoot!
        .querySelector('g.node[data-node="Workflow"] rect.node-box')!
        .getAttribute('x')
      // AgentNode →wf:partOfWorkflow→ Workflow ⇒ Workflow is a later layer (larger x).
      expect(Number(wfRect)).toBeGreaterThan(Number(agentRect))
    })

    it(`[skin=${skin}] non-interactive nodes are not buttons (no role=button)`, async () => {
      const el = await mount(skin, { nodes: NODES, edges: EDGES })
      expect(el.shadowRoot!.querySelectorAll('g.node[role="button"]').length).toBe(0)
    })

    it(`[skin=${skin}] interactive nodes emit mn-graph-node-select with the node`, async () => {
      const el = await mount(skin, { nodes: NODES, edges: EDGES, interactive: true })
      let detail: MnGraphNode | null = null
      el.addEventListener('mn-graph-node-select', (e) => {
        detail = (e as CustomEvent).detail
      })
      const agent = el.shadowRoot!.querySelector('g.node[data-node="AgentNode"]') as SVGGElement
      expect(agent.getAttribute('role')).toBe('button')
      agent.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(detail).toEqual(NODES[0])
    })
  }
})

describe('mn-graph — token-driven colors + structure', () => {
  const css = styleText(document.createElement('mn-graph'))

  it('connector + node-frame colors route to the ACCENT role token (no hardcoded color)', () => {
    expect(css).toMatch(/\.edge-line[\s\S]*stroke:\s*var\(--mn-color-accent/)
    expect(css).toMatch(/\.node-box[\s\S]*stroke:\s*var\(--mn-color-border-accent/)
    expect(css).toMatch(/\.node-label[\s\S]*fill:\s*var\(--mn-color-text-accent/)
  })

  it('wire edges select a dashed connector via a structural class (not color)', () => {
    expect(css).toMatch(/\.edge\.wire \.edge-line[\s\S]*stroke-dasharray/)
  })

  it('carries a :host([data-skin=emporium]) structural rule (square node boxes)', () => {
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)\s*\.node-box[\s\S]*rx/)
  })
})

describe('mn-graph — skin-aware host mirroring', () => {
  it('emporium → mirrored data-skin; garden → none', async () => {
    const emp = await mount('emporium', { nodes: NODES, edges: EDGES })
    const garden = await mount('garden', { nodes: NODES, edges: EDGES })
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
  })
})
