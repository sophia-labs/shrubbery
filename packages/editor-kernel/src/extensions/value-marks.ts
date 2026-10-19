/**
 * value-marks.ts — the value gutter's resting face: a small row of glyphs to
 * the right of each top-level block's first line, drawn as widget decorations
 *
 *
 * Each row holds up to three glyphs, all faint:
 *   - the signal bars (0–4) for the block's composite score. The stylesheet
 *     shows them only while the block is hovered (or always, by setting);
 *   - the reader's own importance flag, one or two, when they have set one;
 *   - the reader's own valence icon, when they have set one.
 * The reader's marks show without hover: they are acts, not the machine's
 * estimate. Hovering the row opens the full controls; the host listens for
 * that on the editor element and reads `data-value-marks-for`.
 *
 * The host owns every meaning: it sends finished SVG for each glyph
 * (`setValueMarks`). Blocks it sends nothing for still get a row with
 * `defaultSignalSvg`, so a block nobody has valued can be valued.
 *
 * Every top-level block gets a row, except calendar events (see blockIdOf).
 * Text blocks, list items and quotes hold it inside, at the start of their
 * first line. Atoms (an image, math, a query, a rule) cannot hold a widget, so their row hangs from
 * a zero-height anchor drawn just before them. A table is not a block in the
 * graph: its cells' paragraphs are, so each cell gets a small row in its
 * top-right corner.
 *
 * Widgets, not DOM writes, for the reason block-controls.ts and
 * wire-decorations.ts give: ProseMirror redraws its DOM and drops anything it
 * did not draw. State moves by meta-only transaction, which reaches neither
 * the Y.Doc nor the undo stack.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export interface ValueMark {
  /** Signal bars for the composite score (0–4). */
  readonly signalSvg: string
  /** The reader's own importance flag: 1 Important, 2 Very important. */
  readonly flagCount?: 0 | 1 | 2
  readonly flagSvg?: string
  /** The reader's own valence icon. */
  readonly valenceSvg?: string
  /** For titles and tests: e.g. "signal 3 of 4". */
  readonly label?: string
}

export interface ValueMarksState {
  readonly marks: ReadonlyMap<string, ValueMark>
  /** Drawn for any block with no entry in `marks`. Empty draws nothing. */
  readonly defaultSignalSvg: string
  /** The block whose full controls are open: it wears data-value-open. */
  readonly openBlockId: string | null
}

/**
 * The plugin keeps its built DecorationSet. A keystroke maps the set; only a
 * change to which blocks carry rows (`signature`) or new marks rebuilds it.
 * Rebuilding per state cost about 11 ms a keystroke on a 2000-block document
 *.
 */
interface ValueMarksPluginState {
  readonly data: ValueMarksState
  readonly set: DecorationSet
  readonly signature: string
}

export const valueMarksKey = new PluginKey<ValueMarksPluginState>('valueMarks')

export const VALUE_MARKS_CLASS = 'value-marks'

// List items are flat, top-level listItem nodes (the list kind is an attribute).
const ROW_CONTAINERS = new Set(['listItem', 'blockquote'])

const TABLE_CELLS = new Set(['tableCell', 'tableHeader'])

const EMPTY: ValueMarksState = { marks: new Map(), defaultSignalSvg: '', openBlockId: null }

const dataOf = (state: EditorState): ValueMarksState => valueMarksKey.getState(state)?.data ?? EMPTY

const drawsRows = (data: ValueMarksState): boolean => data.marks.size > 0 || Boolean(data.defaultSignalSvg)

function glyph(className: string, svg: string): HTMLElement {
  const span = document.createElement('span')
  span.className = className
  span.innerHTML = svg
  return span
}

function marksDom(blockId: string, mark: ValueMark, modifier?: 'cell'): HTMLElement {
  const row = document.createElement('span')
  row.className = modifier ? `${VALUE_MARKS_CLASS} ${VALUE_MARKS_CLASS}--${modifier}` : VALUE_MARKS_CLASS
  row.setAttribute('contenteditable', 'false')
  row.setAttribute('aria-hidden', 'true')
  row.dataset.valueMarksFor = blockId
  if (mark.label) row.title = mark.label
  // A press here would otherwise move the caret into the block first.
  row.addEventListener('mousedown', event => event.preventDefault())
  row.append(glyph('value-marks-signal', mark.signalSvg))
  if (mark.flagSvg && mark.flagCount) {
    const flags = glyph(`value-marks-flag value-marks-flag--${mark.flagCount}`, mark.flagSvg)
    if (mark.flagCount === 2) flags.insertAdjacentHTML('beforeend', mark.flagSvg)
    row.append(flags)
  }
  if (mark.valenceSvg) row.append(glyph('value-marks-valence', mark.valenceSvg))
  return row
}

/** A zero-height block before an atom; the row inside hangs at its right. */
function anchorDom(blockId: string, mark: ValueMark): HTMLElement {
  const anchor = document.createElement('div')
  anchor.className = `${VALUE_MARKS_CLASS}-anchor`
  anchor.setAttribute('contenteditable', 'false')
  anchor.append(marksDom(blockId, mark))
  return anchor
}

/**
 * Calendar events are left out: they keep their id in `id`, and gardend does
 * not project them as blocks, so a rating would show nowhere else (
 * the event system needs a rethink first).
 */
function blockIdOf(node: ProseMirrorNode): string | null {
  if (node.type.name === 'calendarEvent') return null
  const id = node.attrs['data-block-id']
  return typeof id === 'string' && id ? id : null
}

function markKey(blockId: string, mark: ValueMark): string {
  return `value-marks:${blockId}:${mark.signalSvg.length}:${mark.signalSvg.slice(-40)}:${mark.flagCount ?? 0}:${mark.valenceSvg?.length ?? 0}:${mark.valenceSvg?.slice(-40) ?? ''}:${mark.label ?? ''}`
}

const isRowHolder = (node: ProseMirrorNode): boolean => node.isTextblock || ROW_CONTAINERS.has(node.type.name)

/** Which blocks get a row, and of which kind: equal signatures map, unequal ones rebuild. */
function rowSignature(doc: ProseMirrorNode): string {
  const parts: string[] = []
  doc.forEach(node => {
    if (node.type.name === 'table') {
      parts.push('t')
      node.descendants(cell => {
        if (!TABLE_CELLS.has(cell.type.name)) return true
        parts.push(`c${cell.firstChild ? blockIdOf(cell.firstChild) ?? '' : ''}`)
        return false
      })
      return
    }
    parts.push(`${isRowHolder(node) ? 'i' : 'a'}${blockIdOf(node) ?? ''}`)
  })
  return parts.join('|')
}

function buildDecorations(doc: ProseMirrorNode, current: ValueMarksState): DecorationSet {
  if (!drawsRows(current)) return DecorationSet.empty
  const decorations: Decoration[] = []
  const markFor = (blockId: string): ValueMark | null =>
    current.marks.get(blockId) ?? (current.defaultSignalSvg ? { signalSvg: current.defaultSignalSvg } : null)
  const widget = (pos: number, key: string, toDom: () => HTMLElement) =>
    decorations.push(Decoration.widget(pos, toDom, { side: -1, ignoreSelection: true, stopEvent: () => true, key }))
  const openAt = (from: number, node: ProseMirrorNode) =>
    decorations.push(Decoration.node(from, from + node.nodeSize, { 'data-value-open': 'true' }))
  // Top-level blocks only: the gutter values what the reader sees as a block
  // (a paragraph, a heading, a whole list item or quote), not their insides.
  doc.forEach((node, offset) => {
    if (node.type.name === 'table') {
      node.descendants((cell, rel) => {
        if (!TABLE_CELLS.has(cell.type.name)) return true
        const first = cell.firstChild
        const blockId = first ? blockIdOf(first) : null
        const mark = blockId ? markFor(blockId) : null
        if (blockId && mark) {
          const cellPos = offset + 1 + rel
          widget(cellPos + 1, `cell:${markKey(blockId, mark)}`, () => marksDom(blockId, mark, 'cell'))
          if (current.openBlockId === blockId) openAt(cellPos, cell)
        }
        return false
      })
      return
    }
    const blockId = blockIdOf(node)
    const mark = blockId ? markFor(blockId) : null
    if (!blockId || !mark) return
    if (isRowHolder(node)) {
      widget(offset + 1, markKey(blockId, mark), () => marksDom(blockId, mark))
    } else {
      widget(offset, `anchor:${markKey(blockId, mark)}`, () => anchorDom(blockId, mark))
    }
    if (current.openBlockId === blockId) openAt(offset, node)
  })
  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty
}

function patch(view: EditorView, next: Partial<ValueMarksState>): boolean {
  const current = dataOf(view.state)
  view.dispatch(view.state.tr.setMeta(valueMarksKey, { ...current, ...next }))
  return true
}

/** Replace the marks and the glyph drawn for unvalued blocks. */
export function setValueMarks(
  view: EditorView | null | undefined,
  marks: ReadonlyMap<string, ValueMark>,
  defaultSignalSvg: string,
): boolean {
  if (!view) return false
  const current = dataOf(view.state)
  if (current.defaultSignalSvg === defaultSignalSvg && sameMarks(current.marks, marks)) return true
  return patch(view, { marks, defaultSignalSvg })
}

/** Mark which block's controls are open (null: none). */
export function setValueMarksOpen(view: EditorView | null | undefined, blockId: string | null): boolean {
  if (!view) return false
  const current = dataOf(view.state)
  if (current.openBlockId === blockId) return true
  return patch(view, { openBlockId: blockId })
}

/**
 * Map equality by content. setValueMarks is called from the host's update
 * path; dispatching on an equal map would re-enter it (wire-decorations.ts
 * describes the stack overflow that pattern produced).
 */
function sameMarks(a: ReadonlyMap<string, ValueMark>, b: ReadonlyMap<string, ValueMark>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [id, mark] of a) {
    const other = b.get(id)
    if (!other || markKey(id, mark) !== markKey(id, other)) return false
  }
  return true
}

export const ValueMarks = Extension.create({
  name: 'valueMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<ValueMarksPluginState>({
        key: valueMarksKey,
        state: {
          init: () => ({ data: EMPTY, set: DecorationSet.empty, signature: '' }),
          apply(tr, value) {
            const meta = tr.getMeta(valueMarksKey) as ValueMarksState | undefined
            if (meta !== undefined) {
              const signature = drawsRows(meta) ? rowSignature(tr.doc) : ''
              return { data: meta, set: buildDecorations(tr.doc, meta), signature }
            }
            if (!tr.docChanged || !drawsRows(value.data)) return value
            const signature = rowSignature(tr.doc)
            if (signature === value.signature) {
              return { ...value, set: value.set.map(tr.mapping, tr.doc) }
            }
            return { data: value.data, set: buildDecorations(tr.doc, value.data), signature }
          },
        },
        props: {
          decorations: state => valueMarksKey.getState(state)?.set,
        },
      }),
    ]
  },
})

export default ValueMarks
