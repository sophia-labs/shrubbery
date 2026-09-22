/**
 * COMPOSER-PROFILE ROSTER LOCK — SEELe-workbench W0.1
 * (`plans/hoja-seele-workbench-*`).
 *
 * This file exists to FREEZE the composer kernel-profile roster as an
 * executable golden. It is the REJECTION CRITERION for the whole
 * SEELe-workbench campaign: any later slice that needs to edit an assertion
 * in this file, or the composer branch of `baseExtensions()` /
 * `kernelExtensions()`, is rejected by definition. See §4 ("The
 * compatibility argument for the composer contract") of
 * `plans/hoja-seele-workbench-suite-20260803.md`, guarantee G2 and invariant
 * G5.3/G5.8, and the W0.1 delta in
 * `plans/hoja-seele-workbench-ratification-20260803.md`.
 *
 * Frozen here:
 *  - `composer` profile: `codeBlock`, `heading`, `bulletList`, `orderedList`,
 *    `listItem`, `blockquote`, and `horizontalRule` are ABSENT from the
 *    built schema — a composer is deliberately not a page editor
 *    (`base.ts:86-109`).
 *  - `document` profile (default, no `profile` option or `profile:
 *    'document'`): the SAME node classes are PRESENT — `codeBlock` (via
 *    `CopyableCodeBlock`), `heading` (levels [1,2,3]), and `listItem` (the
 *    custom flat-Outliner `ListItem`, not StarterKit's).
 *  - The composer roster stays EXACTLY `baseExtensions('composer') +
 *    WikiLink + WikiLinkAutocomplete` — no document-only extension
 *    (Outliner, BlockSelection, SlashCommand, Citation, TagChip, BlockId,
 *    …) ever reaches composer (`index.ts:153-162`).
 *  - `emitLegacyPickerEvents` is wired to `profile === 'document'` on BOTH
 *    `WikiLink` and `WikiLinkAutocomplete` — `false` in composer, `true` in
 *    document (`index.ts:143,150`).
 *
 * The `HojaComposerDetail` field-set/computation lock and the
 * composer-markdown production locks live in
 * `packages/hoja/src/__tests__/composer-contract.lock.test.ts` — same
 * rejection rule, split only because this file exercises
 * `@shrubbery/editor-kernel` directly rather than through `<hoja-editor>`.
 *
 * NO MOCKS: every assertion runs a REAL `@tiptap/pm` `Schema` via
 * `getSchema()` and a REAL `Editor`'s `extensionManager`, under happy-dom —
 * the same pattern as `base.test.ts`'s S3 organism proof.
 */
import { Editor, getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { baseExtensions } from '../base'
import { kernelExtensions } from '../index'

const DOCUMENT_ONLY_NODES = [
  'codeBlock',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',
] as const

describe('LOCK — composer profile schema: codeBlock/heading/lists absent', () => {
  it('getSchema(baseExtensions({ profile: "composer" })) has NONE of the document-only node types', () => {
    const schema = getSchema(baseExtensions({ profile: 'composer' }))
    for (const nodeName of DOCUMENT_ONLY_NODES) {
      expect(schema.nodes[nodeName], `composer schema unexpectedly has "${nodeName}"`).toBeUndefined()
    }
  })

  it('getSchema(kernelExtensions({ profile: "composer" })) also has NONE of them — the roster addition does not reintroduce them', () => {
    const schema = getSchema(kernelExtensions({ profile: 'composer' }))
    for (const nodeName of DOCUMENT_ONLY_NODES) {
      expect(schema.nodes[nodeName], `composer kernel schema unexpectedly has "${nodeName}"`).toBeUndefined()
    }
  })

  it('composer schema DOES have paragraph/text/hardBreak and the inline marks a chat surface needs', () => {
    const schema = getSchema(kernelExtensions({ profile: 'composer' }))
    expect(schema.nodes.doc).toBeDefined()
    expect(schema.nodes.paragraph).toBeDefined()
    expect(schema.nodes.text).toBeDefined()
    expect(schema.nodes.hardBreak).toBeDefined()
    expect(schema.nodes.wikilink).toBeDefined()
    expect(schema.marks.bold).toBeDefined()
    expect(schema.marks.italic).toBeDefined()
    expect(schema.marks.code).toBeDefined()
    expect(schema.marks.link).toBeDefined()
    // Composer-disabled marks (strike, underline) are also absent.
    expect(schema.marks.strike).toBeUndefined()
    expect(schema.marks.underline).toBeUndefined()
  })
})

describe('LOCK — document profile schema HAS codeBlock/heading/lists (the mirror)', () => {
  it('getSchema(baseExtensions()) (default profile) has codeBlock and heading[1,2,3]', () => {
    const schema = getSchema(baseExtensions())
    expect(schema.nodes.codeBlock).toBeDefined()
    expect(schema.nodes.heading).toBeDefined()
  })

  it('getSchema(kernelExtensions()) (default profile) has codeBlock, heading, AND listItem (the custom flat ListItem)', () => {
    const schema = getSchema(kernelExtensions())
    expect(schema.nodes.codeBlock).toBeDefined()
    expect(schema.nodes.heading).toBeDefined()
    expect(schema.nodes.listItem).toBeDefined()
  })

  it('getSchema(kernelExtensions({ profile: "document" })) is identical in node shape to the default (document is the default)', () => {
    const defaultSchema = getSchema(kernelExtensions())
    const explicitSchema = getSchema(kernelExtensions({ profile: 'document' }))
    expect(Object.keys(explicitSchema.nodes).sort()).toEqual(Object.keys(defaultSchema.nodes).sort())
  })

  it('heading stays constrained to levels [1,2,3] in document profile', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: kernelExtensions(),
    })
    const headingExt = editor.extensionManager.extensions.find(extension => extension.name === 'heading')!
    expect((headingExt.options as { levels: number[] }).levels).toEqual([1, 2, 3])
    editor.destroy()
  })
})

describe('LOCK — the composer roster stays EXACTLY baseExtensions(\'composer\') + WikiLink + WikiLinkAutocomplete', () => {
  it('extension name SET: kernel composer roster === base composer roster + {wikilink, wikilinkAutocomplete}, no document-only extras', () => {
    const baseEditor = new Editor({
      element: document.createElement('div'),
      extensions: baseExtensions({ profile: 'composer' }),
    })
    const kernelEditor = new Editor({
      element: document.createElement('div'),
      extensions: kernelExtensions({ profile: 'composer' }),
    })

    const baseNames = baseEditor.extensionManager.extensions.map(extension => extension.name)
    const kernelNames = kernelEditor.extensionManager.extensions.map(extension => extension.name)

    // TipTap's ExtensionManager sorts by declared priority, not insertion
    // order, so this compares membership (a multiset via sorted arrays)
    // rather than positional order — the invariant is "which extensions",
    // not "in what order the manager schedules them".
    expect(kernelNames.length).toBe(baseNames.length + 2)
    expect([...kernelNames].sort()).toEqual([...baseNames, 'wikilink', 'wikilinkAutocomplete'].sort())

    // None of the document-only extensions leak into composer by name.
    const documentOnlyExtensionNames = [
      'commentMark',
      'listItem',
      'outliner',
      'blockSelection',
      'blockDnd',
      'outlinerZoom',
      'search',
      'footnote',
      'imageBlock',
      'calendarEvent',
      'queryBlock',
      'inlineMath',
      'blockMath',
      'marginGloss',
      'slashCommand',
      'citation',
      'sourceMetadata',
      'tagChip',
      'tagRecognition',
      'tagAutocomplete',
      'blockTags',
      'blockId',
      'wireShortcuts',
    ]
    for (const name of documentOnlyExtensionNames) {
      expect(kernelNames, `composer roster unexpectedly carries "${name}"`).not.toContain(name)
    }

    baseEditor.destroy()
    kernelEditor.destroy()
  })

  it('document profile roster carries the document-only extensions the composer roster lacks', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: kernelExtensions(),
    })
    const names = editor.extensionManager.extensions.map(extension => extension.name)
    expect(names).toContain('outliner')
    expect(names).toContain('blockSelection')
    expect(names).toContain('slashCommand')
    expect(names).toContain('blockId')
    expect(names).toContain('wikilink')
    expect(names).toContain('wikilinkAutocomplete')
    editor.destroy()
  })
})

describe('LOCK — emitLegacyPickerEvents wired to profile === \'document\'', () => {
  it('composer profile: both wikilink extensions carry emitLegacyPickerEvents === false', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: kernelExtensions({ profile: 'composer' }),
    })
    const wikilink = editor.extensionManager.extensions.find(extension => extension.name === 'wikilink')!
    const wikilinkAutocomplete = editor.extensionManager.extensions.find(
      extension => extension.name === 'wikilinkAutocomplete',
    )!
    expect((wikilink.options as { emitLegacyPickerEvents: boolean }).emitLegacyPickerEvents).toBe(false)
    expect(
      (wikilinkAutocomplete.options as { emitLegacyPickerEvents: boolean }).emitLegacyPickerEvents,
    ).toBe(false)
    editor.destroy()
  })

  it('document profile (default): both wikilink extensions carry emitLegacyPickerEvents === true', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: kernelExtensions(),
    })
    const wikilink = editor.extensionManager.extensions.find(extension => extension.name === 'wikilink')!
    const wikilinkAutocomplete = editor.extensionManager.extensions.find(
      extension => extension.name === 'wikilinkAutocomplete',
    )!
    expect((wikilink.options as { emitLegacyPickerEvents: boolean }).emitLegacyPickerEvents).toBe(true)
    expect(
      (wikilinkAutocomplete.options as { emitLegacyPickerEvents: boolean }).emitLegacyPickerEvents,
    ).toBe(true)
    editor.destroy()
  })

  it('explicit profile: "document" behaves identically to the default (document IS the default)', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: kernelExtensions({ profile: 'document' }),
    })
    const wikilink = editor.extensionManager.extensions.find(extension => extension.name === 'wikilink')!
    expect((wikilink.options as { emitLegacyPickerEvents: boolean }).emitLegacyPickerEvents).toBe(true)
    editor.destroy()
  })
})
