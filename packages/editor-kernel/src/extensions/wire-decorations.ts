/**
 * wire-decorations.ts — everything wire-related that a BLOCK wears, emitted as
 * ProseMirror decorations, because as DOM attributes none of it could survive.
 *
 * ━━ THE BUG THIS FILE EXISTS FOR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * The host used to write these attributes straight onto the block element —
 * `el.setAttribute('data-wire-highlighted', …)` for the highlight,
 * `el.toggleAttribute('data-block-wired', …)` for the indicator bubble. That is
 * writing into a buffer ProseMirror owns. It works right up until ProseMirror
 * redraws the node, and then the attribute is gone, silently, with the host's
 * state still believing it is applied.
 *
 * Measured in the running app, same editor, same 1.5s window:
 *
 *     drag handles (Decoration.widget)   3  ->  3     survived
 *     wire highlight (DOM attribute)     1  ->  0     destroyed
 *     blockNodeReplaced: true, blockCountStable: true
 *
 * Same logical blocks, new DOM nodes. ProseMirror re-applied its own
 * decorations and did not re-apply ours, because it never knew about them.
 *
 * You cannot fix that by hunting down every redraw and re-syncing after it. The
 * redraws come from plugins we do not own — collaboration cursors, awareness,
 * other extensions — and any one missed is an intermittent bug indistinguishable
 * from the feature simply being flaky. That is the shape of the months of
 * breakage this same feature had in cloud-1.
 *
 * A decoration is not a nicer place to put an attribute. It is asking
 * ProseMirror to put the attribute there itself, every time it draws. That is
 * the difference between "unlikely to be lost" and "cannot be lost".
 *
 * ━━ WHY BOTH LIVE IN ONE PLUGIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * The highlight (transient, one block, hover or arrival) and the wire indicator
 * (ambient, many blocks, from the loaded bundle) look like different features
 * and are the same mechanism: host-owned state that has to be painted onto
 * blocks and stay painted. One plugin, one state object, ONE pass over the doc
 * emitting one merged decoration per node — so a block that is both wired and
 * highlighted gets both sets of attributes without two decorations racing to
 * describe it.
 *
 * ━━ WHAT IT EMITS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Exactly the attributes the old DOM writers wrote, so the stylesheet in
 * editor-host.ts is untouched and its contract guard stays meaningful:
 *
 *     data-wire-highlighted   'true'
 *     data-wire-highlight-mode 'hover' | 'arrival'
 *     data-block-wired        'true'   (the CSS selects on presence)
 *     data-wire-count         the number of wires on that block
 *
 * ━━ STATE, AND WHY META IS SAFE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * State moves by meta-tagged transaction. The obvious worry is undo: hover
 * fires constantly and this room has a SHARED Y.UndoManager. Verified before
 * building, with a real collab editor and the real room lease — 25 meta-only
 * transactions left the undo stack at depth 1, unchanged, and undo still undid
 * the typing. A meta transaction does not change the doc, so ySyncPlugin writes
 * nothing to the Y.Doc and the manager (trackedOrigins: ySyncPluginKey) has
 * nothing to record.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export type WireHighlightMode = 'hover' | 'arrival'

/** One block that carries wires, and how many. */
export interface WiredBlockEntry {
  readonly blockId: string
  readonly count: number
}

export interface WireDecorationState {
  /** The block currently lit, or null. Transient. */
  readonly highlightBlockId: string | null
  readonly highlightMode: WireHighlightMode
  /** Every block that carries wires. Ambient, from the loaded bundle. */
  readonly wired: readonly WiredBlockEntry[]
}

const EMPTY_STATE: WireDecorationState = {
  highlightBlockId: null,
  highlightMode: 'hover',
  wired: [],
}

export const wireDecorationsKey = new PluginKey<WireDecorationState>('shrubberyWireDecorations')

/**
 * Both spellings of a block id. Wire records carry the bare form (the
 * `#block-` IRI fragment is stripped upstream) while the editor's own attrs
 * carry the `block-` prefix, and which arrives depends on which surface asked.
 * Mirrors `_blockIdCandidates` in editor-host.ts, which the host still needs
 * for the DOM lookups it legitimately does — scrollIntoView wants an element,
 * not a position.
 */
function idCandidates(blockId: string): string[] {
  const normalized = blockId.trim()
  if (!normalized) return []
  const candidates = [normalized]
  if (normalized.startsWith('block-')) {
    const short = normalized.slice('block-'.length)
    if (short) candidates.push(short)
  } else {
    candidates.push(`block-${normalized}`)
  }
  return candidates
}

/** blockId (in every spelling) -> wire count, for O(1) lookup during the walk. */
function wiredLookup(wired: readonly WiredBlockEntry[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const entry of wired) {
    const count = Math.max(1, entry.count)
    for (const candidate of idCandidates(entry.blockId)) {
      map.set(candidate, Math.max(count, map.get(candidate) ?? 0))
    }
  }
  return map
}

function buildDecorations(state: EditorState): DecorationSet {
  const current = wireDecorationsKey.getState(state) ?? EMPTY_STATE
  const highlightIds = current.highlightBlockId ? new Set(idCandidates(current.highlightBlockId)) : null
  const wired = wiredLookup(current.wired)
  if (!highlightIds && wired.size === 0) return DecorationSet.empty

  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    const id = node.attrs?.['data-block-id']
    if (typeof id !== 'string' || !id) return true

    const attrs: Record<string, string> = {}
    const count = wired.get(id)
    if (count !== undefined) {
      attrs['data-block-wired'] = 'true'
      attrs['data-wire-count'] = String(count)
    }
    if (highlightIds?.has(id)) {
      attrs['data-wire-highlighted'] = 'true'
      attrs['data-wire-highlight-mode'] = current.highlightMode
    }
    if (Object.keys(attrs).length > 0) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs))
    }
    return true
  })
  return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty
}

function patch(view: EditorView, next: Partial<WireDecorationState>): boolean {
  const current = wireDecorationsKey.getState(view.state) ?? EMPTY_STATE
  const merged: WireDecorationState = { ...current, ...next }
  view.dispatch(view.state.tr.setMeta(wireDecorationsKey, merged))
  return true
}

/**
 * Move the highlight. Meta-only — no doc change, no collab traffic, no undo
 * entry. Safe to call on every pointer move across a wire list.
 *
 * Returns false only when there is no view to dispatch into, so a caller can
 * distinguish "not applied" from "applied to nothing".
 */
export function setWireHighlight(
  view: EditorView | null | undefined,
  blockId: string | null,
  mode: WireHighlightMode = 'hover',
): boolean {
  if (!view) return false
  const current = wireDecorationsKey.getState(view.state) ?? EMPTY_STATE
  const nextId = blockId?.trim() || null
  // Cheap idempotence — and NOT the kind that bit the old implementation. That
  // early-return compared against state which could disagree with the DOM, so a
  // repeat hover after a redraw refused to re-apply something no longer there.
  // Decorations are re-derived from this state on every render, so equal state
  // genuinely means equal rendering.
  if (current.highlightBlockId === nextId && current.highlightMode === mode) return true
  return patch(view, { highlightBlockId: nextId, highlightMode: mode })
}

/**
 * Replace the set of blocks wearing a wire indicator. Called when the wire
 * bundle loads or changes, not per frame.
 */
export function setWiredBlocks(
  view: EditorView | null | undefined,
  wired: readonly WiredBlockEntry[],
): boolean {
  if (!view) return false
  const current = wireDecorationsKey.getState(view.state) ?? EMPTY_STATE
  if (sameWired(current.wired, wired)) return true
  return patch(view, { wired: [...wired] })
}

/**
 * SET equality, not positional — and the difference is a stack overflow.
 *
 * This compared index-by-index, which makes it order-SENSITIVE for a value
 * that is semantically an unordered set. The danger is not a wasted render:
 * `setWiredBlocks` dispatches when this returns false, the host re-syncs from
 * inside its own `transaction` handler (editor-host.ts's `onTransaction`), and
 * a dispatch made from inside a transaction handler re-enters that handler
 * synchronously. Feed it the same set in a different order and the two sides
 * never agree, so it dispatches forever: reproduced as
 * `RangeError: Maximum call stack size exceeded`.
 *
 * It has not fired in production because everything upstream happens to be
 * stable within a tick — `wiredBlockIds` is sorted (wire-bundle-service.ts) and
 * the wire arrays are read from one bundle object per pass. That is accidental
 * determinism, not a guarantee: `outgoingWires`/`incomingWires` carry no
 * ordering contract from the backend, so a change to how bundles are fetched
 * could arm this from a file nobody would connect back to here.
 *
 * Comparing as a set removes the whole class rather than relying on the data
 * staying sorted.
 */
/** id -> count, last write wins. The comparison below works on these, so a
 *  duplicated id can never make two equal sets look different. */
function wiredCounts(entries: readonly WiredBlockEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.blockId, entry.count)
  return counts
}

function sameWired(a: readonly WiredBlockEntry[], b: readonly WiredBlockEntry[]): boolean {
  // DEDUPE BEFORE COMPARING — do not shortcut on length.
  //
  // An earlier version returned false the moment either side held a duplicate
  // id, with a comment saying it would "let the dispatch resolve it". That is
  // precisely the unbounded loop this function exists to prevent: the dispatch
  // re-enters the host's own transaction handler, which re-derives the list and
  // asks again, and a comparison that can never agree never converges. Beta
  // caught it in review; it was unreachable only because the single caller
  // happens to build its list through a Map. An exported function cannot rely
  // on its caller's good manners.
  const left = wiredCounts(a)
  const right = wiredCounts(b)
  if (left.size !== right.size) return false
  for (const [blockId, count] of left) {
    if (right.get(blockId) !== count) return false
  }
  return true
}

/** Read the current state — for tests and host-side reconciliation. */
export function getWireDecorationState(state: EditorState): WireDecorationState {
  return wireDecorationsKey.getState(state) ?? EMPTY_STATE
}

export const WireDecorations = Extension.create({
  name: 'wireDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin<WireDecorationState>({
        key: wireDecorationsKey,
        state: {
          init: () => EMPTY_STATE,
          apply(tr, previous) {
            const next = tr.getMeta(wireDecorationsKey) as WireDecorationState | undefined
            return next ?? previous
          },
        },
        props: {
          decorations(state) {
            return buildDecorations(state)
          },
        },
      }),
    ]
  },
})
