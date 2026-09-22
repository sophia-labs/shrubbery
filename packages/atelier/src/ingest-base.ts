/**
 * @shrubbery/atelier-vtuber — ingest-base: the honest data layer between a
 * VRM dissection (glb-inspect) and a wardrobe:Base Meaningful Object value
 * (@shrubbery/nucleus's wardrobe-rdf.ts).
 *
 * `buildWardrobeBaseFromInspection` is a PURE mapping: VrmInspectionReport +
 * caller-supplied provenance -> WardrobeBase. It does no I/O, no network, no
 * DOM — it consumes a report glb-inspect already produced and a small bag of
 * facts the inspection itself cannot know (the Base's own id, its rig
 * contract version number, where its artifact bytes live).
 *
 * ARCHITECTURAL BOUNDARY (load-bearing — read before touching this file):
 * this module carries data faithfully and validates NOTHING. The SHACL
 * ingestion gate ("no license, no entry") and Meaningful-Object
 * materialization both belong to EMPORIUM and are DEFERRED — building them
 * here would stand up a second, parallel trust boundary that fights the real
 * one. A file with no license testimony, no expressions, no aux bones, or
 * absent fields anywhere produces a Base with empty arrays/'' defaults, not a
 * thrown error and not a rejected result. If Emporium's gate later wants to
 * reject that Base, that's Emporium's call to make, on this Base's honestly-
 * carried (possibly empty) data.
 *
 * NAMES vs COUNTS (the decision this module had to make explicit):
 * wardrobe:Base wants NAMED collider groups (WardrobeColliderGroup.name) but
 * neither VRM 1.0's VRMC_springBone.colliderGroups nor VRM 0.x's
 * secondaryAnimation.colliderGroups carry a name field at all — both are
 * anonymous, index-keyed lists in the spec itself (verified against both
 * fixtures' raw extension JSON). Inventing names ("group-0", "group-1"...)
 * would fabricate structure the source file never asserted. So colliderGroups
 * is carried as [] here, DOCUMENTED, not silently dropped: naming a Base's
 * collider groups is a publishing decision a Base AUTHOR makes (Emporium/
 * curation surface), not something recoverable from raw VRM ingestion.
 * Aux bones are the opposite case — glb-inspect only exposed a COUNT
 * (auxBoneJointCount), but the underlying node names ARE present in the glTF
 * document, so glb-inspect was extended (this session) to also resolve and
 * expose auxBoneJointNames, keeping auxBoneJointCount === auxBoneJointNames
 * .length by construction (see auxBoneJointNodeIndices in glb-inspect.ts).
 * That extension's own exact-value tests stayed green unchanged (same 21
 * assertions, same numbers — nothing renumbered, only a name array added).
 *
 * FOUND VIA THE ROUND-TRIP TEST, not by inspection alone: a Base's rig
 * contract is internal VRM1 canon (wardrobe-rdf.ts's own docstring — VRM 0.x
 * is "ingest-boundary input, never internal shape"), so humanBones is
 * populated ONLY from a VRM1 source. VRM 0.x's own humanoid vocabulary looks
 * textually identical to VRM1's but is NOT the same vocabulary — the thumb
 * chain names the same joints differently across specs (see the comment on
 * `humanBones` below for the byte-exact evidence from avatar-sample-a.vrm).
 * Populating humanBones from a VRM0 report would inject wrong-generation
 * bone names into a closed-vocabulary field; parseWardrobeBases' own
 * closed-vocab filter silently dropped exactly the two offending names
 * (leftThumbIntermediate/rightThumbIntermediate) the first time this was
 * tried, which is what surfaced the bug instead of it corrupting data
 * quietly forever.
 *
 * KNOWN GAP, left honest rather than half-solved: glb-inspect's Vrm1Summary
 * does not parse the VRMC_vrm `firstPerson` extension (mesh-visibility
 * annotations) at all right now — not even a count. firstPersonAnnotations
 * is therefore always [] here. Extending glb-inspect for that is the same
 * shape of fix as the aux-bone-names one above (resolve node index -> name,
 * this time via node.mesh -> gltf.meshes[i].name) but is a separate,
 * out-of-scope follow-up, not silently faked here.
 *
 * LICENSE MAPPING carries the file's native meta BYTE-EXACT (including VRM
 * 0.x's canonical "Ussage" misspellings) as WardrobeLicenseTestimony's
 * spec-native fields, witness 'inFileMeta' — this is the file's own
 * testimony about itself, not a marketplace terms page. The normalized
 * allowedUse projection is computed by nucleus's own
 * computeAllowedUseFromVrm1Meta for VRM1; for VRM 0.x (which has no 3-tier
 * commercialUsage/creditNotation/modification vocabulary at all — only a
 * binary Allow/Disallow triad plus a CC-style licenseName), this module does
 * the VRM0->VRM1-shaped best-effort translation that wardrobe-rdf.ts's own
 * docstring calls out as an ingest-time concern (see
 * deriveAllowedUseFromVrm0Meta below for the exact, individually-justified
 * field-by-field mapping).
 */

import { createHash } from 'node:crypto'

import {
  computeAllowedUseFromVrm1Meta,
  type WardrobeAllowedUse,
  type WardrobeArtifactRef,
  type WardrobeAssetBudgets,
  type WardrobeBase,
  type WardrobeExpressionPresetName,
  type WardrobeFacing,
  type WardrobeHumanBoneName,
  type WardrobeLicenseTestimony,
  type WardrobeMaterialTaxonomyEntry,
  type WardrobeMaterialTaxonomySlot,
  type WardrobeVrm0AllowedUserName,
  type WardrobeVrm0LicenseName,
  type WardrobeVrm0MetaNative,
  type WardrobeVrm0UssageValue,
  type WardrobeVrm1AvatarPermission,
  type WardrobeVrm1CommercialUsage,
  type WardrobeVrm1CreditNotation,
  type WardrobeVrm1MetaNative,
  type WardrobeVrm1Modification,
} from '@shrubbery/nucleus'

import type { MaterialSummary, VrmInspectionReport, VrmMetaV0, VrmMetaV1 } from './glb-inspect.js'

// ── Provenance: what the inspection cannot know ──────────────────────────────

/**
 * Facts a VrmInspectionReport has no way to know, supplied by whoever is
 * running the ingestion (a cell tool, a CLI, a test). Exactly one of
 * `contentSha`/`buffer` is required — pass `contentSha` if the caller's own
 * pipeline already hashed the upload (the common case, e.g. an artifact
 * store that dedupes on content hash); pass `buffer` to have this module hash
 * it (sha256, hex, no `0x`/algorithm prefix) via a tiny synchronous helper.
 */
export interface WardrobeBaseIngestProvenance {
  /** The Base's own local id (becomes the RDF subject via nucleus's iriFor). */
  readonly id: string
  readonly label?: string
  /** Bumped by the CALLER when the published rig-contract surface changes —
   * inspection has no notion of "version across ingestions", only what one
   * file currently contains. */
  readonly rigContractVersion: number
  /** However the caller's artifact store names this file (e.g. a cell's
   * uploaded-artifact id). */
  readonly artifactId: string
  readonly contentSha?: string
  readonly buffer?: ArrayBuffer
  /** VRM inspection carries no bind-pose data (glb-inspect reads counts/
   * metadata, never accessor/vertex bytes) — so this module cannot compute a
   * real bind-pose hash from the report alone. Supply one (e.g. hashed from
   * the GLB's skin/accessor bytes by a fuller pipeline stage) or omit it;
   * omitted defaults to '', matching parseWardrobeBases' own default for an
   * absent bindPoseHash triple. */
  readonly bindPoseHash?: string
  /** Free-text breadcrumb for the caller's own audit trail (a file path, an
   * upload channel, a fixture name, ...). NOT reflected onto the built Base —
   * wardrobe:Base has no matching RDF predicate for it (see wardrobe-rdf.ts).
   * Accepted here purely so call sites have one provenance bag instead of a
   * second side channel; if Emporium's materialization wants this durable
   * later, that's its schema decision, not this module's. */
  readonly sourceProvenance?: string
}

/** sha256 of an ArrayBuffer's bytes, as a lowercase hex string. Synchronous
 * (node:crypto) — this module runs in the Atelier ingestion factory (Node),
 * same as glb-inspect's own primary caller; unlike glb-inspect itself it does
 * not need to be portable to a browser worker. */
function sha256Hex(buffer: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex')
}

function resolveContentSha(provenance: WardrobeBaseIngestProvenance): string {
  if (provenance.contentSha !== undefined) return provenance.contentSha
  if (provenance.buffer !== undefined) return sha256Hex(provenance.buffer)
  throw new Error(
    'buildWardrobeBaseFromInspection: provenance must supply either contentSha or buffer (to derive one from) for the artifact ref. ' +
      'This is a function-contract check, not a license/business-rule gate — see this module\'s docstring.',
  )
}

// ── License testimony: byte-exact native meta + computed allowedUse ─────────

/** VrmMetaV1 -> WardrobeVrm1MetaNative, byte-exact. The enum-typed fields
 * (avatarPermission/commercialUsage/creditNotation/modification) are cast,
 * not validated — glb-inspect reads them as plain strings (it's a byte-exact
 * oracle, not a spec validator) and this module does not reject a
 * non-conforming value, per the no-gate rule above. `thumbnailImage` is
 * dropped, matching WardrobeVrm1MetaNative's own docstring (not RDF-
 * representable; served by the artifact/thumbnail pipeline instead). */
function toVrm1MetaNative(meta: VrmMetaV1): WardrobeVrm1MetaNative {
  return {
    metaVersion: '1',
    name: meta.name ?? '',
    ...(meta.version !== undefined ? { version: meta.version } : {}),
    authors: meta.authors ?? [],
    ...(meta.copyrightInformation !== undefined ? { copyrightInformation: meta.copyrightInformation } : {}),
    ...(meta.contactInformation !== undefined ? { contactInformation: meta.contactInformation } : {}),
    ...(meta.references !== undefined ? { references: meta.references } : {}),
    ...(meta.thirdPartyLicenses !== undefined ? { thirdPartyLicenses: meta.thirdPartyLicenses } : {}),
    licenseUrl: meta.licenseUrl ?? '',
    ...(meta.avatarPermission !== undefined
      ? { avatarPermission: meta.avatarPermission as WardrobeVrm1AvatarPermission }
      : {}),
    ...(meta.allowExcessivelyViolentUsage !== undefined
      ? { allowExcessivelyViolentUsage: meta.allowExcessivelyViolentUsage }
      : {}),
    ...(meta.allowExcessivelySexualUsage !== undefined
      ? { allowExcessivelySexualUsage: meta.allowExcessivelySexualUsage }
      : {}),
    ...(meta.commercialUsage !== undefined ? { commercialUsage: meta.commercialUsage as WardrobeVrm1CommercialUsage } : {}),
    ...(meta.allowPoliticalOrReligiousUsage !== undefined
      ? { allowPoliticalOrReligiousUsage: meta.allowPoliticalOrReligiousUsage }
      : {}),
    ...(meta.allowAntisocialOrHateUsage !== undefined
      ? { allowAntisocialOrHateUsage: meta.allowAntisocialOrHateUsage }
      : {}),
    ...(meta.creditNotation !== undefined ? { creditNotation: meta.creditNotation as WardrobeVrm1CreditNotation } : {}),
    ...(meta.allowRedistribution !== undefined ? { allowRedistribution: meta.allowRedistribution } : {}),
    ...(meta.modification !== undefined ? { modification: meta.modification as WardrobeVrm1Modification } : {}),
    ...(meta.otherLicenseUrl !== undefined ? { otherLicenseUrl: meta.otherLicenseUrl } : {}),
  }
}

/** VrmMetaV0 -> WardrobeVrm0MetaNative, byte-exact — including the "Ussage"
 * misspellings, carried as-is (never corrected). `texture` is dropped,
 * matching WardrobeVrm0MetaNative's own docstring (a THREE.Texture, not RDF-
 * representable, same reasoning as v1's thumbnailImage). */
function toVrm0MetaNative(meta: VrmMetaV0): WardrobeVrm0MetaNative {
  return {
    metaVersion: '0',
    ...(meta.allowedUserName !== undefined ? { allowedUserName: meta.allowedUserName as WardrobeVrm0AllowedUserName } : {}),
    ...(meta.author !== undefined ? { author: meta.author } : {}),
    ...(meta.commercialUssageName !== undefined
      ? { commercialUssageName: meta.commercialUssageName as WardrobeVrm0UssageValue }
      : {}),
    ...(meta.contactInformation !== undefined ? { contactInformation: meta.contactInformation } : {}),
    ...(meta.licenseName !== undefined ? { licenseName: meta.licenseName as WardrobeVrm0LicenseName } : {}),
    ...(meta.otherLicenseUrl !== undefined ? { otherLicenseUrl: meta.otherLicenseUrl } : {}),
    ...(meta.otherPermissionUrl !== undefined ? { otherPermissionUrl: meta.otherPermissionUrl } : {}),
    ...(meta.reference !== undefined ? { reference: meta.reference } : {}),
    ...(meta.sexualUssageName !== undefined ? { sexualUssageName: meta.sexualUssageName as WardrobeVrm0UssageValue } : {}),
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    ...(meta.version !== undefined ? { version: meta.version } : {}),
    ...(meta.violentUssageName !== undefined ? { violentUssageName: meta.violentUssageName as WardrobeVrm0UssageValue } : {}),
  }
}

/**
 * Best-effort VRM0 -> VRM1-shaped allowedUse projection — the translation
 * wardrobe-rdf.ts's computeAllowedUseFromVrm1Meta docstring explicitly calls
 * "an ingest concern, out of scope for this vocabulary seed". VRM 0.x has no
 * equivalent to VRM1's 3-tier commercialUsage, creditNotation, or
 * modification enums, so those three are left unset here (the spec's own
 * restrictive defaults apply: personalNonProfit / required / prohibited) —
 * this is a real information gap in VRM 0.x itself, not something this
 * module is failing to read. Each field that IS mapped:
 *   - avatarPermission <- allowedUserName: a direct 3-way rename
 *     (Everyone/ExplicitlyLicensedPerson/OnlyAuthor -> everyone/
 *     onlySeparatelyLicensedPerson/onlyAuthor), same cardinality.
 *   - commercialUsage <- commercialUssageName: VRM0's binary Allow/Disallow
 *     collapses onto VRM1's 3-tier enum lossily; Allow maps to the most
 *     permissive tier (corporation) and Disallow to the most restrictive
 *     (personalNonProfit) since VRM0 draws no personal/corporate line at all.
 *   - allowRedistribution <- licenseName: true unless the license is
 *     literally 'Redistribution_Prohibited' (every other VRM0 licenseName,
 *     including the CC_BY family, permits redistribution under some
 *     condition VRM1's single boolean can't distinguish further).
 */
function deriveAllowedUseFromVrm0Meta(meta: WardrobeVrm0MetaNative): WardrobeAllowedUse {
  const avatarPermission: WardrobeVrm1AvatarPermission | undefined =
    meta.allowedUserName === 'Everyone'
      ? 'everyone'
      : meta.allowedUserName === 'ExplicitlyLicensedPerson'
        ? 'onlySeparatelyLicensedPerson'
        : meta.allowedUserName === 'OnlyAuthor'
          ? 'onlyAuthor'
          : undefined
  const commercialUsage: WardrobeVrm1CommercialUsage | undefined =
    meta.commercialUssageName === 'Allow' ? 'corporation' : meta.commercialUssageName === 'Disallow' ? 'personalNonProfit' : undefined
  const allowRedistribution: boolean | undefined =
    meta.licenseName !== undefined ? meta.licenseName !== 'Redistribution_Prohibited' : undefined

  return computeAllowedUseFromVrm1Meta({ avatarPermission, commercialUsage, allowRedistribution })
}

/** Exported for reuse by ingest-garment.ts: a Garment's license testimony is
 * built from the SAME embedded VRM meta as a Base's, byte-exact, witness
 * 'inFileMeta' — the file speaks for itself regardless of which mesh inside
 * it is being carved into a Base or a Garment. */
export function buildLicenseTestimonies(report: VrmInspectionReport): WardrobeLicenseTestimony[] {
  if (report.vrm1) {
    const vrm1Meta = toVrm1MetaNative(report.vrm1.meta)
    return [
      {
        witness: 'inFileMeta',
        vrm1Meta,
        allowedUse: computeAllowedUseFromVrm1Meta({
          avatarPermission: vrm1Meta.avatarPermission,
          commercialUsage: vrm1Meta.commercialUsage,
          modification: vrm1Meta.modification,
          creditNotation: vrm1Meta.creditNotation,
          allowRedistribution: vrm1Meta.allowRedistribution,
        }),
      },
    ]
  }
  if (report.vrm0) {
    const vrm0Meta = toVrm0MetaNative(report.vrm0.meta)
    return [
      {
        witness: 'inFileMeta',
        vrm0Meta,
        allowedUse: deriveAllowedUseFromVrm0Meta(vrm0Meta),
      },
    ]
  }
  // No VRM extension detected at all -> no testimony. NOT a rejection: a Base
  // with license: [] is a valid, honestly-carried value; Emporium's gate (not
  // this module) decides what to do with the absence.
  return []
}

// ── Material taxonomy: best-effort from the VRoid _SKIN/_FACE/_EYE/_HAIR convention ─

/** Matches VRoid's own material-naming convention (documented on
 * WARDROBE_MATERIAL_TAXONOMY_SLOTS in wardrobe-rdf.ts): a taxonomy slot token
 * as the trailing name segment, optionally followed by a numeric suffix
 * (VRoid emits multiple hair materials as `..._HAIR_01`, `..._HAIR_02`, ...).
 * Case-sensitive by design: VRoid's own emitted names are uppercase
 * (`_SKIN`/`_FACE`/`_EYE`/`_HAIR`); a lowercase "hair" material name (e.g.
 * seed-san's plain `hair`) is NOT this convention and correctly yields no
 * match — best-effort, not a forced classification. */
const MATERIAL_TAXONOMY_SUFFIX = /_?(SKIN|FACE|EYE|HAIR)(_\d+)?$/

function inferMaterialTaxonomy(materials: readonly MaterialSummary[]): WardrobeMaterialTaxonomyEntry[] {
  const out: WardrobeMaterialTaxonomyEntry[] = []
  for (const material of materials) {
    const match = material.name.match(MATERIAL_TAXONOMY_SUFFIX)
    if (!match) continue
    const slot = match[1].toLowerCase() as WardrobeMaterialTaxonomySlot
    out.push({ materialName: material.name, slot })
  }
  return out
}

// ── The mapping ───────────────────────────────────────────────────────────────

/**
 * Map a VrmInspectionReport (glb-inspect's dissection of a real VRM/GLB
 * buffer) into a wardrobe:Base value. Pure: same report + provenance always
 * produces the same Base; no network, no DOM, no validation, no gate — see
 * this module's docstring for the full account of what's deferred to
 * Emporium and why colliderGroups/firstPersonAnnotations are honestly empty.
 */
export function buildWardrobeBaseFromInspection(
  report: VrmInspectionReport,
  provenance: WardrobeBaseIngestProvenance,
): WardrobeBase {
  // Bone coverage: wardrobe-rdf.ts's own module docstring is explicit that a
  // Base's rig contract is internal VRM1 canon and "VRM 0.x is
  // ingest-boundary input, never internal shape". VRM 1.0's
  // humanoid.humanBones keys ARE that canon, so a VRM1 source maps directly.
  // VRM 0.x's own humanoid vocabulary is NOT the same vocabulary, even though
  // most of its names are textually identical to VRM1's — the thumb chain is
  // the sharp counterexample, verified against avatar-sample-a.vrm: VRM 0.x
  // (inherited from Unity's HumanBodyBones) names its three thumb joints
  // leftThumbProximal/leftThumbIntermediate/leftThumbDistal, while VRM1 canon
  // names the same three-joint chain leftThumbMetacarpal/leftThumbProximal/
  // leftThumbDistal — so "leftThumbProximal" denotes a DIFFERENT joint in
  // each spec, and "leftThumbIntermediate" isn't a VRM1-canon name at all
  // (confirmed: it's the only non-canonical string among avatar-sample-a's
  // 54 VRM0 bone names, and parseWardrobeBases' closed-vocab
  // filter — correctly — drops it, which is what first surfaced this rather
  // than a silent corruption). Pouring VRM0's bone-map keys into this
  // VRM1-vocabulary-typed field would inject wrong-generation values under
  // names that happen to parse. A real VRM0->VRM1 humanoid retargeting table
  // is exactly the kind of nontrivial, joint-for-joint mapping this pure
  // module should not improvise — so for a VRM0-only report humanBones stays
  // [], not fabricated, same "honest gap" treatment as colliderGroups/
  // firstPersonAnnotations below.
  const humanBones = (report.vrm1?.humanoid.boneNames ?? []) as WardrobeHumanBoneName[]

  const facing: WardrobeFacing = report.vrm1 ? '+Z' : report.vrm0 ? '-Z' : '+Z'

  const expressionPresets = (report.vrm1?.expressions.presetNames ?? []) as WardrobeExpressionPresetName[]
  const customExpressions = report.vrm1?.expressions.customNames ?? []

  const budgets: WardrobeAssetBudgets = {
    triangleCount: report.meshes.totalTriangleCount,
    materialCount: report.materials.length,
    textureCount: report.images.length,
  }

  const artifact: WardrobeArtifactRef = {
    artifactId: provenance.artifactId,
    contentSha: resolveContentSha(provenance),
  }

  return {
    id: provenance.id,
    ...(provenance.label !== undefined ? { label: provenance.label } : {}),
    rigContractVersion: provenance.rigContractVersion,
    humanBones,
    auxBones: report.auxBoneJointNames,
    bindPoseHash: provenance.bindPoseHash ?? '',
    facing,
    // Anonymous in the spec (no name field on either generation's collider
    // groups) — see this module's docstring. Left empty, not fabricated.
    colliderGroups: [],
    // glb-inspect doesn't parse VRMC_vrm firstPerson at all yet — see this
    // module's docstring's KNOWN GAP note.
    firstPersonAnnotations: [],
    materialTaxonomy: inferMaterialTaxonomy(report.materials),
    expressionPresets,
    customExpressions,
    budgets,
    artifact,
    license: buildLicenseTestimonies(report),
  }
}
