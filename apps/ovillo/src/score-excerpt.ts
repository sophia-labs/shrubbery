/**
 * score-excerpt.ts — the first bars of a MUS score, as a score.
 *
 * A render is the World simulated in the page: about a minute for a 30-second
 * piece. So the score editor offers the first few bars too: the score's header
 * (title, tempo, the instruments and hands, every `#` line before the first bar)
 * and its first `bars` bar lines, with the comment lines between them; the
 * header's `bars: N` (which sets how long the World plays) says the new count.
 * Nothing else changes: the excerpt checks against the same World and renders on it.
 */

const BAR = /^bar\s+(\d+)\b/

/** How many bar lines a score has. */
export function barCount(score: string): number {
  return score.split('\n').filter((line) => BAR.test(line.trim())).length
}

/** The score cut after its first `bars` bars (the whole score when it has no more). */
export function excerptScore(score: string, bars: number): string {
  const lines = score.split('\n')
  const out: string[] = []
  let seen = 0
  const total = barCount(score)
  const keep = Math.max(1, Math.min(bars, total))
  for (const line of lines) {
    if (BAR.test(line.trim())) {
      if (seen >= keep) break
      seen++
    }
    out.push(seen === 0 && /^#/.test(line) ? line.replace(/\bbars:\s*\d+/, `bars: ${keep}`) : line)
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return `${out.join('\n')}\n`
}
