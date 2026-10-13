/**
 * The Files pane (design §12.1): header (where you are, the face switch, the view, New folder, Upload), the center (the
 * canvas, the list, or the opened file) and one status line at the foot. Rendered with Lit into happy-dom.
 */
import { describe, expect, it } from 'vitest'
import { render } from 'lit'
import type { FileEvidence, FolderViewScope } from '@shrubbery/nucleus'
import { renderFilesPane, type WorkspaceFilesOptions } from '../../files-pane.js'

const scope: FolderViewScope = { ownerId: 'o', graphId: 'g', graphIncarnation: 'i', folderId: 'f1', viewId: 'files-default', audience: { kind: 'shared' } }

function options(partial: Partial<WorkspaceFilesOptions> = {}): { value: WorkspaceFilesOptions; calls: string[] } {
  const calls: string[] = []
  const value: WorkspaceFilesOptions = {
    graphId: 'g',
    breadcrumbs: [{ id: null, label: 'Files' }, { id: 'f1', label: 'Datasheets' }],
    face: 'canvas',
    iconSize: 'medium',
    snapToGrid: false,
    canvas: { scope, nodes: [], placements: [], session: { selected: [], camera: { x: 0, y: 0, zoom: 1 }, editingName: null }, onIntent: () => {} },
    rows: [],
    preview: null,
    canUpload: true,
    canCreate: true,
    canChangeView: true,
    maxUploadLabel: '50 MB',
    status: { text: '3 items', message: '', undoLabel: null, tone: 'info' },
    banner: null,
    onNavigate: id => calls.push(`navigate:${id}`),
    onUpload: files => calls.push(`upload:${files.map(f => f.name).join(',')}`),
    onNewFolder: () => calls.push('new-folder'),
    onFace: face => calls.push(`face:${face}`),
    onIconSize: size => calls.push(`icon:${size}`),
    onSnapToGrid: on => calls.push(`snap:${on}`),
    onUndo: () => calls.push('undo'),
    onClosePreview: () => calls.push('close'),
    onDownload: () => calls.push('download'),
    onRowSelect: (keys, mode) => calls.push(`row:${keys.join(',')}:${mode}`),
    onRowOpen: key => calls.push(`open:${key}`),
    onRowMenu: (keys) => calls.push(`menu:${keys.join(',')}`),
    ...partial,
  }
  return { value, calls }
}

function mount(value: WorkspaceFilesOptions): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  render(renderFilesPane(value), host)
  return host
}

describe('the Files pane', () => {
  it('shows where you are, and a breadcrumb navigates', () => {
    const { value, calls } = options()
    const host = mount(value)
    const crumbs = [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Folder path"] button')]
    expect(crumbs.map(b => b.textContent?.trim())).toEqual(['Files', 'Datasheets'])
    expect(crumbs[1]!.getAttribute('aria-current')).toBe('location')
    crumbs[0]!.click()
    expect(calls).toEqual(['navigate:null'])
  })

  it('draws the canvas face as <mn-files-canvas>, the list face as a list, never both', () => {
    const canvas = mount(options().value)
    expect(canvas.querySelectorAll('mn-files-canvas')).toHaveLength(1)
    expect(canvas.querySelector('[role="grid"]')).toBeNull()
    const list = mount(options({ face: 'list', rows: [
      { key: 'folder:f2', label: 'Old', kind: 'folder', type: 'Folder', selected: false },
      { key: 'artifact:a', label: 'Spec.pdf', kind: 'file', type: 'PDF', selected: true },
    ] }).value)
    expect(list.querySelector('mn-files-canvas')).toBeNull()
    const rows = [...list.querySelectorAll('[role="row"][data-key]')]
    expect(rows.map(r => r.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    expect(rows.map(r => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Old Folder', 'Spec.pdf PDF'])
  })

  it('switches the face and the icon size through the shell, which saves them', () => {
    const { value, calls } = options()
    const host = mount(value)
    host.querySelector<HTMLButtonElement>('[role="radio"][data-face="list"]')!.click()
    host.querySelector<HTMLSelectElement>('select[aria-label="Icon size"]')!.value = 'large'
    host.querySelector<HTMLSelectElement>('select[aria-label="Icon size"]')!.dispatchEvent(new Event('change'))
    host.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="Snap to grid"]')!.click()
    expect(calls).toEqual(['face:list', 'icon:large', 'snap:true'])
  })

  it('uploads any file from the button, says the limit, and offers New folder', () => {
    const { value, calls } = options()
    const host = mount(value)
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input.multiple).toBe(true)
    expect(input.getAttribute('accept')).toBeNull()
    expect(host.querySelector('button[data-action="upload"]')!.getAttribute('title')).toBe('Upload files (up to 50 MB each)')
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.zip'), new File(['y'], 'b.exe')] })
    input.dispatchEvent(new Event('change'))
    host.querySelector<HTMLButtonElement>('button[data-action="new-folder"]')!.click()
    expect(calls).toEqual(['upload:a.zip,b.exe', 'new-folder'])
  })

  it('hides Upload, New folder and the view controls when the shell cannot honour them', () => {
    const host = mount(options({ canUpload: false, canCreate: false, canChangeView: false }).value)
    expect(host.querySelector('button[data-action="upload"]')).toBeNull()
    expect(host.querySelector('button[data-action="new-folder"]')).toBeNull()
    expect(host.querySelector('select[aria-label="Icon size"]')).toBeNull()
  })

  it('has one status line, a polite live region, with Undo from the announcement', () => {
    const { value, calls } = options({ status: { text: '3 items · 1 selected', message: 'Moved “a.txt” to the trash.', undoLabel: 'Undo', tone: 'info' } })
    const host = mount(value)
    const status = host.querySelectorAll('[role="status"]')
    expect(status).toHaveLength(1)
    expect(status[0]!.getAttribute('aria-live')).toBe('polite')
    expect(status[0]!.textContent).toContain('Moved “a.txt” to the trash.')
    host.querySelector<HTMLButtonElement>('footer button[data-action="undo"]')!.click()
    expect(calls).toEqual(['undo'])
  })

  it('opens a PDF in the original-page viewer, an image as a picture, and anything else as its file page with one Download', () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    const pdf = mount(options({ preview: { kind: 'pdf', name: 'Spec.pdf', status: 'ready', error: '', data: bytes, fileKey: 'file-spec' } }).value)
    const viewer = pdf.querySelector('mn-pdf-reader') as HTMLElement & { data: Uint8Array | null; fileKey: string; name: string }
    expect(viewer).not.toBeNull()
    expect([viewer.data, viewer.fileKey, viewer.name]).toEqual([bytes, 'file-spec', 'Spec.pdf'])
    expect(pdf.querySelector('mn-files-canvas')).toBeNull()

    const image = mount(options({ preview: { kind: 'image', name: 'photo.png', status: 'ready', error: '', url: 'blob:img' } }).value)
    const img = image.querySelector('img')!
    expect([img.getAttribute('src'), img.getAttribute('alt')]).toEqual(['blob:img', 'photo.png'])

    const { value, calls } = options({ preview: { kind: 'file', name: 'archive.zip', status: 'ready', error: '', typeLabel: 'ZIP archive', caption: 'ZIP',
      size: '4 KB', modified: 'Oct 8, 2026, 4:00 PM' } })
    const card = mount(value)
    expect(card.querySelector('[data-viewer="file"] h2')!.textContent).toBe('archive.zip')
    expect(card.querySelector('[data-field="kind"]')!.textContent).toBe('ZIP archive')
    expect(card.querySelector('[data-field="size"]')!.textContent).toBe('4 KB')
    expect(card.querySelector('[data-field="modified"]')!.textContent).toBe('Oct 8, 2026, 4:00 PM')
    // One Download, on the page (the reader row does not repeat it); nothing was downloaded until it was pressed.
    expect(card.querySelectorAll('button[data-action="download"]').length).toBe(1)
    expect(calls).toEqual([])
    card.querySelector<HTMLButtonElement>('button[data-action="download"]')!.click()
    card.querySelector<HTMLButtonElement>('button[data-action="back"]')!.click()
    expect(calls).toEqual(['download', 'close'])
  })

  it('a file Hoja renders: the reader row says its kind, HTML has a Source switch, a long text says how much is shown', () => {
    const calls: string[] = []
    const { value } = options({ preview: { kind: 'reader', name: 'page.html', status: 'ready', error: '', label: 'HTML',
      view: { variant: 'prose', html: '<p>Hello</p>' }, source: false, truncated: { shown: '2 MB', total: '7.3 MB' } } })
    const host = mount({ ...value, onPreviewSource: on => calls.push(`source:${on}`), onPreviewShowAll: () => calls.push('all') })
    expect(host.querySelector('[data-kind-label]')!.textContent).toBe('HTML')
    const reader = host.querySelector('hoja-reader') as HTMLElement & { html: string | null }
    expect(reader.getAttribute('variant')).toBe('prose')
    expect(reader.html).toBe('<p>Hello</p>')
    expect(host.querySelector('[data-truncated]')!.textContent).toContain('Showing the first 2 MB of 7.3 MB.')
    host.querySelector<HTMLButtonElement>('button[data-action="source"]')!.click()
    host.querySelector<HTMLButtonElement>('button[data-action="show-all"]')!.click()
    expect(calls).toEqual(['source:true', 'all'])
  })

  it('audio and video play natively from their blob: URL; an SVG is an <img>, never inline DOM', () => {
    const audio = mount(options({ preview: { kind: 'media', name: 'tone.wav', status: 'ready', error: '', media: 'audio', url: 'blob:a', mimeType: 'audio/wav' } }).value)
    expect(audio.querySelector('audio')!.getAttribute('src')).toBe('blob:a')
    const video = mount(options({ preview: { kind: 'media', name: 'clip.webm', status: 'ready', error: '', media: 'video', url: 'blob:v', mimeType: 'video/webm' } }).value)
    expect(video.querySelector('video')!.getAttribute('src')).toBe('blob:v')
    const svg = mount(options({ preview: { kind: 'media', name: 'logo.svg', status: 'ready', error: '', media: 'svg', url: 'blob:s', mimeType: 'image/svg+xml' } }).value)
    expect(svg.querySelector('img')!.getAttribute('src')).toBe('blob:s')
    expect(svg.querySelector('[data-viewer="svg"] svg')).toBeNull()
  })

  it('shows a persistent condition once, above the center, not as a live message', () => {
    const host = mount(options({ banner: 'You can view this folder. Only editors can change it.' }).value)
    const banner = host.querySelector('[role="note"]')!
    expect(banner.textContent).toContain('Only editors can change it.')
    expect(banner.getAttribute('aria-live')).toBeNull()
  })
})

describe('the list face names in place', () => {
  const rows = [
    { key: 'artifact:a', label: 'draft.txt', kind: 'file' as const, type: 'TXT', selected: true, naming: { initial: 'draft.txt', error: null } },
    { key: 'artifact:b', label: 'other.txt', kind: 'file' as const, type: 'TXT', selected: false },
  ]

  it('draws an input on the row being named, labelled, holding the name', () => {
    const { value } = options({ face: 'list', canvas: null, rows })
    const host = mount(value)
    const input = host.querySelector<HTMLInputElement>('[data-key="artifact:a"] input.rename')
    expect(input).not.toBeNull()
    expect(input!.value).toBe('draft.txt')
    expect(input!.getAttribute('aria-label')).toBe('Name')
    expect(host.querySelector('[data-key="artifact:b"] input.rename')).toBeNull()
  })

  it('Enter commits the typed name through the shell; Escape cancels', () => {
    const { value, calls } = options({ face: 'list', canvas: null, rows,
      onRowRename: (key, name) => calls.push(`rename:${key}:${name}`), onRowRenameCancel: () => calls.push('rename-cancel') })
    const host = mount(value)
    const input = host.querySelector<HTMLInputElement>('input.rename')!
    input.value = 'final.txt'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(calls).toEqual(['rename:artifact:a:final.txt', 'rename-cancel'])
  })

  it('says why a name was refused, beside the input', () => {
    const { value } = options({ face: 'list', canvas: null,
      rows: [{ ...rows[0]!, naming: { initial: 'draft.txt', error: 'A name cannot be empty.' } }] })
    const host = mount(value)
    const input = host.querySelector<HTMLInputElement>('input.rename')!
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('[data-key="artifact:a"] [role="alert"]')?.textContent).toBe('A name cannot be empty.')
  })
})

describe('the opened PDF', () => {
  it('is a page: one row (Back, name, Reload, one Download), no bar of its own; the reader brings its own toolbar and says its page and overlay', () => {
    const { value, calls } = options({ onReloadPreview: () => calls.push('reload'), onPdfPage: (n, c) => calls.push(`page ${n}/${c}`),
      onAssertionSelect: (id, page) => calls.push(`select ${id}@${page}`), onOverlay: on => calls.push(`overlay ${on}`),
      preview: { kind: 'pdf', name: 'Spec.pdf', status: 'ready', error: '', data: new Uint8Array([1]), fileKey: 'f' } })
    const host = mount(value)
    expect(host.querySelectorAll('.mn-files-pane > header').length).toBe(1)
    expect(host.querySelector('.opened > .bar')).toBeNull()
    expect(host.querySelectorAll('button[data-action="download"]').length).toBe(1)
    host.querySelector<HTMLButtonElement>('button[data-action="reload"]')!.click()
    host.querySelector<HTMLButtonElement>('button[data-action="download"]')!.click()
    const reader = host.querySelector('mn-pdf-reader')!
    reader.dispatchEvent(new CustomEvent('pdf-page-change', { detail: { page: 4, pageCount: 9 } }))
    reader.dispatchEvent(new CustomEvent('assertion-select', { detail: { id: 'c1', page: 4 } }))
    reader.dispatchEvent(new CustomEvent('assertion-overlay-change', { detail: { on: true } }))
    reader.dispatchEvent(new CustomEvent('pdf-retry'))
    expect(calls).toEqual(['reload', 'download', 'page 4/9', 'select c1@4', 'overlay true', 'reload'])
  })

  it('keeps Reload when the file failed to load, and hands the error to the reader', () => {
    const { value, calls } = options({ onReloadPreview: () => calls.push('reload'),
      preview: { kind: 'pdf', name: 'Spec.pdf', status: 'error', error: 'boom' } })
    const host = mount(value)
    host.querySelector<HTMLButtonElement>('button[data-action="reload"]')!.click()
    expect((host.querySelector('mn-pdf-reader') as HTMLElement & { error: string }).error).toBe('boom')
    expect(calls).toEqual(['reload'])
  })

  it('is one toolbar in the header, one Tab stop', async () => {
    const { value } = options()
    const host = mount(value)
    await new Promise(r => setTimeout(r, 0))
    const header = host.querySelector('.mn-files-pane > header')!
    expect(header.getAttribute('role')).toBe('toolbar')
    const items = [...header.querySelectorAll<HTMLElement>('button, select, input:not([type="file"])')]
    expect(items.length).toBeGreaterThan(3)
    expect(items.filter(i => i.tabIndex === 0)).toHaveLength(1)
  })

  it('says an empty folder the same way in the list, with no second Add (the header Upload is the one)', () => {
    const { value, calls } = options({ face: 'list', canvas: null, rows: [] })
    const host = mount(value)
    expect(host.querySelectorAll('[data-empty]')).toHaveLength(1)
    expect(host.querySelector('[data-empty]')!.textContent).toContain('This folder is empty. Drop files here, or use Upload.')
    expect(host.querySelector('[data-empty] button')).toBeNull()      // the header's Upload is the one Add
    expect(host.querySelectorAll('[data-action="upload"]')).toHaveLength(1)
    void calls
    const readOnly = mount(options({ face: 'list', canvas: null, rows: [], canUpload: false }).value)
    expect(readOnly.querySelector('[data-empty] button')).toBeNull()
    expect(readOnly.querySelector('[data-empty]')!.textContent).toContain('This folder is empty.')
  })
})

const sheet = (p: Partial<FileEvidence> = {}): FileEvidence => ({
  kind: 'datasheet', title: 'TPS62840', subtitle: [{ text: 'Texas Instruments' }], state: 'read', doneBadge: 'Read · 212 rows', summary: '', lookable: false,
  values: [], cells: [{ header: 'Part', width: '7rem', text: 'TPS62840', strong: true }, { header: 'Maker', width: '9rem', text: 'Texas Instruments' },
    { header: 'Key value', width: '10rem', label: 'VIN', text: '1.8–6.5 V', mark: 'high' }], ...p,
})

describe('datasheets in the list face', () => {
  const rows = [
    { key: 'artifact:a', label: 'TPS62840.pdf', kind: 'file' as const, type: 'PDF', selected: false, evidence: sheet() },
    { key: 'artifact:b', label: 'Plain.pdf', kind: 'file' as const, type: 'PDF', selected: false },
  ]

  it('gains Part, Maker, Key value and Status when the place holds datasheets; a plain PDF keeps empty cells', () => {
    const host = mount(options({ face: 'list', canvas: null, rows }).value)
    expect(host.querySelector('.list')!.classList.contains('has-evidence')).toBe(true)
    expect([...host.querySelectorAll('.head [role="columnheader"]')].map(c => c.textContent)).toEqual(['Name', 'Type', 'Part', 'Maker', 'Key value', 'Status', 'Size'])
    const [sheetRow, plainRow] = [...host.querySelectorAll('[role="row"][data-key]')]
    expect([...sheetRow!.querySelectorAll('[role="gridcell"]')].map(c => c.textContent!.trim())).toEqual(
      ['TPS62840.pdf', 'PDF', 'TPS62840', 'Texas Instruments', 'VIN1.8–6.5 V●●●', 'Read · 212 rows', ''])
    expect(sheetRow!.querySelector('.mark')!.getAttribute('aria-label')).toBe('independent statements agree')
    expect(plainRow!.querySelectorAll('[role="gridcell"]')).toHaveLength(7)
    expect(plainRow!.querySelector('.strong')!.textContent).toBe('')
  })

  it('a place without datasheets has the three columns it always had', () => {
    const host = mount(options({ face: 'list', canvas: null, rows: [rows[1]!] }).value)
    expect(host.querySelector('.list')!.classList.contains('has-evidence')).toBe(false)
    expect([...host.querySelectorAll('.head [role="columnheader"]')].map(c => c.textContent)).toEqual(['Name', 'Type', 'Size'])
  })

  it('the Needs a look filter is a toggle in the list header only, and an empty result says so rather than "empty folder"', () => {
    const calls: boolean[] = []
    const needsLook = { on: false, count: 2, onToggle: (on: boolean) => calls.push(on) }
    const host = mount(options({ face: 'list', canvas: null, rows, needsLook }).value)
    const button = host.querySelector<HTMLButtonElement>('[data-action="needs-look"]')!
    expect(button.textContent).toBe('Needs a look · 2')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    button.click()
    expect(calls).toEqual([true])
    expect(mount(options({ needsLook }).value).querySelector('[data-action="needs-look"]')).toBeNull()      // not on the canvas face
    const none = mount(options({ face: 'list', canvas: null, rows: [], needsLook: { ...needsLook, on: true } }).value)
    expect(none.querySelector('[data-empty-filter]')!.textContent).toContain('Nothing here needs a look')
    expect(none.querySelector('[data-empty]')).toBeNull()
  })
})

describe('the status line while reading', () => {
  it('renders busy as a pulse and aria-busy, and the action as a button', () => {
    const calls: string[] = []
    const host = mount(options({ status: { text: '12 items · 2 reading', message: 'Reading TPS62840.pdf, page 20 of 38', undoLabel: null, busy: true,
      action: { label: 'Open', onAction: () => calls.push('open') } } }).value)
    expect(host.querySelector('footer [role="status"]')!.getAttribute('aria-busy')).toBe('true')
    expect(host.querySelector('footer [data-busy]')).not.toBeNull()
    expect(host.querySelector('footer')!.textContent).toContain('12 items · 2 reading · Reading TPS62840.pdf, page 20 of 38')
    host.querySelector<HTMLButtonElement>('[data-action="status-action"]')!.click()
    expect(calls).toEqual(['open'])
  })
  it('is quiet when nothing is being read', () => {
    const host = mount(options().value)
    expect(host.querySelector('footer [role="status"]')!.getAttribute('aria-busy')).toBe('false')
    expect(host.querySelector('footer [data-busy]')).toBeNull()
    expect(host.querySelector('[data-action="status-action"]')).toBeNull()
  })
})
