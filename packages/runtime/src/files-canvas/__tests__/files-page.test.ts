/**
 * A file's page in the Files pane (Vera, 2026-10-13): the opened file's default face. Its head, its sections folded or open as the shell
 * says, a page link that asks for the source at that value, the table's filter, the notes editor, and the source drawn only when open.
 * Rendered with Lit into happy-dom.
 */
import { describe, expect, it } from 'vitest'
import { render } from 'lit'
import { renderFilesPane, type WorkspaceFilesOptions } from '../../files-pane.js'
import { compact, type FilesPanePage } from '../../files-page.js'

const page = (open: Partial<Record<string, boolean>> = {}): FilesPanePage => ({
  key: 'artifact:ds-1', name: 'ti-opa2134_DS.pdf', caption: 'PDF', title: 'OPA2134',
  chips: [{ text: 'OPA134' }, { text: 'OPA2134', current: true }, { text: 'OPA4134' }],
  lines: [{ text: 'Texas Instruments', title: 'Maker from the file name' }, { text: 'Datasheet' }, { text: '35 pages' }],
  sections: [
    { id: 'key-values', title: 'Key values', face: 'values', open: open['key-values'] ?? true, body: { face: 'values', values: [
      { id: 'ds-1-key-gainBandwidth', label: 'Gain bandwidth', symbol: 'GBW', text: '8 MHz', qualifier: 'typ', page: 7 },
      { id: 'ds-1-spec_rows-3', label: 'Input voltage', text: '1.45–5.5 V', page: 4, disputed: 'The readers disagree: prose read ?–5.5, ROC table read 1.45–5.5.' }] } },
    { id: 'notes', title: 'Your notes', face: 'notes', open: open.notes ?? true, body: { face: 'notes', notes: { status: 'empty', valueKey: 'g|ds-1|1', document: null, readOnly: false } } },
    { id: 'extracted', title: 'What we extracted', face: 'table', count: '2', open: open.extracted ?? true, body: { face: 'table', filter: '', total: 2, shown: 2, groups: [
      { id: 'electricalCharacteristic|electrical characteristics', title: 'Electrical Characteristics', rows: [
        { heading: 'Audio performance' },
        { id: 'ds-1-spec_rows-21', label: 'Total harmonic distortion plus noise', symbol: 'THD+N', when: 'f = 1kHz, G = 1', min: '', typ: '0.00008', max: '', unit: '%', page: 7 },
        { id: 'ds-1-spec_rows-30', label: 'Slew rate', symbol: 'SR', when: '', min: '', typ: '', max: '', unit: 'V/µs', page: 7 }] }] } },
    { id: 'source', title: 'Source PDF', face: 'source', open: open.source ?? false, body: { face: 'source' } },
    { id: 'reading', title: 'About this reading', face: 'facts', open: open.reading ?? false, body: { face: 'facts', rows: [
      { label: 'Reader', text: 'Read with datasheet-parser (NomDeTom) ee680a6 · Docling 2.135.0' },
      { label: 'Text the reader read', text: 'ti-opa2134_DS.text.txt', action: 'open:artifact:ds-1-text' }] } },
  ],
})

function options(p: FilesPanePage, calls: string[], extra: Partial<WorkspaceFilesOptions> = {}): WorkspaceFilesOptions {
  return {
    graphId: 'g', breadcrumbs: [{ id: null, label: 'Files' }], face: 'canvas', iconSize: 'medium', snapToGrid: false, canvas: null, rows: [],
    preview: { kind: 'pdf', name: 'ti-opa2134_DS.pdf', status: 'ready', error: '', data: new Uint8Array([1]), fileKey: 'ds-1', spotlight: { id: 'ds-1-key-gainBandwidth', nonce: 3 } },
    page: p, canUpload: false, canCreate: false, canChangeView: false, maxUploadLabel: '50 MB', status: { text: '20 items', message: '', undoLabel: null },
    onNavigate: () => {}, onUpload: () => {}, onNewFolder: () => {}, onFace: () => {}, onIconSize: () => {}, onSnapToGrid: () => {}, onUndo: () => {},
    onClosePreview: () => calls.push('back'),
    onPageSection: (id, open) => calls.push(`section:${id}:${open}`),
    onPageGoto: (id, n) => calls.push(`goto:${id}:${n}`),
    onPageAction: action => calls.push(`action:${action}`),
    onPageFilter: text => calls.push(`filter:${text}`),
    onNotesChange: d => calls.push(`notes:${d.isEmpty}`),
    ...extra,
  }
}

function mount(value: WorkspaceFilesOptions): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  render(renderFilesPane(value), host)
  return host
}

describe('a file\'s page', () => {
  it('says what the file is: the part large, the maker, type and pages, the family as chips; Back and the name in the row above', () => {
    const calls: string[] = []
    const host = mount(options(page(), calls))
    expect(host.querySelector('.fpage h1')!.textContent).toBe('OPA2134')
    expect([...host.querySelectorAll('.fp-lines span')].map(s => s.textContent)).toEqual(['Texas Instruments', 'Datasheet', '35 pages'])
    expect(host.querySelector('.fp-lines span')!.getAttribute('title')).toBe('Maker from the file name')
    expect([...host.querySelectorAll('.fp-chips li')].map(c => `${c.textContent}${c.hasAttribute('data-current') ? '*' : ''}`)).toEqual(['OPA134', 'OPA2134*', 'OPA4134'])
    expect(host.querySelector('.reader-row .title')!.textContent).toBe('ti-opa2134_DS.pdf')
    host.querySelector<HTMLButtonElement>('[data-action="back"]')!.click()
    expect(calls).toEqual(['back'])
  })

  it('draws its sections in order, folded ones as a title only; the source is not drawn (nor its PDF opened) while folded', () => {
    const host = mount(options(page(), []))
    expect([...host.querySelectorAll('.fp-sec')].map(s => `${s.getAttribute('data-section')}${s.hasAttribute('data-open') ? '' : ' (folded)'}`))
      .toEqual(['key-values', 'notes', 'extracted', 'source (folded)', 'reading (folded)'])
    expect(host.querySelector('mn-pdf-reader')).toBeNull()
    expect(host.querySelector('[data-section="source"] button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('a section title opens and folds it', () => {
    const calls: string[] = []
    const host = mount(options(page(), calls))
    host.querySelector<HTMLButtonElement>('[data-section="source"] h2 button')!.click()
    host.querySelector<HTMLButtonElement>('[data-section="key-values"] h2 button')!.click()
    expect(calls).toEqual(['section:source:true', 'section:key-values:false'])
  })

  it('key values: plain words, the typical said small, a page link each, and a disputed value marked quietly with why', () => {
    const calls: string[] = []
    const host = mount(options(page(), calls))
    const values = [...host.querySelectorAll('.fp-values li')]
    expect(values.map(v => v.querySelector('.vv')!.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['8 MHz typ', '1.45–5.5 V disputed'])
    expect(values[1]!.querySelector('[data-disputed]')!.getAttribute('title')).toMatch(/^The readers disagree/)
    expect(values[0]!.querySelector('[data-disputed]')).toBeNull()
    values[0]!.querySelector<HTMLButtonElement>('.fp-plink')!.click()
    expect(calls).toEqual(['goto:ds-1-key-gainBandwidth:7'])
  })

  it('what we extracted: the table\'s own heading as a heading, every number as printed, a row with nothing read says so, a filter', () => {
    const calls: string[] = []
    const host = mount(options(page(), calls))
    expect(host.querySelector('.fp-spec .group')!.textContent).toBe('Electrical Characteristics')
    expect(host.querySelector('.fp-spec .sub')!.textContent).toBe('Audio performance')
    const thd = host.querySelector('[data-row="ds-1-spec_rows-21"]')!
    expect(thd.querySelector('.ty')!.textContent).toBe('0.00008')
    expect(thd.querySelector('.all')!.textContent).toBe('0.00008 % typ')
    const empty = host.querySelector('[data-row="ds-1-spec_rows-30"]')!
    expect(empty.hasAttribute('data-empty')).toBe(true)
    expect(empty.querySelector('.all')!.textContent).toBe('not read')
    const filter = host.querySelector<HTMLInputElement>('.fp-filter input')!
    expect(filter.placeholder).toBe('Filter 2 values')
    filter.value = 'thd'
    filter.dispatchEvent(new Event('input'))
    expect(calls).toEqual(['filter:thd'])
  })

  it('your notes are a Hoja editor on the page; a fact with a verb says it back', () => {
    const calls: string[] = []
    const host = mount(options(page({ reading: true }), calls))
    const editor = host.querySelector('[data-section="notes"] hoja-editor') as HTMLElement & { readOnly: boolean; valueKey: string }
    expect(editor.getAttribute('posture')).toBe('page')
    expect([editor.readOnly, editor.valueKey]).toEqual([false, 'g|ds-1|1'])
    editor.dispatchEvent(new CustomEvent('hoja-change', { detail: { json: { type: 'doc' }, value: 'x', isEmpty: false } }))
    host.querySelector<HTMLButtonElement>('[data-section="reading"] [data-action="open:artifact:ds-1-text"]')!.click()
    expect(calls).toEqual(['notes:false', 'action:open:artifact:ds-1-text'])
  })

  it('an open source draws the viewer in its frame and hands it the value to show', () => {
    const host = mount(options(page({ source: true }), []))
    const reader = host.querySelector('[data-section="source"] .fp-source mn-pdf-reader') as HTMLElement & { spotlight: unknown; overlay: boolean }
    expect(reader).not.toBeNull()
    expect(reader.spotlight).toEqual({ id: 'ds-1-key-gainBandwidth', nonce: 3 })
    expect(reader.overlay).toBe(false)
  })

  it('compact: a row\'s slots in one phrase, with a true minus read as a range', () => {
    expect(compact({ min: '−40', typ: '', max: '125', unit: '°C' })).toBe('−40 to 125 °C')
    expect(compact({ min: '4.5', typ: '12', max: '28', unit: 'V' })).toBe('4.5–28 V (typ 12)')
    expect(compact({ min: '', typ: '', max: '36', unit: 'V' })).toBe('≤ 36 V')
    expect(compact({ min: '', typ: '8', max: '', unit: 'MHz' })).toBe('8 MHz typ')
  })
})
