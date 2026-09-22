/**
 * salience-bundle-service.ts — read-side per-document block scores + the pure
 * display/cycling helpers the gutter UI needs.
 *
 * Unlike wires, this is NOT a SPARQL read over a projection graph: compositeScore
 * and the wire-count fields are computed at query time from the cell's value
 * store + a wire cross-reference (garden salience_score_projection.rs), never
 * materialized as RDF triples — so the read goes through the contract's
 * `SalienceService.getScores` seam (a raw loopback REST call on the shell side),
 * mirroring wire-bundle-service.ts's shape but sourced from the contract instead
 * of `RestClient`.
 *
 * The cycling/threshold/label constants below are ported verbatim from the OG
 * frontend's ValuationController (mnemosyne-platform/frontend/src/controllers/
 * valuation-controller.ts) — same constants, same veto logic, same calibrated
 * thresholds. Nine months of git history there fixed real bugs in this exact
 * math; this is a port, not a reinterpretation.
 */

import type { BlockScore, EditorScope, SalienceService } from '@shrubbery/nucleus'

export interface SalienceBundle {
  readonly scores: ReadonlyMap<string, BlockScore>
}

export interface SalienceScoreCheckpoint {
  readonly bundleWasNull: boolean
  readonly hadScore: boolean
  readonly score: BlockScore | undefined
}

export const EMPTY_SALIENCE_BUNDLE: SalienceBundle = { scores: new Map() }

/** Capture only the block-local state needed to undo one optimistic write. */
export function captureSalienceScore(
  bundle: SalienceBundle | null,
  blockId: string,
): SalienceScoreCheckpoint {
  return {
    bundleWasNull: bundle === null,
    hadScore: bundle?.scores.has(blockId) ?? false,
    score: bundle?.scores.get(blockId),
  }
}

/** Replace one score without disturbing concurrent ratings on other blocks. */
export function withSalienceScore(
  bundle: SalienceBundle | null,
  score: BlockScore,
): SalienceBundle {
  const scores = new Map(bundle?.scores ?? [])
  scores.set(score.blockId, score)
  return { scores }
}

/** Restore one failed optimistic write while preserving newer unrelated work. */
export function rollbackSalienceScore(
  bundle: SalienceBundle | null,
  blockId: string,
  checkpoint: SalienceScoreCheckpoint,
): SalienceBundle | null {
  const scores = new Map(bundle?.scores ?? [])
  if (checkpoint.hadScore && checkpoint.score) scores.set(blockId, checkpoint.score)
  else scores.delete(blockId)
  return checkpoint.bundleWasNull && scores.size === 0 ? null : { scores }
}

export interface SalienceBundleService {
  loadBundle(graphId: string, documentId: string): Promise<SalienceBundle>
}

export function makeSalienceBundleService(salience: SalienceService): SalienceBundleService {
  return {
    async loadBundle(graphId: string, documentId: string): Promise<SalienceBundle> {
      const scores = await salience.getScores(graphId, documentId)
      const map = new Map<string, BlockScore>()
      for (const score of scores) map.set(score.blockId, score)
      return { scores: map }
    },
  }
}

export function makeScopedSalienceBundleLoader(
  salience: SalienceService,
  getScope: () => EditorScope,
): () => Promise<SalienceBundle> {
  const service = makeSalienceBundleService(salience)
  return async () => {
    const scope = getScope()
    if (!scope.graphId || !scope.documentId) return EMPTY_SALIENCE_BUNDLE
    return service.loadBundle(scope.graphId, scope.documentId)
  }
}

// ── Display/cycling helpers (pure — operate on a BlockScore, not a lookup) ────
//
// Importance levels exposed in UI.
// Order: unrated → flag → double-flag → active-forgetting → unrated.
// 0 is "active forgetting" — a deliberate "this doesn't matter" judgment,
// distinct from null (unrated/no judgment yet).
export const IMPORTANCE_CYCLE: ReadonlyArray<number | null> = [null, 3, 5, 0]
// Valence levels exposed in UI. 0 has no special meaning for valence (unlike
// importance) — the cell collapses a valence rating of 0 back to null.
export const VALENCE_CYCLE: ReadonlyArray<number | null> = [null, 4, -4]

const SIGNAL_ICONS = ['signal-zero', 'signal-low', 'signal-medium', 'signal-high', 'signal'] as const

/**
 * Composite score → 0-4 signal level. Returns null if no score.
 *
 * Thresholds calibrated (upstream, mnemosyne-platform) against the actual
 * score distribution of a real graph:
 *   < 0.30  → 0 (signal-zero)  — barely registered
 *   < 0.44  → 1 (signal-low)   — connected but not notable
 *   < 0.52  → 2 (signal-med)   — meaningfully engaged
 *   < 0.565 → 3 (signal-high)  — significant, well-connected
 *   ≥ 0.565 → 4 (signal)       — landmark block
 */
export function signalLevel(score: BlockScore | undefined): number | null {
  if (!score) return null
  const c = score.compositeScore
  if (c < 0.3) return 0
  if (c < 0.44) return 1
  if (c < 0.52) return 2
  if (c < 0.565) return 3
  return 4
}

/** Icon name for the signal bars display. */
export function signalIcon(score: BlockScore | undefined): string {
  const level = signalLevel(score)
  return level === null ? 'signal-zero' : SIGNAL_ICONS[level]
}

/** Cycle importance to next state: null → 3 → 5 → 0 → null */
export function nextImportance(score: BlockScore | undefined): number | null {
  const current = score?.userImportance ?? null
  const idx = IMPORTANCE_CYCLE.indexOf(current)
  return IMPORTANCE_CYCLE[(idx + 1) % IMPORTANCE_CYCLE.length] ?? null
}

/** Cycle valence to next state: null → 4 → -4 → null */
export function nextValence(score: BlockScore | undefined): number | null {
  const current = score?.userValence ?? null
  const idx = VALENCE_CYCLE.indexOf(current)
  return VALENCE_CYCLE[(idx + 1) % VALENCE_CYCLE.length] ?? null
}

/** Flag icon name for current importance state. */
export function importanceIcon(score: BlockScore | undefined): string {
  const imp = score?.userImportance ?? null
  if (imp === 5) return 'flag' // very important — solid flag (rendered doubled by the caller)
  if (imp === 3) return 'flag' // important — flag
  if (imp === 0) return 'circle-slash' // actively forgetting — ∅
  return 'flag-off' // unrated
}

/** Whether the flag is in "very important" state (for visual distinction). */
export function isVeryImportant(score: BlockScore | undefined): boolean {
  return (score?.userImportance ?? null) === 5
}

/** Whether the user has explicitly rated this block (any of 0, 3, 5). */
export function hasUserImportance(score: BlockScore | undefined): boolean {
  const imp = score?.userImportance
  return imp === 0 || imp === 3 || imp === 5
}

/** Celestial icon name for current valence state. */
export function valenceIcon(score: BlockScore | undefined): string {
  const val = score?.userValence ?? null
  if (val === 4) return 'sunrise' // breakthrough
  if (val === -4) return 'eclipse' // tension
  return 'sun-moon' // neutral
}

/** Label for the current importance state. */
export function importanceLabel(score: BlockScore | undefined): string {
  const imp = score?.userImportance ?? null
  if (imp === 5) return 'Very important'
  if (imp === 3) return 'Important'
  if (imp === 0) return 'Actively forgetting'
  return 'Unrated'
}

/** Label for the current valence state. */
export function valenceLabel(score: BlockScore | undefined): string {
  const val = score?.userValence ?? null
  if (val === 4) return 'Breakthrough'
  if (val === -4) return 'Tension'
  return 'Neutral'
}

/**
 * Combined cumulative importance: log2(1 + agent_raw_sum + user_raw).
 * This is the actual value the composite formula uses.
 *
 * If the user has explicitly rated this block 0 ("actively forgetting"),
 * their judgment vetoes any agent contribution and the combined importance
 * is 0 — matching the cell's composite-score treatment.
 */
export function combinedImportance(score: BlockScore | undefined): number {
  if (!score) return 0
  if (score.userImportance === 0) return 0
  const combinedRaw = score.rawImportanceSum + (score.userImportance ?? 0)
  return combinedRaw > 0 ? Math.log2(1 + combinedRaw) : score.cumulativeImportance
}

/**
 * Combined cumulative valence: signed log2(1 + |agent_raw_sum + user_raw|).
 * This is the actual value the composite formula uses.
 */
export function combinedValence(score: BlockScore | undefined): number {
  if (!score) return 0
  const combinedRaw = score.rawValenceSum + (score.userValence ?? 0)
  if (combinedRaw === 0) return score.cumulativeValence
  const sign = combinedRaw >= 0 ? 1 : -1
  return sign * Math.log2(1 + Math.abs(combinedRaw))
}
