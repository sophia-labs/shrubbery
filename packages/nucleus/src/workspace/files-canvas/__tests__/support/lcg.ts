/**
 * A seeded linear congruential generator (Numerical Recipes constants). The repo has no
 * property-testing library; twenty lines of this are enough, and a failing seed replays exactly.
 */
export interface Rng {
  next(): number
  int(n: number): number
  range(lo: number, hi: number): number
  pick<T>(items: readonly T[]): T
  chance(p: number): boolean
  shuffle<T>(items: readonly T[]): T[]
}

export function lcg(seed: number): Rng {
  let s = seed >>> 0
  const next = (): number => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
  const int = (n: number): number => Math.floor(next() * n)
  return {
    next,
    int,
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (items) => items[int(items.length)]!,
    chance: (p) => next() < p,
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) { const j = int(i + 1); [out[i], out[j]] = [out[j]!, out[i]!] }
      return out
    },
  }
}

/** Run `body` for `count` seeds; a failure names the seed that broke it. */
export function forSeeds(count: number, body: (rng: Rng, seed: number) => void, base = 1): void {
  for (let i = 0; i < count; i++) {
    const seed = base + i * 7919
    try { body(lcg(seed), seed) } catch (error) {
      if (error instanceof Error) error.message = `[seed ${seed}] ${error.message}`
      throw error
    }
  }
}
