import { beforeEach, describe, expect, it } from 'vitest'
import { MnDialog, type MnDialogCloseDetail } from '../mn-dialog.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mountDialog(setup?: (el: MnDialog) => void): Promise<MnDialog> {
  const el = document.createElement('mn-dialog') as MnDialog
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-dialog native Garden primitive', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders native dialog structure with slots and size', async () => {
    const el = await mountDialog((dialog) => {
      dialog.size = 'lg'
      dialog.innerHTML = `
        <span slot="header">Footnote</span>
        <p>Body</p>
        <span slot="footer"><button>Done</button></span>
      `
    })

    expect(customElements.get('mn-dialog')).toBeDefined()
    expect(sr(el).querySelector('dialog')?.classList.contains('size-lg')).toBe(true)
    expect(sr(el).querySelector('slot[name="header"]')).not.toBeNull()
    expect(sr(el).querySelector('slot:not([name])')).not.toBeNull()
    expect(sr(el).querySelector('slot[name="footer"]')).not.toBeNull()
    expect(sr(el).querySelector('.close-btn')).not.toBeNull()
  })

  it('hides the close button when closable=false', async () => {
    const el = await mountDialog((dialog) => {
      dialog.closable = false
    })
    expect(sr(el).querySelector('.close-btn')).toBeNull()
  })

  it('showModal opens, close emits returnValue, and focus returns to invoker', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()

    const el = await mountDialog()
    const closed: MnDialogCloseDetail[] = []
    el.addEventListener('mn-close', (event) => {
      closed.push((event as CustomEvent<MnDialogCloseDetail>).detail)
    })

    el.showModal()
    expect(el.open).toBe(true)
    expect(sr(el).querySelector('dialog')?.hasAttribute('open')).toBe(true)

    el.close('confirm')
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(el.open).toBe(false)
    expect(closed).toEqual([{ returnValue: 'confirm' }])
    expect(document.activeElement).toBe(trigger)
  })

  it('close button and native cancel close with cancel returnValue', async () => {
    const el = await mountDialog()
    const values: string[] = []
    el.addEventListener('mn-close', (event) => {
      values.push((event as CustomEvent<MnDialogCloseDetail>).detail.returnValue)
    })

    el.showModal()
    sr(el).querySelector<HTMLButtonElement>('.close-btn')!.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(values).toEqual(['cancel'])

    el.showModal()
    sr(el).querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(values).toEqual(['cancel', 'cancel'])
  })

  it('static confirm resolves false/true from the generated buttons', async () => {
    const cancelled = MnDialog.confirm({ title: 'Delete?', message: 'This cannot be undone.' })
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    const cancelDialog = document.querySelector('mn-dialog') as MnDialog
    cancelDialog.querySelector<HTMLButtonElement>('.mn-dialog-cancel-btn')!.click()
    await expect(cancelled).resolves.toBe(false)

    const confirmed = MnDialog.confirm({ title: 'Continue?', message: 'Press OK.', confirmText: 'OK' })
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    const confirmDialog = document.querySelector('mn-dialog') as MnDialog
    confirmDialog.querySelector<HTMLButtonElement>('.mn-dialog-confirm-btn')!.click()
    await expect(confirmed).resolves.toBe(true)
  })

  it('static prompt resolves input value or null on cancel', async () => {
    const entered = MnDialog.prompt({ title: 'Name', value: 'Old', placeholder: 'Document name' })
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    const promptDialog = document.querySelector('mn-dialog') as MnDialog
    const input = promptDialog.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('Old')
    input.value = 'New'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect(entered).resolves.toBe('New')

    const cancelled = MnDialog.prompt({ title: 'Name' })
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    const cancelDialog = document.querySelector('mn-dialog') as MnDialog
    cancelDialog.querySelector<HTMLButtonElement>('[slot="footer"] button')!.click()
    await expect(cancelled).resolves.toBeNull()
  })
})
