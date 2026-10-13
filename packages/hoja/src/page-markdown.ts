import type { HojaJSONContent, HojaWikiLinkReference } from './types.js'
import { parseComposerMarkdown, serializeComposerMarkdown } from './composer-markdown.js'

/** Fallback for older seed APIs that return Markdown but no document JSON. */
export function parsePageMarkdown(
  value: string,
  references: readonly HojaWikiLinkReference[] = [],
): HojaJSONContent {
  const paragraphs = value.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  return {
    type: 'doc',
    content: paragraphs.map(raw => {
      const indent = Math.min(6, Math.floor((raw.match(/^ */)?.[0].length ?? 0) / 2))
      const line = raw.trimStart()
      const heading = /^(#{1,6})\s+([\s\S]*)$/.exec(line)
      const text = heading ? heading[2]! : line
      const inline = parseComposerMarkdown(text, references).content?.[0]?.content
      return {
        type: heading ? 'heading' : 'paragraph',
        ...(heading || indent ? { attrs: { ...(heading ? { level: heading[1]!.length } : {}), indent } } : {}),
        ...(inline?.length ? { content: inline } : {}),
      }
    }),
  }
}

/** Preview/title Markdown; TipTap JSON remains the authoritative saved form. */
export function serializePageMarkdown(document: HojaJSONContent): string {
  return (document.content ?? []).map(node => {
    const indent = Math.max(0, Math.min(6, Number(node.attrs?.indent) || 0))
    const text = serializeComposerMarkdown({ type: 'doc', content: [node] })
    const prefix = node.type === 'heading'
      ? `${'#'.repeat(Math.max(1, Math.min(6, Number(node.attrs?.level) || 1)))} `
      : ''
    return `${'  '.repeat(indent)}${prefix}${text}`
  }).join('\n\n')
}
