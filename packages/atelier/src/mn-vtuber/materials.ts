import * as THREE from 'three'
import { colorFromHex, isNearlyWhite, warmSkinColor } from './math.js'
import type { MnVtuberAppearance, MnVtuberMaterialMode, MnVtuberRenderStats } from './types.js'

export function prepareVrmScene(
  scene: THREE.Object3D,
  materialMode: MnVtuberMaterialMode,
  appearance?: MnVtuberAppearance,
): MnVtuberRenderStats {
  let meshCount = 0
  let morphMeshCount = 0
  let shaderMaterialCount = 0
  let skinnedMeshCount = 0
  let visibleMeshCount = 0

  scene.traverse((object) => {
    object.frustumCulled = false
    const mesh = object as THREE.Mesh & { isMesh?: boolean; isSkinnedMesh?: boolean }
    if (!mesh.isMesh) return

    mesh.visible = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    visibleMeshCount += 1
    if (mesh.isSkinnedMesh) skinnedMeshCount += 1
    if (mesh.morphTargetInfluences?.length) morphMeshCount += 1

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    shaderMaterialCount += materials.filter((material) => material?.type === 'ShaderMaterial').length
    if (materialMode !== 'source') replaceMaterial(mesh, meshCount, materialMode, appearance)
    meshCount += 1
  })

  return {
    materialMode,
    meshCount,
    morphMeshCount,
    shaderMaterialCount,
    skinnedMeshCount,
    visibleMeshCount,
  }
}

export function applyVrmAppearance(
  scene: THREE.Object3D,
  materialMode: MnVtuberMaterialMode,
  appearance?: MnVtuberAppearance,
): void {
  if (materialMode === 'source') return

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh & { isMesh?: boolean }
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const color = materialNameColor(material?.name || mesh.name, material, appearance)
      const target = material as THREE.Material & { color?: THREE.Color }
      if (color && target.color instanceof THREE.Color) target.color.copy(color)
    }
  })
}

function replaceMaterial(
  mesh: THREE.Mesh,
  meshIndex: number,
  materialMode: Exclude<MnVtuberMaterialMode, 'source'>,
  appearance?: MnVtuberAppearance,
): void {
  const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const source = oldMaterials[0]
  const color =
    materialColor(source, appearance) ??
    new THREE.Color().setHSL((meshIndex * 0.17) % 1, 0.46, materialMode === 'diagnostic' ? 0.62 : 0.72)
  const alphaTest = materialNumber(source, 'alphaTest') ?? 0
  const opacity = materialNumber(source, 'opacity') ?? 1
  const transparent = materialBoolean(source, 'transparent') ?? opacity < 0.999
  const replacement = materialMode === 'diagnostic'
    ? new THREE.MeshBasicMaterial({
      alphaTest,
      color,
      opacity,
      side: THREE.DoubleSide,
      transparent,
    })
    : new THREE.MeshStandardMaterial({
      alphaTest,
      color,
      emissive: materialNonWhiteColor(source, 'emissive') ?? new THREE.Color(0x000000),
      emissiveIntensity: 0.08,
      metalness: 0.02,
      opacity,
      roughness: 0.72,
      side: THREE.DoubleSide,
      transparent,
    })

  replacement.name = source?.name || mesh.name || `mn-vtuber-material-${meshIndex}`
  mesh.material = replacement
  for (const oldMaterial of oldMaterials) oldMaterial?.dispose()
}

function materialColor(material: THREE.Material | undefined, appearance?: MnVtuberAppearance): THREE.Color | null {
  if (!material) return null
  const named = materialNameColor(material.name, material, appearance)
  if (named) return named
  const directValue = (material as THREE.Material & { color?: unknown }).color
  if (directValue instanceof THREE.Color && !isNearlyWhite(directValue)) return directValue.clone()
  return (
    materialNonWhiteColor(material, 'shadeColorFactor') ??
    materialNonWhiteColor(material, 'diffuse') ??
    materialNonWhiteColor(material, 'litFactor')
  )
}

function materialNameColor(
  name: string | undefined,
  material?: THREE.Material,
  appearance?: MnVtuberAppearance,
): THREE.Color | null {
  const upper = name?.toUpperCase() ?? ''
  if (upper.includes('HAIR')) {
    return colorFromHex(appearance?.hairTint) ?? materialNonWhiteColor(material, 'emissive') ?? new THREE.Color('#384150')
  }
  if (upper.includes('IRIS')) return colorFromHex(appearance?.eyeTint) ?? new THREE.Color('#5f8fdc')
  if (upper.includes('EYEWHITE') || upper.includes('EYEHIGHLIGHT')) return new THREE.Color('#f4fbff')
  if (upper.includes('EYELINE') || upper.includes('BROW')) return new THREE.Color('#2e3440')
  if (upper.includes('MOUTH')) return new THREE.Color('#8a425d')
  if (upper.includes('SKIN') || upper.includes('FACE')) {
    return warmSkinColor(appearance?.skinWarmth) ?? materialNonWhiteColor(material, 'shadeColorFactor') ?? new THREE.Color('#f1c6cf')
  }
  if (upper.includes('CLOTH') || upper.includes('TOP') || upper.includes('BOTTOM') || upper.includes('BODY')) {
    return colorFromHex(appearance?.outfitTint) ?? materialNonWhiteColor(material, 'shadeColorFactor') ?? new THREE.Color('#516c7a')
  }
  if (upper.includes('SHOES') || upper.includes('RIBBON') || upper.includes('TIE') || upper.includes('ACCENT')) {
    return colorFromHex(appearance?.accentTint) ?? new THREE.Color('#d6a84f')
  }
  return null
}

function materialNonWhiteColor(material: THREE.Material | undefined, name: string): THREE.Color | null {
  if (!material) return null
  const value = shaderUniformValue(material, name) ?? (material as unknown as Record<string, unknown>)[name]
  return value instanceof THREE.Color && !isNearlyWhite(value) ? value.clone() : null
}

function materialNumber(material: THREE.Material | undefined, name: string): number | null {
  if (!material) return null
  const value = shaderUniformValue(material, name) ?? (material as unknown as Record<string, unknown>)[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function materialBoolean(material: THREE.Material | undefined, name: string): boolean | null {
  if (!material) return null
  const value = (material as unknown as Record<string, unknown>)[name]
  return typeof value === 'boolean' ? value : null
}

function shaderUniformValue(material: THREE.Material, name: string): unknown {
  return (material as THREE.ShaderMaterial).uniforms?.[name]?.value
}
