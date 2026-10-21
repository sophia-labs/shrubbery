/**
 * Diagnostics on a fenced source block: a checker's verdict drawn into the code it is about.
 *
 * A host that projects one fence (` ```mus `, ` ```seele ` …) out of a document, checks it, and gets back diagnostics
 * with spans (offsets into the fence's text) hands them here with the exact text they were computed for. The plugin
 * underlines each span (`hoja-diag hoja-diag--error|warning`, its message as the title) and writes a margin note at the
 * end of the span's line: the first message, and how many more the line has. Nothing here checks anything: it only
 * draws what it is given.
 *
 * STALE VERDICTS ARE NOT DRAWN. A set of diagnostics is applied only while the fence's text is exactly the text they
 * were computed for. An edit inside the fence maps the marks along (so they don't jump while the checker runs) and marks
 * them stale (`hoja-diag--stale`, dimmed); the next verdict replaces them. If the fence is gone, or a different text
 * arrives with the verdict, nothing is drawn.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export type FenceDiagnosticSeverity = 'error' | 'warning' | 'info'

export interface FenceDiagnostic {
  /** Offsets into the fence's text (UTF-16 code units, as JavaScript strings and ProseMirror count). */
  readonly from: number
  readonly to: number
  readonly severity: FenceDiagnosticSeverity
  readonly message: string
  readonly code?: string
}

export interface FenceDiagnosticsPayload {
  /** The fence text the diagnostics were computed for. */
  readonly source: string
  readonly diagnostics: readonly FenceDiagnostic[]
}

export interface FenceDiagnosticsOptions {
  /** The fence language whose blocks carry diagnostics (one token of the code block's `language`). */
  language: string
  /** Write a note at the end of each line that has a diagnostic. Default true. */
  marginNotes: boolean
}

interface FenceDiagnosticsState {
  readonly payload: FenceDiagnosticsPayload | null
  readonly decorations: DecorationSet
  readonly stale: boolean
}

export const fenceDiagnosticsKey = new PluginKey<FenceDiagnosticsState>('hojaFenceDiagnostics')

function languageTokens(language: unknown): string[] {
  return typeof language === 'string' ? language.trim().toLowerCase().split(/\s+/).filter(Boolean) : []
}

/** Every code block of `language`, with the document position of its first character. */
export function findFences(doc: ProseMirrorNode, language: string): { readonly start: number; readonly text: string }[] {
  const out: { start: number; text: string }[] = []
  const want = language.toLowerCase()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    if (languageTokens(node.attrs.language).includes(want)) out.push({ start: pos + 1, text: node.textContent })
    return false
  })
  return out
}

function note(messages: readonly FenceDiagnostic[]): HTMLElement {
  const el = document.createElement('span')
  const worst = messages.some(m => m.severity === 'error') ? 'error' : messages.some(m => m.severity === 'warning') ? 'warning' : 'info'
  el.className = `hoja-diag-note hoja-diag-note--${worst}`
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('role', 'note')
  const first = messages[0]!
  el.dataset.code = first.code ?? ''
  el.textContent = messages.length > 1 ? `${first.message} (+${messages.length - 1} more)` : first.message
  el.title = messages.map(m => m.message).join('\n')
  return el
}

function build(doc: ProseMirrorNode, payload: FenceDiagnosticsPayload, options: FenceDiagnosticsOptions): DecorationSet | null {
  const fences = findFences(doc, options.language)
  if (fences.length !== 1 || fences[0]!.text !== payload.source) return null
  const { start, text } = fences[0]!
  const decorations: Decoration[] = []
  const byLine = new Map<number, FenceDiagnostic[]>()
  for (const d of payload.diagnostics) {
    const from = Math.max(0, Math.min(d.from, text.length))
    const to = Math.max(from, Math.min(d.to, text.length))
    if (to > from) {
      const attrs = { class: `hoja-diag hoja-diag--${d.severity}`, title: d.message, 'data-diag-code': d.code ?? '' }
      decorations.push(Decoration.inline(start + from, start + to, attrs, { hojaDiag: attrs }))
    }
    const lineEnd = text.indexOf('\n', from)
    const end = lineEnd === -1 ? text.length : lineEnd
    const list = byLine.get(end) ?? []
    list.push(d)
    byLine.set(end, list)
  }
  if (options.marginNotes) {
    for (const [end, messages] of byLine) {
      const ordered = [...messages].sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1))
      decorations.push(Decoration.widget(start + end, () => note(ordered), {
        side: 1,
        ignoreSelection: true,
        key: `diag-${end}-${ordered.map(m => `${m.code}:${m.from}`).join(',')}`,
      }))
    }
  }
  return DecorationSet.create(doc, decorations)
}

type DiagAttrs = { readonly class: string; readonly title: string; readonly 'data-diag-code': string }

function diagAttrs(d: Decoration): DiagAttrs | null {
  return ((d.spec as { hojaDiag?: DiagAttrs } | undefined)?.hojaDiag) ?? null
}

function staleSet(set: DecorationSet, doc: ProseMirrorNode): DecorationSet {
  return DecorationSet.create(doc, set.find().map(d => {
    const attrs = diagAttrs(d)
    if (!attrs || d.from >= d.to) return d
    const stale = { ...attrs, class: `${attrs.class} hoja-diag--stale` }
    return Decoration.inline(d.from, d.to, stale, { hojaDiag: stale })
  }))
}

/** The host's handle on one editor's diagnostics, without reaching into the editor that owns them. */
export interface FenceDiagnosticsPort {
  /** Draw a verdict (or clear with `null`). Held until the editor mounts if it has not yet. */
  set(payload: FenceDiagnosticsPayload | null): void
  /** The diagnostics drawn now, as document ranges. */
  ranges(): { from: number; to: number; className: string }[]
  /** True when the drawn diagnostics describe text the fence no longer holds. */
  stale(): boolean
  /** Select fence-text offsets `from..to` and scroll them into view; false when there is no single fence. */
  reveal(from: number, to: number): boolean
  /** The mounted view, or null. */
  readonly view: EditorView | null
}

interface PortOptions extends FenceDiagnosticsOptions {
  port: { view: EditorView | null; pending: FenceDiagnosticsPayload | null | undefined } | null
}

export const FenceDiagnostics = Extension.create<PortOptions>({
  name: 'hojaFenceDiagnostics',

  addOptions() {
    return { language: 'mus', marginNotes: true, port: null }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const port = options.port
    return [new Plugin<FenceDiagnosticsState>({
      view: view => {
        if (port) {
          port.view = view
          if (port.pending !== undefined) {
            const pending = port.pending
            port.pending = undefined
            queueMicrotask(() => { if (port.view === view) setFenceDiagnostics(view, pending) })
          }
        }
        return { destroy: () => { if (port && port.view === view) port.view = null } }
      },
      key: fenceDiagnosticsKey,
      state: {
        init: () => ({ payload: null, decorations: DecorationSet.empty, stale: false }),
        apply: (tr: Transaction, prev: FenceDiagnosticsState, _old: EditorState, next: EditorState) => {
          const meta = tr.getMeta(fenceDiagnosticsKey) as FenceDiagnosticsPayload | null | undefined
          if (meta !== undefined) {
            if (meta === null) return { payload: null, decorations: DecorationSet.empty, stale: false }
            const set = build(next.doc, meta, options)
            return { payload: meta, decorations: set ?? DecorationSet.empty, stale: set === null }
          }
          if (!tr.docChanged) return prev
          if (!prev.payload) return prev
          const mapped = prev.decorations.map(tr.mapping, tr.doc)
          const fences = findFences(tr.doc, options.language)
          const current = fences.length === 1 && fences[0]!.text === prev.payload.source
          if (current) {
            // Back to the text the verdict is about (an undo, or the content arriving after the verdict): draw it fresh.
            if (prev.stale) return { ...prev, decorations: build(tr.doc, prev.payload, options) ?? DecorationSet.empty, stale: false }
            return { ...prev, decorations: mapped, stale: false }
          }
          return { ...prev, decorations: prev.stale ? mapped : staleSet(mapped, tr.doc), stale: true }
        },
      },
      props: { decorations: state => fenceDiagnosticsKey.getState(state)?.decorations },
    })]
  },
})

/** Hand a verdict to the editor (or `null` to clear). It is drawn only if it matches the fence's current text. */
export function setFenceDiagnostics(view: EditorView, payload: FenceDiagnosticsPayload | null): void {
  view.dispatch(view.state.tr.setMeta(fenceDiagnosticsKey, payload).setMeta('addToHistory', false))
}

/** True when the drawn diagnostics describe text the fence no longer holds. */
export function fenceDiagnosticsStale(state: EditorState): boolean {
  return fenceDiagnosticsKey.getState(state)?.stale ?? false
}

/** The diagnostics currently drawn, as document ranges (for tests and for "go to" in a verdict face). */
export function fenceDiagnosticRanges(state: EditorState): { from: number; to: number; className: string }[] {
  const set = fenceDiagnosticsKey.getState(state)?.decorations
  if (!set) return []
  return set.find().filter(d => d.from < d.to && diagAttrs(d)).map(d => ({
    from: d.from,
    to: d.to,
    className: diagAttrs(d)!.class,
  }))
}

/**
 * One `FenceDiagnostics` extension and the port that drives it. Pass `extension` to the editor (Hoja's `extensions`)
 * and keep `port`: `port.set({source, diagnostics})` draws a checker's verdict into the fence.
 */
export function createFenceDiagnostics(options: Partial<FenceDiagnosticsOptions> = {}): {
  readonly extension: Extension<PortOptions>
  readonly port: FenceDiagnosticsPort
} {
  const handle: { view: EditorView | null; pending: FenceDiagnosticsPayload | null | undefined } = { view: null, pending: undefined }
  const extension = FenceDiagnostics.configure({ language: options.language ?? 'mus', marginNotes: options.marginNotes ?? true, port: handle })
  const port: FenceDiagnosticsPort = {
    set(payload) {
      if (handle.view && !handle.view.isDestroyed) setFenceDiagnostics(handle.view, payload)
      else handle.pending = payload
    },
    ranges: () => (handle.view ? fenceDiagnosticRanges(handle.view.state) : []),
    stale: () => (handle.view ? fenceDiagnosticsStale(handle.view.state) : false),
    reveal(from, to) {
      const view = handle.view
      if (!view) return false
      const fences = findFences(view.state.doc, options.language ?? 'mus')
      if (fences.length !== 1) return false
      const { start, text } = fences[0]!
      const a = start + Math.max(0, Math.min(from, text.length))
      const b = start + Math.max(0, Math.min(to, text.length))
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, b)).scrollIntoView())
      view.focus()
      return true
    },
    get view() { return handle.view },
  }
  return { extension, port }
}
