/**
 * What a turn changed, read off the turn's own tool calls. Pure: no DOM, no store, no fetch.
 *
 * The workspace chat writes through the cell's tools (the empowered-chat design, §2). The
 * "Changed in this turn" strip under a reply is the honest list of what those calls touched:
 * which documents, artifacts, folders and wires, how, whether the earlier state is still in
 * History, and how many writes were refused.
 *
 * Where an id comes from, most trusted first:
 *   1. `ToolCall.metadata.targets`: the host's own id-only receipt. A durable session record keeps
 *      no arguments and no results (content-free testimony), so on reload this is all there is.
 *   2. The call's arguments: what was asked of the workspace. A completed write did that.
 *   3. The call's result, when it carries one (a new document's id).
 * A write whose target nobody named is still listed ("a document"), never dropped and never guessed.
 *
 * Vera's rulings (2026-10-05) this encodes: deleting a whole document is a true delete (its history
 * goes with it), so it is shown apart and offers no History link; wires are deleted as a person
 * deletes them (no history keeps a wire); text, blocks and comments removed are kept in the
 * document's History. There is no undo button: History is the way back.
 */

import type { ToolCall } from './types.js'

/** What a change is about. Blocks and comments are changes to their document. */
export type ChangeSubject = 'document' | 'artifact' | 'folder' | 'wire'

/** How a turn changed it, in the words the strip uses. */
export type ChangeVerb =
  | 'created'
  | 'edited'
  | 'text-removed'
  | 'commented'
  | 'comment-removed'
  | 'moved'
  | 'renamed'
  | 'linked'
  | 'valued'
  | 'restored'
  | 'deleted'

/**
 * A removal, by what it costs to undo.
 *  - `document`, `folder`, `wire`: gone; nothing in the workspace keeps an earlier copy.
 *  - `text`, `comment`: the document's History keeps the version before.
 */
export type ChangeRemoval = 'document' | 'folder' | 'wire' | 'text' | 'comment'

/** One thing a turn changed. */
export interface TurnChange {
  /** Stable within a turn: `${subject}:${id}`, or the tool for a change nobody named. */
  readonly key: string
  readonly subject: ChangeSubject
  /** The id the workspace knows it by; null when the backend did not say which. */
  readonly id: string | null
  /** A name the turn itself gave it (a new title, a filename); null otherwise. */
  readonly title: string | null
  /** Every way the turn changed it, in the order the calls ran. */
  readonly verbs: readonly ChangeVerb[]
  /** The weightiest removal among them, or null. */
  readonly removal: ChangeRemoval | null
  /** The first block the turn touched in it (where "open" should land). */
  readonly blockId: string | null
  /** An artifact's media type, when the turn said it (`text/html` is shown live). */
  readonly mediaType: string | null
  /** A call on it is still running. */
  readonly pending: boolean
  /** The tools that changed it. */
  readonly tools: readonly string[]
}

export interface TurnChanges {
  readonly changes: readonly TurnChange[]
  /** Write calls the workspace refused (they changed nothing). */
  readonly refused: number
}

interface Target {
  readonly subject: ChangeSubject
  readonly id: string | null
  readonly verb: ChangeVerb
  readonly removal: ChangeRemoval | null
  readonly title?: string | null
  readonly blockId?: string | null
  readonly mediaType?: string | null
}

type Rule = (args: Record<string, unknown>, result: Record<string, unknown>) => Target[]

/** An id as the workspace spells one (and as a receipt may carry it): letters, digits, `-`, `_`, `.`, `:`. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/
const MAX_TITLE = 200
const REMOVAL_WEIGHT: Readonly<Record<ChangeRemoval, number>> = { document: 5, folder: 4, wire: 3, text: 2, comment: 1 }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value.trim()) ? value.trim() : null
}

function first(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const id = idOf(source[key])
    if (id) return id
  }
  return null
}

function ids(source: Record<string, unknown>, listKeys: readonly string[], oneKeys: readonly string[]): string[] {
  const found: string[] = []
  for (const key of listKeys) {
    const list = source[key]
    if (Array.isArray(list)) for (const item of list) { const id = idOf(item); if (id) found.push(id) }
  }
  const one = first(source, oneKeys)
  if (one) found.push(one)
  return [...new Set(found)]
}

function titleOf(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, MAX_TITLE)
  }
  return null
}

const DOC = ['documentId', 'document_id']
const BLOCK = ['blockId', 'block_id']
const ARTIFACT = ['artifact_id', 'artifactId']
const FOLDER = ['folderId', 'folder_id']

/** One document target; the id from the arguments, else from the result. */
function documentTarget(
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  verb: ChangeVerb,
  extra: Partial<Target> = {},
): Target[] {
  return [{
    subject: 'document',
    id: first(args, DOC) ?? first(result, [...DOC, 'id']),
    verb,
    removal: null,
    blockId: first(args, BLOCK),
    ...extra,
  }]
}

/** Every write tool the workspace chat may be handed, and how to read what it changed. */
const RULES: Readonly<Record<string, Rule>> = {
  create_document: (args, result) => documentTarget(args, result, 'created', {
    title: titleOf(args, ['title']) ?? titleOf(result, ['title']),
  }),
  write_document: (args, result) => documentTarget(args, result, 'edited', { title: titleOf(args, ['title']) }),
  insert_blocks: (args, result) => documentTarget(args, result, 'edited'),
  update_blocks: (args, result) => {
    const edits = Array.isArray(args.edits) ? args.edits.map(record) : []
    return documentTarget(args, result, 'edited', { blockId: first(args, BLOCK) ?? edits.map(edit => first(edit, BLOCK)).find(Boolean) ?? null })
  },
  edit_block_text: (args, result) => documentTarget(args, result, 'edited'),
  delete_blocks: (args, result) => documentTarget(args, result, 'text-removed', {
    removal: 'text',
    blockId: ids(args, ['blockIds', 'block_ids'], BLOCK)[0] ?? null,
  }),
  edit_comment: (args, result) => {
    const removed = args.action === 'delete'
    return documentTarget(args, result, removed ? 'comment-removed' : 'commented', removed ? { removal: 'comment' } : {})
  },
  value: (args) => {
    const valuations = Array.isArray(args.valuations) && args.valuations.length > 0 ? args.valuations.map(record) : [args]
    return valuations.map(item => ({
      subject: 'document' as const, id: first(item, DOC) ?? first(args, DOC), verb: 'valued' as const, removal: null,
      blockId: first(item, BLOCK),
    }))
  },
  create_folder: (args, result) => [{
    subject: 'folder', id: first(args, FOLDER) ?? first(result, [...FOLDER, 'id']), verb: 'created', removal: null,
    title: titleOf(args, ['name']),
  }],
  move_documents: (args) => {
    const moved = ids(args, ['documentIds', 'document_ids'], DOC)
    return moved.length > 0
      ? moved.map(id => ({ subject: 'document' as const, id, verb: 'moved' as const, removal: null }))
      : [{ subject: 'document', id: null, verb: 'moved', removal: null }]
  },
  move_folder: (args) => [{ subject: 'folder', id: first(args, FOLDER), verb: 'moved', removal: null }],
  rename: (args) => {
    const type = typeof args.entity_type === 'string' ? args.entity_type : args.entityType
    // A graph is never renamed from the chat (the host's argument policy refuses it).
    if (type === 'graph') return []
    return [{
      subject: type === 'folder' ? 'folder' : 'document',
      id: first(args, ['entity_id', 'entityId']),
      verb: 'renamed',
      removal: null,
      title: titleOf(args, ['new_name', 'newName']),
    }]
  },
  create_wires: (args) => {
    const wires = Array.isArray(args.wires) && args.wires.length > 0 ? args.wires.map(record) : [args]
    return wires.map(wire => {
      const source = first(wire, ['sourceDocumentId', 'source_document_id'])
      return source
        ? { subject: 'document' as const, id: source, verb: 'linked' as const, removal: null, blockId: first(wire, ['sourceBlockId', 'source_block_id']) }
        : { subject: 'wire' as const, id: first(wire, ['wireId', 'wire_id']), verb: 'linked' as const, removal: null }
    })
  },
  create_artifact_text: (args, result) => [{
    subject: 'artifact', id: first(args, ARTIFACT) ?? first(result, ARTIFACT), verb: 'created', removal: null,
    title: titleOf(args, ['filename']), mediaType: titleOf(args, ['mime_type', 'mimeType', 'media_type']),
  }],
  write_artifact_text: (args, result) => [{
    subject: 'artifact', id: first(args, ARTIFACT) ?? first(result, ARTIFACT), verb: 'edited', removal: null,
  }],
  restore_artifact_revision: (args, result) => [{
    subject: 'artifact', id: first(args, ARTIFACT) ?? first(result, ARTIFACT), verb: 'restored', removal: null,
  }],
  delete_document: (args) => [{ subject: 'document', id: first(args, DOC), verb: 'deleted', removal: 'document' }],
  delete: (args) => {
    switch (args.type) {
      case 'documents': {
        const gone = ids(args, ['documentIds', 'document_ids'], DOC)
        return (gone.length > 0 ? gone : [null]).map(id => ({ subject: 'document' as const, id, verb: 'deleted' as const, removal: 'document' as const }))
      }
      case 'blocks':
        return [{
          subject: 'document', id: first(args, DOC), verb: 'text-removed', removal: 'text',
          blockId: ids(args, ['blockIds', 'block_ids'], BLOCK)[0] ?? null,
        }]
      case 'folder':
        return [{ subject: 'folder', id: first(args, FOLDER), verb: 'deleted', removal: 'folder' }]
      case 'wires': {
        const gone = ids(args, ['wireIds', 'wire_ids'], ['wireId', 'wire_id'])
        return (gone.length > 0 ? gone : [null]).map(id => ({ subject: 'wire' as const, id, verb: 'deleted' as const, removal: 'wire' as const }))
      }
      default:
        // A delete whose kind the record does not say: a receipt (below) may still name it.
        return []
    }
  },
}

/** What a tool is called, without the prefix a host may put on it (`mnemosyne_`, `mnemosyne__`, `garden.`). */
export function baseToolName(tool: string): string {
  const name = tool.trim().toLowerCase()
  const tail = name.split(/__|[./:]/).pop() ?? name
  return tail.startsWith('mnemosyne_') ? tail.slice('mnemosyne_'.length) : tail
}

/** Whether a tool changes the workspace (one of the chat's write families). */
export function isWriteTool(tool: string): boolean {
  return Object.hasOwn(RULES, baseToolName(tool))
}

/** The verb and removal a receipt's target means for a tool whose arguments were not kept. */
function receiptMeaning(tool: string, kind: string, removed: boolean): Pick<Target, 'verb' | 'removal'> {
  const fromRule: Record<string, ChangeVerb> = {
    create_document: 'created', write_document: 'edited', insert_blocks: 'edited', update_blocks: 'edited',
    edit_block_text: 'edited', delete_blocks: 'text-removed', edit_comment: 'commented', value: 'valued',
    create_folder: 'created', move_documents: 'moved', move_folder: 'moved', rename: 'renamed', create_wires: 'linked',
    create_artifact_text: 'created', write_artifact_text: 'edited', restore_artifact_revision: 'restored',
    delete_document: 'deleted',
  }
  if (tool === 'delete' || removed) {
    if (kind === 'block') return { verb: 'text-removed', removal: 'text' }
    if (kind === 'comment') return { verb: 'comment-removed', removal: 'comment' }
    if (kind === 'folder') return { verb: 'deleted', removal: 'folder' }
    if (kind === 'wire') return { verb: 'deleted', removal: 'wire' }
    return { verb: 'deleted', removal: 'document' }
  }
  const verb = fromRule[tool] ?? 'edited'
  if (verb === 'text-removed') return { verb, removal: 'text' }
  if (verb === 'deleted') return { verb, removal: 'document' }
  return { verb, removal: null }
}

/** The host's id-only receipt (`metadata.targets`), read strictly: anything not id-shaped is dropped. */
function receiptTargets(tool: string, metadata: Record<string, unknown>): Target[] {
  const raw = metadata.targets
  if (!Array.isArray(raw)) return []
  const targets: Target[] = []
  for (const value of raw.slice(0, 64)) {
    const item = record(value)
    const kind = typeof item.kind === 'string' ? item.kind : typeof item.subject === 'string' ? item.subject : ''
    const id = idOf(item.id)
    if (!id) continue
    const meaning = receiptMeaning(tool, kind, item.removed === true)
    const title = titleOf(item, ['title'])
    const mediaType = titleOf(item, ['mediaType', 'media_type', 'mimeType', 'mime_type'])
    if (kind === 'document' || kind === 'folder' || kind === 'artifact' || kind === 'wire') {
      targets.push({ subject: kind, id, ...meaning, title, mediaType })
    } else if (kind === 'block' || kind === 'comment') {
      const documentId = first(item, DOC)
      if (!documentId) continue
      targets.push({ subject: 'document', id: documentId, ...meaning, blockId: kind === 'block' ? id : first(item, BLOCK), title })
    }
  }
  return targets
}

function parsedResult(output: string | null | undefined): Record<string, unknown> {
  if (typeof output !== 'string') return {}
  const trimmed = output.trim()
  if (!trimmed.startsWith('{')) return {}
  try {
    return record(JSON.parse(trimmed))
  } catch {
    return {}
  }
}

/** The subject a tool writes when it names none (for "a document", "an artifact"). */
function defaultSubject(tool: string): ChangeSubject {
  if (tool.includes('artifact')) return 'artifact'
  if (tool.includes('folder')) return 'folder'
  if (tool.includes('wire')) return 'wire'
  return 'document'
}

/** What one write call changed. */
function targetsOf(call: ToolCall): Target[] {
  const tool = baseToolName(call.tool)
  const rule = RULES[tool]
  if (!rule) return []
  const fromReceipt = receiptTargets(tool, record(call.metadata))
  if (fromReceipt.length > 0) return fromReceipt
  const derived = rule(record(call.input), parsedResult(call.output))
  if (derived.length > 0) return derived
  if (tool === 'delete') {
    return [{ subject: 'document', id: null, verb: 'deleted', removal: 'document' }]
  }
  if (tool === 'rename') return []
  // Asked of the workspace, but nobody said what: listed as such, never dropped.
  const fallback = rule({}, {})
  return fallback.length > 0 ? fallback.map(target => ({ ...target, id: null })) : [{
    subject: defaultSubject(tool), id: null, verb: 'edited', removal: null,
  }]
}

interface Draft {
  key: string
  subject: ChangeSubject
  id: string | null
  title: string | null
  verbs: ChangeVerb[]
  removal: ChangeRemoval | null
  blockId: string | null
  mediaType: string | null
  pending: boolean
  tools: string[]
}

/**
 * Everything a turn changed, one entry per thing, in the order it was first touched. Refused
 * writes changed nothing and are only counted. Reads are not changes.
 */
export function turnChangesOf(toolCalls: readonly ToolCall[]): TurnChanges {
  const drafts = new Map<string, Draft>()
  let refused = 0
  for (const call of toolCalls) {
    if (!isWriteTool(call.tool)) continue
    if (call.status === 'error') {
      refused += 1
      continue
    }
    const tool = baseToolName(call.tool)
    const pending = call.status === 'pending' || call.status === 'running'
    for (const target of targetsOf(call)) {
      const key = target.id ? `${target.subject}:${target.id}` : `${target.subject}:?${tool}`
      let draft = drafts.get(key)
      if (!draft) {
        draft = {
          key, subject: target.subject, id: target.id, title: null, verbs: [], removal: null,
          blockId: null, mediaType: null, pending: false, tools: [],
        }
        drafts.set(key, draft)
      }
      if (!draft.verbs.includes(target.verb)) draft.verbs.push(target.verb)
      if (target.removal && (!draft.removal || REMOVAL_WEIGHT[target.removal] > REMOVAL_WEIGHT[draft.removal])) {
        draft.removal = target.removal
      }
      // The last name the turn gave it is its name now.
      if (target.title) draft.title = target.title
      if (!draft.blockId && target.blockId) draft.blockId = target.blockId
      if (!draft.mediaType && target.mediaType) draft.mediaType = target.mediaType
      if (pending) draft.pending = true
      if (!draft.tools.includes(tool)) draft.tools.push(tool)
    }
  }
  const changes: TurnChange[] = [...drafts.values()].map(draft => Object.freeze({
    ...draft,
    verbs: Object.freeze([...draft.verbs]),
    tools: Object.freeze([...draft.tools]),
  }))
  return { changes, refused }
}
