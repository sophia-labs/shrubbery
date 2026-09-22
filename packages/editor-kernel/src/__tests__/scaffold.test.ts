/**
 * S0 SCAFFOLD organism proof.
 *
 * Two load-bearing assertions, both against REAL TipTap/ProseMirror (NO mocks):
 *   (a) a REAL `new Editor({ extensions: [StarterKit] })` instantiates and runs
 *       under happy-dom — getText() round-trips real content;
 *   (b) `getSchema(kernelExtensions())` does NOT throw — even though the S0
 *       roster is empty. This is the invariant we re-assert after every rung.
 */
import { describe, it, expect } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { StarterKit } from '@tiptap/starter-kit'
import { kernelExtensions, createKernelEditor } from '../index'

describe('S0 scaffold — real TipTap Editor under happy-dom', () => {
  it('(a) a REAL Editor instantiates with StarterKit and getText() works', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    const editor = new Editor({
      element,
      extensions: [StarterKit],
      content: '<p>Tlön, Uqbar, Orbis Tertius</p>',
    })

    expect(editor).toBeInstanceOf(Editor)
    expect(editor.getText()).toBe('Tlön, Uqbar, Orbis Tertius')

    // Prove the real ProseMirror view mounted into the real DOM.
    expect(element.querySelector('.ProseMirror')).not.toBeNull()

    editor.destroy()
  })

  it('reports the resolved @tiptap/core version (load-bearing for the rung)', async () => {
    // @tiptap/core's "exports" map does not expose ./package.json, so resolve the
    // module's main entry, then read the sibling package.json off the filesystem.
    const { createRequire } = await import('node:module')
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const require = createRequire(import.meta.url)
    const entry = require.resolve('@tiptap/core')
    // entry is .../@tiptap/core/dist/index.cjs (or similar); walk up to the pkg root.
    let dir = dirname(entry)
    let version = ''
    for (let i = 0; i < 5; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          name?: string
          version: string
        }
        if (pkg.name === '@tiptap/core') {
          version = pkg.version
          break
        }
      } catch {
        /* keep walking up */
      }
      dir = dirname(dir)
    }
    expect(version).toMatch(/^3\./)
    // eslint-disable-next-line no-console
    console.log('resolved @tiptap/core version:', version)
  })
})

describe('S0 scaffold — getSchema invariant', () => {
  it('(b) getSchema(kernelExtensions()) does NOT throw', () => {
    let schema: Schema | undefined
    expect(() => {
      schema = getSchema(kernelExtensions())
    }).not.toThrow()

    // A real ProseMirror Schema came back, with the minimal core node triad.
    expect(schema).toBeInstanceOf(Schema)
    expect(schema!.nodes.doc).toBeDefined()
    expect(schema!.nodes.paragraph).toBeDefined()
    expect(schema!.nodes.text).toBeDefined()
  })

  it('documents the REAL engine floor: getSchema([]) THROWS (no synthesized doc)', () => {
    // Verbatim engine behavior (NO mock) — TipTap v3 / prosemirror-model does NOT
    // synthesize a fallback doc schema for an empty roster. This is WHY the S0
    // floor is the Document/Paragraph/Text triad, not literal [].
    expect(() => getSchema([])).toThrow(/top node type/)
  })
})

describe('S0 scaffold — createKernelEditor factory', () => {
  it('mounts a REAL Editor (empty roster at S0 still yields a working doc)', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    const editor = createKernelEditor(element)
    expect(editor).toBeInstanceOf(Editor)
    // Empty roster → bare doc/paragraph/text schema; the editor is real & alive.
    expect(element.querySelector('.ProseMirror')).not.toBeNull()
    editor.destroy()
  })
})
