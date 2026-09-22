/**
 * wardrobe-rdf.ts - the Atelier's wardrobe vocabulary: avatar identity as
 * Meaningful Objects (design doc: ATELIER, sophia-code-lab graph, §2).
 *
 * Five classes, one catalog graph: wardrobe:Base (the canonical body + its
 * published rig contract), wardrobe:Garment (a coverage part bound to that
 * contract), wardrobe:TextureVariant (a texture-only variant of a Garment),
 * wardrobe:Outfit (an ordered composition of Garments/Variants over a Base),
 * wardrobe:Portrait (an agent's active-outfit binding, draft/promotion
 * lifecycle mirroring learner-1's prompt-as-Document semantics).
 *
 * Internal canon is VRM 1.0 semantics (see vrm-asset-ground-truth-20260706
 * §2/F6): Base's rig contract, firstPerson annotations, and expression
 * inventory are all authored in VRM1 vocabulary. VRM 0.x is ingest-boundary
 * input, never internal shape - its fields are preserved byte-exact as
 * license-testimony provenance (below) but never used to shape a Base.
 *
 * License modeling is two layers, deliberately not collapsed into one:
 *   (1) SPEC-NATIVE fields, preserved byte-exact under distinct predicates
 *       per spec version - including VRM 0.x's canonical "Ussage"
 *       misspellings (violentUssageName / sexualUssageName /
 *       commercialUssageName). Never normalized at the storage layer.
 *   (2) A NORMALIZED allowed-use projection (may modify / may distribute in
 *       app / may use in marketing / attribution required / may sublicense /
 *       exclusive), computed separately by computeAllowedUseFromVrm1Meta.
 *       Absent VRM1 flags read as the spec's own restrictive defaults.
 * A license testimony's `witness` says who is speaking: `inFileMeta` (the
 * embedded VRM meta, spec-native fields present) or `marketplaceTerms` (a
 * separate terms-of-sale source, no spec-native fields, allowedUse asserted
 * directly). Two witnesses on the same Garment can disagree - that is a
 * feature (observer-relative testimony, contested-by-default), not a bug to
 * reconcile here.
 *
 * VRM vocabularies below (bone names, expression presets, firstPerson
 * annotation types, VRM1Meta/VRM0Meta enum fields) are extracted byte-exact
 * from the vendored @pixiv/three-vrm-core 3.5.4 .d.ts sources - not
 * re-derived from the human-readable spec prose.
 *
 * Multi-valued fields are disciplined into exactly two kinds - RDF
 * multi-valued predicates are SETS, so anything that is actually a set says
 * so on both ends, and anything that is genuinely ordered carries its order
 * explicitly rather than relying on array position:
 *   - SET-valued (order carries no meaning - a build → serialize → parse
 *     round trip is deep-equal to the CANONICALIZED input, for ANY caller
 *     array order, never just a pre-sorted one): Base.humanBones, auxBones,
 *     expressionPresets, customExpressions, colliderGroups,
 *     firstPersonAnnotations, materialTaxonomy; Garment.hiddenBodyMask,
 *     compatibleRigContractVersions, requiredHumanBones, auxBones,
 *     springChains, requiredColliderGroups; TextureVariant.textureArtifacts,
 *     targetMaterialSlots. Both the builder/serializer (addStringSet /
 *     addIntSet / the natural-key-sorted compound adders below) and the
 *     parser (readStringSet / readEnumSet / readIntSet / the matching
 *     readers) canonicalize to the identical order - alphabetical for plain
 *     strings, numeric for ints, by name/meshName/materialName/artifactId
 *     for compound entries - so neither end depends on the other having
 *     already sorted.
 *   - ORDERED / index-carried (order IS semantic, preserved via an explicit
 *     `atIndex` triple on each entry node, exactly as the caller supplied
 *     it - never sorted): Outfit.layers (the dressing/composition stack -
 *     see addOutfitLayers/readOutfitLayers), every WardrobeLicenseTestimony[]
 *     (testimony order, e.g. which witness is listed first), vrm1Meta's
 *     `authors`/`references`, and Portrait.drafts (accumulation order).
 *
 * Pure: no DOM, no component imports, no stores, no network.
 */

import {
  I,
  L,
  Lbool,
  Lint,
  compareTriples,
  isIri,
  type Term,
  type Triple,
} from './rdf-model.js'
import { NS, iriFor } from './ux-rdf.js'

const RDF_TYPE = NS.rdf + 'type'
const RDFS_LABEL = NS.rdfs + 'label'
const sux = (local: string): string => NS.sux + local

const GRAPH_ROOT = (graphId: string): string => `urn:mnemosyne:local:graph:${graphId}`

/** `urn:mnemosyne:local:graph:{graph_id}:wardrobe` - the wardrobe catalog subgraph. */
export const wardrobeGraphIri = (graphId: string): string => `${GRAPH_ROOT(graphId)}:wardrobe`

// ── Closed vocabularies (ours) ───────────────────────────────────────────────

/** Coverage part - closed vocab, ≈ XWear's own part taxonomy. */
export const WARDROBE_COVERAGE_PARTS = [
  'fullSet',
  'tops',
  'bottoms',
  'shoes',
  'gloves',
  'headwear',
  'accessory',
] as const
export type WardrobeCoveragePart = (typeof WARDROBE_COVERAGE_PARTS)[number]

/** Stacking/conflict tier - lower dresses first; two garments in the same tier over the same coverage part conflict. */
export const WARDROBE_LAYER_RULES = ['base', 'outer', 'accessory'] as const
export type WardrobeLayerRule = (typeof WARDROBE_LAYER_RULES)[number]

/** Composition lifecycle - shared between wardrobe:Garment and wardrobe:Outfit (its composition mode). */
export const WARDROBE_LIFECYCLES = ['composedAtRuntime', 'bakedOffline'] as const
export type WardrobeLifecycle = (typeof WARDROBE_LIFECYCLES)[number]

/** Garment supply provenance - which pipeline produced the conformed artifact. */
export const WARDROBE_SOURCE_FORMATS = [
  'xwear',
  'fbx-unitypackage',
  'vroidcustomitem',
  'textureVariant',
  'authored',
  'meshy',
] as const
export type WardrobeSourceFormat = (typeof WARDROBE_SOURCE_FORMATS)[number]

/** Facing convention of the rig's bind pose (VRM 0.x is -Z; VRM 1.0 canon is +Z - F6). */
export const WARDROBE_FACINGS = ['+Z', '-Z'] as const
export type WardrobeFacing = (typeof WARDROBE_FACINGS)[number]

/** Material-taxonomy slot - VRoid's `_SKIN`/`_FACE`/`_EYE`/`_HAIR` material-naming convention, generalized. */
export const WARDROBE_MATERIAL_TAXONOMY_SLOTS = ['skin', 'face', 'eye', 'hair'] as const
export type WardrobeMaterialTaxonomySlot = (typeof WARDROBE_MATERIAL_TAXONOMY_SLOTS)[number]

/** glTF 2.0 `material.alphaMode` - the enum casing is the spec's own. */
export const WARDROBE_ALPHA_MODES = ['OPAQUE', 'MASK', 'BLEND'] as const
export type WardrobeAlphaMode = (typeof WARDROBE_ALPHA_MODES)[number]

/** Who is testifying to a license: the file's own embedded meta, or a separate marketplace terms-of-sale page. */
export const WARDROBE_LICENSE_WITNESSES = ['inFileMeta', 'marketplaceTerms'] as const
export type WardrobeLicenseWitness = (typeof WARDROBE_LICENSE_WITNESSES)[number]

/** What an Outfit layer entry points at. */
export const WARDROBE_OUTFIT_LAYER_KINDS = ['garment', 'variant'] as const
export type WardrobeOutfitLayerKind = (typeof WARDROBE_OUTFIT_LAYER_KINDS)[number]

// ── Spec-extracted vocabularies (byte-exact from @pixiv/three-vrm-core 3.5.4) ─

/**
 * The 55 humanoid bone names, byte-exact from
 * `@pixiv/three-vrm-core/types/humanoid/VRMHumanBoneName.d.ts`. This is the
 * closed vocabulary a Base's `humanBones` coverage list draws from.
 */
export const VRM_HUMAN_BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftEye',
  'rightEye',
  'jaw',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const
export type WardrobeHumanBoneName = (typeof VRM_HUMAN_BONE_NAMES)[number]

/**
 * The 15 required humanoid bones, byte-exact from
 * `VRMRequiredHumanBoneName.d.ts`. Exposed for future SHACL/validation
 * (rig-coverage completeness) - not enforced by this pure serialization
 * module.
 */
export const VRM_REQUIRED_HUMAN_BONE_NAMES = [
  'hips',
  'spine',
  'head',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
] as const
export type WardrobeRequiredHumanBoneName = (typeof VRM_REQUIRED_HUMAN_BONE_NAMES)[number]

/** The 18 expression presets, byte-exact from `VRMExpressionPresetName.d.ts`. */
export const VRM_EXPRESSION_PRESET_NAMES = [
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
  'blink',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'lookUp',
  'surprised',
  'lookDown',
  'lookLeft',
  'lookRight',
  'blinkLeft',
  'blinkRight',
  'neutral',
] as const
export type WardrobeExpressionPresetName = (typeof VRM_EXPRESSION_PRESET_NAMES)[number]

/** `firstPerson.meshAnnotations[].type`, byte-exact from `VRMFirstPersonMeshAnnotationType.d.ts`. */
export const VRM_FIRST_PERSON_FLAGS = ['auto', 'both', 'thirdPersonOnly', 'firstPersonOnly'] as const
export type WardrobeFirstPersonFlag = (typeof VRM_FIRST_PERSON_FLAGS)[number]

// VRM1Meta closed-vocab sub-fields, byte-exact from `meta/VRM1Meta.d.ts`.
export const VRM1_AVATAR_PERMISSIONS = ['onlyAuthor', 'onlySeparatelyLicensedPerson', 'everyone'] as const
export type WardrobeVrm1AvatarPermission = (typeof VRM1_AVATAR_PERMISSIONS)[number]
export const VRM1_COMMERCIAL_USAGES = ['personalNonProfit', 'personalProfit', 'corporation'] as const
export type WardrobeVrm1CommercialUsage = (typeof VRM1_COMMERCIAL_USAGES)[number]
export const VRM1_CREDIT_NOTATIONS = ['required', 'unnecessary'] as const
export type WardrobeVrm1CreditNotation = (typeof VRM1_CREDIT_NOTATIONS)[number]
export const VRM1_MODIFICATIONS = ['prohibited', 'allowModification', 'allowModificationRedistribution'] as const
export type WardrobeVrm1Modification = (typeof VRM1_MODIFICATIONS)[number]

// VRM0Meta closed-vocab sub-fields, byte-exact from `meta/VRM0Meta.d.ts` -
// including the canonical "Ussage" misspelling, which is the 0.x SCHEMA'S
// OWN spelling, not a typo of ours. Never "corrected" at the storage layer.
export const VRM0_ALLOWED_USER_NAMES = ['Everyone', 'ExplicitlyLicensedPerson', 'OnlyAuthor'] as const
export type WardrobeVrm0AllowedUserName = (typeof VRM0_ALLOWED_USER_NAMES)[number]
export const VRM0_USSAGE_VALUES = ['Allow', 'Disallow'] as const
export type WardrobeVrm0UssageValue = (typeof VRM0_USSAGE_VALUES)[number]
export const VRM0_LICENSE_NAMES = [
  'CC0',
  'CC_BY',
  'CC_BY_NC',
  'CC_BY_NC_ND',
  'CC_BY_NC_SA',
  'CC_BY_ND',
  'CC_BY_SA',
  'Other',
  'Redistribution_Prohibited',
] as const
export type WardrobeVrm0LicenseName = (typeof VRM0_LICENSE_NAMES)[number]

// ── License testimony: spec-native (byte-exact) + normalized projection ─────

/**
 * VRM 1.0 `meta`, byte-exact field-for-field from `meta/VRM1Meta.d.ts`.
 * `thumbnailImage` (an `HTMLImageElement`) is omitted - not RDF-representable
 * and served by the artifact/thumbnail pipeline, not license testimony.
 */
export interface WardrobeVrm1MetaNative {
  readonly metaVersion: '1'
  readonly name: string
  readonly version?: string
  readonly authors: readonly string[]
  readonly copyrightInformation?: string
  readonly contactInformation?: string
  readonly references?: readonly string[]
  readonly thirdPartyLicenses?: string
  readonly licenseUrl: string
  readonly avatarPermission?: WardrobeVrm1AvatarPermission
  readonly allowExcessivelyViolentUsage?: boolean
  readonly allowExcessivelySexualUsage?: boolean
  readonly commercialUsage?: WardrobeVrm1CommercialUsage
  readonly allowPoliticalOrReligiousUsage?: boolean
  readonly allowAntisocialOrHateUsage?: boolean
  readonly creditNotation?: WardrobeVrm1CreditNotation
  readonly allowRedistribution?: boolean
  readonly modification?: WardrobeVrm1Modification
  readonly otherLicenseUrl?: string
}

/**
 * VRM 0.x `meta`, byte-exact field-for-field from `meta/VRM0Meta.d.ts`,
 * including the canonical "Ussage" misspellings. `texture` (a
 * `THREE.Texture`) is omitted for the same reason `thumbnailImage` is above.
 */
export interface WardrobeVrm0MetaNative {
  readonly metaVersion: '0'
  readonly allowedUserName?: WardrobeVrm0AllowedUserName
  readonly author?: string
  readonly commercialUssageName?: WardrobeVrm0UssageValue
  readonly contactInformation?: string
  readonly licenseName?: WardrobeVrm0LicenseName
  readonly otherLicenseUrl?: string
  readonly otherPermissionUrl?: string
  readonly reference?: string
  readonly sexualUssageName?: WardrobeVrm0UssageValue
  readonly title?: string
  readonly version?: string
  readonly violentUssageName?: WardrobeVrm0UssageValue
}

/** The normalized allowed-use projection - our own vocabulary, computed, never spec-native. */
export interface WardrobeAllowedUse {
  readonly mayModify: boolean
  readonly mayDistributeInApp: boolean
  readonly mayUseInMarketing: boolean
  readonly attributionRequired: boolean
  readonly maySublicense: boolean
  readonly exclusive: boolean
}

/** What every field of `computeAllowedUseFromVrm1Meta` defaults to when its spec flag is absent. */
export const WARDROBE_RESTRICTIVE_DEFAULT_ALLOWED_USE: WardrobeAllowedUse = {
  mayModify: false,
  mayDistributeInApp: false,
  mayUseInMarketing: false,
  attributionRequired: true,
  maySublicense: false,
  exclusive: false,
}

/**
 * Compute the normalized allowed-use projection from VRM1-shaped license
 * flags. Absent flags read as the spec's own restrictive defaults:
 * `avatarPermission` onlyAuthor, `commercialUsage` personalNonProfit,
 * `modification` prohibited, `creditNotation` required, `allowRedistribution`
 * false (vrm-asset-ground-truth-20260706 F4).
 *
 * `maySublicense` and `exclusive` have no VRM spec analogue at all - they are
 * ALWAYS false when derived from spec-native meta; only a `marketplaceTerms`
 * witness (asserted directly, not computed) can ever set them true.
 *
 * VRM 0.x testimony has no equivalent field set (F4/F6): ingest-time code
 * that wants an allowed-use projection for a 0.x-native asset maps its fields
 * into this VRM1-shaped input first: that translation is an ingest concern,
 * out of scope for this vocabulary seed.
 */
export function computeAllowedUseFromVrm1Meta(
  flags: Partial<
    Pick<WardrobeVrm1MetaNative, 'avatarPermission' | 'commercialUsage' | 'modification' | 'creditNotation' | 'allowRedistribution'>
  >,
): WardrobeAllowedUse {
  const avatarPermission = flags.avatarPermission ?? 'onlyAuthor'
  const commercialUsage = flags.commercialUsage ?? 'personalNonProfit'
  const modification = flags.modification ?? 'prohibited'
  const creditNotation = flags.creditNotation ?? 'required'
  const allowRedistribution = flags.allowRedistribution ?? false
  return {
    mayModify: modification === 'allowModification' || modification === 'allowModificationRedistribution',
    mayDistributeInApp: allowRedistribution && avatarPermission !== 'onlyAuthor',
    mayUseInMarketing: commercialUsage === 'personalProfit' || commercialUsage === 'corporation',
    attributionRequired: creditNotation !== 'unnecessary',
    maySublicense: false,
    exclusive: false,
  }
}

/**
 * One witness's testimony about a Garment/Base/TextureVariant's license.
 * `vrm1Meta`/`vrm0Meta` are mutually-informative, not mutually exclusive in
 * principle, but a real asset has at most one (it was authored in one spec
 * version); `marketplaceTerms` witnesses carry neither - their `allowedUse`
 * is asserted directly by whoever recorded the terms, not computed here.
 */
export interface WardrobeLicenseTestimony {
  readonly witness: WardrobeLicenseWitness
  readonly vrm1Meta?: WardrobeVrm1MetaNative
  readonly vrm0Meta?: WardrobeVrm0MetaNative
  readonly allowedUse: WardrobeAllowedUse
}

// ── Shared compound value types ──────────────────────────────────────────────

export interface WardrobeArtifactRef {
  readonly artifactId: string
  readonly contentSha: string
}

/** A named, versioned collider group published by a Base - garment spring physics binds to these by name. */
export interface WardrobeColliderGroup {
  readonly name: string
  readonly version: number
}

/** A Garment's requirement on one of the Base's published collider groups. */
export interface WardrobeColliderGroupRequirement {
  readonly name: string
  readonly minVersion: number
}

export interface WardrobeFirstPersonMeshAnnotation {
  readonly meshName: string
  readonly flag: WardrobeFirstPersonFlag
}

export interface WardrobeMaterialTaxonomyEntry {
  readonly materialName: string
  readonly slot: WardrobeMaterialTaxonomySlot
}

export interface WardrobeAssetBudgets {
  readonly triangleCount: number
  readonly materialCount: number
  readonly textureCount: number
}

export interface WardrobeGarmentGeometryStats {
  readonly triangleCount: number
  readonly materialCount: number
  readonly textureCount: number
  readonly alphaMode: WardrobeAlphaMode
  readonly usesMtoon: boolean
}

/** One ordered entry in an Outfit's composition; `ref` is a Garment id (kind 'garment') or a TextureVariant id (kind 'variant'). */
export interface WardrobeOutfitLayer {
  readonly kind: WardrobeOutfitLayerKind
  readonly ref: string
}

export interface WardrobeAppearanceTints {
  readonly skinTint?: string
  readonly hairTint?: string
  readonly eyeTint?: string
  readonly accentTint?: string
  readonly outfitTint?: string
}

// ── wardrobe:Base ─────────────────────────────────────────────────────────────

/**
 * The canonical body. Exactly one to start (silhouette families are
 * productization, not v1). Publishes the rig contract everything else in the
 * catalog binds to: humanoid bone coverage, named+versioned collider groups,
 * first-person mesh visibility, material taxonomy, and expression inventory.
 */
export interface WardrobeBase {
  readonly id: string
  readonly label?: string
  /** Bumped whenever the published contract surface (bones/colliders) changes; Garments declare which versions they're compatible with. */
  readonly rigContractVersion: number
  /** Coverage of the 55-bone vocabulary this rig maps (real avatars map 51-54; ≥15 required - VRM_REQUIRED_HUMAN_BONE_NAMES). */
  readonly humanBones: readonly WardrobeHumanBoneName[]
  /** Ungoverned aux/twist/accessory joints (hair, bag chains, forearm twists...) - large in practice, not spec-governed. */
  readonly auxBones: readonly string[]
  readonly bindPoseHash: string
  readonly facing: WardrobeFacing
  readonly colliderGroups: readonly WardrobeColliderGroup[]
  readonly firstPersonAnnotations: readonly WardrobeFirstPersonMeshAnnotation[]
  readonly materialTaxonomy: readonly WardrobeMaterialTaxonomyEntry[]
  /** Which of the 18-preset closed vocabulary this Base implements. */
  readonly expressionPresets: readonly WardrobeExpressionPresetName[]
  readonly customExpressions: readonly string[]
  readonly budgets: WardrobeAssetBudgets
  readonly artifact: WardrobeArtifactRef
  readonly license: readonly WardrobeLicenseTestimony[]
}

// ── wardrobe:Garment ──────────────────────────────────────────────────────────

/** A coverage part bound to a Base's rig contract. */
export interface WardrobeGarment {
  readonly id: string
  readonly label?: string
  readonly coveragePart: WardrobeCoveragePart
  readonly layerRule: WardrobeLayerRule
  /** Base mesh/region names this garment hides when worn (the hide-body-under-garment hook). */
  readonly hiddenBodyMask: readonly string[]
  /** Which of the Base's rigContractVersion values this Garment is compatible with. */
  readonly compatibleRigContractVersions: readonly number[]
  readonly requiredHumanBones: readonly WardrobeHumanBoneName[]
  readonly auxBones: readonly string[]
  readonly springChains: readonly string[]
  readonly requiredColliderGroups: readonly WardrobeColliderGroupRequirement[]
  readonly stats: WardrobeGarmentGeometryStats
  readonly lifecycle: WardrobeLifecycle
  readonly sourceFormat: WardrobeSourceFormat
  readonly license: readonly WardrobeLicenseTestimony[]
  /** The conformed GLB fragment bound to the canonical rig (CharacterStudio-style trait) - the artifact actually used at runtime. */
  readonly conformedArtifact: WardrobeArtifactRef
  /** The original purchased/authored source archive, kept for provenance; not every sourceFormat retains one. */
  readonly sourceArchive?: WardrobeArtifactRef
}

// ── wardrobe:TextureVariant ───────────────────────────────────────────────────

/** A texture-only variant of a Garment - no geometry of its own, its own license testimony. */
export interface WardrobeTextureVariant {
  readonly id: string
  readonly label?: string
  readonly variantOf: string
  readonly textureArtifacts: readonly WardrobeArtifactRef[]
  readonly targetMaterialSlots: readonly string[]
  readonly license: readonly WardrobeLicenseTestimony[]
}

// ── wardrobe:Outfit ────────────────────────────────────────────────────────────

/** A composition: a Base plus an ordered stack of Garment/Variant layers. */
export interface WardrobeOutfit {
  readonly id: string
  readonly label?: string
  readonly base: string
  readonly layers: readonly WardrobeOutfitLayer[]
  readonly tints?: WardrobeAppearanceTints
  readonly compositionMode: WardrobeLifecycle
  /** Present for bakedOffline outfits (the composed VRM 1.0 artifact); may also cache a composedAtRuntime render. */
  readonly composedArtifact?: WardrobeArtifactRef
  /** Ref (artifact/document id) to the fit-oracle validation report for this composition. */
  readonly validationReport?: string
}

// ── wardrobe:Portrait ──────────────────────────────────────────────────────────

/**
 * An agent's avatar binding. Mirrors learner-1's prompt-as-Document
 * snapshot/binding/promotion semantics: draft Outfits accumulate, one Outfit
 * is the active binding, `activeFrom` timestamps when that took effect.
 */
export interface WardrobePortrait {
  readonly id: string
  /** The full external IRI of the agt:Agent this portrait belongs to - not translated through the sux: local-id scheme. */
  readonly agentIri: string
  readonly activeOutfit: string | null
  readonly activeFrom: string | null
  readonly drafts: readonly string[]
}

// ── wardrobe:Catalog (aggregate) ───────────────────────────────────────────────

export interface WardrobeCatalog {
  readonly bases: Readonly<Record<string, WardrobeBase>>
  readonly garments: Readonly<Record<string, WardrobeGarment>>
  readonly textureVariants: Readonly<Record<string, WardrobeTextureVariant>>
  readonly outfits: Readonly<Record<string, WardrobeOutfit>>
  readonly portraits: Readonly<Record<string, WardrobePortrait>>
}

// ── Serialize: wardrobe:Base ──────────────────────────────────────────────────

export function serializeWardrobeBasesToTriples(bases: readonly WardrobeBase[]): Triple[] {
  const out: Triple[] = []
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o })

  for (const base of bases) {
    const B = iriFor(base.id)
    add(B, RDF_TYPE, I(sux('WardrobeBase')))
    add(B, sux('localId'), L(base.id))
    if (base.label !== undefined) add(B, RDFS_LABEL, L(base.label))
    add(B, sux('rigContractVersion'), Lint(base.rigContractVersion))
    addStringSet(add, B, 'humanBone', base.humanBones)
    addStringSet(add, B, 'auxBone', base.auxBones)
    add(B, sux('bindPoseHash'), L(base.bindPoseHash))
    add(B, sux('facing'), L(base.facing))
    addColliderGroups(add, B, base.id, base.colliderGroups)
    addFirstPersonAnnotations(add, B, base.id, base.firstPersonAnnotations)
    addMaterialTaxonomy(add, B, base.id, base.materialTaxonomy)
    addStringSet(add, B, 'expressionPreset', base.expressionPresets)
    addStringSet(add, B, 'customExpression', base.customExpressions)
    add(B, sux('budgetTriangleCount'), Lint(base.budgets.triangleCount))
    add(B, sux('budgetMaterialCount'), Lint(base.budgets.materialCount))
    add(B, sux('budgetTextureCount'), Lint(base.budgets.textureCount))
    addArtifactRef(add, B, 'artifact', base.artifact)
    addLicenseTestimonies(add, B, base.id, base.license)
  }

  return out.sort(compareTriples)
}

export function parseWardrobeBases(triples: readonly Triple[]): Record<string, WardrobeBase> {
  const bySubject = indexBySubject(triples)
  const out: Record<string, WardrobeBase> = {}
  for (const iri of findTypedSubjects(bySubject, 'WardrobeBase')) {
    const preds = bySubject.get(iri)
    const id = lit(preds, 'localId') ?? localId(bySubject, iri)
    out[id] = {
      id,
      ...(lit(preds, 'label') !== undefined ? { label: lit(preds, 'label') } : {}),
      rigContractVersion: intOf(lit(preds, 'rigContractVersion')),
      humanBones: readEnumSet(preds, 'humanBone', VRM_HUMAN_BONE_NAMES),
      auxBones: readStringSet(preds, 'auxBone'),
      bindPoseHash: lit(preds, 'bindPoseHash') ?? '',
      facing: enumValue(preds, 'facing', WARDROBE_FACINGS) ?? '+Z',
      colliderGroups: readColliderGroups(bySubject, preds),
      firstPersonAnnotations: readFirstPersonAnnotations(bySubject, preds),
      materialTaxonomy: readMaterialTaxonomy(bySubject, preds),
      expressionPresets: readEnumSet(preds, 'expressionPreset', VRM_EXPRESSION_PRESET_NAMES),
      customExpressions: readStringSet(preds, 'customExpression'),
      budgets: {
        triangleCount: intOf(lit(preds, 'budgetTriangleCount')),
        materialCount: intOf(lit(preds, 'budgetMaterialCount')),
        textureCount: intOf(lit(preds, 'budgetTextureCount')),
      },
      artifact: readArtifactRef(preds, 'artifact') ?? { artifactId: '', contentSha: '' },
      license: readLicenseTestimonies(bySubject, preds),
    }
  }
  return out
}

// ── Serialize: wardrobe:Garment ───────────────────────────────────────────────

export function serializeWardrobeGarmentsToTriples(garments: readonly WardrobeGarment[]): Triple[] {
  const out: Triple[] = []
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o })

  for (const garment of garments) {
    const G = iriFor(garment.id)
    add(G, RDF_TYPE, I(sux('WardrobeGarment')))
    add(G, sux('localId'), L(garment.id))
    if (garment.label !== undefined) add(G, RDFS_LABEL, L(garment.label))
    add(G, sux('coveragePart'), L(garment.coveragePart))
    add(G, sux('layerRule'), L(garment.layerRule))
    addStringSet(add, G, 'hiddenBodyMask', garment.hiddenBodyMask)
    addIntSet(add, G, 'compatibleRigContractVersion', garment.compatibleRigContractVersions)
    addStringSet(add, G, 'requiredHumanBone', garment.requiredHumanBones)
    addStringSet(add, G, 'auxBone', garment.auxBones)
    addStringSet(add, G, 'springChain', garment.springChains)
    addColliderGroupRequirements(add, G, garment.id, garment.requiredColliderGroups)
    add(G, sux('statsTriangleCount'), Lint(garment.stats.triangleCount))
    add(G, sux('statsMaterialCount'), Lint(garment.stats.materialCount))
    add(G, sux('statsTextureCount'), Lint(garment.stats.textureCount))
    add(G, sux('statsAlphaMode'), L(garment.stats.alphaMode))
    add(G, sux('statsUsesMtoon'), Lbool(garment.stats.usesMtoon))
    add(G, sux('lifecycle'), L(garment.lifecycle))
    add(G, sux('sourceFormat'), L(garment.sourceFormat))
    addLicenseTestimonies(add, G, garment.id, garment.license)
    addArtifactRef(add, G, 'conformedArtifact', garment.conformedArtifact)
    if (garment.sourceArchive !== undefined) addArtifactRef(add, G, 'sourceArchive', garment.sourceArchive)
  }

  return out.sort(compareTriples)
}

export function parseWardrobeGarments(triples: readonly Triple[]): Record<string, WardrobeGarment> {
  const bySubject = indexBySubject(triples)
  const out: Record<string, WardrobeGarment> = {}
  for (const iri of findTypedSubjects(bySubject, 'WardrobeGarment')) {
    const preds = bySubject.get(iri)
    const id = lit(preds, 'localId') ?? localId(bySubject, iri)
    const sourceArchive = readArtifactRef(preds, 'sourceArchive')
    out[id] = {
      id,
      ...(lit(preds, 'label') !== undefined ? { label: lit(preds, 'label') } : {}),
      coveragePart: enumValue(preds, 'coveragePart', WARDROBE_COVERAGE_PARTS) ?? 'accessory',
      layerRule: enumValue(preds, 'layerRule', WARDROBE_LAYER_RULES) ?? 'outer',
      hiddenBodyMask: readStringSet(preds, 'hiddenBodyMask'),
      compatibleRigContractVersions: readIntSet(preds, 'compatibleRigContractVersion'),
      requiredHumanBones: readEnumSet(preds, 'requiredHumanBone', VRM_HUMAN_BONE_NAMES),
      auxBones: readStringSet(preds, 'auxBone'),
      springChains: readStringSet(preds, 'springChain'),
      requiredColliderGroups: readColliderGroupRequirements(bySubject, preds),
      stats: {
        triangleCount: intOf(lit(preds, 'statsTriangleCount')),
        materialCount: intOf(lit(preds, 'statsMaterialCount')),
        textureCount: intOf(lit(preds, 'statsTextureCount')),
        alphaMode: enumValue(preds, 'statsAlphaMode', WARDROBE_ALPHA_MODES) ?? 'OPAQUE',
        usesMtoon: boolOf(preds, 'statsUsesMtoon') ?? false,
      },
      lifecycle: enumValue(preds, 'lifecycle', WARDROBE_LIFECYCLES) ?? 'bakedOffline',
      sourceFormat: enumValue(preds, 'sourceFormat', WARDROBE_SOURCE_FORMATS) ?? 'authored',
      license: readLicenseTestimonies(bySubject, preds),
      conformedArtifact: readArtifactRef(preds, 'conformedArtifact') ?? { artifactId: '', contentSha: '' },
      ...(sourceArchive !== undefined ? { sourceArchive } : {}),
    }
  }
  return out
}

// ── Serialize: wardrobe:TextureVariant ────────────────────────────────────────

export function serializeWardrobeTextureVariantsToTriples(variants: readonly WardrobeTextureVariant[]): Triple[] {
  const out: Triple[] = []
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o })

  for (const variant of variants) {
    const V = iriFor(variant.id)
    add(V, RDF_TYPE, I(sux('WardrobeTextureVariant')))
    add(V, sux('localId'), L(variant.id))
    if (variant.label !== undefined) add(V, RDFS_LABEL, L(variant.label))
    add(V, sux('variantOfGarment'), I(iriFor(variant.variantOf)))
    addTextureArtifacts(add, V, variant.id, variant.textureArtifacts)
    addStringSet(add, V, 'targetMaterialSlot', variant.targetMaterialSlots)
    addLicenseTestimonies(add, V, variant.id, variant.license)
  }

  return out.sort(compareTriples)
}

export function parseWardrobeTextureVariants(triples: readonly Triple[]): Record<string, WardrobeTextureVariant> {
  const bySubject = indexBySubject(triples)
  const out: Record<string, WardrobeTextureVariant> = {}
  for (const iri of findTypedSubjects(bySubject, 'WardrobeTextureVariant')) {
    const preds = bySubject.get(iri)
    const id = lit(preds, 'localId') ?? localId(bySubject, iri)
    out[id] = {
      id,
      ...(lit(preds, 'label') !== undefined ? { label: lit(preds, 'label') } : {}),
      variantOf: iriRef(bySubject, preds, 'variantOfGarment') ?? '',
      textureArtifacts: readTextureArtifacts(bySubject, preds),
      targetMaterialSlots: readStringSet(preds, 'targetMaterialSlot'),
      license: readLicenseTestimonies(bySubject, preds),
    }
  }
  return out
}

// ── Serialize: wardrobe:Outfit ─────────────────────────────────────────────────

export function serializeWardrobeOutfitsToTriples(outfits: readonly WardrobeOutfit[]): Triple[] {
  const out: Triple[] = []
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o })

  for (const outfit of outfits) {
    const O = iriFor(outfit.id)
    add(O, RDF_TYPE, I(sux('WardrobeOutfit')))
    add(O, sux('localId'), L(outfit.id))
    if (outfit.label !== undefined) add(O, RDFS_LABEL, L(outfit.label))
    add(O, sux('usesBase'), I(iriFor(outfit.base)))
    addOutfitLayers(add, O, outfit.id, outfit.layers)
    if (outfit.tints?.skinTint !== undefined) add(O, sux('skinTint'), L(outfit.tints.skinTint))
    if (outfit.tints?.hairTint !== undefined) add(O, sux('hairTint'), L(outfit.tints.hairTint))
    if (outfit.tints?.eyeTint !== undefined) add(O, sux('eyeTint'), L(outfit.tints.eyeTint))
    if (outfit.tints?.accentTint !== undefined) add(O, sux('accentTint'), L(outfit.tints.accentTint))
    if (outfit.tints?.outfitTint !== undefined) add(O, sux('outfitTint'), L(outfit.tints.outfitTint))
    add(O, sux('compositionMode'), L(outfit.compositionMode))
    if (outfit.composedArtifact !== undefined) addArtifactRef(add, O, 'composedArtifact', outfit.composedArtifact)
    if (outfit.validationReport !== undefined) add(O, sux('validationReport'), L(outfit.validationReport))
  }

  return out.sort(compareTriples)
}

export function parseWardrobeOutfits(triples: readonly Triple[]): Record<string, WardrobeOutfit> {
  const bySubject = indexBySubject(triples)
  const out: Record<string, WardrobeOutfit> = {}
  for (const iri of findTypedSubjects(bySubject, 'WardrobeOutfit')) {
    const preds = bySubject.get(iri)
    const id = lit(preds, 'localId') ?? localId(bySubject, iri)
    const tints = tintsOf(preds)
    const composedArtifact = readArtifactRef(preds, 'composedArtifact')
    out[id] = {
      id,
      ...(lit(preds, 'label') !== undefined ? { label: lit(preds, 'label') } : {}),
      base: iriRef(bySubject, preds, 'usesBase') ?? '',
      layers: readOutfitLayers(bySubject, preds),
      ...(tints !== undefined ? { tints } : {}),
      compositionMode: enumValue(preds, 'compositionMode', WARDROBE_LIFECYCLES) ?? 'bakedOffline',
      ...(composedArtifact !== undefined ? { composedArtifact } : {}),
      ...(lit(preds, 'validationReport') !== undefined ? { validationReport: lit(preds, 'validationReport') } : {}),
    }
  }
  return out
}

function tintsOf(preds: Map<string, Term[]> | undefined): WardrobeAppearanceTints | undefined {
  const skinTint = lit(preds, 'skinTint')
  const hairTint = lit(preds, 'hairTint')
  const eyeTint = lit(preds, 'eyeTint')
  const accentTint = lit(preds, 'accentTint')
  const outfitTint = lit(preds, 'outfitTint')
  if (
    skinTint === undefined &&
    hairTint === undefined &&
    eyeTint === undefined &&
    accentTint === undefined &&
    outfitTint === undefined
  ) {
    return undefined
  }
  return {
    ...(skinTint !== undefined ? { skinTint } : {}),
    ...(hairTint !== undefined ? { hairTint } : {}),
    ...(eyeTint !== undefined ? { eyeTint } : {}),
    ...(accentTint !== undefined ? { accentTint } : {}),
    ...(outfitTint !== undefined ? { outfitTint } : {}),
  }
}

// ── Serialize: wardrobe:Portrait ───────────────────────────────────────────────

export function serializeWardrobePortraitsToTriples(portraits: readonly WardrobePortrait[]): Triple[] {
  const out: Triple[] = []
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o })

  for (const portrait of portraits) {
    const P = iriFor(portrait.id)
    add(P, RDF_TYPE, I(sux('WardrobePortrait')))
    add(P, sux('localId'), L(portrait.id))
    add(P, sux('forAgent'), I(portrait.agentIri))
    if (portrait.activeOutfit !== null) add(P, sux('activeOutfit'), I(iriFor(portrait.activeOutfit)))
    if (portrait.activeFrom !== null) add(P, sux('activeFrom'), L(portrait.activeFrom))
    addOrderedRefs(add, P, portrait.id, 'draft', 'hasDraftEntry', 'WardrobePortraitDraftEntry', 'draftOutfit', portrait.drafts)
  }

  return out.sort(compareTriples)
}

export function parseWardrobePortraits(triples: readonly Triple[]): Record<string, WardrobePortrait> {
  const bySubject = indexBySubject(triples)
  const out: Record<string, WardrobePortrait> = {}
  for (const iri of findTypedSubjects(bySubject, 'WardrobePortrait')) {
    const preds = bySubject.get(iri)
    const id = lit(preds, 'localId') ?? localId(bySubject, iri)
    const forAgentT = preds?.get('forAgent')?.[0]
    out[id] = {
      id,
      agentIri: forAgentT?.type === 'iri' ? forAgentT.value : '',
      activeOutfit: iriRef(bySubject, preds, 'activeOutfit') ?? null,
      activeFrom: lit(preds, 'activeFrom') ?? null,
      drafts: readOrderedRefs(bySubject, preds, 'hasDraftEntry', 'draftOutfit'),
    }
  }
  return out
}

// ── Serialize: the aggregate catalog ──────────────────────────────────────────

/** Serialize an entire wardrobe catalog (all five kinds) into one canonical, sorted triple list. */
export function serializeWardrobeCatalogToTriples(catalog: WardrobeCatalog): Triple[] {
  return [
    ...serializeWardrobeBasesToTriples(Object.values(catalog.bases)),
    ...serializeWardrobeGarmentsToTriples(Object.values(catalog.garments)),
    ...serializeWardrobeTextureVariantsToTriples(Object.values(catalog.textureVariants)),
    ...serializeWardrobeOutfitsToTriples(Object.values(catalog.outfits)),
    ...serializeWardrobePortraitsToTriples(Object.values(catalog.portraits)),
  ].sort(compareTriples)
}

/** Parse a triple list (e.g. the `:wardrobe` named graph read back whole) into a WardrobeCatalog. Inverse of serializeWardrobeCatalogToTriples. */
export function parseWardrobeCatalogTriples(triples: readonly Triple[]): WardrobeCatalog {
  return {
    bases: parseWardrobeBases(triples),
    garments: parseWardrobeGarments(triples),
    textureVariants: parseWardrobeTextureVariants(triples),
    outfits: parseWardrobeOutfits(triples),
    portraits: parseWardrobePortraits(triples),
  }
}

// ── private: generic term/graph plumbing ──────────────────────────────────────

function predicateKey(predicate: string): string {
  if (predicate === RDF_TYPE) return 'type'
  if (predicate === RDFS_LABEL) return 'label'
  return predicate.startsWith(NS.sux) ? predicate.slice(NS.sux.length) : predicate
}

function indexBySubject(triples: readonly Triple[]): Map<string, Map<string, Term[]>> {
  const bySubject = new Map<string, Map<string, Term[]>>()
  for (const t of triples) {
    let preds = bySubject.get(t.s)
    if (!preds) bySubject.set(t.s, (preds = new Map()))
    const key = predicateKey(t.p)
    const arr = preds.get(key)
    if (arr) arr.push(t.o)
    else preds.set(key, [t.o])
  }
  return bySubject
}

/** All subject IRIs typed `sux:<typeLocal>`, id-sorted for determinism. */
function findTypedSubjects(bySubject: Map<string, Map<string, Term[]>>, typeLocal: string): string[] {
  const out: string[] = []
  for (const [s, preds] of bySubject) {
    const types = preds.get('type') ?? []
    if (types.some((t) => t.type === 'iri' && localId(bySubject, t.value) === typeLocal)) out.push(s)
  }
  return out.sort()
}

function localId(bySubject: Map<string, Map<string, Term[]>>, iri: string): string {
  const one = bySubject.get(iri)?.get('localId')?.[0]
  if (one?.type === 'literal') return one.value
  return iri.startsWith(NS.sux) ? iri.slice(NS.sux.length) : iri
}

function lit(preds: Map<string, Term[]> | undefined, key: string): string | undefined {
  const t = preds?.get(key)?.[0]
  return t?.type === 'literal' ? t.value : undefined
}

function iriRef(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
  key: string,
): string | undefined {
  const t = preds?.get(key)?.[0]
  return t?.type === 'iri' ? localId(bySubject, t.value) : undefined
}

function boolOf(preds: Map<string, Term[]> | undefined, key: string): boolean | undefined {
  const value = lit(preds, key)
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function intOf(s: string | undefined): number {
  return s === undefined ? 0 : Math.trunc(Number(s))
}

function enumValue<const T extends readonly string[]>(
  preds: Map<string, Term[]> | undefined,
  key: string,
  allowed: T,
): T[number] | undefined {
  const value = lit(preds, key)
  return value !== undefined && (allowed as readonly string[]).includes(value) ? value : undefined
}

// ── private: unordered literal sets (deterministic via alphabetical/numeric sort) ─

function addStringSet(
  add: (s: string, p: string, o: Term) => void,
  subject: string,
  local: string,
  values: readonly string[],
): void {
  // Set-valued: canonicalized here to the exact order readStringSet/readEnumSet
  // reconstruct on parse, so serialize(x) is order-insensitive in its caller's
  // input - a build → serialize → parse round trip is deep-equal to the
  // CANONICALIZED input for any array order, not only pre-sorted callers.
  for (const v of [...values].sort()) add(subject, sux(local), L(v))
}

function readStringSet(preds: Map<string, Term[]> | undefined, local: string): string[] {
  return (preds?.get(local) ?? [])
    .filter((t): t is Extract<Term, { type: 'literal' }> => t.type === 'literal')
    .map((t) => t.value)
    .sort()
}

function readEnumSet<const T extends readonly string[]>(
  preds: Map<string, Term[]> | undefined,
  local: string,
  allowed: T,
): Array<T[number]> {
  return (preds?.get(local) ?? [])
    .filter((t): t is Extract<Term, { type: 'literal' }> => t.type === 'literal')
    .map((t) => t.value)
    .filter((v): v is T[number] => (allowed as readonly string[]).includes(v))
    .sort()
}

function addIntSet(
  add: (s: string, p: string, o: Term) => void,
  subject: string,
  local: string,
  values: readonly number[],
): void {
  // Set-valued: canonicalized here to match readIntSet's numeric sort - see
  // addStringSet.
  for (const v of [...values].sort((a, b) => a - b)) add(subject, sux(local), Lint(v))
}

function readIntSet(preds: Map<string, Term[]> | undefined, local: string): number[] {
  return (preds?.get(local) ?? [])
    .filter((t): t is Extract<Term, { type: 'literal' }> => t.type === 'literal')
    .map((t) => Math.trunc(Number(t.value)))
    .sort((a, b) => a - b)
}

// ── private: flat compound refs (single artifact ref, prefix-flattened onto the owning node) ─

function addArtifactRef(
  add: (s: string, p: string, o: Term) => void,
  subject: string,
  prefix: string,
  ref: WardrobeArtifactRef,
): void {
  add(subject, sux(`${prefix}Id`), L(ref.artifactId))
  add(subject, sux(`${prefix}ContentSha`), L(ref.contentSha))
}

function readArtifactRef(preds: Map<string, Term[]> | undefined, prefix: string): WardrobeArtifactRef | undefined {
  const artifactId = lit(preds, `${prefix}Id`)
  const contentSha = lit(preds, `${prefix}ContentSha`)
  return artifactId !== undefined && contentSha !== undefined ? { artifactId, contentSha } : undefined
}

// ── private: unordered 2-field entry lists (own node, sorted by their natural key) ─

function addColliderGroups(
  add: (s: string, p: string, o: Term) => void,
  baseIri: string,
  baseLocalId: string,
  groups: readonly WardrobeColliderGroup[],
): void {
  // Entry ids are content-derived (the group's own name), not index-derived:
  // this is an unordered set, so its serialization must not depend on input
  // array order (deterministic-ordering discipline - see the module tests).
  // Sorted here too, matching readColliderGroups's natural-key sort - see
  // addStringSet.
  const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name))
  sorted.forEach((g) => {
    const E = iriFor(`${baseLocalId}-colliderGroup-${g.name}`)
    add(baseIri, sux('hasColliderGroup'), I(E))
    add(E, RDF_TYPE, I(sux('WardrobeColliderGroup')))
    add(E, sux('name'), L(g.name))
    add(E, sux('version'), Lint(g.version))
  })
}

function readColliderGroups(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
): WardrobeColliderGroup[] {
  const out: WardrobeColliderGroup[] = []
  for (const t of preds?.get('hasColliderGroup') ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const name = lit(ep, 'name')
    const version = lit(ep, 'version')
    if (name !== undefined && version !== undefined) out.push({ name, version: intOf(version) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function addColliderGroupRequirements(
  add: (s: string, p: string, o: Term) => void,
  garmentIri: string,
  garmentLocalId: string,
  reqs: readonly WardrobeColliderGroupRequirement[],
): void {
  // Content-derived entry ids - see addColliderGroups. Sorted to match
  // readColliderGroupRequirements's natural-key sort.
  const sorted = [...reqs].sort((a, b) => a.name.localeCompare(b.name))
  sorted.forEach((r) => {
    const E = iriFor(`${garmentLocalId}-colliderGroupReq-${r.name}`)
    add(garmentIri, sux('hasColliderGroupRequirement'), I(E))
    add(E, RDF_TYPE, I(sux('WardrobeColliderGroupRequirement')))
    add(E, sux('name'), L(r.name))
    add(E, sux('minVersion'), Lint(r.minVersion))
  })
}

function readColliderGroupRequirements(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
): WardrobeColliderGroupRequirement[] {
  const out: WardrobeColliderGroupRequirement[] = []
  for (const t of preds?.get('hasColliderGroupRequirement') ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const name = lit(ep, 'name')
    const minVersion = lit(ep, 'minVersion')
    if (name !== undefined && minVersion !== undefined) out.push({ name, minVersion: intOf(minVersion) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function addFirstPersonAnnotations(
  add: (s: string, p: string, o: Term) => void,
  baseIri: string,
  baseLocalId: string,
  annotations: readonly WardrobeFirstPersonMeshAnnotation[],
): void {
  // Content-derived entry ids - see addColliderGroups. Sorted to match
  // readFirstPersonAnnotations's natural-key sort.
  const sorted = [...annotations].sort((a, b) => a.meshName.localeCompare(b.meshName))
  sorted.forEach((a) => {
    const E = iriFor(`${baseLocalId}-firstPerson-${a.meshName}`)
    add(baseIri, sux('hasFirstPersonAnnotation'), I(E))
    add(E, RDF_TYPE, I(sux('WardrobeFirstPersonMeshAnnotation')))
    add(E, sux('meshName'), L(a.meshName))
    add(E, sux('flag'), L(a.flag))
  })
}

function readFirstPersonAnnotations(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
): WardrobeFirstPersonMeshAnnotation[] {
  const out: WardrobeFirstPersonMeshAnnotation[] = []
  for (const t of preds?.get('hasFirstPersonAnnotation') ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const meshName = lit(ep, 'meshName')
    const flag = enumValue(ep, 'flag', VRM_FIRST_PERSON_FLAGS)
    if (meshName !== undefined && flag !== undefined) out.push({ meshName, flag })
  }
  return out.sort((a, b) => a.meshName.localeCompare(b.meshName))
}

function addMaterialTaxonomy(
  add: (s: string, p: string, o: Term) => void,
  baseIri: string,
  baseLocalId: string,
  entries: readonly WardrobeMaterialTaxonomyEntry[],
): void {
  // Content-derived entry ids - see addColliderGroups. Sorted to match
  // readMaterialTaxonomy's natural-key sort.
  const sorted = [...entries].sort((a, b) => a.materialName.localeCompare(b.materialName))
  sorted.forEach((e) => {
    const E = iriFor(`${baseLocalId}-materialTax-${e.materialName}`)
    add(baseIri, sux('hasMaterialTaxonomyEntry'), I(E))
    add(E, RDF_TYPE, I(sux('WardrobeMaterialTaxonomyEntry')))
    add(E, sux('materialName'), L(e.materialName))
    add(E, sux('slot'), L(e.slot))
  })
}

function readMaterialTaxonomy(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
): WardrobeMaterialTaxonomyEntry[] {
  const out: WardrobeMaterialTaxonomyEntry[] = []
  for (const t of preds?.get('hasMaterialTaxonomyEntry') ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const materialName = lit(ep, 'materialName')
    const slot = enumValue(ep, 'slot', WARDROBE_MATERIAL_TAXONOMY_SLOTS)
    if (materialName !== undefined && slot !== undefined) out.push({ materialName, slot })
  }
  return out.sort((a, b) => a.materialName.localeCompare(b.materialName))
}

// ── private: ordered entry lists (order is semantic - preserved via atIndex) ──

function addOrderedStrings(
  add: (s: string, p: string, o: Term) => void,
  parentIri: string,
  entryBaseLocalId: string,
  hasLocal: string,
  entryTypeLocal: string,
  valueLocal: string,
  values: readonly string[],
): void {
  values.forEach((v, idx) => {
    const E = iriFor(`${entryBaseLocalId}-${hasLocal}-${idx}`)
    add(parentIri, sux(hasLocal), I(E))
    add(E, RDF_TYPE, I(sux(entryTypeLocal)))
    add(E, sux('atIndex'), Lint(idx))
    add(E, sux(valueLocal), L(v))
  })
}

function readOrderedStrings(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
  hasLocal: string,
  valueLocal: string,
): string[] {
  const arr: string[] = []
  for (const t of preds?.get(hasLocal) ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const idx = intOf(lit(ep, 'atIndex'))
    const val = lit(ep, valueLocal)
    if (val !== undefined) arr[idx] = val
  }
  return arr.filter((x) => x !== undefined)
}

function addOrderedRefs(
  add: (s: string, p: string, o: Term) => void,
  parentIri: string,
  parentLocalId: string,
  entryTag: string,
  hasLocal: string,
  entryTypeLocal: string,
  refPredicateLocal: string,
  refIds: readonly string[],
): void {
  refIds.forEach((id, idx) => {
    const E = iriFor(`${parentLocalId}-${entryTag}-${idx}`)
    add(parentIri, sux(hasLocal), I(E))
    add(E, RDF_TYPE, I(sux(entryTypeLocal)))
    add(E, sux('atIndex'), Lint(idx))
    add(E, sux(refPredicateLocal), I(iriFor(id)))
  })
}

function readOrderedRefs(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
  hasLocal: string,
  refPredicateLocal: string,
): string[] {
  const arr: string[] = []
  for (const t of preds?.get(hasLocal) ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const idx = intOf(lit(ep, 'atIndex'))
    const refT = ep?.get(refPredicateLocal)?.[0]
    if (refT?.type === 'iri') arr[idx] = localId(bySubject, refT.value)
  }
  return arr.filter((x) => x !== undefined)
}

function addTextureArtifacts(
  add: (s: string, p: string, o: Term) => void,
  variantIri: string,
  variantLocalId: string,
  artifacts: readonly WardrobeArtifactRef[],
): void {
  // Content-derived entry ids - see addColliderGroups (unordered by
  // artifactId). Sorted to match readTextureArtifacts's natural-key sort.
  const sorted = [...artifacts].sort((a, b) => a.artifactId.localeCompare(b.artifactId))
  sorted.forEach((a) => {
    const E = iriFor(`${variantLocalId}-textureArtifact-${a.artifactId}`)
    add(variantIri, sux('hasTextureArtifactEntry'), I(E))
    add(E, RDF_TYPE, I(sux('WardrobeTextureArtifactEntry')))
    add(E, sux('artifactId'), L(a.artifactId))
    add(E, sux('contentSha'), L(a.contentSha))
  })
}

function readTextureArtifacts(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
): WardrobeArtifactRef[] {
  const out: WardrobeArtifactRef[] = []
  for (const t of preds?.get('hasTextureArtifactEntry') ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const artifactId = lit(ep, 'artifactId')
    const contentSha = lit(ep, 'contentSha')
    if (artifactId !== undefined && contentSha !== undefined) out.push({ artifactId, contentSha })
  }
  return out.sort((a, b) => a.artifactId.localeCompare(b.artifactId))
}

function addOutfitLayers(
  add: (s: string, p: string, o: Term) => void,
  outfitIri: string,
  outfitLocalId: string,
  layers: readonly WardrobeOutfitLayer[],
): void {
  layers.forEach((layer, idx) => {
    const E = iriFor(`${outfitLocalId}-layer-${idx}`)
    add(outfitIri, sux('hasLayerEntry'), I(E))
    add(E, RDF_TYPE, I(sux('WardrobeOutfitLayerEntry')))
    add(E, sux('atIndex'), Lint(idx))
    add(E, sux('layerKind'), L(layer.kind))
    add(E, sux('layerRef'), I(iriFor(layer.ref)))
  })
}

function readOutfitLayers(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
): WardrobeOutfitLayer[] {
  const arr: Array<WardrobeOutfitLayer | undefined> = []
  for (const t of preds?.get('hasLayerEntry') ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const idx = intOf(lit(ep, 'atIndex'))
    const kind = enumValue(ep, 'layerKind', WARDROBE_OUTFIT_LAYER_KINDS)
    const refT = ep?.get('layerRef')?.[0]
    const ref = refT?.type === 'iri' ? localId(bySubject, refT.value) : undefined
    if (kind !== undefined && ref !== undefined) arr[idx] = { kind, ref }
  }
  return arr.filter((x): x is WardrobeOutfitLayer => x !== undefined)
}

// ── private: license testimonies (ordered entries carrying the two-layer license model) ─

function addLicenseTestimonies(
  add: (s: string, p: string, o: Term) => void,
  ownerIri: string,
  ownerLocalId: string,
  testimonies: readonly WardrobeLicenseTestimony[],
): void {
  testimonies.forEach((t, idx) => {
    const entryLocalId = `${ownerLocalId}-license-${idx}`
    const E = iriFor(entryLocalId)
    add(ownerIri, sux('hasLicenseTestimony'), I(E))
    add(E, RDF_TYPE, I(sux('WardrobeLicenseTestimony')))
    add(E, sux('atIndex'), Lint(idx))
    add(E, sux('witness'), L(t.witness))
    add(E, sux('mayModify'), Lbool(t.allowedUse.mayModify))
    add(E, sux('mayDistributeInApp'), Lbool(t.allowedUse.mayDistributeInApp))
    add(E, sux('mayUseInMarketing'), Lbool(t.allowedUse.mayUseInMarketing))
    add(E, sux('attributionRequired'), Lbool(t.allowedUse.attributionRequired))
    add(E, sux('maySublicense'), Lbool(t.allowedUse.maySublicense))
    add(E, sux('exclusive'), Lbool(t.allowedUse.exclusive))

    if (t.vrm1Meta) {
      const m = t.vrm1Meta
      add(E, sux('v1MetaMetaVersion'), L(m.metaVersion))
      add(E, sux('v1MetaName'), L(m.name))
      if (m.version !== undefined) add(E, sux('v1MetaVersion'), L(m.version))
      addOrderedStrings(add, E, entryLocalId, 'hasAuthorEntry', 'WardrobeVrm1AuthorEntry', 'value', m.authors)
      if (m.copyrightInformation !== undefined) add(E, sux('v1MetaCopyrightInformation'), L(m.copyrightInformation))
      if (m.contactInformation !== undefined) add(E, sux('v1MetaContactInformation'), L(m.contactInformation))
      if (m.references !== undefined) {
        addOrderedStrings(add, E, entryLocalId, 'hasReferenceEntry', 'WardrobeVrm1ReferenceEntry', 'value', m.references)
      }
      if (m.thirdPartyLicenses !== undefined) add(E, sux('v1MetaThirdPartyLicenses'), L(m.thirdPartyLicenses))
      add(E, sux('v1MetaLicenseUrl'), L(m.licenseUrl))
      if (m.avatarPermission !== undefined) add(E, sux('v1MetaAvatarPermission'), L(m.avatarPermission))
      if (m.allowExcessivelyViolentUsage !== undefined) {
        add(E, sux('v1MetaAllowExcessivelyViolentUsage'), Lbool(m.allowExcessivelyViolentUsage))
      }
      if (m.allowExcessivelySexualUsage !== undefined) {
        add(E, sux('v1MetaAllowExcessivelySexualUsage'), Lbool(m.allowExcessivelySexualUsage))
      }
      if (m.commercialUsage !== undefined) add(E, sux('v1MetaCommercialUsage'), L(m.commercialUsage))
      if (m.allowPoliticalOrReligiousUsage !== undefined) {
        add(E, sux('v1MetaAllowPoliticalOrReligiousUsage'), Lbool(m.allowPoliticalOrReligiousUsage))
      }
      if (m.allowAntisocialOrHateUsage !== undefined) {
        add(E, sux('v1MetaAllowAntisocialOrHateUsage'), Lbool(m.allowAntisocialOrHateUsage))
      }
      if (m.creditNotation !== undefined) add(E, sux('v1MetaCreditNotation'), L(m.creditNotation))
      if (m.allowRedistribution !== undefined) add(E, sux('v1MetaAllowRedistribution'), Lbool(m.allowRedistribution))
      if (m.modification !== undefined) add(E, sux('v1MetaModification'), L(m.modification))
      if (m.otherLicenseUrl !== undefined) add(E, sux('v1MetaOtherLicenseUrl'), L(m.otherLicenseUrl))
    }

    if (t.vrm0Meta) {
      const m = t.vrm0Meta
      add(E, sux('v0MetaMetaVersion'), L(m.metaVersion))
      if (m.allowedUserName !== undefined) add(E, sux('v0MetaAllowedUserName'), L(m.allowedUserName))
      if (m.author !== undefined) add(E, sux('v0MetaAuthor'), L(m.author))
      if (m.commercialUssageName !== undefined) add(E, sux('v0MetaCommercialUssageName'), L(m.commercialUssageName))
      if (m.contactInformation !== undefined) add(E, sux('v0MetaContactInformation'), L(m.contactInformation))
      if (m.licenseName !== undefined) add(E, sux('v0MetaLicenseName'), L(m.licenseName))
      if (m.otherLicenseUrl !== undefined) add(E, sux('v0MetaOtherLicenseUrl'), L(m.otherLicenseUrl))
      if (m.otherPermissionUrl !== undefined) add(E, sux('v0MetaOtherPermissionUrl'), L(m.otherPermissionUrl))
      if (m.reference !== undefined) add(E, sux('v0MetaReference'), L(m.reference))
      if (m.sexualUssageName !== undefined) add(E, sux('v0MetaSexualUssageName'), L(m.sexualUssageName))
      if (m.title !== undefined) add(E, sux('v0MetaTitle'), L(m.title))
      if (m.version !== undefined) add(E, sux('v0MetaVersion'), L(m.version))
      if (m.violentUssageName !== undefined) add(E, sux('v0MetaViolentUssageName'), L(m.violentUssageName))
    }
  })
}

function readLicenseTestimonies(
  bySubject: Map<string, Map<string, Term[]>>,
  preds: Map<string, Term[]> | undefined,
): WardrobeLicenseTestimony[] {
  const entries: Array<{ idx: number; testimony: WardrobeLicenseTestimony }> = []
  for (const t of preds?.get('hasLicenseTestimony') ?? []) {
    if (!isIri(t)) continue
    const ep = bySubject.get(t.value)
    const idx = intOf(lit(ep, 'atIndex'))
    const witness = enumValue(ep, 'witness', WARDROBE_LICENSE_WITNESSES) ?? 'inFileMeta'
    const allowedUse: WardrobeAllowedUse = {
      mayModify: boolOf(ep, 'mayModify') ?? false,
      mayDistributeInApp: boolOf(ep, 'mayDistributeInApp') ?? false,
      mayUseInMarketing: boolOf(ep, 'mayUseInMarketing') ?? false,
      attributionRequired: boolOf(ep, 'attributionRequired') ?? true,
      maySublicense: boolOf(ep, 'maySublicense') ?? false,
      exclusive: boolOf(ep, 'exclusive') ?? false,
    }
    const vrm1Meta = readVrm1Meta(bySubject, ep)
    const vrm0Meta = readVrm0Meta(ep)
    entries.push({
      idx,
      testimony: {
        witness,
        ...(vrm1Meta !== undefined ? { vrm1Meta } : {}),
        ...(vrm0Meta !== undefined ? { vrm0Meta } : {}),
        allowedUse,
      },
    })
  }
  entries.sort((a, b) => a.idx - b.idx)
  return entries.map((e) => e.testimony)
}

function readVrm1Meta(
  bySubject: Map<string, Map<string, Term[]>>,
  ep: Map<string, Term[]> | undefined,
): WardrobeVrm1MetaNative | undefined {
  if (lit(ep, 'v1MetaMetaVersion') !== '1') return undefined
  const authors = readOrderedStrings(bySubject, ep, 'hasAuthorEntry', 'value')
  const references = readOrderedStrings(bySubject, ep, 'hasReferenceEntry', 'value')
  return {
    metaVersion: '1',
    name: lit(ep, 'v1MetaName') ?? '',
    ...(lit(ep, 'v1MetaVersion') !== undefined ? { version: lit(ep, 'v1MetaVersion') } : {}),
    authors,
    ...(lit(ep, 'v1MetaCopyrightInformation') !== undefined
      ? { copyrightInformation: lit(ep, 'v1MetaCopyrightInformation') }
      : {}),
    ...(lit(ep, 'v1MetaContactInformation') !== undefined ? { contactInformation: lit(ep, 'v1MetaContactInformation') } : {}),
    ...(references.length ? { references } : {}),
    ...(lit(ep, 'v1MetaThirdPartyLicenses') !== undefined ? { thirdPartyLicenses: lit(ep, 'v1MetaThirdPartyLicenses') } : {}),
    licenseUrl: lit(ep, 'v1MetaLicenseUrl') ?? '',
    ...(enumValue(ep, 'v1MetaAvatarPermission', VRM1_AVATAR_PERMISSIONS) !== undefined
      ? { avatarPermission: enumValue(ep, 'v1MetaAvatarPermission', VRM1_AVATAR_PERMISSIONS) }
      : {}),
    ...(boolOf(ep, 'v1MetaAllowExcessivelyViolentUsage') !== undefined
      ? { allowExcessivelyViolentUsage: boolOf(ep, 'v1MetaAllowExcessivelyViolentUsage') }
      : {}),
    ...(boolOf(ep, 'v1MetaAllowExcessivelySexualUsage') !== undefined
      ? { allowExcessivelySexualUsage: boolOf(ep, 'v1MetaAllowExcessivelySexualUsage') }
      : {}),
    ...(enumValue(ep, 'v1MetaCommercialUsage', VRM1_COMMERCIAL_USAGES) !== undefined
      ? { commercialUsage: enumValue(ep, 'v1MetaCommercialUsage', VRM1_COMMERCIAL_USAGES) }
      : {}),
    ...(boolOf(ep, 'v1MetaAllowPoliticalOrReligiousUsage') !== undefined
      ? { allowPoliticalOrReligiousUsage: boolOf(ep, 'v1MetaAllowPoliticalOrReligiousUsage') }
      : {}),
    ...(boolOf(ep, 'v1MetaAllowAntisocialOrHateUsage') !== undefined
      ? { allowAntisocialOrHateUsage: boolOf(ep, 'v1MetaAllowAntisocialOrHateUsage') }
      : {}),
    ...(enumValue(ep, 'v1MetaCreditNotation', VRM1_CREDIT_NOTATIONS) !== undefined
      ? { creditNotation: enumValue(ep, 'v1MetaCreditNotation', VRM1_CREDIT_NOTATIONS) }
      : {}),
    ...(boolOf(ep, 'v1MetaAllowRedistribution') !== undefined
      ? { allowRedistribution: boolOf(ep, 'v1MetaAllowRedistribution') }
      : {}),
    ...(enumValue(ep, 'v1MetaModification', VRM1_MODIFICATIONS) !== undefined
      ? { modification: enumValue(ep, 'v1MetaModification', VRM1_MODIFICATIONS) }
      : {}),
    ...(lit(ep, 'v1MetaOtherLicenseUrl') !== undefined ? { otherLicenseUrl: lit(ep, 'v1MetaOtherLicenseUrl') } : {}),
  }
}

function readVrm0Meta(ep: Map<string, Term[]> | undefined): WardrobeVrm0MetaNative | undefined {
  if (lit(ep, 'v0MetaMetaVersion') !== '0') return undefined
  return {
    metaVersion: '0',
    ...(enumValue(ep, 'v0MetaAllowedUserName', VRM0_ALLOWED_USER_NAMES) !== undefined
      ? { allowedUserName: enumValue(ep, 'v0MetaAllowedUserName', VRM0_ALLOWED_USER_NAMES) }
      : {}),
    ...(lit(ep, 'v0MetaAuthor') !== undefined ? { author: lit(ep, 'v0MetaAuthor') } : {}),
    ...(enumValue(ep, 'v0MetaCommercialUssageName', VRM0_USSAGE_VALUES) !== undefined
      ? { commercialUssageName: enumValue(ep, 'v0MetaCommercialUssageName', VRM0_USSAGE_VALUES) }
      : {}),
    ...(lit(ep, 'v0MetaContactInformation') !== undefined ? { contactInformation: lit(ep, 'v0MetaContactInformation') } : {}),
    ...(enumValue(ep, 'v0MetaLicenseName', VRM0_LICENSE_NAMES) !== undefined
      ? { licenseName: enumValue(ep, 'v0MetaLicenseName', VRM0_LICENSE_NAMES) }
      : {}),
    ...(lit(ep, 'v0MetaOtherLicenseUrl') !== undefined ? { otherLicenseUrl: lit(ep, 'v0MetaOtherLicenseUrl') } : {}),
    ...(lit(ep, 'v0MetaOtherPermissionUrl') !== undefined ? { otherPermissionUrl: lit(ep, 'v0MetaOtherPermissionUrl') } : {}),
    ...(lit(ep, 'v0MetaReference') !== undefined ? { reference: lit(ep, 'v0MetaReference') } : {}),
    ...(enumValue(ep, 'v0MetaSexualUssageName', VRM0_USSAGE_VALUES) !== undefined
      ? { sexualUssageName: enumValue(ep, 'v0MetaSexualUssageName', VRM0_USSAGE_VALUES) }
      : {}),
    ...(lit(ep, 'v0MetaTitle') !== undefined ? { title: lit(ep, 'v0MetaTitle') } : {}),
    ...(lit(ep, 'v0MetaVersion') !== undefined ? { version: lit(ep, 'v0MetaVersion') } : {}),
    ...(enumValue(ep, 'v0MetaViolentUssageName', VRM0_USSAGE_VALUES) !== undefined
      ? { violentUssageName: enumValue(ep, 'v0MetaViolentUssageName', VRM0_USSAGE_VALUES) }
      : {}),
  }
}
