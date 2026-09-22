import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-node-link-picker.js'
import type {
  MnNodeLinkCandidate,
  MnNodeLinkPickDetail,
  MnNodeLinkPicker,
} from '../mn-node-link-picker.js'

const candidates: readonly MnNodeLinkCandidate[] = [
  { kind: 'document', id: 'doc-architecture', title: 'Architecture', iconName: 'file-text' },
  { kind: 'artifact', id: 'artifact-diagram', title: 'System Diagram', mimeType: 'image/png', iconName: 'package' },
  { kind: 'document', id: 'doc-billing', title: 'Billing', iconName: 'file-text' },
]

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnNodeLinkPicker) => void): Promise<MnNodeLinkPicker> {
  const el = document.createElement('mn-node-link-picker') as MnNodeLinkPicker
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-node-link-picker', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders document/artifact candidates with Garden hooks', async () => {
    const el = await mount(picker => {
      picker.candidates = candidates
    })
    const rows = Array.from(sr(el).querySelectorAll('[data-node-link-row]'))

    expect(customElements.get('mn-node-link-picker')).toBeDefined()
    expect(sr(el).querySelector('[data-node-link-picker]')).not.toBeNull()
    expect(rows.map(row => row.getAttribute('data-node-link-id'))).toEqual([
      'doc-architecture',
      'artifact-diagram',
      'doc-billing',
    ])
    expect(rows[1].getAttribute('data-node-link-kind')).toBe('artifact')
    expect(rows[1].textContent).toContain('System Diagram')
  })

  it('filters by local query and keeps the selected index in range', async () => {
    const el = await mount(picker => {
      picker.candidates = candidates
      picker.selectedIndex = 2
    })

    const input = sr(el).querySelector<HTMLInputElement>('[data-node-link-search]')!
    input.value = 'diagram'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await el.updateComplete

    const rows = Array.from(sr(el).querySelectorAll('[data-node-link-row]'))
    expect(rows.map(row => row.getAttribute('data-node-link-id'))).toEqual(['artifact-diagram'])
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
  })

  it('emits legacy node-pick and mn-node-link-pick with the selected node', async () => {
    const el = await mount(picker => {
      picker.candidates = candidates
    })
    const legacy: MnNodeLinkPickDetail[] = []
    const modern: MnNodeLinkPickDetail[] = []
    el.addEventListener('node-pick', event => {
      legacy.push((event as CustomEvent<MnNodeLinkPickDetail>).detail)
    })
    el.addEventListener('mn-node-link-pick', event => {
      modern.push((event as CustomEvent<MnNodeLinkPickDetail>).detail)
    })

    sr(el)
      .querySelector<HTMLButtonElement>('[data-node-link-id="artifact-diagram"]')!
      .click()

    const detail = {
      kind: 'artifact' as const,
      id: 'artifact-diagram',
      title: 'System Diagram',
      mimeType: 'image/png',
    }
    expect(legacy).toEqual([detail])
    expect(modern).toEqual([detail])
  })

  it('supports keyboard navigation, Enter pick, Escape close, and close button aliases', async () => {
    const el = await mount(picker => {
      picker.candidates = candidates
    })
    const picked: MnNodeLinkPickDetail[] = []
    const closed: string[] = []
    el.addEventListener('mn-node-link-pick', event => {
      picked.push((event as CustomEvent<MnNodeLinkPickDetail>).detail)
    })
    el.addEventListener('mn-close', () => closed.push('mn-close'))
    el.addEventListener('close', () => closed.push('close'))

    sr(el)
      .querySelector<HTMLElement>('.panel')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await el.updateComplete
    sr(el)
      .querySelector<HTMLElement>('.panel')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(picked).toEqual([
      {
        kind: 'artifact',
        id: 'artifact-diagram',
        title: 'System Diagram',
        mimeType: 'image/png',
      },
    ])

    sr(el)
      .querySelector<HTMLElement>('.panel')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close', 'mn-close'])

    el.open = true
    await el.updateComplete
    sr(el).querySelector<HTMLButtonElement>('[data-node-link-close]')!.click()
    expect(closed).toEqual(['close', 'mn-close', 'close', 'mn-close'])
  })

  it('renders an empty state when no candidates match', async () => {
    const el = await mount(picker => {
      picker.candidates = candidates
      picker.query = 'missing'
    })

    expect(sr(el).querySelector('.empty')?.textContent).toBe('No matching nodes')
    expect(sr(el).querySelectorAll('[data-node-link-row]')).toHaveLength(0)
  })
})
