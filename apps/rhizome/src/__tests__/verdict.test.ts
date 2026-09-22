/**
 * verdict.test.ts — the deterministic GAP CLASSIFIER against REAL run data (NO MOCK).
 *
 * Vera's standing rule: test the real function against real inputs. Every (gold,
 * finalAnswer) pair below is a VERBATIM answer an actual agentic run produced this
 * campaign (the Korean-restaurant count, the projects over/under-count, the world-arm
 * over-hedge, a non-converged run, a prose-preference gold, a KU place answer, a
 * date-sum). The classifier must read them the way a human reading the run would.
 */

import { describe, expect, it } from 'vitest'
import { classifyVerdict } from '../verdict.js'

describe('classifyVerdict — real run answers', () => {
  it('numeric/word gold MATCH: Korean restaurants → "four"', () => {
    const v = classifyVerdict('four', 'Based on my memory, you have tried **four** Korean restaurants in your city so far.')
    expect(v.state).toBe('match')
    expect(v.tone).toBe('success')
  })

  it('numeric gold MISS: projects gold 2, full-haystack over-counted to 4', () => {
    const v = classifyVerdict(2, 'Based on my retrieval from durable memory, I found **4 distinct projects** ... **Answer: 4**')
    expect(v.state).toBe('miss')
    expect(v.tone).toBe('danger')
  })

  it('numeric gold MISS: projects gold 2, evidence-only under-counted to 1', () => {
    const v = classifyVerdict(2, 'Based on my durable memory, you have led **1 project** — the Marketing Research class project.')
    expect(v.state).toBe('miss')
  })

  it('hedged answer ABSTAINS even if a number leaks (the world-arm over-hedge)', () => {
    const v = classifyVerdict('four', 'I cannot determine precisely how many Korean restaurants you have tried in your city.')
    expect(v.state).toBe('abstain')
    expect(v.tone).toBe('warning')
  })

  it('non-converged run (the trace-world sentinel) → no answer', () => {
    const v = classifyVerdict(2, '(no final answer — run did not complete)')
    expect(v.state).toBe('non-converged')
  })

  it('in-progress run (the running… sentinel) → no answer', () => {
    const v = classifyVerdict(2, '(running… 203 turns so far — refresh to follow)')
    expect(v.state).toBe('non-converged')
  })

  it('temporal abstain: chandelier weeks-ago, no temporal anchor', () => {
    const v = classifyVerdict(4, "I don't have a memory of a specific event where you received the crystal chandelier with a date attached.")
    expect(v.state).toBe('abstain')
  })

  it('short factual gold MATCH by substring: KU place → "the suburbs"', () => {
    const v = classifyVerdict('the suburbs', 'After her recent relocation, Rachel moved to the suburbs.')
    expect(v.state).toBe('match')
  })

  it('short factual gold MISS by substring', () => {
    const v = classifyVerdict('Business Administration', 'You graduated with a degree in Computer Science.')
    expect(v.state).toBe('miss')
  })

  it('date-sum gold MATCH: "8 days." with the number present', () => {
    const v = classifyVerdict('8 days.', 'You spent 8 days on camping trips in the United States.')
    expect(v.state).toBe('match')
  })

  it('long prose gold with a COMMITTED answer is honestly UNJUDGED, never a fake pass', () => {
    const v = classifyVerdict(
      'The user would prefer suggestions of hotels that are centrally located and have good reviews.',
      'I recommend the Mandarin Oriental — centrally located with excellent reviews.',
    )
    expect(v.state).toBe('unjudged')
    expect(v.tone).toBe('neutral')
  })

  it('ABSTAIN beats UNJUDGED: a hedged answer to a prose gold reads abstained (real preference run)', () => {
    const v = classifyVerdict(
      'The user would prefer suggestions of hotels for their upcoming trip to Miami.',
      "I don't have any memory about an upcoming trip to Miami or a stored hotel preference.",
    )
    expect(v.state).toBe('abstain')
  })

  it('multi-acceptable temporal gold matches ANY of its numbers', () => {
    const v = classifyVerdict('6 days. 7 days (including the last day)', 'About 7 days passed, including the last day.')
    expect(v.state).toBe('match')
  })
})
