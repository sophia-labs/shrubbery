import * as THREE from 'three'

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean }
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      disposeMaterialTextures(material)
      material?.dispose()
    }
  })
}

function disposeMaterialTextures(material: THREE.Material | undefined): void {
  if (!material) return
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.Texture) value.dispose()
  }
}
