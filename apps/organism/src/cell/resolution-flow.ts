/**
 * resolution-flow.ts — the user-facing resolution journey (MO object-face
 * integration spec, master §3 Slice 6, WS2 §6.6-6.7): the resolution menu
 * model, the three-way "choose" dialog, the pending-resolution presentation
 * states, the lost-race dialog, and the field-wise `hoja` composer.
 *
 * `main.ts` owns the singleton `mn-context-menu`/`mn-confirmation-dialog`
 * elements (WS2 §6.6 — "Hosted on the existing commandMenuEl singleton",
 * "Composed on the existing confirmationDialogEl"); every DOM-touching
 * function here takes the element as an explicit parameter rather than
 * creating or module-scoping its own, so this file stays testable and
 * `main.ts` stays the single owner of both singletons.
 *
 * `<hoja-editor>` registers itself as a side effect of importing
 * `@shrubbery/hoja` (its own package doc: "Importing the package registers
 * `<hoja-editor>`") — nothing else in `apps/organism` pulls that package in
 * today, so this file's import IS the registration seam for the composer.
 */
import '@shrubbery/hoja'
import type { HojaEditor, HojaComposerDetail } from '@shrubbery/hoja'
import type { MnConfirmationDialog } from '@shrubbery/components'
import { type MenuEntry } from '@shrubbery/nucleus'
import type { SourceMirrorState } from '@shrubbery/source'

// ── the menu model (pure, WS2 §6.6 "Menu model") ────────────────────────────

export interface ResolutionMenuProposal {
  readonly operationId: string
  readonly sourceVersion: string
  /** `null` pre-Ask-A or when this proposal's own byline is unattributed. */
  readonly observer: string | null
  readonly isProjectedHead: boolean
  /** Carried straight through from `ObjectIntentProposal.record` (§2.6) so
   *  the compose flow never has to re-join the bundle for it. */
  readonly record: Readonly<Record<string, unknown>>
}

export interface ResolutionMenuInput {
  readonly objectKey: string
  readonly conflictId: string
  readonly proposals: readonly ResolutionMenuProposal[]
  readonly composeAvailable: boolean
  readonly pendingResolution: boolean
}

function shortHash(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 10)}…`
}

function proposalLabel(proposal: ResolutionMenuProposal, index: number): string {
  return proposal.observer
    ? `${proposal.observer} · ${shortHash(proposal.sourceVersion)}`
    : `Proposal ${index + 1} · ${shortHash(proposal.sourceVersion)}`
}

/** Pure. The menu ITEMS never render `record` — it rides through only so the
 *  compose flow has it without a second fetch.
 *
 * REPAIR (master §3 Slice 6, code wins over WS2 §6.6's own draft shape).
 * WS2's draft nested the per-proposal entries under a "Keep this proposal"
 * PARENT item via `MenuItemEntry.submenu`. Verified against the real
 * `<mn-context-menu>` (`mn-context-menu.ts:404-424`): `handleItemClick` calls
 * `selectItem` UNCONDITIONALLY for every item, parent or not — there is no
 * hover-triggered nested panel anywhere in this component, so clicking a
 * `submenu`-bearing item just fires `mn-select` for THAT item's own id and
 * the "children" are never reachable at all. `MenuItemEntry.submenu` is a
 * typed field with no renderer behind it in this codebase (confirmed: no
 * other caller opens one either). Flattened instead: the per-proposal
 * entries are direct top-level items under their own sub-header, mechanically
 * reachable with a single click, exactly as this component actually behaves. */
export function resolutionMenuModel(input: ResolutionMenuInput): readonly MenuEntry[] {
  const disabled = input.pendingResolution
  const entries: MenuEntry[] = [
    {
      type: 'header',
      content: disabled ? 'Waiting for the cell to confirm your choice' : 'Resolve this object',
    },
  ]
  if (input.proposals.length > 0) {
    entries.push({ type: 'header', content: 'Keep a proposal' })
    for (const [index, proposalEntry] of input.proposals.entries()) {
      entries.push({ id: `keep:${proposalEntry.operationId}`, label: proposalLabel(proposalEntry, index), disabled })
    }
  }
  entries.push({ type: 'divider' })
  if (input.composeAvailable) {
    entries.push({ id: 'compose', label: 'Compose a merged value…', disabled })
  }
  entries.push({ id: 'copy-key', label: "Copy the object's key" })
  return entries
}

// ── the three-way "choose" dialog (WS2 §6.6) ────────────────────────────────

export type ResolutionChoice = 'keep' | 'compose' | null

export interface PickResolutionOptions {
  readonly dialog: MnConfirmationDialog
  readonly objectLabel: string
  /** Not rendered in the dialog's visible copy (the message is deliberately
   *  generic, §7.5) — carried for the caller's own logging / a11y needs. */
  readonly proposalLabel: string
  /** Runs AFTER confirm, BEFORE the dialog hides — this is what makes the
   *  loading window real. Rejecting surfaces the error verbatim and does
   *  NOT hide the dialog (the user's choice is still live; retry or cancel). */
  readonly onKeep: () => Promise<void>
  /**
   * Drives the ENTIRE compose sub-flow (opening the field-wise composer on
   * this SAME dialog, per WS2 §6.7) and returns `true` once a resolution
   * actually submitted. Returns `false` for the composer's own "Back" — the
   * choose dialog is re-shown, unresolved, rather than treated as if the
   * user had committed to nothing happening (a silently-closed dialog would
   * be indistinguishable from a lost click).
   */
  readonly onCompose: () => Promise<boolean>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const CHOOSE_MESSAGE =
  'Two writers proposed different values from the same starting point. Choosing keeps one and '
  + 'records the choice; the other proposal remains in this graph’s history.'

function presentChooseDialog(dialog: MnConfirmationDialog, objectLabel: string): void {
  dialog.title = `Resolve ${objectLabel}`
  dialog.message = CHOOSE_MESSAGE
  dialog.confirmText = 'Keep this one'
  dialog.secondaryConfirmText = 'Compose a merged value…'
  dialog.cancelText = 'Not now'
  dialog.variant = 'default'
  dialog.loading = false
}

/**
 * CORRECTED shape (master §3 Slice 6): `pickDocumentImportKind`'s precedent
 * (`main.ts`) resolves and hides SYNCHRONOUSLY inside its confirm handler,
 * which gives the caller no window to show `loading` on a still-visible
 * dialog. Here the mutation runs INSIDE the handler instead, so `loading`
 * is real and visible while the dialog stays mounted.
 */
export function pickResolution(opts: PickResolutionOptions): Promise<ResolutionChoice> {
  const { dialog } = opts
  presentChooseDialog(dialog, opts.objectLabel)

  return new Promise<ResolutionChoice>(resolve => {
    function cleanup(): void {
      dialog.removeEventListener('mn-confirm', onKeepClick)
      dialog.removeEventListener('mn-secondary-confirm', onComposeClick)
      dialog.removeEventListener('mn-cancel', onCancelClick)
      dialog.secondaryConfirmText = ''
    }
    function onKeepClick(): void {
      void (async () => {
        dialog.loading = true
        try {
          await opts.onKeep()
          cleanup()
          dialog.hide()
          resolve('keep')
        } catch (error) {
          dialog.loading = false
          dialog.message = errorText(error)
        }
      })()
    }
    function onComposeClick(): void {
      void (async () => {
        dialog.loading = true
        try {
          const committed = await opts.onCompose()
          if (!committed) {
            // "Back" — return to the SAME choose dialog, still open, waiting.
            presentChooseDialog(dialog, opts.objectLabel)
            return
          }
          cleanup()
          dialog.hide()
          resolve('compose')
        } catch (error) {
          dialog.loading = false
          dialog.message = errorText(error)
        }
      })()
    }
    function onCancelClick(): void {
      cleanup()
      resolve(null)
    }
    dialog.addEventListener('mn-confirm', onKeepClick)
    dialog.addEventListener('mn-secondary-confirm', onComposeClick)
    dialog.addEventListener('mn-cancel', onCancelClick)
    dialog.show()
  })
}

// ── pending-resolution presentation (never optimistic — WS2 D-W9) ──────────

export type ResolutionPresentation = 'pending' | 'accepted' | 'idle' | 'settled-with-successor'

/**
 * Derived from `SourceMirrorState`'s fault-free fields (master §2.1's
 * `resolving`/`awaitingEpoch`). The two-condition clearing (a receipt AND
 * the next epoch) is what makes this non-optimistic: `'idle'` is reached
 * only once `bundle.conflicts` (via a fresh pull) no longer names the
 * conflict, never merely once the outbox row shows `applied`.
 */
export function resolutionPresentationFor(
  conflictId: string,
  state: SourceMirrorState,
): ResolutionPresentation {
  if (state.resolving.includes(conflictId)) return 'pending'
  const awaiting = state.awaitingEpoch.find(entry => entry.conflictId === conflictId)
  if (awaiting) return awaiting.remainingConflictId !== null ? 'settled-with-successor' : 'accepted'
  return 'idle'
}

/** §7.3's copy for the three non-idle presentations; `null` for `'idle'`
 *  (the card renders nothing extra — the stance itself has already cleared). */
export function resolutionPresentationCopy(presentation: ResolutionPresentation): string | null {
  switch (presentation) {
    case 'pending':
      return 'Your choice is saved here. Waiting for the cell.'
    case 'accepted':
      return 'The cell accepted your choice.'
    case 'settled-with-successor':
      return 'Settled — and a newer disagreement has appeared.'
    case 'idle':
      return null
  }
}

// ── the lost race (WS2 §6.6.1) ──────────────────────────────────────────────

export interface LostRaceOptions {
  readonly dialog: MnConfirmationDialog
  readonly objectLabel: string
  /** The authority's own words, verbatim (errors doctrine) — rendered in a
   *  monospace block, never paraphrased, never softened. */
  readonly testimony: string
  readonly onLookAgain: () => void
}

/**
 * Shown ONCE, on the render after a targeted `stale_sync_conflict` /
 * `rejected-permanent` status lands for a resolution this client authored
 * (master §2.3). Never retried automatically — a superseded resolution is a
 * decision that was overtaken; resubmitting the identical row can only fail
 * again (the conflictId hashes the candidate set).
 */
export function showLostRaceDialog(opts: LostRaceOptions): Promise<void> {
  const { dialog } = opts
  dialog.title = 'Someone else decided first'
  dialog.message =
    `Your choice for ${opts.objectLabel} was not applied — another writer resolved this object while `
    + 'your choice was on its way. Nothing was lost: every proposal, including yours, is still in this '
    + 'graph’s history.'
  dialog.confirmText = 'Look at it again'
  dialog.secondaryConfirmText = ''
  dialog.cancelText = 'Dismiss'
  dialog.variant = 'default'
  dialog.loading = false

  const testimonyEl = document.createElement('pre')
  testimonyEl.className = 'sh-resolution-testimony'
  testimonyEl.style.whiteSpace = 'pre-wrap'
  testimonyEl.style.fontFamily = 'var(--mn-font-mono, ui-monospace, monospace)'
  testimonyEl.style.fontSize = 'var(--mn-font-size-sm, 0.85em)'
  testimonyEl.style.margin = '0'
  testimonyEl.textContent = opts.testimony
  dialog.append(testimonyEl)

  return new Promise<void>(resolve => {
    function cleanup(): void {
      dialog.removeEventListener('mn-confirm', onConfirm)
      dialog.removeEventListener('mn-cancel', onCancel)
      testimonyEl.remove()
    }
    function onConfirm(): void {
      cleanup()
      dialog.hide()
      opts.onLookAgain()
      resolve()
    }
    function onCancel(): void {
      cleanup()
      dialog.hide()
      resolve()
    }
    dialog.addEventListener('mn-confirm', onConfirm)
    dialog.addEventListener('mn-cancel', onCancel)
    dialog.show()
  })
}

// ── composing a merged record (WS2 §6.7) ────────────────────────────────────

export interface ComposedFieldValue {
  readonly key: string
  readonly json: unknown
  readonly source: 'candidate' | 'composed'
  readonly fromOperationId?: string
}

/** OUT: hoja renders TEXT, so a field seeds as its LEXICAL form, never its
 *  JSON encoding. IN: `detail.plainText`, NOT `detail.value` (composer
 *  Markdown escapes `` ` ``/`*`/`_`/`[`). Pure — no DOM. */
export function composedRecord(
  base: Readonly<Record<string, unknown>>,
  fields: readonly ComposedFieldValue[],
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...base }
  for (const field of fields) result[field.key] = field.json
  return result
}

type ComposerFieldKind = 'locked' | 'identical' | 'string' | 'number' | 'boolean' | 'structural'

interface ComposerFieldCandidate {
  readonly operationId: string
  readonly label: string
  readonly value: unknown
}

interface ComposerField {
  readonly key: string
  readonly kind: ComposerFieldKind
  readonly candidates: readonly ComposerFieldCandidate[]
}

/** The field diff over the candidates' top-level keys (records are flat
 *  generic objects; `normalized_generic_record` only ever touches
 *  `kind`/`localId`). `kind`/`localId` are never editable — the authority
 *  would reject a mismatch. A field whose value is byte-identical (by JSON
 *  content) across every candidate that carries it is shown read-only. */
function classifyComposerFields(proposals: readonly ResolutionMenuProposal[]): readonly ComposerField[] {
  const keys = new Set<string>()
  for (const proposal of proposals) for (const key of Object.keys(proposal.record)) keys.add(key)
  const fields: ComposerField[] = []
  for (const key of [...keys].sort()) {
    const candidates: ComposerFieldCandidate[] = proposals.map((proposal, index) => ({
      operationId: proposal.operationId,
      label: proposalLabel(proposal, index),
      value: proposal.record[key],
    }))
    if (key === 'kind' || key === 'localId') {
      fields.push({ key, kind: 'locked', candidates })
      continue
    }
    const distinct = new Set(candidates.map(candidate => JSON.stringify(candidate.value)))
    if (distinct.size <= 1) {
      fields.push({ key, kind: 'identical', candidates })
      continue
    }
    const sample = candidates.find(candidate => candidate.value !== undefined)?.value
    const kind: ComposerFieldKind =
      typeof sample === 'string' ? 'string'
        : typeof sample === 'number' ? 'number'
          : typeof sample === 'boolean' ? 'boolean'
            : 'structural'
    fields.push({ key, kind, candidates })
  }
  return fields
}

export interface PickComposedRecordOptions {
  readonly dialog: MnConfirmationDialog
  readonly objectLabel: string
  readonly className: string
  readonly proposals: readonly ResolutionMenuProposal[]
}

/**
 * The composer, hosted inside the SAME `confirmationDialogEl` singleton
 * (WS2 §6.7's own text — "hosted inside the resolution dialog's message
 * area") via its light-DOM `rich-content` slot. `hoja-editor` is one of the
 * two light-DOM-permitted elements. Returns `null` on "Back" — the caller
 * (`pickResolution`'s `onCompose`) re-throws nothing in that case; the
 * dialog simply stays in its "choose" phase (this function's own promise
 * settling to `null` is read by the caller as "no compose happened").
 */
export function pickComposedRecord(
  opts: PickComposedRecordOptions,
): Promise<Readonly<Record<string, unknown>> | null> {
  const { dialog } = opts
  const fields = classifyComposerFields(opts.proposals)
  const headProposal = opts.proposals.find(proposal => proposal.isProjectedHead) ?? opts.proposals[0]
  const base = headProposal?.record ?? {}

  dialog.title = 'Compose a merged value'
  dialog.message = `Only the fields that differ are editable. ${opts.className} and its identity are carried through unchanged.`
  dialog.confirmText = 'Use this merged value'
  dialog.secondaryConfirmText = ''
  dialog.cancelText = 'Back'
  dialog.variant = 'default'
  dialog.loading = false

  const container = document.createElement('div')
  container.className = 'sh-resolution-composer'

  const current = new Map<string, unknown>()
  const cleanupFns: (() => void)[] = []

  for (const field of fields) {
    const row = document.createElement('div')
    row.className = `sh-resolution-composer-field sh-resolution-composer-field--${field.kind}`
    const labelEl = document.createElement('div')
    labelEl.className = 'sh-resolution-composer-field-label'
    labelEl.textContent = field.key
    row.append(labelEl)

    if (field.kind === 'locked' || field.kind === 'identical') {
      current.set(field.key, field.candidates[0]?.value)
      const valueEl = document.createElement('div')
      valueEl.className = 'sh-resolution-composer-field-value'
      valueEl.textContent = readOnlyText(field.candidates[0]?.value)
      row.append(valueEl)
      container.append(row)
      continue
    }

    const defaultCandidate = field.candidates.find(candidate => candidate.operationId === headProposal?.operationId)
      ?? field.candidates[0]
    current.set(field.key, defaultCandidate?.value)

    if (field.kind === 'string' || field.kind === 'number') {
      const editor = document.createElement('hoja-editor') as HojaEditor
      editor.posture = 'composer'
      editor.label = field.key
      editor.value = lexicalSeed(defaultCandidate?.value)
      const onChange = (detail: HojaComposerDetail): void => {
        current.set(field.key, field.kind === 'number' ? detail.plainText : detail.plainText)
      }
      editor.onChange = onChange
      editor.onSubmit = onChange
      row.append(editor)
      cleanupFns.push(() => editor.remove())
    } else {
      // boolean / structural: one button per candidate — "keep mine / keep
      // theirs" generalised to N candidates. No structural editor exists;
      // inventing one here would be the apparatus-building this repo resists.
      const choices = document.createElement('div')
      choices.className = 'sh-resolution-composer-field-choices'
      for (const candidate of field.candidates) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = `${candidate.label}: ${readOnlyText(candidate.value)}`
        button.setAttribute('aria-pressed', String(candidate.operationId === defaultCandidate?.operationId))
        const onClick = (): void => {
          current.set(field.key, candidate.value)
          for (const sibling of Array.from(choices.children)) {
            sibling.setAttribute('aria-pressed', String(sibling === button))
          }
        }
        button.addEventListener('click', onClick)
        choices.append(button)
      }
      row.append(choices)
    }
    container.append(row)
  }

  dialog.append(container)

  return new Promise<Readonly<Record<string, unknown>> | null>(resolve => {
    function cleanup(): void {
      dialog.removeEventListener('mn-confirm', onConfirmClick)
      dialog.removeEventListener('mn-cancel', onCancelClick)
      for (const fn of cleanupFns) fn()
      container.remove()
      dialog.cancelText = ''
    }
    function onConfirmClick(): void {
      // Number fields are validated HERE, not live — an in-progress edit
      // ("-", "") is a normal transient state, not yet a refusal.
      for (const field of fields) {
        if (field.kind !== 'number') continue
        const raw = current.get(field.key)
        const parsed = typeof raw === 'string' ? Number(raw.trim()) : raw
        if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
          dialog.message = `${field.key} could not be read as a number. Fix it, or keep one of the proposals.`
          return
        }
        current.set(field.key, parsed)
      }
      const composedFields: ComposedFieldValue[] = fields
        .filter(field => field.kind !== 'locked' && field.kind !== 'identical')
        .map(field => ({ key: field.key, json: current.get(field.key), source: 'composed' }))
      const record = composedRecord(base, composedFields)
      cleanup()
      resolve(record)
    }
    function onCancelClick(): void {
      cleanup()
      resolve(null)
    }
    dialog.addEventListener('mn-confirm', onConfirmClick)
    dialog.addEventListener('mn-cancel', onCancelClick)
  })
}

function readOnlyText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return '(absent)'
  return JSON.stringify(value)
}

function lexicalSeed(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return value === undefined ? '' : JSON.stringify(value)
}
