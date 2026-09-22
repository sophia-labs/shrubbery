/**
 * S2 organism proof — the PURE BATCH ported from garden:
 * ListItem, Outliner, Search, Footnote, ImageBlock, CalendarEvent, WikiLink (node),
 * SourceMetadata, Citation, BlockTags. All depend ONLY on @tiptap/core + @tiptap/pm/*
 * (no yjs / store / fetcher / UI coupling). Footnote's Garden dialog import is
 * severed to a host-owned insertion seam; the document node/command stay real.
 *
 * NO mocks: a REAL @tiptap/pm Schema (Tier-A) and a REAL TipTap Editor +
 * a REAL document.addEventListener (Tier-B), under happy-dom. Errors verbatim.
 *
 * STRUCTURAL: ListItem's content expr references heading/codeBlock/blockquote,
 * so the BASE layer (StarterKit + standalone CodeBlock + table-set …) must be
 * present for new Schema() to build — kernelExtensions() spreads it first.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { kernelExtensions, createKernelEditor } from '../index'
import type { CitationAttrs, MarginGlossOpenTarget, WikiLinkAttrs } from '../index'

describe('S2 pure batch — Tier-A real ProseMirror Schema', () => {
  it('getSchema(kernelExtensions()) does NOT throw', () => {
    expect(() => getSchema(kernelExtensions())).not.toThrow()
  })

  it('registers every batch node by its REAL .name', () => {
    const schema = getSchema(kernelExtensions())
    expect(schema).toBeInstanceOf(Schema)

    // ListItem
    expect(schema.nodes.listItem).toBeDefined()
    // Footnote — inline atom storing self-contained note content.
    expect(schema.nodes.footnote).toBeDefined()
    // ImageBlock — note the node name is 'image' (lowercase), NOT 'imageBlock'.
    expect(schema.nodes.image).toBeDefined()
    // CalendarEvent — block atom; Lit specimen NodeView is severed from the kernel.
    expect(schema.nodes.calendarEvent).toBeDefined()
    // WikiLink — the NODE, name 'wikilink' (lowercase).
    expect(schema.nodes.wikilink).toBeDefined()
    // Citation — inline atom for Zotero/source chips.
    expect(schema.nodes.citation).toBeDefined()

    // The base nodes ListItem structurally depends on are all present.
    expect(schema.nodes.heading).toBeDefined()
    expect(schema.nodes.codeBlock).toBeDefined()
    expect(schema.nodes.blockquote).toBeDefined()
    expect(schema.nodes.paragraph).toBeDefined()
    // table-set (Outliner's OUTLINER_NODE_TYPES references 'table').
    expect(schema.nodes.table).toBeDefined()
  })

  it('ListItem content expr referents resolve (no missing-node throw)', () => {
    const schema = getSchema(kernelExtensions())
    // The very expression that throws when a referent is absent.
    expect(schema.nodes.listItem.spec.content).toBe(
      '(paragraph | heading | codeBlock | blockquote)+',
    )
  })

  it('Outliner/Search/SourceMetadata/BlockTags register as extensions (no nodes), schema still builds', () => {
    // These are pure Extensions (global attrs / decorations / commands) — they
    // add NO nodes/marks but MUST not break schema construction.
    const schema = getSchema(kernelExtensions())
    // SourceMetadata + BlockTags add global attrs onto block nodes; prove one
    // of those attrs is present on paragraph.
    const paraAttrs = Object.keys(schema.nodes.paragraph.spec.attrs ?? {})
    expect(paraAttrs).toContain('data-tags')
    expect(paraAttrs).toContain('data-source-format')
    // Outliner adds an 'indent' global attr onto paragraph.
    expect(paraAttrs).toContain('indent')
  })
})

function findNode(
  json: unknown,
  type: string,
): { type: string; attrs?: Record<string, unknown> } | undefined {
  const node = json as { type?: string; content?: unknown[]; attrs?: Record<string, unknown> }
  if (node.type === type) return node as { type: string; attrs?: Record<string, unknown> }
  for (const child of node.content ?? []) {
    const found = findNode(child, type)
    if (found) return found
  }
  return undefined
}

describe('S2 pure batch — Tier-B real editor behavior', () => {
  let editors: Editor[] = []
  afterEach(() => {
    for (const e of editors) e.destroy()
    editors = []
  })

  function mount(opts = {}) {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = createKernelEditor(element, opts)
    editors.push(editor)
    return editor
  }

  it('insertImage inserts a real image node carrying its src', () => {
    const editor = mount()
    editor.commands.setContent('<p>before</p>')
    editor.commands.insertImage({ src: 'https://x/y.png', alt: 'El jardín' })
    const html = editor.getHTML()
    expect(html).toContain('https://x/y.png')
    expect(html).toContain('El jardín')
  })

  it('insertCalendarEvent inserts a pure calendarEvent atom with stable attrs', () => {
    const editor = mount()
    editor.commands.setContent('<p>before</p>')
    const ok = editor.commands.insertCalendarEvent({
      id: 'event-2026',
      title: 'Review Shrubbery',
      location: 'Lab',
      annotation: 'port checkpoint',
      allDay: false,
      timeStart: '2026-06-23T09:00',
      timeEnd: '2026-06-23T10:00',
      source: 'manual',
      externalEventId: 'src:block-a',
    })
    expect(ok).toBe(true)
    const node = findNode(editor.getJSON(), 'calendarEvent')
    expect(node?.attrs).toMatchObject({
      id: 'event-2026',
      title: 'Review Shrubbery',
      location: 'Lab',
      annotation: 'port checkpoint',
      allDay: false,
      timeStart: '2026-06-23T09:00',
      timeEnd: '2026-06-23T10:00',
      source: 'manual',
      externalEventId: 'src:block-a',
    })
    const html = editor.getHTML()
    expect(html).toContain('data-calendar-event')
    expect(html).toContain('data-block-id="event-2026"')
    expect(html).toContain('Review Shrubbery')
  })

  it('insertFootnote inserts a real footnote node carrying content', () => {
    const editor = mount()
    editor.commands.setContent('<p>before</p>')
    editor.commands.focus('end')
    const ok = editor.commands.insertFootnote({ content: 'A note about Borges' })
    expect(ok).toBe(true)
    const html = editor.getHTML()
    expect(html).toContain('data-footnote-content="A note about Borges"')
    expect(html).toContain('footnote-ref')
    expect(findNode(editor.getJSON(), 'footnote')?.attrs?.content).toBe('A note about Borges')
  })

  it('insertWikiLink inserts a real wikilink node', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.insertWikiLink({ targetDocId: 'doc-123', label: 'Tlön' })
    const html = editor.getHTML()
    expect(html).toContain('data-target-doc-id="doc-123"')
    expect(html).toContain('Tlön')
    expect(editor.getText()).toBe('[[Tlön]]')
  })

  it('WikiLink Mod-Shift-k fires document CustomEvent("open-wikilink-picker") — REAL listener', () => {
    const editor = mount()
    editor.commands.setContent('<p>x</p>')
    editor.commands.focus('end')

    // Reach the LIVE wikilink extension and invoke its REAL Mod-Shift-k handler
    // (the exact ported function: `() => { document.dispatchEvent(new
    // CustomEvent('open-wikilink-picker')); return true }`). We invoke the real
    // shortcut rather than synthesize an OS keydown because happy-dom does not
    // faithfully simulate ProseMirror's w3c-keyname keymap dispatch — but the
    // function under test, and the DOM CustomEvent it fires, are 100% real.
    const wl = editor.extensionManager.extensions.find((e) => e.name === 'wikilink')!
    const shortcuts = (
      wl.config as {
        addKeyboardShortcuts: (this: unknown) => Record<string, (p: { editor: Editor }) => boolean>
      }
    ).addKeyboardShortcuts.call({
      editor,
      name: 'wikilink',
      options: (wl as unknown as { options: unknown }).options,
      storage: (wl as unknown as { storage: unknown }).storage,
    })

    let fired = false
    const listener = () => {
      fired = true
    }
    document.addEventListener('open-wikilink-picker', listener)
    try {
      const ret = shortcuts['Mod-Shift-k']({ editor })
      expect(ret).toBe(true)
      expect(fired).toBe(true)
    } finally {
      document.removeEventListener('open-wikilink-picker', listener)
    }
  })

  it('WikiLink Mod-Shift-k uses the injected callback without a document-global event', () => {
    let callbacks = 0
    let leaked = 0
    const editor = mount({
      onWikiLinkPickerOpen: () => {
        callbacks += 1
      },
    })
    editor.commands.setContent('<p>x</p>')
    editor.commands.focus('end')

    const wl = editor.extensionManager.extensions.find((e) => e.name === 'wikilink')!
    const shortcuts = (
      wl.config as {
        addKeyboardShortcuts: (this: unknown) => Record<string, (p: { editor: Editor }) => boolean>
      }
    ).addKeyboardShortcuts.call({
      editor,
      name: 'wikilink',
      options: (wl as unknown as { options: unknown }).options,
      storage: (wl as unknown as { storage: unknown }).storage,
    })

    const listener = (): void => {
      leaked += 1
    }
    document.addEventListener('open-wikilink-picker', listener)
    try {
      expect(shortcuts['Mod-Shift-k']({ editor })).toBe(true)
      expect(callbacks).toBe(1)
      expect(leaked).toBe(0)
    } finally {
      document.removeEventListener('open-wikilink-picker', listener)
    }
  })

  it('WikiLink onWikiLinkClick callback (host seam) is plumbed via KernelOptions', () => {
    let clicked: WikiLinkAttrs | null = null
    const editor = mount({ onWikiLinkClick: (a: WikiLinkAttrs) => (clicked = a) })
    editor.commands.setContent('<p></p>')
    editor.commands.insertWikiLink({ targetDocId: 'doc-7', label: 'Funes' })

    // Find the rendered wikilink in the real DOM and click it.
    const el = editor.view.dom.querySelector('.wikilink') as HTMLElement
    expect(el).not.toBeNull()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicked).not.toBeNull()
    expect(clicked!.targetDocId).toBe('doc-7')
  })

  it('insertCitation inserts a real citation chip node', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    const ok = editor.commands.insertCitation({
      artifactId: 'zot-A1',
      zoteroKey: 'A1',
      citation: 'Brown et al. (1989). Situated cognition.',
    })
    expect(ok).toBe(true)
    const html = editor.getHTML()
    expect(html).toContain('data-citation-chip')
    expect(html).toContain('data-artifact-id="zot-A1"')
    expect(html).toContain('Brown et al. (1989)')
    expect(findNode(editor.getJSON(), 'citation')?.attrs).toMatchObject({
      artifactId: 'zot-A1',
      zoteroKey: 'A1',
      citation: 'Brown et al. (1989). Situated cognition.',
    })
  })

  it('Citation onCitationClick callback (host seam) is plumbed via KernelOptions', () => {
    let clicked: CitationAttrs | null = null
    const editor = mount({ onCitationClick: (a: CitationAttrs) => (clicked = a) })
    editor.commands.setContent('<p></p>')
    editor.commands.insertCitation({
      artifactId: 'zot-A1',
      zoteroKey: 'A1',
      citation: 'Brown et al. (1989). Situated cognition.',
    })

    const el = editor.view.dom.querySelector('[data-citation-chip]') as HTMLElement
    expect(el).not.toBeNull()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicked).toEqual({
      artifactId: 'zot-A1',
      zoteroKey: 'A1',
      citation: 'Brown et al. (1989). Situated cognition.',
    })
  })

  it('Outliner fold affordance is a real accessible button with keyboard and pointer activation', () => {
    const editor = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { indent: 0, collapsed: false, 'data-block-id': 'block-a' },
          content: [{ type: 'text', text: 'Parent' }],
        },
        {
          type: 'paragraph',
          attrs: { indent: 1, collapsed: false, 'data-block-id': 'block-b' },
          content: [{ type: 'text', text: 'Child' }],
        },
      ],
    })

    const button = editor.view.dom.querySelector('.outliner-fold-button') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(button!.tagName).toBe('BUTTON')
    expect(button!.getAttribute('aria-expanded')).toBe('true')
    expect(button!.getAttribute('aria-label')).toBe('Collapse block')

    button!.focus()
    button!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )

    const collapsedBlock = editor.getJSON().content?.[0]
    expect(collapsedBlock?.attrs?.collapsed).toBe(true)
    const collapsedButton = editor.view.dom.querySelector('.outliner-fold-button') as HTMLButtonElement | null
    expect(collapsedButton?.getAttribute('aria-expanded')).toBe('false')
    expect(collapsedButton?.getAttribute('aria-label')).toBe('Expand block')
    expect(document.activeElement).toBe(collapsedButton)

    collapsedButton!.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
      }),
    )

    const expandedBlock = editor.getJSON().content?.[0]
    expect(expandedBlock?.attrs?.collapsed).toBe(false)
    expect(editor.view.dom.querySelector('.outliner-fold-button')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('ListItem: bullet toggle wraps a paragraph into a real listItem', () => {
    const editor = mount()
    editor.commands.setContent('<p>item</p>')
    editor.commands.selectAll()
    const ok = editor.commands.toggleBulletItem()
    expect(ok).toBe(true)
    const json = editor.getJSON()
    const types = (json.content ?? []).map((n) => n.type)
    expect(types).toContain('listItem')
  })

  it('Search: setSearchTerm finds matches in a real document', () => {
    const editor = mount()
    editor.commands.setContent('<p>alpha beta alpha gamma alpha</p>')
    const ok = editor.commands.setSearchTerm('alpha')
    expect(ok).toBe(true)
    const searchStorage = (editor.storage as unknown as Record<string, unknown>)
      .search as { results: unknown[] }
    expect(searchStorage.results.length).toBe(3)
  })

  it('MarginGloss renders pure wire decorations and reports target opens through KernelOptions', () => {
    let opened: MarginGlossOpenTarget | null = null
    const editor = mount({ onMarginGlossOpen: (target: MarginGlossOpenTarget) => (opened = target) })
    editor.commands.setContent('<p data-block-id="block-alpha">Alpha</p>')

    const ok = editor.commands.updateMarginGloss(
      [
        {
          id: 'wire-1',
          predicate: 'http://mnemosyne.ai/vocab#supports',
          predicateLabel: 'supports',
          otherGraphId: 'g-target',
          otherDocumentId: 'doc-target',
          otherBlockId: 'block-target',
          localBlockId: 'block-alpha',
          otherTitle: 'Target Doc',
          otherSnippet: 'Target snippet',
        },
      ],
      [],
    )
    expect(ok).toBe(true)

    const widget = editor.view.dom.querySelector('.mg-widget') as HTMLElement | null
    expect(widget).not.toBeNull()
    expect(widget?.querySelector('.mg-predicate')?.textContent).toContain('supports')
    expect(widget?.querySelector('.mg-target')?.textContent).toBe('Target Doc')
    expect(widget?.querySelector('.mg-snippet')?.textContent).toBe('Target snippet')

    widget?.querySelector('.mg-note')?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    expect(opened).toEqual({
      wireId: 'wire-1',
      graphId: 'g-target',
      documentId: 'doc-target',
      blockId: 'block-target',
    })
  })
})
