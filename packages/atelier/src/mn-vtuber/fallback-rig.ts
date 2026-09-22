import * as THREE from 'three'
import { clamp01 } from './math.js'
import type { FallbackRig, MnVtuberPose } from './types.js'

export function createFallbackRig(): FallbackRig {
  const group = new THREE.Group()
  group.name = 'mn-vtuber-procedural-fallback'

  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c6cf, roughness: 0.64, metalness: 0 })
  const hair = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.82, metalness: 0.02 })
  const outfit = new THREE.MeshStandardMaterial({ color: 0x49636f, roughness: 0.72, metalness: 0.03 })
  const accent = new THREE.MeshStandardMaterial({ color: 0xd6a84f, roughness: 0.46, metalness: 0.08 })
  const eye = new THREE.MeshStandardMaterial({ color: 0x5f8fdc, roughness: 0.38, metalness: 0.04 })
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0x8a425d, roughness: 0.5, metalness: 0 })

  const chest = new THREE.Group()
  chest.name = 'mn-vtuber-fallback-chest'
  chest.position.set(0, 0.72, 0)
  group.add(chest)

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.42, 0.82, 24), outfit)
  torso.name = 'mn-vtuber-fallback-torso'
  torso.position.y = 0.18
  chest.add(torso)

  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.055, 0.055), accent)
  collar.name = 'mn-vtuber-fallback-collar'
  collar.position.set(0, 0.58, 0.23)
  chest.add(collar)

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.2, 18), skin)
  neck.name = 'mn-vtuber-fallback-neck'
  neck.position.y = 0.73
  chest.add(neck)

  const head = new THREE.Group()
  head.name = 'mn-vtuber-fallback-head'
  head.position.set(0, 1.54, 0)
  group.add(head)

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.285, 32, 24), skin)
  face.name = 'mn-vtuber-fallback-face'
  face.scale.set(0.94, 1.08, 0.9)
  head.add(face)

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.302, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), hair)
  cap.name = 'mn-vtuber-fallback-hair'
  cap.position.set(0, 0.085, 0.005)
  cap.scale.set(1.03, 0.92, 1)
  head.add(cap)

  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.033, 14, 8), eye)
  leftEye.name = 'mn-vtuber-fallback-left-eye'
  leftEye.position.set(-0.09, 0.02, 0.248)
  leftEye.scale.set(1, 0.72, 0.22)
  head.add(leftEye)

  const rightEye = leftEye.clone()
  rightEye.name = 'mn-vtuber-fallback-right-eye'
  rightEye.position.x = 0.09
  head.add(rightEye)

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.014), mouthMaterial)
  mouth.name = 'mn-vtuber-fallback-mouth'
  mouth.position.set(0, -0.112, 0.255)
  head.add(mouth)

  return { chest, group, head, leftEye, mouth, rightEye }
}

export function applyFallbackPose(
  rig: FallbackRig,
  pose: Required<MnVtuberPose>,
  elapsed: number,
): void {
  const head = pose.bones.head ?? { x: 0, y: 0, z: 0 }
  const chest = pose.bones.chest ?? { x: 0, y: 0, z: 0 }
  rig.head.rotation.set(head.x, head.y + pose.lookAt.x * 0.16, head.z)
  rig.chest.rotation.set(chest.x * 0.45, chest.y * 0.45, chest.z * 0.45)
  rig.group.position.y = Math.sin(elapsed * 1.28) * 0.012

  const blink = clamp01(pose.expressions.blink ?? 0)
  const eyeY = Math.max(0.08, 0.72 * (1 - blink))
  rig.leftEye.scale.y = eyeY
  rig.rightEye.scale.y = eyeY

  const mouth = clamp01(Math.max(pose.expressions.aa ?? 0, pose.expressions.oh ?? 0))
  rig.mouth.scale.set(1 + mouth * 0.18, 1 + mouth * 3.4, 1)
}
