/**
 * reference-web-codec.ts — the reference web's vocabulary and its RDF codec:
 * catalog-as-data joining layout-as-data.
 *
 * The web (design: atelier-reference-web-design-20260731) is a graph of
 * reference ENTITIES — characters, wardrobe, props, scenes, atmospheres,
 * techniques, anchors — each carrying the language that binds its pixels into
 * a composed GPT Image call: composition notes (how it wants to sit in frame)
 * and an invariant fragment (the preserve-list line it contributes). Relations
 * (wears / holds / contains / variant-of / pairs-with / embedded-in) make the
 * catalog a web instead of two option rows.
 *
 * This module is the vocabulary-aware layer over the nucleus RDF substrate,
 * exactly as ux-rdf.ts is for layout: `serializeWebToTriples` /
 * `parseTriplesToWeb` are a faithful inverse pair. The app boots the web from
 * the fossil `reference-web.nt` through the same static TripleSource path the
 * layout uses; the emitter (scripts/emit-reference-web.mts) re-parses its own
 * fossil to prove the round trip and to derive the server's JSON projection —
 * the JSON is a projection OF THE FOSSIL, never a second authority.
 *
 * Pure functions only — no DOM, no fetch, no provider knowledge.
 */

import {
  I,
  L,
  compareTriples,
  isIri,
  type Term,
  type Triple,
} from '@shrubbery/nucleus'

// ── Vocabulary ────────────────────────────────────────────────────────────────

/** The atelier vocabulary namespace (sibling of the layout's ux#). */
export const ATL = 'http://sophia.ai/atelier#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

const T_WEB = `${ATL}ReferenceWeb`
const T_ENTITY = `${ATL}ReferenceEntity`
const P_HAS_ENTITY = `${ATL}hasEntity`
const P_LOCAL_ID = `${ATL}localId`
const P_KIND = `${ATL}kind`
const P_DESCRIPTION = `${ATL}description`
const P_ACCENT = `${ATL}accent`
const P_THUMBNAIL = `${ATL}thumbnail`
const P_PROVIDER_REFERENCE = `${ATL}providerReference`
const P_COMPOSITION_NOTES = `${ATL}compositionNotes`
const P_INVARIANT = `${ATL}invariant`

/** The graph a reference-web fossil claims (parallel to uxConfigGraphIri). */
export function referenceWebGraphIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:catalog:reference-web`
}

// ── The web model ─────────────────────────────────────────────────────────────

/** The seven ratified kinds (Vera, 2026-07-31: technique splits out of
 *  atmosphere from day one) plus anchor, E9's rolling continuity. */
export const WEB_KINDS = [
  'character',
  'wardrobe',
  'prop',
  'scene',
  'atmosphere',
  'technique',
  'anchor',
] as const
export type WebKind = (typeof WEB_KINDS)[number]

export const RELATION_KINDS = [
  'wears',
  'holds',
  'contains',
  'variant-of',
  'pairs-with',
  'embedded-in',
] as const
export type WebRelationKind = (typeof RELATION_KINDS)[number]

/** Relation predicate IRIs, keyed by relation kind. */
const RELATION_IRI: Record<WebRelationKind, string> = {
  wears: `${ATL}wears`,
  holds: `${ATL}holds`,
  contains: `${ATL}contains`,
  'variant-of': `${ATL}variantOf`,
  'pairs-with': `${ATL}pairsWith`,
  'embedded-in': `${ATL}embeddedIn`,
}
const RELATION_KIND_BY_IRI = new Map<string, WebRelationKind>(
  RELATION_KINDS.map((kind) => [RELATION_IRI[kind], kind]),
)

export interface WebRelation {
  readonly kind: WebRelationKind
  /** The target entity's stable id (e.g. 'prop:moon-lantern'). */
  readonly target: string
}

export interface WebEntity {
  /** Stable id, kind-prefixed: 'prop:star-cactus'. */
  readonly id: string
  readonly kind: WebKind
  readonly name: string
  readonly description: string
  readonly accent: string
  /** Public UI thumbnail path (pending studies have none yet). */
  readonly thumbnail?: string
  /** PRIVATE provider reference FILENAME under private/references/ — never a
   *  path, never pixels. Absent = the reference study is pending (or the
   *  entity rides embedded in another entity's plate). */
  readonly providerReference?: string
  /** How this thing wants to sit in frame — thirds, scale, light. */
  readonly compositionNotes: string
  /** The preserve-list fragment this entity contributes to the prompt. */
  readonly invariant: string
  readonly relations: readonly WebRelation[]
}

// ── Derived views (shared by UI, emitter, and — via the JSON projection —
//    the server) ──────────────────────────────────────────────────────────────

/** Pack roles: the kind, except character references act as 'identity'. */
export type PackRole = 'identity' | Exclude<WebKind, 'character'>

export function roleForKind(kind: WebKind): PackRole {
  return kind === 'character' ? 'identity' : kind
}

/** The host this entity's pixels live inside, if it is an embedded rider. */
export function embeddedHostOf(entity: WebEntity): string | undefined {
  return entity.relations.find((relation) => relation.kind === 'embedded-in')?.target
}

/** Pending = no reference study yet AND not an embedded rider. Visible in the
 *  composer, honest about needing a study, never selectable for spend. */
export function isPendingEntity(entity: WebEntity): boolean {
  return entity.providerReference === undefined && embeddedHostOf(entity) === undefined
}

/** Display/grouping order for kinds (identity first, medium last). */
export const KIND_ORDER: readonly WebKind[] = WEB_KINDS

// ── Serialization (web → triples) ─────────────────────────────────────────────

/** Entity IRI from its stable id: ':' becomes '-' under the atl# namespace. */
export function entityIri(id: string): string {
  return `${ATL}${id.replace(/:/g, '-')}`
}

const WEB_ROOT_IRI = `${ATL}AtelierReferenceWeb`
const WEB_ROOT_LABEL = 'Atelier reference web — entities, studies, and relations'

/**
 * Serialize the web into deterministic triples (canonically sorted, exactly as
 * serializeConfigToTriples orders the layout).
 */
export function serializeWebToTriples(entities: readonly WebEntity[]): Triple[] {
  const out: Triple[] = []
  const t = (s: string, p: string, o: Term): void => {
    out.push({ s, p, o })
  }

  t(WEB_ROOT_IRI, RDF_TYPE, I(T_WEB))
  t(WEB_ROOT_IRI, RDFS_LABEL, L(WEB_ROOT_LABEL))
  for (const entity of entities) {
    const iri = entityIri(entity.id)
    t(WEB_ROOT_IRI, P_HAS_ENTITY, I(iri))
    t(iri, RDF_TYPE, I(T_ENTITY))
    t(iri, P_LOCAL_ID, L(entity.id))
    t(iri, RDFS_LABEL, L(entity.name))
    t(iri, P_KIND, L(entity.kind))
    t(iri, P_DESCRIPTION, L(entity.description))
    t(iri, P_ACCENT, L(entity.accent))
    if (entity.thumbnail !== undefined) t(iri, P_THUMBNAIL, L(entity.thumbnail))
    if (entity.providerReference !== undefined) t(iri, P_PROVIDER_REFERENCE, L(entity.providerReference))
    t(iri, P_COMPOSITION_NOTES, L(entity.compositionNotes))
    t(iri, P_INVARIANT, L(entity.invariant))
    for (const relation of entity.relations) {
      t(iri, RELATION_IRI[relation.kind], I(entityIri(relation.target)))
    }
  }
  return out.sort(compareTriples)
}

// ── Decoding (triples → web) ──────────────────────────────────────────────────

class ReferenceWebDecodeError extends Error {
  constructor(message: string) {
    super(`reference-web decode: ${message}`)
    this.name = 'ReferenceWebDecodeError'
  }
}

function literalOf(triples: readonly Triple[], s: string, p: string): string | undefined {
  const hit = triples.find((triple) => triple.s === s && triple.p === p)
  if (!hit) return undefined
  if (isIri(hit.o)) throw new ReferenceWebDecodeError(`<${s}> ${p} must be a literal`)
  return hit.o.value
}

function requiredLiteral(triples: readonly Triple[], s: string, p: string): string {
  const value = literalOf(triples, s, p)
  if (value === undefined) throw new ReferenceWebDecodeError(`<${s}> is missing ${p}`)
  return value
}

/**
 * Decode a triple set (from the fossil, via triplesOf) into the web.
 * Self-validating: unknown kinds, dangling relation targets, or missing
 * required fields throw — a malformed fossil refuses to boot, honestly.
 * Entities come back sorted by (kind order, id); relations by (kind, target).
 */
export function parseTriplesToWeb(triples: readonly Triple[]): WebEntity[] {
  const root = triples.find(
    (triple) => triple.p === RDF_TYPE && isIri(triple.o) && triple.o.value === T_WEB,
  )?.s
  if (!root) throw new ReferenceWebDecodeError('no atl:ReferenceWeb root in the graph')

  const entityIris = triples
    .filter((triple) => triple.s === root && triple.p === P_HAS_ENTITY && isIri(triple.o))
    .map((triple) => (triple.o as { value: string }).value)

  // First pass — ids, so relation targets can resolve IRI → stable id.
  const idByIri = new Map<string, string>()
  for (const iri of entityIris) {
    idByIri.set(iri, requiredLiteral(triples, iri, P_LOCAL_ID))
  }

  const entities: WebEntity[] = entityIris.map((iri) => {
    const id = idByIri.get(iri)!
    const kind = requiredLiteral(triples, iri, P_KIND)
    if (!(WEB_KINDS as readonly string[]).includes(kind)) {
      throw new ReferenceWebDecodeError(`entity '${id}' has unknown kind '${kind}'`)
    }
    const relations: WebRelation[] = triples
      .filter((triple) => triple.s === iri && RELATION_KIND_BY_IRI.has(triple.p) && isIri(triple.o))
      .map((triple) => {
        const targetIri = (triple.o as { value: string }).value
        const target = idByIri.get(targetIri)
        if (!target) {
          throw new ReferenceWebDecodeError(`entity '${id}' relates to unknown target <${targetIri}>`)
        }
        return { kind: RELATION_KIND_BY_IRI.get(triple.p)!, target }
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target))

    const thumbnail = literalOf(triples, iri, P_THUMBNAIL)
    const providerReference = literalOf(triples, iri, P_PROVIDER_REFERENCE)
    return {
      id,
      kind: kind as WebKind,
      name: requiredLiteral(triples, iri, RDFS_LABEL),
      description: requiredLiteral(triples, iri, P_DESCRIPTION),
      accent: requiredLiteral(triples, iri, P_ACCENT),
      ...(thumbnail !== undefined ? { thumbnail } : {}),
      ...(providerReference !== undefined ? { providerReference } : {}),
      compositionNotes: requiredLiteral(triples, iri, P_COMPOSITION_NOTES),
      invariant: requiredLiteral(triples, iri, P_INVARIANT),
      relations,
    }
  })

  return entities.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id),
  )
}
