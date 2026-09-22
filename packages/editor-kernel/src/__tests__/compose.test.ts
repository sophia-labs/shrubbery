/**
 * S5 COMPOSE — the kernel as a finished organism.
 *
 * Proves the composed surface end-to-end:
 *   - createKernelEditor mounts a REAL TipTap Editor and survives a real
 *     MULTI-EXTENSION edit (heading + wikilink + comment) — asserting getJSON
 *     reflects all three (base heading, custom WikiLink node, CommentMark mark).
 *   - Tier-A: the FULL v1 roster is present by real .name AND ZERO collaboration
 *     marks/nodes leaked into the schema (the purity invariant, checked at the
 *     schema level, not just the lockfile).
 *   - DEFER.md exists and lists EVERY deferred extension by name (the honest
 *     provenance ledger is real, not a claim).
 *
 * NO mocks: a REAL @tiptap/pm Schema + a REAL TipTap Editor under happy-dom +
 * the REAL DEFER.md file read off disk. Errors surface verbatim.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Editor, getSchema } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { kernelExtensions, createKernelEditor } from '../index'

const HERE = dirname(fileURLToPath(import.meta.url))
// packages/editor-kernel/src/__tests__ -> packages/editor-kernel/DEFER.md
const DEFER_MD = resolve(HERE, '..', '..', 'DEFER.md')

// The full v1 roster, by each extension's REAL .name (verified against the
// ported source files). Base nodes/marks come from StarterKit + the table set +
// CopyableCodeBlock (same `codeBlock` schema); customs are the pure ports.
const V1_NODE_NAMES = [
  // base / StarterKit
  'doc',
  'paragraph',
  'text',
  'blockquote',
  'hardBreak',
  'heading',
  'horizontalRule',
  // CopyableCodeBlock retains the `codeBlock` schema (the codeBlock-class fix)
  'codeBlock',
  // table set
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  // customs
  'listItem',
  'footnote',
  'image',
  'calendarEvent',
  'mathInline',
  'mathBlock',
  'wikilink',
  'tagChip',
] as const

const V1_MARK_NAMES = [
  // base / StarterKit
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'underline',
  'highlight',
  'textStyle',
  // custom
  'commentMark',
] as const

// Custom EXTENSIONS by real .name (not all register a node/mark — some are
// pure plugins / global-attr providers).
const V1_CUSTOM_EXTENSION_NAMES = [
  'commentMark',
  'listItem',
  'outliner',
  'blockSelection',
  'blockDnd',
  'outlinerZoom',
  'search',
  'footnote',
  'image',
  'calendarEvent',
  'mathInline',
  'mathBlock',
  'marginGloss',
  'wikilink',
  'wikilinkAutocomplete',
  'sourceMetadata',
  'tagChip',
  'tagRecognition',
  'tagAutocomplete',
  'blockTags',
  'blockId',
  'wireShortcuts',
] as const

// Collab names that MUST NOT appear anywhere — the purity invariant at the
// schema/extension level (the lockfile tripwire is the dependency-closure half).
const FORBIDDEN_COLLAB_NAMES = [
  'collaboration',
  'collaborationCursor',
  'collaboration-cursor',
]

// Every extension the DEFER.md ledger must name as excluded.
const DEFERRED_NAMES = [
  'Collaboration',
  'CollaborationCursor',
  'WikiLinkSuggestion',
  'TagSuggestion',
]

describe('S5 compose — Tier-A full v1 roster + zero collab', () => {
  it('getSchema(kernelExtensions()) does NOT throw and builds a real Schema', () => {
    let schema: Schema | undefined
    expect(() => {
      schema = getSchema(kernelExtensions())
    }).not.toThrow()
    expect(schema).toBeInstanceOf(Schema)
  })

  it('every v1 NODE is registered by its real name', () => {
    const schema = getSchema(kernelExtensions())
    for (const name of V1_NODE_NAMES) {
      expect(schema.nodes[name], `missing node: ${name}`).toBeDefined()
    }
  })

  it('every v1 MARK is registered by its real name', () => {
    const schema = getSchema(kernelExtensions())
    for (const name of V1_MARK_NAMES) {
      expect(schema.marks[name], `missing mark: ${name}`).toBeDefined()
    }
  })

  it('every custom EXTENSION is present in the extension manager by real .name', () => {
    const element = document.createElement('div')
    const editor = new Editor({ element, extensions: kernelExtensions() })
    const present = new Set(editor.extensionManager.extensions.map((e) => e.name))
    for (const name of V1_CUSTOM_EXTENSION_NAMES) {
      expect(present.has(name), `missing extension: ${name}`).toBe(true)
    }
    editor.destroy()
  })

  it('COLLAB MODE still leaks ZERO collaboration — it only removes history, adds nothing', () => {
    // The history-ownership handoff must NOT smuggle collab into the kernel. With
    // collaborative:true the roster is byte-identical EXCEPT the undo-redo
    // extension is absent — it still imports ONLY @tiptap/*. Prove the schema +
    // extension manager carry zero collab names (the Collaboration plane lives
    // entirely in the host, appended AFTER this roster).
    const schema = getSchema(kernelExtensions({ collaborative: true }))
    for (const bad of FORBIDDEN_COLLAB_NAMES) {
      expect(schema.nodes[bad], `collab node leaked: ${bad}`).toBeUndefined()
      expect(schema.marks[bad], `collab mark leaked: ${bad}`).toBeUndefined()
    }
    // The full custom roster is still present (only history was dropped).
    for (const name of V1_NODE_NAMES) {
      expect(schema.nodes[name], `missing node under collab mode: ${name}`).toBeDefined()
    }

    const element = document.createElement('div')
    const editor = new Editor({ element, extensions: kernelExtensions({ collaborative: true }) })
    const names = editor.extensionManager.extensions.map((e) => e.name.toLowerCase())
    for (const n of names) {
      expect(n.includes('collaboration')).toBe(false)
    }
    // History is OMITTED under collab mode (the only difference from default).
    expect(names).not.toContain('undoredo')
    editor.destroy()
  })

  it('ZERO collaboration nodes/marks/extensions leaked', () => {
    const schema = getSchema(kernelExtensions())
    // No disabled StarterKit lists either (sanity: the cut held).
    expect(schema.nodes.bulletList).toBeUndefined()
    expect(schema.nodes.orderedList).toBeUndefined()

    for (const bad of FORBIDDEN_COLLAB_NAMES) {
      expect(schema.nodes[bad], `collab node leaked: ${bad}`).toBeUndefined()
      expect(schema.marks[bad], `collab mark leaked: ${bad}`).toBeUndefined()
    }

    const element = document.createElement('div')
    const editor = new Editor({ element, extensions: kernelExtensions() })
    const names = editor.extensionManager.extensions.map((e) => e.name.toLowerCase())
    for (const n of names) {
      expect(n.includes('collaboration')).toBe(false)
    }
    editor.destroy()
  })
})

describe('S5 compose — Tier-B real multi-extension edit (heading + wikilink + comment)', () => {
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

  it('a heading + wikilink + comment edit all land in getJSON', () => {
    const clicked: unknown[] = []
    const editor = mount({
      onWikiLinkClick: (attrs: unknown) => clicked.push(attrs),
    })

    // 1) HEADING (base / StarterKit): set an H2 with text, then comment it.
    editor.chain().focus().setNode('heading', { level: 2 }).insertContent('Funes').run()
    editor.chain().selectAll().setComment({ commentId: 'c-borges' }).run()

    // 2) WIKILINK (custom node): move to end, add a paragraph, insert the node.
    editor.chain().focus('end').insertContent('<p></p>').run()
    editor
      .chain()
      .focus('end')
      .insertWikiLink({
        targetDocId: 'doc-tlon',
        label: 'Tlön',
        targetGraphId: 'sophia-code-lab',
      })
      .run()

    const json = editor.getJSON()
    const flat: string[] = []
    const walk = (node: { type?: string; content?: unknown[]; marks?: { type: string }[] }) => {
      if (node.type) flat.push(node.type)
      for (const m of node.marks ?? []) flat.push(`mark:${m.type}`)
      for (const c of (node.content as typeof flat & { type?: string }[]) ?? []) {
        walk(c as Parameters<typeof walk>[0])
      }
    }
    walk(json as Parameters<typeof walk>[0])

    // heading node present...
    expect(flat).toContain('heading')
    // ...wikilink node present (real custom node, lowercase name)...
    expect(flat).toContain('wikilink')
    // ...commentMark mark present on the heading's text.
    expect(flat).toContain('mark:commentMark')

    // And the wikilink carries the attrs we inserted (getJSON, not HTML).
    const wikilinkNode = findNode(json, 'wikilink')
    expect(wikilinkNode).toBeDefined()
    expect((wikilinkNode!.attrs as Record<string, unknown>).targetDocId).toBe('doc-tlon')
    expect((wikilinkNode!.attrs as Record<string, unknown>).label).toBe('Tlön')

    // The heading's text node carries the commentMark with our id.
    const html = editor.getHTML()
    expect(html).toContain('c-borges')
  })
})

describe('S5 compose — DEFER.md is a real, complete ledger', () => {
  it('DEFER.md exists and lists EVERY deferred extension by name', () => {
    const text = readFileSync(DEFER_MD, 'utf8')
    for (const name of DEFERRED_NAMES) {
      expect(text, `DEFER.md does not mention deferred ext: ${name}`).toContain(name)
    }
  })

  it('DEFER.md states the honest provenance (curated mix, NOT mirrors-barrel)', () => {
    const text = readFileSync(DEFER_MD, 'utf8')
    // It must explicitly NOT claim to mirror the barrel, and must name the barrel
    // as a purity signal, not a membership signal.
    expect(text).toContain('NOT')
    expect(text).toMatch(/purity signal/i)
    expect(text).toMatch(/membership signal/i)
    expect(text).toMatch(/curated/i)
  })
})

// --- helpers ---
function findNode(
  json: unknown,
  type: string,
): { type: string; attrs?: Record<string, unknown> } | undefined {
  const node = json as { type?: string; content?: unknown[]; attrs?: Record<string, unknown> }
  if (node.type === type) return node as { type: string; attrs?: Record<string, unknown> }
  for (const c of node.content ?? []) {
    const found = findNode(c, type)
    if (found) return found
  }
  return undefined
}
