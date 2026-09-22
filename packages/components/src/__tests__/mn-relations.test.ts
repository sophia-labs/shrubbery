/**
 * REAL mn-relations test — the general, skin-aware directed-edge (FROM→pred→TO)
 * relations view in BOTH skins. NO MOCKS.
 *
 * Asserts: one edge row per input, the from/to sockets + predicate connector,
 * the kind discriminator (predicate=solid, wire=dashed), the interactive
 * `mn-relation-select` event payload (the edge), an empty `relations` renders
 * NOTHING (no faked baseline), the connector/socket colors route to the skin
 * ACCENT role tokens (no hardcoded color), and the host mirrors the ambient skin
 * (square sockets under Emporium).
 */
import { describe, it, expect, afterEach } from 'vitest'
import '../mn-relations.js'
import type { MnRelations, MnRelation } from '../mn-relations.js'

type Skin = 'garden' | 'emporium'
const SKINS: Skin[] = ['garden', 'emporium']

const RELATIONS: MnRelation[] = [
  { from: 'AgentNode', to: 'Workflow', predicate: 'wf:partOfWorkflow', kind: 'predicate', note: 'workflow doc URI' },
  { from: 'node doc', to: 'node doc', predicate: 'flowsInto', kind: 'wire', note: 'trace edges' },
]

async function mount(skin: Skin, props: Partial<MnRelations> = {}): Promise<MnRelations> {
  const host = document.createElement('div')
  if (skin !== 'garden') host.setAttribute('data-skin', skin)
  document.body.appendChild(host)
  const el = document.createElement('mn-relations') as MnRelations
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

describe('mn-relations — renders edges (real element, both skins)', () => {
  for (const skin of SKINS) {
    it(`[skin=${skin}] renders one edge row per relation`, async () => {
      const el = await mount(skin, { relations: RELATIONS })
      expect(el.shadowRoot!.querySelectorAll('.edge').length).toBe(2)
    })

    it(`[skin=${skin}] renders NOTHING with no relations`, async () => {
      const el = await mount(skin, { relations: [] })
      expect(el.shadowRoot!.querySelector('.relations')).toBeNull()
    })

    it(`[skin=${skin}] each edge carries from/to sockets + the predicate connector`, async () => {
      const el = await mount(skin, { relations: RELATIONS })
      const first = el.shadowRoot!.querySelectorAll('.edge')[0]
      expect(first.querySelector('.socket.from')?.textContent).toBe('AgentNode')
      expect(first.querySelector('.socket.to')?.textContent).toBe('Workflow')
      expect(first.querySelector('.pred')?.textContent).toBe('wf:partOfWorkflow')
    })

    it(`[skin=${skin}] wire edges get the dashed-connector structural class`, async () => {
      const el = await mount(skin, { relations: RELATIONS })
      const edges = el.shadowRoot!.querySelectorAll('.edge')
      expect(edges[0].classList.contains('predicate')).toBe(true)
      expect(edges[1].classList.contains('wire')).toBe(true)
    })

    it(`[skin=${skin}] non-interactive rows are divs (no buttons)`, async () => {
      const el = await mount(skin, { relations: RELATIONS })
      expect(el.shadowRoot!.querySelectorAll('button.edge').length).toBe(0)
    })

    it(`[skin=${skin}] interactive rows emit mn-relation-select with the edge`, async () => {
      const el = await mount(skin, { relations: RELATIONS, interactive: true })
      let detail: MnRelation | null = null
      el.addEventListener('mn-relation-select', (e) => {
        detail = (e as CustomEvent).detail
      })
      const btns = el.shadowRoot!.querySelectorAll('button.edge')
      expect(btns.length).toBe(2)
      ;(btns[0] as HTMLButtonElement).click()
      expect(detail).toEqual(RELATIONS[0])
    })
  }
})

describe('mn-relations — token-driven colors + structure', () => {
  const css = styleText(document.createElement('mn-relations'))

  it('connector + from-socket colors route to the ACCENT role token (no hardcoded color)', () => {
    expect(css).toMatch(/\.line[\s\S]*var\(--mn-color-accent\)/)
    expect(css).toMatch(/\.socket\.from[\s\S]*var\(--mn-color-text-accent/)
    // no hardcoded hex on the accent path (the dashed/solid is structural only).
    expect(css).not.toMatch(/border-top:\s*1\.5px solid #[0-9a-f]/i)
  })

  it('wire edges select a dashed connector via a structural class (not color)', () => {
    expect(css).toMatch(/\.edge\.wire \.line[\s\S]*border-top-style:\s*dashed/)
  })

  it('carries a :host([data-skin=emporium]) structural rule (square sockets)', () => {
    expect(css).toMatch(/:host\(\[data-skin=['"]emporium['"]\]\)\s*\.socket[\s\S]*border-radius/)
  })
})

describe('mn-relations — skin-aware host mirroring', () => {
  it('emporium → mirrored data-skin; garden → none', async () => {
    const emp = await mount('emporium', { relations: RELATIONS })
    const garden = await mount('garden', { relations: RELATIONS })
    expect(emp.getAttribute('data-skin')).toBe('emporium')
    expect(garden.hasAttribute('data-skin')).toBe(false)
  })
})
