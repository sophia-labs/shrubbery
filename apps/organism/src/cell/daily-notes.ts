/**
 * Shell-side daily-note projection and write adapter for a gardend cell.
 *
 * Components render pure date surfaces. This file owns the live workspace
 * projection query plus deterministic Garden-compatible folder/document writes.
 */

import { workspaceProjectionGraphIri } from '@shrubbery/runtime'
import {
  createSidebarDocument,
  createSidebarFolder,
  type SidebarMutationMcp,
} from './sidebar-mutations.js'

interface QueryResult {
  readonly rows?: ReadonlyArray<Record<string, string>>
}

export interface DailyNoteRest {
  query(graphId: string, sparql: string): Promise<unknown>
}

export interface DailyNoteDocument {
  readonly id: string
  readonly title: string
  readonly dateKey: string
  readonly timeZone?: string | null
  readonly updatedAt?: number
}

export type DailyNoteMcp = SidebarMutationMcp

export type DailyNoteHalf = 'first' | 'second'

export interface DailyNoteFolderHierarchy {
  readonly root: { readonly id: string; readonly name: string; readonly order: number }
  readonly month: { readonly id: string; readonly name: string; readonly order: number; readonly parentId: string }
  readonly half: { readonly id: string; readonly name: string; readonly order: number; readonly parentId: string }
  readonly dailyNoteParentId: string
  readonly dailyNoteOrder: number
}

export interface EnsureDailyNoteInput {
  readonly graphId: string
  readonly dateKey: string
  readonly timeZone: string
  readonly locale?: string
  readonly existing?: readonly DailyNoteDocument[]
}

export interface EnsureDailyNoteResult {
  readonly documentId: string
  readonly created: boolean
}

const ROOT_ID = 'folder-daily-notes'
const ROOT_NAME = 'Daily Notes'
const ROOT_ORDER = -1_000_000_000
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function bareWorkspaceId(term: string, marker: 'document' | 'folder'): string | null {
  const iri = term.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : term
  if (marker === 'document') {
    const localDocumentPrefix = 'urn:mnemosyne:local:document:'
    if (iri.startsWith(localDocumentPrefix)) return iri.slice(localDocumentPrefix.length)
  }
  for (const needle of [`:${marker}:`, `:${marker === 'document' ? 'doc' : marker}:`]) {
    const index = iri.indexOf(needle)
    if (index >= 0) return iri.slice(index + needle.length)
  }
  return null
}

function unquoteLiteral(term: string): string {
  if (term[0] !== '"') return term
  let out = ''
  for (let i = 1; i < term.length; i++) {
    const ch = term[i]
    if (ch === '\\') {
      const next = term[i + 1]
      out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next ?? ''
      i++
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

function parseDateParts(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) throw new Error(`invalid dateKey: ${dateKey}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function dateKeyFromDocumentId(documentId: string): string | null {
  const match = /^daily-note-(\d{4}-\d{2}-\d{2})$/.exec(documentId)
  return match ? match[1] : null
}

function parseUpdatedAt(term: string | undefined): number | undefined {
  if (!term) return undefined
  const value = unquoteLiteral(term)
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function formatMonthFolderName(year: number, month: number, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function formatDailyNoteTitle(dateKey: string, locale = 'en-US'): string {
  const { year, month, day } = parseDateParts(dateKey)
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function halfOfMonth(day: number): DailyNoteHalf {
  return day <= 15 ? 'first' : 'second'
}

export function dailyNoteFolderHierarchy(dateKey: string, locale = 'en-US'): DailyNoteFolderHierarchy {
  const { year, month, day } = parseDateParts(dateKey)
  const yearStr = String(year).padStart(4, '0')
  const monthStr = String(month).padStart(2, '0')
  const half = halfOfMonth(day)
  const monthId = `${ROOT_ID}-${yearStr}-${monthStr}`
  const halfId = `${monthId}-${half}`

  return {
    root: { id: ROOT_ID, name: ROOT_NAME, order: ROOT_ORDER },
    month: {
      id: monthId,
      name: formatMonthFolderName(year, month, locale),
      order: -(year * 100 + month),
      parentId: ROOT_ID,
    },
    half: {
      id: halfId,
      name: half === 'first' ? '1-15' : '16-31',
      order: half === 'second' ? 0 : 1,
      parentId: monthId,
    },
    dailyNoteParentId: halfId,
    dailyNoteOrder: -day,
  }
}

export function todayKeyForTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function dailyNoteListSparql(graphId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'SELECT ?doc (COALESCE(?dctitle, ?doctitle, "Untitled") AS ?label) ?kind ?dailyDate ?timeZone ?updatedAt',
    `WHERE { GRAPH <${ws}> {`,
    '  ?doc a doc:TipTapDocument .',
    '  OPTIONAL { ?doc dcterms:title ?dctitle }',
    '  OPTIONAL { ?doc doc:title ?doctitle }',
    '  OPTIONAL { ?doc doc:documentKind ?kind }',
    '  OPTIONAL { ?doc doc:dailyNoteDate ?dailyDate }',
    '  OPTIONAL { ?doc doc:dailyNoteTimeZone ?timeZone }',
    '  OPTIONAL { ?doc doc:updatedAt ?updatedAt }',
    '  FILTER(STR(?kind) = "daily-note" || BOUND(?dailyDate) || REGEX(STR(?doc), "daily-note-[0-9]{4}-[0-9]{2}-[0-9]{2}$"))',
    '} }',
    'ORDER BY DESC(?dailyDate)',
  ].join('\n')
}

export function dailyNoteDocumentFromRow(row: Record<string, string>): DailyNoteDocument | null {
  const id = row.doc ? bareWorkspaceId(row.doc, 'document') : null
  if (!id) return null
  const kind = row.kind ? unquoteLiteral(row.kind) : null
  const explicitDate = row.dailyDate ? unquoteLiteral(row.dailyDate) : null
  const inferredDate = dateKeyFromDocumentId(id)
  const dateKey = explicitDate || inferredDate
  if (kind !== 'daily-note' && !explicitDate && !inferredDate) return null
  if (!dateKey || !DATE_KEY_RE.test(dateKey)) return null
  return {
    id,
    title: row.label ? unquoteLiteral(row.label) : formatDailyNoteTitle(dateKey),
    dateKey,
    timeZone: row.timeZone ? unquoteLiteral(row.timeZone) : null,
    updatedAt: parseUpdatedAt(row.updatedAt),
  }
}

export async function loadDailyNotes(rest: DailyNoteRest, graphId: string): Promise<DailyNoteDocument[]> {
  const result = (await rest.query(graphId, dailyNoteListSparql(graphId))) as QueryResult
  const docs: DailyNoteDocument[] = []
  for (const row of result.rows ?? []) {
    const doc = dailyNoteDocumentFromRow(row)
    if (doc) docs.push(doc)
  }
  docs.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  return docs
}

export async function ensureDailyNote(
  mcp: DailyNoteMcp,
  input: EnsureDailyNoteInput,
): Promise<EnsureDailyNoteResult> {
  const existing = input.existing?.find(doc => doc.dateKey === input.dateKey)
  if (existing) return { documentId: existing.id, created: false }

  const hierarchy = dailyNoteFolderHierarchy(input.dateKey, input.locale)
  await createSidebarFolder(mcp, {
    graphId: input.graphId,
    folderId: hierarchy.root.id,
    name: hierarchy.root.name,
    section: 'documents',
    order: hierarchy.root.order,
  })
  await createSidebarFolder(mcp, {
    graphId: input.graphId,
    folderId: hierarchy.month.id,
    name: hierarchy.month.name,
    parentId: hierarchy.month.parentId,
    section: 'documents',
    order: hierarchy.month.order,
  })
  await createSidebarFolder(mcp, {
    graphId: input.graphId,
    folderId: hierarchy.half.id,
    name: hierarchy.half.name,
    parentId: hierarchy.half.parentId,
    section: 'documents',
    order: hierarchy.half.order,
  })

  const documentId = `daily-note-${input.dateKey}`
  await createSidebarDocument(mcp, {
    graphId: input.graphId,
    documentId,
    title: formatDailyNoteTitle(input.dateKey, input.locale),
    parentId: hierarchy.dailyNoteParentId,
    order: hierarchy.dailyNoteOrder,
    documentKind: 'daily-note',
    dailyNoteDate: input.dateKey,
    dailyNoteTimeZone: input.timeZone,
  })
  return { documentId, created: true }
}
