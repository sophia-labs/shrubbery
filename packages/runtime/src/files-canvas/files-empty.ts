/**
 * The empty folder, said once for every face (review P1.6): the same words, and no button of its own.
 * The canvas and the list both render this; a face keeps only the layout around it.
 */
import { t } from '@shrubbery/nucleus'
import { html, type TemplateResult } from 'lit'

export const FILES_EMPTY_STYLE = `
  .files-empty { display: grid; justify-items: center; gap: var(--mn-space-2, 8px); text-align: center; color: var(--mn-color-text-secondary);
    font-size: var(--mn-text-sm, 12px); padding: var(--mn-space-4, 16px); }
  .files-empty p { margin: 0; }
  .files-empty button { font: inherit; font-size: var(--mn-text-sm, 12px); color: var(--mn-color-text-primary); background: var(--mn-color-surface-raised);
    border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-control, 6px); min-height: var(--mn-control-height, 28px);
    padding: 2px var(--mn-space-2, 8px); cursor: pointer; pointer-events: auto; }
  .files-empty button:focus-visible { outline: none; box-shadow: var(--mn-focus-ring); }
  .files-empty input[type='file'] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`

export function renderFilesEmpty(canAdd: boolean): TemplateResult {
  // The pane header's Upload is the one Add; the empty state only says what to do.
  return html`<div class="files-empty" data-empty>
    <p>${canAdd ? t('This folder is empty. Drop files here, or use Upload.') : t('This folder is empty.')}</p>
  </div>`
}
