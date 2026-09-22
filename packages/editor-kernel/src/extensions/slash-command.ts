/**
 * Pure event source for host-owned slash commands.
 *
 * Garden's SlashCommand extension combines trigger detection, popup DOM, and
 * command execution. Shrubbery keeps the kernel pure: this extension only
 * detects `/query` at a line start or after whitespace and dispatches structural
 * DOM events. Runtime glue owns filtering UI and the live editor owns execution.
 */

import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { resolveTextTriggerInput } from './text-trigger-input'

export const OPEN_SLASH_COMMAND_EVENT = 'open-slash-command'
export const CLOSE_SLASH_COMMAND_EVENT = 'close-slash-command'

export type SlashCommandId =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'table'
  | 'image'
  | 'queryBlock'
  | 'math'
  | 'horizontalRule'

export interface SlashCommandItem {
  readonly id: SlashCommandId
  readonly label: string
  readonly description: string
  readonly keywords: string
  readonly unavailable?: boolean
}

export interface SlashCommandRange {
  readonly from: number
  readonly to: number
}

export interface OpenSlashCommandDetail {
  readonly query: string
  readonly matchedText: string
  readonly range: SlashCommandRange
}

export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    id: 'heading1',
    label: 'Heading 1',
    description: 'Large section heading',
    keywords: 'h1 title',
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    description: 'Medium section heading',
    keywords: 'h2 subtitle',
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    description: 'Small section heading',
    keywords: 'h3',
  },
  {
    id: 'bulletList',
    label: 'Bullet List',
    description: 'Unordered list',
    keywords: 'ul unordered bullets',
  },
  {
    id: 'orderedList',
    label: 'Numbered List',
    description: 'Ordered list',
    keywords: 'ol numbered',
  },
  {
    id: 'taskList',
    label: 'Task List',
    description: 'Checklist with toggles',
    keywords: 'todo checkbox check',
  },
  {
    id: 'blockquote',
    label: 'Quote',
    description: 'Block quotation',
    keywords: 'quote blockquote',
  },
  {
    id: 'codeBlock',
    label: 'Code Block',
    description: 'Fenced code block',
    keywords: 'code pre fence',
  },
  {
    id: 'table',
    label: 'Table',
    description: '3x3 table',
    keywords: 'grid rows columns',
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Upload an image',
    keywords: 'img picture photo upload',
  },
  {
    id: 'queryBlock',
    label: 'Query Block',
    description: 'SPARQL query block',
    keywords: 'sparql query database search rdf graph',
  },
  {
    id: 'math',
    label: 'Math Block',
    description: 'LaTeX math equation',
    keywords: 'latex equation formula katex',
  },
  {
    id: 'horizontalRule',
    label: 'Divider',
    description: 'Horizontal rule',
    keywords: 'hr separator line divider',
  },
]

export function filterSlashCommands(query: string): readonly SlashCommandItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    command =>
      command.label.toLowerCase().includes(q) ||
      command.id.toLowerCase().includes(q) ||
      command.keywords.includes(q),
  )
}

function dispatchClose(view: EditorView): void {
  view.dom.ownerDocument.dispatchEvent(new CustomEvent(CLOSE_SLASH_COMMAND_EVENT))
}

function dispatchOpen(view: EditorView, detail: OpenSlashCommandDetail): void {
  view.dom.ownerDocument.dispatchEvent(
    new CustomEvent<OpenSlashCommandDetail>(OPEN_SLASH_COMMAND_EVENT, { detail }),
  )
}

function slashTriggerAtTextEnd(
  text: string,
): { readonly matchedText: string; readonly query: string; readonly startOffset: number } | null {
  const match = /(?:^|\s)(\/[^\s/]*)$/.exec(text)
  const matchedText = match?.[1] ?? null
  if (!matchedText) return null
  return {
    matchedText,
    query: matchedText.slice(1),
    startOffset: text.length - matchedText.length,
  }
}

function dispatchSlashTextInput(
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

  const trigger = slashTriggerAtTextEnd(`${input.textBefore}${input.text}`)
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

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  // Collaboration/ySync owns text insertion at priority 1000 and returns true
  // from handleTextInput. Trigger observers must run first, then return false so
  // the CRDT plugin still performs the actual edit.
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
      dispatchSlashTextInput(view, from, to, text)
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

export default SlashCommand
