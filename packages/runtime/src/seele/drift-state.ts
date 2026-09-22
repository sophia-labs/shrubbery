/**
 * drift-state.ts — the wax seal's v1 state, and nothing more (W9.1b, D18).
 *
 * FIVE STATES, MAXIMUM, BY CONSTRUCTION. D18 chose option (iii): v1 depicts
 * NO persistence at all, because on the hosted `<sh-editor-host>` path there
 * is no save call, no `saveState`, and no durability acknowledgment to depict
 * one from (C17). `saving`/`saved` are therefore absent from this union — not
 * "not implemented yet", ABSENT — and W9.3's forbidden-depiction rule is
 * enforced structurally: a renderer switching exhaustively over `DriftState`
 * has no durability arm to write, and adding one to the union breaks every
 * exhaustive consumer rather than shipping a quiet lie.
 *
 * There is likewise NO warning tier. `Severity::Warning` is never constructed
 * anywhere in nature (C5) — the chip has errors, or it has a seal.
 *
 * WHAT THE SEAL COVERS: the canonical dataset, never the source bytes. The
 * `contractHash` nature returns is
 * `sha256("nature:contract:v1" ‖ compiler-version ‖ vocab-digest ‖ canonical)`
 * — provably distinct from `sourceDigest`, which is a plain hash of the YAML.
 * This module never computes either; it only decides which of five things the
 * chip may say about the ones it was handed.
 *
 * SOURCE IDENTITY IS COMPARED BY BYTES, NOT BY DIGEST. W9.1a's `typedDigest`
 * is `sha256(projected source)`, compared against the report's
 * `compiledSourceDigest`. v1 holds the projected source string itself
 * alongside the report, so it compares the strings directly — the same
 * question, answered exactly rather than probabilistically, with no
 * `crypto.subtle` async hop on every keystroke. `sourceDigest` from the report
 * remains available for DISPLAY; it is not the drift oracle here.
 */

import { countCompileErrors, type SeeleCompileReport } from './compile-seam.js'

/**
 * The v1 wax seal. Exhaustive; five members; no persistence arm; no warning
 * arm. See this module's header before adding a sixth.
 */
export type DriftState =
  /** The source has changed and nothing has been asked of the compiler yet. */
  | { readonly kind: 'typing' }
  /** A compile is in flight for the current source. */
  | { readonly kind: 'compiling' }
  /** A clean compile of exactly these bytes. The hash and the version are BOTH shown (C21). */
  | { readonly kind: 'sealed'; readonly contractHash: string; readonly compilerVersion: string }
  /** The compiler refused these bytes. Never carries a hash. */
  | { readonly kind: 'refused'; readonly errorCount: number }
  /** A settled report exists, but it describes bytes other than the ones on screen. */
  | { readonly kind: 'drifted' }

/** Every legal `DriftState.kind` — the closed set a renderer must handle. */
export const DRIFT_STATE_KINDS = ['typing', 'compiling', 'sealed', 'refused', 'drifted'] as const

export interface DriftStateInputs {
  /** The source currently projected out of the document, or null when there is none to seal. */
  readonly source: string | null
  /** A debounce window is open — a change has arrived that the compiler has not been asked about yet. */
  readonly pending: boolean
  /** A compile is in flight. */
  readonly inFlight: boolean
  /** The last APPLIED report, and the exact source it was compiled from. */
  readonly report: SeeleCompileReport | null
  readonly compiledSource: string | null
}

/**
 * Pure. `null` means "there is nothing to seal" — the document holds no single
 * `seele` fence, so the chip is ABSENT rather than depicting a state it cannot
 * justify. That is the honest reading of D18's five-state cap: five is the
 * maximum number of things the chip may SAY, not a requirement that it always
 * say one of them.
 *
 * Order matters, and it is the order of what a human would want told first:
 * a pending/in-flight compile supersedes any older verdict, and a report about
 * different bytes is `drifted` even when that report was itself clean — a
 * `contractHash` present with a mismatched source is NEVER `sealed` (W9.1a's
 * must-be-impossible row).
 */
export function deriveDriftState(inputs: DriftStateInputs): DriftState | null {
  const { source, pending, inFlight, report, compiledSource } = inputs
  if (source === null) return null
  if (pending) return { kind: 'typing' }
  if (inFlight) return { kind: 'compiling' }
  if (report === null || compiledSource === null) return { kind: 'typing' }
  if (compiledSource !== source) return { kind: 'drifted' }
  if (report.clean && report.contractHash !== null) {
    return { kind: 'sealed', contractHash: report.contractHash, compilerVersion: report.compilerVersion }
  }
  // Not clean → refused. Clean-but-hashless cannot be sealed and is not a
  // refusal either; it is a report we cannot vouch for, which is drift in the
  // only sense the chip has words for.
  if (!report.clean) return { kind: 'refused', errorCount: countCompileErrors(report) }
  return { kind: 'drifted' }
}

/**
 * The chip's short human label. Deliberately terse and deliberately
 * hash-prefixed rather than hash-complete — the full hash is rendered beside
 * the chip by the pane, where it can be selected and copied.
 */
export function describeDriftState(state: DriftState): string {
  switch (state.kind) {
    case 'typing':
      return 'typing'
    case 'compiling':
      return 'compiling…'
    case 'sealed':
      return `sealed ${state.contractHash.slice(0, 12)} · nature ${state.compilerVersion}`
    case 'refused':
      return `refused — ${state.errorCount} ${state.errorCount === 1 ? 'error' : 'errors'}`
    case 'drifted':
      return 'drifted'
  }
}
