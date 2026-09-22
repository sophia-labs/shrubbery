import { describe, expect, it, vi } from 'vitest'
import { CommandRegistryImpl } from '../command-registry.js'
import type { Command, CommandContext, Surface } from '../command-registry.js'
import type { SelectedObject } from '../selection.js'

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    selection: null,
    graphId: null,
    documentId: null,
    rightPanelMode: 'none',
    posture: 'manuscript',
    ...overrides,
  }
}

function makeCommand(overrides: Partial<Command> & Pick<Command, 'id' | 'label'>): Command {
  return {
    category: 'Test',
    surfaces: ['palette'],
    run: vi.fn(),
    ...overrides,
  }
}

describe('CommandRegistryImpl', () => {
  it('registers commands and overwrites duplicate ids', () => {
    const registry = new CommandRegistryImpl()
    const first = makeCommand({ id: 'doc.create', label: 'New document' })
    const second = makeCommand({ id: 'doc.create', label: 'Create document' })

    registry.register(first)
    registry.register([second, makeCommand({ id: 'doc.open', label: 'Open document' })])

    expect(registry.get('doc.create')).toBe(second)
    expect(registry.get('doc.open')?.label).toBe('Open document')
    expect(registry.get('missing')).toBeUndefined()
    expect(registry.getAll().map((command) => command.id)).toEqual(['doc.create', 'doc.open'])
  })

  it('filters available commands by surface, when, and appliesTo', () => {
    const registry = new CommandRegistryImpl()
    registry.register([
      makeCommand({ id: 'always', label: 'Always', surfaces: ['palette', 'context'] }),
      makeCommand({
        id: 'needs-doc',
        label: 'Export document',
        surfaces: ['palette'],
        when: (ctx) => ctx.documentId !== null,
      }),
      makeCommand({
        id: 'needs-block',
        label: 'Create wire',
        surfaces: ['context'],
        appliesTo: (selection) => selection?.kind === 'block',
      }),
    ])

    expect(registry.available(makeCtx(), 'palette').map((command) => command.id)).toEqual(['always'])

    const blockSelection: SelectedObject = {
      kind: 'block',
      graphId: 'graph-1',
      documentId: 'doc-1',
      blockId: 'block-1',
    }
    expect(
      registry
        .available(makeCtx({ documentId: 'doc-1', selection: blockSelection }), 'context')
        .map((command) => command.id),
    ).toEqual(['always', 'needs-block'])
  })

  it('passes context to gates and run handlers', async () => {
    const registry = new CommandRegistryImpl()
    const when = vi.fn().mockReturnValue(true)
    const appliesTo = vi.fn().mockReturnValue(true)
    const run = vi.fn()
    const command = makeCommand({ id: 'panel.toggle.chat', label: 'Toggle chat', when, appliesTo, run })
    const selection: SelectedObject = { kind: 'graph', graphId: 'graph-1' }
    const ctx = makeCtx({ graphId: 'graph-1', selection, rightPanelMode: 'chat' })

    registry.register(command)
    await registry.exec(command.id, ctx)

    expect(when).toHaveBeenCalledWith(ctx)
    expect(appliesTo).toHaveBeenCalledWith(selection)
    expect(run).toHaveBeenCalledWith(ctx)
  })

  it('does not execute missing or unavailable commands', async () => {
    const registry = new CommandRegistryImpl()
    const run = vi.fn()
    registry.register(makeCommand({ id: 'needs-doc', label: 'Export document', when: (ctx) => !!ctx.documentId, run }))

    await registry.exec('missing', makeCtx())
    await registry.exec('needs-doc', makeCtx())

    expect(run).not.toHaveBeenCalled()
  })

  it('searches labels and keywords with Garden-compatible ranking', () => {
    const registry = new CommandRegistryImpl()
    registry.register([
      makeCommand({ id: 'keyword', label: 'Unrelated', keywords: ['document'] }),
      makeCommand({ id: 'contains', label: 'Export document' }),
      makeCommand({ id: 'starts', label: 'Document import' }),
      makeCommand({ id: 'hidden', label: 'Document hidden', when: () => false }),
    ])

    expect(registry.search('  DOCUMENT ', makeCtx()).map((command) => command.id)).toEqual([
      'starts',
      'contains',
      'keyword',
    ])
  })

  it('search delegates empty queries to available and keeps surface filters', () => {
    const registry = new CommandRegistryImpl()
    registry.register([
      makeCommand({ id: 'palette', label: 'New file', surfaces: ['palette'] }),
      makeCommand({ id: 'context', label: 'New node', surfaces: ['context'] }),
    ])

    expect(registry.search('', makeCtx(), 'context').map((command) => command.id)).toEqual(['context'])
    expect(registry.search('new', makeCtx(), 'palette').map((command) => command.id)).toEqual(['palette'])
  })

  it('projects available commands to menu entries grouped by category', () => {
    const registry = new CommandRegistryImpl()
    registry.register([
      makeCommand({ id: 'doc.new', label: 'New document', category: 'Document', shortcut: 'Mod+N' }),
      makeCommand({ id: 'doc.open', label: 'Open document', category: 'Document' }),
      makeCommand({ id: 'panel.chat', label: 'Chat', category: 'Panels', surfaces: ['toolbar'] }),
      makeCommand({ id: 'hidden', label: 'Hidden', category: 'Panels', when: () => false }),
    ])

    const entries = registry.toMenuEntries(makeCtx(), 'palette' as Surface)

    expect(entries).toMatchObject([
      { type: 'header', content: 'Document' },
      { id: 'doc.new', label: 'New document', shortcut: 'Mod+N' },
      { id: 'doc.open', label: 'Open document' },
    ])
    expect(entries.some((entry) => 'id' in entry && entry.id === 'panel.chat')).toBe(false)
    const item = entries.find((entry) => 'id' in entry && entry.id === 'doc.new')
    expect(item).toBeDefined()
    expect((item as unknown as Record<string, unknown>).category).toBeUndefined()
    expect((item as unknown as Record<string, unknown>).run).toBeUndefined()
    expect((item as unknown as Record<string, unknown>).surfaces).toBeUndefined()
  })

  it('inserts dividers between category groups', () => {
    const registry = new CommandRegistryImpl()
    registry.register([
      makeCommand({ id: 'doc.new', label: 'New document', category: 'Document' }),
      makeCommand({ id: 'view.chat', label: 'Chat', category: 'View' }),
    ])

    expect(registry.toMenuEntries(makeCtx())).toMatchObject([
      { type: 'header', content: 'Document' },
      { id: 'doc.new' },
      { type: 'divider' },
      { type: 'header', content: 'View' },
      { id: 'view.chat' },
    ])
  })
})
