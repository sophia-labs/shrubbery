/**
 * REAL component test — mn-inspector right-rail object inspector shell.
 *
 * NO MOCKS: mounts the real backend-free custom element and drives DOM events
 * through its shadow tree. The inspected model/actions are prop-injected; close,
 * relation-open, and command execution leave as composed intents.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '../mn-inspector.js'
import type {
  MnInspector,
  MnInspectorActionDetail,
  MnInspectorModel,
  MnInspectorRelationOpenDetail,
} from '../mn-inspector.js'

async function mount(setup?: (el: MnInspector) => void): Promise<MnInspector> {
  const el = document.createElement('mn-inspector') as MnInspector
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnInspector) => el.shadowRoot!

const model: MnInspectorModel = {
  identity: {
    kind: 'document',
    icon: 'file-text',
    title: 'Garden parity plan',
    typeLabel: 'Document',
    chips: [
      { label: 'Graph', value: 'graph-main', mono: true },
      { label: 'Document', value: 'doc-parity', mono: true },
      { label: 'Status', value: 'draft' },
    ],
  },
  relations: {
    scope: 'active',
    groups: [
      {
        key: 'wires',
        label: 'Wires',
        icon: 'git-branch',
        items: [
          {
            id: 'wire-1',
            primary: 'supports -> Shrubbery North Star',
            secondary: 'bidirectional',
            icon: 'git-branch',
          },
        ],
      },
      {
        key: 'comments',
        label: 'Comments',
        icon: 'message-square',
        items: [{ id: 'comment-1', primary: 'Tighten this section.', secondary: 'Vera' }],
      },
    ],
  },
}

describe('mn-inspector — real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-inspector')).toBeDefined()
  })

  it('upgrades the configured Garden inspector tag and renders the empty state without data', async () => {
    const el = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(sr(el).querySelector('.header-title')?.textContent).toBe('Inspector')
    expect(sr(el).querySelector('[data-empty-state="nothing-selected"] .empty-title')?.textContent).toBe(
      'Nothing selected',
    )
    expect(sr(el).textContent).toContain('Select a document, block, wire, comment, or workspace')
  })

  it('renders controlled identity, relation groups, counts, actions, and danger styling', async () => {
    const el = await mount((node) => {
      node.model = model
      node.actions = [
        { type: 'header', content: 'Document' },
        { id: 'open-document', label: 'Open document', icon: 'external-link', shortcut: 'Enter' },
        { type: 'divider' },
        { id: 'delete-document', label: 'Delete document', icon: 'trash', variant: 'danger' },
      ]
    })

    expect(sr(el).querySelector('.identity-title')?.textContent).toBe('Garden parity plan')
    expect(Array.from(sr(el).querySelectorAll('.chip-label')).map((node) => node.textContent)).toEqual([
      'Graph',
      'Document',
      'Status',
    ])
    expect(sr(el).querySelector('[data-section="relations"] .count')?.textContent).toBe('2')
    expect(Array.from(sr(el).querySelectorAll('.relation-group-label')).map((node) => node.textContent)).toEqual([
      'Wires (1)',
      'Comments (1)',
    ])
    expect(sr(el).querySelector('[data-action-id="open-document"] .action-shortcut')?.textContent).toBe('Enter')
    expect(sr(el).querySelector('[data-action-id="delete-document"]')?.classList.contains('danger')).toBe(true)
  })

  it('renders inactive relation scope without pretending to fetch data', async () => {
    const el = await mount((node) => {
      node.model = {
        identity: {
          kind: 'block',
          icon: 'hash',
          title: 'Block in another document',
          typeLabel: 'Block',
        },
        relations: { scope: 'inactive', groups: [] },
      }
    })

    expect(sr(el).querySelector('.relations-lazy')?.textContent).toBe('Open this document to see its connections.')
    expect(sr(el).querySelector('[data-empty-state="no-relations"]')).toBeNull()
  })

  it('emits composed close, relation-open, and action intents', async () => {
    const el = await mount((node) => {
      node.model = model
      node.actions = [
        { id: 'open-document', label: 'Open document', icon: 'external-link' },
        { id: 'disabled-action', label: 'Disabled', disabled: true },
      ]
    })
    const closes: Event[] = []
    const actions: MnInspectorActionDetail[] = []
    const relations: MnInspectorRelationOpenDetail[] = []

    el.addEventListener('mn-inspector-close', (event) => closes.push(event))
    el.addEventListener('mn-inspector-action', (event) => {
      actions.push((event as CustomEvent<MnInspectorActionDetail>).detail)
    })
    el.addEventListener('mn-inspector-relation-open', (event) => {
      relations.push((event as CustomEvent<MnInspectorRelationOpenDetail>).detail)
    })

    ;(sr(el).querySelector('.close-btn') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[data-relation-id="wire-1"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[data-action-id="open-document"]') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, metaKey: true }),
    )
    ;(sr(el).querySelector('[data-action-id="disabled-action"]') as HTMLButtonElement).click()

    expect(closes).toHaveLength(1)
    expect(relations[0]).toMatchObject({ groupKey: 'wires', id: 'wire-1' })
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      id: 'open-document',
      modifiers: { metaKey: true },
    })
  })
})
