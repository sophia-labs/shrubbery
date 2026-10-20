/**
 * `resolveObjectFace` — which face draws a typed object, and with what params (typed objects architecture D7), on the
 * value-faces rule pattern (`../value-faces/index.ts`): data SELECTS a face from a closed code catalogue and fills its
 * closed params; it never supplies code (09-25, the FaceRegistry law).
 *
 *   resolveObjectFace(classIri, slot, stance, rules) → { faceId: 'object.card', params }
 *
 * Rules are records. The layers, each overriding the one before:
 *   1. built-in (`BUILTIN_OBJECT_FACE_RULES`): how much each slot shows;
 *   2. the class's presentation, from the graph (`classPresentationRules`: its title, subtitle and field order);
 *   3. the view: the params a layout leaf or host passes (`resolveObjectFace(…, { view })`).
 * Within a layer the most specific rule wins: an exact class beats a namespace beats any class; an exact stance beats
 * any; an exact slot beats any. A class no rule names gets the generic face of the same view, never a blank.
 *
 * Pure: no DOM, no network, no Lit.
 */

import type { FaceSlot } from '../value-faces/index.js'
import type { ClassCatalogEntry } from './catalog.js'
import type { ObjectStance } from './model.js'

/** The closed object-face catalogue. A graph may shadow a rule; it may not add a face id. */
export const OBJECT_FACE_IDS = ['object.card'] as const
export type ObjectFaceId = (typeof OBJECT_FACE_IDS)[number]

/** The closed params of `object.card`. */
export interface ObjectFaceParams {
  /** How many fields a card draws (two to six). */
  readonly maxFields?: number
  /** The key drawn as the title, and as the subtitle. */
  readonly titleField?: string
  readonly subtitleField?: string
  /** Keys first, in order; the rest follow, never hidden. */
  readonly fieldOrder?: readonly string[]
  /** Draw the testimony line (who made it, in which sitting and run, when). */
  readonly testimony?: boolean
  /** Draw the violations of an unfit object. */
  readonly violations?: boolean
}

export const OBJECT_FACE_PARAM_KEYS = ['maxFields', 'titleField', 'subtitleField', 'fieldOrder', 'testimony', 'violations'] as const

export interface ObjectFaceRule {
  /** A class IRI. */
  readonly kind?: string
  /** An IRI prefix; matches classes no exact rule names. */
  readonly namespace?: string
  readonly stance?: ObjectStance
  readonly slot?: FaceSlot
  readonly face: ObjectFaceId
  readonly params?: ObjectFaceParams
}

export interface ObjectFaceResolution {
  readonly faceId: ObjectFaceId
  readonly params: ObjectFaceParams
  /** True when no rule of any layer named the class: the generic face. */
  readonly generic: boolean
}

/** The built-in layer (code): how much each slot shows; an unfit object always shows why. */
export const BUILTIN_OBJECT_FACE_RULES: readonly ObjectFaceRule[] = [
  { face: 'object.card', params: { maxFields: 6, testimony: true, violations: true } },
  { face: 'object.card', slot: 'inline', params: { maxFields: 0, testimony: false, violations: false } },
  { face: 'object.card', slot: 'card', params: { maxFields: 6 } },
  { face: 'object.card', stance: 'unfit', params: { violations: true } },
]

/** The graph layer for one class: its presentation's title, subtitle and order, as a rule naming the class. */
export function classPresentationRules(entry: ClassCatalogEntry | null | undefined): readonly ObjectFaceRule[] {
  const presentation = entry?.presentation
  if (!entry || !presentation) return []
  const params: ObjectFaceParams = {
    ...(presentation.title ? { titleField: presentation.title } : {}),
    ...(presentation.subtitle ? { subtitleField: presentation.subtitle } : {}),
    ...(presentation.fieldOrder?.length ? { fieldOrder: presentation.fieldOrder } : {}),
  }
  return [{ kind: entry.iri, face: 'object.card', params }]
}

function applies(rule: ObjectFaceRule, classIri: string, slot: FaceSlot, stance: ObjectStance): boolean {
  if (rule.kind && rule.kind !== classIri) return false
  if (rule.namespace && !classIri.startsWith(rule.namespace)) return false
  if (rule.stance && rule.stance !== stance) return false
  if (rule.slot && rule.slot !== slot) return false
  return true
}

/** Least specific first, so a later (more specific) rule's params win the merge. */
function specificity(rule: ObjectFaceRule): number {
  return (rule.kind ? 4 : rule.namespace ? 2 : 0) * 4 + (rule.stance ? 2 : 0) + (rule.slot ? 1 : 0)
}

/** Only the closed keys survive a merge: a rule cannot smuggle a param the face does not declare. */
function closed(params: ObjectFaceParams | undefined): ObjectFaceParams {
  if (!params) return {}
  const out: Record<string, unknown> = {}
  for (const key of OBJECT_FACE_PARAM_KEYS) if (params[key] !== undefined) out[key] = params[key]
  return out as ObjectFaceParams
}

/**
 * Resolve the face for a class in a slot and stance. `rules` is the graph layer (default: none), merged over the
 * built-in layer; `view` is the host's own params, merged last.
 */
export function resolveObjectFace(
  classIri: string,
  slot: FaceSlot,
  stance: ObjectStance = 'read',
  rules: readonly ObjectFaceRule[] = [],
  options: { readonly builtin?: readonly ObjectFaceRule[]; readonly view?: ObjectFaceParams } = {},
): ObjectFaceResolution {
  let params: ObjectFaceParams = {}
  let named = false
  let faceId: ObjectFaceId = 'object.card'
  for (const layer of [options.builtin ?? BUILTIN_OBJECT_FACE_RULES, rules]) {
    const matching = layer.filter((rule) => applies(rule, classIri, slot, stance)).sort((a, b) => specificity(a) - specificity(b))
    for (const rule of matching) {
      if (!(OBJECT_FACE_IDS as readonly string[]).includes(rule.face)) continue
      faceId = rule.face
      params = { ...params, ...closed(rule.params) }
      if (rule.kind || rule.namespace) named = true
    }
  }
  params = { ...params, ...closed(options.view) }
  if (params.maxFields !== undefined) params = { ...params, maxFields: Math.max(0, Math.min(6, Math.floor(params.maxFields))) }
  return { faceId, params, generic: !named }
}
