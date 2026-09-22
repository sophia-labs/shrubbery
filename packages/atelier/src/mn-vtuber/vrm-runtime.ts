import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  type VRM,
  type VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm'
import { clamp01 } from './math.js'
import { applyVrmAppearance, prepareVrmScene } from './materials.js'
import {
  CONTROLLED_BONES,
  MN_VTUBER_EXPRESSION_NAMES,
  type MnVtuberAppearance,
  type MnVtuberMaterialMode,
  type MnVtuberPose,
  type MnVtuberRotation,
  type VrmRuntime,
} from './types.js'

export async function loadVrmRuntime({
  appearance,
  lookTarget,
  materialMode,
  modelUrl,
}: {
  appearance?: MnVtuberAppearance
  lookTarget: THREE.Object3D
  materialMode: MnVtuberMaterialMode
  modelUrl: string
}): Promise<VrmRuntime> {
  const loader = new GLTFLoader()
  loader.crossOrigin = 'anonymous'
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf: GLTF = await loader.loadAsync(modelUrl)
  const vrm = gltf.userData.vrm as VRM | undefined
  if (!vrm) throw new Error('Loaded model did not expose VRM runtime data.')

  VRMUtils.rotateVRM0(vrm)
  vrm.scene.name = 'mn-vtuber-vrm-scene'
  vrm.scene.updateMatrixWorld(true)
  const stats = prepareVrmScene(vrm.scene, materialMode, appearance)
  const height = fitAvatarToLocalOrigin(vrm.scene)
  const rest = captureRestPose(vrm)
  if (vrm.lookAt) vrm.lookAt.target = lookTarget
  return { height, rest, scene: vrm.scene, stats, vrm }
}

export function refreshVrmAppearance(
  runtime: VrmRuntime,
  materialMode: MnVtuberMaterialMode,
  appearance?: MnVtuberAppearance,
): void {
  applyVrmAppearance(runtime.scene, materialMode, appearance)
}

export function applyVrmPose(
  runtime: VrmRuntime,
  pose: Required<MnVtuberPose>,
  lookTarget: THREE.Object3D,
): void {
  for (const boneName of CONTROLLED_BONES) {
    setBoneEuler(runtime.vrm, runtime.rest, boneName, pose.bones[boneName] ?? { x: 0, y: 0, z: 0 })
  }

  lookTarget.position.set(
    pose.lookAt.x * 0.42,
    runtime.height * 0.78 + pose.lookAt.y * 0.24,
    -1.1,
  )
  lookTarget.updateMatrixWorld(true)

  for (const expressionName of MN_VTUBER_EXPRESSION_NAMES) {
    const value = pose.expressions[expressionName] ?? 0
    setExpression(runtime.vrm, expressionName, value)
  }
}

function fitAvatarToLocalOrigin(object: THREE.Object3D): number {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  object.position.x -= center.x
  object.position.z -= center.z
  object.position.y -= box.min.y
  object.updateMatrixWorld(true)
  return Math.max(1, box.max.y - box.min.y)
}

function captureRestPose(vrm: VRM): Map<string, THREE.Quaternion> {
  const rest = new Map<string, THREE.Quaternion>()
  for (const boneName of CONTROLLED_BONES) {
    const bone = getNormalizedBone(vrm, boneName)
    if (bone) rest.set(boneName, bone.quaternion.clone())
  }
  return rest
}

function setBoneEuler(
  vrm: VRM,
  rest: Map<string, THREE.Quaternion>,
  name: string,
  rotation: MnVtuberRotation,
): void {
  const bone = getNormalizedBone(vrm, name)
  const restQuaternion = rest.get(name)
  if (!bone || !restQuaternion) return

  const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z, 'XYZ'))
  bone.quaternion.copy(restQuaternion).multiply(offset)
}

function setExpression(vrm: VRM, name: string, value: number): void {
  try {
    vrm.expressionManager?.setValue(name, clamp01(value))
  } catch {
    // VRMs are allowed to omit standard expression slots.
  }
}

function getNormalizedBone(vrm: VRM, name: string): THREE.Object3D | null {
  return vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName)
}
