/**
 * What a file kind says about a file, as the Files surfaces show it (plans/2026-10-08-datasheets-in-sophia.md §3).
 *
 * Files is generic. A kind (a datasheet, a paper, ...) brings its own importer and its own reading of the records, and hands the
 * surfaces this one shape: a title, a subtitle, up to three key values with their marks, a badge, the list's cells, and whether it
 * needs a look. The card, the list and the status line read only this. A file no kind recognizes has no `FileEvidence`, and every
 * surface then renders exactly as it did before. The kinds live in the shell (`apps/organism/src/cell/files-kinds`).
 */

/**
 * How well a value is corroborated. `high` ●●● independent statements agree · `medium` ●●○ one clean source · `low` ●○○ low or
 * repaired · `contested` ⚠ the readers disagree · `checked` ✓ a person checked it. Shape, never hue, carries the difference.
 */
export type Corroboration = 'high' | 'medium' | 'low' | 'contested' | 'checked'

export const CORROBORATION_MARK: Readonly<Record<Corroboration, string>> = Object.freeze({
  high: '●●●', medium: '●●○', low: '●○○', contested: '⚠', checked: '✓',
})

export const CORROBORATION_WORDS: Readonly<Record<Corroboration, string>> = Object.freeze({
  high: 'independent statements agree', medium: 'one clean source', low: 'low confidence', contested: 'contested', checked: 'checked by a person',
})

export type ReadState = 'queued' | 'reading' | 'read' | 'failed'

export interface FileEvidenceValue {
  /** 'VIN', 'GBW', 'RDS(on)'. */
  readonly label: string
  /** '1.8–6.5 V', '≤ 6.5 V', 'Cortex-M4'. */
  readonly text: string
  readonly mark: Corroboration
}

/** One piece of the card's line beneath the title; a `fixed` piece never gives way to ellipsis ('· Rev B'). */
export interface FileEvidenceSubtitle {
  readonly text: string
  readonly fixed?: boolean
}

/** One cell of the list, under the header its kind declares. */
export interface FileEvidenceCell {
  readonly header: string
  /** A CSS track ('7rem', 'minmax(8rem, 12rem)'); the default is an even share. */
  readonly width?: string
  readonly text: string
  /** A small caption before the text ('VIN'). */
  readonly label?: string
  readonly mark?: Corroboration
  /** Set in the heavier face (the part). */
  readonly strong?: boolean
  /** The status column: drawn toned. */
  readonly tone?: 'attention' | 'danger'
}

/**
 * One row of a kind's block in the Show info panel: a label and a text, optionally with a corroboration mark, in monospace, or as a
 * verb (`action`: the panel says it back to the shell when the row is pressed, e.g. 'open' for "Open in reader").
 */
export interface FileInfoRow {
  readonly label: string
  readonly text: string
  readonly mark?: Corroboration
  readonly mono?: boolean
  readonly action?: string
}

/** A kind's block of the Show info panel ('Datasheet'). A kind with no `info` adds nothing. */
export interface FileInfoSection {
  readonly title: string
  readonly rows: readonly FileInfoRow[]
}

/** What a kind found in one file, in the one shape the surfaces draw. */
export interface FileEvidence {
  /** The kind that read it ('datasheet'). */
  readonly kind: string
  /** The card's large line: the part, the paper's title. Empty: the file is not read yet and keeps its plain card. */
  readonly title: string
  readonly subtitle: readonly FileEvidenceSubtitle[]
  /** At most three. */
  readonly values: readonly FileEvidenceValue[]
  readonly state: ReadState
  /** The badge once read ('Read · 212 rows', '2 to check'); the other states have their own words. */
  readonly doneBadge: string
  readonly badgeTone?: 'attention' | 'danger'
  /** What the status line says when the read completes, after 'Read name: ' ('4 key values, 212 rows, 2 to check'). */
  readonly summary: string
  readonly cells: readonly FileEvidenceCell[]
  /** The kind's own predicate: contested or low-confidence values, or values to check. */
  readonly lookable: boolean
  /** The reading, while it runs. */
  readonly progress?: { readonly page: number; readonly pages: number }
  /** Why a read failed, in words. */
  readonly error?: string
  /** The kind's own block of the Show info panel. */
  readonly info?: readonly FileInfoSection[]
}

/** Local name of an IRI or a `prefix:name`. */
export function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'), iri.lastIndexOf(':'))
  return cut >= 0 ? iri.slice(cut + 1) : iri
}

/** The annunciator: one short word for where the file stands. */
export function evidenceBadge(e: FileEvidence): string {
  switch (e.state) {
    case 'failed': return 'Couldn’t read'
    case 'queued': return 'Queued'
    case 'reading': return e.progress ? `Reading ${e.progress.page}/${e.progress.pages}` : 'Reading'
    case 'read': return e.doneBadge
  }
}

/** The badge's tone: the kind's, once read; a failure is always danger. */
export function evidenceTone(e: FileEvidence): 'attention' | 'danger' | undefined {
  return e.state === 'failed' ? 'danger' : e.state === 'read' ? e.badgeTone : undefined
}

/** Contested or low-confidence values, or values to check. A file still being read, or unread, has nothing to look at yet. */
export function needsLook(e: FileEvidence | undefined): boolean {
  return !!e && e.state === 'read' && e.lookable
}

/** Whether the card draws the kind's face (it has a title and something read), or keeps the plain card with the badge. */
export function hasFace(e: FileEvidence | undefined): e is FileEvidence {
  return !!e && e.title !== '' && (e.values.length > 0 || e.state === 'read')
}

/** What the card says to a screen reader. */
export function evidenceWords(e: FileEvidence): string {
  const values = e.values.map(v => `${v.label} ${v.text}, ${CORROBORATION_WORDS[v.mark]}`)
  return [e.title, e.subtitle.map(s => s.text).join(' ').replace(/\s*·\s*/g, ' ').trim(), ...values, evidenceBadge(e)].filter(Boolean).join(', ')
}

/** The sentence under the status line when a file has just been read: 'Read TPS62840.pdf: 4 key values, 212 rows, 2 to check'. */
export function readDoneSentence(name: string, e: FileEvidence): string {
  return `Read ${name}${e.summary ? `: ${e.summary}` : ''}`
}
