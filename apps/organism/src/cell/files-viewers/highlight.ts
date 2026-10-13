/**
 * Syntax colour for the reader's code blocks (lazy: loaded only when a code file opens). lowlight's common grammars plus
 * Dockerfile; its tree becomes the kernel's CodeHighlightRange list (offsets + `hljs-*` classes), which the editor turns
 * into decorations. The colours are the reader stylesheet's, from house tokens.
 */
import { common, createLowlight } from 'lowlight'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import type { CodeHighlighter, CodeHighlightRange } from '@shrubbery/hoja/reader'

const lowlight = createLowlight(common)
lowlight.register({ dockerfile })

interface HastText { readonly type: 'text'; readonly value: string }
interface HastElement { readonly type: 'element'; readonly properties?: { readonly className?: unknown }; readonly children: readonly HastNode[] }
type HastNode = HastText | HastElement | { readonly type: string }

export const highlightCode: CodeHighlighter = (code, language) => {
  if (!language || language === 'plaintext' || !lowlight.registered(language)) return null
  const tree = lowlight.highlight(language, code)
  const out: CodeHighlightRange[] = []
  let offset = 0
  const walk = (nodes: readonly HastNode[], classes: readonly string[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const length = (node as HastText).value.length
        if (classes.length && length) out.push({ from: offset, to: offset + length, className: classes.join(' ') })
        offset += length
      } else if (node.type === 'element') {
        const el = node as HastElement
        const own = Array.isArray(el.properties?.className) ? (el.properties!.className as unknown[]).map(String) : []
        walk(el.children, own.length ? [...classes, ...own] : classes)
      }
    }
  }
  walk(tree.children as readonly HastNode[], [])
  return out
}
