/**
 * Pure event source for host-owned wikilink autocomplete.
 *
 * Garden's WikiLinkSuggestion extension combines trigger detection, document
 * lookup, popup rendering, and command execution. Shrubbery keeps the kernel
 * pure: this extension only detects typed `[[query` text and dispatches
 * structural DOM events. Runtime glue owns graph lookup, dropdown UI, wire
 * creation, and replacing the trigger text with a wikilink atom.
 */

import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { resolveTextTriggerInput } from './text-trigger-input'

export const OPEN_WIKILINK_PICKER_EVENT = 'open-wikilink-picker'
export const CLOSE_WIKILINK_PICKER_EVENT = 'close-wikilink-picker'

export interface WikiLinkPickerRange {
  readonly from: number
  readonly to: number
}

export interface OpenWikiLinkPickerDetail {
  readonly query: string
  readonly matchedText: string
  readonly range: WikiLinkPickerRange
}

export type WikiLinkAutocompleteOpenHandler = (
  detail: OpenWikiLinkPickerDetail,
) => void

export type WikiLinkAutocompleteCloseHandler = () => void

export interface WikiLinkAutocompleteOptions {
  /** Instance-scoped host intent. Suppresses the legacy DOM event when set. */
  readonly onOpen?: WikiLinkAutocompleteOpenHandler
  /** Instance-scoped host intent. Suppresses the legacy DOM event when set. */
  readonly onClose?: WikiLinkAutocompleteCloseHandler
  /** Backward-compatible DOM events for document-editor consumers. */
  readonly emitLegacyPickerEvents: boolean
}

function notifyClose(view: EditorView, options: WikiLinkAutocompleteOptions): void {
  if (options.onClose) {
    options.onClose()
  } else if (options.emitLegacyPickerEvents) {
    view.dom.ownerDocument.dispatchEvent(new CustomEvent(CLOSE_WIKILINK_PICKER_EVENT))
  }
}

function notifyOpen(
  view: EditorView,
  detail: OpenWikiLinkPickerDetail,
  options: WikiLinkAutocompleteOptions,
): void {
  if (options.onOpen) {
    options.onOpen(detail)
  } else if (options.emitLegacyPickerEvents) {
    view.dom.ownerDocument.dispatchEvent(
      new CustomEvent<OpenWikiLinkPickerDetail>(OPEN_WIKILINK_PICKER_EVENT, { detail }),
    )
  }
}

function wikiLinkTriggerAtTextEnd(
  text: string,
): { readonly matchedText: string; readonly query: string; readonly startOffset: number } | null {
  const startOffset = text.lastIndexOf('[[')
  if (startOffset === -1) return null
  const matchedText = text.slice(startOffset)
  const query = matchedText.slice(2)
  // A closing bracket, line break, or inline atom ends this trigger. The atom
  // sentinel prevents a trigger from leaking across an existing wikilink.
  if (/[\[\]\n\r\uFFFC]/.test(query)) return null
  return { matchedText, query, startOffset }
}

function wikiLinkTextInputDetail(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): OpenWikiLinkPickerDetail | null {
  const input = resolveTextTriggerInput(view, from, to, text)
  if (!input) return null

  const trigger = wikiLinkTriggerAtTextEnd(`${input.textBefore}${input.text}`)
  if (!trigger) return null

  return {
    query: trigger.query,
    matchedText: trigger.matchedText,
    range: {
      from: input.parentStart + trigger.startOffset,
      to: input.insertionFrom + input.text.length,
    },
  }
}

/** Resolve the live trigger at a collapsed caret after any state transaction. */
function wikiLinkSelectionDetail(view: EditorView): OpenWikiLinkPickerDetail | null {
  const { selection } = view.state
  if (!selection.empty || !selection.$from.parent.isTextblock) return null

  const { $from } = selection
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '\uFFFC')
  const trigger = wikiLinkTriggerAtTextEnd(textBefore)
  if (!trigger) return null

  return {
    query: trigger.query,
    matchedText: trigger.matchedText,
    range: {
      from: $from.start() + trigger.startOffset,
      to: selection.from,
    },
  }
}

function detailSignature(detail: OpenWikiLinkPickerDetail): string {
  return `${detail.range.from}:${detail.range.to}:${detail.matchedText}`
}

export const WikiLinkAutocomplete = Extension.create<WikiLinkAutocompleteOptions>({
  name: 'wikilinkAutocomplete',
  // Observe before Collaboration/ySync's priority-1000 input owner consumes
  // handleTextInput; return false so the CRDT plugin still performs the edit.
  priority: 1100,

  addOptions() {
    return {
      onOpen: undefined,
      onClose: undefined,
      emitLegacyPickerEvents: true,
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    let lastInputSignature: string | null = null
    let activeTriggerSignature: string | null = null

    const open = (view: EditorView, detail: OpenWikiLinkPickerDetail): void => {
      const signature = detailSignature(detail)
      if (signature === activeTriggerSignature) return
      activeTriggerSignature = signature
      notifyOpen(view, detail, options)
    }

    const close = (view: EditorView): void => {
      if (activeTriggerSignature === null) return
      activeTriggerSignature = null
      notifyClose(view, options)
    }

    const reconcile = (view: EditorView): void => {
      const detail = wikiLinkSelectionDetail(view)
      if (detail) open(view, detail)
      else close(view)
    }

    const dispatchOnce = (view: EditorView, from: number, to: number, text: string): void => {
      const signature = `${from}:${to}:${text}`
      if (lastInputSignature === signature) return
      lastInputSignature = signature
      queueMicrotask(() => {
        if (lastInputSignature === signature) lastInputSignature = null
      })
      const detail = wikiLinkTextInputDetail(view, from, to, text)
      if (detail) open(view, detail)
      else close(view)
    }
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            dispatchOnce(view, from, to, text)
            return false
          },
          handleDOMEvents: {
            beforeinput(view, event) {
              const input = event as InputEvent
              if (input.inputType !== 'insertText' || !input.data) return false
              const { from, to } = view.state.selection
              dispatchOnce(view, from, to, input.data)
              return false
            },
          },
          handleKeyDown(view, event) {
            if (event.key === 'Escape') close(view)
            return false
          },
        },
        view(view) {
          // State reconciliation closes or updates an active trigger after
          // deletion, selection/caret movement, pasted text, and host commands.
          reconcile(view)
          return {
            update(nextView, previousState) {
              if (
                previousState.doc.eq(nextView.state.doc) &&
                previousState.selection.eq(nextView.state.selection)
              ) return
              reconcile(nextView)
            },
          }
        },
      }),
    ]
  },
})

export default WikiLinkAutocomplete
