/**
 * REAL component test - mn-document-switcher controlled search/command palette.
 *
 * The element renders caller-owned document/block/action rows and emits composed
 * intents. It does not subscribe to stores, run block search, execute commands,
 * or complete wires by itself.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import '../mn-document-switcher.js'
import type {
  MnDocumentSwitcher,
  MnDocumentSwitcherActionDetail,
  MnDocumentSwitcherIntentDetail,
  MnDocumentSwitcherOpenBlockDetail,
  MnDocumentSwitcherOpenDocumentDetail,
  MnDocumentSwitcherQueryDetail,
  MnDocumentSwitcherScopeDetail,
  MnDocumentSwitcherWireTargetDetail,
} from '../mn-document-switcher.js'

async function mount(setup?: (el: MnDocumentSwitcher) => void): Promise<MnDocumentSwitcher> {
  const el = document.createElement('mn-document-switcher') as MnDocumentSwitcher
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnDocumentSwitcher) => el.shadowRoot!

describe('mn-document-switcher - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-document-switcher')).toBeDefined()
  })

  it('renders controlled document/block rows and emits query changes', async () => {
    const el = await mount((node) => {
      node.open = true
      node.graphId = 'graph-a'
      node.query = 'arch'
      node.items = [
        { kind: 'document', id: 'doc-a', label: 'Architecture', path: 'Notes' },
        { kind: 'block', id: 'doc-b:block-1', documentId: 'doc-b', blockId: 'block-1', label: 'Billing', snippet: 'Architecture note', matchSource: 'semantic' },
      ]
    })
    const queries: MnDocumentSwitcherQueryDetail[] = []
    el.addEventListener('mn-document-switcher-query-change', (event) => {
      queries.push((event as CustomEvent<MnDocumentSwitcherQueryDetail>).detail)
    })

    expect(sr(el).querySelectorAll('.row')).toHaveLength(2)
    expect(sr(el).querySelector('[data-item-id="doc-a"]')?.textContent).toContain('Architecture')
    expect(sr(el).querySelector('[data-item-id="doc-b:block-1"]')?.textContent).toContain('semantic')

    const input = sr(el).querySelector('.input') as HTMLInputElement
    input.value = 'billing'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))

    expect(queries).toEqual([{ query: 'billing', scope: 'all' }])
  })

  it('opens selected documents and blocks through composed intents', async () => {
    const el = await mount((node) => {
      node.open = true
      node.graphId = 'graph-a'
      node.items = [
        { kind: 'document', id: 'doc-a', label: 'Architecture' },
        { kind: 'block', id: 'doc-b:block-1', documentId: 'doc-b', blockId: 'block-1', label: 'Billing', snippet: 'Pay invoices' },
      ]
    })
    const openedDocs: MnDocumentSwitcherOpenDocumentDetail[] = []
    const openedBlocks: MnDocumentSwitcherOpenBlockDetail[] = []
    let closed = 0
    el.addEventListener('mn-document-switcher-open-document', (event) => {
      openedDocs.push((event as CustomEvent<MnDocumentSwitcherOpenDocumentDetail>).detail)
    })
    el.addEventListener('mn-document-switcher-open-block', (event) => {
      openedBlocks.push((event as CustomEvent<MnDocumentSwitcherOpenBlockDetail>).detail)
    })
    el.addEventListener('mn-document-switcher-close', () => {
      closed += 1
    })

    ;(sr(el).querySelector('[data-item-id="doc-a"]') as HTMLElement).click()
    await el.updateComplete
    expect(openedDocs[0]).toMatchObject({ graphId: 'graph-a', documentId: 'doc-a' })
    expect(closed).toBe(1)

    el.open = true
    await el.updateComplete
    ;(sr(el).querySelector('[data-item-id="doc-b:block-1"]') as HTMLElement).click()
    await el.updateComplete

    expect(openedBlocks[0]).toMatchObject({ graphId: 'graph-a', documentId: 'doc-b', blockId: 'block-1' })
    expect(closed).toBe(2)
  })

  it('emits document preparation intent from pointer and keyboard highlight without opening', async () => {
    const el = await mount((node) => {
      node.open = true
      node.graphId = 'graph-a'
      node.items = [
        { kind: 'document', id: 'doc-a', label: 'Architecture' },
        { kind: 'block', id: 'doc-b:block-1', documentId: 'doc-b', blockId: 'block-1', label: 'Billing' },
      ]
    })
    const intents: MnDocumentSwitcherIntentDetail[] = []
    const intentEnds: MnDocumentSwitcherIntentDetail[] = []
    el.addEventListener('mn-document-switcher-document-intent', event => {
      intents.push((event as CustomEvent<MnDocumentSwitcherIntentDetail>).detail)
    })
    el.addEventListener('mn-document-switcher-document-intent-end', event => {
      intentEnds.push((event as CustomEvent<MnDocumentSwitcherIntentDetail>).detail)
    })

    ;(sr(el).querySelector('[data-item-id="doc-b:block-1"]') as HTMLElement).dispatchEvent(
      new MouseEvent('mouseenter'),
    )
    await el.updateComplete

    expect(intents.at(-1)).toMatchObject({
      graphId: 'graph-a',
      documentId: 'doc-b',
    })
    ;(sr(el).querySelector('.container') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    )
    expect(intentEnds.at(-1)).toMatchObject({
      graphId: 'graph-a',
      documentId: 'doc-b',
    })
    expect(el.open).toBe(false)
  })

  it('runs action rows and scope/sort controls as intents only', async () => {
    const el = await mount((node) => {
      node.open = true
      node.scope = 'actions'
      node.actions = [
        { id: 'doc.new', label: 'New Document', category: 'Document', icon: 'file-text', shortcut: 'Mod+N' },
      ]
    })
    const actions: MnDocumentSwitcherActionDetail[] = []
    const scopes: MnDocumentSwitcherScopeDetail[] = []
    el.addEventListener('mn-document-switcher-run-action', (event) => {
      actions.push((event as CustomEvent<MnDocumentSwitcherActionDetail>).detail)
    })
    el.addEventListener('mn-document-switcher-scope-change', (event) => {
      scopes.push((event as CustomEvent<MnDocumentSwitcherScopeDetail>).detail)
    })

    expect(sr(el).querySelector('[data-action-id="doc.new"]')?.textContent).toContain('New Document')
    ;(sr(el).querySelector('[data-action-id="doc.new"]') as HTMLElement).click()
    expect(actions[0]).toMatchObject({ actionId: 'doc.new' })

    el.open = true
    await el.updateComplete
    const documentsButton = Array.from(sr(el).querySelectorAll('.scope-button')).find((button) => button.textContent === 'Documents') as HTMLButtonElement
    documentsButton.click()

    expect(scopes).toEqual([{ scope: 'documents' }])
  })

  it('supports keyboard navigation, close, and wire-mode selection', async () => {
    const el = await mount((node) => {
      node.open = true
      node.wireMode = true
      node.graphId = 'graph-a'
      node.items = [
        { kind: 'document', id: 'doc-a', label: 'A' },
        { kind: 'document', id: 'doc-b', label: 'B' },
      ]
    })
    const wires: MnDocumentSwitcherWireTargetDetail[] = []
    let closed = 0
    el.addEventListener('mn-document-switcher-wire-target', (event) => {
      wires.push((event as CustomEvent<MnDocumentSwitcherWireTargetDetail>).detail)
    })
    el.addEventListener('mn-document-switcher-close', () => {
      closed += 1
    })

    const container = sr(el).querySelector('.container') as HTMLElement
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }))
    await el.updateComplete
    expect(el.selectedIndex).toBe(1)

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }))
    expect(wires[0]).toMatchObject({ graphId: 'graph-a', documentId: 'doc-b' })
    expect(el.open).toBe(true)

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    expect(el.open).toBe(false)
    expect(closed).toBe(1)
  })

  it('layers its backdrop and container on the modal-backdrop/modal tiers, not both on modal', async () => {
    // Semantic-consumer proof for the layer-contract token scale: the backdrop
    // must sit on --mn-z-modal-backdrop (below the surface it dims) and the
    // container on --mn-z-modal — not both stacked on --mn-z-modal, which
    // bypassed the dedicated backdrop tier the scale introduced.
    const el = await mount((node) => { node.open = true })
    const backdrop = sr(el).querySelector('.backdrop') as HTMLElement
    const container = sr(el).querySelector('.container') as HTMLElement

    const backdropZ = Number(getComputedStyle(backdrop).zIndex)
    const containerZ = Number(getComputedStyle(container).zIndex)

    expect(backdropZ).toBe(1300) // --mn-z-modal-backdrop fallback
    expect(containerZ).toBe(1400) // --mn-z-modal fallback
    expect(containerZ).toBeGreaterThan(backdropZ)
  })
})
