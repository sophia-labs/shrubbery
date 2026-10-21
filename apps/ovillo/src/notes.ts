/**
 * notes.ts — a piece whose score is a note list, not a MUS source.
 *
 * Some Worlds are not played by `mus render`: the trombone v1 World (one N-D
 * Ariadne body) is played by a Rust example that gives its player a list of
 * notes and writes that list beside the audio as TSV (`ovillo-notes-tsv`: one
 * row per note, `start_s end_s midi partial slide position art fx vel bore_hz`).
 * The graph carries the list as the piece's score text. This module reads it,
 * names its effects, and lays a measurement of the render beside it when the
 * graph names one (`ovl:analysis`: `mus_analysis.trombone_world_analyse`, made
 * after the World from its audio). Pure: no DOM, no network; it invents nothing
 * (a column the list does not have is undefined, and the face says so).
 */

export const NOTES_TSV = 'ovillo-notes-tsv'

export interface WrittenNote {
  readonly startS: number
  readonly endS: number
  readonly midi: number
  readonly partial?: number
  /** Each slide leg's extension (m). */
  readonly slideM?: number
  readonly position?: number
  readonly art?: string
  readonly fx?: number
  /** The written dynamic (0..1). */
  readonly vel?: number
  /** The bore mode the note was placed on (Hz). */
  readonly boreHz?: number
}

export class NotesTsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotesTsvError'
  }
}

const NUMBER_COLUMNS: Record<string, keyof WrittenNote> = {
  start_s: 'startS',
  end_s: 'endS',
  midi: 'midi',
  partial: 'partial',
  slide: 'slideM',
  position: 'position',
  fx: 'fx',
  vel: 'vel',
  bore_hz: 'boreHz',
}

/** Read a note list; refuses a list without start_s, end_s and midi, or a row that is not numbers where numbers go. */
export function parseNotesTsv(text: string): WrittenNote[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) throw new NotesTsvError('the note list is empty')
  const head = lines[0].split('\t').map((h) => h.trim())
  for (const need of ['start_s', 'end_s', 'midi']) if (!head.includes(need)) throw new NotesTsvError(`the note list has no ${need} column`)
  return lines.slice(1).map((line, i) => {
    const cells = line.split('\t')
    const note: Record<string, number | string> = {}
    head.forEach((h, c) => {
      const raw = cells[c]?.trim()
      if (raw === undefined || raw === '') return
      if (h === 'art') {
        note.art = raw
        return
      }
      const key = NUMBER_COLUMNS[h]
      if (!key) return
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new NotesTsvError(`row ${i + 1}: ${h} is not a number (${raw})`)
      note[key] = n
    })
    if (note.startS === undefined || note.endS === undefined || note.midi === undefined) throw new NotesTsvError(`row ${i + 1} has no start, end or midi`)
    return note as unknown as WrittenNote
  })
}

/** The trombone player's effect flags (ovillo-dsp `trombone_player`: SCOOP 1, FALL 2, VIB 4, RIP 16, SWELL 32, DIM 64). */
const FX: ReadonlyArray<readonly [number, string]> = [
  [1, 'scoop'],
  [2, 'fall'],
  [4, 'vibrato'],
  [16, 'rip'],
  [32, 'swell'],
  [64, 'diminuendo'],
]

export function fxNames(fx: number | undefined): string[] {
  if (!fx) return []
  const names = FX.filter(([bit]) => (fx & bit) !== 0).map(([, name]) => name)
  const known = FX.reduce((m, [bit]) => m | bit, 0)
  if ((fx & ~known) !== 0) names.push(`flag ${fx & ~known}`)
  return names
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

/** MIDI note number → a note name with its octave (60 → C4). */
export function noteName(midi: number): string {
  const m = Math.round(midi)
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}

// ── The measurement beside it ────────────────────────────────────────────────

export interface MeasuredNote {
  readonly start: number
  readonly midi: number
  readonly partial: number
  /** Measured pitch (Hz); 0 when unvoiced. */
  readonly f: number
  readonly cents: number
  readonly sounded_partial: number
  readonly rms_db?: number
}

export interface NotesAnalysis {
  readonly summary: {
    readonly notes?: number
    readonly voiced?: number
    readonly sounded_intended_partial?: number
    readonly median_abs_cents?: number
    readonly max_abs_cents?: number
    readonly within_10?: number
    readonly within_25?: number
    readonly level_spread?: { readonly median_db?: number | null; readonly max_db?: number | null; readonly all_notes_db?: number }
  }
  readonly notes: readonly MeasuredNote[]
}

export function parseNotesAnalysis(json: unknown): NotesAnalysis {
  const o = json as Partial<NotesAnalysis> | null
  if (!o || typeof o !== 'object' || !o.summary || !Array.isArray(o.notes)) throw new Error('analysis: expected { summary, notes[] }')
  return o as NotesAnalysis
}

export interface NoteRow {
  readonly written: WrittenNote
  readonly measured: MeasuredNote | null
}

/** Pair each written note with its measurement, by start time and pitch (the analysis lists them in the same order). */
export function pairNotes(written: readonly WrittenNote[], analysis: NotesAnalysis | null): NoteRow[] {
  return written.map((w, i) => {
    const m = analysis?.notes[i]
    const same = !!m && Math.abs(m.start - w.startS) < 5e-4 && Math.round(m.midi) === Math.round(w.midi)
    return { written: w, measured: same ? m! : null }
  })
}
