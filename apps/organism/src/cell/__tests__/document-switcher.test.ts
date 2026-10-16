import { describe, expect, it } from 'vitest'
import { CommandRegistryImpl, type CommandContext } from '@shrubbery/nucleus'
import type { SidebarSection } from '@shrubbery/runtime'
import {
  documentSwitcherBlockItemsFromRows,
  documentSwitcherBlocksSparql,
  documentSwitcherActionRows,
  documentSwitcherDocumentsFromSidebar,
  documentSwitcherItems,
  documentSwitcherSalienceNudgesFromRows,
  documentSwitcherSalienceSparql,
  loadDocumentSwitcherBlocks,
  reciprocalRankFuseDocumentSwitcherBlocks,
  withDocumentSwitcherSalienceNudge,
} from '../document-switcher.js'
import type { MnDocumentSwitcherBlockItem } from '@shrubbery/components'

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
        docId: '"doc-beta"',
        blockId: '"block-plan"',
        text: '"Launch plan and invoice workflow"',
        type: '<http://mnemosyne.dev/doc#Paragraph>',
      },
      {
        block: '<urn:mnemosyne:local:document:doc-alpha#block-block-heading>',
        docId: '"doc-alpha"',
        blockId: '"block-heading"',
        text: '"Invoice architecture"',
        type: '<http://mnemosyne.dev/doc#Heading>',
      },
    ]
    const titles = new Map([
      ['doc-alpha', 'Alpha Notes'],
      ['doc-beta', 'Beta Plan'],
    ])
    const resolveTitle = (documentId: string) => titles.get(documentId) ?? null

    const projected = documentSwitcherBlockItemsFromRows(rows, 'graph-a', 'invoice', 'smart', resolveTitle)
    expect(projected.map((item) => item.id)).toEqual(['doc-alpha:block-heading', 'doc-beta:block-plan'])
    expect(projected.map((item) => item.label)).toEqual(['Alpha Notes', 'Beta Plan'])
    expect(projected.map((item) => item.path)).toEqual(['Alpha Notes / Heading', 'Beta Plan / Paragraph'])
    expect(projected.map((item) => item.matchSource)).toEqual(['lexical', 'lexical'])
    // Continuous relevance: a prefix hit at offset 0 in a short heading beats
    // a mid-paragraph substring hit — no more tier ties collapsing to a-z.
    expect(projected[0]!.score!).toBeGreaterThan(projected[1]!.score!)
    expect(projected[0]!.compositeScore).toBe(projected[0]!.score)

    const sparql = documentSwitcherBlocksSparql('graph-a', 'invoice')
    expect(sparql).toContain('urn:mnemosyne:local:graph:graph-a:projection:document:')
    expect(sparql).toContain('doc:textContent')
    expect(sparql).not.toContain('projection:workspace')

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
      resolveTitle,
    )
    expect(calls).toHaveLength(1)
    expect(loaded.map((item) => item.id)).toEqual(['doc-alpha:block-heading', 'doc-beta:block-plan'])

    expect(await loadDocumentSwitcherBlocks({ async query() { throw new Error('should not query') } }, 'graph-a', 'i', 'smart')).toEqual([])
  })

  it('fuses lexical and semantic ranks with RRF, nudging smart by salience', () => {
    const mk = (
      id: string,
      score: number,
      matchSource: MnDocumentSwitcherBlockItem['matchSource'] = 'lexical',
    ): MnDocumentSwitcherBlockItem => {
      const [documentId, blockId] = id.split(':') as [string, string]
      return {
        kind: 'block',
        id,
        documentId,
        blockId,
        graphId: 'graph-a',
        label: id,
        snippet: '',
        path: null,
        matchSource,
        score,
      }
    }
    const lexical = [mk('doc-a:block-b1', 90), mk('doc-b:block-b2', 80), mk('doc-c:block-b3', 70)]
    const semantic = [
      mk('doc-c:block-b3', 0.9, 'semantic'),
      mk('doc-a:block-b1', 0.8, 'semantic'),
      mk('doc-d:block-b4', 0.7, 'semantic'),
    ]

    const fused = reciprocalRankFuseDocumentSwitcherBlocks(lexical, semantic)
    // b1: lex rank 0 + sem rank 1. b3: lex rank 2 + sem rank 0. b1 wins by a hair.
    expect(fused.map((item) => item.id)).toEqual([
      'doc-a:block-b1',
      'doc-c:block-b3',
      'doc-b:block-b2',
      'doc-d:block-b4',
    ])
    expect(fused[0]!.matchSource).toBe('both')
    expect(fused[1]!.matchSource).toBe('both')
    expect(fused[2]!.matchSource).toBe('lexical')
    expect(fused[3]!.matchSource).toBe('semantic')
    expect(fused[0]!.score!).toBeCloseTo(1 / 61 + 1 / 62, 6)

    // exact: salience changes nothing.
    const nudges = new Map([['doc-c:block-b3', { importance: 100, valence: null }]])
    expect(withDocumentSwitcherSalienceNudge(fused, nudges, 'exact').map((item) => item.id)).toEqual(
      fused.map((item) => item.id),
    )
    // smart: the bounded nudge (capped at 0.006) lifts the valuated block above the tie.
    const smart = withDocumentSwitcherSalienceNudge(fused, nudges, 'smart')
    expect(smart[0]!.id).toBe('doc-c:block-b3')
    expect(smart[0]!.compositeScore!).toBeCloseTo(1 / 63 + 1 / 61 + 0.006, 6)

    // salience rows: target IRIs parse back into docId:blockId keys.
    const salienceSparql = documentSwitcherSalienceSparql('graph-a', [
      { documentId: 'doc-c', blockId: 'block-b3' },
      { documentId: 'doc-e', blockId: 'b5' },
    ])
    expect(salienceSparql).toContain(':projection:salience')
    expect(salienceSparql).toContain('<urn:mnemosyne:local:document:doc-c#block-block-b3>')
    expect(salienceSparql).toContain('<urn:mnemosyne:local:document:doc-e#block-block-b5>')
    const parsed = documentSwitcherSalienceNudgesFromRows([
      {
        target: '<urn:mnemosyne:local:document:doc-c#block-block-b3>',
        imp: '"3"^^<http://www.w3.org/2001/XMLSchema#float>',
        val: '"-1"^^<http://www.w3.org/2001/XMLSchema#float>',
      },
    ])
    expect(parsed.get('doc-c:block-b3')).toEqual({ importance: 3, valence: -1 })
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
