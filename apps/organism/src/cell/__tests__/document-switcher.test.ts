import { describe, expect, it } from 'vitest'
import { CommandRegistryImpl, type CommandContext } from '@shrubbery/nucleus'
import type { SidebarSection } from '@shrubbery/runtime'
import {
  documentSwitcherBlockItemsFromRows,
  documentSwitcherBlocksSparql,
  documentSwitcherActionRows,
  documentSwitcherDocumentsFromSidebar,
  documentSwitcherItems,
  loadDocumentSwitcherBlocks,
} from '../document-switcher.js'

const ctx: CommandContext = {
  selection: null,
  graphId: 'graph-a',
  documentId: 'doc-open',
  rightPanelMode: 'none',
  posture: 'application',
}

const sections: SidebarSection[] = [
  {
    id: 'documents',
    label: 'Documents',
    nodes: [
      {
        id: 'folder-research',
        label: 'Research',
        kind: 'folder',
        children: [
          { id: 'doc-alpha', label: 'Alpha Notes', kind: 'document' },
          {
            id: 'folder-deep',
            label: 'Deep',
            kind: 'folder',
            children: [{ id: 'doc-beta', label: 'Beta Plan', kind: 'document' }],
          },
        ],
      },
      { id: 'doc-root', label: 'Root Doc', kind: 'document' },
    ],
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    nodes: [{ id: 'artifact-a', label: 'Image', kind: 'artifact' }],
  },
]

describe('document switcher shell projection', () => {
  it('flattens sidebar document rows with graph ids and folder paths', () => {
    expect(documentSwitcherDocumentsFromSidebar(sections, 'graph-a')).toEqual([
      {
        kind: 'document',
        id: 'doc-alpha',
        documentId: 'doc-alpha',
        graphId: 'graph-a',
        label: 'Alpha Notes',
        path: 'Research',
        readOnly: false,
      },
      {
        kind: 'document',
        id: 'doc-beta',
        documentId: 'doc-beta',
        graphId: 'graph-a',
        label: 'Beta Plan',
        path: 'Research / Deep',
        readOnly: false,
      },
      {
        kind: 'document',
        id: 'doc-root',
        documentId: 'doc-root',
        graphId: 'graph-a',
        label: 'Root Doc',
        path: null,
        readOnly: false,
      },
    ])
  })

  it('filters and sorts document switcher items without inventing block rows synchronously', () => {
    const docs = documentSwitcherDocumentsFromSidebar(sections, 'graph-a')

    expect(documentSwitcherItems(docs, 'plan', 'all', 'smart').map((item) => item.id)).toEqual(['doc-beta'])
    expect(documentSwitcherItems(docs, 'research', 'documents', 'smart').map((item) => item.id)).toEqual([
      'doc-alpha',
      'doc-beta',
    ])
    expect(documentSwitcherItems(docs, 'alpha notes', 'all', 'exact').map((item) => item.id)).toEqual(['doc-alpha'])
    expect(documentSwitcherItems(docs, '', 'blocks', 'smart')).toEqual([])
    expect(documentSwitcherItems(docs, '', 'actions', 'smart')).toEqual([])
  })

  it('projects graph-scoped block rows into switcher block items', async () => {
    const rows = [
      {
        block: '<urn:mnemosyne:local:document:doc-beta#block-block-plan>',
        docUri: '<urn:mnemosyne:local:document:doc-beta>',
        blockId: '"block-plan"',
        docTitle: '"Beta Plan"',
        text: '"Launch plan and invoice workflow"',
        type: '<http://mnemosyne.dev/doc#Paragraph>',
      },
      {
        block: '<urn:mnemosyne:local:document:doc-alpha#block-block-heading>',
        docUri: '<urn:mnemosyne:local:document:doc-alpha>',
        blockId: '"block-heading"',
        docTitle: '"Alpha Notes"',
        text: '"Invoice architecture"',
        type: '<http://mnemosyne.dev/doc#Heading>',
      },
    ]

    expect(documentSwitcherBlockItemsFromRows(rows, 'graph-a', 'invoice', 'smart')).toEqual([
      {
        kind: 'block',
        id: 'doc-alpha:block-heading',
        documentId: 'doc-alpha',
        blockId: 'block-heading',
        graphId: 'graph-a',
        label: 'Alpha Notes',
        snippet: 'Invoice architecture',
        path: 'Alpha Notes / Heading',
        matchSource: 'lexical',
        score: 85,
        compositeScore: 85,
      },
      {
        kind: 'block',
        id: 'doc-beta:block-plan',
        documentId: 'doc-beta',
        blockId: 'block-plan',
        graphId: 'graph-a',
        label: 'Beta Plan',
        snippet: 'Launch plan and invoice workflow',
        path: 'Beta Plan / Paragraph',
        matchSource: 'lexical',
        score: 65,
        compositeScore: 65,
      },
    ])

    const sparql = documentSwitcherBlocksSparql('graph-a', 'invoice')
    expect(sparql).toContain('GRAPH <urn:mnemosyne:local:graph:graph-a:projection:workspace>')
    expect(sparql).toContain('doc:textContent')

    const calls: Array<{ graphId: string; sparql: string }> = []
    const loaded = await loadDocumentSwitcherBlocks(
      {
        async query(graphId, query) {
          calls.push({ graphId, sparql: query })
          return { rows }
        },
      },
      'graph-a',
      'invoice',
      'smart',
    )
    expect(calls).toHaveLength(1)
    expect(loaded.map((item) => item.id)).toEqual(['doc-alpha:block-heading', 'doc-beta:block-plan'])

    expect(await loadDocumentSwitcherBlocks({ async query() { throw new Error('should not query') } }, 'graph-a', 'i', 'smart')).toEqual([])
  })

  it('projects palette commands into action rows through the command registry', () => {
    const registry = new CommandRegistryImpl()
    registry.register([
      {
        id: 'panel.toggle.chat',
        label: 'Toggle Chat Panel',
        category: 'View',
        icon: 'message-circle',
        shortcut: 'Mod+Shift+C',
        keywords: ['assistant'],
        surfaces: ['palette'],
        run: () => {},
      },
      {
        id: 'document.history',
        label: 'Open Version History',
        category: 'Document',
        icon: 'clock',
        keywords: ['snapshots'],
        surfaces: ['palette'],
        run: () => {},
      },
      {
        id: 'hidden.context',
        label: 'Hidden Context Command',
        category: 'Hidden',
        surfaces: ['context'],
        run: () => {},
      },
    ])

    expect(documentSwitcherActionRows(registry, 'assistant', ctx)).toEqual([
      {
        id: 'panel.toggle.chat',
        label: 'Toggle Chat Panel',
        category: 'View',
        icon: 'message-circle',
        shortcut: 'Mod+Shift+C',
        disabled: false,
      },
    ])
    expect(documentSwitcherActionRows(registry, '', ctx).map((action) => action.id)).toEqual([
      'panel.toggle.chat',
      'document.history',
    ])
  })
})
