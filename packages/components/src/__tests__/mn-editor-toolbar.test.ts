/**
 * REAL component test — controlled Garden editor toolbar shell.
 *
 * The toolbar is UI-only: it emits intent events and never runs editor commands.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-editor-toolbar.js'
import type { MnEditorToolbar } from '../mn-editor-toolbar.js'
import type { MnDropdownButton } from '../mn-dropdown-button.js'

function sr(el: MnEditorToolbar): ShadowRoot {
  return el.shadowRoot!
}

async function mountToolbar(setup?: (el: MnEditorToolbar) => void): Promise<MnEditorToolbar> {
  const el = document.createElement('mn-editor-toolbar') as MnEditorToolbar
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function shadowButton(control: Element | null): Promise<HTMLButtonElement> {
  expect(control).not.toBeNull()
  const el = control as HTMLElement & { updateComplete?: Promise<unknown> }
  await el.updateComplete
  const button = el.shadowRoot?.querySelector('button') as HTMLButtonElement | null
  expect(button).not.toBeNull()
  return button!
}

describe('mn-editor-toolbar', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders the primitive toolbar shell with controlled pressed state', async () => {
    const el = await mountToolbar((node) => {
      node.formatState = {
        bold: true,
        italic: false,
        strike: false,
        code: false,
        highlight: true,
      }
      node.blockType = 'heading2'
      node.fontFamily = "'Literata Variable', 'Literata', serif"
      node.fontSize = '20px'
      node.textAlign = 'center'
      node.inTable = true
    })

    expect(customElements.get('mn-editor-toolbar')).toBeDefined()
    expect(sr(el).querySelector('mn-toolbar')).not.toBeNull()
    expect(sr(el).querySelectorAll('mn-toolbar-group')).toHaveLength(5)
    expect(sr(el).querySelectorAll('mn-toolbar mn-icon-button')).toHaveLength(21)
    expect(sr(el).querySelectorAll('mn-button')).toHaveLength(1)
    expect((sr(el).querySelector('[data-font-family-select]') as MnDropdownButton).selectedId).toBe(
      "'Literata Variable', 'Literata', serif",
    )
    expect((sr(el).querySelector('[data-font-family-select]') as MnDropdownButton).label).toBe('Literata')
    expect((sr(el).querySelector('[data-font-size-select]') as MnDropdownButton).selectedId).toBe('20px')
    expect((sr(el).querySelector('[data-block-select]') as MnDropdownButton).selectedId).toBe('heading2')
    expect((await shadowButton(sr(el).querySelector('[data-format-command="bold"]'))).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect((await shadowButton(sr(el).querySelector('[data-align-command="center"]'))).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect((await shadowButton(sr(el).querySelector('[data-table-command]'))).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('makes intermediate-width overflow discoverable and keyboard-operable', async () => {
    const el = await mountToolbar()
    const toolbar = sr(el).querySelector('.toolbar-scroll-shell > mn-toolbar') as HTMLElement
    let scrollLeft = 0
    const scrollRequests: ScrollToOptions[] = []
    Object.defineProperties(toolbar, {
      clientWidth: { configurable: true, value: 400 },
      scrollWidth: { configurable: true, value: 1_200 },
      scrollLeft: {
        configurable: true,
        get: () => scrollLeft,
        set: (value: number) => { scrollLeft = value },
      },
    })
    toolbar.scrollBy = ((options?: ScrollToOptions | number, y?: number) => {
      const request = typeof options === 'number' ? { left: options, top: y } : options ?? {}
      scrollRequests.push(request)
      scrollLeft += request.left ?? 0
      toolbar.dispatchEvent(new Event('scroll'))
    }) as typeof toolbar.scrollBy

    ;(el as unknown as { syncToolbarOverflow(): void }).syncToolbarOverflow()
    await el.updateComplete
    const shell = sr(el).querySelector('.toolbar-scroll-shell') as HTMLElement
    const start = sr(el).querySelector('[data-toolbar-scroll="start"]')
    const end = sr(el).querySelector('[data-toolbar-scroll="end"]')
    expect(shell.dataset.overflow).toBe('true')
    expect((await shadowButton(start)).disabled).toBe(true)
    expect((await shadowButton(end)).disabled).toBe(false)

    ;(await shadowButton(end)).click()
    const scrollRequest = scrollRequests.at(-1)
    expect(scrollRequest?.left).toBeGreaterThan(0)
    expect(scrollRequest?.behavior).toMatch(/smooth|auto/)

    scrollLeft = 800
    ;(el as unknown as { syncToolbarOverflow(): void }).syncToolbarOverflow()
    await el.updateComplete
    expect((await shadowButton(start)).disabled).toBe(false)
    expect((await shadowButton(end)).disabled).toBe(true)
    expect(shell.dataset.atEnd).toBe('true')
  })

  it('mouse-wheel scrolls the overflowed toolbar horizontally, but does not trap vertical page scroll at the boundaries', async () => {
    const el = await mountToolbar()
    const toolbar = sr(el).querySelector('.toolbar-scroll-shell > mn-toolbar') as HTMLElement
    let scrollLeft = 0
    Object.defineProperties(toolbar, {
      clientWidth: { configurable: true, value: 400 },
      scrollWidth: { configurable: true, value: 1_200 },
      scrollLeft: {
        configurable: true,
        get: () => scrollLeft,
        set: (value: number) => { scrollLeft = value },
      },
    })
    ;(el as unknown as { syncToolbarOverflow(): void }).syncToolbarOverflow()
    await el.updateComplete
    const shell = sr(el).querySelector('.toolbar-scroll-shell') as HTMLElement

    function wheel(deltaY: number): WheelEvent {
      const event = new WheelEvent('wheel', { deltaY, deltaX: 0, cancelable: true, bubbles: true })
      shell.dispatchEvent(event)
      return event
    }

    // At the very start (scrollLeft=0): scrolling further "up" can't move
    // the toolbar — must not preventDefault, so the page scrolls instead.
    const atStart = wheel(-40)
    expect(atStart.defaultPrevented).toBe(false)
    expect(scrollLeft).toBe(0)

    // Mid-range: a real horizontal-scroll gesture, claims the event.
    const midScroll = wheel(120)
    expect(midScroll.defaultPrevented).toBe(true)
    expect(scrollLeft).toBe(120)

    // At the end (scrollLeft===maxScroll): scrolling further "down" can't
    // move the toolbar either — must not preventDefault.
    scrollLeft = 800 // maxScroll = 1200 - 400
    const atEnd = wheel(40)
    expect(atEnd.defaultPrevented).toBe(false)
    expect(scrollLeft).toBe(800)
  })

  it('layers a compact primary toolbar over the same editor intents and discloses the full tools', async () => {
    const el = await mountToolbar((node) => {
      node.formatState = {
        bold: true,
        italic: false,
        strike: false,
        code: false,
        highlight: false,
      }
    })
    const seen: string[] = []
    el.addEventListener('mn-editor-history', event => {
      seen.push(`history:${(event as CustomEvent<{ command: string }>).detail.command}`)
    })
    el.addEventListener('mn-editor-format', event => {
      seen.push(`format:${(event as CustomEvent<{ command: string }>).detail.command}`)
    })

    expect(sr(el).querySelector('[role="toolbar"][aria-label="Common editor actions"]')).not.toBeNull()
    expect(sr(el).querySelectorAll('.compact-primary-toolbar > mn-icon-button')).toHaveLength(5)
    expect((await shadowButton(sr(el).querySelector('[data-compact-format-command="bold"]'))).getAttribute('aria-pressed')).toBe('true')

    ;(await shadowButton(sr(el).querySelector('[data-compact-history-command="undo"]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-compact-format-command="italic"]'))).click()
    expect(seen).toEqual(['history:undo', 'format:italic'])

    const toggle = await shadowButton(sr(el).querySelector('[data-compact-tools-toggle]'))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('mn-editor-more-tools')
    toggle.click()
    await el.updateComplete

    const disclosure = sr(el).querySelector('#mn-editor-more-tools') as HTMLElement
    expect(disclosure.dataset.compactOpen).toBe('true')
    expect(disclosure.getAttribute('role')).toBe('dialog')
    expect(disclosure.getAttribute('aria-modal')).toBe('true')
    expect((await shadowButton(sr(el).querySelector('[data-compact-tools-toggle]'))).getAttribute('aria-expanded')).toBe('true')

    await Promise.resolve()
    const done = sr(el).querySelector('.compact-sheet-done') as HTMLButtonElement
    expect(sr(el).activeElement).toBe(done)
    done.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      composed: true,
    }))
    expect(sr(el).activeElement).not.toBe(done)

    done.focus()

    disclosure.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await el.updateComplete
    await Promise.resolve()
    expect(disclosure.dataset.compactOpen).toBe('false')
    expect((await shadowButton(sr(el).querySelector('[data-compact-tools-toggle]'))).getAttribute('aria-expanded')).toBe('false')
    expect(sr(el).activeElement).toBe(sr(el).querySelector('[data-compact-tools-toggle]'))
  })

  it('reflects controlled TTS availability/state and emits a modifier-preserving intent', async () => {
    const el = await mountToolbar((node) => {
      node.ttsAvailable = true
      node.ttsStatus = 'playing'
    })
    const seen: unknown[] = []
    el.addEventListener('mn-editor-tts-toggle', event => {
      seen.push((event as CustomEvent).detail)
    })
    const control = sr(el).querySelector('[data-tts-command]') as HTMLElement & {
      updateComplete?: Promise<unknown>
    }
    await control.updateComplete
    const button = await shadowButton(control)
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toContain('Stop reading')

    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      composed: true,
      shiftKey: true,
      altKey: true,
    }))
    expect(seen).toEqual([{
      shiftKey: true,
      altKey: true,
      metaKey: false,
      ctrlKey: false,
    }])

    el.ttsAvailable = false
    el.ttsStatus = 'idle'
    await el.updateComplete
    expect((await shadowButton(sr(el).querySelector('[data-tts-command]'))).disabled).toBe(true)
  })

  it('offers a real View Original toggle and an honest annotation-limited reader toolbar', async () => {
    const el = await mountToolbar((node) => { node.originalViewAvailable = true })
    const events: string[] = []
    el.addEventListener('mn-editor-original-view-toggle', () => events.push('toggle'))
    const viewControl = sr(el).querySelector('[data-original-view-toggle]')
    const viewButton = await shadowButton(viewControl)
    expect(viewButton.disabled).toBe(false)
    expect(viewButton.getAttribute('aria-label')).toBe('View Original')
    viewButton.click()
    expect(events).toEqual(['toggle'])

    el.originalViewActive = true
    await el.updateComplete
    expect(sr(el).querySelector('mn-toolbar')?.getAttribute('aria-label')).toBe('Original file tools')
    expect(sr(el).querySelector('[data-original-annotation-unavailable]')?.textContent).toContain(
      'highlights and comments are unavailable',
    )
    const documentView = await shadowButton(sr(el).querySelector('[data-original-view-toggle]'))
    expect(documentView.textContent).toContain('Document View')
    const highlight = await shadowButton(sr(el).querySelector('[data-original-highlight-unavailable]'))
    const comment = await shadowButton(sr(el).querySelector('[data-original-comment-unavailable]'))
    expect(highlight.disabled).toBe(true)
    expect(comment.disabled).toBe(true)
    documentView.click()
    expect(events).toEqual(['toggle', 'toggle'])
  })

  it('hides toolbar-group captions without hiding nested mn-button labels (regression: --mn-toolbar-group-label-display must not leak to --mn-label-display consumers)', async () => {
    const el = await mountToolbar((node) => { node.originalViewAvailable = true; node.originalViewActive = true })
    const group = sr(el).querySelector('mn-toolbar-group')
    expect(group).not.toBeNull()
    // element.textContent is unaffected by CSS display:none, so this only
    // catches the regression when read via computed style, not textContent.
    const groupCaption = group!.shadowRoot?.querySelector('.label') as HTMLElement | null
    expect(groupCaption).not.toBeNull()
    expect(getComputedStyle(groupCaption!).display).toBe('none')

    const documentViewButton = sr(el).querySelector('[data-original-view-toggle]') as HTMLElement & { shadowRoot: ShadowRoot }
    await (documentViewButton as unknown as { updateComplete: Promise<unknown> }).updateComplete
    const buttonLabel = documentViewButton.shadowRoot.querySelector('.button-label') as HTMLElement | null
    expect(buttonLabel).not.toBeNull()
    expect(getComputedStyle(buttonLabel!).display).not.toBe('none')
  })

  it('renders an accessible read-only toolbar and emits Make Editable intent', async () => {
    const el = await mountToolbar((node) => {
      node.readOnly = true
      node.originalViewAvailable = true
    })
    const seen: string[] = []
    el.addEventListener('mn-editor-make-editable', () => seen.push('make-editable'))

    expect(sr(el).querySelector('[data-read-only-badge]')?.textContent).toContain('View Only')
    expect(sr(el).querySelector('[data-format-command]')).toBeNull()
    expect(await shadowButton(sr(el).querySelector('[data-original-view-toggle]'))).not.toBeNull()
    const makeEditable = await shadowButton(sr(el).querySelector('[data-make-editable]'))
    expect(makeEditable.disabled).toBe(false)
    makeEditable.click()
    expect(seen).toEqual(['make-editable'])

    el.makeEditableStatus = 'saving'
    await el.updateComplete
    expect((await shadowButton(sr(el).querySelector('[data-make-editable]'))).disabled).toBe(true)
    el.makeEditableStatus = 'error'
    el.makeEditableError = 'Workspace update failed'
    await el.updateComplete
    expect(el.makeEditableStatus).toBe('error')
    expect(el.makeEditableError).toBe('Workspace update failed')
    expect(el.readOnly).toBe(true)
    expect(sr(el).querySelector('[role="alert"]')?.textContent).toContain('Workspace update failed')
  })

  it('labels a missing document authority honestly and never offers ACL conversion while waiting', async () => {
    const el = await mountToolbar(node => {
      node.readOnly = true
      node.activationPending = true
      node.originalViewAvailable = true
    })

    expect(sr(el).querySelector('[data-read-only-badge]')?.textContent).toContain(
      'Waiting for document authority',
    )
    expect(sr(el).querySelector('[data-read-only-badge]')?.getAttribute(
      'data-activation-pending',
    )).toBe('true')
    expect(sr(el).querySelector('[data-make-editable]')).toBeNull()
    expect(sr(el).querySelector('[data-original-view-toggle]')).toBeNull()
    expect(sr(el).querySelector('[data-format-command]')).toBeNull()
  })

  it('keeps offline documents editable while exposing local durability', async () => {
    const el = await mountToolbar(node => {
      node.activationState = 'offline-dirty'
      node.activationDurability = 'durable'
    })

    expect(sr(el).querySelector('[data-format-command]')).not.toBeNull()
    expect(sr(el).querySelector('[data-document-sync-badge]')?.textContent).toContain(
      'Offline · Saved locally',
    )
  })

  it('makes failed offline durability loud and removes editing controls', async () => {
    const el = await mountToolbar(node => {
      node.readOnly = true
      node.activationState = 'offline-dirty'
      node.activationDurability = 'failed'
    })

    expect(sr(el).querySelector('[data-read-only-badge]')?.textContent).toContain(
      'Local save failed',
    )
    expect(sr(el).querySelector('[data-format-command]')).toBeNull()
  })

  it('locks an incarnation conflict and testifies that recovery was preserved', async () => {
    const el = await mountToolbar(node => {
      node.readOnly = true
      node.activationState = 'conflict'
      node.activationConflict = 'replaced'
    })

    expect(sr(el).querySelector('[data-read-only-badge]')?.textContent).toContain(
      'Document replaced · Local recovery saved',
    )
    expect(sr(el).querySelector('[data-make-editable]')).toBeNull()
  })

  it('emits editor intent events for type controls, formatting, block type, alignment, and table', async () => {
    const el = await mountToolbar()
    const seen: string[] = []

    el.addEventListener('mn-editor-font-family', (event) => {
      seen.push(`font:${(event as CustomEvent<{ value: string }>).detail.value}`)
    })
    el.addEventListener('mn-editor-font-size', (event) => {
      seen.push(`size:${(event as CustomEvent<{ value: string }>).detail.value}`)
    })
    el.addEventListener('mn-editor-format', (event) => {
      seen.push(`format:${(event as CustomEvent<{ command: string }>).detail.command}`)
    })
    el.addEventListener('mn-editor-history', (event) => {
      seen.push(`history:${(event as CustomEvent<{ command: string }>).detail.command}`)
    })
    el.addEventListener('mn-editor-history-open', () => {
      seen.push('history-open')
    })
    el.addEventListener('mn-editor-block-type', (event) => {
      seen.push(`block:${(event as CustomEvent<{ blockType: string }>).detail.blockType}`)
    })
    el.addEventListener('mn-editor-clear-formatting', () => {
      seen.push('clear')
    })
    el.addEventListener('mn-editor-align', (event) => {
      seen.push(`align:${(event as CustomEvent<{ alignment: string }>).detail.alignment}`)
    })
    el.addEventListener('mn-editor-table-toggle', () => {
      seen.push('table')
    })
    el.addEventListener('mn-editor-footnote-insert', () => {
      seen.push('footnote')
    })
    el.addEventListener('mn-editor-citation-open', () => {
      seen.push('citation')
    })
    el.addEventListener('mn-editor-comment-insert', () => {
      seen.push('comment')
    })
    el.addEventListener('mn-editor-image-insert', () => {
      seen.push('image')
    })
    el.addEventListener('mn-editor-shortcuts-open', () => {
      seen.push('shortcuts')
    })
    el.addEventListener('mn-editor-wikilink-open', () => {
      seen.push('wikilink')
    })
    el.addEventListener('mn-editor-document-wire-request', (event) => {
      const detail = (event as CustomEvent<{
        shiftKey: boolean
        altKey: boolean
        metaKey: boolean
        ctrlKey: boolean
      }>).detail
      seen.push(
        `wire:${detail.shiftKey ? 'shift' : 'plain'}:${detail.altKey ? 'alt' : 'no-alt'}:${detail.metaKey ? 'meta' : 'no-meta'}:${detail.ctrlKey ? 'ctrl' : 'no-ctrl'}`,
      )
    })

    const noModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
    const fontFamily = sr(el).querySelector('[data-font-family-select]') as MnDropdownButton
    fontFamily.dispatchEvent(new CustomEvent('mn-select', {
      bubbles: true,
      composed: true,
      detail: { id: "'Lora', serif", item: { id: "'Lora', serif", label: 'Lora' }, modifiers: noModifiers },
    }))
    const fontSize = sr(el).querySelector('[data-font-size-select]') as MnDropdownButton
    fontSize.dispatchEvent(new CustomEvent('mn-select', {
      bubbles: true,
      composed: true,
      detail: { id: '24px', item: { id: '24px', label: 'L' }, modifiers: noModifiers },
    }))
    ;(await shadowButton(sr(el).querySelector('[data-format-command="italic"]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-footnote-command]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-citation-command]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-comment-command]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-version-history-open]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-history-command="undo"]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-history-command="redo"]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-wikilink-command]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-document-wire-command]'))).dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        shiftKey: true,
        altKey: true,
        metaKey: true,
      }),
    )
    const blockType = sr(el).querySelector('[data-block-select]') as MnDropdownButton
    blockType.dispatchEvent(new CustomEvent('mn-select', {
      bubbles: true,
      composed: true,
      detail: { id: 'blockquote', item: { id: 'blockquote', label: 'Quote' }, modifiers: noModifiers },
    }))
    ;(await shadowButton(sr(el).querySelector('[data-clear-formatting-command]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-align-command="right"]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-table-command]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-image-command]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-shortcuts-open]'))).click()

    expect(seen).toEqual([
      "font:'Lora', serif",
      'size:24px',
      'format:italic',
      'footnote',
      'citation',
      'comment',
      'history-open',
      'history:undo',
      'history:redo',
      'wikilink',
      'wire:shift:alt:meta:no-ctrl',
      'block:blockquote',
      'clear',
      'align:right',
      'table',
      'image',
      'shortcuts',
    ])
  })

  it('renders controlled search/replace and emits text, key, and action events', async () => {
    const el = await mountToolbar((node) => {
      node.searchOpen = true
      node.searchQuery = 'alpha'
      node.replaceQuery = 'beta'
      node.searchResultCount = 3
      node.searchCurrentIndex = 1
    })
    const seen: string[] = []
    el.addEventListener('mn-editor-search-input', (event) => {
      seen.push(`search:${(event as CustomEvent<{ value: string }>).detail.value}`)
    })
    el.addEventListener('mn-editor-replace-input', (event) => {
      seen.push(`replace:${(event as CustomEvent<{ value: string }>).detail.value}`)
    })
    el.addEventListener('mn-editor-search-keydown', (event) => {
      seen.push(`search-key:${(event as CustomEvent<{ keyboardEvent: KeyboardEvent }>).detail.keyboardEvent.key}`)
    })
    el.addEventListener('mn-editor-replace-current', () => seen.push('replace-current'))
    el.addEventListener('mn-editor-replace-all', () => seen.push('replace-all'))

    expect(sr(el).querySelector('[data-search-count]')?.textContent?.trim()).toBe('2 / 3')

    const search = sr(el).querySelector('[data-search-input]') as HTMLInputElement
    search.value = 'gamma'
    search.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    const replace = sr(el).querySelector('[data-replace-input]') as HTMLInputElement
    replace.value = 'delta'
    replace.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    ;(await shadowButton(sr(el).querySelector('[data-replace-current]'))).click()
    ;(await shadowButton(sr(el).querySelector('[data-replace-all]'))).click()

    expect(seen).toEqual([
      'search:gamma',
      'search-key:Enter',
      'replace:delta',
      'replace-current',
      'replace-all',
    ])
  })
})
