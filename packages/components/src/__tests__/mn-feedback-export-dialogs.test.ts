/**
 * REAL component tests - Garden feedback/export dialogs lifted as controlled UI.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-feedback-form.js'
import '../mn-export-dialog.js'
import type {
  MnFeedbackCloseDetail,
  MnFeedbackForm,
  MnFeedbackSubmitDetail,
} from '../mn-feedback-form.js'
import type {
  MnExportActionDetail,
  MnExportDialog,
} from '../mn-export-dialog.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mountFeedback(setup?: (el: MnFeedbackForm) => void): Promise<MnFeedbackForm> {
  const el = document.createElement('mn-feedback-form') as MnFeedbackForm
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  await (sr(el).querySelector('mn-modal') as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete
  return el
}

async function mountExport(setup?: (el: MnExportDialog) => void): Promise<MnExportDialog> {
  const el = document.createElement('mn-export-dialog') as MnExportDialog
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-feedback-form / mn-export-dialog', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers the Garden feedback and export tags', () => {
    expect(customElements.get('mn-feedback-form')).toBeDefined()
    expect(customElements.get('mn-export-dialog')).toBeDefined()
  })

  it('mn-feedback-form submits trimmed typed feedback and rating aliases', async () => {
    const el = await mountFeedback()
    const submits: MnFeedbackSubmitDetail[] = []
    const aliases: MnFeedbackSubmitDetail[] = []
    el.addEventListener('mn-submit', event => {
      submits.push((event as CustomEvent<MnFeedbackSubmitDetail>).detail)
    })
    el.addEventListener('mn-feedback-submit', event => {
      aliases.push((event as CustomEvent<MnFeedbackSubmitDetail>).detail)
    })

    const chips = sr(el).querySelectorAll<HTMLButtonElement>('.type-chip')
    chips[1]!.click()
    ;(sr(el).querySelectorAll<HTMLButtonElement>('.star')[3]!).click()

    const textarea = sr(el).querySelector<HTMLTextAreaElement>('.textarea')!
    textarea.value = '  The graph picker needs clearer errors.  '
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await el.updateComplete

    expect(sr(el).querySelector('.type-chip.selected')?.textContent).toContain('Bug Report')
    expect(sr(el).querySelector('.char-count')?.textContent).toContain('42 / 5000')
    ;(sr(el).querySelectorAll('mn-button')[1] as HTMLElement).click()

    expect(submits).toEqual([
      {
        content: 'The graph picker needs clearer errors.',
        feedbackType: 'bug',
        rating: 4,
      },
    ])
    expect(aliases).toEqual(submits)
  })

  it('mn-feedback-form blocks short content, clamps max length, and closes with reset', async () => {
    const el = await mountFeedback(node => {
      node.maxLength = 12
    })
    const submits: MnFeedbackSubmitDetail[] = []
    const closes: MnFeedbackCloseDetail[] = []
    el.addEventListener('mn-submit', event => {
      submits.push((event as CustomEvent<MnFeedbackSubmitDetail>).detail)
    })
    el.addEventListener('mn-feedback-close', event => {
      closes.push((event as CustomEvent<MnFeedbackCloseDetail>).detail)
    })

    const textarea = sr(el).querySelector<HTMLTextAreaElement>('.textarea')!
    textarea.value = 'too long for this box'
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await el.updateComplete

    expect(el.content).toBe('too long for')
    expect(sr(el).querySelector('.char-count')?.classList.contains('error')).toBe(true)

    el.content = 'short'
    await el.updateComplete
    ;(sr(el).querySelectorAll('mn-button')[1] as HTMLElement).click()
    expect(submits).toEqual([])

    ;(sr(el).querySelectorAll('mn-button')[0] as HTMLElement).click()
    expect(closes).toEqual([{ reason: 'cancel' }])
    expect(el.content).toBe('')
    expect(el.feedbackType).toBe('general')
    expect(el.rating).toBeNull()
  })

  it('mn-export-dialog renders preview, swatches, copy status, and emits action intents', async () => {
    const el = await mountExport(node => {
      node.documentTitle = 'Garden Plan'
      node.htmlContent = '<h1>Garden Plan</h1>'
      node.selectedTheme = 'garden'
      node.copyStatus = 'success'
    })
    const themeSelections: MnExportActionDetail[] = []
    const actions: MnExportActionDetail[] = []
    el.addEventListener('mn-export-theme-select', event => {
      themeSelections.push((event as CustomEvent<MnExportActionDetail>).detail)
    })
    for (const type of ['mn-export-copy-markdown', 'mn-export-download-markdown', 'mn-export-print', 'mn-export-download-html']) {
      el.addEventListener(type, event => {
        actions.push((event as CustomEvent<MnExportActionDetail>).detail)
      })
    }

    expect(sr(el).querySelector('.title')?.textContent).toContain('Export "Garden Plan"')
    expect(sr(el).querySelectorAll('.theme-option')).toHaveLength(5)
    expect(sr(el).querySelector('.theme-option[aria-selected="true"]')?.textContent).toContain('Garden')
    expect(sr(el).querySelector<HTMLIFrameElement>('iframe')?.srcdoc).toBe('<h1>Garden Plan</h1>')
    expect(sr(el).querySelector('.copy-success')?.textContent).toContain('Copied!')

    ;(sr(el).querySelectorAll<HTMLButtonElement>('.theme-option')[1]!).click()
    for (const button of sr(el).querySelectorAll<HTMLButtonElement>('.footer .action-button')) {
      button.click()
    }

    expect(themeSelections).toEqual([{ action: 'theme', documentTitle: 'Garden Plan', themeId: 'manuscript' }])
    expect(actions).toEqual([
      { action: 'copy-markdown', documentTitle: 'Garden Plan' },
      { action: 'download-markdown', documentTitle: 'Garden Plan' },
      { action: 'print', documentTitle: 'Garden Plan' },
      { action: 'download-html', documentTitle: 'Garden Plan' },
    ])
  })

  it('mn-export-dialog shows loading/error states, disables actions, and closes by overlay', async () => {
    const loading = await mountExport(node => {
      node.loading = true
      node.documentTitle = 'Loading Doc'
    })
    expect(sr(loading).querySelector('.loading-container')?.textContent).toContain('Rendering preview')
    expect(Array.from(sr(loading).querySelectorAll<HTMLButtonElement>('.footer .action-button')).every(button => button.disabled)).toBe(true)

    const errored = await mountExport(node => {
      node.documentTitle = 'Broken Doc'
      node.error = 'No active document'
    })
    const closes: MnExportActionDetail[] = []
    errored.addEventListener('mn-export-close', event => {
      closes.push((event as CustomEvent<MnExportActionDetail>).detail)
    })

    expect(sr(errored).querySelector('[role="alert"]')?.textContent).toBe('No active document')
    expect(Array.from(sr(errored).querySelectorAll<HTMLButtonElement>('.footer .action-button')).every(button => button.disabled)).toBe(true)
    ;(sr(errored).querySelector('.overlay') as HTMLElement).click()

    expect(closes).toEqual([{ action: 'close', documentTitle: 'Broken Doc' }])

    errored.open = false
    await errored.updateComplete
    expect(sr(errored).querySelector('.dialog')).toBeNull()
  })
})
