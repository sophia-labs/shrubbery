/**
 * verdict.ts — the deterministic GAP CLASSIFIER (agent-as-subject, firstStep).
 *
 * The load-bearing reframe from the agent-as-subject design (plans/rhizome-agent-as-
 * subject-*): the agent's ANSWER is a State it holds about itself, and the GAP between
 * that answer and the GOLD is what makes it a SUBJECT THAT CAN BE WRONG — not a
 * flattering mirror. This is that reframe in its cheapest honest form: a PURE function
 * over data the Walk resource ALREADY carries (gold + finalAnswer). No new read path,
 * no @shrubbery/render Resource-union change, no write (WP5.2-safe), no LLM
 * (deterministic — a prose gold honestly abstains from judgement rather than guess).
 *
 * Numeric / short-factual golds are judged (number-equality / substring containment);
 * long prose golds are 'unjudged' — an honest non-claim, NOT a fake pass. A run that
 * produced no committed answer is 'non-converged'; a hedged answer is 'abstain'.
 *
 * NO MOCK: judges the agent's REAL verbatim finalAnswer against the REAL gold.
 */

export type VerdictState = 'match' | 'miss' | 'abstain' | 'non-converged' | 'unjudged'

export interface Verdict {
  readonly state: VerdictState
  /** The chip word — redundant with tone (never colour-only). */
  readonly label: string
  /** mn-chip tone (a valid MnTone). */
  readonly tone: 'success' | 'danger' | 'warning' | 'muted' | 'neutral'
  /** A registered lucide icon name for the chip glyph. */
  readonly glyph: string
  /** A one-line why (hover title) — honest about the deterministic basis. */
  readonly why: string
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}

/** Every number a text mentions, as digits AND spelled words, deduped. */
function numbersIn(text: string): Set<number> {
  const out = new Set<number>()
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(Number(m[0]))
  for (const [w, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text)) out.add(n)
  }
  return out
}

/** Hedge / abstention markers — the agent declined to commit a definite answer. */
const HEDGE =
  /\b(?:i (?:don'?t|do not) (?:have|know)|no (?:specific |relevant )?(?:memory|record|information)|cannot (?:determine|find|tell|recall)|can'?t (?:determine|find|tell|recall)|unable to|not (?:sure|certain|enough)|insufficient|couldn'?t find|don'?t have (?:a |any )?(?:memory|record))\b/i

/** The trace-world sentinels for a run that produced no committed answer. */
function isNonConverged(finalAnswer: string): boolean {
  return !finalAnswer.trim() || /no final answer|did not complete|running…|run did not/i.test(finalAnswer)
}

const norm = (s: unknown): string => (typeof s === 'string' ? s : String(s ?? '')).trim()

/**
 * Classify the gap between the agent's verbatim final answer and the gold.
 * Order: non-converged → abstain (hedged answer) → unjudged (prose gold) → match → miss.
 * Abstain precedes unjudged on purpose: a hedge is a true fact about the ANSWER
 * (the agent declined) independent of whether the GOLD is deterministically scoreable
 * — so an abstain on a prose-gold question reads 'abstained', not 'unjudged'. 'unjudged'
 * then means specifically: the agent COMMITTED an answer we can't deterministically score.
 */
export function classifyVerdict(goldRaw: unknown, finalRaw: unknown): Verdict {
  const gold = norm(goldRaw)
  const final = norm(finalRaw)

  if (isNonConverged(final)) {
    return { state: 'non-converged', label: 'no answer', tone: 'muted', glyph: 'help-circle', why: 'the run produced no committed final answer (hit the turn cap, errored, or is still running)' }
  }

  // A hedged answer didn't commit — surface that honestly even if a number leaks
  // (the count over-hedge is an abstain, not a hit), and regardless of gold type.
  if (HEDGE.test(final)) {
    return { state: 'abstain', label: 'abstained', tone: 'warning', glyph: 'alert-triangle', why: 'the agent hedged / declined to commit a definite answer' }
  }

  const goldNums = numbersIn(gold)
  const words = gold.split(/\s+/).filter(Boolean)
  const numeric = goldNums.size > 0
  // Short factual gold (a name, a place, yes/no) → substring-judgeable. A long prose
  // gold (preference text, an ordered narrative) the agent DID commit an answer to is
  // honestly NOT deterministically judgeable → 'unjudged' (waits for an LLM judge).
  const shortFactual = !numeric && words.length <= 5 && gold.length <= 40
  if (!numeric && !shortFactual) {
    return { state: 'unjudged', label: 'unjudged', tone: 'neutral', glyph: 'help', why: 'the agent committed an answer to a long prose gold — not deterministically judgeable without an LLM judge (open the run to read it)' }
  }

  if (numeric) {
    const answerNums = numbersIn(final)
    const hit = [...goldNums].some((n) => answerNums.has(n))
    const g = [...goldNums].join('/')
    return hit
      ? { state: 'match', label: 'correct', tone: 'success', glyph: 'check', why: `the answer states the gold value (${g})` }
      : { state: 'miss', label: 'wrong', tone: 'danger', glyph: 'x', why: `gold ${g} is not stated in the answer` }
  }

  // shortFactual: substring containment (strip trailing punctuation from the gold).
  const key = gold.replace(/[.?!,;:]+$/g, '').toLowerCase()
  const hit = key.length > 0 && final.toLowerCase().includes(key)
  return hit
    ? { state: 'match', label: 'correct', tone: 'success', glyph: 'check', why: `the answer contains the gold ("${key}")` }
    : { state: 'miss', label: 'wrong', tone: 'danger', glyph: 'x', why: `gold ("${key}") not found in the answer` }
}
