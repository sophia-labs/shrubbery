import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../mn-inline-edit.js'
import '../mn-toast.js'
import '../mn-modal.js'
import type { MnInlineEdit, MnInlineEditSaveDetail } from '../mn-inline-edit.js'
import type { MnToast } from '../mn-toast.js'
import type { MnModal } from '../mn-modal.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mountInline(setup?: (el: MnInlineEdit) => void): Promise<MnInlineEdit> {
  const el = document.createElement('mn-inline-edit') as MnInlineEdit
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountToast(setup?: (el: MnToast) => void): Promise<MnToast> {
  const el = document.createElement('mn-toast') as MnToast
  el.autoRemove = false
  el.autoShow = false
  el.animationMs = 0
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountModal(setup?: (el: MnModal) => void): Promise<MnModal> {
  const el = document.createElement('mn-modal') as MnModal
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-inline-edit / mn-toast / mn-modal Garden shared primitives', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    document.body.style.overflow = ''
  })

  it('registers the shared primitive tags', () => {
    expect(customElements.get('mn-inline-edit')).toBeDefined()
    expect(customElements.get('mn-toast')).toBeDefined()
    expect(customElements.get('mn-modal')).toBeDefined()
  })

  it('mn-inline-edit starts from label activation and emits cancelable saves', async () => {
    const el = await mountInline((node) => {
      node.value = 'Old title'
    })
    const saves: MnInlineEditSaveDetail[] = []
    el.addEventListener('mn-save', (event) => {
      saves.push((event as CustomEvent<MnInlineEditSaveDetail>).detail)
    })

    expect(sr(el).querySelector('.label')?.textContent?.trim()).toBe('Old title')
    ;(sr(el).querySelector('.label') as HTMLElement).click()
    await el.updateComplete
    const input = sr(el).querySelector<HTMLInputElement>('input')!
    expect(el.editing).toBe(true)
    expect(input.value).toBe('Old title')

    input.value = 'New title'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await el.updateComplete

    expect(saves).toEqual([{ value: 'New title', previousValue: 'Old title' }])
    expect(el.value).toBe('New title')
    expect(el.editing).toBe(false)
  })

  it('mn-inline-edit validates empty values, cancels on Escape, and honors prevented saves', async () => {
    const el = await mountInline((node) => {
      node.value = 'Original'
    })
    let cancels = 0
    el.addEventListener('mn-cancel', () => {
      cancels += 1
    })

    el.startEditing()
    await el.updateComplete
    const input = sr(el).querySelector<HTMLInputElement>('input')!
    input.value = '   '
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    el.save()
    await el.updateComplete
    expect(el.editing).toBe(true)
    expect(el.error).toBe('Name cannot be empty')
    expect(sr(el).querySelector('.error-message')?.textContent).toBe('Name cannot be empty')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(cancels).toBe(1)
    expect(el.editing).toBe(false)

    el.addEventListener('mn-save', (event) => event.preventDefault())
    el.startEditing()
    await el.updateComplete
    const secondInput = sr(el).querySelector<HTMLInputElement>('input')!
    secondInput.value = 'Blocked'
    secondInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    el.save()
    await el.updateComplete
    expect(el.value).toBe('Original')
    expect(el.editing).toBe(true)
  })

  it('mn-toast shows, renders action/close/progress affordances, and emits intents', async () => {
    vi.useFakeTimers()
    try {
      const el = await mountToast((toast) => {
        toast.type = 'success'
        toast.message = 'Saved'
        toast.description = 'Document updated'
        toast.actionText = 'Undo'
        toast.duration = 0
        toast.showProgress = true
      })
      const events: string[] = []
      el.addEventListener('mn-show', () => events.push('show'))
      el.addEventListener('mn-action', () => events.push('action'))
      el.addEventListener('mn-dismiss', () => events.push('dismiss'))

      el.show()
      await el.updateComplete
      expect(el.visible).toBe(true)
      expect(sr(el).querySelector('.toast')?.classList.contains('type-success')).toBe(true)
      expect(sr(el).querySelector('.message')?.textContent).toBe('Saved')
      expect(sr(el).querySelector('.description')?.textContent).toBe('Document updated')
      expect(sr(el).querySelector('.progress-bar')).toBeNull()

      sr(el).querySelector<HTMLButtonElement>('.action-button')!.click()
      vi.runOnlyPendingTimers()
      await el.updateComplete
      expect(events).toEqual(['show', 'action', 'dismiss'])
      expect(el.visible).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('mn-toast auto-dismisses and can be closed directly', async () => {
    vi.useFakeTimers()
    try {
      const auto = await mountToast((toast) => {
        toast.duration = 250
        toast.animationMs = 0
      })
      let dismissed = 0
      auto.addEventListener('mn-dismiss', () => {
        dismissed += 1
      })
      auto.show()
      vi.advanceTimersByTime(250)
      vi.runOnlyPendingTimers()
      await auto.updateComplete
      expect(dismissed).toBe(1)
      expect(auto.visible).toBe(false)

      const closable = await mountToast((toast) => {
        toast.duration = 0
        toast.message = 'Closable'
      })
      closable.show()
      await closable.updateComplete
      sr(closable).querySelector<HTMLButtonElement>('.close-button')!.click()
      vi.runOnlyPendingTimers()
      await closable.updateComplete
      expect(closable.visible).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('mn-modal opens/closes, locks scroll, restores focus, and emits composed events', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()

    const el = await mountModal((modal) => {
      modal.innerHTML = `
        <span slot="header">Rename</span>
        <button id="inside">Inside</button>
        <span slot="footer"><button id="footer">Done</button></span>
      `
    })
    const events: string[] = []
    el.addEventListener('mn-open', () => events.push('open'))
    el.addEventListener('mn-close', () => events.push('close'))

    el.openModal()
    await el.updateComplete
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(el.open).toBe(true)
    expect(el.hasAttribute('open')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    expect(sr(el).querySelector('.container')?.classList.contains('size-md')).toBe(true)
    expect(events).toEqual(['open'])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(el.open).toBe(false)
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
    expect(events).toEqual(['open', 'close'])
  })

  it('mn-modal respects close toggles and supports full-size shells', async () => {
    const el = await mountModal((modal) => {
      modal.size = 'full'
      modal.closeOnBackdrop = false
      modal.closeOnEscape = false
      modal.closable = false
      modal.open = true
    })
    await el.updateComplete

    expect(sr(el).querySelector('.container')?.classList.contains('size-full')).toBe(true)
    expect(sr(el).querySelector('.close-button')).toBeNull()

    sr(el).querySelector<HTMLElement>('.overlay')!.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(el.open).toBe(true)

    el.close()
    await el.updateComplete
    expect(el.open).toBe(false)
  })
})
