import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderPortrait, type RenderPortraitResult } from '../mirror.js'

/**
 * Real chromium, real vite dev server, real fixture, real GLTF/VRM parse —
 * no mocks anywhere. This is the S3 keystone oracle: the mirror must (a)
 * actually see the VRM, not silently fall back to the procedural rig, and
 * (b) respond to appearance changes with a genuinely different image.
 *
 * All three renders below share one beforeAll so the (expensive: real
 * chromium launch + real ~11MB VRM parse each) render count stays at
 * exactly 3 regardless of how many assertions read from them.
 */
// node:path + fileURLToPath(import.meta.url), NOT `new URL(rel, import.meta.url)`
// — see mirror.ts's HARNESS_DIR comment: this suite's happy-dom environment
// shadows the global URL constructor and silently mis-resolves a `file:` base.
const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(TEST_DIR, '..', '..', 'fixtures', 'vrm', 'seed-san.vrm')
const SIZE = { width: 320, height: 400 }
const RENDER_TIMEOUT_MS = 60_000

type DecodedPng = { width: number; height: number; data: Buffer }

function decode(png: Uint8Array): DecodedPng {
  return PNG.sync.read(Buffer.from(png))
}

/** Mean absolute per-channel difference across every pixel, 0..255. */
function meanAbsDiff(a: DecodedPng, b: DecodedPng): number {
  expect(a.width).toBe(b.width)
  expect(a.height).toBe(b.height)
  let sum = 0
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i])
  return sum / a.data.length
}

/** Population stddev of per-pixel-channel intensity — ~0 means a flat solid fill. */
function channelStdDev(png: DecodedPng): number {
  const { data } = png
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i]
  const mean = sum / data.length
  let variance = 0
  for (let i = 0; i < data.length; i++) variance += (data[i] - mean) ** 2
  return Math.sqrt(variance / data.length)
}

describe('renderPortrait — the Atelier mirror', () => {
  let renderA: RenderPortraitResult
  let renderARepeat: RenderPortraitResult
  let renderB: RenderPortraitResult

  beforeAll(async () => {
    renderA = await renderPortrait({
      modelPath: FIXTURE,
      size: SIZE,
      appearance: { outfitTint: '#c0392b' },
    })
    renderARepeat = await renderPortrait({
      modelPath: FIXTURE,
      size: SIZE,
      appearance: { outfitTint: '#c0392b' },
    })
    renderB = await renderPortrait({
      modelPath: FIXTURE,
      size: SIZE,
      appearance: { outfitTint: '#2980b9' },
    })
  }, RENDER_TIMEOUT_MS * 3)

  it('decodes to the requested dimensions and is not a solid color', () => {
    const decoded = decode(renderA.png)
    expect(decoded.width).toBe(SIZE.width)
    expect(decoded.height).toBe(SIZE.height)
    expect(renderA.width).toBe(SIZE.width)
    expect(renderA.height).toBe(SIZE.height)

    const stddev = channelStdDev(decoded)
    console.log(`[mirror.integration] channel stddev of a real render: ${stddev.toFixed(2)}`)
    // Observed ~54 on this fixture/camera-frame (studio floor + lighting +
    // avatar geometry) — 10 is a generous, still solidly-non-flat floor.
    expect(stddev).toBeGreaterThan(10)
  })

  it('reports a real VRM load, not the procedural fallback rig', () => {
    // All three renders share the same seed-san.vrm fixture (only appearance
    // differs) — check every one, not just renderA. renderB in particular
    // feeds the appearance-difference oracle below: if B silently fell back
    // to the procedural rig, that oracle could still see a large image diff
    // (fallback rig vs. real VRM) and pass for the wrong reason.
    for (const render of [renderA, renderARepeat, renderB]) {
      expect(render.status.status).toBe('ready')
      expect(render.status.error).toBeUndefined()
      expect(render.status.stats).toBeDefined()
      expect(render.status.stats?.meshCount).toBeGreaterThan(0)
      expect(render.status.stats?.visibleMeshCount).toBeGreaterThan(0)
    }
  })

  it('same inputs rendered twice differ by zero or near-zero', () => {
    const diff = meanAbsDiff(decode(renderA.png), decode(renderARepeat.png))
    console.log(`[mirror.integration] mean abs per-channel diff, identical inputs: ${diff.toFixed(3)}`)
    // Observed EXACTLY 0.000 across repeated runs on this machine — headless
    // Chromium's software (ANGLE) WebGL path is byte-for-byte deterministic
    // here for a static (animate=false) single-frame pose. Asserting a small
    // epsilon rather than strict 0 so this doesn't flake on a GPU/driver
    // combination with the tiny dithering some ANGLE backends apply.
    expect(diff).toBeLessThan(1.5)
  })

  it('outfitTint A vs B produce meaningfully different renders', () => {
    const diff = meanAbsDiff(decode(renderA.png), decode(renderB.png))
    console.log(`[mirror.integration] mean abs per-channel diff, outfitTint A vs B: ${diff.toFixed(3)}`)
    // Observed ~2.4 on this fixture: outfitTint only recolors materials whose
    // name matches CLOTH/TOP/BOTTOM/BODY (mn-vtuber/materials.ts) — on
    // seed-san.vrm that's `body_bake`/`body_nm`, a modest fraction of the
    // portrait-frame silhouette, not the whole figure. Real and reproducible,
    // just not dramatic — 1 is well above the identical-input floor (0.000)
    // and well below the observed value, so it stays a meaningful gate.
    expect(diff).toBeGreaterThan(1)
  })
})
