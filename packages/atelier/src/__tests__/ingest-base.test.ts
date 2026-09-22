/**
 * ingest-base.test.ts — real-fixture coverage for buildWardrobeBaseFromInspection.
 *
 * No mocks: both fixtures go through the real inspectGlb -> real
 * buildWardrobeBaseFromInspection -> real serializeWardrobeBasesToTriples ->
 * real parseWardrobeBases pipeline, exactly as a caller would use it. The
 * round-trip tests below are what surfaced the VRM0/VRM1 humanBones
 * vocabulary bug documented in ingest-base.ts (see its module docstring).
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseWardrobeBases, serializeWardrobeBasesToTriples, type WardrobeBase } from '@shrubbery/nucleus'
import { inspectGlb } from '../glb-inspect.js'
import { buildWardrobeBaseFromInspection } from '../ingest-base.js'
import { hasVrmFixtures, VRM_FIXTURES_SKIP_MESSAGE } from './support/vrm-fixtures.js'

function loadFixture(relativePath: string): ArrayBuffer {
  const path = fileURLToPath(new URL(relativePath, import.meta.url))
  const bytes = readFileSync(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Canonicalize a WardrobeBase's SET-valued fields (see wardrobe-rdf.ts's
 * module docstring) the same way parseWardrobeBases reconstructs them, so a
 * plain deep-equal against the parsed result is meaningful regardless of the
 * order buildWardrobeBaseFromInspection happened to produce them in. */
function canonicalize(base: WardrobeBase): WardrobeBase {
  return {
    ...base,
    humanBones: [...base.humanBones].sort(),
    auxBones: [...base.auxBones].sort(),
    colliderGroups: [...base.colliderGroups].sort((a, b) => a.name.localeCompare(b.name)),
    firstPersonAnnotations: [...base.firstPersonAnnotations].sort((a, b) => a.meshName.localeCompare(b.meshName)),
    materialTaxonomy: [...base.materialTaxonomy].sort((a, b) => a.materialName.localeCompare(b.materialName)),
    expressionPresets: [...base.expressionPresets].sort(),
    customExpressions: [...base.customExpressions].sort(),
  }
}

// Plain JS guard, not vitest's describe.skipIf: vitest still INVOKES a
// skipIf'd describe's factory during collection (to discover and mark each
// child `it` skipped individually), which would still run loadFixture()
// below and throw before any test could be registered. An `if` around the
// whole block is the only way to make this suite skip cleanly rather than
// crash when fixtures/vrm/*.vrm is absent (Shrubbery's public export).
if (hasVrmFixtures) {
describe('buildWardrobeBaseFromInspection: seed-san.vrm (VRM 1.0, VirtualCast Seed-san)', () => {
  const buffer = loadFixture('../../fixtures/vrm/seed-san.vrm')
  const report = inspectGlb(buffer)
  const base = buildWardrobeBaseFromInspection(report, {
    id: 'base-seed-san',
    label: 'Seed-san (VirtualCast)',
    rigContractVersion: 1,
    artifactId: 'artifact-seed-san',
    buffer,
  })

  it('carries the VRM1 license testimony byte-exact, witness inFileMeta', () => {
    expect(base.license).toHaveLength(1)
    const testimony = base.license[0]
    expect(testimony.witness).toBe('inFileMeta')
    expect(testimony.vrm0Meta).toBeUndefined()
    expect(testimony.vrm1Meta).toMatchObject({
      metaVersion: '1',
      authors: ['VirtualCast, Inc.'],
      avatarPermission: 'everyone',
      commercialUsage: 'corporation',
      creditNotation: 'required',
      modification: 'allowModificationRedistribution',
      allowRedistribution: true,
    })
  })

  it('computes the normalized allowedUse projection from the VRM1 flags', () => {
    expect(base.license[0].allowedUse).toEqual({
      mayModify: true,
      mayDistributeInApp: true,
      mayUseInMarketing: true,
      attributionRequired: true,
      maySublicense: false,
      exclusive: false,
    })
  })

  it('maps the full 51-bone humanoid coverage from the VRM1 humanoid map', () => {
    expect(base.humanBones).toHaveLength(51)
    expect(base.humanBones).toHaveLength(report.vrm1!.humanoid.boneCount)
    expect(base.humanBones).toContain('leftUpperArm')
    expect(base.humanBones).toContain('hips')
  })

  it('maps expressionPresets from the VRM1 expression presets, and no custom expressions', () => {
    expect(base.expressionPresets).toHaveLength(18)
    expect(base.expressionPresets).toEqual(expect.arrayContaining(['blink', 'happy', 'neutral', 'aa']))
    expect(base.customExpressions).toEqual([])
  })

  it('publishes +Z facing for a VRM 1.0 source', () => {
    expect(base.facing).toBe('+Z')
  })

  it('matches glb-inspect budgets totals exactly', () => {
    expect(base.budgets).toEqual({
      triangleCount: report.meshes.totalTriangleCount,
      materialCount: report.materials.length,
      textureCount: report.images.length,
    })
    expect(base.budgets.triangleCount).toBe(45058)
    expect(base.budgets.materialCount).toBe(17)
    expect(base.budgets.textureCount).toBe(15)
  })

  it('carries the resolved aux bone names, kept in lockstep with auxBoneJointCount', () => {
    expect(base.auxBones).toHaveLength(report.auxBoneJointCount)
    expect(base.auxBones).toEqual(report.auxBoneJointNames)
    expect(base.auxBones).toContain('forearm.twist.L')
    expect(base.auxBones).toContain('robo_shoulder.L')
  })

  it('leaves colliderGroups and firstPersonAnnotations empty (documented gaps, not fabricated)', () => {
    expect(base.colliderGroups).toEqual([])
    expect(base.firstPersonAnnotations).toEqual([])
  })

  it('material names in this fixture do not match the VRoid _SKIN/_FACE/_EYE/_HAIR convention', () => {
    expect(base.materialTaxonomy).toEqual([])
  })

  it('computes the artifact contentSha as the real sha256 of the inspected buffer', () => {
    const expectedSha = createHash('sha256').update(Buffer.from(buffer)).digest('hex')
    expect(base.artifact).toEqual({ artifactId: 'artifact-seed-san', contentSha: expectedSha })
  })

  it('accepts a caller-supplied contentSha instead of hashing (common real-pipeline case)', () => {
    const withPrecomputedSha = buildWardrobeBaseFromInspection(report, {
      id: 'base-seed-san',
      rigContractVersion: 1,
      artifactId: 'artifact-seed-san',
      contentSha: 'sha256:precomputed-elsewhere',
    })
    expect(withPrecomputedSha.artifact.contentSha).toBe('sha256:precomputed-elsewhere')
  })

  it('throws (a function-contract error, not a license gate) when neither contentSha nor buffer is supplied', () => {
    expect(() =>
      buildWardrobeBaseFromInspection(report, {
        id: 'base-seed-san',
        rigContractVersion: 1,
        artifactId: 'artifact-seed-san',
      }),
    ).toThrow(/contentSha or buffer/)
  })
})

describe('buildWardrobeBaseFromInspection: avatar-sample-a.vrm (VRM 0.x, VRoid AvatarSample_A)', () => {
  const buffer = loadFixture('../../fixtures/vrm/avatar-sample-a.vrm')
  const report = inspectGlb(buffer)
  const base = buildWardrobeBaseFromInspection(report, {
    id: 'base-avatar-a',
    rigContractVersion: 1,
    artifactId: 'artifact-avatar-a',
    buffer,
  })

  it('carries the VRM0 license testimony byte-exact, including the canonical Ussage misspellings', () => {
    expect(base.license).toHaveLength(1)
    const testimony = base.license[0]
    expect(testimony.witness).toBe('inFileMeta')
    expect(testimony.vrm1Meta).toBeUndefined()
    expect(testimony.vrm0Meta).toEqual({
      metaVersion: '0',
      title: 'AvatarSample_A',
      version: '',
      author: 'VRoid',
      contactInformation: '',
      reference: '',
      allowedUserName: 'Everyone',
      violentUssageName: 'Allow',
      sexualUssageName: 'Allow',
      commercialUssageName: 'Allow',
      otherPermissionUrl: '',
      licenseName: 'Other',
      otherLicenseUrl: '',
    })
  })

  it('derives a best-effort VRM1-shaped allowedUse from the VRM0 binary usage flags', () => {
    // allowedUserName 'Everyone' -> avatarPermission 'everyone';
    // commercialUssageName 'Allow' -> commercialUsage 'corporation' (most
    // permissive tier, since VRM0 draws no personal/corporate distinction);
    // licenseName 'Other' (not Redistribution_Prohibited) -> allowRedistribution true.
    expect(base.license[0].allowedUse).toEqual({
      mayModify: false, // VRM0 has no modification flag at all -> spec's restrictive default
      mayDistributeInApp: true,
      mayUseInMarketing: true,
      attributionRequired: true, // VRM0 has no creditNotation flag at all -> spec's restrictive default
      maySublicense: false,
      exclusive: false,
    })
  })

  it('publishes -Z facing for a VRM 0.x source', () => {
    expect(base.facing).toBe('-Z')
  })

  it('does NOT map VRM0 humanoid bone names onto the VRM1-canon humanBones field (architecture decision)', () => {
    // wardrobe-rdf.ts: a Base's rig contract is internal VRM1 canon; VRM 0.x
    // is ingest-boundary input only. VRM0's own humanoid vocabulary looks
    // textually similar to VRM1's but is not the same vocabulary — proven by
    // this exact fixture: its thumb-chain bone names are not all VRM1-canon.
    expect(report.vrm0!.humanoid.boneNames).toContain('leftThumbIntermediate')
    expect(base.humanBones).toEqual([])
  })

  it('still maps generation-agnostic fields: budgets, aux bones, material taxonomy', () => {
    expect(base.budgets).toEqual({
      triangleCount: report.meshes.totalTriangleCount,
      materialCount: report.materials.length,
      textureCount: report.images.length,
    })
    expect(base.auxBones).toHaveLength(report.auxBoneJointCount)
    expect(base.auxBones).toEqual(report.auxBoneJointNames)

    // VRoid's _SKIN/_FACE/_EYE/_HAIR material-naming convention IS present
    // in this fixture (unlike seed-san) — best-effort inference picks it up.
    expect(base.materialTaxonomy.length).toBeGreaterThan(0)
    expect(base.materialTaxonomy).toEqual(
      expect.arrayContaining([
        { materialName: 'F00_000_00_Body_00_SKIN', slot: 'skin' },
        { materialName: 'F00_000_00_EyeIris_00_EYE', slot: 'eye' },
        { materialName: 'F00_000_Hair_00_HAIR_01', slot: 'hair' },
      ]),
    )
    // The three _CLOTH-suffixed materials (Tops/Bottoms/Shoes) don't match
    // our closed skin/face/eye/hair vocabulary — correctly left unclassified.
    expect(base.materialTaxonomy.some((entry) => entry.materialName.includes('CLOTH'))).toBe(false)
  })

  it('leaves colliderGroups and firstPersonAnnotations empty (documented gaps, not fabricated)', () => {
    expect(base.colliderGroups).toEqual([])
    expect(base.firstPersonAnnotations).toEqual([])
  })

  it('produces no expression presets (VRM0 blendShapeMaster has no VRM1-preset-shaped names in the report)', () => {
    expect(base.expressionPresets).toEqual([])
    expect(base.customExpressions).toEqual([])
  })
})

describe('round trip: serializeWardrobeBasesToTriples -> parseWardrobeBases is deep-equal to the canonicalized built Base', () => {
  it('round-trips seed-san.vrm (VRM 1.0) losslessly', () => {
    const buffer = loadFixture('../../fixtures/vrm/seed-san.vrm')
    const report = inspectGlb(buffer)
    const base = buildWardrobeBaseFromInspection(report, {
      id: 'base-seed-san-rt',
      label: 'Seed-san round-trip',
      rigContractVersion: 3,
      artifactId: 'artifact-seed-san-rt',
      bindPoseHash: 'sha256:bindpose-seed-san',
      buffer,
    })

    const triples = serializeWardrobeBasesToTriples([base])
    const parsed = parseWardrobeBases(triples)[base.id]
    expect(parsed).toEqual(canonicalize(base))
  })

  it('round-trips avatar-sample-a.vrm (VRM 0.x) losslessly', () => {
    const buffer = loadFixture('../../fixtures/vrm/avatar-sample-a.vrm')
    const report = inspectGlb(buffer)
    const base = buildWardrobeBaseFromInspection(report, {
      id: 'base-avatar-a-rt',
      rigContractVersion: 1,
      artifactId: 'artifact-avatar-a-rt',
      buffer,
    })

    const triples = serializeWardrobeBasesToTriples([base])
    const parsed = parseWardrobeBases(triples)[base.id]
    expect(parsed).toEqual(canonicalize(base))
  })
})
} else {
  describe('buildWardrobeBaseFromInspection: VRM fixtures', () => {
    it.skip(VRM_FIXTURES_SKIP_MESSAGE, () => {})
  })
}
