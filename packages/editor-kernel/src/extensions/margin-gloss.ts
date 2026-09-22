/**
 * MarginGloss — predicate margin decorations for wired blocks.
 *
 * Garden's original extension imported a store-side WireSummary type and
 * dispatched a global document-open event from decoration DOM. Shrubbery keeps
 * the same decoration behavior but severs those couplings:
 * - wire rows are a small structural type local to the pure kernel;
 * - opening a target is surfaced through an optional callback supplied by the host.
 */

import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface MarginGlossWireSummary {
  readonly id?: string
  readonly predicate?: string
  readonly predicateLabel?: string
  readonly otherDocumentId: string
  readonly otherGraphId: string
  readonly otherBlockId?: string
  readonly localBlockId?: string
  readonly otherTitle?: string
  readonly otherSnippet?: string
  readonly localSnippet?: string
}

export interface MarginGlossOpenTarget {
  readonly wireId?: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId?: string
}

export interface MarginGlossOptions {
  onOpenTarget?: (target: MarginGlossOpenTarget) => void
}

interface MarginGlossStorage {
  outgoing: MarginGlossWireSummary[]
  incoming: MarginGlossWireSummary[]
}

interface BlockEntry {
  out: MarginGlossWireSummary[]
  inc: MarginGlossWireSummary[]
}

export const marginGlossKey = new PluginKey<DecorationSet>('marginGloss')

const normalizeBlockId = (id: string | undefined | null): string => (id ?? '').replace(/^block-/, '')

function buildWireMap(
  outgoing: readonly MarginGlossWireSummary[],
  incoming: readonly MarginGlossWireSummary[],
): Map<string, BlockEntry> {
  const map = new Map<string, BlockEntry>()
  const add = (wire: MarginGlossWireSummary, dir: 'out' | 'inc') => {
    if (!wire.localBlockId) return
    const key = normalizeBlockId(wire.localBlockId)
    let entry = map.get(key)
    if (!entry) {
      entry = { out: [], inc: [] }
      map.set(key, entry)
    }
    entry[dir].push(wire)
  }
  for (const wire of outgoing) add(wire, 'out')
  for (const wire of incoming) add(wire, 'inc')
  return map
}

function buildNote(
  wire: MarginGlossWireSummary,
  arrow: string,
  onOpenTarget: MarginGlossOptions['onOpenTarget'],
): HTMLElement {
  const note = document.createElement('div')
  note.className = 'mg-note'

  const predicate = document.createElement('span')
  predicate.className = 'mg-predicate'
  predicate.textContent = `${arrow} ${wire.predicateLabel || wire.predicate || 'linked'}`

  const target = document.createElement('span')
  target.className = 'mg-target'
  target.textContent = wire.otherTitle || 'Untitled'

  note.append(predicate, target)

  const snippet = wire.otherSnippet || wire.localSnippet
  if (snippet) {
    const snippetEl = document.createElement('div')
    snippetEl.className = 'mg-snippet'
    snippetEl.textContent = snippet
    note.appendChild(snippetEl)
  }

  note.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenTarget?.({
      wireId: wire.id,
      graphId: wire.otherGraphId,
      documentId: wire.otherDocumentId,
      blockId: wire.otherBlockId,
    })
  })

  return note
}

function buildWidget(entry: BlockEntry, onOpenTarget: MarginGlossOptions['onOpenTarget']): HTMLElement {
  const widget = document.createElement('div')
  widget.className = 'mg-widget'
  widget.setAttribute('contenteditable', 'false')

  for (const wire of entry.out) widget.appendChild(buildNote(wire, '>', onOpenTarget))
  for (const wire of entry.inc) widget.appendChild(buildNote(wire, '<', onOpenTarget))

  return widget
}

function createDecorations(
  doc: ProseMirrorNode,
  outgoing: readonly MarginGlossWireSummary[],
  incoming: readonly MarginGlossWireSummary[],
  onOpenTarget: MarginGlossOptions['onOpenTarget'],
): DecorationSet {
  const wireMap = buildWireMap(outgoing, incoming)
  if (wireMap.size === 0) return DecorationSet.empty

  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isBlock) return
    const id = node.attrs['data-block-id'] as string | undefined
    if (!id) return
    const entry = wireMap.get(normalizeBlockId(id))
    if (!entry || (entry.out.length === 0 && entry.inc.length === 0)) return

    decorations.push(
      Decoration.widget(pos + 1, () => buildWidget(entry, onOpenTarget), {
        side: -1,
        key: `mg-${id}-${entry.out.length}-${entry.inc.length}`,
        ignoreSelection: true,
      }),
    )
  })

  return DecorationSet.create(doc, decorations)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    marginGloss: {
      updateMarginGloss: (
        outgoing: readonly MarginGlossWireSummary[],
        incoming: readonly MarginGlossWireSummary[],
      ) => ReturnType
    }
  }
}

export const MarginGloss = Extension.create<MarginGlossOptions, MarginGlossStorage>({
  name: 'marginGloss',

  addOptions() {
    return {
      onOpenTarget: undefined,
    }
  },

  addStorage() {
    return { outgoing: [], incoming: [] }
  },

  addCommands() {
    return {
      updateMarginGloss:
        (outgoing, incoming) =>
        ({ tr, dispatch }) => {
          this.storage.outgoing = [...(outgoing ?? [])]
          this.storage.incoming = [...(incoming ?? [])]
          if (dispatch) {
            tr.setMeta(marginGlossKey, { updated: true })
            dispatch(tr)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin<DecorationSet>({
        key: marginGlossKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            if (tr.getMeta(marginGlossKey) || tr.docChanged) {
              return createDecorations(
                tr.doc,
                ext.storage.outgoing,
                ext.storage.incoming,
                ext.options.onOpenTarget,
              )
            }
            return previous
          },
        },
        props: {
          decorations(state) {
            return marginGlossKey.getState(state)
          },
        },
      }),
    ]
  },
})

export default MarginGloss
