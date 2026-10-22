/**
 * The MUS source projection: which bytes of a Hoja page are the score.
 *
 * The Seele workbench's rule (`@shrubbery/runtime` `seele/source-projection.ts`, D16), for MUS: **exactly one** fenced
 * code block whose `language` is (or includes the token) `mus` (or `mus-t`). Zero fences and two-or-more fences are both
 * loud, typed errors, never a silent empty check. Prose around the fence is the piece's notes and is never read as
 * score. Pure: it reads the document JSON it is handed and nothing else.
 */
import type { HojaJSONContent } from '../types.js'

export const MUS_LANGUAGE_TOKENS: readonly string[] = ['mus', 'mus-t']

export interface MusSourceRegion {
  /** `data-block-id` when the kernel assigned one. */
  readonly blockId: string | null
  /** Child-index path from the document root to the fence. */
  readonly path: readonly number[]
}

export interface MusSourceProjection {
  readonly source: string
  readonly region: MusSourceRegion
}

export class NoMusSourceError extends Error {
  constructor() {
    super('No ```mus fence in the document: a score is exactly one code block whose language is mus.')
    this.name = 'NoMusSource'
  }
}

export class MultipleMusSourcesError extends Error {
  constructor(readonly locations: readonly MusSourceRegion[]) {
    super(`Found ${locations.length} \`\`\`mus fences; exactly one is the score. At paths ${locations.map(l => `[${l.path.join(',')}]`).join(', ')}.`)
    this.name = 'MultipleMusSources'
  }
}

export function isMusFence(node: HojaJSONContent): boolean {
  if (node.type !== 'codeBlock') return false
  const language = node.attrs?.['language']
  if (typeof language !== 'string') return false
  const tokens = language.trim().toLowerCase().split(/\s+/)
  return tokens.some(t => MUS_LANGUAGE_TOKENS.includes(t))
}

function fenceText(node: HojaJSONContent): string {
  let text = ''
  for (const child of node.content ?? []) if (child.type === 'text' && typeof child.text === 'string') text += child.text
  return text
}

export function projectMusSource(doc: HojaJSONContent): MusSourceProjection {
  const found: { node: HojaJSONContent; region: MusSourceRegion }[] = []
  const walk = (node: HojaJSONContent, path: readonly number[]): void => {
    if (isMusFence(node)) {
      const id = node.attrs?.['data-block-id']
      found.push({ node, region: { blockId: typeof id === 'string' && id ? id : null, path } })
    }
    for (const [i, child] of (node.content ?? []).entries()) walk(child, [...path, i])
  }
  for (const [i, child] of (doc.content ?? []).entries()) walk(child, [i])
  if (found.length === 0) throw new NoMusSourceError()
  if (found.length > 1) throw new MultipleMusSourcesError(found.map(f => f.region))
  return { source: fenceText(found[0]!.node), region: found[0]!.region }
}

/** A Hoja page for a score: optional prose (one paragraph per blank-line-separated block), then the ```mus fence. */
export function musPageDocument(score: string, options: { readonly title?: string; readonly notes?: string } = {}): HojaJSONContent {
  const content: HojaJSONContent[] = []
  if (options.title) content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: options.title }] })
  for (const para of (options.notes ?? '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: para }] })
  }
  content.push({ type: 'codeBlock', attrs: { language: 'mus' }, content: score ? [{ type: 'text', text: score }] : [] })
  return { type: 'doc', content }
}
