/**
 * grow-turn-driver.ts — the DETERMINISTIC GROW-DRIVER (RUNG N0a).
 *
 * This is the LOCAL-N0 swap for the default ECHO turnDriver: a REAL, deterministic
 * responder that turns a small fixed set of natural-language phrases into a
 * STRUCTURAL grow of the live cell's interface. It is NOT a mock and NOT a stub —
 * on a phrase match it calls the REAL `grow(port, graphId, verbSpec)` (the same
 * host-side GROW cycle the choreograph C4 tool will wrap), which writes an additive
 * delta into the cell's :ux:config named graph. The atelier's existing
 * startPoll(3000) re-reads that graph within ≤3s and the canvas GROWS.
 *
 * The C4 swap (Linux-gated) replaces this fixed phrase→VerbSpec map with a real
 * LLM (ChoreographChatBackend NL→VerbSpec) — but it calls the IDENTICAL grow().
 * The catalog + spine + additive gates live in grow(), once; this driver only
 * decides WHICH verb a phrase means and narrates the result as ChatEvents.
 *
 * SHAPE: `makeGrowTurnDriver(port, graphId)` returns a `TurnDriver`
 * (`(userText) => AsyncIterable<ChatEvent>`). The returned generator is an
 * `async function*` because grow() is async with a real side effect — it AWAITS
 * grow() between yields:
 *
 *   MATCH:    turn_start
 *           → tool_call(gate:'grow_interface', args=verbSpec)
 *           → await grow(port, graphId, verbSpec)
 *           → tool_result(gate:'grow_interface', result, is_error)
 *           → text (a human ack)
 *           → done
 *
 *   NO MATCH: turn_start → text (a friendly capability list) → done
 *
 * Exactly ONE terminal `done` is emitted (the local-chat-service events() loop
 * breaks on the first terminal event).
 *
 * No vi.fn anywhere: the driver is a plain async generator; the port it closes
 * over is the shell's real GardendContract-backed GrowCell.
 */

import type { ChatEvent } from '@shrubbery/chat-kernel'
import type { VerbSpec } from '@shrubbery/nucleus'
import { grow, type GrowCell } from '../grow/grow.js'
import type { TurnDriver } from './local-chat-service.js'

/** One entry in the fixed phrase→VerbSpec catalog: the phrases that trigger it,
 * the verb to grow, and a human noun for the ack ("a top bar"). */
interface GrowIntent {
  /** Lower-cased phrases that match this intent (exact, post-normalization). */
  readonly phrases: readonly string[]
  /** The structural verb to grow (a member of the CLOSED VerbSpec union). */
  readonly verbSpec: VerbSpec
  /** A human noun for the acknowledgement text ("a top bar", "a footer", …). */
  readonly noun: string
}

/**
 * THE FIXED INTENT CATALOG — a small set of phrases over KNOWN_COMPONENTS chrome
 * that RENDER. Each is a single additive `add_root_region` (the W0-proven grow):
 * one resizable content root already exists (the seed), so these non-resizable
 * chrome bars are safe additive roots that pass the spine I1 invariant.
 */
const INTENTS: readonly GrowIntent[] = [
  {
    phrases: ['give me a top bar', 'add a top bar', 'add a header', 'give me a header'],
    verbSpec: { verb: 'add_root_region', regionId: 'region-top-bar', component: 'mn-top-bar' },
    noun: 'a top bar',
  },
  {
    phrases: ['add a bottom bar', 'give me a bottom bar', 'add a footer', 'give me a footer'],
    verbSpec: { verb: 'add_root_region', regionId: 'region-bottom-bar', component: 'mn-bottom-bar' },
    noun: 'a bottom bar',
  },
  {
    phrases: ['add an app bar', 'give me an app bar', 'add a nav bar', 'give me a nav bar'],
    verbSpec: { verb: 'add_root_region', regionId: 'region-app-bar', component: 'mn-app-bar' },
    noun: 'an app bar',
  },
]

/** Normalize user text for matching: trim, collapse whitespace, strip a trailing
 * punctuation run, lower-case. ("Give me a top bar!" → "give me a top bar".) */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[!.?\s]+$/u, '')
    .toLowerCase()
}

/** Find the intent (if any) whose phrase set contains the normalized text. */
function matchIntent(userText: string): GrowIntent | undefined {
  const norm = normalize(userText)
  return INTENTS.find((intent) => intent.phrases.includes(norm))
}

/** The friendly capability list for a NO-match turn — what the driver CAN add. */
function capabilityList(): string {
  const examples = INTENTS.map((i) => `“${i.phrases[0]}” → ${i.noun}`).join('; ')
  return (
    `I can grow your interface. Try one of: ${examples}. ` +
    `Each one writes to the cell's :ux:config and your canvas grows on the next poll.`
  )
}

/**
 * Build the deterministic GROW turn driver over a real cell port + graphId.
 *
 * The returned `TurnDriver` closure captures the port + graphId; on each turn it
 * matches the text against the fixed catalog and either grows the interface (the
 * real side effect + a narrated tool call) or returns the capability list.
 */
export function makeGrowTurnDriver(port: GrowCell, graphId: string): TurnDriver {
  return function growTurnDriver(userText: string): AsyncIterable<ChatEvent> {
    return drive(port, graphId, userText)
  }
}

/** The actual async event stream for one turn (kept separate so the closure above
 * stays a thin curry over it — easier to read + to unit-test directly). */
async function* drive(port: GrowCell, graphId: string, userText: string): AsyncIterable<ChatEvent> {
  yield { type: 'turn_start', turn: 0 }

  const intent = matchIntent(userText)
  if (!intent) {
    // NO MATCH — a friendly capability list, then the single terminal done.
    const help = capabilityList()
    yield { type: 'text', content: help }
    yield { type: 'done', output: help }
    return
  }

  // MATCH — narrate the tool call, then run the REAL grow side effect.
  const { verbSpec, noun } = intent
  yield {
    type: 'tool_call',
    gate: 'grow_interface',
    args: { ...verbSpec },
  }

  // grow() THROWS only for a non-additive candidate (impossible for these additive
  // add_root_region verbs); catalog/spine rejections come back as { ok:false }. We
  // still guard the await so a transport failure surfaces as a tool error, not an
  // unhandled rejection that strands the turn with no terminal event.
  let resultText: string
  let isError: boolean
  let ackText: string
  try {
    const result = await grow(port, graphId, verbSpec)
    if (result.ok) {
      isError = false
      resultText = JSON.stringify({ ok: true, delta: result.delta })
      // grow() returned ok → the additive write landed in :ux:config. (A grow that
      // adds no new triples — an empty delta — is still ok; the next poll re-read is
      // simply a no-op for the DOM. We narrate a successful grow either way.)
      ackText =
        result.delta.trim().length === 0
          ? `${noun} is already there — nothing new to grow.`
          : `Done — added ${noun}; your interface just grew.`
    } else {
      isError = true
      resultText = `${result.gate}: ${result.error}`
      ackText = `I couldn't add ${noun} — the ${result.gate} gate rejected it: ${result.error}`
    }
  } catch (e) {
    isError = true
    const msg = e instanceof Error ? e.message : String(e)
    resultText = msg
    ackText = `I couldn't add ${noun} — the grow failed: ${msg}`
  }

  yield {
    type: 'tool_result',
    gate: 'grow_interface',
    result: resultText,
    is_error: isError,
  }
  yield { type: 'text', content: ackText }
  yield { type: 'done', output: ackText }
}
