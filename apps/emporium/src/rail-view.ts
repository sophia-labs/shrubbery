/**
 * rail-view.ts — the EMPORIUM packs RAIL: the sidebar that lists the live vocab
 * packs (the IA's primary navigation). SHELL-side (apps/emporium) + backend-free
 * presentation, exactly like the shared vocab-views: it consumes the render
 * package's VocabSummary shape and the GENERALIZED @shrubbery/components
 * primitives (mn-chip / mn-badge), composes them into a designed rail, and emits
 * navigation via callbacks — it never fetches.
 *
 * WHY a new shell-side view (not a library component): it consumes
 * @shrubbery/render TYPES (VocabSummary), which the island components package must
 * not import — same reasoning as vocab-views.ts. The general PRIMITIVES it
 * composes (mn-chip / mn-badge) stay in the library; only the Emporium-specific
 * rail VIEW lives here.
 *
 * Skin-aware for FREE: every primitive mirrors the ambient [data-skin] and
 * recolors via the inherited role tokens, so the Emporium skin paints the rail
 * purple/tight with no per-skin code here.
 *
 * Renders REAL rows only — an empty catalogue shows an honest empty rail (never a
 * faked pack).
 */

import { html, nothing, type TemplateResult } from 'lit'
import type { VocabSummary } from '@shrubbery/render'

// Register the general primitives this view stamps (idempotent barrel import).
import '@shrubbery/components'

/** Shorten a content hash for a badge label (full sha rides the title). */
function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 8) : '—'
}

export interface PacksRailOptions {
  /** The currently-selected pack name (highlighted), or undefined at the catalogue. */
  readonly activePack?: string
  /** Per-pack class count (name → count); a row omits the chip when absent. */
  readonly classCounts?: Readonly<Record<string, number>>
  /** Fired when a rail row is activated → navigate to that pack. */
  readonly onSelect?: (name: string) => void
  /** Fired when the rail masthead / "all packs" affordance is activated → catalogue. */
  readonly onHome?: () => void
}

/**
 * The packs RAIL — a header ("Vocabulary Packs" + count) and one interactive row
 * per live pack, each surfacing the pack's identity (name + title) and a compact
 * class-count chip + short-sha badge. The active pack row carries [aria-current].
 */
export function renderPacksRail(
  vocabs: readonly VocabSummary[],
  opts: PacksRailOptions = {},
): TemplateResult {
  return html`
    <div class="rail" part="rail">
      <button
        class="rail__head ${opts.activePack === undefined ? 'rail__head--active' : ''}"
        @click=${() => opts.onHome?.()}
        aria-label="All vocabulary packs"
      >
        <span class="rail__head-title">Vocabulary Packs</span>
        <mn-chip
          tone="muted"
          label=${`${vocabs.length}`}
          hint=${`${vocabs.length} ${vocabs.length === 1 ? 'pack' : 'packs'} served`}
        ></mn-chip>
      </button>

      ${vocabs.length === 0
        ? html`<p class="rail__empty">No vocabularies served by this cell (the live registry is empty).</p>`
        : html`<nav class="rail__list" aria-label="Vocabulary packs">
            ${vocabs.map((v) => renderRailRow(v, opts))}
          </nav>`}
    </div>
  `
}

/** One rail row — an interactive button surfacing the pack's live facts. */
function renderRailRow(v: VocabSummary, opts: PacksRailOptions): TemplateResult {
  const isActive = opts.activePack === v.name
  const classCount = opts.classCounts?.[v.name]
  return html`
    <button
      class="rail__row ${isActive ? 'rail__row--active' : ''}"
      data-pack=${v.name}
      aria-current=${isActive ? 'true' : nothing}
      @click=${() => opts.onSelect?.(v.name)}
    >
      <span class="rail__row-main">
        <span class="rail__row-name">${v.name}</span>
        <span class="rail__row-title">${v.title}</span>
      </span>
      <span class="rail__row-meta">
        <mn-chip tone="accent" glyph="v" label=${v.version} hint=${`version ${v.version}`}></mn-chip>
        ${classCount !== undefined
          ? html`<mn-chip
              tone="muted"
              label=${`${classCount}`}
              hint=${`${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
            ></mn-chip>`
          : nothing}
        <mn-badge state="success" glyph="#" label=${shortSha(v.sha)} hint=${`sha256 ${v.sha}`}></mn-badge>
      </span>
    </button>
  `
}
