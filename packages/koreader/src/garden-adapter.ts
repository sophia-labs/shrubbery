import type {
  ReaderBlock,
  ReaderBlockType,
  ReaderDocument,
  ReaderMark,
} from './model.js'

/**
 * Structural view of the hosted-shaped envelope Garden already serves at
 * GET /documents/{graph_id}/{document_id}. The target package remains
 * decoupled from Garden's Rust implementation crate.
 */
export interface GardenHostedDocumentEnvelope {
  readonly entityType?: string
  readonly id: string
  readonly graphId: string
  readonly title: string
  readonly revision: number
  readonly blocks: readonly GardenHostedBlock[]
  readonly createdAt?: string | null
  readonly updatedAt?: string | null
  readonly snippet?: string | null
  readonly parentId?: string | null
  readonly readOnly?: boolean
}

export interface GardenHostedBlock {
  readonly id: string
  readonly type: string
  readonly content: string
  readonly parentId?: string | null
  readonly order?: number
  readonly level?: number | null
  readonly checked?: boolean | null
  readonly language?: string | null
  readonly marks?: readonly GardenHostedMark[]
}

export interface GardenHostedMark {
  readonly id?: string
  readonly type: string
  readonly start: number
  readonly end: number
  readonly href?: string | null
  readonly target_doc_id?: string | null
  readonly targetDocId?: string | null
  readonly targetDocumentId?: string | null
  readonly label?: string | null
}

/** Parse an untrusted hosted document response into the closed ReaderDocument model. */
export function readerDocumentFromHostedEnvelope(raw: unknown): ReaderDocument {
  const envelope = asRecord(raw, 'document')
  const id = requiredString(envelope.id, 'document.id')
  const graphId = requiredString(envelope.graphId, 'document.graphId')
  const title = requiredString(envelope.title, 'document.title')
  const revision = nonNegativeInteger(envelope.revision, 'document.revision')
  const rawBlocks = envelope.blocks
  if (!Array.isArray(rawBlocks)) {
    throw new TypeError('document.blocks must be an array')
  }

  const blocks = rawBlocks
    .map((block, index) => readerBlockFromHostedBlock(block, index))
    .sort((left, right) => left.order - right.order)

  return {
    id,
    graphId,
    title,
    revision,
    blocks,
    ...optionalStringField('createdAt', envelope.createdAt),
    ...optionalStringField('updatedAt', envelope.updatedAt),
    ...optionalStringField('snippet', envelope.snippet),
    ...optionalStringField('parentId', envelope.parentId),
    readOnly: typeof envelope.readOnly === 'boolean' ? envelope.readOnly : false,
  }
}

function readerBlockFromHostedBlock(raw: unknown, index: number): ReaderBlock {
  const path = `document.blocks[${index}]`
  const block = asRecord(raw, path)
  const id = requiredString(block.id, `${path}.id`)
  const rawType = requiredString(block.type, `${path}.type`)
  const text = typeof block.content === 'string' ? block.content : ''
  const marksRaw = block.marks
  if (marksRaw !== undefined && !Array.isArray(marksRaw)) {
    throw new TypeError(`${path}.marks must be an array`)
  }
  const marks = (marksRaw ?? []).map((mark, markIndex) =>
    readerMarkFromHostedMark(mark, index, markIndex, text.length),
  )

  return {
    id,
    type: normalizeBlockType(rawType),
    text,
    order: typeof block.order === 'number' && Number.isFinite(block.order) ? block.order : index,
    marks,
    ...optionalStringField('parentId', block.parentId),
    ...optionalFiniteNumberField('level', block.level),
    ...optionalBooleanField('checked', block.checked),
    ...optionalStringField('language', block.language),
  }
}

function readerMarkFromHostedMark(
  raw: unknown,
  blockIndex: number,
  markIndex: number,
  textLength: number,
): ReaderMark {
  const path = `document.blocks[${blockIndex}].marks[${markIndex}]`
  const mark = asRecord(raw, path)
  const type = requiredString(mark.type, `${path}.type`)
  const start = nonNegativeInteger(mark.start, `${path}.start`)
  const end = nonNegativeInteger(mark.end, `${path}.end`)
  if (end < start) throw new TypeError(`${path}.end must be greater than or equal to start`)
  if (end > textLength) throw new TypeError(`${path}.end exceeds the block's UTF-16 text length`)
  const targetDocumentId = firstOptionalString(
    mark.targetDocumentId,
    mark.targetDocId,
    mark.target_doc_id,
  )

  return {
    type,
    start,
    end,
    ...optionalStringField('id', mark.id),
    ...optionalStringField('href', mark.href),
    ...(targetDocumentId === undefined ? {} : { targetDocumentId }),
    ...optionalStringField('label', mark.label),
  }
}

function normalizeBlockType(type: string): ReaderBlockType {
  switch (type) {
    case 'heading':
      return 'heading'
    case 'bullet':
    case 'bulletList':
    case 'listItem':
      return 'bullet'
    case 'numbered':
    case 'orderedList':
      return 'numbered'
    case 'todo':
    case 'taskItem':
      return 'todo'
    case 'quote':
    case 'blockquote':
      return 'quote'
    case 'code':
    case 'codeBlock':
    case 'code_block':
      return 'code'
    case 'divider':
    case 'horizontalRule':
      return 'divider'
    case 'image':
      return 'image'
    case 'math':
    case 'mathInline':
    case 'mathBlock':
      return 'math'
    default:
      return 'paragraph'
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer`)
  }
  return value
}

function optionalStringField<Key extends string>(
  key: Key,
  value: unknown,
): { readonly [Property in Key]?: string } {
  return typeof value === 'string' && value !== ''
    ? { [key]: value } as { [Property in Key]: string }
    : {}
}

function optionalFiniteNumberField<Key extends string>(
  key: Key,
  value: unknown,
): { readonly [Property in Key]?: number } {
  return typeof value === 'number' && Number.isFinite(value)
    ? { [key]: value } as { [Property in Key]: number }
    : {}
}

function optionalBooleanField<Key extends string>(
  key: Key,
  value: unknown,
): { readonly [Property in Key]?: boolean } {
  return typeof value === 'boolean'
    ? { [key]: value } as { [Property in Key]: boolean }
    : {}
}

function firstOptionalString(...values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value !== '')
}
