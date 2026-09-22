/**
 * ingest-garment.test.ts — real-fixture coverage for
 * buildWardrobeGarmentFromInspection.
 *
 * No mocks: both fixtures go through the real inspectGlb -> real
 * buildWardrobeGarmentFromInspection -> real
 * serializeWardrobeGarmentsToTriples -> real parseWardrobeGarments pipeline,
 * exactly as a caller would use it.
 *
 * The two fixtures exercise the two different ways a garment gets carved out
 * of a real VRM (see ingest-garment.ts / mesh-classify.ts's own docstrings
 * for the full account):
 *   - seed-san.vrm (VRM 1.0): the garment is its OWN, separately-named mesh
 *     ('wear') — classified by MESH NAME, selection mode 'meshNames'.
 *   - avatar-sample-a.vrm (VRM 0.x): the garment is a set of PRIMITIVES
 *     sharing a mesh ('Body.baked') with the body itself, distinguished only
 *     by their own material's VRoid `_CLOTH` suffix — classified by
 *     MATERIAL SUFFIX, selection mode 'materialClassification'.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseWardrobeGarments, serializeWardrobeGarmentsToTriples, type WardrobeGarment } from '@shrubbery/nucleus'
import { inspectGlb } from '../glb-inspect.js'
import { buildWardrobeGarmentFromInspection } from '../ingest-garment.js'
import { classifyMaterialName, classifyMeshName } from '../mesh-classify.js'
import { hasVrmFixtures, VRM_FIXTURES_SKIP_MESSAGE } from './support/vrm-fixtures.js'

function loadFixture(relativePath: string): ArrayBuffer {
  const path = fileURLToPath(new URL(relativePath, import.meta.url))
  const bytes = readFileSync(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Canonicalize a WardrobeGarment's SET-valued fields (wardrobe-rdf.ts's
 * module docstring) the same way parseWardrobeGarments reconstructs them, so
 * a plain deep-equal against the parsed result is meaningful regardless of
 * the order buildWardrobeGarmentFromInspection happened to produce them in. */
function canonicalize(garment: WardrobeGarment): WardrobeGarment {
  return {
    ...garment,
    hiddenBodyMask: [...garment.hiddenBodyMask].sort(),
    compatibleRigContractVersions: [...garment.compatibleRigContractVersions].sort((a, b) => a - b),
    requiredHumanBones: [...garment.requiredHumanBones].sort(),
    auxBones: [...garment.auxBones].sort(),
    springChains: [...garment.springChains].sort(),
    requiredColliderGroups: [...garment.requiredColliderGroups].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// Plain JS guard, not vitest's describe.skipIf: vitest still INVOKES a
// skipIf'd describe's factory during collection (to discover and mark each
// child `it` skipped individually), which would still run loadFixture()
// below and throw before any test could be registered. An `if` around the
// whole block is the only way to make this suite skip cleanly rather than
// crash when fixtures/vrm/*.vrm is absent (Shrubbery's public export).
if (hasVrmFixtures) {
describe('mesh-classify: which fixture classifies by mesh-name vs by material-suffix', () => {
  it("seed-san.vrm's materials carry NONE of the VRoid suffix convention — mesh-name is the only usable signal", () => {
    const report = inspectGlb(loadFixture('../../fixtures/vrm/seed-san.vrm'))
    for (const material of report.materials) {
      expect(classifyMaterialName(material.name)).toBe('other')
    }
    expect(classifyMeshName('wear')).toBe('cloth')
    expect(classifyMeshName('hair')).toBe('hair')
    expect(classifyMeshName('head')).toBe('face')
    expect(classifyMeshName('robo_arm')).toBe('accessory')
  })

  it("avatar-sample-a.vrm's meshes are generic 'baked' bundles with no naming signal — material-suffix is the only usable signal", () => {
    const report = inspectGlb(loadFixture('../../fixtures/vrm/avatar-sample-a.vrm'))
    for (const mesh of report.meshes.meshes) {
      expect(classifyMeshName(mesh.name)).toBe('other')
    }
    const body = report.meshes.meshes.find((mesh) => mesh.name === 'Body.baked')!
    const materialNames = body.primitives.map((p) => p.materialName!)
    expect(materialNames.map(classifyMaterialName)).toEqual(['body', 'body', 'body', 'body', 'cloth', 'cloth', 'cloth'])
  })
})

describe('buildWardrobeGarmentFromInspection: seed-san.vrm (VRM 1.0) — carved by MESH NAME ("wear")', () => {
  const buffer = loadFixture('../../fixtures/vrm/seed-san.vrm')
  const report = inspectGlb(buffer)
  const garment = buildWardrobeGarmentFromInspection(
    report,
    { mode: 'meshNames', meshNames: ['wear'] },
    {
      id: 'garment-seed-san-wear',
      label: 'Seed-san outfit (VirtualCast)',
      layerRule: 'outer',
      compatibleRigContractVersions: [1],
      sourceFormat: 'vroidcustomitem',
      conformedArtifactId: 'artifact-seed-san-wear',
      conformedBuffer: buffer,
    },
  )

  it("infers coveragePart 'fullSet' from the mesh name 'wear'", () => {
    expect(garment.coveragePart).toBe('fullSet')
  })

  it('maps the exact triangleCount of the wear mesh (12 primitives, all selected)', () => {
    const wearMesh = report.meshes.meshes.find((m) => m.name === 'wear')!
    expect(wearMesh.primitiveCount).toBe(12)
    expect(garment.stats.triangleCount).toBe(23374)
    expect(garment.stats.triangleCount).toBe(wearMesh.triangleCount)
  })

  it('counts the 12 distinct materials and 10 distinct images the wear mesh actually uses, and detects mtoon usage', () => {
    expect(garment.stats.materialCount).toBe(12)
    expect(garment.stats.textureCount).toBe(10)
    expect(garment.stats.usesMtoon).toBe(true)
  })

  it("aggregates alphaMode to the most demanding mode present ('glass' is BLEND, everything else OPAQUE)", () => {
    expect(garment.stats.alphaMode).toBe('BLEND')
  })

  it('includes the spine/chest/upper-body humanoid bones the wear mesh actually binds (VRM1 source, so requiredHumanBones is populated)', () => {
    expect(garment.requiredHumanBones).toContain('hips')
    expect(garment.requiredHumanBones).toContain('spine')
    expect(garment.requiredHumanBones).toContain('chest')
    expect(garment.requiredHumanBones).toContain('leftUpperArm')
    expect(garment.requiredHumanBones).toContain('rightUpperArm')
    expect(garment.requiredHumanBones).toHaveLength(51)
    const wearMesh = report.meshes.meshes.find((m) => m.name === 'wear')!
    expect(garment.requiredHumanBones).toEqual(wearMesh.boundHumanBoneNames)
  })

  it('carries the wear mesh\'s own aux bones (forearm twists, robo-wire/backpack rigging), matching the mesh\'s own boundAuxBoneNames', () => {
    const wearMesh = report.meshes.meshes.find((m) => m.name === 'wear')!
    expect(garment.auxBones).toEqual(wearMesh.boundAuxBoneNames)
    expect(garment.auxBones.length).toBeGreaterThan(0)
  })

  it('carries the VRM1 license testimony byte-exact, witness inFileMeta, credit required', () => {
    expect(garment.license).toHaveLength(1)
    const testimony = garment.license[0]
    expect(testimony.witness).toBe('inFileMeta')
    expect(testimony.vrm0Meta).toBeUndefined()
    expect(testimony.vrm1Meta).toMatchObject({
      authors: ['VirtualCast, Inc.'],
      creditNotation: 'required',
    })
    expect(testimony.allowedUse.attributionRequired).toBe(true)
  })

  it('defaults lifecycle to bakedOffline from sourceFormat vroidcustomitem (not assumed independent of the source)', () => {
    expect(garment.lifecycle).toBe('bakedOffline')
  })

  it('leaves requiredColliderGroups and springChains empty (documented gaps, not fabricated)', () => {
    expect(garment.requiredColliderGroups).toEqual([])
    expect(garment.springChains).toEqual([])
  })

  it('leaves hiddenBodyMask empty when provenance does not supply one (cross-reference to a specific Base is unrecoverable here)', () => {
    expect(garment.hiddenBodyMask).toEqual([])
  })

  it('computes the conformed artifact contentSha as the real sha256 of the buffer supplied', () => {
    const expectedSha = createHash('sha256').update(Buffer.from(buffer)).digest('hex')
    expect(garment.conformedArtifact).toEqual({ artifactId: 'artifact-seed-san-wear', contentSha: expectedSha })
  })

  it('lets provenance override the inferred coveragePart and lifecycle outright', () => {
    const overridden = buildWardrobeGarmentFromInspection(
      report,
      { mode: 'meshNames', meshNames: ['wear'] },
      {
        id: 'garment-seed-san-wear-override',
        coveragePart: 'tops',
        layerRule: 'outer',
        lifecycle: 'composedAtRuntime',
        compatibleRigContractVersions: [1],
        sourceFormat: 'vroidcustomitem',
        conformedArtifactId: 'artifact-x',
        conformedContentSha: 'sha256:precomputed',
      },
    )
    expect(overridden.coveragePart).toBe('tops')
    expect(overridden.lifecycle).toBe('composedAtRuntime')
    expect(overridden.conformedArtifact.contentSha).toBe('sha256:precomputed')
  })

  it('throws (a function-contract error, not a license gate) when the selection matches no primitives', () => {
    expect(() =>
      buildWardrobeGarmentFromInspection(
        report,
        { mode: 'meshNames', meshNames: ['does-not-exist'] },
        {
          id: 'garment-bad',
          layerRule: 'outer',
          compatibleRigContractVersions: [1],
          sourceFormat: 'vroidcustomitem',
          conformedArtifactId: 'artifact-bad',
          conformedBuffer: buffer,
        },
      ),
    ).toThrow(/selection matched no primitives/)
  })

  it('throws (a function-contract error) when neither conformedContentSha nor conformedBuffer is supplied', () => {
    expect(() =>
      buildWardrobeGarmentFromInspection(
        report,
        { mode: 'meshNames', meshNames: ['wear'] },
        {
          id: 'garment-bad2',
          layerRule: 'outer',
          compatibleRigContractVersions: [1],
          sourceFormat: 'vroidcustomitem',
          conformedArtifactId: 'artifact-bad2',
        },
      ),
    ).toThrow(/conformedContentSha or conformedBuffer/)
  })
})

describe('buildWardrobeGarmentFromInspection: avatar-sample-a.vrm (VRM 0.x) — carved by MATERIAL SUFFIX (_CLOTH)', () => {
  const buffer = loadFixture('../../fixtures/vrm/avatar-sample-a.vrm')
  const report = inspectGlb(buffer)
  const garment = buildWardrobeGarmentFromInspection(
    report,
    { mode: 'materialClassification', classification: 'cloth' },
    {
      id: 'garment-avatar-a-outfit',
      label: 'AvatarSample_A default outfit (Tops+Bottoms+Shoes)',
      layerRule: 'outer',
      compatibleRigContractVersions: [1],
      sourceFormat: 'vroidcustomitem',
      conformedArtifactId: 'artifact-avatar-a-outfit',
      conformedBuffer: buffer,
    },
  )

  it("infers coveragePart 'fullSet' from the combined Tops+Bottoms+Shoes material keywords", () => {
    expect(garment.coveragePart).toBe('fullSet')
  })

  it('sums triangleCount across exactly the 3 _CLOTH primitives (not the whole Body.baked mesh)', () => {
    expect(garment.stats.triangleCount).toBe(5180)
    const body = report.meshes.meshes.find((m) => m.name === 'Body.baked')!
    expect(garment.stats.triangleCount).toBeLessThan(body.triangleCount)
  })

  it('counts the 3 distinct _CLOTH materials and their 5 distinct images, and detects no mtoon usage', () => {
    expect(garment.stats.materialCount).toBe(3)
    expect(garment.stats.textureCount).toBe(5)
    expect(garment.stats.usesMtoon).toBe(false)
  })

  it('aggregates alphaMode to MASK (all 3 _CLOTH materials are MASK)', () => {
    expect(garment.stats.alphaMode).toBe('MASK')
  })

  it('does NOT populate requiredHumanBones from this VRM0 source (architecture decision, mirrors ingest-base.ts)', () => {
    // The underlying bound-bone recovery IS generation-agnostic and DOES
    // resolve real VRM0 bone names for these primitives (proving the
    // mechanism works for both generations) — but wardrobe:Garment's
    // requiredHumanBones is a VRM1-canon-only field, so a VRM0 source
    // deliberately leaves it empty, same reasoning as ingest-base.ts's
    // humanBones for a VRM0-only Base.
    const body = report.meshes.meshes.find((m) => m.name === 'Body.baked')!
    const clothPrimitives = body.primitives.filter((p) => p.materialName?.includes('CLOTH'))
    expect(clothPrimitives.some((p) => p.boundHumanBoneNames.length > 0)).toBe(true)
    expect(garment.requiredHumanBones).toEqual([])
  })

  it("still carries auxBones (generation-agnostic — no vocabulary mismatch concern for plain node names)", () => {
    expect(garment.auxBones.length).toBeGreaterThan(0)
  })

  it('carries the VRM0 license testimony byte-exact, including the canonical Ussage misspellings', () => {
    expect(garment.license).toHaveLength(1)
    const testimony = garment.license[0]
    expect(testimony.witness).toBe('inFileMeta')
    expect(testimony.vrm1Meta).toBeUndefined()
    expect(testimony.vrm0Meta).toMatchObject({
      metaVersion: '0',
      title: 'AvatarSample_A',
      commercialUssageName: 'Allow',
    })
  })

  it('defaults lifecycle to bakedOffline from sourceFormat vroidcustomitem', () => {
    expect(garment.lifecycle).toBe('bakedOffline')
  })
})

describe('round trip: serializeWardrobeGarmentsToTriples -> parseWardrobeGarments is deep-equal to the canonicalized built Garment', () => {
  it('round-trips seed-san.vrm (mesh-name selection) losslessly', () => {
    const buffer = loadFixture('../../fixtures/vrm/seed-san.vrm')
    const report = inspectGlb(buffer)
    const garment = buildWardrobeGarmentFromInspection(
      report,
      { mode: 'meshNames', meshNames: ['wear'] },
      {
        id: 'garment-seed-san-wear-rt',
        label: 'Seed-san outfit round-trip',
        layerRule: 'outer',
        compatibleRigContractVersions: [1, 2],
        sourceFormat: 'vroidcustomitem',
        conformedArtifactId: 'artifact-seed-san-wear-rt',
        conformedBuffer: buffer,
      },
    )

    const triples = serializeWardrobeGarmentsToTriples([garment])
    const parsed = parseWardrobeGarments(triples)[garment.id]
    expect(parsed).toEqual(canonicalize(garment))
  })

  it('round-trips avatar-sample-a.vrm (material-classification selection) losslessly', () => {
    const buffer = loadFixture('../../fixtures/vrm/avatar-sample-a.vrm')
    const report = inspectGlb(buffer)
    const garment = buildWardrobeGarmentFromInspection(
      report,
      { mode: 'materialClassification', classification: 'cloth' },
      {
        id: 'garment-avatar-a-outfit-rt',
        layerRule: 'outer',
        compatibleRigContractVersions: [1],
        sourceFormat: 'vroidcustomitem',
        conformedArtifactId: 'artifact-avatar-a-outfit-rt',
        conformedBuffer: buffer,
      },
    )

    const triples = serializeWardrobeGarmentsToTriples([garment])
    const parsed = parseWardrobeGarments(triples)[garment.id]
    expect(parsed).toEqual(canonicalize(garment))
  })
})
} else {
  describe('buildWardrobeGarmentFromInspection: VRM fixtures', () => {
    it.skip(VRM_FIXTURES_SKIP_MESSAGE, () => {})
  })
}
