import { clamp, clamp01, rotationDeg } from './math.js'
import type {
  MnVtuberArmPuppet,
  MnVtuberGesture,
  MnVtuberPose,
  MnVtuberPuppetState,
  MnVtuberRootMotion,
  MnVtuberRotation,
} from './types.js'

export interface MnVtuberPuppetInput {
  elapsed: number
  puppet: MnVtuberPuppetState
}

export function buildMnVtuberPuppetPose(input: MnVtuberPuppetInput): MnVtuberPose {
  const puppet = input.puppet
  const pose = createPose()
  const elapsed = input.elapsed
  const idle = clamp01(puppet.idle ?? 1)
  const breath = clamp01(puppet.breath ?? 1)
  const bodyYaw = clamp(puppet.bodyYaw ?? 0, -45, 45)
  const bodyLean = clamp(puppet.bodyLean ?? 0, -1, 1)
  const chest = puppet.chest ?? {}
  const head = puppet.head ?? {}
  const breathWave = Math.sin(elapsed * 1.32) * breath
  const idleYaw = Math.sin(elapsed * 0.5) * 1.2 * idle
  const idlePitch = Math.sin(elapsed * 0.72 + 0.4) * 0.8 * idle

  addRoot(pose, { bodyYaw: degToRad(bodyYaw) })
  addBones(pose, {
    hips: rotationDeg(0, bodyYaw * 0.08, bodyLean * 2.8),
    spine: rotationDeg(0.8 + breathWave * 0.4, bodyYaw * 0.12, bodyLean * 3.4),
    chest: rotationDeg(
      clamp(chest.pitch ?? 0, -24, 24) + breathWave * 0.85,
      clamp(chest.yaw ?? 0, -30, 30) + bodyYaw * 0.2,
      clamp(chest.roll ?? 0, -24, 24) + bodyLean * 5.8,
    ),
    upperChest: rotationDeg(
      clamp(chest.pitch ?? 0, -24, 24) * 0.45 + breathWave * 0.5,
      clamp(chest.yaw ?? 0, -30, 30) * 0.42 + bodyYaw * 0.16,
      clamp(chest.roll ?? 0, -24, 24) * 0.44 + bodyLean * 4.2,
    ),
    head: rotationDeg(
      clamp(head.pitch ?? 0, -35, 35) + idlePitch,
      clamp(head.yaw ?? 0, -45, 45) + idleYaw,
      clamp(head.roll ?? 0, -30, 30) - bodyLean * 3.2,
    ),
  })

  addArmPose(pose, 'left', puppet.leftArm, elapsed)
  addArmPose(pose, 'right', puppet.rightArm, elapsed)

  const talk = clamp01(puppet.talk ?? 0)
  const smile = clamp01(puppet.smile ?? 0)
  const strain = clamp01(puppet.strain ?? 0)
  addExpressions(pose, {
    aa: talk * 0.62,
    happy: smile * 0.7,
    relaxed: Math.max(0, 0.16 * idle + smile * 0.18 - strain * 0.1),
    angry: strain * 0.36,
    ih: strain * 0.22,
  })

  addGesturePose(pose, puppet, elapsed)
  return pose
}

function addArmPose(
  pose: Required<MnVtuberPose>,
  side: 'left' | 'right',
  arm: MnVtuberArmPuppet | undefined,
  elapsed: number,
): void {
  if (!arm) return
  const sideSign = side === 'left' ? -1 : 1
  const raise = clamp01(arm.raise ?? 0)
  const spread = clamp(arm.spread ?? 0, -1, 1)
  const bend = clamp01(arm.bend ?? 0)
  const twist = clamp(arm.twist ?? 0, -1, 1)
  const wrist = clamp(arm.wrist ?? 0, -1, 1)
  const flutter = Math.sin(elapsed * 5.8) * raise * 0.8

  addBones(pose, {
    [`${side}Shoulder`]: rotationDeg(0, 0, sideSign * (raise * 2.5 + spread * 1.8)),
    [`${side}UpperArm`]: rotationDeg(
      -28 * raise,
      -sideSign * (12 * spread + 7 * twist),
      -sideSign * (28 * raise - 10 * spread) + flutter,
    ),
    [`${side}LowerArm`]: rotationDeg(-30 * bend - 8 * raise, -sideSign * twist * 6, sideSign * bend * 22),
    [`${side}Hand`]: rotationDeg(0, sideSign * wrist * 20 + flutter * 0.8, sideSign * wrist * 12),
  })
}

function addGesturePose(pose: Required<MnVtuberPose>, puppet: MnVtuberPuppetState, elapsed: number): void {
  const gesture: MnVtuberGesture = puppet.gesture ?? 'none'
  if (gesture === 'none') return

  const weight = clamp01(puppet.gestureWeight ?? 1)
  if (weight <= 0) return
  const progress = puppet.gestureProgress === undefined
    ? (elapsed * gestureSpeed(gesture)) % 1
    : clamp01(puppet.gestureProgress)
  const eased = actionEnvelope(progress) * weight
  const wave = Math.sin(progress * Math.PI * 8)
  const nod = Math.sin(progress * Math.PI * 4)
  const slow = Math.sin(progress * Math.PI * 2)

  switch (gesture) {
    case 'hello':
      addBones(pose, {
        head: rotationDeg(0, 4 * wave * eased, -3 * eased),
        rightUpperArm: rotationDeg(-10 * eased, -10 * eased, -33 * eased),
        rightLowerArm: rotationDeg(-4 * eased, 0, (29 + wave * 18) * eased),
        rightHand: rotationDeg(0, wave * 24 * eased, 0),
      })
      addExpressions(pose, { happy: 0.62 * eased, aa: 0.18 * Math.max(0, wave) * eased })
      break
    case 'nod':
      addBones(pose, { head: rotationDeg(12 * nod * eased, 0, 0) })
      addExpressions(pose, { aa: 0.14 * eased })
      break
    case 'nope':
      addBones(pose, { head: rotationDeg(0, 17 * nod * eased, -4 * Math.sin(progress * Math.PI * 4.4) * eased) })
      break
    case 'bow':
      addBones(pose, {
        chest: rotationDeg(23 * eased, 0, 0),
        upperChest: rotationDeg(9 * eased, 0, 0),
        head: rotationDeg(11 * eased, 0, 0),
      })
      addExpressions(pose, { relaxed: 0.35 * eased })
      break
    case 'surprise':
      addBones(pose, {
        head: rotationDeg(-8 * eased, 0, 0),
        leftUpperArm: rotationDeg(-8 * eased, 10 * eased, 24 * eased),
        rightUpperArm: rotationDeg(-8 * eased, -10 * eased, -24 * eased),
      })
      addExpressions(pose, { surprised: Math.min(1, 1.12 * eased), oh: 0.76 * eased })
      break
    case 'lookAround':
      addBones(pose, { head: rotationDeg(0, 10 * slow * eased, 5 * Math.sin(progress * Math.PI * 2.5) * eased) })
      addExpressions(pose, { happy: 0.15 * eased })
      pose.lookAt = {
        x: clamp((pose.lookAt?.x ?? 0) + 0.75 * slow * eased, -1, 1),
        y: clamp((pose.lookAt?.y ?? 0) + 0.18 * Math.sin(progress * Math.PI * 4) * eased, -1, 1),
      }
      break
    case 'dance': {
      const beat = progress * Math.PI * 2
      const side = Math.sin(beat)
      const counter = Math.sin(beat + Math.PI)
      const bounce = Math.max(0, Math.sin(beat * 2))
      const shoulder = Math.sin(beat * 2 + 0.4)
      const leftElbow = 0.5 + 0.5 * Math.sin(beat * 2 - 0.55)
      const rightElbow = 0.5 + 0.5 * Math.sin(beat * 2 + 0.55)
      const leftForearm = Math.sin(beat * 2 + 0.9)
      const rightForearm = Math.sin(beat * 2 - 0.9)
      const leftWrist = Math.sin(beat * 2 + 1.35)
      const rightWrist = Math.sin(beat * 2 - 1.35)
      const dance = weight
      addRoot(pose, {
        bodyYaw: degToRad(5.2 * side * dance),
        x: 0.035 * side * dance,
        y: 0.026 * bounce * dance,
      })
      addBones(pose, {
        hips: rotationDeg(2.4 * bounce * dance, 4.8 * side * dance, 7.2 * side * dance),
        spine: rotationDeg(1.4 * bounce * dance, -2.8 * side * dance, -4.8 * side * dance),
        chest: rotationDeg(2.8 * bounce * dance, -5.8 * side * dance, -9.2 * side * dance),
        upperChest: rotationDeg(1.6 * bounce * dance, -3.6 * side * dance, -6.2 * side * dance),
        head: rotationDeg((1.8 * bounce + 1.2 * Math.sin(beat * 2.5)) * dance, 3.8 * side * dance, 4 * counter * dance),
        leftShoulder: rotationDeg(0, 0, (2.2 + 1.6 * shoulder) * dance),
        rightShoulder: rotationDeg(0, 0, (-2.2 - 1.6 * shoulder) * dance),
        leftUpperArm: rotationDeg((-19 - 4 * bounce) * dance, (7 + 2 * side) * dance, (22 + 4 * side + 2.5 * leftElbow) * dance),
        rightUpperArm: rotationDeg((-19 - 4 * bounce) * dance, (-7 + 2 * counter) * dance, (-22 + 4 * counter - 2.5 * rightElbow) * dance),
        leftLowerArm: rotationDeg(
          (-24 - 21 * leftElbow - 3 * bounce) * dance,
          (5 - 7 * leftForearm) * dance,
          (-19 - 5 * side - 10 * leftElbow) * dance,
        ),
        rightLowerArm: rotationDeg(
          (-24 - 21 * rightElbow - 3 * bounce) * dance,
          (-5 - 7 * rightForearm) * dance,
          (19 - 5 * counter + 10 * rightElbow) * dance,
        ),
        leftHand: rotationDeg((-8 - 5 * leftElbow) * dance, (-9 + 9 * leftWrist) * dance, (7 + 5 * counter + 4 * leftForearm) * dance),
        rightHand: rotationDeg((-8 - 5 * rightElbow) * dance, (9 + 9 * rightWrist) * dance, (-7 + 5 * side - 4 * rightForearm) * dance),
      })
      addExpressions(pose, {
        aa: (0.08 + 0.08 * bounce) * dance,
        happy: 0.48 * dance,
        relaxed: 0.18 * dance,
      })
      pose.lookAt = {
        x: clamp((pose.lookAt?.x ?? 0) + 0.18 * side * dance, -1, 1),
        y: clamp((pose.lookAt?.y ?? 0) + 0.06 * Math.sin(beat * 2 + 0.6) * dance, -1, 1),
      }
      break
    }
  }
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

function actionEnvelope(progress: number, attack = 0.16, release = 0.18): number {
  return Math.min(smoothstep(0, attack, progress), smoothstep(1, 1 - release, progress))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function gestureSpeed(gesture: MnVtuberGesture): number {
  switch (gesture) {
    case 'dance':
      return 0.72
    case 'hello':
      return 0.22
    case 'lookAround':
      return 0.16
    case 'bow':
      return 0.28
    default:
      return 0.34
  }
}

function degToRad(value: number): number {
  return value * Math.PI / 180
}
