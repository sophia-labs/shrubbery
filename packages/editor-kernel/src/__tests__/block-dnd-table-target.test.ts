/**
 * block-dnd-table-target.test.ts — a table can be picked up.
 *
 * THE BUG. `blockAtEvent` resolved its starting element with
 * `closest('[data-block-id]')`. A table carries no block id — only its cells
 * do, and deliberately so ("the wire source is the cell, not the table",
 * block-id.ts) — so from a table's drag handle the chain is:
 *
 *     tbody < table < div.tableWrapper < div.tiptap        closest: NULL
 *
 * With a null hit, `dragstart` bails and `sourcePos` is never set, so the drag
 * never begins. The table cannot be moved.
 *
 * WHAT ACTUALLY GOES WRONG NEXT, corrected after review — the first version of
 * this file (and the comment in block-dnd.ts) claimed the null also stopped
 * `dragover` from calling `preventDefault()`, and that the browser therefore
 * refused to deliver `drop`. That is FALSE, and only running it shows why:
 * prosemirror-view merges its own `editHandlers.dragover` into the same
 * dispatch table, and that handler calls `preventDefault()` unconditionally
 * whenever no plugin handler claims the event. The drop was always delivered.
 * What actually happened is that OUR drop handler bailed on the null
 * `sourcePos`, so the event fell through to ProseMirror's generic slice-insert
 * instead of the outliner-aware `applyDrop` — a different failure, reached by a
 * different path, that happens to look the same from a chair.
 *
 * THIS TEST DRIVES THE REAL HANDLER. The first version did not: it
 * reimplemented the parent-walk inline and asserted against its own copy, so
 * reverting `blockAtEvent` to the exact pre-fix one-liner left all of it green.
 * A test that restates the implementation cannot fail when the implementation
 * does. So the events below are dispatched at the editor's own DOM and the
 * assertions read the plugin's state — the fix is exercised through the code
 * path a user's pointer actually takes.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { kernelExtensions } from '../index'
import { getOutlinerBlocks } from '../outliner-tree'
import { blockDndKey } from '../extensions/block-dnd'

const editors: Editor[] = []
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

function mountWithTable(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: kernelExtensions({}) })
  editors.push(editor)
  editor.commands.setContent('<p>alpha</p><p>beta</p>')
  editor.commands.focus('end')
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
  return editor
}

/** The handle ProseMirror renders inside the table, whose ancestors carry no id. */
function tableDragHandle(editor: Editor): HTMLElement {
  const handle = (editor.view.dom as HTMLElement).querySelector('.tableWrapper .block-drag-handle')
  expect(handle).not.toBeNull()
  return handle as HTMLElement
}

/** A real dragstart, dispatched at a real element, through the real handler. */
function dragStartOn(target: HTMLElement): void {
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
  // A fuller stub than it looks like it needs: prosemirror-view's OWN dragstart
  // handler runs alongside the plugin's and reads `files.length`, `clearData`
  // and `setDragImage` off it (prosemirror-view/dist/index.js:3778-3785). A
  // thinner stub throws there, which reads as the plugin failing.
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files: [],
      items: [],
      types: [],
      effectAllowed: '',
      setData: () => undefined,
      getData: () => '',
      clearData: () => undefined,
      setDragImage: () => undefined,
    },
    configurable: true,
  })
  target.dispatchEvent(event)
}

const sourcePos = (editor: Editor): number | null =>
  blockDndKey.getState(editor.state)?.sourcePos ?? null

describe('a table can be picked up by its drag handle', () => {
  it('the table drag handle has NO id-bearing ancestor — the condition that broke it', () => {
    // Guarding the premise. If tables ever start carrying a block id, the rest
    // of this file would silently stop testing anything, so the absence is
    // asserted rather than assumed.
    const editor = mountWithTable()
    expect(tableDragHandle(editor).closest('[data-block-id]')).toBeNull()
    expect((editor.view.dom as HTMLElement).querySelector('table')?.closest('[data-block-id]')).toBeNull()
  })

  it('dragstart on the table handle sets sourcePos to the TABLE position', () => {
    const editor = mountWithTable()
    expect(sourcePos(editor)).toBeNull()

    dragStartOn(tableDragHandle(editor))

    const pos = sourcePos(editor)
    expect(pos).not.toBeNull()
    // It resolved to the table itself, not to a cell and not to a neighbour.
    expect(editor.state.doc.nodeAt(pos!)?.type.name).toBe('table')
    // And to a position the drop planner will accept — `applyDrop` refuses
    // anything `blockIndexAtPos` cannot find.
    expect(getOutlinerBlocks(editor.state.doc).some(block => block.pos === pos)).toBe(true)
  })

  it('dragstart on an ordinary paragraph still works — the fallback changed nothing there', () => {
    const editor = mountWithTable()
    const paragraphHandle = (editor.view.dom as HTMLElement)
      .querySelector('p[data-block-id] .block-drag-handle') as HTMLElement | null
    expect(paragraphHandle).not.toBeNull()

    dragStartOn(paragraphHandle!)

    const pos = sourcePos(editor)
    expect(pos).not.toBeNull()
    expect(editor.state.doc.nodeAt(pos!)?.type.name).toBe('paragraph')
  })

  it('every drag handle in the document can start a drag', () => {
    // The general property. A handle the user can see and grab and get nothing
    // from is worse than no handle, and before the fix the table had exactly
    // one of those.
    const editor = mountWithTable()
    const handles = Array.from(
      (editor.view.dom as HTMLElement).querySelectorAll('.block-drag-handle'),
    ) as HTMLElement[]
    expect(handles.length).toBeGreaterThan(1)

    const dead: string[] = []
    for (const handle of handles) {
      // Clear between attempts so each is measured on its own.
      editor.view.dispatch(editor.state.tr.setMeta(blockDndKey, { sourcePos: null, indicator: null }))
      dragStartOn(handle)
      if (sourcePos(editor) === null) {
        dead.push(handle.parentElement?.tagName.toLowerCase() ?? '?')
      }
    }
    expect(dead).toEqual([])
  })
})
