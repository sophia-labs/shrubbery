/**
 * `typedObjectModel` — one typed resource as every face draws it (typed objects architecture D7,
 * `plans/2026-10-20-typed-objects/README.md`). Pure: the same triples, contract and catalogue give the same model.
 *
 *   typedObjectModel({iri, types, triples, contract?, catalog?, json?}) → ObjectModel
 *
 * - **Fields** come from the class contract (`emporium_vocab`'s `classCatalog` entry, §4), in the presentation's
 *   `fieldOrder`, then the contract's own order, then any other predicate the subject carries. A field is never hidden:
 *   a field with no value is `absent` and draws as an em dash.
 * - **Kinds**: a datatype that fixes one decides first (`uri` → reference, the numeric types → metric, `boolean` →
 *   state); then the presentation's `kinds`; then `inferFieldKind`, the closed rule set `card.object` uses.
 * - **Values** are the field triples (`a <Class>` plus fields on the item node, D5). A value with no triple falls back
 *   to the item's `wf:json` under the field's key, so an unfit item (which gardend keeps without field triples) still
 *   shows what its agent handed back, in the class's own columns.
 * - **Nested values** (D2 "Nesting"): a `datatype:"object"` field's values are child nodes `<parent>/<key>`
 *   (`/<key>/<i>` for multi), each typed `a <NestedClass>`; each becomes a nested model, at most three levels down.
 * - **Title and subtitle** are the presentation's keys; without them, a label triple, then the first short field.
 * - **Roles**: quote, note and document/block (what the "Show in the book" door and Publish use), from the
 *   presentation's `roles`, else the workflow convention's keys (`quote`, `note`, `documentId`, `blockId`).
 * - **Testimony**: the being (`wf:producedBy`, with its label when the read carried one), the sitting (`wf:sitting`),
 *   the moment (`prov:generatedAtTime`) and the run (the run graph's id).
 * - **Stance**: `unfit` for `a wf:Unfit` (with each `wf:violation`), `retracted` for an Emporium retraction, else `read`.
 *   Contested is the source register's stance (`card.object`); this model never infers it.
 * - **No contract**: the generic model — the class IRI's local name as the label (in words), every triple as a field
 *   (a run item's own JSON when it has no field triples), never a blank.
 */

import type { DisplayKind } from '../kinds/index.js'
import { localName } from '../value-faces/index.js'
import type { FaceSlot } from '../value-faces/index.js'
import type { ClassCatalogEntry, ClassCatalogField, ClassFieldDatatype } from './catalog.js'
import { inferFieldKind, isSafeReferenceValue, type ObjectCardField } from './field-model.js'
import {
  DCT_TITLE,
  EMPORIUM_RETRACTED_AT,
  EMPORIUM_RETRACTED_BY,
  OBJECT_NESTING_DEPTH,
  type ObjectTriple,
  PROV_GENERATED_AT,
  RDF_TYPE,
  RDFS_LABEL,
  SKOS_PREF_LABEL,
  typesOf,
  WF,
  XSD,
} from './terms.js'

/** How the object stands: a stance on the one display (07-30: "registers get displays; states get stances"). */
export type ObjectStance = 'read' | 'unfit' | 'retracted' | 'contested'
export const OBJECT_STANCES = ['read', 'unfit', 'retracted', 'contested'] as const satisfies readonly ObjectStance[]

/** Whose matter it is: a workflow run's testimony, or an object of the workspace. */
export type ObjectRegister = 'run' | 'workspace'

export interface ObjectModelField extends ObjectCardField {
  /** The predicate's local name (the presentation's key, the JSON key an agent hands back). */
  readonly key: string
  /** The predicate IRI, when the field is one. */
  readonly iri?: string
  readonly description?: string
  readonly datatype?: ClassFieldDatatype
  readonly required?: boolean
  /** Every value of a multi field, formatted; `value` joins them. */
  readonly values?: readonly string[]
  /** A nested field's values as objects (D2 "Nesting"); `value` is their titles. */
  readonly objects?: readonly ObjectModel[]
}

export interface ObjectTestimony {
  readonly by?: { readonly agentIri: string; readonly label?: string }
  readonly sitting?: string
  readonly run?: { readonly iri: string; readonly id: string }
  readonly at?: string
}

export interface ObjectRoles {
  readonly quote?: string
  readonly note?: string
  readonly document?: { readonly documentId: string; readonly blockId?: string }
}

export interface ObjectModel {
  readonly iri: string
  readonly classIri: string
  readonly classLabel: string
  readonly plural: string
  readonly title: string
  readonly subtitle?: string
  readonly fields: readonly ObjectModelField[]
  readonly roles: ObjectRoles
  readonly testimony: ObjectTestimony
  readonly stance: ObjectStance
  readonly violations?: readonly string[]
  readonly register: ObjectRegister
  /** A class contract shaped it (false: the generic model). */
  readonly typed: boolean
  /** The keys that play a part (title, subtitle, roles), so compact slots can leave them to their own places. */
  readonly roleKeys: {
    readonly title?: string
    readonly subtitle?: string
    readonly quote?: string
    readonly note?: string
    readonly document?: string
    readonly block?: string
  }
}

export interface TypedObjectInput {
  readonly iri: string
  /** Its `rdf:type`s; read from `triples` when omitted. */
  readonly types?: readonly string[]
  /** Its triples, its nested values' triples, and the label of the being that made it (`objectTriplesQuery`). */
  readonly triples: readonly ObjectTriple[]
  /** The class's catalogue entry; absent or null, the generic model. */
  readonly contract?: ClassCatalogEntry | null
  /** The vocabulary's other classes, for nested values. */
  readonly catalog?: readonly ClassCatalogEntry[]
  /** What its agent handed back (`wf:json`), when the host has it already; else read from the triples. */
  readonly json?: unknown
}

const WF_ITEM = `${WF}Item`
const WF_UNFIT = `${WF}Unfit`
const WF_JSON = `${WF}json`
const WF_VIOLATION = `${WF}violation`
const WF_PRODUCED_BY = `${WF}producedBy`
const WF_SITTING = `${WF}sitting`
const WF_PART_OF_RUN = `${WF}partOfRun`
const LABEL_PREDICATES = [RDFS_LABEL, SKOS_PREF_LABEL, DCT_TITLE]

/** The run record's own bookkeeping, and the testimony and stance predicates: shown in their places, never as fields. */
const NOT_FIELDS = new Set([
  RDF_TYPE, WF_JSON, `${WF}inCollection`, `${WF}position`, WF_PART_OF_RUN,
  WF_PRODUCED_BY, WF_SITTING, PROV_GENERATED_AT, WF_VIOLATION,
  `${WF}itemVocab`, `${WF}itemClass`, `${WF}checkedBy`,
  EMPORIUM_RETRACTED_AT, EMPORIUM_RETRACTED_BY,
])

const NUMERIC = new Set(['integer', 'long', 'float', 'double', 'decimal', 'int', 'short', 'nonNegativeInteger', 'positiveInteger'].map((t) => `${XSD}${t}`))
const CONVENTION_ROLES = { quote: 'quote', note: 'note', document: 'documentId', block: 'blockId' } as const

/** A key or local name in words: `documentId` → "Document id", `whatDone` → "What done". */
export function humanizeKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

/** A class's label in words: the catalogue's, else its name or local name (`DreamReport` → "Dream report"). */
export function classLabelOf(classIri: string, entry?: ClassCatalogEntry | null): string {
  if (entry?.label) return entry.label
  const name = entry?.name ?? (classIri ? localName(classIri) : '')
  return name ? humanizeKey(name) : 'Object'
}

/** A class's plural: the catalogue's, else its label with an s ("Dream reports"). */
export function classPluralOf(classIri: string, entry?: ClassCatalogEntry | null): string {
  if (entry?.plural) return entry.plural
  const label = classLabelOf(classIri, entry)
  return /s$/i.test(label) ? label : `${label}s`
}

/** The run a run item belongs to: `urn:sophia:wf:<doc>:run:<runId>` (its graph) and the run id. */
export function runOfIri(iri: string | undefined): { iri: string; id: string } | undefined {
  if (!iri) return undefined
  const graph = iri.split('#')[0] ?? iri
  const at = graph.lastIndexOf(':run:')
  if (at < 0) return undefined
  const id = graph.slice(at + ':run:'.length)
  return id ? { iri, id } : undefined
}

function datatypeKind(datatype: ClassFieldDatatype | undefined): DisplayKind | undefined {
  if (datatype === 'uri') return 'reference'
  if (datatype === 'integer' || datatype === 'long' || datatype === 'float' || datatype === 'double') return 'metric'
  if (datatype === 'boolean') return 'state'
  return undefined
}

function termKind(o: ObjectTriple['o']): DisplayKind {
  if (o.type === 'uri') return isSafeReferenceValue(o.value) ? 'reference' : 'state'
  if (o.datatype && NUMERIC.has(o.datatype)) return 'metric'
  if (o.datatype === `${XSD}boolean`) return 'state'
  return inferFieldKind(o.value)
}

function formatLexical(value: string, datatype: ClassFieldDatatype | undefined, xsdType?: string): string {
  if (datatype === 'boolean' || xsdType === `${XSD}boolean`) return value === 'true' || value === '1' ? 'yes' : value === 'false' || value === '0' ? 'no' : value
  return value
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** A multi field's values: in the order its JSON lists them when there is one, else in lexical order. */
function orderValues(values: readonly string[], json: unknown): string[] {
  if (values.length < 2) return [...values]
  const listed = Array.isArray(json) ? json.map(formatJson) : []
  const rank = (v: string): number => {
    const at = listed.indexOf(v)
    return at < 0 ? Number.MAX_SAFE_INTEGER : at
  }
  return [...values].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Nested children `<parent>/<key>/<i>` in their index order, else by IRI. */
function orderChildren(iris: readonly string[]): string[] {
  const index = (iri: string): number => {
    const tail = /\/(\d+)$/.exec(iri)
    return tail ? Number(tail[1]) : -1
  }
  return [...new Set(iris)].sort((a, b) => index(a) - index(b) || a.localeCompare(b))
}

interface Context {
  readonly triples: readonly ObjectTriple[]
  readonly catalog: readonly ClassCatalogEntry[]
  readonly bySubject: ReadonlyMap<string, readonly ObjectTriple[]>
}

function contextOf(input: TypedObjectInput): Context {
  const bySubject = new Map<string, ObjectTriple[]>()
  for (const t of input.triples) {
    const list = bySubject.get(t.s)
    if (list) list.push(t)
    else bySubject.set(t.s, [t])
  }
  return { triples: input.triples, catalog: input.catalog ?? [], bySubject }
}

function literalOf(own: readonly ObjectTriple[], predicate: string): string | undefined {
  return own.find((t) => t.p === predicate && t.o.type === 'literal')?.o.value
}

function nestedEntry(ctx: Context, field: ClassCatalogField, childTypes: readonly string[]): ClassCatalogEntry | null {
  const byClass = field.class ? ctx.catalog.find((e) => e.iri === field.class) : undefined
  if (byClass) return byClass
  return ctx.catalog.find((e) => childTypes.includes(e.iri)) ?? null
}

function modelFor(input: TypedObjectInput, ctx: Context, depth: number): ObjectModel {
  const iri = input.iri
  const own = ctx.bySubject.get(iri) ?? []
  const types = input.types ?? typesOf(iri, ctx.triples)
  const contract = input.contract ?? null
  const unfit = types.includes(WF_UNFIT)
  const retracted = own.some((t) => t.p === EMPORIUM_RETRACTED_AT)
  // RDF keeps no order among a subject's values: every list below is put in a stated order, never the store's.
  const violations = own.filter((t) => t.p === WF_VIOLATION).map((t) => t.o.value).sort()
  const runItem = unfit || types.includes(WF_ITEM) || own.some((t) => t.p === WF_PART_OF_RUN)
  const classIri = contract?.iri ?? types.find((t) => t !== WF_ITEM && t !== WF_UNFIT) ?? types[0] ?? ''
  const json = input.json !== undefined ? input.json : parseJson(literalOf(own, WF_JSON))
  const jsonRecord = isRecord(json) ? json : null
  const presentation = contract?.presentation

  const fields: ObjectModelField[] = contract
    ? contractFields(iri, own, contract, jsonRecord, ctx, depth)
    : genericFields(iri, own, jsonRecord, runItem, ctx, depth)

  const roleKeys = {
    quote: presentation?.roles?.quote ?? CONVENTION_ROLES.quote,
    note: presentation?.roles?.note ?? CONVENTION_ROLES.note,
    document: presentation?.roles?.document ?? CONVENTION_ROLES.document,
    block: presentation?.roles?.block ?? CONVENTION_ROLES.block,
    ...(presentation?.title ? { title: presentation.title } : {}),
    ...(presentation?.subtitle ? { subtitle: presentation.subtitle } : {}),
  }
  const fieldText = (key: string | undefined): string | undefined => {
    if (!key) return undefined
    const field = fields.find((f) => f.key === key)
    return field && !field.absent && field.value.trim() ? field.value : undefined
  }
  const documentId = fieldText(roleKeys.document)
  const blockId = fieldText(roleKeys.block)
  const roles = {
    ...(fieldText(roleKeys.quote) ? { quote: fieldText(roleKeys.quote) } : {}),
    ...(fieldText(roleKeys.note) ? { note: fieldText(roleKeys.note) } : {}),
    ...(documentId ? { document: { documentId, ...(blockId ? { blockId } : {}) } } : {}),
  }

  const classLabel = classLabelOf(classIri, contract)
  const labelled = LABEL_PREDICATES.map((p) => literalOf(own, p)).find(Boolean)
  const skip = new Set([roleKeys.document, roleKeys.block, roleKeys.quote, roleKeys.note])
  const short = (f: ObjectModelField): boolean => !f.absent && !skip.has(f.key) && !f.objects && f.value.trim() !== '' && f.value.length <= 120
  const firstShort = fields.find((f) => short(f) && (f.kind === 'state' || f.kind === 'identity')) ?? fields.find((f) => short(f) && f.kind !== 'prose')
  const title = fieldText(roleKeys.title)
    ?? labelled
    ?? (jsonRecord ? ['title', 'name'].map((k) => jsonRecord[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '') : undefined)
    ?? firstShort?.value
    ?? `${classLabel} ${localName(iri)}`
  const subtitle = fieldText(roleKeys.subtitle)

  const agentIri = own.find((t) => t.p === WF_PRODUCED_BY && t.o.type === 'uri')?.o.value
  const agentLabel = agentIri ? LABEL_PREDICATES.map((p) => literalOf(ctx.bySubject.get(agentIri) ?? [], p)).find(Boolean) : undefined
  const runIri = own.find((t) => t.p === WF_PART_OF_RUN && t.o.type === 'uri')?.o.value
  const run = runOfIri(runIri) ?? runOfIri(iri)
  const sitting = literalOf(own, WF_SITTING)
  const at = literalOf(own, PROV_GENERATED_AT)
  const testimony: ObjectTestimony = {
    ...(agentIri ? { by: { agentIri, ...(agentLabel ? { label: agentLabel } : {}) } } : {}),
    ...(sitting ? { sitting } : {}),
    ...(run ? { run } : {}),
    ...(at ? { at } : {}),
  }

  return {
    iri,
    classIri,
    classLabel,
    plural: classPluralOf(classIri, contract),
    title,
    ...(subtitle ? { subtitle } : {}),
    fields,
    roles,
    testimony,
    stance: unfit ? 'unfit' : retracted ? 'retracted' : 'read',
    ...(violations.length ? { violations } : {}),
    register: runItem ? 'run' : 'workspace',
    typed: contract !== null,
    roleKeys,
  }
}

function orderedContractFields(contract: ClassCatalogEntry): ClassCatalogField[] {
  const order = contract.presentation?.fieldOrder ?? []
  const byKey = new Map(contract.fields.map((f) => [f.key, f]))
  const first = order.map((key) => byKey.get(key)).filter((f): f is ClassCatalogField => Boolean(f))
  const listed = new Set(first.map((f) => f.key))
  return [...first, ...contract.fields.filter((f) => !listed.has(f.key))]
}

function contractFields(
  iri: string,
  own: readonly ObjectTriple[],
  contract: ClassCatalogEntry,
  json: Record<string, unknown> | null,
  ctx: Context,
  depth: number,
): ObjectModelField[] {
  const presentation = contract.presentation
  const fields = orderedContractFields(contract).map((field): ObjectModelField => {
    const terms = own.filter((t) => t.p === field.iri).map((t) => t.o)
    const jsonValue = json ? json[field.key] : undefined
    const label = field.label ?? humanizeKey(field.key)
    const base = {
      key: field.key,
      iri: field.iri,
      label,
      fullLabel: field.iri,
      datatype: field.datatype,
      ...(field.description ? { description: field.description } : {}),
      ...(field.required ? { required: true } : {}),
    }
    if (field.datatype === 'object') {
      const objects = nestedObjects(iri, field, terms, jsonValue, ctx, depth)
      if (objects.length === 0) return { ...base, value: '', kind: 'identity', absent: true }
      return { ...base, value: objects.map((o) => o.title).join(', '), kind: 'identity', objects }
    }
    const lexical: { value: string; xsd?: string }[] = terms.length
      ? terms.map((o) => ({ value: o.value, ...(o.datatype ? { xsd: o.datatype } : {}) }))
      : (Array.isArray(jsonValue) ? jsonValue : jsonValue === undefined || jsonValue === null ? [] : [jsonValue]).map((v) => ({ value: formatJson(v) }))
    const formatted = orderValues(lexical.map((v) => formatLexical(v.value, field.datatype, v.xsd)).filter((v) => v !== ''), terms.length > 1 ? jsonValue : undefined)
    const sample: unknown = terms.length ? terms[0]!.value : Array.isArray(jsonValue) ? jsonValue[0] : jsonValue
    const kind = datatypeKind(field.datatype) ?? presentation?.kinds?.[field.key] ?? inferFieldKind(typeof sample === 'string' ? sample : sample ?? null)
    const unit = kind === 'metric' ? presentation?.units?.[field.key] : undefined
    if (formatted.length === 0) return { ...base, value: '', kind, absent: true, ...(unit ? { unit } : {}) }
    const value = formatted.join(', ')
    return {
      ...base,
      value,
      kind,
      ...(unit ? { unit } : {}),
      ...(field.multi || formatted.length > 1 ? { values: formatted } : {}),
      ...(kind === 'reference' && formatted.length === 1 && isSafeReferenceValue(value) ? { href: value } : {}),
    }
  })
  // Anything else the subject testifies is shown after the class's own fields: never hidden.
  const known = new Set(contract.fields.map((f) => f.iri))
  return [...fields, ...extraFields(iri, own.filter((t) => !known.has(t.p)), ctx, depth, json)]
}

function nestedObjects(
  iri: string,
  field: ClassCatalogField,
  terms: readonly ObjectTriple['o'][],
  jsonValue: unknown,
  ctx: Context,
  depth: number,
): ObjectModel[] {
  if (depth >= OBJECT_NESTING_DEPTH) return []
  const children = orderChildren(terms.filter((o) => o.type === 'uri').map((o) => o.value))
  if (children.length) {
    return children.map((child) => {
      const types = typesOf(child, ctx.triples)
      return modelFor({ iri: child, types, triples: ctx.triples, contract: nestedEntry(ctx, field, types), catalog: ctx.catalog }, ctx, depth + 1)
    })
  }
  // An item kept from its JSON (unfit): its nested values are JSON objects, drawn with the nested class.
  const values = Array.isArray(jsonValue) ? jsonValue : isRecord(jsonValue) ? [jsonValue] : []
  return values.filter(isRecord).map((value, i) => {
    const child = field.multi || Array.isArray(jsonValue) ? `${iri}/${field.key}/${i}` : `${iri}/${field.key}`
    return modelFor({ iri: child, types: [], triples: ctx.triples, contract: nestedEntry(ctx, field, []), catalog: ctx.catalog, json: value }, ctx, depth + 1)
  })
}

/** Fields for predicates no contract names: one per predicate, by its local name. */
function extraFields(iri: string, own: readonly ObjectTriple[], ctx: Context, depth: number, json: Record<string, unknown> | null = null): ObjectModelField[] {
  const byPredicate = new Map<string, ObjectTriple[]>()
  for (const t of own) {
    if (NOT_FIELDS.has(t.p)) continue
    const list = byPredicate.get(t.p)
    if (list) list.push(t)
    else byPredicate.set(t.p, [t])
  }
  // In the order the agent handed the keys back (its JSON), then by local name.
  const jsonOrder = json ? Object.keys(json) : []
  const rank = (predicate: string): number => {
    const at = jsonOrder.indexOf(localName(predicate))
    return at < 0 ? Number.MAX_SAFE_INTEGER : at
  }
  const predicates = [...byPredicate.keys()].sort((a, b) => rank(a) - rank(b) || localName(a).localeCompare(localName(b)) || a.localeCompare(b))
  return predicates.map((predicate): ObjectModelField => {
    const list = byPredicate.get(predicate)!
    const key = localName(predicate)
    const children = list.filter((t) => t.o.type === 'uri' && t.o.value.startsWith(`${iri}/`) && ctx.bySubject.has(t.o.value))
    if (children.length === list.length && depth < OBJECT_NESTING_DEPTH) {
      // Each child keeps the order its part of the parent's JSON gives its keys (`<parent>/<key>` or `/<key>/<i>`).
      const part = json?.[key]
      const childJson = (child: string): unknown => {
        const index = /\/(\d+)$/.exec(child)
        return Array.isArray(part) ? (index ? part[Number(index[1])] : undefined) : part
      }
      const objects = orderChildren(children.map((t) => t.o.value)).map((child) => {
        const sub = childJson(child)
        return modelFor({ iri: child, triples: ctx.triples, catalog: ctx.catalog, ...(isRecord(sub) ? { json: sub } : {}) }, ctx, depth + 1)
      })
      return { key, iri: predicate, label: humanizeKey(key), fullLabel: predicate, value: objects.map((o) => o.title).join(', '), kind: 'identity', objects }
    }
    const values = orderValues(list.map((t) => formatLexical(t.o.value, undefined, t.o.datatype)), json?.[key])
    const kind = termKind(list[0]!.o)
    const value = values.join(', ')
    return {
      key,
      iri: predicate,
      label: humanizeKey(key),
      fullLabel: predicate,
      value,
      kind,
      ...(values.length > 1 ? { values } : {}),
      ...(kind === 'reference' && values.length === 1 ? { href: value } : {}),
    }
  })
}

function genericFields(
  iri: string,
  own: readonly ObjectTriple[],
  json: Record<string, unknown> | null,
  runItem: boolean,
  ctx: Context,
  depth: number,
): ObjectModelField[] {
  const fromTriples = extraFields(iri, own, ctx, depth, json)
  // A run item with no field triples (untyped, or unfit) is what its agent handed back: its JSON, in its own order.
  if (runItem && fromTriples.length === 0 && json) {
    return Object.entries(json).map(([key, value]): ObjectModelField => {
      const kind = inferFieldKind(value)
      const absent = value === null || value === undefined
      const text = formatJson(value)
      return {
        key,
        label: humanizeKey(key),
        fullLabel: key,
        value: text,
        kind,
        ...(absent ? { absent: true } : {}),
        ...(!absent && kind === 'prose' && typeof value === 'object' ? { nested: true } : {}),
        ...(kind === 'reference' ? { href: text } : {}),
      }
    })
  }
  return fromTriples
}

/** One typed resource, as every face draws it. */
export function typedObjectModel(input: TypedObjectInput): ObjectModel {
  return modelFor(input, contextOf(input), 0)
}

/**
 * The fields a slot draws. `inline`: none. `card`: two to six, the title, subtitle and the document/block plumbing left
 * to their own places, present values first (an absent field fills in only to make two). `pane` and `block`: every
 * field, in order.
 */
export function objectSlotFields(model: ObjectModel, slot: FaceSlot, maxFields = 6): readonly ObjectModelField[] {
  if (slot === 'inline') return []
  if (slot === 'pane' || slot === 'block') return model.fields
  const skip = new Set([model.roleKeys.title, model.roleKeys.subtitle, model.roleKeys.document, model.roleKeys.block].filter(Boolean))
  const candidates = model.fields.filter((f) => !skip.has(f.key))
  const cap = Math.max(2, Math.min(6, Math.floor(maxFields)))
  const present = candidates.filter((f) => !f.absent).slice(0, cap)
  if (present.length >= 2) return present
  const absent = candidates.filter((f) => f.absent).slice(0, 2 - present.length)
  const chosen = new Set([...present, ...absent])
  return candidates.filter((f) => chosen.has(f))
}

/** The `objectEmbed` block's attrs for a model (§4 "Embed block"): the IRI and the snapshots readers keep. */
export function objectEmbedAttrs(model: ObjectModel, graphId: string | null): {
  readonly iri: string
  readonly graphId: string | null
  readonly slot: 'card'
  readonly label: string
  readonly classLabel: string
} {
  return { iri: model.iri, graphId, slot: 'card', label: model.title, classLabel: model.classLabel }
}

/** The register in words, for the injerto's chip. */
export function registerWords(register: ObjectRegister): string {
  return register === 'run' ? 'run testimony' : 'workspace object'
}
