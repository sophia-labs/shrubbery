import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inspectGlb } from '../glb-inspect.js'
import { hasVrmFixtures, VRM_FIXTURES_SKIP_MESSAGE } from './support/vrm-fixtures.js'

/**
 * Real file I/O against the two fixtures in fixtures/vrm/ — no mocks. The
 * asserted values are the ground truth from the Python reference dissection
 * that produced these fixtures (dissect_vrm.py), so this test is the oracle
 * checking itself against an independent implementation of the same spec.
 */
function loadFixture(relativePath: string): ArrayBuffer {
  const path = fileURLToPath(new URL(relativePath, import.meta.url))
  const bytes = readFileSync(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

// Plain JS guard, not vitest's describe.skipIf: vitest still INVOKES a
// skipIf'd describe's factory during collection (to discover and mark each
// child `it` skipped individually), which would still run loadFixture()
// below and throw before any test could be registered. An `if` around the
// whole block is the only way to make this suite skip cleanly rather than
// crash when fixtures/vrm/*.vrm is absent (Shrubbery's public export).
if (hasVrmFixtures) {
describe('inspectGlb: seed-san.vrm (VRM 1.0, VirtualCast Seed-san)', () => {
  const report = inspectGlb(loadFixture('../../fixtures/vrm/seed-san.vrm'))

  it('parses the GLB header and chunks', () => {
    expect(report.glb.version).toBe(2)
    expect(report.glb.chunks).toEqual([
      { type: 'JSON', byteLength: 134736 },
      { type: 'BIN', byteLength: 10783036 },
    ])
  })

  it('reports the exact ordered extensionsUsed list', () => {
    expect(report.gltf.extensionsUsed).toEqual([
      'VRMC_springBone',
      'VRMC_vrm',
      'KHR_materials_unlit',
      'VRMC_materials_mtoon',
      'KHR_texture_transform',
      'KHR_materials_emissive_strength',
      'VRMC_node_constraint',
    ])
  })

  it('detects VRM 1.0 via VRMC_vrm', () => {
    expect(report.vrmDetection).toBe('VRMC_vrm')
    expect(report.vrm0).toBeNull()
    expect(report.vrm1?.specVersion).toBe('1.0')
  })

  it('extracts meta byte-exact as a complete object', () => {
    expect(report.vrm1?.meta).toEqual({
      name: 'Seed-san',
      version: '1',
      authors: ['VirtualCast, Inc.'],
      copyrightInformation: 'VirtualCast, Inc.',
      thumbnailImage: 14,
      licenseUrl: 'https://vrm.dev/licenses/1.0/',
      avatarPermission: 'everyone',
      allowExcessivelyViolentUsage: true,
      allowExcessivelySexualUsage: true,
      commercialUsage: 'corporation',
      allowPoliticalOrReligiousUsage: true,
      allowAntisocialOrHateUsage: true,
      creditNotation: 'required',
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
    })
  })

  it('maps 51 humanoid bones', () => {
    expect(report.vrm1?.humanoid.boneCount).toBe(51)
  })

  it('lists 18 expression presets and no custom expressions', () => {
    expect(report.vrm1?.expressions.presetNames).toEqual([
      'aa',
      'angry',
      'blink',
      'blinkLeft',
      'blinkRight',
      'ee',
      'happy',
      'ih',
      'lookDown',
      'lookLeft',
      'lookRight',
      'lookUp',
      'neutral',
      'oh',
      'ou',
      'relaxed',
      'sad',
      'surprised',
    ])
    expect(report.vrm1?.expressions.customNames).toEqual([])
  })

  it('counts spring bone physics', () => {
    expect(report.vrm1?.springBone).toEqual({
      springCount: 9,
      jointCount: 28,
      colliderCount: 8,
      colliderGroupCount: 2,
    })
  })

  it('counts nodes and per-skin joints', () => {
    expect(report.nodeCount).toBe(147)
    expect(report.skins).toHaveLength(5)
    expect(report.skins.map((skin) => skin.jointCount)).toEqual([23, 7, 1, 21, 80])
  })

  it('computes per-mesh stats and totals exactly', () => {
    expect(report.meshes.meshes.map((mesh) => ({ name: mesh.name, vertexCount: mesh.vertexCount, triangleCount: mesh.triangleCount, maxMorphTargetCount: mesh.maxMorphTargetCount }))).toEqual([
      { name: 'hair', vertexCount: 5185, triangleCount: 7880, maxMorphTargetCount: 0 },
      { name: 'hair_tail', vertexCount: 156, triangleCount: 238, maxMorphTargetCount: 0 },
      { name: 'head', vertexCount: 6142, triangleCount: 10550, maxMorphTargetCount: 43 },
      { name: 'robo_arm', vertexCount: 3795, triangleCount: 3016, maxMorphTargetCount: 0 },
      { name: 'wear', vertexCount: 18781, triangleCount: 23374, maxMorphTargetCount: 0 },
    ])
    expect(report.meshes.totalVertexCount).toBe(34059)
    expect(report.meshes.totalTriangleCount).toBe(45058)
  })

  it('counts materials and mtoon usage', () => {
    expect(report.materials).toHaveLength(17)
    expect(report.materials.filter((material) => material.hasMtoon)).toHaveLength(10)
  })

  it('reads image metadata and parses PNG dimensions', () => {
    expect(report.images).toHaveLength(15)
    expect(report.images.every((image) => image.mimeType === 'image/png')).toBe(true)
    const thumbnail = report.images.find((image) => image.name === 'thumbnail')
    expect(thumbnail?.width).toBe(512)
    expect(thumbnail?.height).toBe(512)
  })

  it('counts non-humanoid (aux) skin joints', () => {
    expect(report.auxBoneJointCount).toBe(77)
  })
})

describe('inspectGlb: avatar-sample-a.vrm (VRM 0.x, VRoid AvatarSample_A)', () => {
  const report = inspectGlb(loadFixture('../../fixtures/vrm/avatar-sample-a.vrm'))

  it('reports the UniGLTF generator and exact extensionsUsed', () => {
    expect(report.gltf.generator).toBe('UniGLTF-1.28')
    expect(report.gltf.extensionsUsed).toEqual(['KHR_materials_unlit', 'VRM'])
  })

  it('detects VRM 0.x via the VRM extension', () => {
    expect(report.vrmDetection).toBe('VRM')
    expect(report.vrm1).toBeNull()
  })

  it('extracts meta byte-exact as a complete object, including the canonical 0.x misspellings', () => {
    expect(report.vrm0?.meta).toEqual({
      title: 'AvatarSample_A',
      version: '',
      author: 'VRoid',
      contactInformation: '',
      reference: '',
      texture: 27,
      allowedUserName: 'Everyone',
      violentUssageName: 'Allow',
      sexualUssageName: 'Allow',
      commercialUssageName: 'Allow',
      otherPermissionUrl: '',
      licenseName: 'Other',
      otherLicenseUrl: '',
    })
  })

  it('maps 54 humanoid bones', () => {
    expect(report.vrm0?.humanoid.boneCount).toBe(54)
  })

  it('counts secondaryAnimation bone/collider groups', () => {
    expect(report.vrm0?.secondaryAnimation).toEqual({ boneGroupCount: 10, colliderGroupCount: 10 })
  })

  it('counts nodes and per-skin joints', () => {
    expect(report.nodeCount).toBe(108)
    expect(report.skins).toHaveLength(3)
    expect(report.skins.map((skin) => skin.jointCount)).toEqual([103, 103, 103])
  })

  it('computes per-mesh stats and totals exactly', () => {
    expect(report.meshes.meshes.map((mesh) => ({ name: mesh.name, vertexCount: mesh.vertexCount, triangleCount: mesh.triangleCount, maxMorphTargetCount: mesh.maxMorphTargetCount }))).toEqual([
      { name: 'Face.baked', vertexCount: 20540, triangleCount: 3158, maxMorphTargetCount: 56 },
      { name: 'Body.baked', vertexCount: 55433, triangleCount: 12912, maxMorphTargetCount: 0 },
      { name: 'Hair001.baked', vertexCount: 588088, triangleCount: 8784, maxMorphTargetCount: 0 },
    ])
    expect(report.meshes.totalVertexCount).toBe(664061)
    expect(report.meshes.totalTriangleCount).toBe(24854)
  })

  it('counts materials with zero glTF-level mtoon extensions', () => {
    expect(report.materials).toHaveLength(17)
    expect(report.materials.filter((material) => material.hasMtoon)).toHaveLength(0)
  })

  it('counts images', () => {
    expect(report.images).toHaveLength(28)
  })
})
} else {
  describe('inspectGlb: VRM fixtures', () => {
    it.skip(VRM_FIXTURES_SKIP_MESSAGE, () => {})
  })
}
