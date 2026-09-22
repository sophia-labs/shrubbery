import { clamp, clamp01, rotationDeg } from './math.js'
import { buildMnVtuberPuppetPose } from './puppet.js'
import type { MnVtuberPose, MnVtuberPoseInput, MnVtuberRootMotion, MnVtuberRotation } from './types.js'

export function buildMnVtuberPose(input: MnVtuberPoseInput): Required<MnVtuberPose> {
  const pose = createPose()
  const expressionPreset = input.expressionPreset ?? 'focused'
  const breath = Math.sin(input.elapsed * 1.28)
  const sway = Math.sin(input.elapsed * 0.52)

  addBones(pose, {
    hips: rotationDeg(0, sway * 0.7, sway * 0.4),
    spine: rotationDeg(1.2 + breath * 0.45, sway * 0.45, -sway * 0.28),
    chest: rotationDeg(2.0 + breath * 0.7, sway * 0.72, -sway * 0.36),
    upperChest: rotationDeg(1.2 + breath * 0.38, sway * 0.36, -sway * 0.22),
    head: rotationDeg(
      Math.sin(input.elapsed * 0.74 + 0.5) * 1.1,
      Math.sin(input.elapsed * 0.45) * 2.2,
      Math.sin(input.elapsed * 0.33) * 0.55,
    ),
    leftShoulder: rotationDeg(0, 0, -4),
    rightShoulder: rotationDeg(0, 0, 4),
    leftUpperArm: rotationDeg(7 + breath * 0.4, 1.5, -58 + sway * 1.4),
    rightUpperArm: rotationDeg(7 + breath * 0.4, -1.5, 58 - sway * 1.4),
    leftLowerArm: rotationDeg(-7, 0, -8),
    rightLowerArm: rotationDeg(-7, 0, 8),
    leftHand: rotationDeg(0, Math.sin(input.elapsed * 0.8) * 1.8, -7),
    rightHand: rotationDeg(0, Math.sin(input.elapsed * 0.8 + 1.1) * 1.8, 7),
    leftUpperLeg: rotationDeg(2, 0, -2),
    rightUpperLeg: rotationDeg(2, 0, 2),
    leftLowerLeg: rotationDeg(-2, 0, 0),
    rightLowerLeg: rotationDeg(-2, 0, 0),
    leftFoot: rotationDeg(1, 0, -2),
    rightFoot: rotationDeg(1, 0, 2),
  })

  const mouth = clamp01(Math.max(input.mouth ?? 0, input.overlay?.mouth ?? 0))
  const blink = clamp01(Math.max(input.blink ?? 0, input.overlay?.blink ?? 0, autoBlinkValue(input.elapsed)))
  addExpressions(pose, {
    aa: mouth * 0.72,
    blink,
    blinkLeft: blink,
    blinkRight: blink,
    relaxed: expressionPreset === 'neutral' ? 0.24 : 0.14,
  })

  if (expressionPreset === 'focused') addExpressions(pose, { ih: 0.06, relaxed: 0.06 })
  if (expressionPreset === 'excited') addExpressions(pose, { happy: 0.36, aa: Math.max(0.08, mouth * 0.22) })
  if (expressionPreset === 'strained') addExpressions(pose, { angry: 0.22, ih: 0.18 })

  pose.lookAt = {
    x: clamp(input.lookX ?? 0, -1, 1) + Math.sin(input.elapsed * 0.34) * 0.05,
    y: clamp(input.lookY ?? 0, -1, 1) + Math.sin(input.elapsed * 0.41 + 0.6) * 0.035,
  }

  if (input.puppet) {
    const puppetPose = buildMnVtuberPuppetPose({ elapsed: input.elapsed, puppet: input.puppet })
    addRoot(pose, puppetPose.root)
    addBones(pose, puppetPose.bones ?? {})
    addExpressions(pose, puppetPose.expressions ?? {})
    if (puppetPose.lookAt) {
      pose.lookAt.x += clamp(puppetPose.lookAt.x, -1, 1)
      pose.lookAt.y += clamp(puppetPose.lookAt.y, -1, 1)
    }
  }

  if (input.overlay) {
    addRoot(pose, input.overlay.root)
    addBones(pose, input.overlay.bones ?? {})
    addExpressions(pose, input.overlay.expressions ?? {})
    if (input.overlay.lookAt) {
      pose.lookAt.x += clamp(input.overlay.lookAt.x, -1, 1)
      pose.lookAt.y += clamp(input.overlay.lookAt.y, -1, 1)
    }
  }

  pose.lookAt.x = clamp(pose.lookAt.x, -1, 1)
  pose.lookAt.y = clamp(pose.lookAt.y, -1, 1)
  return pose
}

function createPose(): Required<MnVtuberPose> {
  return { blink: 0, bones: {}, expressions: {}, lookAt: { x: 0, y: 0 }, mouth: 0, root: {} }
}

function addRoot(pose: Required<MnVtuberPose>, root: MnVtuberRootMotion | undefined): void {
  if (!root) return
  pose.root = {
    bodyYaw: (pose.root.bodyYaw ?? 0) + (root.bodyYaw ?? 0),
    x: (pose.root.x ?? 0) + (root.x ?? 0),
    y: (pose.root.y ?? 0) + (root.y ?? 0),
    z: (pose.root.z ?? 0) + (root.z ?? 0),
  }
}

function addBones(pose: Required<MnVtuberPose>, bones: Record<string, MnVtuberRotation>): void {
  for (const [name, rotation] of Object.entries(bones)) {
    const current = pose.bones[name] ?? { x: 0, y: 0, z: 0 }
    pose.bones[name] = {
      x: current.x + rotation.x,
      y: current.y + rotation.y,
      z: current.z + rotation.z,
    }
  }
}

function addExpressions(pose: Required<MnVtuberPose>, expressions: Record<string, number>): void {
  for (const [name, value] of Object.entries(expressions)) {
    pose.expressions[name] = clamp01((pose.expressions[name] ?? 0) + value)
  }
}

function autoBlinkValue(time: number): number {
  const phase = time % 3.8
  if (phase > 0.15) return 0
  return Math.sin((phase / 0.15) * Math.PI)
}
