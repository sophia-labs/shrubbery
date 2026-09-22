import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createKernelEditor, type ScheduledTagDetail } from '../index'
import { applyTagToBlockAttrs, resolveTagExpiration } from '../extensions/tag-recognition'
import { parseBlockExpirations, parseBlockTags } from '../extensions/tag-chip'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
})

function mount(opts: Parameters<typeof createKernelEditor>[1] = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, opts)
  editors.push(editor)
  return editor
}

function firstBlockAttrs(editor: Editor): Record<string, unknown> {
  const first = editor.state.doc.firstChild
  if (!first) throw new Error('first block not found')
  return first.attrs as Record<string, unknown>
}

function setSelectionAtDocEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
}

function typeText(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection
    let handled = false
    editor.view.someProp('handleTextInput', (handler) => {
      handled =
        handler(editor.view, from, to, char, () => {
          const tr = editor.state.tr.insertText(char, from, to)
          editor.view.dispatch(tr)
          return tr
        }) || handled
      return handled
    })
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to))
  }
}

function findChipPosition(editor: Editor): number {
  let pos = -1
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === 'tagChip') pos = nodePos
  })
  if (pos === -1) throw new Error('tagChip not found')
  return pos
}

describe('tag helpers', () => {
  it('parses tag attrs defensively', () => {
    expect(parseBlockTags('["decision","pragma"]')).toEqual(['decision', 'pragma'])
    expect(parseBlockTags('{"not":"array"}')).toEqual([])
    expect(parseBlockExpirations('{"event":"2026-06-22"}')).toEqual({
      event: '2026-06-22',
    })
    expect(parseBlockExpirations('bad json')).toEqual({})
  })

  it('resolves relative and absolute tag expirations', () => {
    const today = new Date('2026-06-22T00:00:00Z')
    expect(resolveTagExpiration('7d', today)).toBe('2026-06-29')
    expect(resolveTagExpiration('2026-07-04', today)).toBe('2026-07-04')
    expect(resolveTagExpiration('teamretreat', today)).toBeNull()
  })

  it('computes fallback block attrs without duplicating tags', () => {
    const { newAttrs, result } = applyTagToBlockAttrs(
      {
        'data-tags': '["decision"]',
        'data-tag-expirations': null,
      },
      '#decision',
      null,
    )
    expect(result.alreadyHadTag).toBe(true)
    expect(newAttrs['data-tags']).toBe('["decision"]')

    const scheduled = applyTagToBlockAttrs(newAttrs, 'event', '2026-06-22')
    expect(scheduled.newAttrs['data-tags']).toBe('["decision","event"]')
    expect(scheduled.newAttrs['data-tag-expirations']).toBe('{"event":"2026-06-22"}')
  })
})

describe('TagChip pure editor behavior', () => {
  it('insertTagChip inserts an inline atom and syncs block tag attrs', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a">Alpha </p>')
    setSelectionAtDocEnd(editor)

    expect(editor.commands.insertTagChip({ name: 'Decision' })).toBe(true)

    const html = editor.getHTML()
    expect(html).toContain('data-tag-chip')
    expect(html).toContain('data-name="decision"')
    expect(firstBlockAttrs(editor)['data-tags']).toBe('["decision"]')
  })

  it('deleting a chip removes its tag but preserves attrs-only tags', () => {
    const editor = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: {
            'data-block-id': 'block-a',
            'data-tags': '["decision","pragma"]',
            'data-tag-expirations': null,
          },
          content: [
            { type: 'text', text: 'Alpha ' },
            { type: 'tagChip', attrs: { name: 'decision', date: null } },
          ],
        },
      ],
    })

    const chipPos = findChipPosition(editor)
    editor.view.dispatch(editor.state.tr.delete(chipPos, chipPos + 1))

    expect(firstBlockAttrs(editor)['data-tags']).toBe('["pragma"]')
  })

  it('clicks surface through the pure KernelOptions callback', () => {
    const clicked: Array<{ name: string; date?: string | null }> = []
    const editor = mount({ onTagClick: (attrs) => clicked.push(attrs) })
    editor.commands.setContent('<p>Alpha </p>')
    setSelectionAtDocEnd(editor)
    editor.commands.insertTagChip({ name: 'todo', date: '2026-06-22' })

    const el = editor.view.dom.querySelector('[data-tag-chip]') as HTMLElement | null
    expect(el).not.toBeNull()
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(clicked).toEqual([{ name: 'todo', date: '2026-06-22' }])
  })
})

describe('TagRecognition input rule', () => {
  it('turns typed scheduled tags into chips and calls the host side-effect seam', () => {
    const scheduled: ScheduledTagDetail[] = []
    const editor = mount({
      getToday: () => '2026-06-22',
      onScheduledTag: (detail) => scheduled.push(detail),
    })
    editor.commands.setContent('<p data-block-id="block-a">Meet</p>')
    setSelectionAtDocEnd(editor)

    typeText(editor, ' #event ')

    expect(editor.getHTML()).toContain('data-name="event"')
    expect(editor.getHTML()).toContain('data-date="2026-06-22"')
    expect(firstBlockAttrs(editor)['data-tags']).toBe('["event"]')
    expect(firstBlockAttrs(editor)['data-tag-expirations']).toBe('{"event":"2026-06-22"}')
    expect(scheduled).toMatchObject([
      {
        tag: 'event',
        absoluteDate: '2026-06-22',
        sourceBlockId: 'block-a',
      },
    ])
  })

  it('turns typed categorical tags into chips without scheduled side effects', () => {
    const scheduled: ScheduledTagDetail[] = []
    const editor = mount({
      getToday: () => '2026-06-22',
      onScheduledTag: (detail) => scheduled.push(detail),
    })
    editor.commands.setContent('<p>Note</p>')
    setSelectionAtDocEnd(editor)

    typeText(editor, ' #decision ')

    expect(editor.getHTML()).toContain('data-name="decision"')
    expect(editor.getHTML()).not.toContain('data-date=')
    expect(firstBlockAttrs(editor)['data-tags']).toBe('["decision"]')
    expect(firstBlockAttrs(editor)['data-tag-expirations']).toBeNull()
    expect(scheduled).toEqual([])
  })
})
