/**
 * Pure event source for host-owned tag autocomplete.
 *
 * Garden's full TagSuggestion extension combines trigger detection, tag lookup,
 * and popup rendering. Shrubbery keeps the kernel pure: this extension only
 * detects heading-safe `#tag` text and dispatches structural DOM events. Runtime
 * glue owns lookup, dropdown UI, and commit.
 */

import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { shouldShowTagSuggestion } from '../tag-suggestions'
import { resolveTextTriggerInput } from './text-trigger-input'

export const OPEN_TAG_PICKER_EVENT = 'open-tag-picker'
export const CLOSE_TAG_PICKER_EVENT = 'close-tag-picker'

export interface TagPickerRange {
  readonly from: number
  readonly to: number
}

export interface OpenTagPickerDetail {
  readonly query: string
  readonly matchedText: string
  readonly range: TagPickerRange
}

function dispatchClose(view: EditorView): void {
  view.dom.ownerDocument.dispatchEvent(new CustomEvent(CLOSE_TAG_PICKER_EVENT))
}

function dispatchOpen(view: EditorView, detail: OpenTagPickerDetail): void {
  view.dom.ownerDocument.dispatchEvent(
    new CustomEvent<OpenTagPickerDetail>(OPEN_TAG_PICKER_EVENT, { detail }),
  )
}

function tagTriggerAtTextEnd(text: string): { matchedText: string; query: string; startOffset: number } | null {
  const match = /(?:^|\s)(#[^\s]*)$/.exec(text)
  const matchedText = match?.[1] ?? null
  if (!matchedText || !shouldShowTagSuggestion(matchedText)) return null
  return {
    matchedText,
    query: matchedText.slice(1),
    startOffset: text.length - matchedText.length,
  }
}

function dispatchTagTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): void {
  const input = resolveTextTriggerInput(view, from, to, text)
  if (!input) {
    dispatchClose(view)
    return
  }

  const trigger = tagTriggerAtTextEnd(`${input.textBefore}${input.text}`)
  if (!trigger) {
    dispatchClose(view)
    return
  }

  dispatchOpen(view, {
    query: trigger.query,
    matchedText: trigger.matchedText,
    range: {
      from: input.parentStart + trigger.startOffset,
      to: input.insertionFrom + input.text.length,
    },
  })
}

export const TagAutocomplete = Extension.create({
  name: 'tagAutocomplete',
  // Observe before Collaboration/ySync's priority-1000 input owner consumes
  // handleTextInput; return false so the CRDT plugin still performs the edit.
  priority: 1100,

  addProseMirrorPlugins() {
    let lastInputSignature: string | null = null
    const dispatchOnce = (view: EditorView, from: number, to: number, text: string): void => {
      const signature = `${from}:${to}:${text}`
      if (lastInputSignature === signature) return
      lastInputSignature = signature
      queueMicrotask(() => {
        if (lastInputSignature === signature) lastInputSignature = null
      })
      dispatchTagTextInput(view, from, to, text)
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
            if (event.key === 'Escape') dispatchClose(view)
            return false
          },
        },
      }),
    ]
  },
})

export default TagAutocomplete
