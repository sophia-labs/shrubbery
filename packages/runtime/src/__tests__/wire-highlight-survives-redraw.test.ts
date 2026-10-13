/**
 * wire-highlight-survives-redraw.test.ts — the test that was missing, and whose
 * absence let wire highlighting be broken for months.
 *
 * Everything else about this feature was tested. The event fired, the state
 * moved, the attribute landed on the right block, the selector matched the
 * attribute. Every one of those passed while the feature did not work, because
 * none of them asked the only question that mattered:
 *
 *     is the highlight STILL THERE after ProseMirror redraws the block?
 *
 * It was not. The highlight was written straight onto the block element, and
 * ProseMirror owns those elements and replaces them. Measured in the running
 * app: the attribute went 1 -> 0 inside 1.5 seconds while block-dnd's
 * decoration-based drag handles went 3 -> 3 through the same replacement —
 * same editor, same document, same redraw.
 *
 * That is why it "kept working and then breaking": it worked until something
 * redrew, and in a collaborative editor with awareness and cursor plugins,
 * something always redraws. A fix that re-syncs after every redraw we know
 * about is a fix that lasts until the next plugin we do not.
 *
 * So the highlight is a DECORATION now, and this asserts the property that
 * makes decorations the right answer: ProseMirror re-derives them from plugin
 * state on every render, so a redraw cannot lose one.
 *
 * NOTE ON THE INSTRUMENT: happy-dom applies no CSS, so this cannot prove the
 * highlight is VISIBLE — `wire-highlight-contract.test.ts` covers the selector
 * agreement, and only a real browser can close the last gap. What this proves
 * is the half that was actually broken: persistence.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import {
  createLiveCollabEditor,
  setLiveWireHighlight,
  setLiveWiredBlocks,
} from '../collab/live-editor.js'

const editors: Editor[] = []
const docs: Y.Doc[] = []
afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  while (docs.length) docs.pop()?.destroy()
})

function mount(): Editor {
  const doc = new Y.Doc()
  docs.push(doc)
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createLiveCollabEditor({ element, doc })
  editors.push(editor)
  editor.commands.setContent('<p>alpha</p><p>beta</p><p>gamma</p>')
  return editor
}

/** Every block currently carrying the highlight, by id, read from the DOM. */
function highlighted(editor: Editor): string[] {
  const dom = editor.view.dom as HTMLElement
  return Array.from(dom.querySelectorAll('[data-wire-highlighted="true"]'))
    .map(el => el.getAttribute('data-block-id') ?? '')
}

function firstBlockId(editor: Editor): string {
  const dom = editor.view.dom as HTMLElement
  const block = dom.querySelector('[data-block-id]')
  return block?.getAttribute('data-block-id') ?? ''
}

describe('the wire highlight survives a redraw', () => {
  it('is applied by the decoration, with the value the stylesheet asks for', () => {
    const editor = mount()
    const target = firstBlockId(editor)
    expect(target).not.toBe('')

    expect(setLiveWireHighlight(editor, target, 'hover')).toBe(true)
    expect(highlighted(editor)).toEqual([target])

    const el = (editor.view.dom as HTMLElement)
      .querySelector(`[data-block-id="${target}"]`)
    expect(el?.getAttribute('data-wire-highlighted')).toBe('true')
    expect(el?.getAttribute('data-wire-highlight-mode')).toBe('hover')
  })

  it('SURVIVES a document edit that redraws the blocks — the whole point', () => {
    const editor = mount()
    const target = firstBlockId(editor)
    setLiveWireHighlight(editor, target, 'hover')
    expect(highlighted(editor)).toEqual([target])

    // A real edit, which is what forces ProseMirror to redraw. Under the old
    // DOM-attribute implementation the highlight was destroyed here and never
    // came back, because nothing re-applied it.
    editor.commands.focus('end')
    editor.commands.insertContent(' more text')
    editor.commands.insertContent(' and more')

    expect(highlighted(editor)).toEqual([target])
  })

  it('survives repeated edits, and still clears on demand', () => {
    const editor = mount()
    const target = firstBlockId(editor)
    setLiveWireHighlight(editor, target, 'arrival')

    for (let i = 0; i < 10; i += 1) {
      editor.commands.focus('end')
      editor.commands.insertContent(`edit ${i} `)
    }
    expect(highlighted(editor)).toEqual([target])
    // The mode rides along too — an arrival that lost its pulse mid-animation
    // would be the same bug wearing a smaller hat.
    const el = (editor.view.dom as HTMLElement).querySelector(`[data-block-id="${target}"]`)
    expect(el?.getAttribute('data-wire-highlight-mode')).toBe('arrival')

    setLiveWireHighlight(editor, null)
    expect(highlighted(editor)).toEqual([])
  })

  it('moves cleanly from one block to another', () => {
    const editor = mount()
    const dom = editor.view.dom as HTMLElement
    const ids = Array.from(dom.querySelectorAll('[data-block-id]'))
      .map(el => el.getAttribute('data-block-id') ?? '')
    expect(ids.length).toBeGreaterThan(1)

    setLiveWireHighlight(editor, ids[0], 'hover')
    expect(highlighted(editor)).toEqual([ids[0]])
    setLiveWireHighlight(editor, ids[1], 'hover')
    // Exactly one block lit — never both, which is what a stale DOM attribute
    // left behind by an incomplete clear would look like.
    expect(highlighted(editor)).toEqual([ids[1]])
  })

  it('accepts a bare id as well as the block- prefixed form', () => {
    // Wire records carry the bare id (the IRI fragment is stripped upstream);
    // the editor's own attrs carry the prefix. Both must resolve, or a wire
    // highlights nothing depending on which surface asked.
    const editor = mount()
    const prefixed = firstBlockId(editor)
    expect(prefixed.startsWith('block-')).toBe(true)

    setLiveWireHighlight(editor, prefixed.slice('block-'.length), 'hover')
    expect(highlighted(editor)).toEqual([prefixed])
  })

  it('an unknown block id lights nothing rather than throwing', () => {
    const editor = mount()
    expect(setLiveWireHighlight(editor, 'block-does-not-exist', 'hover')).toBe(true)
    expect(highlighted(editor)).toEqual([])
  })
})

describe('setWiredBlocks tolerates duplicate ids', () => {
  it('the same set with a duplicated entry dispatches nothing', () => {
    // The comparison used to bail the moment either side held a duplicate id,
    // and "let the dispatch resolve it" — which is the unbounded re-entrant
    // loop the comparison exists to prevent. Unreachable through the one host
    // caller (it builds through a Map) but the function is exported and cannot
    // assume that.
    const editor = mount()
    const ids = Array.from((editor.view.dom as HTMLElement).querySelectorAll('[data-block-id]'))
      .map(el => el.getAttribute('data-block-id') ?? '')

    setLiveWiredBlocks(editor, [{ blockId: ids[0], count: 1 }, { blockId: ids[1], count: 2 }])
    let transactions = 0
    editor.on('transaction', () => { transactions += 1 })

    // Same two blocks, same counts, one repeated — semantically identical.
    setLiveWiredBlocks(editor, [
      { blockId: ids[0], count: 1 },
      { blockId: ids[1], count: 2 },
      { blockId: ids[1], count: 2 },
    ])
    expect(transactions).toBe(0)
  })
})

describe('setWiredBlocks is order-insensitive — the reentrancy guard', () => {
  it('the SAME set in a different order dispatches nothing', () => {
    // Not a performance nicety. `setLiveWiredBlocks` dispatches whenever it
    // decides the set changed; the host re-syncs from inside its own
    // `transaction` handler; and a dispatch made from inside a transaction
    // handler re-enters that handler synchronously. An order-sensitive
    // comparison therefore never converges — an adversarial review reproduced
    // it as `RangeError: Maximum call stack size exceeded`.
    //
    // It stayed latent only because everything upstream happens to be sorted
    // within a tick. That is accidental, not contractual: the wire arrays carry
    // no ordering guarantee from the backend.
    const editor = mount()
    const ids = Array.from((editor.view.dom as HTMLElement).querySelectorAll('[data-block-id]'))
      .map(el => el.getAttribute('data-block-id') ?? '')
    expect(ids.length).toBeGreaterThan(2)

    const forward = [
      { blockId: ids[0], count: 1 },
      { blockId: ids[1], count: 2 },
      { blockId: ids[2], count: 3 },
    ]
    const reversed = [...forward].reverse()

    setLiveWiredBlocks(editor, forward)
    let transactions = 0
    editor.on('transaction', () => { transactions += 1 })

    // Same three blocks, same three counts, opposite order.
    setLiveWiredBlocks(editor, reversed)
    expect(transactions).toBe(0)

    // A GENUINE change still gets through — an equality check that never
    // dispatches would pass the assertion above and break the feature.
    setLiveWiredBlocks(editor, [{ blockId: ids[0], count: 9 }])
    expect(transactions).toBeGreaterThan(0)
  })
})

describe('the wire INDICATOR survives a redraw too', () => {
  const wiredIds = (editor: Editor): string[] =>
    Array.from((editor.view.dom as HTMLElement).querySelectorAll('[data-block-wired]'))
      .map(el => el.getAttribute('data-block-id') ?? '')

  it('marks wired blocks and keeps them marked through edits', () => {
    // The bubbles were the SAME bug as the highlight: attributes written onto
    // ProseMirror-owned nodes. In the running app a document whose bundle named
    // a wired block still reported zero marked blocks.
    const editor = mount()
    const ids = Array.from((editor.view.dom as HTMLElement).querySelectorAll('[data-block-id]'))
      .map(el => el.getAttribute('data-block-id') ?? '')
    expect(ids.length).toBeGreaterThan(1)

    setLiveWiredBlocks(editor, [{ blockId: ids[1], count: 3 }])
    expect(wiredIds(editor)).toEqual([ids[1]])
    const marked = (editor.view.dom as HTMLElement).querySelector(`[data-block-id="${ids[1]}"]`)
    expect(marked?.getAttribute('data-wire-count')).toBe('3')

    editor.commands.focus('end')
    editor.commands.insertContent(' an edit that redraws')
    expect(wiredIds(editor)).toEqual([ids[1]])
    expect(
      (editor.view.dom as HTMLElement)
        .querySelector(`[data-block-id="${ids[1]}"]`)
        ?.getAttribute('data-wire-count'),
    ).toBe('3')
  })

  it('a block can be wired AND highlighted at once, wearing both', () => {
    // One decoration per node carrying merged attrs — not two decorations
    // racing to describe the same block.
    const editor = mount()
    const target = firstBlockId(editor)
    setLiveWiredBlocks(editor, [{ blockId: target, count: 1 }])
    setLiveWireHighlight(editor, target, 'arrival')

    const el = (editor.view.dom as HTMLElement).querySelector(`[data-block-id="${target}"]`)
    expect(el?.getAttribute('data-block-wired')).toBe('true')
    expect(el?.getAttribute('data-wire-highlighted')).toBe('true')
    expect(el?.getAttribute('data-wire-highlight-mode')).toBe('arrival')
  })

  it('clearing the highlight leaves the indicator alone', () => {
    // They are independent state on one plugin; a hover ending must not strip
    // the ambient bubble off the block.
    const editor = mount()
    const target = firstBlockId(editor)
    setLiveWiredBlocks(editor, [{ blockId: target, count: 2 }])
    setLiveWireHighlight(editor, target, 'hover')
    setLiveWireHighlight(editor, null)

    const el = (editor.view.dom as HTMLElement).querySelector(`[data-block-id="${target}"]`)
    expect(el?.getAttribute('data-wire-highlighted')).toBeNull()
    expect(el?.getAttribute('data-block-wired')).toBe('true')
  })
})
