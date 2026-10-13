/**
 * block-id-survives-drag.test.ts — a drag MOVES blocks; it must never RE-MINT
 * them.
 *
 * This is the invariant everything outside the editor depends on. A wire names
 * a block id. A valuation names a block id. The Chronicle, the inspector's
 * relation rows, the graph's whole notion of "this passage" — all of it is a
 * string that has to still mean the same passage after the user reorders their
 * document. If a drop assigned a fresh id, nothing would throw and nothing
 * would look broken: the wires would simply stop pointing at anything, quietly,
 * and only at read time, and only later.
 *
 * Drag is new in shrubbery (cloud-1's frontend had no such mechanic), so no
 * prior art covers this and the risk is real rather than theoretical. Two
 * plausible ways it could have gone wrong, neither visible by reading:
 *   - `applyDrop` rebuilds the moved node via `node.type.create(...)`. Spread
 *     the attrs wrong and the id is dropped on the floor.
 *   - `BlockId`'s `appendTransaction` re-assigns any id that is missing OR
 *     duplicate. A move is a delete plus an insert; if both halves were ever
 *     observable in one state, every moved block would look like a duplicate
 *     of itself and be re-minted.
 *
 * TABLES ARE THE HARD CASE, and the reason this file exists. A table is not one
 * block — it is a container holding many. `insertTable({rows:2, cols:2})` alone
 * carries EIGHT ids (two tableHeader, two tableCell, and the paragraph inside
 * each), and dragging the table has to carry all eight, unchanged, in one move.
 *
 * THE TWO TESTS GUARD DIFFERENT MECHANISMS, which is not obvious and was found
 * by mutation rather than by design. Nulling `data-block-id` in `applyDrop`'s
 * `node.type.create` call fails the PARAGRAPH test and leaves the TABLE test
 * green — because a table carries no id of its own, so the attrs spread has
 * nothing to lose there. The table's ids ride inside `node.content`, which is
 * passed through by reference and never rebuilt. So:
 *   - the paragraph case guards the ATTRS SPREAD (a moved block's own id),
 *   - the table case guards SUBTREE PRESERVATION (ids of everything within).
 * Deleting either one leaves a real regression uncovered.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { kernelExtensions } from '../index'
import { getOutlinerBlocks } from '../outliner-tree'
import { applyDrop } from '../extensions/block-dnd'

const editors: Editor[] = []
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

/** Every id-bearing node in the doc, as `type:id`. Order-independent by design
 *  — a move is SUPPOSED to change order; it is identity that must hold. */
function blockIds(editor: Editor): string[] {
  const found: string[] = []
  editor.state.doc.descendants((node) => {
    const id = node.attrs['data-block-id']
    if (typeof id === 'string' && id) found.push(`${node.type.name}:${id}`)
    return true
  })
  return found
}

function mountWithTable(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: kernelExtensions({}) })
  editors.push(editor)
  editor.commands.setContent('<p>alpha</p><p>omega</p>')
  editor.commands.focus('end')
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
  return editor
}

/**
 * Drag the block at `index` to the top of the document.
 *
 * An INDEX, not a type name, and the reason is a trap worth keeping: the first
 * draft searched for the last node of a type, which for 'paragraph' selects the
 * document's TRAILING paragraph. Moving that one away leaves the doc ending in
 * a table, so the `trailingNode` extension correctly appends a brand-new empty
 * paragraph — which arrives with a brand-new id. The test then read a gained id
 * and called it a re-mint, when nothing had been re-minted at all. Selecting an
 * interior block keeps the fixture measuring drag and nothing else.
 */
function dragToTop(editor: Editor, index: number): void {
  const blocks = getOutlinerBlocks(editor.state.doc)
  expect(index).toBeGreaterThan(0)
  const tr = applyDrop(editor.state, blocks[index].pos, blocks[0].pos, 'before')
  expect(tr).not.toBeNull()
  editor.view.dispatch(tr!)
}

describe('block ids survive a drag', () => {
  it('dragging a TABLE carries its whole subtree of ids, unchanged', () => {
    const editor = mountWithTable()
    const before = blockIds(editor)
    // Guard the fixture itself: if insertTable ever stops minting cell ids,
    // the assertions below would pass over an empty set and prove nothing.
    expect(before.filter(entry => entry.startsWith('tableHeader:'))).toHaveLength(2)
    expect(before.filter(entry => entry.startsWith('tableCell:'))).toHaveLength(2)

    const tableIndex = getOutlinerBlocks(editor.state.doc)
      .map(block => block.node.type.name).indexOf('table')
    dragToTop(editor, tableIndex)

    const after = blockIds(editor)
    expect(after).toHaveLength(before.length)
    expect([...after].sort()).toEqual([...before].sort())
    // Stated separately from the equality above so a failure says WHICH way it
    // broke: ids vanishing and ids being re-minted are different bugs.
    expect(before.filter(entry => !after.includes(entry))).toEqual([])
    expect(after.filter(entry => !before.includes(entry))).toEqual([])
  })

  it('the table container itself is deliberately NOT an addressable block', () => {
    // BlockId's BASE_BLOCK_TYPES names tableCell and tableHeader, never table:
    // "the wire source is the cell, not the table" (block-id.ts:57-59). Pinned
    // because it is a real constraint on the graph — a wire or valuation can
    // address a cell, and there is no id to hang one on a whole table.
    const editor = mountWithTable()
    const table = getOutlinerBlocks(editor.state.doc)
      .find(block => block.node.type.name === 'table')
    expect(table).toBeDefined()
    expect(table!.node.attrs['data-block-id']).toBeFalsy()
    expect(blockIds(editor).some(entry => entry.startsWith('table:'))).toBe(false)
  })

  it('dragging an ordinary paragraph re-mints nothing either', () => {
    const editor = mountWithTable()
    const before = blockIds(editor)
    // Block 1 — an INTERIOR paragraph. Not block 0 (cannot drop before itself)
    // and not the trailing one (see dragToTop's note on trailingNode).
    dragToTop(editor, 1)
    expect([...blockIds(editor)].sort()).toEqual([...before].sort())
  })
})
