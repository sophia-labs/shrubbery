/**
 * REAL component test — additional Garden small primitives lifted into
 * @shrubbery/components.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-search-input.js'
import '../mn-tooltip.js'
import '../mn-avatar.js'
import type { MnSearchInput, MnSearchInputDetail } from '../mn-search-input.js'
import type { MnTooltip } from '../mn-tooltip.js'
import type { MnAvatar } from '../mn-avatar.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountSearch(setup?: (el: MnSearchInput) => void): Promise<MnSearchInput> {
  const el = document.createElement('mn-search-input') as MnSearchInput
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountTooltip(label: string, child?: Element, setup?: (el: MnTooltip) => void): Promise<MnTooltip> {
  const el = document.createElement('mn-tooltip') as MnTooltip
  el.label = label
  el.delay = 0
  if (child) el.appendChild(child)
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  await tick()
  return el
}

async function mountAvatar(setup?: (el: MnAvatar) => void): Promise<MnAvatar> {
  const el = document.createElement('mn-avatar') as MnAvatar
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-search-input / mn-tooltip / mn-avatar small primitives', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers the Garden small primitive tags', () => {
    expect(customElements.get('mn-search-input')).toBeDefined()
    expect(customElements.get('mn-tooltip')).toBeDefined()
    expect(customElements.get('mn-avatar')).toBeDefined()
  })

  it('mn-search-input renders search chrome, emits input, and clears back to empty', async () => {
    const el = await mountSearch((node) => {
      node.placeholder = 'Find blocks'
      node.shortcut = 'Mod+K'
    })
    const input = sr(el).querySelector('input')!
    const seen: string[] = []
    el.addEventListener('mn-input', (event) => {
      seen.push(`input:${(event as CustomEvent<MnSearchInputDetail>).detail.value}`)
    })
    el.addEventListener('mn-clear', () => seen.push('clear'))

    expect(input.type).toBe('search')
    expect(input.placeholder).toBe('Find blocks')
    expect(sr(el).querySelector('.search-icon svg')).not.toBeNull()
    expect(sr(el).querySelector('.shortcut-chip')?.textContent).toBe('Mod+K')
    expect(sr(el).querySelector('.clear-btn')).toBeNull()

    input.value = 'wire'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await el.updateComplete

    expect(el.value).toBe('wire')
    expect(seen).toEqual(['input:wire'])
    expect(sr(el).querySelector('.shortcut-chip')).toBeNull()

    ;(sr(el).querySelector('.clear-btn') as HTMLButtonElement).click()
    await el.updateComplete

    expect(el.value).toBe('')
    expect(input.value).toBe('')
    expect(seen).toEqual(['input:wire', 'clear', 'input:'])
    expect(sr(el).activeElement).toBe(input)
  })

  it('mn-tooltip anchors to a slotted child, renders shortcut text, and hides on Escape', async () => {
    const button = document.createElement('button')
    button.textContent = 'Save'
    const el = await mountTooltip('Save document', button, (node) => {
      node.shortcut = 'Mod+S'
    })
    const popover = sr(el).querySelector('[popover]') as HTMLElement

    expect(popover.id).toContain('mn-tooltip-')
    expect(button.getAttribute('aria-describedby')).toBe(popover.id)
    expect(sr(el).querySelector('.tip-label')?.textContent).toBe('Save document')
    expect(sr(el).querySelector('.tip-shortcut')?.textContent).toBe('Mod+S')
    expect(popover.hasAttribute('popover-open')).toBe(false)

    button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    await tick()
    await el.updateComplete
    expect(popover.hasAttribute('popover-open')).toBe(true)

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await el.updateComplete
    expect(popover.hasAttribute('popover-open')).toBe(false)
  })

  it('mn-tooltip can target an external element by id', async () => {
    const button = document.createElement('button')
    button.id = 'external-tooltip-target'
    document.body.appendChild(button)
    const el = await mountTooltip('External target', undefined, (node) => {
      node.targetId = 'external-tooltip-target'
    })
    const popover = sr(el).querySelector('[popover]') as HTMLElement

    expect(button.getAttribute('aria-describedby')).toBe(popover.id)
    button.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    await tick()
    await el.updateComplete
    expect(popover.hasAttribute('popover-open')).toBe(true)
  })

  it('mn-avatar renders initials, presence, ring/group attributes, and keyboard click intents', async () => {
    const el = await mountAvatar((node) => {
      node.initials = 'vera'
      node.presence = 'online'
      node.size = 'lg'
      node.ring = true
      node.group = true
      node.interactive = true
      node.alt = 'Vera'
    })
    const avatar = sr(el).querySelector('.avatar') as HTMLElement
    const clicks: string[] = []
    el.addEventListener('mn-click', () => clicks.push('click'))

    expect(el.hasAttribute('ring')).toBe(true)
    expect(el.hasAttribute('group')).toBe(true)
    expect(avatar.classList.contains('size-lg')).toBe(true)
    expect(avatar.getAttribute('role')).toBe('button')
    expect(avatar.getAttribute('tabindex')).toBe('0')
    expect(avatar.getAttribute('aria-label')).toBe('Vera')
    expect(sr(el).querySelector('.initials')?.textContent).toBe('VE')
    expect(sr(el).querySelector('.presence-online')).not.toBeNull()

    avatar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    avatar.click()
    expect(clicks).toEqual(['click', 'click'])
  })

  it('mn-avatar falls back from a failed image to initials or the user icon', async () => {
    const withInitials = await mountAvatar((node) => {
      node.src = 'missing.png'
      node.initials = 'ab'
      node.alt = 'Alice'
    })
    const img = sr(withInitials).querySelector('img')!
    img.dispatchEvent(new Event('error'))
    await withInitials.updateComplete
    expect(sr(withInitials).querySelector('img')).toBeNull()
    expect(sr(withInitials).querySelector('.initials')?.textContent).toBe('AB')

    const fallback = await mountAvatar()
    expect(sr(fallback).querySelector('.icon svg')).not.toBeNull()
  })
})
