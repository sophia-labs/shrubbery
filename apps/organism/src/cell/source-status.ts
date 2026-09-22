/**
 * source-status.ts — the bottom-bar mirror badges' pure view model, and the
 * sidebar's per-document pending/parked decoration (master spec §3 Slice 4,
 * WS2 §5.2/§5.3; copy deck §7.2).
 *
 * Both functions are PURE — no store reads, no DOM, no fetch — so they are
 * exercised directly by fast unit tests and driven from `main.ts`'s single
 * `applySourceMirrorState` seam (master §2.17) and the sidebar refresh path.
 */
import { documentIdOf, type SourceMirrorState, type SourceOutboxRecord } from '@shrubbery/source'
import type { ChromeSourceBadge, ChromeSourceStatus } from '@shrubbery/components'
import type { FilePaneSourceState } from '@shrubbery/nucleus'
import type { SidebarNode, SidebarSection } from '@shrubbery/runtime'

const UNKNOWN_BADGE: ChromeSourceBadge = {
  kind: 'unknown',
  glyph: '—',
  label: 'local copy unknown',
  accessibleName: 'This device has no verified copy of this graph yet.',
  hint: 'Opening the local copy.',
}

const NEEDS_REPAIR_BADGE: ChromeSourceBadge = {
  kind: 'needs-repair',
  glyph: '⚠',
  label: 'local copy needs repair',
  accessibleName:
    'The last update to this local copy did not finish. Some contested objects may not be showing yet.',
  hint: 'A background rebuild failed and will retry automatically.',
}

function contestedBadge(count: number): ChromeSourceBadge {
  return {
    kind: 'contested',
    glyph: '◆',
    label: `${count} contested`,
    accessibleName: `${count} ${count === 1 ? 'object is' : 'objects are'} contested. Open the contested list.`,
    hint: 'Two writers proposed different values from the same starting point.',
  }
}

function pendingBadge(count: number): ChromeSourceBadge {
  return {
    kind: 'pending',
    glyph: '↑',
    label: `${count} pending`,
    accessibleName:
      `${count} ${count === 1 ? 'change is' : 'changes are'} saved here and `
      + `${count === 1 ? 'has' : 'have'} not reached the cell yet.`,
    hint: 'Saved on this device. Not yet acknowledged.',
  }
}

function parkedBadge(count: number): ChromeSourceBadge {
  return {
    kind: 'parked',
    glyph: '⏸',
    label: `${count} parked`,
    accessibleName:
      `${count} ${count === 1 ? 'piece of work is' : 'pieces of work are'} parked from a previous life of this graph.`,
    hint: 'Kept safe. Nothing was merged.',
  }
}

/**
 * Pure: `SourceMirrorState → ChromeSourceStatus` (master §7.2). No
 * `0 contested` badge — EMPTY is a first-class success state, so an
 * all-clear mirror returns `{ badges: [] }` — but an INCOMPLETE epoch
 * (`state === null`, never opened/pulled, or `state.complete === false`)
 * returns the `unknown` badge ALONE rather than an empty region that would
 * read as "all clear". `repairNeeded` suppresses ONLY the contested badge
 * (its source, the RDF projection, may be stale) — `pending`/`parked` come
 * from the durable outbox and are unaffected.
 */
export function sourceStatusModel(state: SourceMirrorState | null): ChromeSourceStatus {
  if (state === null || !state.complete) {
    return { badges: [UNKNOWN_BADGE] }
  }
  const badges: ChromeSourceBadge[] = []
  if (state.repairNeeded) {
    badges.push(NEEDS_REPAIR_BADGE)
  } else if (state.contestedObjects > 0) {
    badges.push(contestedBadge(state.contestedObjects))
  }
  if (state.pending > 0) badges.push(pendingBadge(state.pending))
  if (state.parked > 0) badges.push(parkedBadge(state.parked))
  return { badges }
}

// ── sidebar per-document decoration ─────────────────────────────────────
//
// Document-plane truths ONLY (master §5 "Wayfinding"): Law I merges
// documents, so a document is never "contested" — only "pending" (an
// unsent local write) or "parked" (a Law VI fence) apply to one document.

const SIDEBAR_BADGE_LABEL: Readonly<Record<FilePaneSourceState, string>> = {
  pending: 'Pending',
  parked: 'Parked',
}

const SIDEBAR_BADGE_TONE: Readonly<Record<FilePaneSourceState, 'active' | 'warning'>> = {
  pending: 'active',
  parked: 'warning',
}

/**
 * One entry per document with SOME durable outbox activity. Worst status
 * wins within one document: a `rejected-stale` row makes the whole document
 * `parked` even if an unrelated `pending` row for the same document exists.
 */
export function documentSourceStates(
  outbox: readonly SourceOutboxRecord[],
): ReadonlyMap<string, FilePaneSourceState> {
  const states = new Map<string, FilePaneSourceState>()
  for (const record of outbox) {
    const documentId = documentIdOf(record.operation)
    if (documentId === null) continue
    if (record.status === 'rejected-stale') {
      states.set(documentId, 'parked')
      continue
    }
    if (
      (record.status === 'pending' || record.status === 'accepted')
      && states.get(documentId) !== 'parked'
    ) {
      states.set(documentId, 'pending')
    }
  }
  return states
}

function decorateNode(node: SidebarNode, states: ReadonlyMap<string, FilePaneSourceState>): SidebarNode {
  const children = node.children ? node.children.map((child) => decorateNode(child, states)) : node.children
  const sourceState = node.kind === 'document' ? states.get(node.id) : undefined
  if (sourceState === undefined) {
    return children === node.children ? node : { ...node, children }
  }
  return {
    ...node,
    children,
    sourceState,
    badgeTone: SIDEBAR_BADGE_TONE[sourceState],
    badge: SIDEBAR_BADGE_LABEL[sourceState],
  }
}

/**
 * Pure: overlays `pending`/`parked` decoration onto document nodes, never
 * touching folders/artifacts/tags. Called from BOTH `refreshSidebarSections`
 * and `refreshAfterSidebarMutation` (main.ts) — two independent call sites
 * that would otherwise silently erase every badge on a sidebar mutation.
 */
export function decorateSidebarSectionsWithSourceState(
  sections: readonly SidebarSection[],
  outbox: readonly SourceOutboxRecord[],
): readonly SidebarSection[] {
  const states = documentSourceStates(outbox)
  if (states.size === 0) return sections
  return sections.map((section) => ({
    ...section,
    nodes: section.nodes ? section.nodes.map((node) => decorateNode(node, states)) : section.nodes,
  }))
}

/**
 * Pure: does a new `SourceMirrorState` publish need the sidebar re-queried?
 * (master §2.17 / §8.3 R17 — the bug this pins compared a live document-
 * outbox signature to ITSELF, which can never differ, so a same-total
 * document swap — one document leaves `pending`, a different one arrives
 * `pending`, the count unchanged — silently refreshed the sidebar zero
 * times.) `main.ts`'s `applySourceMirrorState` is the sole caller: it reads
 * `previousSignature` from stored module state BEFORE overwriting it, so the
 * two signature arguments here are never the same live read twice. Extracted
 * to a pure function, rather than left as an inline expression inside
 * `main.ts`, precisely so this decision is unit-testable without importing
 * `main.ts` itself (an entry point with heavy top-level DOM side effects,
 * not a module any test seam already reaches).
 */
export function sourceMirrorRefreshDecision(
  previous: Pick<SourceMirrorState, 'epoch' | 'complete'> | null,
  previousSignature: string,
  next: Pick<SourceMirrorState, 'epoch' | 'complete'>,
  nextSignature: string,
): boolean {
  return (
    previous === null
    || previous.epoch !== next.epoch
    || previous.complete !== next.complete
    || previousSignature !== nextSignature
  )
}
