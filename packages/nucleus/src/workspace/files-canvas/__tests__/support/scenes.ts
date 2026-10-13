import type { FileCanvasInput } from '../../../folder-view-contract.js'
import { buildScene, CARD_METRICS } from '../../scene.js'
import type { SceneSnapshot } from '../../engine-port.js'
import { rectsIntersect, type Rect } from '../../geometry.js'
import { connection, file, folder, inputOf, type Spec } from './fixtures.js'
import type { Rng } from './lcg.js'

const M = CARD_METRICS.medium

/** Cards on a jittered lattice: the shape of a folder a person has arranged. Cards never overlap. */
export function latticeSpecs(rng: Rng, cols: number, rows: number, opts: { jitter?: number; folders?: number } = {}): Spec[] {
  const jitter = opts.jitter ?? 7
  const specs: Spec[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    specs.push({
      id: `f${r}-${c}`, folder: rng.chance(opts.folders ?? 0.2),
      x: 16 + c * (M.w + 16) + Math.round(rng.range(-jitter, jitter)),
      y: 16 + r * (M.h + 16) + Math.round(rng.range(-jitter, jitter)),
    })
  }
  return specs
}

/** Cards scattered at random without overlapping (rejection sampling); fewer than `n` if the area is too crowded. */
export function scatterSpecs(rng: Rng, n: number, width: number, height: number, opts: { folders?: number } = {}): Spec[] {
  const rects: Rect[] = []
  const specs: Spec[] = []
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const rect = { x: Math.round(rng.range(0, width - M.w)), y: Math.round(rng.range(0, height - M.h)), w: M.w, h: M.h }
      if (rects.some((other) => rectsIntersect(rect, other))) continue
      rects.push(rect)
      specs.push({ id: `s${i}`, folder: rng.chance(opts.folders ?? 0.2), x: rect.x, y: rect.y })
      break
    }
  }
  return specs
}

/** Cards that may overlap anywhere: the worst case a person can drag a folder into. */
export function pileSpecs(rng: Rng, n: number, width: number, height: number, opts: { folders?: number } = {}): Spec[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, folder: rng.chance(opts.folders ?? 0.2), x: Math.round(rng.range(0, width - M.w)), y: Math.round(rng.range(0, height - M.h)),
  }))
}

/** `count` connections between random distinct cards, with labels of varying length. */
export function connectionsFor(rng: Rng, specs: readonly Spec[], count: number): FileCanvasInput['connections'] {
  if (specs.length < 2) return []
  const labels = ['explains', 'qualifies', 'contradicts', 'supports', 'depends on', 'is a superseded draft of']
  return Array.from({ length: count }, (_, i) => {
    const a = rng.int(specs.length)
    let b = rng.int(specs.length - 1)
    if (b >= a) b++
    const pick = (s: Spec) => (s.folder ? folder(s.id) : file(s.id))
    return connection(`c${i}`, pick(specs[a]!), pick(specs[b]!), rng.pick(labels))
  })
}

export function randomScene(specs: readonly Spec[], connections: FileCanvasInput['connections'] = []): SceneSnapshot {
  return buildScene(inputOf(specs, { connections })).scene
}
