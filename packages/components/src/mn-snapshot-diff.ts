/**
 * mn-snapshot-diff - pure line-diff view for document history.
 *
 * Garden's source component wraps @pierre/diffs, a worker pool, and theme-store
 * observation. This Shrubbery lift keeps the registered tag and the comparison
 * surface while making the component controlled and backend/store-free.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'

export type MnSnapshotDiffStyle = 'split' | 'unified'
export type MnSnapshotLineDiffType = 'word-alt' | 'word' | 'char' | 'none'
export type MnSnapshotDiffLineKind = 'same' | 'added' | 'removed' | 'changed'

export interface MnSnapshotDiffLine {
  readonly index: number
  readonly older?: string
  readonly newer?: string
  readonly kind: MnSnapshotDiffLineKind
}

export interface MnSnapshotDiffAnnotation {
  readonly line: number
  readonly side?: 'older' | 'newer'
  readonly author?: string
  readonly text: string
  readonly createdAt?: string | number | Date
}

export function diffSnapshotLines(olderText: string, newerText: string): MnSnapshotDiffLine[] {
  const older = olderText.split(/\r?\n/)
  const newer = newerText.split(/\r?\n/)
  const length = Math.max(older.length, newer.length)
  const lines: MnSnapshotDiffLine[] = []
  for (let index = 0; index < length; index++) {
    const oldLine = older[index]
    const newLine = newer[index]
    let kind: MnSnapshotDiffLineKind
    if (oldLine === newLine) kind = 'same'
    else if (oldLine === undefined) kind = 'added'
    else if (newLine === undefined) kind = 'removed'
    else kind = 'changed'
    lines.push({ index: index + 1, older: oldLine, newer: newLine, kind })
  }
  return lines
}

function formatAnnotationTime(value: string | number | Date | null | undefined): string {
  if (value == null) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

@customElement('mn-snapshot-diff')
export class MnSnapshotDiff extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.55;
      box-sizing: border-box;
    }

    .shell {
      display: flex;
      min-height: 0;
      height: 100%;
      flex-direction: column;
      overflow: hidden;
      border-radius: var(--mn-radius-md, 6px);
      background: inherit;
    }

    .file-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #f8fafc);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
    }

    .file-header[data-style='unified'] {
      grid-template-columns: 1fr;
    }

    .file-name {
      min-width: 0;
      overflow: hidden;
      padding: 7px 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-name + .file-name {
      border-left: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .status {
      display: grid;
      min-height: 180px;
      flex: 1 1 auto;
      place-items: center;
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      text-align: center;
    }

    .diff {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }

    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      min-height: 100%;
    }

    .side + .side {
      border-left: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .line {
      display: grid;
      grid-template-columns: 3.75rem minmax(0, 1fr);
      min-height: 22px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      white-space: pre-wrap;
    }

    .line-group {
      display: contents;
    }

    .line[data-kind='same'] {
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .line[data-kind='added'] {
      background: rgba(22, 163, 74, 0.12);
    }

    .line[data-kind='removed'] {
      background: rgba(220, 38, 38, 0.1);
    }

    .line[data-kind='changed'] {
      background: rgba(245, 158, 11, 0.13);
    }

    .line-no {
      padding: 2px 8px;
      color: var(--mn-color-text-muted, #9ca3af);
      text-align: right;
      user-select: none;
    }

    .line-text {
      min-width: 0;
      padding: 2px 8px;
      overflow-wrap: anywhere;
    }

    .unified .line {
      grid-template-columns: 3.75rem 1.8rem minmax(0, 1fr);
    }

    .sign {
      padding: 2px 4px;
      color: var(--mn-color-text-tertiary, #6b7280);
      text-align: center;
      user-select: none;
    }

    .annotation {
      margin: 4px 8px 6px 3.75rem;
      padding: 7px 9px;
      border-left: 3px solid var(--mn-color-border-accent, #2563eb);
      border-radius: 0 var(--mn-radius-sm, 4px) var(--mn-radius-sm, 4px) 0;
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
    }

    .annotation-head {
      display: flex;
      gap: 8px;
      margin-bottom: 3px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: 11px;
    }

    .annotation-author {
      color: var(--mn-color-accent-strong, #1d4ed8);
      font-weight: 700;
    }

    @media (max-width: 720px) {
      .file-header,
      .split {
        grid-template-columns: 1fr;
      }

      .file-name + .file-name,
      .side + .side {
        border-left: 0;
        border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }
    }
  `

  @property({ type: String }) olderText = ''
  @property({ type: String }) newerText = ''
  @property({ type: String }) oldName = 'previous.md'
  @property({ type: String }) newName = 'current.md'
  @property({ type: String }) diffStyle: MnSnapshotDiffStyle = 'split'
  @property({ type: String }) lineDiffType: MnSnapshotLineDiffType = 'word'
  @property({ attribute: false }) annotations: readonly MnSnapshotDiffAnnotation[] = []

  private _annotationsFor(line: MnSnapshotDiffLine, side?: 'older' | 'newer'): readonly MnSnapshotDiffAnnotation[] {
    return this.annotations.filter((annotation) => {
      if (annotation.line !== line.index) return false
      return !annotation.side || !side || annotation.side === side
    })
  }

  private _renderAnnotationBlock(annotation: MnSnapshotDiffAnnotation, side?: 'older' | 'newer'): TemplateResult {
    return html`
      <div class="annotation" data-side=${annotation.side ?? side ?? 'both'}>
        <div class="annotation-head">
          ${annotation.author ? html`<span class="annotation-author">${annotation.author}</span>` : nothing}
          ${annotation.createdAt ? html`<span>${formatAnnotationTime(annotation.createdAt)}</span>` : nothing}
        </div>
        <div>${annotation.text}</div>
      </div>
    `
  }

  private _renderAnnotationBlocks(
    annotations: readonly MnSnapshotDiffAnnotation[],
    side?: 'older' | 'newer',
  ): TemplateResult | typeof nothing {
    if (!annotations.length) return nothing
    if (annotations.length === 1) return this._renderAnnotationBlock(annotations[0], side)
    return html`${annotations.map((annotation) => this._renderAnnotationBlock(annotation, side))}`
  }

  private _renderAnnotations(line: MnSnapshotDiffLine, side?: 'older' | 'newer'): TemplateResult | typeof nothing {
    const annotations = this._annotationsFor(line, side)
    return this._renderAnnotationBlocks(annotations, side)
  }

  private _renderSideLine(line: MnSnapshotDiffLine, side: 'older' | 'newer'): TemplateResult {
    const text = side === 'older' ? line.older : line.newer
    let kind: MnSnapshotDiffLineKind = 'same'
    if (line.kind === 'changed') kind = 'changed'
    if (line.kind === 'removed' && side === 'older') kind = 'removed'
    if (line.kind === 'added' && side === 'newer') kind = 'added'
    const lineNumber = text === undefined ? '' : line.index
    const annotations = this._annotationsFor(line, side)
    return html`
      <div class="line-group" data-line=${line.index}>
        <div class="line" data-kind=${kind} data-side=${side} data-annotation-count=${annotations.length}>
          <span class="line-no">${lineNumber}</span>
          <span class="line-text">${text ?? ''}</span>
        </div>
        ${this._renderAnnotationBlocks(annotations, side)}
      </div>
    `
  }

  private _renderUnifiedLine(line: MnSnapshotDiffLine): TemplateResult {
    if (line.kind === 'changed') {
      return html`
        <div class="line-group" data-line=${line.index}>
          <div class="line" data-kind="removed">
            <span class="line-no">${line.index}</span>
            <span class="sign">-</span>
            <span class="line-text">${line.older ?? ''}</span>
          </div>
          <div class="line" data-kind="added">
            <span class="line-no">${line.index}</span>
            <span class="sign">+</span>
            <span class="line-text">${line.newer ?? ''}</span>
          </div>
          ${this._renderAnnotations(line)}
        </div>
      `
    }
    const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ''
    const text = line.kind === 'removed' ? line.older : line.newer
    return html`
      <div class="line-group" data-line=${line.index}>
        <div class="line" data-kind=${line.kind}>
          <span class="line-no">${line.index}</span>
          <span class="sign">${sign}</span>
          <span class="line-text">${text ?? ''}</span>
        </div>
        ${this._renderAnnotations(line)}
      </div>
    `
  }

  render(): TemplateResult {
    const lines = diffSnapshotLines(this.olderText, this.newerText)
    const changed = lines.some((line) => line.kind !== 'same')
    if (!changed) {
      return html`
        <div class="shell">
          <div class="status">No changes between these two versions.</div>
        </div>
      `
    }

    return html`
      <div class="shell">
        <div class="file-header" data-style=${this.diffStyle}>
          ${this.diffStyle === 'unified'
            ? html`<span class="file-name">${this.oldName} -> ${this.newName}</span>`
            : html`
              <span class="file-name">${this.oldName}</span>
              <span class="file-name">${this.newName}</span>
            `}
        </div>
        <div class="diff">
          ${this.diffStyle === 'unified'
            ? html`<div class="unified">${repeat(lines, (line) => line.index, (line) => this._renderUnifiedLine(line))}</div>`
            : html`
              <div class="split">
                <div class="side" data-side="older">
                  ${repeat(lines, (line) => line.index, (line) => this._renderSideLine(line, 'older'))}
                </div>
                <div class="side" data-side="newer">
                  ${repeat(lines, (line) => line.index, (line) => this._renderSideLine(line, 'newer'))}
                </div>
              </div>
            `}
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-snapshot-diff': MnSnapshotDiff
  }
}
