import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-input-dialog.js'
import '../mn-confirmation-dialog.js'
import '../mn-folder-picker-dialog.js'
import type { MnInputDialog, MnInputDialogConfirmDetail } from '../mn-input-dialog.js'
import type { MnConfirmationDialog } from '../mn-confirmation-dialog.js'
import type { MnFolderPickerDialog, MnFolderPickerSelectDetail } from '../mn-folder-picker-dialog.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mountInput(setup?: (el: MnInputDialog) => void): Promise<MnInputDialog> {
  const el = document.createElement('mn-input-dialog') as MnInputDialog
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountConfirmation(setup?: (el: MnConfirmationDialog) => void): Promise<MnConfirmationDialog> {
  const el = document.createElement('mn-confirmation-dialog') as MnConfirmationDialog
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountFolderPicker(setup?: (el: MnFolderPickerDialog) => void): Promise<MnFolderPickerDialog> {
  const el = document.createElement('mn-folder-picker-dialog') as MnFolderPickerDialog
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

function mountShadowInvoker(label: string): { host: HTMLElement; button: HTMLButtonElement } {
  const host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })
  const button = document.createElement('button')
  button.textContent = label
  shadow.appendChild(button)
  document.body.appendChild(host)
  button.focus()
  return { host, button }
}

describe('mn-input-dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders configured prompt content and emits the typed value on confirm', async () => {
    const el = await mountInput((dialog) => {
      dialog.title = 'Rename Document'
      dialog.message = 'Enter a new name.'
      dialog.value = 'Old title'
      dialog.placeholder = 'Document name'
      dialog.confirmText = 'Rename'
      dialog.open = true
    })
    await el.updateComplete

    expect(el.hasAttribute('open')).toBe(true)
    expect(sr(el).querySelector('.title')?.textContent).toBe('Rename Document')
    expect(sr(el).querySelector('.message')?.textContent).toBe('Enter a new name.')
    const input = sr(el).querySelector<HTMLInputElement>('.input')!
    expect(input.value).toBe('Old title')
    expect(input.placeholder).toBe('Document name')

    const confirmed: MnInputDialogConfirmDetail[] = []
    el.addEventListener('mn-confirm', (event) => {
      confirmed.push((event as CustomEvent<MnInputDialogConfirmDetail>).detail)
    })
    input.value = 'New title'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    sr(el).querySelector<HTMLButtonElement>('.confirm-button')!.click()

    expect(confirmed).toEqual([{ value: 'New title' }])
  })

  it('cancels on Escape and ignores cancel while loading', async () => {
    const el = await mountInput((dialog) => {
      dialog.open = true
    })
    let cancels = 0
    el.addEventListener('mn-cancel', () => {
      cancels += 1
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await el.updateComplete
    expect(el.open).toBe(false)
    expect(cancels).toBe(1)

    el.show()
    el.loading = true
    await el.updateComplete
    sr(el).querySelector<HTMLButtonElement>('.cancel-button')!.click()
    expect(el.open).toBe(true)
    expect(cancels).toBe(1)
  })

  it('promotes to the native top layer on show() (regression: rendered under other open overlays, e.g. context menus)', async () => {
    const el = await mountInput()
    expect(el.hasAttribute('popover')).toBe(true) // set eagerly in connectedCallback
    expect(el.hasAttribute('popover-open')).toBe(false)

    el.show()
    expect(el.hasAttribute('popover-open')).toBe(true)

    el.hide()
    expect(el.hasAttribute('popover-open')).toBe(false)
  })

  it('focuses the input, contains Tab, and returns focus to the exact shadow-root invoker', async () => {
    const invoker = mountShadowInvoker('Rename document')
    expect(document.activeElement).toBe(invoker.host)
    expect(invoker.host.shadowRoot?.activeElement).toBe(invoker.button)

    const el = await mountInput()
    el.show()
    await el.updateComplete

    const input = sr(el).querySelector<HTMLInputElement>('.input')!
    const confirm = sr(el).querySelector<HTMLButtonElement>('.confirm-button')!
    expect(sr(el).activeElement).toBe(input)

    confirm.focus()
    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(sr(el).activeElement).toBe(input)

    input.focus()
    const backwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(backwardTab)
    expect(backwardTab.defaultPrevented).toBe(true)
    expect(sr(el).activeElement).toBe(confirm)

    el.hide()
    await el.updateComplete
    expect(document.activeElement).toBe(invoker.host)
    expect(invoker.host.shadowRoot?.activeElement).toBe(invoker.button)
  })

  it('submits Enter only from its input and announces a stable modal lifecycle', async () => {
    const el = await mountInput()
    const overlayStates: Array<{ id: string; open: boolean; modality: string }> = []
    let confirms = 0
    const onOverlayState = (event: Event) => {
      overlayStates.push((event as CustomEvent<(typeof overlayStates)[number]>).detail)
    }
    document.addEventListener('mn-overlay-state-change', onOverlayState)
    el.addEventListener('mn-confirm', () => {
      confirms += 1
    })

    el.show()
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(confirms).toBe(0)

    const input = sr(el).querySelector<HTMLInputElement>('.input')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }))
    expect(confirms).toBe(1)

    el.hide()
    await el.updateComplete
    el.show()
    await el.updateComplete
    el.remove()
    document.removeEventListener('mn-overlay-state-change', onOverlayState)

    expect(overlayStates.map(({ open }) => open)).toEqual([true, false, true, false])
    expect(new Set(overlayStates.map(({ id }) => id)).size).toBe(1)
    expect(overlayStates.every(({ modality }) => modality === 'modal')).toBe(true)
  })
})

describe('mn-confirmation-dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders variant, slot content, and emits confirm events', async () => {
    const el = await mountConfirmation((dialog) => {
      dialog.title = 'Delete Document'
      dialog.message = 'This action cannot be undone.'
      dialog.confirmText = 'Delete'
      dialog.secondaryConfirmText = 'Archive'
      dialog.variant = 'danger'
      dialog.open = true
      dialog.innerHTML = '<p data-slot-note>Contains 3 comments.</p>'
    })
    await el.updateComplete

    expect(el.getAttribute('variant')).toBe('danger')
    expect(sr(el).querySelector('.dialog')?.classList.contains('variant-danger')).toBe(true)
    expect(sr(el).querySelector('.title')?.textContent).toBe('Delete Document')
    expect(sr(el).querySelector('slot')).not.toBeNull()

    let confirms = 0
    let secondary = 0
    el.addEventListener('mn-confirm', () => {
      confirms += 1
    })
    el.addEventListener('mn-secondary-confirm', () => {
      secondary += 1
    })

    sr(el).querySelector<HTMLButtonElement>('.secondary-confirm-button')!.click()
    sr(el).querySelector<HTMLButtonElement>('.confirm-button:not(.secondary-confirm-button)')!.click()

    expect(secondary).toBe(1)
    expect(confirms).toBe(1)
  })

  it('cancels on overlay/Escape and leaves loading dialogs open', async () => {
    const el = await mountConfirmation((dialog) => {
      dialog.open = true
    })
    let cancels = 0
    el.addEventListener('mn-cancel', () => {
      cancels += 1
    })

    sr(el).querySelector<HTMLElement>('.overlay')!.click()
    await el.updateComplete
    expect(el.open).toBe(false)
    expect(cancels).toBe(1)

    el.show()
    el.loading = true
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await el.updateComplete
    expect(el.open).toBe(true)
    expect(cancels).toBe(1)
  })

  it('promotes to the native top layer on show()', async () => {
    const el = await mountConfirmation()
    expect(el.hasAttribute('popover')).toBe(true)
    el.show()
    expect(el.hasAttribute('popover-open')).toBe(true)
    el.hide()
    expect(el.hasAttribute('popover-open')).toBe(false)
  })

  it('starts on Cancel, contains slotted focus, and restores the exact shadow-root invoker', async () => {
    const invoker = mountShadowInvoker('Delete document')
    const el = await mountConfirmation((dialog) => {
      dialog.innerHTML = '<button data-review type="button">Review affected links</button>'
    })
    el.show()
    await el.updateComplete

    const cancel = sr(el).querySelector<HTMLButtonElement>('.cancel-button')!
    const confirm = sr(el).querySelector<HTMLButtonElement>('.confirm-button:not(.secondary-confirm-button)')!
    const slotted = el.querySelector<HTMLButtonElement>('[data-review]')!
    expect(sr(el).activeElement).toBe(cancel)

    confirm.focus()
    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(slotted)

    slotted.focus()
    const backwardTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(backwardTab)
    expect(backwardTab.defaultPrevented).toBe(true)
    expect(sr(el).activeElement).toBe(confirm)

    el.hide()
    await el.updateComplete
    expect(document.activeElement).toBe(invoker.host)
    expect(invoker.host.shadowRoot?.activeElement).toBe(invoker.button)
  })

  it('does not globally confirm on Enter and announces open, close, and disconnect', async () => {
    const el = await mountConfirmation()
    const overlayStates: Array<{ id: string; open: boolean; modality: string }> = []
    let confirms = 0
    const onOverlayState = (event: Event) => {
      overlayStates.push((event as CustomEvent<(typeof overlayStates)[number]>).detail)
    }
    document.addEventListener('mn-overlay-state-change', onOverlayState)
    el.addEventListener('mn-confirm', () => {
      confirms += 1
    })

    el.show()
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(confirms).toBe(0)

    el.hide()
    await el.updateComplete
    el.show()
    await el.updateComplete
    el.remove()
    document.removeEventListener('mn-overlay-state-change', onOverlayState)

    expect(overlayStates.map(({ open }) => open)).toEqual([true, false, true, false])
    expect(new Set(overlayStates.map(({ id }) => id)).size).toBe(1)
    expect(overlayStates.every(({ modality }) => modality === 'modal')).toBe(true)
  })
})

describe('mn-folder-picker-dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders section-filtered folder choices and emits the selected destination', async () => {
    const el = await mountFolderPicker((dialog) => {
      dialog.open = true
      dialog.title = 'Move Document'
      dialog.currentParentId = 'folder-a'
      dialog.folders = [
        { id: 'folder-a', name: 'A', parentId: null, section: 'documents' },
        { id: 'folder-b', name: 'B', parentId: null, section: 'documents' },
        { id: 'folder-media', name: 'Media', parentId: null, section: 'artifacts' },
      ]
    })
    await el.updateComplete

    const labels = Array.from(sr(el).querySelectorAll('.folder-name')).map((node) => node.textContent?.trim())
    expect(labels).toEqual(['Documents root', 'A', 'B'])
    expect(sr(el).querySelector<HTMLButtonElement>('.confirm-button')?.disabled).toBe(true)

    const selected: MnFolderPickerSelectDetail[] = []
    el.addEventListener('mn-select', (event) => {
      selected.push((event as CustomEvent<MnFolderPickerSelectDetail>).detail)
    })
    ;(sr(el).querySelectorAll<HTMLButtonElement>('.folder-item')[2]).click()
    await el.updateComplete
    expect(sr(el).querySelector<HTMLButtonElement>('.confirm-button')?.disabled).toBe(false)
    sr(el).querySelector<HTMLButtonElement>('.confirm-button')!.click()

    expect(selected).toEqual([{ folderId: 'folder-b' }])
    expect(el.open).toBe(false)
  })

  it('disables excluded folders and supports moving to section root', async () => {
    const el = await mountFolderPicker((dialog) => {
      dialog.open = true
      dialog.section = 'artifacts'
      dialog.currentParentId = 'folder-media'
      dialog.excludeIds = ['folder-media']
      dialog.folders = [
        { id: 'folder-media', name: 'Media', parentId: null, section: 'artifacts' },
        { id: 'folder-child', name: 'Child', parentId: 'folder-media', section: 'artifacts' },
      ]
    })
    await el.updateComplete

    expect(sr(el).querySelector('.root-option .folder-name')?.textContent?.trim()).toBe('Artifacts root')
    const items = Array.from(sr(el).querySelectorAll<HTMLButtonElement>('.folder-item'))
    expect(items.find((item) => item.textContent?.includes('Media'))?.disabled).toBe(true)
    expect(items.find((item) => item.textContent?.includes('Media'))?.getAttribute('aria-disabled')).toBe('true')
    expect(items.find((item) => item.textContent?.includes('Media'))?.getAttribute('aria-label')).toContain('unavailable')
    expect(items.find((item) => item.textContent?.includes('Media'))?.textContent).toContain('Unavailable')

    const selected: MnFolderPickerSelectDetail[] = []
    el.addEventListener('mn-select', (event) => {
      selected.push((event as CustomEvent<MnFolderPickerSelectDetail>).detail)
    })
    ;(sr(el).querySelector<HTMLButtonElement>('.root-option')!).click()
    await el.updateComplete
    sr(el).querySelector<HTMLButtonElement>('.confirm-button')!.click()

    expect(selected).toEqual([{ folderId: null }])
  })

  it('promotes to the native top layer on show()', async () => {
    const el = await mountFolderPicker()
    expect(el.hasAttribute('popover')).toBe(true)
    el.show()
    expect(el.hasAttribute('popover-open')).toBe(true)
    el.hide()
    expect(el.hasAttribute('popover-open')).toBe(false)
  })

  it('focuses the current destination, contains Tab, and returns focus to the invoker', async () => {
    const invokerHost = document.createElement('div')
    const invokerRoot = invokerHost.attachShadow({ mode: 'open' })
    const invoker = document.createElement('button')
    invoker.textContent = 'Move document'
    invokerRoot.appendChild(invoker)
    document.body.appendChild(invokerHost)
    invoker.focus()
    expect(document.activeElement).toBe(invokerHost)
    expect(invokerRoot.activeElement).toBe(invoker)

    const el = await mountFolderPicker((dialog) => {
      dialog.currentParentId = 'folder-b'
      dialog.folders = [
        { id: 'folder-a', name: 'A', parentId: null, section: 'documents' },
        { id: 'folder-b', name: 'B', parentId: null, section: 'documents' },
      ]
      dialog.open = true
    })
    await el.updateComplete

    const current = Array.from(sr(el).querySelectorAll<HTMLButtonElement>('.folder-item')).find((item) =>
      item.textContent?.includes('B'),
    )!
    expect(sr(el).activeElement).toBe(current)
    expect(current.getAttribute('aria-label')).toContain('current destination')
    expect(current.textContent).toContain('Current')

    const enabledButtons = Array.from(sr(el).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const last = enabledButtons[enabledButtons.length - 1]
    last.focus()
    const forwardTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(sr(el).activeElement).toBe(sr(el).querySelector('.close-button'))

    const first = sr(el).querySelector<HTMLButtonElement>('.close-button')!
    first.focus()
    const backwardTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(backwardTab)
    expect(backwardTab.defaultPrevented).toBe(true)
    expect(sr(el).activeElement).toBe(last)

    el.hide()
    await el.updateComplete
    expect(document.activeElement).toBe(invokerHost)
    expect(invokerRoot.activeElement).toBe(invoker)
  })

  it('keeps folder selection and confirmation as separate actions', async () => {
    const el = await mountFolderPicker((dialog) => {
      dialog.currentParentId = 'folder-a'
      dialog.folders = [
        { id: 'folder-a', name: 'A', parentId: null, section: 'documents' },
        { id: 'folder-b', name: 'B', parentId: null, section: 'documents' },
      ]
      dialog.open = true
    })
    await el.updateComplete

    let selections = 0
    el.addEventListener('mn-select', () => {
      selections += 1
    })
    const destination = Array.from(sr(el).querySelectorAll<HTMLButtonElement>('.folder-item')).find((item) =>
      item.textContent?.includes('B'),
    )!
    destination.focus()
    destination.click()
    await el.updateComplete

    expect(selections).toBe(0)
    expect(el.open).toBe(true)
    expect(sr(el).querySelector<HTMLButtonElement>('.confirm-button')?.disabled).toBe(false)

    sr(el).querySelector<HTMLButtonElement>('.confirm-button')!.click()
    expect(selections).toBe(1)
    expect(el.open).toBe(false)
  })

  it('announces one stable modal state across show, hide, cancel, and disconnect', async () => {
    const el = await mountFolderPicker()
    const states: Array<{ id: string; open: boolean; modality: string }> = []
    const onOverlayState = (event: Event) => {
      states.push((event as CustomEvent<{ id: string; open: boolean; modality: string }>).detail)
    }
    document.addEventListener('mn-overlay-state-change', onOverlayState)

    try {
      el.show()
      await el.updateComplete
      el.show()
      await el.updateComplete
      el.hide()
      await el.updateComplete
      el.hide()
      await el.updateComplete

      el.show()
      await el.updateComplete
      sr(el).querySelector<HTMLElement>('.overlay')!.click()
      await el.updateComplete

      el.show()
      await el.updateComplete
      el.remove()

      expect(states.map(({ open }) => open)).toEqual([true, false, true, false, true, false])
      expect(new Set(states.map(({ id }) => id)).size).toBe(1)
      expect(states.every(({ modality }) => modality === 'modal')).toBe(true)
      expect(states[0].id).toMatch(/^folder-picker-\d+$/)
    } finally {
      document.removeEventListener('mn-overlay-state-change', onOverlayState)
    }
  })
})
