/**
 * S1 organism proof — CommentMark ported VERBATIM from garden.
 *
 * NO mocks: a REAL @tiptap/pm Schema (Tier-A) and a REAL TipTap Editor running
 * its REAL setComment command under happy-dom (Tier-B). Errors surface verbatim.
 *
 * CORRECTED ASSERTIONS (per the ratified design):
 *   - the mark is named 'commentMark' (tiptap-comment.ts:46), NOT 'comment'.
 *   - setComment takes an OBJECT { commentId } (the real command signature),
 *     NOT a bare string.
 */
import { describe, it, expect } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { Document } from '@tiptap/extension-document'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import { kernelExtensions } from '../index'
import { CommentMark } from '../extensions/comment-mark'

describe('S1 CommentMark — Tier-A schema (real ProseMirror Schema)', () => {
  it('getSchema(kernelExtensions()) does NOT throw and registers mark "commentMark"', () => {
    let schema: Schema | undefined
    expect(() => {
      schema = getSchema(kernelExtensions())
    }).not.toThrow()

    expect(schema).toBeInstanceOf(Schema)
    // The corrected name — 'commentMark', NOT 'comment'.
    expect(schema!.marks.commentMark).toBeDefined()
    expect(schema!.marks.comment).toBeUndefined()
  })
})

describe('S1 CommentMark — Tier-B real Editor command', () => {
  it('setComment({ commentId }) marks the selection; getHTML carries the id', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, CommentMark],
      content: '<p>El Aleph</p>',
    })

    // Select all, then run the REAL command with the OBJECT signature.
    editor.commands.selectAll()
    const ok = editor.commands.setComment({ commentId: 'c-123' })
    expect(ok).toBe(true)

    const html = editor.getHTML()
    expect(html).toContain('c-123')
    expect(html).toContain('data-comment-id')

    editor.destroy()
  })

  it('unsetComment removes the mark', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, CommentMark],
      content: '<p>Funes</p>',
    })

    editor.commands.selectAll()
    editor.commands.setComment({ commentId: 'c-xyz' })
    expect(editor.getHTML()).toContain('c-xyz')

    editor.commands.selectAll()
    editor.commands.unsetComment()
    expect(editor.getHTML()).not.toContain('c-xyz')

    editor.destroy()
  })
})
