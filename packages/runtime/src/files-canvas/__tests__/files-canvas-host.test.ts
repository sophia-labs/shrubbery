/**
 * The card plane host (`<mn-files-canvas>`): the DOM binding of the wave-1 reducer. These tests drive the real
 * element with real DOM events in happy-dom; only layout, which happy-dom does not compute, is given (the host's box).
 * Real gestures and real layout are witnessed in Chromium by apps/organism/scripts/files-rudiments-witness.mts.
 */
import { describe, expect, it } from 'vitest'
import type {
  FileCanvasIntent, FileCanvasSessionPatch, FilePlacementRecord, FolderViewScope, WorkspaceFileRef,
} from '@shrubbery/nucleus'
import '../files-canvas-host.js'
import { filesCanvasCapabilities, type FilesCanvasHostInput, type MnFilesCanvas } from '../files-canvas-host.js'

const scope: FolderViewScope = { ownerId: 'owner', graphId: 'graph', graphIncarnation: 'inc-1', folderId: null,
  viewId: 'files-default', audience: { kind: 'shared' } }
const ref = (kind: WorkspaceFileRef['kind'], id: string): WorkspaceFileRef =>
  ({ ownerId: 'owner', graphId: 'graph', graphIncarnation: 'inc-1', kind, id })
const place = (file: WorkspaceFileRef, x: number, y: number): FilePlacementRecord =>
  ({ schemaVersion: 1, scope, file, coordinateSpace: 'folder-canvas', x, y })

const A = ref('artifact', 'a')
const B = ref('artifact', 'b')
const F = ref('folder', 'f')
const ALL = { place: true, move: true, rename: true, create: true, add: true, remove: true, connect: false, openBeside: false }

interface Harness {
  el: MnFilesCanvas
  intents: FileCanvasIntent[]
  patches: FileCanvasSessionPatch[]
  set(patch: Partial<FilesCanvasHostInput>): Promise<void>
  root: ShadowRoot
}

async function mount(partial: Partial<FilesCanvasHostInput> = {}, box = { w: 800, h: 600 }): Promise<Harness> {
  const intents: FileCanvasIntent[] = []
  const patches: FileCanvasSessionPatch[] = []
  const el = document.createElement('mn-files-canvas') as MnFilesCanvas
  // happy-dom computes no layout: the host's box is the one fact given to it.
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: box.w, bottom: box.h, width: box.w, height: box.h,
    toJSON: () => ({}) }) as DOMRect
  document.body.append(el)
  let input: FilesCanvasHostInput = {
    scope,
    nodes: [{ file: A, label: 'Alpha.pdf', type: 'PDF' }, { file: B, label: 'Beta.png', type: 'PNG' }],
    placements: [place(A, 16, 16), place(B, 336, 16)],
    session: { selected: [], camera: { x: 0, y: 0, zoom: 1 }, editingName: null },
    capabilities: ALL,
    onIntent: intent => intents.push(intent),
    onSessionChange: patch => patches.push(patch),
    ...partial,
  }
  el.input = input
  await el.updateComplete
  return {
    el, intents, patches, root: el.shadowRoot!,
    async set(patch) { input = { ...input, ...patch }; el.input = input; await el.updateComplete },
  }
}

function pointer(target: Element, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse',
    bubbles: true, composed: true, cancelable: true, ...extra }))
}
function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...init }))
  target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, composed: true, cancelable: true, ...init }))
}
const plane = (h: Harness) => h.root.querySelector('.plane')!
const card = (h: Harness, file: WorkspaceFileRef) =>
  [...h.root.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.dataset.cardKey === JSON.stringify([file.ownerId, file.graphId, file.graphIncarnation, file.kind, file.id]))!
const selects = (h: Harness) => h.intents.filter((i): i is Extract<FileCanvasIntent, { kind: 'select' }> => i.kind === 'select')

describe('<mn-files-canvas>: the card plane', () => {
  it('draws one option per file in a listbox, named for a screen reader, with exactly one tab stop', async () => {
    const h = await mount()
    const list = h.root.querySelector('[role="listbox"]')!
    expect(list.getAttribute('aria-multiselectable')).toBe('true')
    expect(list.getAttribute('aria-label')).toBe('Folder canvas, 2 items')
    const options = [...h.root.querySelectorAll('[role="option"]')]
    expect(options.map(o => o.getAttribute('aria-label'))).toEqual(['Alpha.pdf, PDF', 'Beta.png, PNG'])
    expect(options.filter(o => o.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(card(h, A).querySelector('mn-file-glyph')?.getAttribute('type')).toBe('PDF')
  })

  it('places cards where their placement records say, in scene units under the camera transform', async () => {
    const h = await mount({ session: { selected: [], camera: { x: 10, y: 20, zoom: 2 }, editingName: null } })
    expect(card(h, B).style.left).toBe('336px')
    expect(card(h, B).style.top).toBe('16px')
    expect((h.root.querySelector('.scene') as HTMLElement).style.transform).toBe('translate(20px, 40px) scale(2)')
  })

  it('draws connectors from the input; handles and the connect verb exist only when the capabilities grant connect; open-beside stays off', async () => {
    const connections = [{ id: 'c1', source: A, target: B, relation: 'rel', label: 'cites', state: 'proposed' as const, attribution: null }]
    const viewOnly = await mount({ capabilities: { ...ALL, connect: false }, connections })
    // (the SVG paths are witnessed in Chromium by apps/organism/scripts/files-canvas-browser.mts; happy-dom does not build SVG fragments)
    expect(viewOnly.root.querySelector('.conn-label')?.textContent?.trim()).toBe('cites')
    expect(viewOnly.root.querySelector('.handle')).toBeNull()
    const h = await mount({ capabilities: { ...ALL, connect: true, openBeside: true }, connections, relations: [{ uri: 'rel', label: 'Cites' }] })
    expect(h.root.querySelectorAll('.handle').length).toBeGreaterThan(0)
    expect(filesCanvasCapabilities(h.el.input!)).toMatchObject({ connect: true, openBeside: false })
    card(h, A).focus()
    key(card(h, A), 'Enter', { altKey: true })
    expect(h.intents.some(i => i.kind === 'open' && i.beside)).toBe(false)
    // The layer toggle hides the wires without an intent.
    h.root.querySelector<HTMLButtonElement>('button[aria-label="Connections"]')!.click()
    await h.el.updateComplete
    expect(h.root.querySelector('.conn-label')).toBeNull()
    expect(h.intents.some(i => i.kind === 'disconnect')).toBe(false)
  })

  it('connectionsVisible false draws no connector at all', async () => {
    const h = await mount({ connections: [{ id: 'c1', source: A, target: B, relation: 'rel', label: 'cites', state: 'proposed', attribution: null }], connectionsVisible: false })
    expect(h.root.querySelector('.conn-label')).toBeNull()
  })

  it('finishes a marquee where the pointer is released, not at the last move delivered (exam finding 3)', async () => {
    const h = await mount()
    pointer(plane(h), 'pointerdown', 0, 0)
    pointer(plane(h), 'pointermove', 150, 140)
    expect(selects(h).at(-1)?.files.map(f => f.id)).toEqual(['a'])
    pointer(plane(h), 'pointerup', 500, 160, { buttons: 0 })
    expect(selects(h).at(-1)?.files.map(f => f.id)).toEqual(['a', 'b'])
    expect(h.root.querySelector('.marquee')).toBeNull()
  })

  it('asks for a new folder inside what is visible, not on the lattice off screen (exam finding 4)', async () => {
    const h = await mount({ session: { selected: [], camera: { x: -1000, y: 0, zoom: 1 }, editingName: null } })
    h.el.command('new-folder')
    const ask = h.intents.find((i): i is Extract<FileCanvasIntent, { kind: 'new-folder' }> => i.kind === 'new-folder')
    expect(ask).toBeDefined()
    expect(ask!.placement.x).toBeGreaterThanOrEqual(1000)
    expect(ask!.placement.x + 144).toBeLessThanOrEqual(1800)
    expect(ask!.placement.y + 128).toBeLessThanOrEqual(600)
    expect(h.patches.some(p => p.camera !== undefined)).toBe(false)
  })

  it('keeps the focused ghost when the shell echoes the file it stands for: Enter is a choice, not an open (the ghost key)', async () => {
    const h = await mount({
      nodes: [{ file: A, label: 'Alpha.pdf' }],
      placements: [],
      contests: [{ file: A, candidates: [
        { id: 'mine', x: 16, y: 16, origin: 'this-tab', label: 'this tab', at: 1 },
        { id: 'theirs', x: 400, y: 300, origin: 'other', label: 'other tab', at: 2 },
      ] }],
    })
    const list = h.root.querySelector('[role="listbox"]') as HTMLElement
    list.focus()
    key(list, 'End')
    await h.el.updateComplete
    const focused = h.patches.map(p => p.focused).filter(f => f !== undefined).at(-1)
    expect(focused?.id).toBe('a')
    const ghost = h.root.querySelector('[data-stance="contested"]') as HTMLElement
    expect(ghost.getAttribute('tabindex')).toBe('0')
    // The shell echoes the focus it heard: the file A.
    await h.set({ session: { selected: [], camera: { x: 0, y: 0, zoom: 1 }, editingName: null, focused: A } })
    key(ghost, 'Enter')
    expect(h.intents.at(-1)).toMatchObject({ kind: 'choose-placement', candidateId: 'theirs' })
    expect(h.intents.some(i => i.kind === 'open')).toBe(false)
  })

  it('names in place: F2 puts an input on the card, the canvas stays mounted, Enter emits one rename', async () => {
    const h = await mount()
    pointer(card(h, A), 'pointerdown', 88, 80)
    pointer(card(h, A), 'pointerup', 88, 80, { buttons: 0 })
    expect(selects(h).at(-1)?.files.map(f => f.id)).toEqual(['a'])
    await h.set({ session: { selected: [A], camera: { x: 0, y: 0, zoom: 1 }, editingName: null } })
    key(card(h, A), 'F2')
    await h.el.updateComplete
    const input = card(h, A).querySelector('input.name') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('Alpha.pdf')
    input.value = 'Alpha final.pdf'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }))
    expect(h.intents.filter(i => i.kind === 'rename')).toEqual([{ kind: 'rename', file: A, name: 'Alpha final.pdf' }])
    expect(document.body.contains(h.el)).toBe(true)
  })

  it('binds no key to a verb the shell cannot honour', async () => {
    const h = await mount({ capabilities: { ...ALL, rename: false, remove: false } })
    await h.set({ session: { selected: [A], camera: { x: 0, y: 0, zoom: 1 }, editingName: null, focused: A } })
    key(card(h, A), 'F2')
    key(card(h, A), 'Delete')
    await h.el.updateComplete
    expect(card(h, A).querySelector('input.name')).toBeNull()
    expect(h.intents.filter(i => i.kind === 'remove' || i.kind === 'rename')).toEqual([])
  })

  it('Delete asks to remove the selection when the shell can', async () => {
    const h = await mount()
    await h.set({ session: { selected: [A, B], camera: { x: 0, y: 0, zoom: 1 }, editingName: null, focused: A } })
    key(card(h, A), 'Delete')
    expect(h.intents.at(-1)).toEqual({ kind: 'remove', files: [A, B] })
  })

  it('a drag onto a folder is one move; a drag onto empty space is one place for the dragged card', async () => {
    const h = await mount({
      nodes: [{ file: A, label: 'Alpha.pdf' }, { file: F, label: 'Folder' }],
      placements: [place(A, 16, 16), place(F, 336, 16)],
    })
    pointer(card(h, A), 'pointerdown', 88, 80)
    await h.set({ session: { selected: [A], camera: { x: 0, y: 0, zoom: 1 }, editingName: null } })
    pointer(plane(h), 'pointermove', 300, 80)
    pointer(plane(h), 'pointermove', 400, 80)
    await h.el.updateComplete
    expect(card(h, F).hasAttribute('data-drop-target')).toBe(true)
    pointer(plane(h), 'pointerup', 400, 80, { buttons: 0 })
    expect(h.intents.filter(i => i.kind === 'move' || i.kind === 'place')).toEqual([{ kind: 'move', files: [A], folder: F }])

    pointer(card(h, A), 'pointerdown', 88, 80)
    pointer(plane(h), 'pointermove', 100, 300)
    pointer(plane(h), 'pointerup', 100, 400, { buttons: 0 })
    const placed = h.intents.filter((i): i is Extract<FileCanvasIntent, { kind: 'place' }> => i.kind === 'place')
    expect(placed).toHaveLength(1)
    expect(placed[0]!.placements.map(p => [p.file.id, p.x, p.y])).toEqual([['a', 28, 336]])
  })

  it('an OS drop adds into the folder card under the pointer, or into the viewed folder at the drop point', async () => {
    const h = await mount({
      nodes: [{ file: A, label: 'Alpha.pdf' }, { file: F, label: 'Folder' }],
      placements: [place(A, 16, 16), place(F, 336, 16)],
    })
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const drop = (x: number, y: number) => {
      const event = new Event('drop', { bubbles: true, composed: true, cancelable: true })
      Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y },
        dataTransfer: { value: { files: [file], types: ['Files'], dropEffect: 'none' } } })
      plane(h).dispatchEvent(event)
    }
    drop(400, 80)
    drop(100, 400)
    const adds = h.intents.filter((i): i is Extract<FileCanvasIntent, { kind: 'add' }> => i.kind === 'add')
    expect(adds.map(a => [a.folder?.id ?? null, a.placement ?? null, Array.from(a.files).map(f => f.name)])).toEqual([
      ['f', null, ['hello.txt']],
      [null, { x: 100, y: 400 }, ['hello.txt']],
    ])
  })

  it('owns the camera: a wheel pans it, and the shell hears the camera, not an intent', async () => {
    const h = await mount()
    plane(h).dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 50, clientX: 10, clientY: 10, bubbles: true, cancelable: true }))
    expect(h.patches.at(-1)?.camera).toEqual({ x: -30, y: -50, zoom: 1 })
    expect(h.intents).toEqual([])
    await h.el.updateComplete
    expect((h.root.querySelector('.scene') as HTMLElement).style.transform).toBe('translate(-30px, -50px) scale(1)')
  })

  it('locks a card whose placement is pending or contested, and says so on the card', async () => {
    const key0 = JSON.stringify(['owner', 'graph', 'inc-1', 'artifact', 'a'])
    const h = await mount({ placementStates: { [key0]: 'pending' } })
    expect(card(h, A).dataset.state).toBe('pending')
    expect(card(h, A).textContent).toContain('saving')
  })
})


describe('datasheet cards', () => {
  const sheet = {
    kind: 'datasheet', title: 'TPS62840', subtitle: [{ text: 'Texas Instruments' }, { text: '· Rev B', fixed: true }], state: 'read' as const,
    doneBadge: '1 disputed · 215 values', summary: '215 values, 1 disputed', cells: [], lookable: true,
    values: [{ label: 'VIN', text: '1.8–6.5 V', mark: 'high' as const }, { label: 'IOUT', text: '≤ 750 mA', mark: 'checked' as const }, { label: 'fSW', text: '1.8 MHz', mark: 'contested' as const }],
  }
  const nodes = (evidence?: object) => [{ file: A, label: 'TPS62840.pdf', type: 'PDF', ...(evidence ? { evidence } : {}) } as never,
    { file: B, label: 'Plain.pdf', type: 'PDF' }]

  it('shows the title large, subtitle beneath, three values (a mark only where the readers disagreed or a person checked), and the badge', async () => {
    const h = await mount({ nodes: nodes(sheet) })
    const card = h.root.querySelector('.card[data-card-key]')!
    expect(card.hasAttribute('data-evidence')).toBe(true)
    expect(card.querySelector('.part')!.textContent).toBe('TPS62840')
    expect(card.querySelector('.maker .by')!.textContent).toBe('Texas Instruments')
    expect(card.querySelector('.maker .rev')!.textContent).toBe('· Rev B')
    expect([...card.querySelectorAll('.value')].map(v => `${v.getAttribute('data-label')} ${v.querySelector('.v')!.textContent} ${v.querySelector('.mark')?.textContent ?? '-'}`))
      .toEqual(['VIN 1.8–6.5 V -', 'IOUT ≤ 750 mA ✓', 'fSW 1.8 MHz ⚠'])
    expect(card.querySelector('.annunciator')!.textContent).toBe('1 disputed · 215 values')
    expect(card.querySelector('mn-file-glyph')).toBeNull()
    expect(card.getAttribute('aria-label')).toContain('VIN 1.8–6.5 V, IOUT ≤ 750 mA, checked by a person, fSW 1.8 MHz, disputed: the readers disagree')
    expect(card.querySelector('.label')).not.toBeNull()      // the file's name stays a label: click-to-rename still has its target
  })

  it('a second kind needs no card code: any FileEvidence draws', async () => {
    const paper = { kind: 'paper', title: 'Attention Is All You Need', subtitle: [{ text: 'Vaswani et al.' }, { text: '· 2017', fixed: true }], state: 'read' as const,
      doneBadge: 'Read', summary: '', cells: [], lookable: false, values: [{ label: 'Venue', text: 'NeurIPS', mark: 'medium' as const }] }
    const h = await mount({ nodes: nodes(paper) })
    const card = h.root.querySelector('.card[data-card-key]')!
    expect(card.getAttribute('data-evidence')).toBe('')
    expect(card.querySelector('.sheet')!.getAttribute('data-kind')).toBe('paper')
    expect(card.querySelector('.part')!.textContent).toBe('Attention Is All You Need')
    expect(card.querySelector('.annunciator')!.textContent).toBe('Read')
  })

  it('a plain PDF keeps today\'s card: the glyph, the label, no annunciator', async () => {
    const h = await mount({ nodes: nodes(sheet) })
    const plain = h.root.querySelectorAll('.card[data-card-key]')[1]!
    expect(plain.hasAttribute('data-evidence')).toBe(false)
    expect(plain.querySelector('mn-file-glyph')).not.toBeNull()
    expect(plain.querySelector('.annunciator')).toBeNull()
  })

  it('small cards keep the glyph and say the badge; a file still queued or reading keeps its glyph and says where it stands', async () => {
    const small = await mount({ nodes: nodes(sheet), view: { iconSize: 'small', snapToGrid: false } })
    const card = small.root.querySelector('.card[data-card-key]')!
    expect(card.querySelector('mn-file-glyph')).not.toBeNull()
    expect(card.querySelector('.annunciator')!.textContent).toBe('1 disputed · 215 values')
    const reading = await mount({ nodes: nodes({ ...sheet, title: '', values: [], state: 'reading', progress: { page: 20, pages: 38 } }) })
    const readingCard = reading.root.querySelector('.card[data-card-key]')!
    expect(readingCard.hasAttribute('data-evidence')).toBe(false)
    expect(readingCard.querySelector('.annunciator')!.textContent).toBe('Reading 20/38')
  })
})
