/**
 * REAL component test — Garden core form primitives, backend-free in Shrubbery.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-input.js'
import '../mn-textarea.js'
import type { MnInput, MnInputValueDetail } from '../mn-input.js'
import type { MnTextarea, MnTextareaValueDetail } from '../mn-textarea.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mountInput(setup?: (el: MnInput) => void): Promise<MnInput> {
  const el = document.createElement('mn-input') as MnInput
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountTextarea(setup?: (el: MnTextarea) => void): Promise<MnTextarea> {
  const el = document.createElement('mn-textarea') as MnTextarea
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-input / mn-textarea form primitives', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers the Garden form primitive tags', () => {
    expect(customElements.get('mn-input')).toBeDefined()
    expect(customElements.get('mn-textarea')).toBeDefined()
  })

  it('mn-input renders label, required mark, helper text, slots, and control attributes', async () => {
    const el = await mountInput((node) => {
      node.label = 'Email'
      node.type = 'email'
      node.name = 'email'
      node.placeholder = 'you@example.test'
      node.helperText = 'Use your workspace email'
      node.required = true
      node.size = 'lg'
      node.innerHTML = '<span slot="prefix" data-prefix>@</span><span slot="suffix" data-suffix>.org</span>'
    })

    const input = sr(el).querySelector('input')!
    expect(sr(el).querySelector('label')?.textContent).toContain('Email')
    expect(sr(el).querySelector('.required-mark')).not.toBeNull()
    expect(sr(el).querySelector('.helper')?.textContent).toBe('Use your workspace email')
    expect(sr(el).querySelector('slot[name="prefix"]')).not.toBeNull()
    expect(sr(el).querySelector('slot[name="suffix"]')).not.toBeNull()
    expect(sr(el).querySelector('.container')?.classList.contains('size-lg')).toBe(true)
    expect(input.type).toBe('email')
    expect(input.name).toBe('email')
    expect(input.placeholder).toBe('you@example.test')
    expect(input.required).toBe(true)
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(input.getAttribute('aria-labelledby')).toContain('mn-input-')
  })

  it('mn-input emits Garden-compatible input/change/clear events and restores focus on clear', async () => {
    const el = await mountInput((node) => {
      node.clearable = true
      node.value = 'draft'
    })
    const input = sr(el).querySelector('input')!
    const seen: Array<string> = []
    el.addEventListener('mn-input', (event) => {
      seen.push(`input:${(event as CustomEvent<MnInputValueDetail>).detail.value}`)
    })
    el.addEventListener('mn-change', (event) => {
      seen.push(`change:${(event as CustomEvent<MnInputValueDetail>).detail.value}`)
    })
    el.addEventListener('mn-clear', () => {
      seen.push('clear')
    })

    input.value = 'typed'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    await el.updateComplete

    expect(el.value).toBe('typed')
    expect(seen).toEqual(['input:typed', 'change:typed'])

    const clear = sr(el).querySelector<HTMLButtonElement>('.ctrl-btn[aria-label="Clear"]')!
    clear.click()
    await el.updateComplete

    expect(el.value).toBe('')
    expect(input.value).toBe('')
    expect(seen).toEqual(['input:typed', 'change:typed', 'clear', 'change:'])
    expect(sr(el).activeElement).toBe(input)
  })

  it('mn-input supports error state and password visibility toggle', async () => {
    const el = await mountInput((node) => {
      node.type = 'password'
      node.value = 'secret'
      node.error = true
      node.errorMessage = 'Password required'
    })
    const input = sr(el).querySelector('input')!

    expect(input.type).toBe('password')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain('-error')
    expect(sr(el).querySelector('.error-msg')?.textContent).toContain('Password required')

    const toggle = sr(el).querySelector<HTMLButtonElement>('.ctrl-btn[aria-label="Show password"]')!
    toggle.click()
    await el.updateComplete

    expect((sr(el).querySelector('input') as HTMLInputElement).type).toBe('text')
    expect(sr(el).querySelector('.ctrl-btn[aria-label="Hide password"]')).not.toBeNull()
  })

  it('mn-textarea renders labels, resize class, helper text, and character count', async () => {
    const el = await mountTextarea((node) => {
      node.label = 'Notes'
      node.value = 'hello'
      node.placeholder = 'Write notes'
      node.name = 'notes'
      node.rows = 6
      node.maxlength = 4
      node.resize = 'none'
      node.helperText = 'Private notes'
      node.required = true
    })
    const textarea = sr(el).querySelector('textarea')!

    expect(sr(el).querySelector('label')?.textContent).toContain('Notes')
    expect(sr(el).querySelector('.required-mark')).not.toBeNull()
    expect(sr(el).querySelector('.helper')?.textContent).toBe('Private notes')
    expect(textarea.name).toBe('notes')
    expect(String(textarea.rows)).toBe('6')
    expect(textarea.placeholder).toBe('Write notes')
    expect(textarea.classList.contains('resize-none')).toBe(true)
    expect(textarea.getAttribute('aria-labelledby')).toContain('mn-textarea-')
    expect(sr(el).querySelector('.char-count')?.textContent?.trim()).toBe('5/4')
    expect(sr(el).querySelector('.char-count')?.classList.contains('over-limit')).toBe(true)
  })

  it('mn-textarea emits input/change/focus/blur and reports error state', async () => {
    const el = await mountTextarea((node) => {
      node.error = true
      node.errorMessage = 'Too long'
    })
    const textarea = sr(el).querySelector('textarea')!
    const seen: Array<string> = []
    el.addEventListener('mn-input', (event) => {
      seen.push(`input:${(event as CustomEvent<MnTextareaValueDetail>).detail.value}`)
    })
    el.addEventListener('mn-change', (event) => {
      seen.push(`change:${(event as CustomEvent<MnTextareaValueDetail>).detail.value}`)
    })
    el.addEventListener('mn-focus', () => seen.push('focus'))
    el.addEventListener('mn-blur', () => seen.push('blur'))

    textarea.dispatchEvent(new FocusEvent('focus', { bubbles: true, composed: true }))
    textarea.value = 'typed note'
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    textarea.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true }))
    await el.updateComplete

    expect(el.value).toBe('typed note')
    expect(textarea.getAttribute('aria-invalid')).toBe('true')
    expect(sr(el).querySelector('.error-msg')?.textContent).toContain('Too long')
    expect(seen).toEqual(['focus', 'input:typed note', 'change:typed note', 'blur'])
  })
})
