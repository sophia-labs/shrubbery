/**
 * REAL component test - mn-wire-picker controlled wire creation flow.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-wire-picker.js'
import type {
  MnWirePicker,
  MnWirePickerOptionChangeDetail,
  MnWirePickerPhaseRequestDetail,
  MnWirePickerQueryDetail,
  MnWirePickerSelectDetail,
} from '../mn-wire-picker.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnWirePicker) => void): Promise<MnWirePicker> {
  const el = document.createElement('mn-wire-picker') as MnWirePicker
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-wire-picker', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders options with source context', async () => {
    const el = await mount(picker => {
      picker.source = {
        graphId: 'graph-a',
        documentId: 'doc-source',
        blockId: 'block-source',
        text: 'Source block text',
      }
      picker.selectedPredicate = { uri: 'urn:supports', label: 'supports', category: 'Default' }
    })

    expect(customElements.get('mn-wire-picker')).toBeDefined()
    expect(sr(el).querySelector('[data-wire-picker]')).not.toBeNull()
    expect(sr(el).textContent).toContain('Source block text')
    expect(sr(el).querySelector('[data-wire-option="predicate"]')?.textContent).toContain('supports')
    expect(sr(el).querySelector('[data-wire-option="from"]')?.textContent).toContain('Selected block')
  })

  it('cycles direction and granularity as pure option changes', async () => {
    const el = await mount(picker => {
      picker.source = { documentId: 'doc-source', blockId: 'block-source' }
      picker.selectedPredicate = { uri: 'urn:related', label: 'is related to' }
    })
    const changes: MnWirePickerOptionChangeDetail[] = []
    el.addEventListener('mn-wire-picker-option-change', event => {
      changes.push((event as CustomEvent<MnWirePickerOptionChangeDetail>).detail)
    })

    ;(sr(el).querySelector('[data-wire-option="direction"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[data-wire-option="from"]') as HTMLButtonElement).click()

    expect(el.direction).toBe('reverse')
    expect(el.granularity).toBe('document')
    expect(changes.map(change => [change.field, change.direction, change.granularity])).toEqual([
      ['direction', 'reverse', 'block'],
      ['from', 'reverse', 'document'],
    ])
  })

  it('emits query and phase request intents without fetching blocks', async () => {
    const el = await mount(picker => {
      picker.phase = 'document'
      picker.documents = [{ id: 'doc-a', label: 'Architecture' }]
    })
    const queries: MnWirePickerQueryDetail[] = []
    const phases: MnWirePickerPhaseRequestDetail[] = []
    el.addEventListener('mn-wire-picker-query', event => {
      queries.push((event as CustomEvent<MnWirePickerQueryDetail>).detail)
    })
    el.addEventListener('mn-wire-picker-phase-request', event => {
      phases.push((event as CustomEvent<MnWirePickerPhaseRequestDetail>).detail)
    })

    const input = sr(el).querySelector<HTMLInputElement>('[data-wire-picker-search]')!
    input.value = 'arch'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))

    expect(queries).toEqual([{ query: 'arch', phase: 'document' }])
    expect(phases).toEqual([
      {
        phase: 'block',
        document: { id: 'doc-a', label: 'Architecture' },
        block: undefined,
      },
    ])
  })

  it('selects document and block targets with predicate/direction context', async () => {
    const doc = { id: 'doc-a', label: 'Architecture', graphId: 'graph-a' }
    const block = { id: 'block-a', type: 'heading' as const, level: 2, text: 'Overview', preview: 'Overview' }
    const source = { graphId: 'graph-a', documentId: 'doc-source', blockId: 'block-source' }
    const el = await mount(picker => {
      picker.phase = 'block'
      picker.source = source
      picker.selectedDocument = doc
      picker.blocks = [block]
      picker.selectedPredicate = { uri: 'urn:supports', label: 'supports' }
      picker.direction = 'bidirectional'
    })
    const modern: MnWirePickerSelectDetail[] = []
    const legacy: MnWirePickerSelectDetail[] = []
    el.addEventListener('mn-wire-picker-select', event => {
      modern.push((event as CustomEvent<MnWirePickerSelectDetail>).detail)
    })
    el.addEventListener('wire-picker-select', event => {
      legacy.push((event as CustomEvent<MnWirePickerSelectDetail>).detail)
    })

    ;(sr(el).querySelector('[data-block-id="block-a"]') as HTMLButtonElement)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    const detail = {
      source,
      document: doc,
      block,
      predicate: { uri: 'urn:supports', label: 'supports' },
      direction: 'bidirectional' as const,
      granularity: 'block' as const,
      bidirectional: true,
    }
    expect(modern).toEqual([detail])
    expect(legacy).toEqual([detail])
  })

  it('renders predicate groups and emits selected predicate option', async () => {
    const el = await mount(picker => {
      picker.phase = 'predicate'
      picker.predicates = [
        { uri: 'urn:related', label: 'is related to', category: 'Default', icon: 'link' },
        { uri: 'urn:critiques', label: 'critiques', category: 'Review', icon: 'scale' },
      ]
    })
    const changes: MnWirePickerOptionChangeDetail[] = []
    const phases: MnWirePickerPhaseRequestDetail[] = []
    el.addEventListener('mn-wire-picker-option-change', event => {
      changes.push((event as CustomEvent<MnWirePickerOptionChangeDetail>).detail)
    })
    el.addEventListener('mn-wire-picker-phase-request', event => {
      phases.push((event as CustomEvent<MnWirePickerPhaseRequestDetail>).detail)
    })

    expect(Array.from(sr(el).querySelectorAll('.group-label')).map(node => node.textContent?.trim())).toEqual([
      'Default',
      'Review',
    ])
    ;(sr(el).querySelector('[data-predicate-uri="urn:critiques"]') as HTMLButtonElement)
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(changes[0]).toMatchObject({
      field: 'predicate',
      predicate: { uri: 'urn:critiques', label: 'critiques', category: 'Review', icon: 'scale' },
    })
    expect(phases).toEqual([{ phase: 'options', document: undefined, block: undefined }])
  })

  it('Escape closes from document/options phases and overlay emits mn-close', async () => {
    const el = await mount(picker => {
      picker.phase = 'document'
    })
    const closed: string[] = []
    el.addEventListener('mn-close', () => closed.push('close'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close'])

    el.open = true
    await el.updateComplete
    sr(el).querySelector<HTMLElement>('[data-wire-picker-overlay]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close', 'close'])
  })
})
