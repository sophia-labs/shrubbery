/**
 * Shell-side "Save to Garden": copy one conversation into a workspace the person can
 * write to.
 *
 * The chat host decides WHAT is copied (the same Markdown Download hands out) and
 * WHERE (the workspace the person chose, after being told "Everyone with access there
 * can read it"). This file is the cell boundary: it maps that intent to Garden's MCP
 * tools and refuses to call anything saved that Garden did not acknowledge.
 *
 * Rules carried here:
 *   - A copy is a NEW document (`expectedRevision: 0`): it can never replace one that
 *     already exists.
 *   - "Saved" needs a matching receipt from Garden (success, the same graph and
 *     document, a revision). A refusal, an error flag, another document's receipt, or
 *     no receipt is a failure, said as one.
 *   - A conversation too large for one document is written as a few numbered ones, cut
 *     at turn boundaries; if a later part fails, the error names the parts already
 *     written. Nothing is retried and nothing is deleted.
 */

import type { SaveTarget } from '@shrubbery/runtime'
import { defaultSidebarIdFactory, type SidebarIdFactory } from './sidebar-mutations.js'

/** The raw, authoritative MCP: structured results, never a cached source-mirror read. */
export interface SaveConversationMcp {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

export interface SaveConversationInput {
  readonly workspaceId: string
  readonly title: string
  readonly markdown: string
}

export interface SaveConversationOptions {
  /** The most characters in one document (the default keeps a document comfortably under any body limit). */
  readonly maxChars?: number
  readonly idFactory?: SidebarIdFactory
}

export interface SaveConversationResult {
  readonly documentIds: readonly string[]
}

/** A copy that could not be completed. `writtenDocumentIds` are the parts that did land. */
export class SaveConversationError extends Error {
  constructor(message: string, readonly writtenDocumentIds: readonly string[] = []) {
    super(message)
    this.name = 'SaveConversationError'
  }
}

export const DEFAULT_MAX_DOCUMENT_CHARS = 200_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Whole lines, each keeping its newline; a single line longer than `max` is cut where it stands. */
function chunkByLines(text: string, max: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (line.length > max) {
      if (current) chunks.push(current)
      current = ''
      for (let index = 0; index < line.length; index += max) chunks.push(line.slice(index, index + max))
      continue
    }
    if (current.length + line.length > max) {
      chunks.push(current)
      current = ''
    }
    current += line
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * Cut Markdown into parts of at most `maxChars`, at turn boundaries ("\n## "), so no
 * turn is split unless one turn alone is larger than a part (then it is cut by lines).
 * Concatenating the parts gives back the original text.
 */
export function splitMarkdownIntoParts(markdown: string, maxChars: number): string[] {
  if (markdown.length <= maxChars) return [markdown]
  const parts: string[] = []
  let current = ''
  for (const section of markdown.split(/(?=\n## )/)) {
    if (section.length > maxChars) {
      parts.push(...chunkByLines(current + section, maxChars))
      current = ''
      continue
    }
    if (current.length + section.length > maxChars) {
      parts.push(current)
      current = ''
    }
    current += section
  }
  if (current) parts.push(current)
  return parts
}

/** Garden's acknowledgement of one write: success, the same graph and document, and a revision. */
function verifyReceipt(value: unknown, graphId: string, documentId: string): void {
  const receipt = asRecord(value)
  if (!receipt) throw new Error('Garden sent no acknowledgement for the copy.')
  if (receipt.isError === true || receipt.error !== undefined) throw new Error('Garden reported an error while writing the copy.')
  if (receipt.success !== true) throw new Error('Garden did not confirm that the copy was written.')
  const graph = receipt.graphId ?? receipt.graph_id
  const document = receipt.documentId ?? receipt.document_id
  if (graph !== undefined && graph !== graphId) throw new Error('Garden acknowledged a copy in a different workspace.')
  if (document !== undefined && document !== documentId) throw new Error('Garden acknowledged a different document.')
  if (!Number.isSafeInteger(receipt.revision) || (receipt.revision as number) < 1) {
    throw new Error('Garden did not report a revision for the copy.')
  }
}

export async function saveConversationToGarden(
  mcp: SaveConversationMcp,
  input: SaveConversationInput,
  options: SaveConversationOptions = {},
): Promise<SaveConversationResult> {
  const workspaceId = input.workspaceId.trim()
  const title = input.title.trim()
  if (!workspaceId) throw new SaveConversationError('Choose a workspace to save into.')
  if (!title) throw new SaveConversationError('A title is needed to save this conversation.')
  if (!input.markdown.trim()) throw new SaveConversationError('There is nothing to save: the conversation is empty.')
  const parts = splitMarkdownIntoParts(input.markdown, options.maxChars ?? DEFAULT_MAX_DOCUMENT_CHARS)
  const idFactory = options.idFactory ?? defaultSidebarIdFactory
  const written: string[] = []
  for (const [index, part] of parts.entries()) {
    const partTitle = parts.length === 1 ? title : `${title} · part ${index + 1} of ${parts.length}`
    // The first part already opens with the conversation's own heading; each later part gets one.
    const content = index === 0 ? part : `# ${partTitle}\n${part}`
    const documentId = idFactory('document', partTitle)
    try {
      const receipt = await mcp.callTool('write_document', {
        graphId: workspaceId,
        documentId,
        title: partTitle,
        content,
        format: 'markdown',
        expectedRevision: 0,
        awaitDurable: true,
      })
      verifyReceipt(receipt, workspaceId, documentId)
    } catch (error) {
      throw new SaveConversationError(messageOf(error), written.slice())
    }
    written.push(documentId)
  }
  return { documentIds: written }
}

function textOf(envelope: Record<string, unknown>): string {
  const content = envelope.content
  if (!Array.isArray(content)) return ''
  return content
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string)
    .join('')
}

/**
 * The local cell answers a tool call with an MCP envelope (`structuredContent`, JSON text,
 * or a `value`); the hosted raw client already unwraps it. This reads the envelope into the
 * structured result, and throws, in the tool's own words, when the tool reports an error.
 */
export function callToolFromToolsCall(mcp: {
  toolsCall(name: string, args: Record<string, unknown>): Promise<unknown>
}): SaveConversationMcp {
  return {
    async callTool(name, args) {
      const result = await mcp.toolsCall(name, { ...args })
      const envelope = asRecord(result)
      if (!envelope) return result
      if (envelope.isError === true) throw new Error(textOf(envelope) || `${name} reported an error.`)
      if (envelope.structuredContent !== undefined) return envelope.structuredContent
      const text = textOf(envelope)
      if (text) {
        try {
          return JSON.parse(text) as unknown
        } catch {
          return { text }
        }
      }
      return envelope.value !== undefined ? envelope.value : envelope
    },
  }
}

export interface SaveTargetCandidate {
  readonly graphId: string
  readonly title: string
  readonly role: 'viewer' | 'editor' | 'owner'
  readonly disabled?: boolean
  /** A workspace created here that the gateway has not confirmed yet cannot be written to. */
  readonly localCreation?: unknown
}

/** The workspaces a copy may go into: writable, confirmed, once each, in the order given. */
export function saveTargetsOf(workspaces: readonly SaveTargetCandidate[]): SaveTarget[] {
  const seen = new Set<string>()
  const targets: SaveTarget[] = []
  for (const workspace of workspaces) {
    if (workspace.role === 'viewer' || workspace.disabled === true || workspace.localCreation) continue
    const graphId = workspace.graphId.trim()
    if (!graphId || seen.has(graphId)) continue
    seen.add(graphId)
    targets.push({ graphId, title: workspace.title.trim() || graphId })
  }
  return targets
}
