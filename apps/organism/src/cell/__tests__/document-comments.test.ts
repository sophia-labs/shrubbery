import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  commentsFromYMap,
  createDocumentCommentsSource,
  type DocumentCommentData,
} from '../document-comments.js'

const baseComment: DocumentCommentData = {
  text: 'Needs a citation',
  author: 'Vera',
  authorId: 'user-vera',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  resolved: false,
  quotedText: 'selected text',
  documentPosition: 12,
  blockId: 'block-a',
}

describe('document comments source', () => {
  it('projects Garden-compatible Y.Map comment data to workspace comments', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<DocumentCommentData>('comments')
    map.set('comment-a', baseComment)

    expect(commentsFromYMap(map)).toEqual([
      {
        id: 'comment-a',
        author: 'Vera',
        text: 'Needs a citation',
        quotedText: 'selected text',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        resolved: false,
        documentPosition: 12,
        blockId: 'block-a',
      },
    ])
  })

  it('exposes reactive get/subscribe plus set/update/delete over Y.Map comments', () => {
    const source = createDocumentCommentsSource(new Y.Doc())
    const snapshots: string[][] = []
    const unsubscribe = source.subscribe((comments) => {
      snapshots.push(comments.map((comment) => `${comment.id}:${comment.text}:${comment.resolved}`))
    })

    source.set('comment-a', baseComment)
    expect(source.get().map((comment) => comment.id)).toEqual(['comment-a'])

    expect(source.update('comment-a', {
      text: 'Updated',
      resolved: true,
      updatedAt: 1700000001000,
    })).toBe(true)
    expect(source.update('missing', { text: 'Nope' })).toBe(false)
    expect(source.get()[0]).toMatchObject({
      id: 'comment-a',
      text: 'Updated',
      resolved: true,
      updatedAt: 1700000001000,
    })

    expect(source.delete('comment-a')).toBe(true)
    expect(source.delete('comment-a')).toBe(false)
    expect(source.get()).toEqual([])
    expect(snapshots).toEqual([
      ['comment-a:Needs a citation:false'],
      ['comment-a:Updated:true'],
      [],
    ])

    unsubscribe()
    source.set('comment-b', baseComment)
    expect(snapshots).toHaveLength(3)
    source.destroy()
  })

  it('observes external writes to the same comments map', () => {
    const doc = new Y.Doc()
    const source = createDocumentCommentsSource(doc)
    const seen: string[][] = []
    source.subscribe((comments) => seen.push(comments.map((comment) => comment.id)))

    doc.getMap<DocumentCommentData>('comments').set('external-comment', baseComment)

    expect(source.get().map((comment) => comment.id)).toEqual(['external-comment'])
    expect(seen).toEqual([['external-comment']])
    source.destroy()
  })
})
