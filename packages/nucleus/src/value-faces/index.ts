/**
 * Value faces — the seed of `face(term, kind, stance, target)` for VALUES
 * (plans/2026-09-25-document-primitives.md §1, §3, §6 step 1).
 *
 * A value is a resource with a face: a rung in a table cell, a legend entry,
 * an axis label. This module is the pure part:
 *
 *   face(term, dictionary entry, params) → ValueView { text, tone, title, href, order }
 *
 * Data SELECTS a face; it never supplies code. The face ids are a closed code
 * catalogue (`VALUE_FACE_IDS`). Which kinds get which face is a list of
 * `ValueFaceRule`s — today the built-in layer below, later the same records
 * read from `sophia-standard`'s published `:ux:config` snapshot and a graph's
 * own `:ux:config` (view > graph > standard > builtin). The per-graph
 * `ValueDictionary` is loaded once per graph session from the graph's own
 * vocabulary (`valueDictionaryQuery` + `buildValueDictionary`): the instances
 * of every ruled kind with their `skos:prefLabel`, `skos:notation` and their
 * position in the kind's display order (a `skos:OrderedCollection`).
 *
 * Keys: an IRI resolves through the dictionary (its `rdf:type` is the kind);
 * a literal resolves by its DATATYPE IRI (the datatype is the kind); an IRI
 * with no dictionary entry may still match a rule by NAMESPACE. Nothing here
 * matches on lexical guesses (a literal "falsified" is not a rung — the query
 * should select the rung itself).
 *
 * Pure: no DOM, no network, no Lit. Each target renders the ValueView:
 * web = a chip span (runtime), curl = `[exact numerics]`, agent = JSON.
 */

/** How the reader stands toward the value — the read | draft | review dial. */
export type FaceStance = 'read' | 'draft' | 'review'
export const FACE_STANCES = ['read', 'draft', 'review'] as const satisfies readonly FaceStance[]

/** Where the face is delivered, by size. */
export type FaceSlot = 'inline' | 'block' | 'card' | 'pane'

/** The closed value-face catalogue. */
export const VALUE_FACE_IDS = ['value.generic', 'value.text', 'value.chip'] as const
export type ValueFaceId = (typeof VALUE_FACE_IDS)[number]

/** The closed named-tone set; `order` tones are positions on a kind's display order. */
export type ValueNamedTone = 'muted' | 'accent' | 'warning' | 'danger'
export type ValueTone =
  | { readonly kind: 'named'; readonly name: ValueNamedTone }
  | { readonly kind: 'order'; readonly index: number; readonly count: number }

/** Structurally identical to the SPARQL JSON term the query layer carries. */
export interface ValueTerm {
  readonly type: 'uri' | 'bnode' | 'literal'
  readonly value: string
  readonly datatype?: string
  readonly language?: string
}

/** The descriptor every target renders. */
export interface ValueView {
  readonly face: ValueFaceId
  readonly text: string
  readonly tone?: ValueTone
  readonly title?: string
  readonly href?: string
  /** 0-based position in the kind's display order, when it has one. */
  readonly order?: number
  /** The resolved kind (class IRI, or datatype IRI for a literal). */
  readonly kind?: string
}

export interface ValueFaceParams {
  /** Which dictionary field supplies the text. */
  readonly label?: 'prefLabel' | 'notation' | 'localName'
  /** `byOrder`: tone from the position on the display order (named tones win). */
  readonly tone?: 'byOrder' | 'none'
}

export interface ValueFaceRule {
  /** A class IRI (IRIs, via the dictionary) or a datatype IRI (literals). */
  readonly kind?: string
  /** An IRI prefix; matches IRIs that have no dictionary entry. */
  readonly namespace?: string
  readonly stance?: FaceStance
  readonly slot?: FaceSlot
  readonly face: ValueFaceId
  readonly params?: ValueFaceParams
  /** The `skos:OrderedCollection` whose `skos:memberList` orders this kind. */
  readonly displayOrder?: string
}

export interface ValueDictionaryEntry {
  readonly iri: string
  readonly kind: string
  readonly label?: string
  readonly notation?: string
  /** 0-based position on the kind's display order. */
  readonly order?: number
  readonly tone?: ValueNamedTone
}

export interface ValueDictionary {
  readonly entries: ReadonlyMap<string, ValueDictionaryEntry>
  /** Kind IRI → member IRIs in display order. */
  readonly orders: ReadonlyMap<string, readonly string[]>
}

export const EMPTY_VALUE_DICTIONARY: ValueDictionary = { entries: new Map(), orders: new Map() }

const CLAIM = 'https://sophia-labs.ai/ontology/claim#'
const SKOS = 'http://www.w3.org/2004/02/skos/core#'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'

/**
 * The built-in layer (code). The Tabula ladder is DATA already —
 * `claim:RungDisplayOrder` and each rung's `skos:prefLabel`
 * (plans/2026-09-23-tabula-w1/10-tabula-vocab.ttl) — so the rule only names
 * the kind, its face and where its order lives.
 */
export const BUILTIN_VALUE_FACE_RULES: readonly ValueFaceRule[] = [
  {
    kind: `${CLAIM}Rung`,
    face: 'value.chip',
    params: { label: 'prefLabel', tone: 'byOrder' },
    displayOrder: `${CLAIM}RungDisplayOrder`,
  },
]

/**
 * Built-in tones for values that sit OFF the ordered axis (the note's
 * `claim:Falsified view:tone view:Danger`). A graph or the standard will carry
 * these as data; until then the built-in layer does.
 */
export const BUILTIN_VALUE_TONES: ReadonlyMap<string, ValueNamedTone> = new Map([
  [`${CLAIM}Falsified`, 'danger'],
  [`${CLAIM}NotEstablished`, 'muted'],
])

/** The generic face: `read` is the plain lexical value, `review` the RDF term notation. */
export function genericValueView(term: ValueTerm | undefined, stance: FaceStance = 'read'): ValueView {
  if (!term) return { face: 'value.generic', text: '' }
  if (term.type === 'bnode') return { face: 'value.generic', text: `_:${term.value}` }
  if (stance !== 'review' || term.type === 'uri') {
    return { face: 'value.generic', text: term.value, ...(term.type === 'uri' ? { href: term.value } : {}) }
  }
  if (term.language) return { face: 'value.generic', text: `"${term.value}"@${term.language}` }
  if (term.datatype) return { face: 'value.generic', text: `"${term.value}"^^${term.datatype}` }
  return { face: 'value.generic', text: term.value }
}

export function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'), iri.lastIndexOf(':'))
  return cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri
}

function ruleApplies(rule: ValueFaceRule, stance: FaceStance, slot: FaceSlot | undefined): boolean {
  return (!rule.stance || rule.stance === stance) && (!rule.slot || !slot || rule.slot === slot)
}

/** Most specific first: exact stance beats any, then exact slot beats any. */
function pickRule(candidates: readonly ValueFaceRule[]): ValueFaceRule | undefined {
  return [...candidates].sort((a, b) => Number(Boolean(b.stance)) - Number(Boolean(a.stance))
    || Number(Boolean(b.slot)) - Number(Boolean(a.slot)))[0]
}

/** Order tone: the position among the members that do NOT carry a named tone. */
function orderTone(entry: ValueDictionaryEntry, dictionary: ValueDictionary): ValueTone | undefined {
  const members = (dictionary.orders.get(entry.kind) ?? [])
    .filter(iri => !(dictionary.entries.get(iri)?.tone ?? BUILTIN_VALUE_TONES.get(iri)))
  const index = members.indexOf(entry.iri)
  return index < 0 ? undefined : { kind: 'order', index, count: members.length }
}

/** face(term, entry, params) for one resolved rule. */
export function faceValue(
  term: ValueTerm,
  entry: ValueDictionaryEntry | undefined,
  rule: ValueFaceRule,
  dictionary: ValueDictionary,
  stance: FaceStance,
): ValueView {
  const params = rule.params ?? {}
  if (rule.face === 'value.generic') return genericValueView(term, stance)
  const label = entry
    ? params.label === 'notation'
      ? entry.notation ?? entry.label
      : params.label === 'localName'
        ? localName(entry.iri)
        : entry.label ?? entry.notation
    : undefined
  const text = label ?? (term.type === 'uri' ? localName(term.value) : term.value)
  const named = entry ? entry.tone ?? BUILTIN_VALUE_TONES.get(entry.iri) : undefined
  const tone: ValueTone | undefined = params.tone === 'none'
    ? undefined
    : named
      ? { kind: 'named', name: named }
      : entry && params.tone === 'byOrder'
        ? orderTone(entry, dictionary)
        : undefined
  // review shows the stored notation beside the label (the IRI is in title/href).
  const reviewNotation = stance === 'review' && entry?.notation && entry.notation !== text ? entry.notation : null
  return {
    face: rule.face,
    text: reviewNotation ? `${text} · ${reviewNotation}` : text,
    ...(tone ? { tone } : {}),
    title: entry ? [entry.label, entry.notation, entry.iri].filter(Boolean).join(' · ') : term.value,
    ...(term.type === 'uri' ? { href: term.value } : {}),
    ...(entry?.order !== undefined ? { order: entry.order } : {}),
    kind: entry?.kind ?? term.datatype ?? rule.namespace,
  }
}

/**
 * Resolve a term to its value face: dictionary kind (IRIs) or datatype
 * (literals) or namespace (IRIs without an entry); the generic face when no
 * rule matches.
 */
export function resolveValueFace(
  term: ValueTerm | undefined,
  dictionary: ValueDictionary = EMPTY_VALUE_DICTIONARY,
  options: { readonly stance?: FaceStance; readonly slot?: FaceSlot; readonly rules?: readonly ValueFaceRule[] } = {},
): ValueView {
  const stance = options.stance ?? 'read'
  const rules = (options.rules ?? BUILTIN_VALUE_FACE_RULES).filter(rule => ruleApplies(rule, stance, options.slot))
  if (!term) return genericValueView(term, stance)
  if (term.type === 'uri') {
    const entry = dictionary.entries.get(term.value)
    if (entry) {
      const rule = pickRule(rules.filter(r => r.kind === entry.kind))
      if (rule) return faceValue(term, entry, rule, dictionary, stance)
    }
    const byNamespace = pickRule(rules.filter(r => r.namespace && term.value.startsWith(r.namespace)))
    if (byNamespace) return faceValue(term, undefined, byNamespace, dictionary, stance)
  } else if (term.type === 'literal' && term.datatype) {
    const rule = pickRule(rules.filter(r => r.kind === term.datatype))
    if (rule) return faceValue(term, undefined, rule, dictionary, stance)
  }
  return genericValueView(term, stance)
}

/**
 * The kind shared by EVERY non-empty term of a column, when each resolves
 * through the dictionary to one ordered kind — the precondition for sorting a
 * set of values (a table column, a chart axis) by that kind's display order.
 */
export function orderedKindOfTerms(
  terms: readonly (ValueTerm | undefined)[],
  dictionary: ValueDictionary,
): string | null {
  let kind: string | null = null
  for (const term of terms) {
    if (!term?.value) continue
    if (term.type !== 'uri') return null
    const entry = dictionary.entries.get(term.value)
    if (!entry || (kind && entry.kind !== kind)) return null
    kind = entry.kind
  }
  return kind && dictionary.orders.has(kind) ? kind : null
}

/**
 * The dictionary query: one SELECT over the graph's named graphs for the
 * instances of every ruled kind that names a display order. Rows:
 * `?kind ?v ?label ?notation ?pos` (?pos 1-based, absent when unordered).
 */
export function valueDictionaryQuery(rules: readonly ValueFaceRule[] = BUILTIN_VALUE_FACE_RULES): string | null {
  const kinds = rules.filter(rule => rule.kind && rule.displayOrder)
  if (kinds.length === 0) return null
  const values = kinds.map(rule => `(<${rule.kind}> <${rule.displayOrder}>)`).join(' ')
  return [
    `PREFIX skos: <${SKOS}>`,
    `PREFIX rdf: <${RDF}>`,
    'SELECT ?kind ?v ?label ?notation ?pos WHERE {',
    `  VALUES (?kind ?coll) { ${values} }`,
    '  GRAPH ?g { ?v rdf:type ?kind }',
    '  OPTIONAL { GRAPH ?gl { ?v skos:prefLabel ?label } FILTER(LANG(?label) = "" || LANGMATCHES(LANG(?label), "en")) }',
    '  OPTIONAL { GRAPH ?gn { ?v skos:notation ?notation } }',
    '  OPTIONAL {',
    '    SELECT ?coll ?v (COUNT(?mid) AS ?pos) WHERE {',
    '      GRAPH ?go { ?coll skos:memberList ?list . ?list rdf:rest* ?mid . ?mid rdf:rest* ?node . ?node rdf:first ?v }',
    '    } GROUP BY ?coll ?v',
    '  }',
    '}',
  ].join('\n')
}

type Row = Readonly<Record<string, ValueTerm | undefined>>

/** Build the dictionary from `valueDictionaryQuery` rows. Pure; duplicate rows fold. */
export function buildValueDictionary(rows: readonly Row[]): ValueDictionary {
  const entries = new Map<string, ValueDictionaryEntry>()
  const positions = new Map<string, Array<{ iri: string; pos: number }>>()
  for (const row of rows) {
    const iri = row.v?.type === 'uri' ? row.v.value : null
    const kind = row.kind?.type === 'uri' ? row.kind.value : null
    if (!iri || !kind) continue
    const pos = row.pos ? Number(row.pos.value) : Number.NaN
    const prior = entries.get(iri)
    entries.set(iri, {
      iri,
      kind,
      label: prior?.label ?? row.label?.value,
      notation: prior?.notation ?? row.notation?.value,
      ...(BUILTIN_VALUE_TONES.has(iri) ? { tone: BUILTIN_VALUE_TONES.get(iri) } : {}),
    })
    if (Number.isFinite(pos) && pos > 0) {
      const list = positions.get(kind) ?? []
      if (!list.some(p => p.iri === iri)) list.push({ iri, pos })
      positions.set(kind, list)
    }
  }
  const orders = new Map<string, readonly string[]>()
  for (const [kind, list] of positions) {
    const ordered = list.sort((a, b) => a.pos - b.pos).map(p => p.iri)
    orders.set(kind, ordered)
    ordered.forEach((iri, order) => {
      const entry = entries.get(iri)
      if (entry) entries.set(iri, { ...entry, order })
    })
  }
  return { entries, orders }
}

/** The curl/hypertext target: `[exact numerics]`. */
export function valueViewHypertext(view: ValueView): string {
  return view.face === 'value.chip' ? `[${view.text}]` : view.text
}
