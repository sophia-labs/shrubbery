/**
 * @shrubbery/atelier-vtuber — mesh-classify: which parts of a real VRM are
 * the garment. A PURE classification layer over glb-inspect's dissection
 * (VrmInspectionReport) — no three, no DOM, no I/O. It answers one question,
 * two ways, because real VRMs offer either or both signals:
 *
 *   - MESH-NAME classification: a mesh's own `name` (e.g. seed-san's 'wear',
 *     'hair', 'head') matched against a small alias table. This is the ONLY
 *     usable signal on a fixture like seed-san.vrm, whose material names
 *     ('body_bake', 'huku_bake', 'eye', ...) carry none of the VRoid suffix
 *     convention at all (verified: ingest-base.ts's own
 *     inferMaterialTaxonomy returns [] for this fixture).
 *
 *   - MATERIAL-SUFFIX classification (VRoid's own trailing `_SKIN`/`_FACE`/
 *     `_EYE`/`_HAIR`/`_CLOTH` material-naming convention, generalizing
 *     ingest-base.ts's MATERIAL_TAXONOMY_SUFFIX to also recognize `_CLOTH` —
 *     that regex deliberately excludes CLOTH because wardrobe:Base's own
 *     materialTaxonomy vocabulary is body-only by design; here, classifying
 *     cloth IS the point). This is the ONLY usable signal on a fixture like
 *     avatar-sample-a.vrm, whose meshes are generic "baked" bundles
 *     (Face.baked / Body.baked / Hair001.baked) that mix coverage parts
 *     across their own PRIMITIVES, sharing one vertex buffer: 'Body.baked'
 *     carries 4 primitives materialed `_SKIN` (the body itself) alongside 3
 *     materialed `_CLOTH` (Tops/Bottoms/Shoes) in the very SAME mesh. A
 *     mesh-name verdict can't separate them — only per-primitive material
 *     inspection can, which is why classification and selection both operate
 *     at PRIMITIVE granularity (glb-inspect's MeshPrimitiveSummary), not just
 *     whole-mesh.
 *
 * Classification is a hint, never a gate: an unrecognized mesh name or
 * material name classifies as 'other' — never thrown, never rejected. This
 * mirrors ingest-base.ts's/ingest-garment.ts's own no-gate architecture
 * (SHACL/reject logic belongs to Emporium, deferred) even though this module
 * sits upstream of any wardrobe:Garment value.
 */

import type { MeshPrimitiveSummary, MeshSummary } from './glb-inspect.js'

/** The coarse taxonomy a mesh or primitive classifies into. Deliberately
 * NOT the wardrobe:Garment coveragePart vocabulary (tops/bottoms/shoes/...)
 * — that's a much finer, catalog-facing distinction made later (see
 * ingest-garment.ts's coveragePart inference); this is the coarser "which
 * anatomical/functional bucket does this geometry belong to" question that
 * has to be answered FIRST, before a garment can even be carved out. */
export const MESH_CLASSIFICATIONS = ['body', 'face', 'eye', 'hair', 'cloth', 'accessory', 'other'] as const
export type MeshClassification = (typeof MESH_CLASSIFICATIONS)[number]

// ── Material-suffix classification (VRoid's own convention) ─────────────────

/** VRoid's own material-name convention: one of the taxonomy tokens as the
 * trailing name segment, optionally followed by a numeric suffix (VRoid
 * emits multiple hair materials as `..._HAIR_01`, `..._HAIR_02`, ...).
 * Case-sensitive by design, same reasoning as ingest-base.ts's
 * MATERIAL_TAXONOMY_SUFFIX: VRoid's own emitted names are uppercase; a
 * lowercase "hair" material name (seed-san's plain `hair`) is NOT this
 * convention and correctly yields no match — best-effort, not a forced
 * classification. This regex is ingest-base.ts's MATERIAL_TAXONOMY_SUFFIX
 * WIDENED to also recognize CLOTH, because unlike that module (which only
 * ever describes a Base's own body), classifying cloth is exactly this
 * module's job. */
const MATERIAL_SUFFIX_CLASSIFICATION = /_?(SKIN|FACE|EYE|HAIR|CLOTH)(_\d+)?$/

const MATERIAL_SUFFIX_TOKEN_TO_CLASSIFICATION: Record<string, MeshClassification> = {
  SKIN: 'body',
  FACE: 'face',
  EYE: 'eye',
  HAIR: 'hair',
  CLOTH: 'cloth',
}

/** Classify a single material by VRoid's trailing-suffix convention. Returns
 * 'other' for a material name that doesn't carry the convention at all
 * (seed-san's entire material list, for instance) — a real, honest verdict,
 * not a missing one. */
export function classifyMaterialName(materialName: string): MeshClassification {
  const match = materialName.match(MATERIAL_SUFFIX_CLASSIFICATION)
  if (!match) return 'other'
  return MATERIAL_SUFFIX_TOKEN_TO_CLASSIFICATION[match[1]] ?? 'other'
}

// ── Mesh-name classification (the signal seed-san offers instead) ───────────

/** Semantic mesh-name aliases — small and deliberately non-exhaustive: it
 * covers this module's two real fixtures plus a handful of common synonyms
 * a hand-authored or non-VRoid VRM is likely to use, not a universal
 * ontology. Case-insensitive EXACT match against the mesh's own `name` —
 * deliberately not substring/fuzzy: a false-positive garment classification
 * would silently mis-carve a Base. Extend this table as real assets demand
 * it; an unmatched name classifies 'other', which is always safe (never
 * silently treated as a garment). */
const MESH_NAME_CLASSIFICATION: Record<string, MeshClassification> = {
  wear: 'cloth',
  cloth: 'cloth',
  clothes: 'cloth',
  clothing: 'cloth',
  outfit: 'cloth',
  garment: 'cloth',
  hair: 'hair',
  hair_tail: 'hair',
  body: 'body',
  head: 'face',
  face: 'face',
  eye: 'eye',
  eyes: 'eye',
  // seed-san's own robotic-arm attachment: distinctly named, not part of the
  // standard humanoid coverage a Base publishes — a decorative accessory,
  // not the removable-clothing garment this module exists to find.
  robo_arm: 'accessory',
  accessory: 'accessory',
}

/** Classify a mesh by its own semantic `name` (case-insensitive exact
 * match). Returns 'other' for an unrecognized name — the mesh-name analogue
 * of classifyMaterialName's "no convention present" verdict. */
export function classifyMeshName(meshName: string): MeshClassification {
  return MESH_NAME_CLASSIFICATION[meshName.toLowerCase()] ?? 'other'
}

// ── Primitive-level classification (the granularity carving needs) ──────────

/** One primitive together with the mesh it belongs to and its own
 * material-suffix classification — the flat unit ingest-garment.ts's
 * materialClassification selection mode operates over. */
export interface ClassifiedPrimitive {
  readonly meshName: string
  readonly meshIndex: number
  readonly primitiveIndex: number
  readonly primitive: MeshPrimitiveSummary
  readonly classification: MeshClassification
}

/** Classify every primitive of every mesh in a report by its own material's
 * name (classifyMaterialName) — a primitive with no material (materialName
 * null) classifies 'other'. This is the flattened, document-wide view
 * ingest-garment.ts's 'materialClassification' selection mode filters.
 * Takes `report.meshes.meshes` directly (each MeshSummary already carries
 * its own primitives' resolved materialName — see glb-inspect.ts — so no
 * separate materials[] lookup is needed here). */
export function classifyPrimitivesByMaterial(meshes: readonly MeshSummary[]): ClassifiedPrimitive[] {
  const out: ClassifiedPrimitive[] = []
  meshes.forEach((mesh, meshIndex) => {
    mesh.primitives.forEach((primitive, primitiveIndex) => {
      const classification = primitive.materialName === null ? 'other' : classifyMaterialName(primitive.materialName)
      out.push({ meshName: mesh.name, meshIndex, primitiveIndex, primitive, classification })
    })
  })
  return out
}
