import * as THREE from 'three'
import type { MnVtuberRotation } from './types.js'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

export function rotationDeg(x = 0, y = 0, z = 0): MnVtuberRotation {
  const toRad = Math.PI / 180
  return { x: x * toRad, y: y * toRad, z: z * toRad }
}

export function colorFromHex(value: string | undefined): THREE.Color | null {
  if (!value) return null
  try {
    return new THREE.Color(value)
  } catch {
    return null
  }
}

export function warmSkinColor(warmth: number | undefined): THREE.Color | null {
  if (warmth === undefined) return null
  const base = new THREE.Color('#f1c6cf')
  const warm = new THREE.Color('#ffd0b1')
  const cool = new THREE.Color('#dfc7ed')
  return warmth >= 0
    ? base.lerp(warm, Math.min(warmth, 1) * 0.42)
    : base.lerp(cool, Math.min(Math.abs(warmth), 1) * 0.34)
}

export function isNearlyWhite(color: THREE.Color): boolean {
  return color.r > 0.94 && color.g > 0.94 && color.b > 0.94
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
