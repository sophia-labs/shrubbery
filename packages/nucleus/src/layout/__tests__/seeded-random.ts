/**
 * seeded-random.ts — a tiny deterministic PRNG for the operation-sequence
 * property test (validate.test.ts / operations.test.ts). `fast-check` is NOT
 * a devDependency of this package (checked against pnpm-lock.yaml before
 * writing this), so per the handoff instructions this is a small in-repo
 * seeded generator instead of an unseeded `Math.random()` — the SAME seed
 * always produces the SAME operation sequence, so a failing property test is
 * always reproducible.
 *
 * mulberry32 — a well-known 32-bit PRNG; public domain, small, deterministic.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SeededRandom {
  /** Next float in [0, 1). */
  readonly next: () => number
  /** Integer in [0, maxExclusive). */
  readonly nextInt: (maxExclusive: number) => number
  /** Pick a uniformly random element of a non-empty array. */
  readonly pick: <T>(items: readonly T[]) => T
  /** True with probability `p` (default 0.5). */
  readonly chance: (p?: number) => boolean
}

export function createSeededRandom(seed: number): SeededRandom {
  const rng = mulberry32(seed)
  const nextInt = (maxExclusive: number): number => Math.floor(rng() * maxExclusive)
  return {
    next: rng,
    nextInt,
    pick: <T>(items: readonly T[]): T => items[nextInt(items.length)],
    chance: (p = 0.5): boolean => rng() < p,
  }
}
