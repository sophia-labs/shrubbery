/**
 * @shrubbery/atelier-vtuber — ingest-garment: the garment analog of
 * ingest-base.ts's `buildWardrobeBaseFromInspection`. Where that module
 * carves a VRM's whole rig contract into a wardrobe:Base, this one carves
 * ONE removable piece — a subset of the same VRM's meshes/primitives — into
 * a wardrobe:Garment (@shrubbery/nucleus's wardrobe-rdf.ts).
 *
 * `buildWardrobeGarmentFromInspection` is a PURE mapping: VrmInspectionReport
 * + a `selection` (which mesh(es)/primitives ARE the garment) + caller-
 * supplied provenance (facts the inspection cannot know) -> WardrobeGarment.
 * No I/O, no network, no DOM.
 *
 * SELECTION — two modes, because real VRMs carve a garment out two
 * different ways (see mesh-classify.ts's own docstring for the full
 * account):
 *   - `meshNames`: the garment is one or more WHOLE, separately-named
 *     meshes (seed-san.vrm's 'wear' — its own skin, its own 12 primitives,
 *     no sharing with 'head'/'hair'/'robo_arm').
 *   - `materialClassification`: the garment is a set of PRIMITIVES sharing a
 *     mesh with non-garment geometry, distinguished only by their own
 *     material's VRoid `_CLOTH` suffix (avatar-sample-a.vrm's 'Body.baked' —
 *     4 primitives materialed `_SKIN` alongside 3 materialed `_CLOTH`, all
 *     sharing one vertex buffer). Selection therefore always resolves to a
 *     flat list of PRIMITIVES (glb-inspect's MeshPrimitiveSummary), never
 *     whole meshes — `meshNames` just happens to select every primitive of
 *     the named mesh(es).
 *
 * ARCHITECTURAL BOUNDARY (load-bearing — read before touching this file,
 * identical stance to ingest-base.ts): this module carries data faithfully
 * and validates NOTHING. The SHACL ingestion gate and Meaningful-Object
 * materialization both belong to EMPORIUM and are DEFERRED. A selection that
 * resolves to sparse/absent license, bone, or spring data still builds a
 * Garment — empty arrays/best-effort defaults, never a thrown error, EXCEPT
 * for two function-CONTRACT checks (an empty selection; a conformed artifact
 * ref with neither contentSha nor buffer) that mirror ingest-base.ts's own
 * "programming bug, not a license gate" exception exactly.
 *
 * REQUIRED-HUMAN-BONES VOCABULARY: same VRM1-only rule as ingest-base.ts's
 * `humanBones`, and for the identical reason (wardrobe-rdf.ts's rig contract
 * is internal VRM1 canon; VRM 0.x's own humanoid vocabulary is a DIFFERENT
 * vocabulary under textually-similar names — the thumb chain is the proven
 * counterexample, see ingest-base.ts's docstring for the byte-exact
 * evidence). A VRM0-sourced Garment (avatar-sample-a's CLOTH selection, in
 * this module's own tests) therefore carries requiredHumanBones: [] even
 * though this module's own bound-bone recovery (see glb-inspect.ts's
 * primitiveBoneBinding) resolves real VRM0 bone names for it — the SAME
 * generation-agnostic mechanical fact ingest-base.ts already carries but
 * declines to trust into a VRM1-typed field.
 *
 * KNOWN GAPS, left honest rather than half-solved (same discipline as
 * ingest-base.ts's own KNOWN GAP section):
 *   - `requiredColliderGroups` is always [] — collider groups are anonymous,
 *     index-keyed in BOTH VRM generations' spec (verified in ingest-base.ts
 *     against both fixtures' raw extension JSON); inventing names would
 *     fabricate structure neither source file ever asserted.
 *   - `springChains` is always [] — UNLIKE collider groups, VRMC_springBone's
 *     `springs[]` entries ARE named in the spec (verified: seed-san.vrm's
 *     springs carry real names — 'TailHair', 'FrontHairA', 'RoboWire', ...),
 *     so this is a real, recoverable fact a future extension could carry.
 *     But glb-inspect's Vrm1SpringBoneSummary today only COUNTS springs
 *     (springCount/jointCount/colliderCount/colliderGroupCount) — it doesn't
 *     expose each spring's own name or joint node-index list, so "which
 *     springs does this garment's own aux-bone selection participate in" is
 *     not answerable from the report as it stands. Same shape of fix as
 *     auxBoneJointNames was for Base (resolve node index -> name via the
 *     spring's own joints[].node), just not done here — out of scope, not
 *     silently faked.
 *   - `hiddenBodyMask` is always [] unless provenance supplies it —
 *     inspecting ONE garment's own bytes can never tell you which of a
 *     SPECIFIC Base's mesh/region names it should hide when worn; that's a
 *     cross-reference between this Garment and a particular Base, an
 *     authoring/curation decision, not a fact latent in this file.
 *
 * LIFECYCLE DEFAULT: `sourceFormat` is supplied by the caller (inspection
 * has no notion of "which pipeline produced this conformed artifact"); when
 * `lifecycle` itself is omitted, it defaults FROM that sourceFormat (see
 * DEFAULT_LIFECYCLE_BY_SOURCE_FORMAT below) — "default the lifecycle
 * honestly from what the source is; do not assume" a fixed value regardless
 * of provenance. Always overridable: a caller who knows better (e.g. an
 * `authored` asset that hasn't been runtime-conformed yet) says so directly.
 *
 * LICENSE MAPPING reuses ingest-base.ts's own `buildLicenseTestimonies`
 * unchanged: a Garment's embedded VRM meta is the SAME file-level meta a
 * Base built from the same report would carry (byte-exact, witness
 * 'inFileMeta') — which mesh is being carved out doesn't change what the
 * file's own meta says about itself.
 */

import { createHash } from 'node:crypto'

import type {
  WardrobeArtifactRef,
  WardrobeCoveragePart,
  WardrobeGarment,
  WardrobeGarmentGeometryStats,
  WardrobeHumanBoneName,
  WardrobeLayerRule,
  WardrobeLifecycle,
  WardrobeSourceFormat,
} from '@shrubbery/nucleus'

import { buildLicenseTestimonies } from './ingest-base.js'
import type { MaterialSummary, VrmInspectionReport } from './glb-inspect.js'
import { classifyPrimitivesByMaterial, type ClassifiedPrimitive, type MeshClassification } from './mesh-classify.js'

// ── Selection: which mesh(es)/primitives ARE the garment ─────────────────────

/** Picks the garment out of a VrmInspectionReport — see this module's
 * docstring for the full account of why there are two modes. */
export type WardrobeGarmentMeshSelection =
  | { readonly mode: 'meshNames'; readonly meshNames: readonly string[] }
  | { readonly mode: 'materialClassification'; readonly classification: MeshClassification }

function resolveSelectedPrimitives(report: VrmInspectionReport, selection: WardrobeGarmentMeshSelection): ClassifiedPrimitive[] {
  const classified = classifyPrimitivesByMaterial(report.meshes.meshes)
  if (selection.mode === 'meshNames') {
    const wanted = new Set(selection.meshNames)
    return classified.filter((entry) => wanted.has(entry.meshName))
  }
  return classified.filter((entry) => entry.classification === selection.classification)
}

// ── Provenance: what the inspection cannot know ──────────────────────────────

/**
 * Facts a VrmInspectionReport plus a selection have no way to know, supplied
 * by whoever is running the ingestion — mirrors
 * WardrobeBaseIngestProvenance's own shape and "exactly one of
 * contentSha/buffer" contract, applied to the CONFORMED artifact (the
 * garment fragment actually used at runtime) rather than the whole file.
 */
export interface WardrobeGarmentIngestProvenance {
  readonly id: string
  readonly label?: string
  /** Overrides the best-effort coveragePart inference below entirely — see
   * inferCoveragePart. */
  readonly coveragePart?: WardrobeCoveragePart
  /** Inspection has no notion of stacking/conflict order — a fact about this
   * garment's intended place in an Outfit, not its geometry. */
  readonly layerRule: WardrobeLayerRule
  /** Which of a Base's own mesh/region names this garment hides when worn —
   * see this module's docstring KNOWN GAPS: unrecoverable from this
   * garment's own bytes alone. Defaults to []. */
  readonly hiddenBodyMask?: readonly string[]
  /** Which of a Base's rigContractVersion values this Garment is compatible
   * with — inspection has no cross-reference to any particular Base. */
  readonly compatibleRigContractVersions: readonly number[]
  /** Which pipeline produced the conformed artifact — see this module's
   * docstring LIFECYCLE DEFAULT. */
  readonly sourceFormat: WardrobeSourceFormat
  /** Defaults from sourceFormat (DEFAULT_LIFECYCLE_BY_SOURCE_FORMAT) when
   * omitted. */
  readonly lifecycle?: WardrobeLifecycle
  /** However the caller's artifact store names the conformed GLB fragment. */
  readonly conformedArtifactId: string
  readonly conformedContentSha?: string
  readonly conformedBuffer?: ArrayBuffer
  readonly sourceArchive?: WardrobeArtifactRef
}

function sha256Hex(buffer: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex')
}

function resolveConformedContentSha(provenance: WardrobeGarmentIngestProvenance): string {
  if (provenance.conformedContentSha !== undefined) return provenance.conformedContentSha
  if (provenance.conformedBuffer !== undefined) return sha256Hex(provenance.conformedBuffer)
  throw new Error(
    'buildWardrobeGarmentFromInspection: provenance must supply either conformedContentSha or conformedBuffer (to derive one from) for the conformed artifact ref. ' +
      'This is a function-contract check, not a license/business-rule gate — see this module\'s docstring.',
  )
}

// ── Lifecycle default: derived honestly from sourceFormat, never assumed ────

/**
 * What `lifecycle` defaults to when provenance doesn't say — see this
 * module's docstring LIFECYCLE DEFAULT section. Each mapping is
 * individually justified, not a blanket guess:
 *   - `vroidcustomitem`: a VRoid Studio built-in preset item — a closed-form
 *     baked mesh from a licensed content pack, not something freely
 *     recomposed/rebound at runtime outside VRoid's own pipeline.
 *   - `fbx-unitypackage`: a raw Unity/FBX-sourced asset — needs an offline
 *     conform/bake pass before it's usable against our rig contract at all.
 *   - `meshy`: AI mesh-generation output — needs a manual conform/rig pass
 *     before it's trustable at runtime, same reasoning as fbx-unitypackage.
 *   - `xwear`: our own conformed-to-rig-contract wearable format — built FOR
 *     runtime composition (the entire point of WardrobeOutfit's
 *     composedAtRuntime mode).
 *   - `authored`: built in-house, directly for the runtime rig from the
 *     start.
 *   - `textureVariant`: a texture-only swap (properly wardrobe:TextureVariant's
 *     own class, but mapped here too in case a Garment is ever tagged this
 *     way) — cheap, runtime-composable.
 */
const DEFAULT_LIFECYCLE_BY_SOURCE_FORMAT: Record<WardrobeSourceFormat, WardrobeLifecycle> = {
  xwear: 'composedAtRuntime',
  'fbx-unitypackage': 'bakedOffline',
  vroidcustomitem: 'bakedOffline',
  textureVariant: 'composedAtRuntime',
  authored: 'composedAtRuntime',
  meshy: 'bakedOffline',
}

// ── Coverage-part inference: best-effort from names, never a gate ───────────

const MESH_NAME_COVERAGE_PART: Record<string, WardrobeCoveragePart> = {
  wear: 'fullSet',
  outfit: 'fullSet',
  clothes: 'fullSet',
  clothing: 'fullSet',
  cloth: 'fullSet',
  garment: 'fullSet',
  tops: 'tops',
  top: 'tops',
  bottoms: 'bottoms',
  bottom: 'bottoms',
  shoes: 'shoes',
  shoe: 'shoes',
  gloves: 'gloves',
  glove: 'gloves',
  headwear: 'headwear',
  hat: 'headwear',
}

function inferCoveragePartFromMeshNames(meshNames: readonly string[]): WardrobeCoveragePart | undefined {
  if (meshNames.length !== 1) return undefined
  return MESH_NAME_COVERAGE_PART[meshNames[0].toLowerCase()]
}

const MATERIAL_NAME_COVERAGE_PART_KEYWORDS: ReadonlyArray<readonly [string, WardrobeCoveragePart]> = [
  ['tops', 'tops'],
  ['bottoms', 'bottoms'],
  ['shoes', 'shoes'],
  ['gloves', 'gloves'],
  ['headwear', 'headwear'],
]

function inferCoveragePartFromMaterialNames(materialNames: readonly string[]): WardrobeCoveragePart | undefined {
  const found = new Set<WardrobeCoveragePart>()
  for (const raw of materialNames) {
    const lower = raw.toLowerCase()
    for (const [keyword, part] of MATERIAL_NAME_COVERAGE_PART_KEYWORDS) {
      if (lower.includes(keyword)) found.add(part)
    }
  }
  if (found.size === 0) return undefined
  if (found.size === 1) return [...found][0]
  // Multiple distinct coverage-part keywords carved into ONE selection (e.g.
  // avatar-sample-a's Tops+Bottoms+Shoes combined) reads as a single full
  // outfit, not any one part — the same "wear -> fullSet" reasoning as the
  // mesh-name case above, generalized: several parts combined = the whole.
  return 'fullSet'
}

/** Best-effort coveragePart, from whichever signal the selection itself
 * offers (mesh names for `meshNames`, material names for
 * `materialClassification`) — falls back to 'accessory' when nothing
 * matches, mirroring parseWardrobeGarments' own closed-vocab default for an
 * absent/unrecognized coveragePart triple. Always overridden outright by
 * provenance.coveragePart when the caller supplies one. */
function inferCoveragePart(selection: WardrobeGarmentMeshSelection, selected: readonly ClassifiedPrimitive[]): WardrobeCoveragePart {
  if (selection.mode === 'meshNames') {
    return inferCoveragePartFromMeshNames(selection.meshNames) ?? 'accessory'
  }
  const materialNames = selected.map((entry) => entry.primitive.materialName).filter((name): name is string => name !== null)
  return inferCoveragePartFromMaterialNames(materialNames) ?? 'accessory'
}

// ── Geometry/material stats, aggregated over the selected primitives ────────

const ALPHA_MODE_RANK: Record<string, number> = { OPAQUE: 0, MASK: 1, BLEND: 2 }

/** The single most demanding alphaMode any of the garment's own materials
 * requires (BLEND > MASK > OPAQUE) — a real, non-fabricated aggregation rule
 * for a field that's necessarily singular (WardrobeGarmentGeometryStats)
 * over what is, in general, several distinct materials. */
function aggregateAlphaMode(materials: readonly MaterialSummary[]): WardrobeGarmentGeometryStats['alphaMode'] {
  let worst: WardrobeGarmentGeometryStats['alphaMode'] = 'OPAQUE'
  for (const material of materials) {
    const mode = material.alphaMode as WardrobeGarmentGeometryStats['alphaMode']
    if ((ALPHA_MODE_RANK[mode] ?? 0) > ALPHA_MODE_RANK[worst]) worst = mode
  }
  return worst
}

function computeStats(selected: readonly ClassifiedPrimitive[], materials: readonly MaterialSummary[]): WardrobeGarmentGeometryStats {
  const triangleCount = selected.reduce((sum, entry) => sum + entry.primitive.triangleCount, 0)
  const materialIndices = [
    ...new Set(selected.map((entry) => entry.primitive.materialIndex).filter((index): index is number => index !== null)),
  ]
  const selectedMaterials = materialIndices.map((index) => materials[index]).filter((m): m is MaterialSummary => m !== undefined)
  const imageIndices = new Set<number>()
  for (const material of selectedMaterials) for (const image of material.imageIndices) imageIndices.add(image)

  return {
    triangleCount,
    materialCount: materialIndices.length,
    textureCount: imageIndices.size,
    alphaMode: aggregateAlphaMode(selectedMaterials),
    usesMtoon: selectedMaterials.some((material) => material.hasMtoon),
  }
}

// ── Bone coverage, from the selected primitives' own bound-bone facts ───────

function computeAuxBones(selected: readonly ClassifiedPrimitive[]): string[] {
  return [...new Set(selected.flatMap((entry) => entry.primitive.boundAuxBoneNames))].sort()
}

function computeRequiredHumanBones(report: VrmInspectionReport, selected: readonly ClassifiedPrimitive[]): WardrobeHumanBoneName[] {
  // VRM1-only — see this module's docstring REQUIRED-HUMAN-BONES VOCABULARY.
  if (!report.vrm1) return []
  return [...new Set(selected.flatMap((entry) => entry.primitive.boundHumanBoneNames))].sort() as WardrobeHumanBoneName[]
}

// ── The mapping ───────────────────────────────────────────────────────────────

/**
 * Map a VrmInspectionReport (glb-inspect's dissection of a real VRM/GLB
 * buffer) plus a `selection` (which mesh(es)/primitives ARE the garment)
 * into a wardrobe:Garment value. Pure: same report + selection + provenance
 * always produces the same Garment; no network, no DOM, no validation, no
 * gate beyond the two function-contract checks documented above — see this
 * module's docstring for the full account of what's deferred to Emporium
 * and why requiredColliderGroups/springChains/hiddenBodyMask are honestly
 * empty by default.
 */
export function buildWardrobeGarmentFromInspection(
  report: VrmInspectionReport,
  selection: WardrobeGarmentMeshSelection,
  provenance: WardrobeGarmentIngestProvenance,
): WardrobeGarment {
  const selected = resolveSelectedPrimitives(report, selection)
  if (selected.length === 0) {
    const describeSelection =
      selection.mode === 'meshNames' ? `meshNames=${JSON.stringify(selection.meshNames)}` : `classification=${selection.classification}`
    throw new Error(
      `buildWardrobeGarmentFromInspection: selection matched no primitives in this report (${describeSelection}). ` +
        'This is a function-contract check, not a license/business-rule gate — see this module\'s docstring.',
    )
  }

  const conformedArtifact: WardrobeArtifactRef = {
    artifactId: provenance.conformedArtifactId,
    contentSha: resolveConformedContentSha(provenance),
  }

  return {
    id: provenance.id,
    ...(provenance.label !== undefined ? { label: provenance.label } : {}),
    coveragePart: provenance.coveragePart ?? inferCoveragePart(selection, selected),
    layerRule: provenance.layerRule,
    hiddenBodyMask: provenance.hiddenBodyMask ?? [],
    compatibleRigContractVersions: provenance.compatibleRigContractVersions,
    requiredHumanBones: computeRequiredHumanBones(report, selected),
    auxBones: computeAuxBones(selected),
    // KNOWN GAP — see this module's docstring: springs ARE named in the VRM1
    // spec, but glb-inspect doesn't expose their names/joint-node lists yet.
    springChains: [],
    // Anonymous in the spec on both generations — see this module's
    // docstring (same finding as wardrobe:Base's own colliderGroups).
    requiredColliderGroups: [],
    stats: computeStats(selected, report.materials),
    lifecycle: provenance.lifecycle ?? DEFAULT_LIFECYCLE_BY_SOURCE_FORMAT[provenance.sourceFormat],
    sourceFormat: provenance.sourceFormat,
    license: buildLicenseTestimonies(report),
    conformedArtifact,
    ...(provenance.sourceArchive !== undefined ? { sourceArchive: provenance.sourceArchive } : {}),
  }
}
