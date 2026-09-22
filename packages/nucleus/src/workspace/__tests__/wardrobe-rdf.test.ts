/**
 * wardrobe-rdf.test.ts - exhaustive round-trip + vocabulary-discipline coverage
 * for the Atelier's wardrobe: catalog (ATELIER design doc, sophia-code-lab, §2).
 *
 * Mirrors the depth of vtuber-control-rdf.test.ts: real triples in and out via
 * the N-Triples codec, no mocks, deterministic-ordering checks, closed-vocab
 * rejection, and the license model's two load-bearing subtleties (restrictive
 * defaults; byte-exact preservation of the VRM 0.x "Ussage" misspellings).
 */

import { describe, it, expect } from 'vitest'
import { parseNT, triplesToNT } from '../rdf-model.js'
import {
  computeAllowedUseFromVrm1Meta,
  parseWardrobeBases,
  parseWardrobeCatalogTriples,
  parseWardrobeGarments,
  parseWardrobeOutfits,
  parseWardrobePortraits,
  parseWardrobeTextureVariants,
  serializeWardrobeBasesToTriples,
  serializeWardrobeCatalogToTriples,
  serializeWardrobeGarmentsToTriples,
  serializeWardrobeOutfitsToTriples,
  serializeWardrobePortraitsToTriples,
  serializeWardrobeTextureVariantsToTriples,
  wardrobeGraphIri,
  WARDROBE_RESTRICTIVE_DEFAULT_ALLOWED_USE,
  type WardrobeBase,
  type WardrobeCatalog,
  type WardrobeGarment,
  type WardrobeOutfit,
  type WardrobePortrait,
  type WardrobeTextureVariant,
} from '../wardrobe-rdf.js'

const BASE: WardrobeBase = {
  id: 'base-01',
  label: 'Canonical body v1',
  rigContractVersion: 2,
  // NOTE: the *ToTriples()/parse pair treats humanBones, auxBones,
  // colliderGroups, firstPersonAnnotations, materialTaxonomy,
  // expressionPresets, and customExpressions as UNORDERED SETS - parse always
  // returns them sorted by their natural key (see wardrobe-rdf.ts's
  // readStringSet/readEnumSet/readColliderGroups/etc). Fixtures below are
  // pre-sorted so plain round-trip `toEqual` holds; the "deterministic
  // ordering" describe block below separately proves order-independence by
  // feeding scrambled copies through the same serializer.
  humanBones: [
    'chest',
    'head',
    'hips',
    'leftEye',
    'leftFoot',
    'leftHand',
    'leftLowerArm',
    'leftLowerLeg',
    'leftUpperArm',
    'leftUpperLeg',
    'neck',
    'rightEye',
    'rightFoot',
    'rightHand',
    'rightLowerArm',
    'rightLowerLeg',
    'rightUpperArm',
    'rightUpperLeg',
    'spine',
  ],
  auxBones: ['forearm.twist.L', 'forearm.twist.R', 'hair_001', 'hair_002'],
  bindPoseHash: 'sha256:bindpose-abc123',
  facing: '+Z',
  colliderGroups: [
    { name: 'hips', version: 1 },
    { name: 'torso', version: 2 },
  ],
  firstPersonAnnotations: [
    { meshName: 'Body', flag: 'both' },
    { meshName: 'Head', flag: 'thirdPersonOnly' },
  ],
  materialTaxonomy: [
    { materialName: 'F00_000_00_Body_00_SKIN', slot: 'skin' },
    { materialName: 'F00_000_00_EyeIris_00_EYE', slot: 'eye' },
    { materialName: 'F00_000_00_Face_00_SKIN', slot: 'face' },
    { materialName: 'F00_000_00_Hair001_00_HAIR', slot: 'hair' },
  ],
  expressionPresets: ['aa', 'blink', 'ee', 'happy', 'ih', 'neutral', 'oh', 'ou'],
  customExpressions: ['determined', 'sleepy'],
  budgets: { triangleCount: 32000, materialCount: 17, textureCount: 22 },
  artifact: { artifactId: 'artifact-base-01', contentSha: 'sha256:base01content' },
  license: [
    {
      witness: 'inFileMeta',
      vrm1Meta: {
        metaVersion: '1',
        name: 'Base 01',
        version: '1.0.0',
        authors: ['Studio Vera', 'Contributor B'],
        copyrightInformation: '(c) 2026 Studio Vera',
        contactInformation: 'hello@example.test',
        references: ['https://example.test/ref1', 'https://example.test/ref2'],
        thirdPartyLicenses: 'None',
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        avatarPermission: 'everyone',
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        commercialUsage: 'corporation',
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        creditNotation: 'unnecessary',
        allowRedistribution: true,
        modification: 'allowModificationRedistribution',
        otherLicenseUrl: 'https://example.test/other',
      },
      allowedUse: computeAllowedUseFromVrm1Meta({
        avatarPermission: 'everyone',
        commercialUsage: 'corporation',
        modification: 'allowModificationRedistribution',
        creditNotation: 'unnecessary',
        allowRedistribution: true,
      }),
    },
  ],
}

const GARMENT: WardrobeGarment = {
  id: 'garment-rainjacket-01',
  label: 'Cropped rain jacket',
  coveragePart: 'tops',
  layerRule: 'outer',
  hiddenBodyMask: ['torso', 'upperArms'],
  compatibleRigContractVersions: [2, 3],
  requiredHumanBones: ['chest', 'hips', 'leftUpperArm', 'rightUpperArm'],
  auxBones: ['jacket_hem_001', 'jacket_hem_002'],
  springChains: ['hem-chain', 'hood-chain'],
  requiredColliderGroups: [{ name: 'torso', minVersion: 2 }],
  stats: {
    triangleCount: 4200,
    materialCount: 2,
    textureCount: 3,
    alphaMode: 'MASK',
    usesMtoon: true,
  },
  lifecycle: 'bakedOffline',
  sourceFormat: 'vroidcustomitem',
  license: [
    {
      witness: 'inFileMeta',
      vrm0Meta: {
        metaVersion: '0',
        allowedUserName: 'Everyone',
        author: 'Rain Studio',
        commercialUssageName: 'Disallow',
        contactInformation: 'rain@example.test',
        licenseName: 'CC_BY_NC',
        reference: 'https://example.test/rain-jacket',
        sexualUssageName: 'Disallow',
        title: 'Rain Jacket',
        version: '0.9',
        violentUssageName: 'Allow',
      },
      allowedUse: {
        mayModify: false,
        mayDistributeInApp: false,
        mayUseInMarketing: false,
        attributionRequired: true,
        maySublicense: false,
        exclusive: false,
      },
    },
    {
      witness: 'marketplaceTerms',
      allowedUse: {
        mayModify: true,
        mayDistributeInApp: true,
        mayUseInMarketing: false,
        attributionRequired: true,
        maySublicense: false,
        exclusive: false,
      },
    },
  ],
  conformedArtifact: { artifactId: 'artifact-garment-rainjacket-01-glb', contentSha: 'sha256:jacketglb' },
  sourceArchive: { artifactId: 'artifact-garment-rainjacket-01-src', contentSha: 'sha256:jacketsrc' },
}

const TEXTURE_VARIANT: WardrobeTextureVariant = {
  id: 'variant-rainjacket-floral',
  label: 'Floral pattern',
  variantOf: 'garment-rainjacket-01',
  textureArtifacts: [
    { artifactId: 'artifact-floral-diffuse', contentSha: 'sha256:floraldiffuse' },
    { artifactId: 'artifact-floral-normal', contentSha: 'sha256:floralnormal' },
  ],
  targetMaterialSlots: ['jacket-lining', 'jacket-outer'],
  license: [
    {
      witness: 'inFileMeta',
      vrm1Meta: {
        metaVersion: '1',
        name: 'Floral variant',
        authors: ['Pattern Studio'],
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
      },
      allowedUse: computeAllowedUseFromVrm1Meta({}),
    },
  ],
}

const OUTFIT: WardrobeOutfit = {
  id: 'outfit-rainy-day',
  label: 'Rainy day',
  base: 'base-01',
  layers: [
    { kind: 'garment', ref: 'garment-rainjacket-01' },
    { kind: 'variant', ref: 'variant-rainjacket-floral' },
  ],
  tints: {
    skinTint: '#f2d9c4',
    hairTint: '#2e3440',
    eyeTint: '#5f8fdc',
    accentTint: '#d6a84f',
    outfitTint: '#49636f',
  },
  compositionMode: 'bakedOffline',
  composedArtifact: { artifactId: 'artifact-outfit-rainy-day', contentSha: 'sha256:rainyday' },
  validationReport: 'report-rainy-day-01',
}

const PORTRAIT: WardrobePortrait = {
  id: 'portrait-emporium-l0-01',
  agentIri: 'http://sophia.ai/agent#emporium-l0-01',
  activeOutfit: 'outfit-rainy-day',
  activeFrom: '2026-07-06T12:00:00Z',
  drafts: ['outfit-rainy-day', 'outfit-draft-02'],
}

describe('wardrobe RDF vocabulary', () => {
  it('names the sibling :wardrobe graph', () => {
    expect(wardrobeGraphIri('g-abc')).toBe('urn:mnemosyne:local:graph:g-abc:wardrobe')
  })

  describe('wardrobe:Base', () => {
    it('round-trips a fully-populated Base through the N-Triples codec', () => {
      const triples = serializeWardrobeBasesToTriples([BASE])
      const nt = triplesToNT(triples)
      const parsed = parseWardrobeBases(parseNT(nt))
      expect(parsed[BASE.id]).toEqual(BASE)
    })

    it('publishes named, versioned collider groups as their own typed nodes', () => {
      const nt = triplesToNT(serializeWardrobeBasesToTriples([BASE]))
      expect(nt).toContain('<http://sophia.ai/ux#hasColliderGroup>')
      expect(nt).toContain('<http://sophia.ai/ux#name> "torso"')
      expect(nt).toContain('<http://sophia.ai/ux#version> "2"^^<http://www.w3.org/2001/XMLSchema#integer>')
    })

    it('minimal Base (empty collections, no label) round-trips too', () => {
      const minimal: WardrobeBase = {
        id: 'base-minimal',
        rigContractVersion: 1,
        humanBones: [],
        auxBones: [],
        bindPoseHash: 'sha256:empty',
        facing: '+Z',
        colliderGroups: [],
        firstPersonAnnotations: [],
        materialTaxonomy: [],
        expressionPresets: [],
        customExpressions: [],
        budgets: { triangleCount: 0, materialCount: 0, textureCount: 0 },
        artifact: { artifactId: 'artifact-minimal', contentSha: 'sha256:min' },
        license: [],
      }
      const parsed = parseWardrobeBases(parseNT(triplesToNT(serializeWardrobeBasesToTriples([minimal]))))
      expect(parsed['base-minimal']).toEqual(minimal)
    })
  })

  describe('wardrobe:Garment', () => {
    it('round-trips a fully-populated Garment (dual-witness license, both artifacts)', () => {
      const triples = serializeWardrobeGarmentsToTriples([GARMENT])
      const nt = triplesToNT(triples)
      const parsed = parseWardrobeGarments(parseNT(nt))
      expect(parsed[GARMENT.id]).toEqual(GARMENT)
    })

    it('round-trips a Garment with no sourceArchive (field omitted entirely, not null)', () => {
      const { sourceArchive: _drop, ...noArchive } = GARMENT
      const parsed = parseWardrobeGarments(parseNT(triplesToNT(serializeWardrobeGarmentsToTriples([noArchive]))))
      expect(parsed[GARMENT.id].sourceArchive).toBeUndefined()
      expect(parsed[GARMENT.id]).toEqual(noArchive)
    })
  })

  describe('wardrobe:TextureVariant', () => {
    it('round-trips a TextureVariant (no geometry, its own license testimony)', () => {
      const parsed = parseWardrobeTextureVariants(
        parseNT(triplesToNT(serializeWardrobeTextureVariantsToTriples([TEXTURE_VARIANT]))),
      )
      expect(parsed[TEXTURE_VARIANT.id]).toEqual(TEXTURE_VARIANT)
    })
  })

  describe('wardrobe:Outfit', () => {
    it('round-trips an ordered Outfit composition (garment + variant layers, tints, validation ref)', () => {
      const parsed = parseWardrobeOutfits(parseNT(triplesToNT(serializeWardrobeOutfitsToTriples([OUTFIT]))))
      expect(parsed[OUTFIT.id]).toEqual(OUTFIT)
    })

    it('layer order is semantic and is preserved exactly, not alphabetized', () => {
      const reordered: WardrobeOutfit = { ...OUTFIT, id: 'outfit-reordered', layers: [...OUTFIT.layers].reverse() }
      const parsed = parseWardrobeOutfits(parseNT(triplesToNT(serializeWardrobeOutfitsToTriples([reordered]))))
      expect(parsed['outfit-reordered'].layers).toEqual(reordered.layers)
      expect(parsed['outfit-reordered'].layers).not.toEqual(OUTFIT.layers)
    })

    it('round-trips an Outfit with no tints and no composedArtifact', () => {
      const bare: WardrobeOutfit = {
        id: 'outfit-bare',
        base: 'base-01',
        layers: [{ kind: 'garment', ref: 'garment-rainjacket-01' }],
        compositionMode: 'composedAtRuntime',
      }
      const parsed = parseWardrobeOutfits(parseNT(triplesToNT(serializeWardrobeOutfitsToTriples([bare]))))
      expect(parsed['outfit-bare']).toEqual(bare)
    })
  })

  describe('wardrobe:Portrait', () => {
    it('round-trips a Portrait binding (active outfit, activeFrom, ordered drafts)', () => {
      const parsed = parseWardrobePortraits(parseNT(triplesToNT(serializeWardrobePortraitsToTriples([PORTRAIT]))))
      expect(parsed[PORTRAIT.id]).toEqual(PORTRAIT)
    })

    it('an unadopted Portrait carries null active binding, not undefined', () => {
      const fresh: WardrobePortrait = {
        id: 'portrait-fresh',
        agentIri: 'http://sophia.ai/agent#fresh-01',
        activeOutfit: null,
        activeFrom: null,
        drafts: ['outfit-draft-01'],
      }
      const parsed = parseWardrobePortraits(parseNT(triplesToNT(serializeWardrobePortraitsToTriples([fresh]))))
      expect(parsed['portrait-fresh']).toEqual(fresh)
      expect(parsed['portrait-fresh'].activeOutfit).toBeNull()
      expect(parsed['portrait-fresh'].activeFrom).toBeNull()
    })

    it('agentIri is preserved as the raw external IRI, not translated through the sux: local-id scheme', () => {
      const nt = triplesToNT(serializeWardrobePortraitsToTriples([PORTRAIT]))
      expect(nt).toContain('<http://sophia.ai/ux#forAgent> <http://sophia.ai/agent#emporium-l0-01> .')
    })
  })

  describe('the aggregate catalog', () => {
    it('round-trips all five kinds together, cross-references intact', () => {
      const catalog: WardrobeCatalog = {
        bases: { [BASE.id]: BASE },
        garments: { [GARMENT.id]: GARMENT },
        textureVariants: { [TEXTURE_VARIANT.id]: TEXTURE_VARIANT },
        outfits: { [OUTFIT.id]: OUTFIT },
        portraits: { [PORTRAIT.id]: PORTRAIT },
      }
      const triples = serializeWardrobeCatalogToTriples(catalog)
      const nt = triplesToNT(triples)
      const parsed = parseWardrobeCatalogTriples(parseNT(nt))
      expect(parsed).toEqual(catalog)
      // cross-references resolve to plain local ids, not IRIs
      expect(parsed.outfits[OUTFIT.id].base).toBe(BASE.id)
      expect(parsed.outfits[OUTFIT.id].layers[0].ref).toBe(GARMENT.id)
      expect(parsed.textureVariants[TEXTURE_VARIANT.id].variantOf).toBe(GARMENT.id)
      expect(parsed.portraits[PORTRAIT.id].activeOutfit).toBe(OUTFIT.id)
    })

    it('an empty catalog round-trips to an empty catalog', () => {
      const empty: WardrobeCatalog = { bases: {}, garments: {}, textureVariants: {}, outfits: {}, portraits: {} }
      expect(serializeWardrobeCatalogToTriples(empty)).toEqual([])
      expect(parseWardrobeCatalogTriples([])).toEqual(empty)
    })
  })

  describe('closed-vocab rejection on parse', () => {
    it('drops an out-of-vocab scalar enum, falling back to the documented default', () => {
      const nt = `
<http://sophia.ai/ux#garment-bad> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeGarment> .
<http://sophia.ai/ux#garment-bad> <http://sophia.ai/ux#localId> "garment-bad" .
<http://sophia.ai/ux#garment-bad> <http://sophia.ai/ux#coveragePart> "spaceship" .
<http://sophia.ai/ux#garment-bad> <http://sophia.ai/ux#layerRule> "atmospheric" .
      `
      const parsed = parseWardrobeGarments(parseNT(nt))
      expect(parsed['garment-bad'].coveragePart).toBe('accessory')
      expect(parsed['garment-bad'].layerRule).toBe('outer')
    })

    it('drops only the invalid member of an enum set, keeping the valid ones', () => {
      const nt = `
<http://sophia.ai/ux#garment-bad2> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeGarment> .
<http://sophia.ai/ux#garment-bad2> <http://sophia.ai/ux#localId> "garment-bad2" .
<http://sophia.ai/ux#garment-bad2> <http://sophia.ai/ux#requiredHumanBone> "hips" .
<http://sophia.ai/ux#garment-bad2> <http://sophia.ai/ux#requiredHumanBone> "wingSpan" .
      `
      const parsed = parseWardrobeGarments(parseNT(nt))
      expect(parsed['garment-bad2'].requiredHumanBones).toEqual(['hips'])
    })

    it('drops an out-of-vocab firstPerson flag and alphaMode', () => {
      const nt = `
<http://sophia.ai/ux#base-bad> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeBase> .
<http://sophia.ai/ux#base-bad> <http://sophia.ai/ux#localId> "base-bad" .
<http://sophia.ai/ux#base-bad> <http://sophia.ai/ux#hasFirstPersonAnnotation> <http://sophia.ai/ux#base-bad-fp-0> .
<http://sophia.ai/ux#base-bad-fp-0> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeFirstPersonMeshAnnotation> .
<http://sophia.ai/ux#base-bad-fp-0> <http://sophia.ai/ux#meshName> "Body" .
<http://sophia.ai/ux#base-bad-fp-0> <http://sophia.ai/ux#flag> "invisible" .
      `
      const parsed = parseWardrobeBases(parseNT(nt))
      expect(parsed['base-bad'].firstPersonAnnotations).toEqual([])
    })

    it('drops an out-of-vocab lifecycle and sourceFormat, falling back to the documented defaults', () => {
      const nt = `
<http://sophia.ai/ux#garment-bad3> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeGarment> .
<http://sophia.ai/ux#garment-bad3> <http://sophia.ai/ux#localId> "garment-bad3" .
<http://sophia.ai/ux#garment-bad3> <http://sophia.ai/ux#lifecycle> "reincarnated" .
<http://sophia.ai/ux#garment-bad3> <http://sophia.ai/ux#sourceFormat> "handwoven" .
      `
      const parsed = parseWardrobeGarments(parseNT(nt))
      expect(parsed['garment-bad3'].lifecycle).toBe('bakedOffline')
      expect(parsed['garment-bad3'].sourceFormat).toBe('authored')
    })

    it('drops an out-of-vocab compositionMode on an Outfit, falling back to the documented default', () => {
      const nt = `
<http://sophia.ai/ux#outfit-bad> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeOutfit> .
<http://sophia.ai/ux#outfit-bad> <http://sophia.ai/ux#localId> "outfit-bad" .
<http://sophia.ai/ux#outfit-bad> <http://sophia.ai/ux#compositionMode> "quantumSuperposition" .
      `
      const parsed = parseWardrobeOutfits(parseNT(nt))
      expect(parsed['outfit-bad'].compositionMode).toBe('bakedOffline')
    })

    it('drops out-of-vocab VRM1 meta enum fields (avatarPermission/commercialUsage/creditNotation/modification), not silently coercing', () => {
      const nt = `
<http://sophia.ai/ux#garment-badvrm1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeGarment> .
<http://sophia.ai/ux#garment-badvrm1> <http://sophia.ai/ux#localId> "garment-badvrm1" .
<http://sophia.ai/ux#garment-badvrm1> <http://sophia.ai/ux#hasLicenseTestimony> <http://sophia.ai/ux#garment-badvrm1-license-0> .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeLicenseTestimony> .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#atIndex> "0"^^<http://www.w3.org/2001/XMLSchema#integer> .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#witness> "inFileMeta" .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#v1MetaMetaVersion> "1" .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#v1MetaName> "Bad VRM1" .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#v1MetaLicenseUrl> "https://vrm.dev/licenses/1.0/" .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#v1MetaAvatarPermission> "everyoneAndTheirDog" .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#v1MetaCommercialUsage> "megaCorp" .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#v1MetaCreditNotation> "optional" .
<http://sophia.ai/ux#garment-badvrm1-license-0> <http://sophia.ai/ux#v1MetaModification> "sureWhyNot" .
      `
      const parsed = parseWardrobeGarments(parseNT(nt))
      const vrm1Meta = parsed['garment-badvrm1'].license[0].vrm1Meta
      expect(vrm1Meta?.avatarPermission).toBeUndefined()
      expect(vrm1Meta?.commercialUsage).toBeUndefined()
      expect(vrm1Meta?.creditNotation).toBeUndefined()
      expect(vrm1Meta?.modification).toBeUndefined()
      // the name/licenseUrl still round-trip - only the invalid enums are dropped
      expect(vrm1Meta?.name).toBe('Bad VRM1')
    })
  })

  describe('license: restrictive-default computation', () => {
    it('computes the fully-restrictive default when every VRM1 flag is absent', () => {
      expect(computeAllowedUseFromVrm1Meta({})).toEqual(WARDROBE_RESTRICTIVE_DEFAULT_ALLOWED_USE)
      expect(computeAllowedUseFromVrm1Meta({})).toEqual({
        mayModify: false,
        mayDistributeInApp: false,
        mayUseInMarketing: false,
        attributionRequired: true,
        maySublicense: false,
        exclusive: false,
      })
    })

    it('computes a fully-permissive projection when every flag is set to its most permissive value', () => {
      expect(
        computeAllowedUseFromVrm1Meta({
          avatarPermission: 'everyone',
          commercialUsage: 'corporation',
          modification: 'allowModificationRedistribution',
          creditNotation: 'unnecessary',
          allowRedistribution: true,
        }),
      ).toEqual({
        mayModify: true,
        mayDistributeInApp: true,
        mayUseInMarketing: true,
        attributionRequired: false,
        maySublicense: false,
        exclusive: false,
      })
    })

    it('withholds in-app distribution when avatarPermission is onlyAuthor, even if allowRedistribution is true', () => {
      expect(
        computeAllowedUseFromVrm1Meta({ allowRedistribution: true, avatarPermission: 'onlyAuthor' }).mayDistributeInApp,
      ).toBe(false)
    })

    it('maySublicense and exclusive are always false when derived from spec-native meta - VRM has no such concept', () => {
      const permissive = computeAllowedUseFromVrm1Meta({
        avatarPermission: 'everyone',
        commercialUsage: 'corporation',
        modification: 'allowModificationRedistribution',
        creditNotation: 'unnecessary',
        allowRedistribution: true,
      })
      expect(permissive.maySublicense).toBe(false)
      expect(permissive.exclusive).toBe(false)
    })

    it('a marketplaceTerms witness can assert maySublicense/exclusive directly, disagreeing with the inFileMeta witness', () => {
      const contested: WardrobeGarment = {
        ...GARMENT,
        id: 'garment-contested',
        license: [
          GARMENT.license[0],
          { witness: 'marketplaceTerms', allowedUse: { ...WARDROBE_RESTRICTIVE_DEFAULT_ALLOWED_USE, maySublicense: true, exclusive: true } },
        ],
      }
      const parsed = parseWardrobeGarments(parseNT(triplesToNT(serializeWardrobeGarmentsToTriples([contested]))))
      expect(parsed['garment-contested'].license[0].allowedUse.maySublicense).toBe(false)
      expect(parsed['garment-contested'].license[1].allowedUse.maySublicense).toBe(true)
      expect(parsed['garment-contested'].license[1].witness).toBe('marketplaceTerms')
    })
  })

  describe('byte-exact preservation of the VRM 0.x "Ussage" fields', () => {
    it('preserves the canonical misspelled predicate names and their Allow/Disallow values verbatim', () => {
      const nt = triplesToNT(serializeWardrobeGarmentsToTriples([GARMENT]))
      expect(nt).toContain('<http://sophia.ai/ux#v0MetaViolentUssageName> "Allow"')
      expect(nt).toContain('<http://sophia.ai/ux#v0MetaSexualUssageName> "Disallow"')
      expect(nt).toContain('<http://sophia.ai/ux#v0MetaCommercialUssageName> "Disallow"')
      // the "corrected" spelling never appears - this module never normalizes spec-native fields
      expect(nt).not.toContain('UsageName')
    })

    it('round-trips the vrm0Meta object with the misspelled fields byte-exact', () => {
      const parsed = parseWardrobeGarments(parseNT(triplesToNT(serializeWardrobeGarmentsToTriples([GARMENT]))))
      const vrm0Meta = parsed[GARMENT.id].license[0].vrm0Meta
      expect(vrm0Meta).toEqual(GARMENT.license[0].vrm0Meta)
      expect(vrm0Meta?.violentUssageName).toBe('Allow')
      expect(vrm0Meta?.sexualUssageName).toBe('Disallow')
      expect(vrm0Meta?.commercialUssageName).toBe('Disallow')
    })

    it('an out-of-vocab Ussage value is dropped, not silently coerced', () => {
      const nt = `
<http://sophia.ai/ux#garment-badlicense> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeGarment> .
<http://sophia.ai/ux#garment-badlicense> <http://sophia.ai/ux#localId> "garment-badlicense" .
<http://sophia.ai/ux#garment-badlicense> <http://sophia.ai/ux#hasLicenseTestimony> <http://sophia.ai/ux#garment-badlicense-license-0> .
<http://sophia.ai/ux#garment-badlicense-license-0> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://sophia.ai/ux#WardrobeLicenseTestimony> .
<http://sophia.ai/ux#garment-badlicense-license-0> <http://sophia.ai/ux#atIndex> "0"^^<http://www.w3.org/2001/XMLSchema#integer> .
<http://sophia.ai/ux#garment-badlicense-license-0> <http://sophia.ai/ux#witness> "inFileMeta" .
<http://sophia.ai/ux#garment-badlicense-license-0> <http://sophia.ai/ux#v0MetaMetaVersion> "0" .
<http://sophia.ai/ux#garment-badlicense-license-0> <http://sophia.ai/ux#v0MetaViolentUssageName> "Maybe" .
      `
      const parsed = parseWardrobeGarments(parseNT(nt))
      expect(parsed['garment-badlicense'].license[0].vrm0Meta?.violentUssageName).toBeUndefined()
    })
  })

  describe('deterministic ordering', () => {
    it('unordered collections serialize identically regardless of input array order', () => {
      const scrambled: WardrobeBase = {
        ...BASE,
        humanBones: [...BASE.humanBones].reverse(),
        auxBones: [...BASE.auxBones].reverse(),
        colliderGroups: [...BASE.colliderGroups].reverse(),
        firstPersonAnnotations: [...BASE.firstPersonAnnotations].reverse(),
        materialTaxonomy: [...BASE.materialTaxonomy].reverse(),
        expressionPresets: [...BASE.expressionPresets].reverse(),
        customExpressions: [...BASE.customExpressions].reverse(),
      }
      const a = triplesToNT(serializeWardrobeBasesToTriples([BASE]))
      const b = triplesToNT(serializeWardrobeBasesToTriples([scrambled]))
      expect(b).toBe(a)
    })

    it('catalog-level serialization is stable regardless of Record insertion order', () => {
      const base2: WardrobeBase = { ...BASE, id: 'base-02', label: 'Second base' }
      const catalogAB: WardrobeCatalog = {
        bases: { [BASE.id]: BASE, [base2.id]: base2 },
        garments: {},
        textureVariants: {},
        outfits: {},
        portraits: {},
      }
      const catalogBA: WardrobeCatalog = {
        bases: { [base2.id]: base2, [BASE.id]: BASE },
        garments: {},
        textureVariants: {},
        outfits: {},
        portraits: {},
      }
      expect(triplesToNT(serializeWardrobeCatalogToTriples(catalogAB))).toBe(
        triplesToNT(serializeWardrobeCatalogToTriples(catalogBA)),
      )
    })

    it('serializing twice from the same input produces byte-identical NT output', () => {
      const once = triplesToNT(serializeWardrobeGarmentsToTriples([GARMENT]))
      const twice = triplesToNT(serializeWardrobeGarmentsToTriples([GARMENT]))
      expect(twice).toBe(once)
    })
  })

  // The previous block proves the serialized NT TEXT is order-insensitive.
  // This block goes one step further and proves the OBJECT that comes back
  // out of parse() is order-insensitive too: build with deliberately
  // shuffled (reversed) array inputs - not the pre-sorted fixtures above -
  // and check against the CANONICALIZED form, for every one of the five
  // kinds. Outfit/Portrait carry genuinely ORDERED (index-carried) fields,
  // so their shuffled input must come back in that SAME shuffled order, not
  // sorted.
  describe('object-level scrambled round-trip (build → serialize → parse against the canonicalized form)', () => {
    it('Base: shuffled set-valued fields round-trip to canonical (sorted) order', () => {
      const scrambled: WardrobeBase = {
        ...BASE,
        humanBones: [...BASE.humanBones].reverse(),
        auxBones: [...BASE.auxBones].reverse(),
        colliderGroups: [...BASE.colliderGroups].reverse(),
        firstPersonAnnotations: [...BASE.firstPersonAnnotations].reverse(),
        materialTaxonomy: [...BASE.materialTaxonomy].reverse(),
        expressionPresets: [...BASE.expressionPresets].reverse(),
        customExpressions: [...BASE.customExpressions].reverse(),
      }
      const parsed = parseWardrobeBases(parseNT(triplesToNT(serializeWardrobeBasesToTriples([scrambled]))))
      // BASE's own fixture is documented as already pre-sorted/canonical (see
      // the NOTE above it) - so the canonical form IS BASE itself.
      expect(parsed[BASE.id]).toEqual(BASE)
    })

    it('Garment: shuffled scalar sets and requiredColliderGroups round-trip to canonical order', () => {
      const canonical: WardrobeGarment = {
        ...GARMENT,
        id: 'garment-scrambled',
        // GARMENT's own requiredColliderGroups fixture only has one entry -
        // too little to prove multi-entry order-independence, so this test
        // uses its own two-entry (already-sorted) canonical form.
        requiredColliderGroups: [
          { name: 'hem', minVersion: 1 },
          { name: 'torso', minVersion: 2 },
        ],
      }
      const scrambled: WardrobeGarment = {
        ...canonical,
        hiddenBodyMask: [...canonical.hiddenBodyMask].reverse(),
        compatibleRigContractVersions: [...canonical.compatibleRigContractVersions].reverse(),
        requiredHumanBones: [...canonical.requiredHumanBones].reverse(),
        auxBones: [...canonical.auxBones].reverse(),
        springChains: [...canonical.springChains].reverse(),
        requiredColliderGroups: [...canonical.requiredColliderGroups].reverse(),
      }
      const parsed = parseWardrobeGarments(parseNT(triplesToNT(serializeWardrobeGarmentsToTriples([scrambled]))))
      expect(parsed['garment-scrambled']).toEqual(canonical)
    })

    it('TextureVariant: shuffled textureArtifacts and targetMaterialSlots round-trip to canonical order', () => {
      const scrambled: WardrobeTextureVariant = {
        ...TEXTURE_VARIANT,
        id: 'variant-scrambled',
        textureArtifacts: [...TEXTURE_VARIANT.textureArtifacts].reverse(),
        targetMaterialSlots: [...TEXTURE_VARIANT.targetMaterialSlots].reverse(),
      }
      const parsed = parseWardrobeTextureVariants(
        parseNT(triplesToNT(serializeWardrobeTextureVariantsToTriples([scrambled]))),
      )
      expect(parsed['variant-scrambled']).toEqual({ ...TEXTURE_VARIANT, id: 'variant-scrambled' })
    })

    it('Outfit: layers are ORDERED (not a set) - shuffled input comes back in that SAME order, never sorted', () => {
      const shuffledLayers = [...OUTFIT.layers].reverse()
      const scrambled: WardrobeOutfit = { ...OUTFIT, id: 'outfit-scrambled', layers: shuffledLayers }
      const parsed = parseWardrobeOutfits(parseNT(triplesToNT(serializeWardrobeOutfitsToTriples([scrambled]))))
      expect(parsed['outfit-scrambled']).toEqual(scrambled)
      expect(parsed['outfit-scrambled'].layers).toEqual(shuffledLayers)
    })

    it('Portrait: drafts are ORDERED (not a set) - shuffled input comes back in that SAME order, never sorted', () => {
      const shuffledDrafts = [...PORTRAIT.drafts].reverse()
      const scrambled: WardrobePortrait = { ...PORTRAIT, id: 'portrait-scrambled', drafts: shuffledDrafts }
      const parsed = parseWardrobePortraits(parseNT(triplesToNT(serializeWardrobePortraitsToTriples([scrambled]))))
      expect(parsed['portrait-scrambled']).toEqual(scrambled)
      expect(parsed['portrait-scrambled'].drafts).toEqual(shuffledDrafts)
    })
  })
})
