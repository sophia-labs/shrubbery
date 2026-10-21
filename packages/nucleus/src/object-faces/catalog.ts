/**
 * The class catalogue a typed face reads (typed objects architecture §4 "Type catalogue", revised 14:15): Emporium's
 * own `emporium_vocab` (and its HTTP twins) serves each vocabulary — the built-in goldens and the graph's domain
 * ontologies — with an additive `classCatalog` array, one entry per class:
 *
 *   {iri, name, label, plural, description,
 *    fields:[{key, iri, label, description, datatype, required, multi, class?}],
 *    presentation, jsonSchema}
 *
 * A class IRI finds its vocabulary by namespace (the vocabulary whose namespace prefixes it, longest first), then its
 * entry by IRI. Parsing is tolerant: a vocabulary read without `classCatalog` (a gardend from before the extension)
 * yields no entries, and the face falls back to the generic model.
 *
 * Pure: no DOM, no network, no Lit.
 */

import type { DisplayKind } from '../kinds/index.js'
import { DISPLAY_KINDS } from '../kinds/index.js'

/** A field's datatype: the contract's scalar datatypes, and `object` for a nested class (D2 "Nesting"). */
export type ClassFieldDatatype = 'string' | 'uri' | 'integer' | 'long' | 'float' | 'double' | 'boolean' | 'dateTime' | 'object'

const DATATYPES: readonly ClassFieldDatatype[] = ['string', 'uri', 'integer', 'long', 'float', 'double', 'boolean', 'dateTime', 'object']

export interface ClassCatalogField {
  /** The predicate's local name: the JSON key an agent hands back, and the presentation's key. */
  readonly key: string
  /** The predicate IRI the instance triples use. */
  readonly iri: string
  readonly label?: string
  readonly description?: string
  readonly datatype: ClassFieldDatatype
  readonly required?: boolean
  readonly multi?: boolean
  /** For `datatype: "object"`: the nested class, of the same vocabulary. */
  readonly class?: string
}

/** How people see a class (D2): which keys are its title and subtitle, the order, kinds, units and roles. */
export interface ClassPresentation {
  readonly title?: string
  readonly subtitle?: string
  /** Keys in order; unlisted keys still render after these, never hidden. */
  readonly fieldOrder?: readonly string[]
  /** Key → one of the seven DisplayKinds. */
  readonly kinds?: Readonly<Record<string, DisplayKind>>
  /** Key → unit, for metric fields. */
  readonly units?: Readonly<Record<string, string>>
  /** What Publish and the "Show in the book" door use: role → key. */
  readonly roles?: {
    readonly quote?: string
    readonly note?: string
    readonly document?: string
    readonly block?: string
  }
}

export interface ClassCatalogEntry {
  readonly iri: string
  readonly name?: string
  readonly label?: string
  readonly plural?: string
  readonly description?: string
  readonly fields: readonly ClassCatalogField[]
  readonly presentation?: ClassPresentation
  readonly jsonSchema?: unknown
  /** The vocabulary it came from, `name@version`, when the read said so. */
  readonly vocab?: string
}

/** One row of the vocabulary list (`emporium_vocab` with no name): enough to find a class's vocabulary. */
export interface VocabSummary {
  readonly name: string
  readonly version?: string
  readonly namespace?: string
  /** Every namespace the vocabulary declares, when the read lists them. */
  readonly namespaces?: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** An MCP tool result's payload: `structuredContent`, else the JSON of its first text part, else itself. */
export function toolPayload(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) return {}
  if (isRecord(result.structuredContent)) return result.structuredContent
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (isRecord(part) && typeof part.text === 'string') {
        try {
          const parsed: unknown = JSON.parse(part.text)
          if (isRecord(parsed)) return parsed
        } catch {
          // not JSON
        }
      }
    }
  }
  return result
}

/** The vocabulary list of an `emporium_vocab` read with no name (`{vocabularies:[…]}`). */
export function vocabSummaries(result: unknown): VocabSummary[] {
  const payload = toolPayload(result)
  const list = Array.isArray(payload.vocabularies) ? payload.vocabularies : Array.isArray(payload.vocabs) ? payload.vocabs : []
  const out: VocabSummary[] = []
  for (const row of list) {
    if (!isRecord(row)) continue
    const name = text(row.name)
    if (!name) continue
    const namespaces = isRecord(row.namespaces)
      ? Object.values(row.namespaces).filter((v): v is string => typeof v === 'string')
      : Array.isArray(row.namespaces) ? row.namespaces.filter((v): v is string => typeof v === 'string') : undefined
    out.push({
      name,
      ...(text(row.version) ? { version: text(row.version) } : {}),
      ...(text(row.namespace) ? { namespace: text(row.namespace) } : {}),
      ...(namespaces?.length ? { namespaces } : {}),
    })
  }
  return out
}

/** The vocabulary whose namespace prefixes `classIri`, the longest namespace first; null when none does. */
export function vocabForClass(vocabs: readonly VocabSummary[], classIri: string): VocabSummary | null {
  let best: { vocab: VocabSummary; length: number } | null = null
  for (const vocab of vocabs) {
    for (const namespace of [vocab.namespace, ...(vocab.namespaces ?? [])]) {
      if (!namespace || !classIri.startsWith(namespace)) continue
      if (!best || namespace.length > best.length) best = { vocab, length: namespace.length }
    }
  }
  return best?.vocab ?? null
}

function parseField(raw: unknown): ClassCatalogField | null {
  if (!isRecord(raw)) return null
  const key = text(raw.key)
  const iri = text(raw.iri)
  if (!key || !iri) return null
  const datatype = DATATYPES.includes(raw.datatype as ClassFieldDatatype) ? (raw.datatype as ClassFieldDatatype) : 'string'
  return {
    key,
    iri,
    datatype,
    ...(text(raw.label) ? { label: text(raw.label) } : {}),
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    ...(raw.required === true ? { required: true } : {}),
    ...(raw.multi === true ? { multi: true } : {}),
    ...(text(raw.class) ? { class: text(raw.class) } : {}),
  }
}

function stringMap(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v
  return Object.keys(out).length ? out : undefined
}

function parsePresentation(raw: unknown): ClassPresentation | undefined {
  if (!isRecord(raw)) return undefined
  const kinds = stringMap(raw.kinds)
  const closedKinds = kinds
    ? Object.fromEntries(Object.entries(kinds).filter(([, v]) => (DISPLAY_KINDS as readonly string[]).includes(v))) as Record<string, DisplayKind>
    : undefined
  const roles = stringMap(raw.roles)
  const fieldOrder = Array.isArray(raw.fieldOrder) ? raw.fieldOrder.filter((k): k is string => typeof k === 'string') : undefined
  const presentation: ClassPresentation = {
    ...(text(raw.title) ? { title: text(raw.title) } : {}),
    ...(text(raw.subtitle) ? { subtitle: text(raw.subtitle) } : {}),
    ...(fieldOrder?.length ? { fieldOrder } : {}),
    ...(closedKinds && Object.keys(closedKinds).length ? { kinds: closedKinds } : {}),
    ...(stringMap(raw.units) ? { units: stringMap(raw.units) } : {}),
    ...(roles
      ? {
          roles: {
            ...(roles.quote ? { quote: roles.quote } : {}),
            ...(roles.note ? { note: roles.note } : {}),
            ...(roles.document ? { document: roles.document } : {}),
            ...(roles.block ? { block: roles.block } : {}),
          },
        }
      : {}),
  }
  return Object.keys(presentation).length ? presentation : undefined
}

/** One catalogue entry, or null when the row lacks an IRI or a field list. */
export function parseClassCatalogEntry(raw: unknown, vocab?: string): ClassCatalogEntry | null {
  if (!isRecord(raw)) return null
  const iri = text(raw.iri)
  if (!iri || !Array.isArray(raw.fields)) return null
  const presentation = parsePresentation(raw.presentation)
  return {
    iri,
    fields: raw.fields.map(parseField).filter((f): f is ClassCatalogField => f !== null),
    ...(text(raw.name) ? { name: text(raw.name) } : {}),
    ...(text(raw.label) ? { label: text(raw.label) } : {}),
    ...(text(raw.plural) ? { plural: text(raw.plural) } : {}),
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    ...(presentation ? { presentation } : {}),
    ...(raw.jsonSchema !== undefined ? { jsonSchema: raw.jsonSchema } : {}),
    ...(vocab ? { vocab } : {}),
  }
}

/** The `classCatalog` of one vocabulary read; empty when the read carries none. */
export function classCatalogFrom(result: unknown): ClassCatalogEntry[] {
  const payload = toolPayload(result)
  const catalog = Array.isArray(payload.classCatalog) ? payload.classCatalog : []
  const name = text(payload.name)
  const version = text(payload.version)
  const vocab = name ? (version ? `${name}@${version}` : name) : undefined
  return catalog.map((row) => parseClassCatalogEntry(row, vocab)).filter((e): e is ClassCatalogEntry => e !== null)
}

/** The entry for `classIri` in a catalogue, or null. */
export function findClassEntry(catalog: readonly ClassCatalogEntry[], classIri: string): ClassCatalogEntry | null {
  return catalog.find((entry) => entry.iri === classIri) ?? null
}
