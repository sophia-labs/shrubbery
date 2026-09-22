/**
 * COMPOSER CONTRACT LOCK — SEELe-workbench W0.1 (`plans/hoja-seele-workbench-*`).
 *
 * This file exists to FREEZE the composer contract as executable goldens. It
 * is the REJECTION CRITERION for the whole SEELe-workbench campaign: any
 * later slice that needs to edit an assertion in this file, in
 * `composer-markdown.ts`, or in the composer branch of `kernelExtensions()`
 * is rejected by definition. If a change here looks necessary, the change
 * belongs somewhere else (an additive field, a new profile branch, a new
 * function) — not here. See §4 ("The compatibility argument for the composer
 * contract") of `plans/hoja-seele-workbench-suite-20260803.md` and the W0.1
 * delta in `plans/hoja-seele-workbench-ratification-20260803.md`.
 *
 * Frozen here:
 *  - `HojaComposerDetail`'s exact field set and per-field computation
 *    (`value` via `serializeComposerMarkdown`, `plainText`, `json`,
 *    `references`, `isEmpty`) — G1, G5.6.
 *  - `composer-markdown.ts`'s seven productions round-tripping losslessly:
 *    paragraphs, hard breaks, bold, italic, inline code, links (including
 *    unsafe-href refusal), and `[[label]]` wikilinks (including escaping) —
 *    G3.
 *  - `emitLegacyPickerEvents === false` in the composer profile, `=== true`
 *    in the document profile — G5.8.
 *
 * The composer kernel-profile ROSTER lock (codeBlock/heading/lists absent
 * from composer; present in document) lives in
 * `packages/editor-kernel/src/__tests__/composer-profile.lock.test.ts` —
 * same rejection rule, split only because it exercises `@shrubbery/editor-
 * kernel` directly rather than through `<hoja-editor>`.
 *
 * NO MOCKS: every assertion runs a real `parseComposerMarkdown` /
 * `serializeComposerMarkdown`, or a real mounted `<hoja-editor>` over a real
 * TipTap `Editor`, under happy-dom.
 */
import { describe, expect, it } from 'vitest'

import {
  collectWikiLinkReferences,
  parseComposerMarkdown,
  serializeComposerMarkdown,
} from '../composer-markdown.js'
// Side-effect import: registers `<hoja-editor>`. Kept separate from the type
// import below because every use of `HojaEditor` in this file is a type
// position — a value-less named import here would get tree-shaken as
// type-only, the custom element would never register, and every mount()
// would silently construct an un-upgraded HTMLUnknownElement instead.
import '../hoja-editor.js'
import type { HojaEditor } from '../hoja-editor.js'
import { HOJA_EVENTS } from '../types.js'
import type {
  Editor,
} from '@shrubbery/editor-kernel'
import type {
  HojaComposerDetail,
  HojaJSONContent,
  HojaWikiLinkReference,
} from '../types.js'

type HojaInternals = { editor: Editor | null }

function editorOf(element: HojaEditor): Editor {
  const editor = (element as unknown as HojaInternals).editor
  if (!editor) throw new Error('Hoja editor did not mount')
  return editor
}

async function settle(element: HojaEditor): Promise<void> {
  await element.updateComplete
  await Promise.resolve()
  await element.updateComplete
}

async function mount(configure?: (element: HojaEditor) => void): Promise<HojaEditor> {
  const element = document.createElement('hoja-editor') as HojaEditor
  configure?.(element)
  document.body.appendChild(element)
  await settle(element)
  return element
}

function nodesOfType(document: HojaJSONContent, type: string): HojaJSONContent[] {
  const found: HojaJSONContent[] = []
  const visit = (node: HojaJSONContent): void => {
    if (node.type === type) found.push(node)
    for (const child of node.content ?? []) visit(child)
  }
  visit(document)
  return found
}

describe('LOCK — HojaComposerDetail field set and per-field computation', () => {
  it('exposes EXACTLY {value, plainText, json, references, isEmpty} — no more, no less', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Ask [[Living Codex]] about **this**.'
      hoja.referenceBindings = [{
        label: 'Living Codex',
        targetDocId: 'doc:living-codex',
        targetGraphId: 'sophia-code-lab',
      }]
      hoja.onChange = detail => changes.push(detail)
    })
    const editor = editorOf(element)

    editor.commands.focus('end')
    editor.commands.insertContent(' more')

    const detail = changes.at(-1)
    expect(detail).toBeDefined()
    expect(Object.keys(detail!).sort()).toEqual(
      ['isEmpty', 'json', 'plainText', 'references', 'value'].sort(),
    )
  })

  it('value is EXACTLY serializeComposerMarkdown(json) — the same object the host would compute', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'A **bold** and _italic_ and `code` thought with [a link](https://example.test/a).'
      hoja.onChange = detail => changes.push(detail)
    })
    editorOf(element).commands.focus('end')
    editorOf(element).commands.insertContent(' tail')

    const detail = changes.at(-1)!
    expect(detail.value).toBe(serializeComposerMarkdown(detail.json))
    // And it round-trips back through parseComposerMarkdown to the same JSON
    // shape the editor actually holds (modulo the reference-binding target
    // ids, which composer Markdown text alone cannot carry).
    expect(serializeComposerMarkdown(parseComposerMarkdown(detail.value))).toBe(detail.value)
  })

  it('plainText is EXACTLY the live editor text at the moment the detail was produced', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Seed'
      hoja.onChange = detail => changes.push(detail)
    })
    const editor = editorOf(element)
    editor.commands.focus('end')
    editor.commands.insertContent(' grown')

    const detail = changes.at(-1)!
    expect(detail.plainText).toBe(editor.getText())
    expect(detail.plainText).toBe('Seed grown')
  })

  it('json is a fresh TipTap snapshot — the exact document getJSON() would return', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Seed'
      hoja.onChange = detail => changes.push(detail)
    })
    const editor = editorOf(element)
    editor.commands.focus('end')
    editor.commands.insertContent(' grown')

    const detail = changes.at(-1)!
    expect(detail.json).toEqual(editor.getJSON())
  })

  it('references is EXACTLY collectWikiLinkReferences(json), in document order', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'See [[First]] then [[Second]].'
      hoja.referenceBindings = [
        { label: 'First', targetDocId: 'doc:first', targetGraphId: 'graph:a' },
        { label: 'Second', targetDocId: 'doc:second', targetGraphId: 'graph:b' },
      ]
      hoja.onChange = detail => changes.push(detail)
    })
    editorOf(element).commands.focus('end')
    editorOf(element).commands.insertContent(' tail')

    const detail = changes.at(-1)!
    expect(detail.references).toEqual(collectWikiLinkReferences(detail.json))
    expect(detail.references.map(reference => reference.targetDocId)).toEqual([
      'doc:first',
      'doc:second',
    ])
  })

  it('isEmpty is EXACTLY plainText.trim().length===0 && references.length===0', async () => {
    function formula(plainText: string, references: readonly unknown[]): boolean {
      return plainText.trim().length === 0 && references.length === 0
    }

    // Plain empty: no text, no references.
    const empty = await mount()
    const emptyEditor = editorOf(empty)
    expect(formula(emptyEditor.getText(), collectWikiLinkReferences(empty.getJSON()))).toBe(true)

    // Whitespace-only text, no references: still empty (the formula trims).
    const whitespaceChanges: HojaComposerDetail[] = []
    const whitespace = await mount(hoja => {
      hoja.onChange = detail => whitespaceChanges.push(detail)
    })
    editorOf(whitespace).commands.focus('end')
    editorOf(whitespace).commands.insertContent('   ')
    const whitespaceDetail = whitespaceChanges.at(-1)!
    expect(whitespaceDetail.isEmpty).toBe(true)
    expect(whitespaceDetail.isEmpty).toBe(formula(whitespaceDetail.plainText, whitespaceDetail.references))

    // A wikilink's `renderText` always yields `[[label]]` — even an EMPTY
    // label still yields the two bracket pairs — so plainText alone is
    // already non-empty whenever ANY wikilink is present. That is exactly
    // why the frozen formula ANDs in `references.length===0` rather than
    // trusting plainText alone (`hoja-editor.ts` invariant list, G5.6): a
    // reference always keeps isEmpty false, and it does so redundantly with
    // plainText today, but the formula — not the redundancy — is what is
    // frozen here.
    const emptyLabelDocument = parseComposerMarkdown('[[]]')
    const emptyLabelReferences = collectWikiLinkReferences(emptyLabelDocument)
    expect(emptyLabelReferences).toHaveLength(1)
    expect(emptyLabelReferences[0]?.label).toBe('')
    expect(nodesOfType(emptyLabelDocument, 'wikilink')).toHaveLength(1)

    // Prove it end-to-end through the real element: a wikilink-only message
    // never reports isEmpty, matching the formula exactly.
    const wikilinkChanges: HojaComposerDetail[] = []
    const wikilinkElement = await mount(hoja => {
      hoja.value = '[[Untitled]]'
      hoja.onChange = detail => wikilinkChanges.push(detail)
    })
    editorOf(wikilinkElement).commands.focus('end')
    editorOf(wikilinkElement).commands.insertContent(' ') // force a change event
    const wikilinkDetail = wikilinkChanges.at(-1)!
    expect(wikilinkDetail.references).toHaveLength(1)
    expect(wikilinkDetail.isEmpty).toBe(false)
    expect(wikilinkDetail.isEmpty).toBe(formula(wikilinkDetail.plainText, wikilinkDetail.references))

    // Non-empty visible text: not empty, matching the formula.
    const textChanges: HojaComposerDetail[] = []
    const textElement = await mount(hoja => {
      hoja.value = 'hello'
      hoja.onChange = detail => textChanges.push(detail)
    })
    editorOf(textElement).commands.focus('end')
    editorOf(textElement).commands.insertContent('!')
    const textDetail = textChanges.at(-1)!
    expect(textDetail.isEmpty).toBe(false)
    expect(textDetail.isEmpty).toBe(formula(textDetail.plainText, textDetail.references))
  })
})

describe('LOCK — composer-markdown.ts: the seven productions round-trip losslessly', () => {
  it('paragraphs: a blank line separates two paragraph blocks', () => {
    const value = 'First paragraph.\n\nSecond paragraph.'
    const document = parseComposerMarkdown(value)
    expect(nodesOfType(document, 'paragraph')).toHaveLength(2)
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('hardBreak: a single newline inside a paragraph is a visible hard break', () => {
    const value = 'Line one\nLine two'
    const document = parseComposerMarkdown(value)
    expect(nodesOfType(document, 'paragraph')).toHaveLength(1)
    expect(nodesOfType(document, 'hardBreak')).toHaveLength(1)
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('bold: `**text**` round-trips through the bold mark', () => {
    const value = 'plain **bold** plain'
    const document = parseComposerMarkdown(value)
    const bold = nodesOfType(document, 'text').find(node => node.text === 'bold')
    expect(bold?.marks?.map(mark => mark.type)).toEqual(['bold'])
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('italic: both `_text_` and `*text*` parse to the italic mark, canonical serialization is `_text_`', () => {
    const underscore = parseComposerMarkdown('_soft_')
    expect(underscore.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('italic')
    expect(serializeComposerMarkdown(underscore)).toBe('_soft_')

    const star = parseComposerMarkdown('*soft*')
    expect(star.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('italic')
    expect(serializeComposerMarkdown(star)).toBe('_soft_')
  })

  it('inline code: `` `text` `` round-trips through the code mark and does not escape its interior', () => {
    const value = 'run `git status --short` now'
    const document = parseComposerMarkdown(value)
    const code = nodesOfType(document, 'text').find(node => node.text === 'git status --short')
    expect(code?.marks?.map(mark => mark.type)).toEqual(['code'])
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('links: `[label](href)` round-trips through the link mark', () => {
    const value = 'see [the source](https://example.test/a?x=1) here'
    const document = parseComposerMarkdown(value)
    const link = nodesOfType(document, 'text').find(node => node.text === 'the source')
    expect(link?.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.test/a?x=1' } }])
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('links: javascript:/vbscript:/data: hrefs are REFUSED — no link mark, degrades to escaped literal text', () => {
    for (const scheme of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,x']) {
      const document = parseComposerMarkdown(`[click](${scheme})`)
      const marks = nodesOfType(document, 'text').flatMap(node => node.marks ?? [])
      expect(marks.some(mark => mark.type === 'link')).toBe(false)
      // The literal brackets survive as escaped text, and the refused href
      // text is neither dropped nor treated as link syntax any more.
      const serialized = serializeComposerMarkdown(document)
      expect(serialized).toContain(String.raw`\[click\]`)
      expect(serialized).toContain(scheme)
    }
  })

  it('links: safeHref tolerates case and leading whitespace variants of the blocked schemes', () => {
    for (const href of ['JavaScript:alert(1)', '  javascript:alert(1)', 'VBSCRIPT:x', 'DATA:text/plain,x']) {
      const document = parseComposerMarkdown(`[click](${href})`)
      const marks = nodesOfType(document, 'text').flatMap(node => node.marks ?? [])
      expect(marks.some(mark => mark.type === 'link')).toBe(false)
    }
  })

  it('links: https/http/mailto and relative hrefs are safe and keep the link mark', () => {
    for (const href of ['https://example.test', 'http://example.test', 'mailto:a@example.test', '/relative/path']) {
      const document = parseComposerMarkdown(`[go](${href})`)
      const marks = nodesOfType(document, 'text').flatMap(node => node.marks ?? [])
      expect(marks.some(mark => mark.type === 'link' && mark.attrs?.href === href)).toBe(true)
    }
  })

  it('wikilinks: `[[label]]` round-trips through the wikilink atom, host-bound target attrs attach', () => {
    const references: readonly HojaWikiLinkReference[] = [{
      label: 'Living Codex',
      targetDocId: 'doc:living-codex',
      targetGraphId: 'sophia-code-lab',
    }]
    const value = 'Ask [[Living Codex]] now.'
    const document = parseComposerMarkdown(value, references)
    const wikilink = nodesOfType(document, 'wikilink')[0]
    expect(wikilink?.attrs).toEqual(expect.objectContaining({
      label: 'Living Codex',
      targetDocId: 'doc:living-codex',
      targetGraphId: 'sophia-code-lab',
    }))
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('wikilinks: unresolved labels never invent target ids, and stay null', () => {
    const document = parseComposerMarkdown('[[Unresolved]]')
    expect(collectWikiLinkReferences(document)).toEqual([{
      label: 'Unresolved',
      targetDocId: null,
      targetGraphId: null,
      targetBlockId: null,
      blockPreview: null,
    }])
  })

  it('wikilinks: label serialization escapes backslashes and closing-bracket pairs, ignores non-label attrs', () => {
    const document: HojaJSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'wikilink',
          attrs: {
            label: String.raw`a\b]]c`,
            targetDocId: 'doc:should-not-leak',
            targetGraphId: 'graph:should-not-leak',
            wireId: 'wire:should-not-leak',
          },
        }],
      }],
    }
    const serialized = serializeComposerMarkdown(document)
    expect(serialized).toBe(String.raw`[[a\\b\]\]c]]`)
    expect(serialized).not.toContain('should-not-leak')
  })

  it('wikilinks: a missing label serializes to the "Untitled" fallback', () => {
    const document: HojaJSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'wikilink', attrs: {} }] }],
    }
    expect(serializeComposerMarkdown(document)).toBe('[[Untitled]]')
  })
})

describe('LOCK — the asymmetric escaping table and unescapeMarkdown reversal', () => {
  it('escapeText escapes exactly `\\ ` * _ [ ]` — not parens', () => {
    // Built directly as kernel JSON (bypassing parseComposerMarkdown) so the
    // parser's OWN interpretation of these characters — backslash-escapes,
    // italic delimiters, and `[]()`-shaped link syntax — cannot interfere.
    // This isolates exactly what escapeText does at serialize time.
    const raw = 'a\\b`c*d_e[f]g(h)i'
    const document: HojaJSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }],
    }
    const serialized = serializeComposerMarkdown(document)
    expect(serialized).toBe('a\\\\b\\`c\\*d\\_e\\[f\\]g(h)i')
    // Directly: none of the six special characters survive unescaped, and
    // parens are never preceded by a backslash.
    expect(serialized).toMatch(/\\\\/) // escaped backslash
    expect(serialized).toMatch(/\\`/) // escaped backtick
    expect(serialized).toMatch(/\\\*/) // escaped asterisk
    expect(serialized).toMatch(/\\_/) // escaped underscore
    expect(serialized).toMatch(/\\\[/) // escaped open bracket
    expect(serialized).toMatch(/\\\]/) // escaped close bracket
    expect(serialized).toContain('(h)') // parens survive UNescaped
    expect(serialized).not.toMatch(/\\\(/) // paren NOT escaped
    expect(serialized).not.toMatch(/\\\)/) // paren NOT escaped
  })

  it('escapeHref escapes exactly `\\` and `)` — the href-only table', () => {
    // A href containing a literal backslash and close-paren must survive
    // round-trip without corrupting the `](...)` link delimiter.
    const href = String.raw`https://example.test/a\b)c`
    const document: HojaJSONContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href } }] }],
      }],
    }
    const serialized = serializeComposerMarkdown(document)
    expect(serialized).toBe(String.raw`[go](https://example.test/a\\b\)c)`)
    // Parsing it back recovers the exact href.
    const reparsed = parseComposerMarkdown(serialized)
    const link = nodesOfType(reparsed, 'text')[0]?.marks?.find(mark => mark.type === 'link')
    expect(link?.attrs?.href).toBe(href)
  })

  it('unescapeMarkdown reverses all eight escapable characters: \\ ` * _ [ ] ( )', () => {
    const escapable = ['\\', '`', '*', '_', '[', ']', '(', ')']
    for (const character of escapable) {
      const value = `\\${character}`
      const document = parseComposerMarkdown(value)
      const text = nodesOfType(document, 'text').map(node => node.text).join('')
      expect(text).toBe(character)
    }
  })
})

describe('LOCK — emitLegacyPickerEvents is false in composer, true in document', () => {
  it('composer never leaks the legacy document-global wikilink CustomEvents', async () => {
    let openCount = 0
    let closeCount = 0
    const openListener = (): void => { openCount += 1 }
    const closeListener = (): void => { closeCount += 1 }
    document.addEventListener('open-wikilink-picker', openListener)
    document.addEventListener('close-wikilink-picker', closeListener)

    const element = await mount(hoja => {
      hoja.value = 'See '
    })
    editorOf(element).commands.focus('end')
    // Typing a wikilink trigger opens, and then closing it (Escape) closes —
    // both paths must stay instance-scoped in composer, never document-global.
    const view = editorOf(element).view
    for (const character of '[[liv') {
      const { from, to } = editorOf(element).state.selection
      view.someProp('handleTextInput', handler =>
        handler(view, from, to, character, () => {
          const tr = editorOf(element).state.tr.insertText(character, from, to)
          view.dispatch(tr)
          return tr
        }))
    }
    element.querySelector('.ProseMirror')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )

    expect(openCount).toBe(0)
    expect(closeCount).toBe(0)
    document.removeEventListener('open-wikilink-picker', openListener)
    document.removeEventListener('close-wikilink-picker', closeListener)
  })

  it('HOJA_EVENTS stays the six-member closed set, and a composer session emits only from it', async () => {
    expect(Object.values(HOJA_EVENTS).sort()).toEqual([
      'hoja-change',
      'hoja-submit',
      'hoja-wikilink-close',
      'hoja-wikilink-request',
      'hoja-wikilink-resolve-error',
      'hoja-wikilink-suggestions',
    ].sort())

    const seenEventTypes = new Set<string>()
    const element = await mount(hoja => {
      hoja.value = 'draft'
      hoja.resolveWikiLinks = () => []
    })
    for (const eventName of Object.values(HOJA_EVENTS)) {
      element.addEventListener(eventName, event => seenEventTypes.add(event.type))
    }

    // A scripted type-and-submit-adjacent session: edit, open a wikilink
    // trigger, close it, submit.
    editorOf(element).commands.focus('end')
    editorOf(element).commands.insertContent(' more')
    element.querySelector<HTMLButtonElement>('.hoja-editor__wikilink-toggle')?.click()
    await settle(element)
    element.querySelector('.ProseMirror')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await settle(element)
    element.querySelector('.ProseMirror')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )

    for (const type of seenEventTypes) {
      expect(Object.values(HOJA_EVENTS)).toContain(type)
    }
  })
})
