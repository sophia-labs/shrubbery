/**
 * product-copy-register.test.ts — the terminology-law copy audit (master spec
 * §7.1, gate G-C, `05-master-spec.md:2312`). **REPAIR-equivalent, built here**:
 * this gate was named "every slice" in the master spec but was absent from
 * both Slice 1 and Slice 2 — flagged by Slice 3's adversarial-verification
 * finding #2 and built as part of the `fix(slice-2)` commit that precedes
 * this slice's own work (see build-log.md, Slice 3's "previous-slice"
 * section).
 *
 * Law (master §7.1): *contested* only of objects (Law IV), *parked* only of
 * documents/lifetimes (Law VI), and the word "conflict"/"conflicts" NEVER
 * appears in AUTHORED product copy. The wire keeps its fossil names
 * (`conflictId`, `SourceMirrorPhase 'conflict'`, `SourceOutboxStatus
 * 'conflict'`, `SyncConflict`, …, master §5.2) — the product language never
 * inherits them.
 *
 * **Scope, per §8.2's own repair (audit #16): every string and template
 * literal, read from disk, not only tagged templates** — most of this
 * programme's authored copy lives in plain shell/service modules that emit
 * no HTML at all. Modelled on the `stance-register-parity.test.ts` /
 * `fragment-face-set-closure.test.ts` from-disk precedent.
 *
 * **Grows additively as later slices land** — a named file that does not yet
 * exist (its owning slice hasn't shipped) is SKIPPED, not failed, exactly
 * like `KNOWN_COMPONENTS`'s incremental-registration convention; presence is
 * checked with `existsSync`, never assumed.
 *
 * **Two closed exclusions**, both asserted, not silently assumed:
 *   1. The regex (`\bconflicts?\b`) matches WHOLE WORDS only, so compound
 *      identifiers (`SourceConflict`, `conflictId`, `stale_sync_conflict` —
 *      `_` is a word character, so there is no boundary before "conflict")
 *      never match on their own. The one family of BARE wire-fossil string
 *      literals that IS a whole word — the `SourceMirrorPhase` /
 *      `SourceOutboxStatus` wire value `'conflict'` itself — is real authored
 *      TEXT in the lexical sense (a string literal) even though it is never
 *      shown to a user, so it is named in `ALLOWED_LITERALS` explicitly
 *      rather than silently exempted by the scanner.
 *   2. §7.1's one scoped exception — the verbatim authority message rendered
 *      as quotation — is data at runtime, never a literal in these files, so
 *      it can never trip this scan. If a future surface embeds one as a
 *      literal (e.g. a hardcoded example in a doc comment's code sample is
 *      NOT this — only an actual runtime literal counts), it is added to
 *      `ALLOWED_LITERALS` with a comment naming §7.1, and the length
 *      assertion below makes that growth visible rather than silent.
 *
 * **Deliberately not mechanized here**: "contested only of objects" / "parked
 * only of documents" is a register-correctness law, not a lexical ban — it
 * cannot be checked by a string scan without semantic tagging of what each
 * occurrence of the word refers to. This gate enforces the one bar that IS
 * mechanically checkable (the zero-"conflict" ban) and leaves the
 * register-correctness law to per-slice copy review against master §7's
 * deck, same as WS4 §5.1 records for its own authority-testimony strings.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** Every module this programme's authored copy can live in (master §8.2 G-C's
 *  own ten-file list). Slice tag is provenance only. */
const SCANNED_FILES: readonly { readonly path: string; readonly slice: string }[] = [
  { path: 'apps/organism/src/cell/source-status.ts', slice: '4' },
  { path: 'apps/organism/src/cell/resolution-flow.ts', slice: '6' },
  { path: 'apps/organism/src/cell/parked-work.ts', slice: '8' },
  { path: 'apps/organism/src/cell/contested-surface.ts', slice: '5' },
  { path: 'apps/organism/src/cell/reapply-controller.ts', slice: '9' },
  { path: 'packages/components/src/mn-lifetime-banner.ts', slice: '7' },
  { path: 'packages/components/src/mn-workspace-selector-model.ts', slice: '7' },
  { path: 'packages/runtime/src/layout/faces/card-object-face.ts', slice: '2' },
  { path: 'packages/runtime/src/layout/faces/object-card-view-element.ts', slice: '2/5' },
  { path: 'packages/source/src/mirror/source-fault.ts', slice: '3' },
  { path: 'packages/source/src/mirror/source-mirror.ts', slice: '3' },
  { path: 'packages/runtime/src/render-workspace.ts', slice: '2/5/8' },
]

/**
 * Whole-word literal VALUES exempted from the ban, keyed by exact string
 * content (not by file or line — one entry covers every occurrence of that
 * exact value across every scanned file). Length asserted below so growth is
 * visible; each entry is commented with the law section that admits it.
 */
const ALLOWED_LITERALS: readonly string[] = [
  // Wire fossil (master §5.2/§7.1): the `SourceMirrorPhase` and
  // `SourceOutboxStatus` wire value itself — never rendered to a user, and
  // never referred to as a product word ("contested"/"parked" are what the
  // shell renders instead). `source-mirror.ts`/`source-fault.ts` compare and
  // assign this literal directly.
  'conflict',
  // Wire fossil (master §7.1, §3 Slice 5): the RDF named-graph URN segment
  // Garden itself mints (`source_sync.rs:2003-2006`,
  // `{graph}:projection:sync-conflicts:{conflictId}`) — a subject IRI this
  // client only ever COMPARES against, never renders as a label.
  // `contested-surface.ts`'s `conflictsGraphPrefix` builds this prefix to
  // join a `sh-row-activate`d row back to its object identity.
  'urn:mnemosyne:local:graph:${graphId}:projection:sync-conflicts:',
]

/**
 * A minimal lexer, not a pair of regexes — a first draft used
 * backtick-to-backtick regexes for template literals and was falsified
 * immediately by its own first run: JSDoc comments in this very codebase use
 * single backticks as markdown code-spans (`` `enqueue` ``, `` `source-
 * mirror.ts:1080-1082` ``), and a regex with no concept of "inside a
 * comment" pairs one comment's stray backtick with the NEXT one, swallowing
 * everything between — including unrelated real string literals — as one
 * giant false "template literal". Comments are not authored copy in any
 * event (§7's copy deck is user-visible strings, never doc prose), so the
 * correct fix is a lexer that skips `//` and `/* *\/` spans entirely before
 * ever looking for a quote or a backtick, exactly as a real tokenizer would.
 * Regex literals are not specially recognised (none of the currently-scanned
 * files place an unescaped `'`/`"`/`` ` `` inside one); noted as a scoped
 * limitation, not a silent gap.
 */
function extractLiteralValues(source: string): readonly string[] {
  const values: string[] = []
  const n = source.length
  let i = 0
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      i += 2
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      let j = i + 1
      let value = ''
      while (j < n && source[j] !== quote) {
        if (source[j] === '\\') {
          value += source[j] + (source[j + 1] ?? '')
          j += 2
          continue
        }
        value += source[j]
        j++
      }
      values.push(value)
      i = j + 1
      continue
    }
    i++
  }
  return values
}

describe('product-copy-register — the terminology law (master §7.1, gate G-C)', () => {
  it('ALLOWED_LITERALS growth is visible (currently the two wire-fossil values)', () => {
    expect(ALLOWED_LITERALS).toEqual([
      'conflict',
      'urn:mnemosyne:local:graph:${graphId}:projection:sync-conflicts:',
    ])
  })

  for (const { path, slice } of SCANNED_FILES) {
    const absolute = resolve(ROOT, path)
    const exists = existsSync(absolute)
    const label = `${path} [slice ${slice}]${exists ? '' : ' — not built yet, skipped'}`
    if (!exists) {
      it.skip(label, () => {})
      continue
    }
    it(`${label} — no "conflict"/"conflicts" in authored copy outside the allowlist`, () => {
      const source = readFileSync(absolute, 'utf8')
      const offenders = extractLiteralValues(source).filter(
        (value) => /\bconflicts?\b/i.test(value) && !ALLOWED_LITERALS.includes(value),
      )
      expect(offenders).toEqual([])
    })
  }
})
