import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import { applyDrop, getOutlinerBlocks } from '@shrubbery/editor-kernel'
import { createLiveCollabEditor } from '../collab/live-editor.js'

const editors: Editor[] = []
const docs: Y.Doc[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  while (docs.length) docs.pop()?.destroy()
})

function makeEditor(doc: Y.Doc): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createLiveCollabEditor({ element, doc })
  editors.push(editor)
  return editor
}

function makePeers(): { a: Editor; b: Editor } {
  const ydocA = new Y.Doc()
  const ydocB = new Y.Doc()
  docs.push(ydocA, ydocB)

  ydocA.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(ydocB, update, 'remote')
  })
  ydocB.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(ydocA, update, 'remote')
  })

  return { a: makeEditor(ydocA), b: makeEditor(ydocB) }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function outline(editor: Editor): Array<[string, number]> {
  const out: Array<[string, number]> = []
  editor.state.doc.forEach((node) => {
    if (node.type.name === 'paragraph' || node.type.name === 'listItem') {
      out.push([node.textContent, (node.attrs.indent as number) || 0])
    }
  })
  return out
}

function blockIds(editor: Editor): string[] {
  const ids: string[] = []
  editor.state.doc.forEach((node) => {
    if (node.type.name === 'paragraph' || node.type.name === 'listItem') {
      ids.push(node.attrs['data-block-id'] as string)
    }
  })
  return ids
}

function expectIdsHealthy(editor: Editor): void {
  const ids = blockIds(editor)
  expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
}

function caretIn(editor: Editor, label: string): void {
  let pos = -1
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === 'paragraph' && node.textContent === label) {
      pos = nodePos + 1
      return false
    }
    return true
  })
  if (pos === -1) throw new Error(`block not found: ${label}`)
  editor.commands.setTextSelection(pos)
}

const SEED =
  '<p data-block-id="block-a">A</p>' +
  '<p data-block-id="block-b" data-indent="1">B</p>' +
  '<p data-block-id="block-c" data-indent="2">C</p>' +
  '<p data-block-id="block-d" data-indent="1">D</p>'

describe('outliner collaboration smoke', () => {
  it('converges initial content with stable block ids', async () => {
    const { a, b } = makePeers()
    expect(a.commands.setContent(SEED)).toBe(true)
    await settle()

    expect(blockIds(a)).toEqual(['block-a', 'block-b', 'block-c', 'block-d'])
    expect(blockIds(b)).toEqual(blockIds(a))
    expect(outline(b)).toEqual(outline(a))
  })

  it('syncs collapse state to the peer', async () => {
    const { a, b } = makePeers()
    a.commands.setContent(SEED)
    await settle()

    caretIn(a, 'A')
    expect(a.commands.toggleCollapse()).toBe(true)
    await settle()

    const collapsedOn = (editor: Editor) => {
      let value = false
      editor.state.doc.forEach((node) => {
        if (node.textContent === 'A') value = !!node.attrs.collapsed
      })
      return value
    }

    expect(collapsedOn(a)).toBe(true)
    expect(collapsedOn(b)).toBe(true)
  })

  it('moves a subtree and converges on the peer with ids preserved', async () => {
    const { a, b } = makePeers()
    a.commands.setContent(SEED)
    await settle()

    caretIn(a, 'D')
    expect(a.commands.moveBlockUp()).toBe(true)
    await settle()

    const expected: Array<[string, number]> = [
      ['A', 0],
      ['D', 1],
      ['B', 1],
      ['C', 2],
    ]
    expect(outline(a)).toEqual(expected)
    expect(outline(b)).toEqual(expected)
    expect(new Set(blockIds(a))).toEqual(new Set(['block-a', 'block-b', 'block-c', 'block-d']))
    expect(blockIds(b)).toEqual(blockIds(a))
    expectIdsHealthy(a)
    expectIdsHealthy(b)
  })

  it('deletes a selected subtree and converges on the peer', async () => {
    const { a, b } = makePeers()
    a.commands.setContent(SEED)
    await settle()

    caretIn(a, 'B')
    expect(a.commands.selectCurrentBlock()).toBe(true)
    expect(a.commands.deleteBlockSelection()).toBe(true)
    await settle()

    const expected: Array<[string, number]> = [
      ['A', 0],
      ['D', 1],
    ]
    expect(outline(a)).toEqual(expected)
    expect(outline(b)).toEqual(expected)
    expect(blockIds(a)).toEqual(['block-a', 'block-d'])
    expect(blockIds(b)).toEqual(blockIds(a))
    expectIdsHealthy(a)
    expectIdsHealthy(b)
  })

  it('drag-drops a subtree as a child and converges on the peer', async () => {
    const { a, b } = makePeers()
    a.commands.setContent(SEED)
    await settle()

    const blocks = getOutlinerBlocks(a.state.doc)
    const dPos = blocks.find((block) => block.node.textContent === 'D')?.pos
    const aPos = blocks.find((block) => block.node.textContent === 'A')?.pos
    if (dPos === undefined || aPos === undefined) throw new Error('seed blocks missing')

    const tr = applyDrop(a.state, dPos, aPos, 'child')
    expect(tr).not.toBeNull()
    a.view.dispatch(tr!)
    await settle()

    const expected: Array<[string, number]> = [
      ['A', 0],
      ['D', 1],
      ['B', 1],
      ['C', 2],
    ]
    expect(outline(a)).toEqual(expected)
    expect(outline(b)).toEqual(expected)
    expect(new Set(blockIds(a))).toEqual(new Set(['block-a', 'block-b', 'block-c', 'block-d']))
    expect(blockIds(b)).toEqual(blockIds(a))
    expectIdsHealthy(a)
    expectIdsHealthy(b)
  })
})
