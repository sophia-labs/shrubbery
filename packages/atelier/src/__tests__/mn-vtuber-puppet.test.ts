import { describe, expect, it } from 'vitest'
import { buildMnVtuberPuppetPose } from '../mn-vtuber/puppet.js'

describe('mn-vtuber puppet steering', () => {
  it('maps manual head/chest/body steering into bone rotations', () => {
    const pose = buildMnVtuberPuppetPose({
      elapsed: 0,
      puppet: {
        bodyLean: 0.5,
        bodyYaw: 20,
        breath: 0,
        chest: { pitch: 8, yaw: -6, roll: 4 },
        head: { pitch: -10, yaw: 14, roll: 3 },
        idle: 0,
      },
    })

    expect(pose.bones?.head?.x).toBeCloseTo(-10 * Math.PI / 180)
    expect(pose.bones?.head?.y).toBeCloseTo(14 * Math.PI / 180)
    expect(pose.bones?.chest?.y).toBeCloseTo((-6 + 20 * 0.2) * Math.PI / 180)
    expect(pose.bones?.hips?.z).toBeCloseTo((0.5 * 2.8) * Math.PI / 180)
    expect(pose.root?.bodyYaw).toBeCloseTo(20 * Math.PI / 180)
  })

  it('mixes talk, smile, and strain into expression weights', () => {
    const pose = buildMnVtuberPuppetPose({
      elapsed: 0,
      puppet: {
        idle: 0,
        smile: 0.6,
        strain: 0.5,
        talk: 0.75,
      },
    })

    expect(pose.expressions?.aa).toBeCloseTo(0.75 * 0.62)
    expect(pose.expressions?.happy).toBeCloseTo(0.6 * 0.7)
    expect(pose.expressions?.angry).toBeCloseTo(0.5 * 0.36)
    expect(pose.expressions?.ih).toBeCloseTo(0.5 * 0.22)
  })

  it('adds gesture envelopes over the manual layer', () => {
    const hello = buildMnVtuberPuppetPose({
      elapsed: 0,
      puppet: {
        gesture: 'hello',
        gestureProgress: 0.25,
        gestureWeight: 1,
        idle: 0,
      },
    })

    expect(Math.abs(hello.bones?.rightUpperArm?.z ?? 0)).toBeGreaterThan(0.1)
    expect(Math.abs(hello.bones?.rightLowerArm?.z ?? 0)).toBeGreaterThan(0.1)
    expect(hello.expressions?.happy).toBeGreaterThan(0.4)
  })

  it('dance adds continuous root motion, hips, chest, arms, and cheerful expression', () => {
    const dance = buildMnVtuberPuppetPose({
      elapsed: 0,
      puppet: {
        gesture: 'dance',
        gestureProgress: 0.25,
        gestureWeight: 1,
        idle: 0,
      },
    })

    expect(Math.abs(dance.root?.x ?? 0)).toBeGreaterThan(0.02)
    expect(Math.abs(dance.root?.bodyYaw ?? 0)).toBeGreaterThan(0.04)
    expect(Math.abs(dance.bones?.hips?.z ?? 0)).toBeGreaterThan(0.1)
    expect(Math.abs(dance.bones?.chest?.z ?? 0)).toBeGreaterThan(0.1)
    expect(Math.abs(dance.bones?.leftUpperArm?.z ?? 0)).toBeGreaterThan(0.35)
    expect(Math.abs(dance.bones?.rightUpperArm?.z ?? 0)).toBeGreaterThan(0.35)
    expect(Math.abs(dance.bones?.leftLowerArm?.x ?? 0)).toBeGreaterThan(0.65)
    expect(Math.abs((dance.bones?.leftLowerArm?.x ?? 0) - (dance.bones?.rightLowerArm?.x ?? 0))).toBeGreaterThan(0.1)
    expect(dance.bones?.leftLowerArm?.z ?? 0).toBeLessThan(-0.45)
    expect(dance.bones?.rightLowerArm?.z ?? 0).toBeGreaterThan(0.45)
    expect(dance.expressions?.happy).toBeGreaterThan(0.4)
  })
})
