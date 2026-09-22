import type * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

export type MnVtuberCameraFrame = 'portrait' | 'bust' | 'full'
export type MnVtuberExpressionPreset = 'neutral' | 'focused' | 'excited' | 'strained'
export type MnVtuberMaterialMode = 'capture-safe' | 'source' | 'diagnostic'
export type MnVtuberStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
export type MnVtuberGesture = 'none' | 'hello' | 'nod' | 'nope' | 'bow' | 'surprise' | 'lookAround' | 'dance'

export interface MnVtuberAppearance {
  accentTint?: string
  eyeTint?: string
  hairTint?: string
  outfitTint?: string
  skinWarmth?: number
}

export interface MnVtuberRotation {
  x: number
  y: number
  z: number
}

export interface MnVtuberRootMotion {
  bodyYaw?: number
  x?: number
  y?: number
  z?: number
}

/** User/agent-facing steering angles in degrees. */
export interface MnVtuberPuppetAngles {
  pitch?: number
  yaw?: number
  roll?: number
}

/** Normalized arm steering. raise/bend: 0..1, spread/twist/wrist: -1..1. */
export interface MnVtuberArmPuppet {
  bend?: number
  raise?: number
  spread?: number
  twist?: number
  wrist?: number
}

/**
 * Higher-level puppet controls. This is intentionally friendlier than raw VRM
 * bones: degrees for body/head/chest, normalized expression/arm sliders, and
 * named gestures with optional externally-driven progress.
 */
export interface MnVtuberPuppetState {
  bodyLean?: number
  bodyYaw?: number
  breath?: number
  chest?: MnVtuberPuppetAngles
  gesture?: MnVtuberGesture
  gestureProgress?: number
  gestureWeight?: number
  head?: MnVtuberPuppetAngles
  idle?: number
  leftArm?: MnVtuberArmPuppet
  rightArm?: MnVtuberArmPuppet
  smile?: number
  strain?: number
  talk?: number
}

export interface MnVtuberPose {
  bones?: Record<string, MnVtuberRotation>
  expressions?: Record<string, number>
  lookAt?: { x: number; y: number }
  mouth?: number
  blink?: number
  root?: MnVtuberRootMotion
}

export interface MnVtuberPoseInput {
  blink?: number
  elapsed: number
  expressionPreset?: MnVtuberExpressionPreset
  lookX?: number
  lookY?: number
  mouth?: number
  overlay?: MnVtuberPose
  puppet?: MnVtuberPuppetState
}

export interface MnVtuberRenderStats {
  materialMode: MnVtuberMaterialMode
  meshCount: number
  morphMeshCount: number
  shaderMaterialCount: number
  skinnedMeshCount: number
  visibleMeshCount: number
}

export interface MnVtuberStatusDetail {
  controlChannel?: string
  error?: string
  modelUrl: string
  stats?: MnVtuberRenderStats
  status: MnVtuberStatus
}

export interface VrmRuntime {
  height: number
  rest: Map<string, THREE.Quaternion>
  scene: THREE.Object3D
  stats: MnVtuberRenderStats
  vrm: VRM
}

export interface FallbackRig {
  chest: THREE.Object3D
  group: THREE.Group
  head: THREE.Object3D
  leftEye: THREE.Object3D
  mouth: THREE.Object3D
  rightEye: THREE.Object3D
}

export const CONTROLLED_BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'head',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
] as const

export const MN_VTUBER_EXPRESSION_NAMES = [
  'blink',
  'blinkLeft',
  'blinkRight',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
] as const
