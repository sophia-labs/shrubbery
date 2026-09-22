/**
 * contested-surface.ts — mapping a `sh-row-activate`d row on the contested
 * table into an object identity (MO object-face integration spec, master
 * §3 Slice 5, WS2 §6.2).
 *
 * The activated row's `?item` is the CONFLICT subject
 * (`urn:mnemosyne:local:graph:{graphId}:projection:sync-conflicts:{conflictId}`,
 * Garden `source_sync.rs:2003-2006`) — NOT the object. `contestedSelectionFrom`
 * resolves the object identity by joining that `conflictId` against the
 * resident `SourceBundle`, so the composite `objectKey` (`vocab class
 * objectId`, `object_key()`, `source_sync.rs:758-760`) is never guessed or
 * rendered directly from the row.
 *
 * All rules fail CLOSED — `null`, never a guess — per the errors doctrine
 * ("errors surface verbatim, never a silent fallback"): a mismatch between
 * the table and the event, or an epoch whose local copy has moved past this
 * conflict, means "this disagreement is no longer in your copy of the
 * graph" (§7.3), not a fabricated selection.
 */
import type { SourceBundle } from '@shrubbery/source'
import type { SubjectRowActivateDetail } from '@shrubbery/runtime'
import type { WorkspaceContestedSelection } from '@shrubbery/runtime'

export interface ContestedSurfaceState {
  readonly graphId: string
  readonly selection: WorkspaceContestedSelection | null
}

function conflictsGraphPrefix(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:projection:sync-conflicts:`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * `bundle.conflicts` is still the untyped wire array (`readonly
 * Record<string, unknown>[]`, master §2 — Ask A's client-side TYPING of this
 * array is a separate, `@shrubbery/source`-internal concern this slice does
 * not own); this reads exactly the two camelCase fields this join needs,
 * verbatim off the wire, the same defensive-narrowing style
 * `source-object-runtime.ts`'s `contestFromWire` already uses for the same
 * shape.
 */
function objectKeyForConflict(bundle: SourceBundle, conflictId: string): string | null {
  for (const candidate of bundle.conflicts) {
    if (!isRecord(candidate)) continue
    if (stringField(candidate, 'conflictId') !== conflictId) continue
    const objectKey = stringField(candidate, 'objectKey')
    return objectKey ?? null
  }
  return null
}

/**
 * Joins a real `sh-row-activate` detail against the resident bundle. Returns
 * `null` — never a guess — when the row and the event disagree, when the
 * subject is not a conflict subject for THIS graph, or when the epoch's
 * local copy no longer carries that conflict.
 */
export function contestedSelectionFrom(
  detail: SubjectRowActivateDetail,
  bundle: SourceBundle | undefined,
  graphId: string,
): WorkspaceContestedSelection | null {
  const prefix = conflictsGraphPrefix(graphId)
  if (!detail.subjectIri.startsWith(prefix)) return null
  const conflictId = detail.subjectIri.slice(prefix.length)
  if (conflictId === '') return null

  const item = detail.row['item']
  if (!item || item.type !== 'uri' || item.value !== detail.subjectIri) return null

  if (!bundle) return null
  const objectKey = objectKeyForConflict(bundle, conflictId)
  if (objectKey === null) return null

  return { objectKey, conflictId }
}

/**
 * A new epoch re-folds every conflict (`fold_current_objects`,
 * `source_sync.rs:4024-4028`-adjacent). A selection whose `conflictId` is
 * gone from the new epoch's `bundle.conflicts` must not keep the card
 * wearing a stance for a disagreement that no longer exists in this local
 * copy — dropped to `null`, never left stale.
 */
export function reconcileContestedSelection(
  state: ContestedSurfaceState,
  bundle: SourceBundle | undefined,
): ContestedSurfaceState {
  if (state.selection === null) return state
  const stillLive = bundle !== undefined && objectKeyForConflict(bundle, state.selection.conflictId) !== null
  return stillLive ? state : { ...state, selection: null }
}
