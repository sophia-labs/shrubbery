/**
 * W14.2 — the source projection (D16), tested against REAL TipTap JSON.
 *
 * NO MOCKS: every fixture in this file is `editor.getJSON()` off a REAL
 * `@shrubbery/editor-kernel` `Editor` (document profile — the same kernel
 * roster `<sh-editor-host>` mounts), driven through its REAL commands
 * (`setContent` / `insertContentAt` / `insertTable`), never a hand-typed
 * `JSONContent` literal handed straight to `projectSeeleSource`. That is the
 * house rule this suite names explicitly: "no hand-faked JSON where the
 * editor can produce it."
 *
 * `packages/hoja` is NOT touched and NOT exercised here — `source-projection`
 * is a pure function over the document JSON shape `<sh-editor-host>` exposes
 * (W14.1); it has no editor-kernel-specific behaviour tested that couldn't
 * equally run against the hosted path's own `getDocumentJSON()`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernelEditor, type Editor } from '@shrubbery/editor-kernel'
import {
  projectSeeleSource,
  NoSeeleSourceError,
  MultipleSeeleSourcesError,
  type SourceRegion,
} from '../source-projection.js'

// ── real-editor fixture plumbing ─────────────────────────────────────────

let editors: Editor[] = []
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
})

function mount(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, { profile: 'document' })
  editors.push(editor)
  return editor
}

function seeleFence(text: string) {
  return { type: 'codeBlock', attrs: { language: 'seele' }, content: [{ type: 'text', text }] }
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

/** Append a real node at the document's current end via a real command. */
function append(editor: Editor, node: Record<string, unknown>): void {
  const end = editor.state.doc.content.size
  editor.commands.insertContentAt(end, node)
}

/** Every `codeBlock` node's own `data-block-id`, read straight off getJSON() — the cross-check that `SourceRegion.blockId` names the SAME block W3/W2.3 would anchor to. */
function codeBlockIds(json: ReturnType<Editor['getJSON']>): (string | null)[] {
  const ids: (string | null)[] = []
  const walk = (node: any): void => {
    if (node.type === 'codeBlock') ids.push(node.attrs?.['data-block-id'] ?? null)
    for (const child of node.content ?? []) walk(child)
  }
  walk(json)
  return ids
}

// ── FENCE_TEXT — deliberately provocative bytes: '_', '*', '[[', a blank line ──
const FENCE_TEXT = 'circle: 1\n\nname: "_provoked_ [[nested]] * text"\nweight: 2\n'

describe('W14.2 — projectSeeleSource: exactly one fence', () => {
  it('returns the fence text byte-exact and a region anchored to the SAME block id getJSON() carries', () => {
    const editor = mount()
    editor.commands.setContent([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'circle-1' }] },
      paragraph('some prose ahead of the fence'),
    ])
    append(editor, seeleFence(FENCE_TEXT))

    const json = editor.getJSON()
    const [expectedBlockId] = codeBlockIds(json)
    expect(typeof expectedBlockId).toBe('string')

    const projection = projectSeeleSource(json)
    expect(projection.source).toBe(FENCE_TEXT)
    expect(projection.region.blockId).toBe(expectedBlockId)
    expect(projection.region.path.length).toBeGreaterThan(0)
  })

  it('excludes prose entirely — even prose that LOOKS like YAML — asserted byte-wise', () => {
    const editor = mount()
    editor.commands.setContent([
      paragraph('circle: 1'),
      paragraph('resourceClasses:'),
      paragraph('  garden.graph: { quota: 2 }'),
    ])
    append(editor, seeleFence('apiVersion: nature.sophia.dev/v1alpha2\n'))

    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe('apiVersion: nature.sophia.dev/v1alpha2\n')
    expect(projection.source).not.toContain('resourceClasses')
    expect(projection.source).not.toContain('quota')
  })

  it('finds the fence wherever the schema allows a codeBlock to live (nested inside a blockquote)', () => {
    const editor = mount()
    editor.commands.setContent([
      paragraph('lead-in'),
      { type: 'blockquote', content: [seeleFence('nested: true\n')] },
    ])

    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe('nested: true\n')
    // Nested one level deeper than a top-level fence would be.
    expect(projection.region.path.length).toBeGreaterThanOrEqual(2)
  })

  it('language-token matching: "seele" alone and a multi-token language both count; "yaml" alone does not', () => {
    const editor = mount()
    editor.commands.setContent([
      { type: 'codeBlock', attrs: { language: 'yaml' }, content: [{ type: 'text', text: 'plain yaml, not seele\n' }] },
      seeleFence('the one true source\n'),
    ])
    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe('the one true source\n')
  })

  it('a multi-token info string carrying the "seele" token is recognized (the honest reading of "support what exists")', () => {
    const editor = mount()
    editor.commands.setContent([
      { type: 'codeBlock', attrs: { language: 'yaml seele' }, content: [{ type: 'text', text: 'yaml seele info string\n' }] },
    ])
    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe('yaml seele info string\n')
  })

  it('language matching is case-insensitive (the attribute is an unconstrained string, not just the lowercase-only input-rule output)', () => {
    const editor = mount()
    editor.commands.setContent([seeleFence('lower\n')])
    // Overwrite with an uppercase language via the real setNodeMarkup path a
    // host-side command could take — still the SAME schema attribute.
    editor.commands.command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'codeBlock') tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: 'SEELE' })
      })
      return true
    })
    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe('lower\n')
  })

  it('the round trip over the vendored circle-1 constitution, embedded in a document with a heading, a paragraph, and a table, produces the file\'s exact bytes', () => {
    // Vendored from nature/examples/circle-1.seele.yaml (copied 2026-08-03),
    // NOT read from the sibling checkout: this test only cares about the
    // BYTES of a realistic multi-line, comment-bearing corpus surviving the
    // editor round trip — it never compiles them, so the copy cannot go
    // semantically stale. Vendoring is what closes tranche-1 finding G: the
    // old `if (!existsSync(...)) return` reported green for an assertion that
    // never ran when the sibling repo was absent. Now the fixture is part of
    // the package and a missing file is a LOUD failure, never a false pass.
    const yaml = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/circle-1.seele.yaml'),
      'utf8',
    )

    const editor = mount()
    editor.commands.setContent([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'circle-1 constitution' }] },
      paragraph('The ecology of the first revolution, authored here.'),
    ])
    editor.chain().focus('end').insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
    append(editor, seeleFence(yaml))

    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe(yaml)
  })
})

describe('W14.2 — projectSeeleSource: zero fences → NoSeeleSourceError', () => {
  it('throws a typed, named NoSeeleSourceError — never an empty compile', () => {
    const editor = mount()
    editor.commands.setContent([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'No source here' }] },
      paragraph('just prose, no fence at all'),
    ])

    let thrown: unknown
    try {
      projectSeeleSource(editor.getJSON())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(NoSeeleSourceError)
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).name).toBe('NoSeeleSource')
    expect((thrown as Error).message).toMatch(/seele/i)
  })

  it('a non-seele-tagged fence alone is still zero seele fences', () => {
    const editor = mount()
    editor.commands.setContent([
      { type: 'codeBlock', attrs: { language: 'yaml' }, content: [{ type: 'text', text: 'circle: 1\n' }] },
    ])
    expect(() => projectSeeleSource(editor.getJSON())).toThrow(NoSeeleSourceError)
  })

  it('a document with no content at all is zero fences, not a crash', () => {
    expect(() => projectSeeleSource({ type: 'doc' })).toThrow(NoSeeleSourceError)
  })
})

describe('W14.2 — projectSeeleSource: two or more fences → MultipleSeeleSourcesError', () => {
  it('throws with exactly the fences found, in document order, each with a real block id', () => {
    const editor = mount()
    editor.commands.setContent([
      paragraph('first fence below'),
      seeleFence('first: true\n'),
      paragraph('between the two'),
      seeleFence('second: true\n'),
    ])

    const json = editor.getJSON()
    const realIds = codeBlockIds(json)
    expect(realIds).toHaveLength(2)

    let thrown: unknown
    try {
      projectSeeleSource(json)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(MultipleSeeleSourcesError)
    expect((thrown as Error).name).toBe('MultipleSeeleSources')
    const err = thrown as MultipleSeeleSourcesError
    expect(err.locations).toHaveLength(2)
    expect(err.locations.map((l: SourceRegion) => l.blockId)).toEqual(realIds)
    // "listing block positions" — the message itself names each location.
    for (const id of realIds) expect(err.message).toContain(id as string)
  })

  it('three-or-more is also loud — the rule is "not exactly one", not "not two"', () => {
    const editor = mount()
    editor.commands.setContent([seeleFence('a\n'), seeleFence('b\n'), seeleFence('c\n')])
    let thrown: unknown
    try {
      projectSeeleSource(editor.getJSON())
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(MultipleSeeleSourcesError)
    expect((thrown as MultipleSeeleSourcesError).locations).toHaveLength(3)
  })
})
