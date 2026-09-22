import {
  OPEN_WIKILINK_PICKER_EVENT,
  type Editor,
} from '@shrubbery/editor-kernel'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HojaEditor } from '../hoja-editor.js'
import type {
  HojaComposerDetail,
  HojaWikiLinkRequestDetail,
  HojaWikiLinkSuggestionsDetail,
} from '../types.js'

type HojaInternals = {
  editor: Editor | null
}

function editorOf(element: HojaEditor): Editor {
  const editor = (element as unknown as HojaInternals).editor
  if (!editor) throw new Error('Hoja editor did not mount')
  return editor
}

async function settle(element: HojaEditor): Promise<void> {
  await element.updateComplete
  await Promise.resolve()
  await element.updateComplete
}

async function mount(configure?: (element: HojaEditor) => void): Promise<HojaEditor> {
  const element = document.createElement('hoja-editor') as HojaEditor
  configure?.(element)
  document.body.appendChild(element)
  await settle(element)
  return element
}

function keydown(
  element: HojaEditor,
  init: KeyboardEventInit & { key: string },
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  element.querySelector<HTMLElement>('.ProseMirror')?.dispatchEvent(event)
  return event
}

function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection
    let handled = false
    editor.view.someProp('handleTextInput', handler => {
      handled = handler(editor.view, from, to, character, () => {
        const transaction = editor.state.tr.insertText(character, from, to)
        editor.view.dispatch(transaction)
        return transaction
      }) || handled
      return handled
    })
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('<hoja-editor> foundation', () => {
  it('registers a real light-DOM custom element over the existing kernel', async () => {
    expect(customElements.get('hoja-editor')).toBe(HojaEditor)
    const element = await mount()

    expect(element.shadowRoot).toBeNull()
    expect(element.querySelector('.hoja-editor__frame')).not.toBeNull()
    expect(element.querySelector('.ProseMirror')).not.toBeNull()
    expect(editorOf(element).schema.nodes.wikilink).toBeDefined()
    expect(editorOf(element).schema.marks.bold).toBeDefined()
  })

  it('adopts token-scoped mobile styles while leaving safe areas to its host', async () => {
    await mount()
    const stylesheetText = (HojaEditor.styles as unknown as { cssText: string }).cssText

    expect(stylesheetText).toContain('hoja-editor')
    expect(stylesheetText).toContain('--mn-color-surface-raised')
    expect(stylesheetText).toContain('2.75rem')
    expect(stylesheetText).toContain('min-width: 3rem')
    expect(stylesheetText).toContain('min-height: 3rem')
    expect(stylesheetText).not.toContain('safe-area-inset-bottom')
    expect(stylesheetText).toContain('40dvh')
  })

  it('renders a controlled canonical value and applies later host updates', async () => {
    const element = await mount(hoja => {
      hoja.value = 'A **rich** beginning.'
    })

    expect(element.querySelector('strong')?.textContent).toBe('rich')
    expect(element.getJSON().content?.[0]?.type).toBe('paragraph')

    element.value = 'The host changed it.'
    await settle(element)
    expect(element.querySelector('.ProseMirror')?.textContent).toBe('The host changed it.')
  })

  it('reports edit intent without mutating the controlled value property', async () => {
    const changes: HojaComposerDetail[] = []
    const eventChanges: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Hello'
      hoja.onChange = detail => changes.push(detail)
      hoja.addEventListener('hoja-change', event => {
        eventChanges.push((event as CustomEvent<HojaComposerDetail>).detail)
      })
    })
    const editor = editorOf(element)

    editor.commands.focus('end')
    editor.commands.insertContent(' **there**')

    expect(element.value).toBe('Hello')
    // insertContent receives literal text; canonical Markdown escapes it rather
    // than falsely claiming that a rich mark was applied.
    expect(changes.at(-1)?.value).toBe(String.raw`Hello \*\*there\*\*`)
    expect(eventChanges.at(-1)).toEqual(changes.at(-1))
    expect(changes.at(-1)?.json.type).toBe('doc')
  })

  it('focus() targets ProseMirror and disabled surfaces stay inert', async () => {
    const element = await mount()
    element.focus()
    expect(editorOf(element).isFocused).toBe(true)

    element.disabled = true
    await settle(element)
    expect(editorOf(element).isEditable).toBe(false)
    expect(element.querySelector('.ProseMirror')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('remounts its kernel cleanly after being detached and reconnected', async () => {
    const element = await mount(hoja => {
      hoja.value = 'Persistent host value'
    })
    element.remove()
    document.body.appendChild(element)
    await settle(element)

    expect(element.querySelector('.ProseMirror')?.textContent).toBe('Persistent host value')
    expect(editorOf(element).isDestroyed).toBe(false)
  })

  it('recreates only the inner editor on valueKey changes so undo cannot cross sessions', async () => {
    const element = await mount(hoja => {
      hoja.valueKey = 'session:a'
      hoja.value = 'Alpha draft'
    })
    const hostIdentity = element
    const firstEditor = editorOf(element)
    firstEditor.commands.focus('end')
    firstEditor.commands.insertContent(' private edit')
    expect(firstEditor.getText()).toContain('Alpha draft private edit')

    element.value = 'Beta draft'
    element.valueKey = 'session:b'
    await settle(element)
    const secondEditor = editorOf(element)

    expect(element).toBe(hostIdentity)
    expect(secondEditor).not.toBe(firstEditor)
    expect(firstEditor.isDestroyed).toBe(true)
    expect(secondEditor.getText()).toBe('Beta draft')
    secondEditor.commands.undo()
    expect(secondEditor.getText()).not.toContain('Alpha')
  })
})

describe('<hoja-editor> composer interaction', () => {
  it('submits non-empty content on Enter through callback and composed event', async () => {
    const callback = vi.fn<(detail: HojaComposerDetail) => void>()
    const events: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Carry this thought'
      hoja.onSubmit = callback
      hoja.addEventListener('hoja-submit', event => {
        events.push((event as CustomEvent<HojaComposerDetail>).detail)
      })
    })

    const event = keydown(element, { key: 'Enter' })

    expect(event.defaultPrevented).toBe(true)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]?.[0].value).toBe('Carry this thought')
    expect(events).toHaveLength(1)
  })

  it('does not submit an empty composer', async () => {
    const callback = vi.fn()
    const element = await mount(hoja => {
      hoja.onSubmit = callback
    })

    const event = keydown(element, { key: 'Enter' })
    expect(event.defaultPrevented).toBe(true)
    expect(callback).not.toHaveBeenCalled()
  })

  it('leaves Shift+Enter to the kernel hard-break command', async () => {
    const callback = vi.fn()
    const element = await mount(hoja => {
      hoja.value = 'Line one'
      hoja.onSubmit = callback
    })
    editorOf(element).commands.focus('end')

    keydown(element, { key: 'Enter', shiftKey: true })

    expect(callback).not.toHaveBeenCalled()
    expect(element.getJSON().content?.[0]?.content?.some(node => node.type === 'hardBreak')).toBe(true)
  })

  it('is IME-safe for native isComposing and composition lifecycle state', async () => {
    const callback = vi.fn()
    const element = await mount(hoja => {
      hoja.value = '編集中'
      hoja.onSubmit = callback
    })
    const proseMirror = element.querySelector<HTMLElement>('.ProseMirror')!

    const nativeComposition = keydown(element, { key: 'Enter', isComposing: true })
    expect(nativeComposition).toBeInstanceOf(KeyboardEvent)

    proseMirror.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const lifecycleComposition = keydown(element, { key: 'Enter' })
    expect(lifecycleComposition).toBeInstanceOf(KeyboardEvent)
    proseMirror.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))

    expect(callback).not.toHaveBeenCalled()
  })

  it('does not submit from non-composer postures or read-only state', async () => {
    const callback = vi.fn()
    const element = await mount(hoja => {
      hoja.value = 'Document matter'
      hoja.posture = 'embedded'
      hoja.onSubmit = callback
    })

    keydown(element, { key: 'Enter' })
    expect(callback).not.toHaveBeenCalled()

    element.posture = 'composer'
    element.readOnly = true
    await settle(element)
    keydown(element, { key: 'Enter' })
    expect(callback).not.toHaveBeenCalled()
    expect(editorOf(element).isEditable).toBe(false)
    expect(element.querySelector('.ProseMirror')?.getAttribute('aria-readonly')).toBe('true')
  })

  it('progressively reveals formatting and runs existing kernel commands', async () => {
    const element = await mount(hoja => {
      hoja.value = 'format me'
    })
    const editor = editorOf(element)
    editor.commands.setTextSelection({ from: 1, to: 7 })

    expect(element.querySelector('[role="toolbar"]')).toBeNull()
    element.querySelector<HTMLButtonElement>('.hoja-editor__format-toggle')?.click()
    await settle(element)
    const bold = element.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!
    bold.click()

    expect(element.querySelector('[role="toolbar"]')).not.toBeNull()
    expect(element.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('bold')
  })

  it('keeps formatting and reference lookup as mutually exclusive elaborations', async () => {
    const element = await mount(hoja => {
      hoja.resolveWikiLinks = () => []
    })
    const formatting = element.querySelector<HTMLButtonElement>('.hoja-editor__format-toggle')!
    const references = element.querySelector<HTMLButtonElement>('.hoja-editor__wikilink-toggle')!

    formatting.click()
    await settle(element)
    expect(element.querySelector('[role="toolbar"]')).not.toBeNull()

    references.click()
    await settle(element)
    expect(element.querySelector('[role="toolbar"]')).toBeNull()
    expect(element.querySelector('[role="listbox"]')).not.toBeNull()

    formatting.click()
    await settle(element)
    expect(element.querySelector('[role="listbox"]')).toBeNull()
    expect(element.querySelector('[role="toolbar"]')).not.toBeNull()
  })
})

describe('<hoja-editor> scoped wikilink seam', () => {
  it('round-trips bound [[label]] references into change and submit metadata', async () => {
    const submissions: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Open [[Living Codex]].'
      hoja.referenceBindings = [{
        label: 'Living Codex',
        targetDocId: 'doc:living-codex',
        targetGraphId: 'sophia-code-lab',
      }]
      hoja.onSubmit = detail => submissions.push(detail)
    })

    expect(element.querySelector('.wikilink')?.textContent).toBe('[[Living Codex]]')
    keydown(element, { key: 'Enter' })

    expect(submissions[0]?.value).toBe('Open [[Living Codex]].')
    expect(submissions[0]?.references).toEqual([
      expect.objectContaining({
        label: 'Living Codex',
        targetDocId: 'doc:living-codex',
        targetGraphId: 'sophia-code-lab',
      }),
    ])
  })

  it('uses the kernel instance callback without leaking a document-global picker event', async () => {
    const first = await mount(hoja => {
      hoja.value = 'See '
    })
    const second = await mount()
    const firstRequests: HojaWikiLinkRequestDetail[] = []
    const secondRequests: HojaWikiLinkRequestDetail[] = []
    let leakedLegacyEvents = 0
    first.addEventListener('hoja-wikilink-request', event => {
      firstRequests.push((event as CustomEvent<HojaWikiLinkRequestDetail>).detail)
    })
    second.addEventListener('hoja-wikilink-request', event => {
      secondRequests.push((event as CustomEvent<HojaWikiLinkRequestDetail>).detail)
    })
    const legacyListener = (): void => {
      leakedLegacyEvents += 1
    }
    document.addEventListener(OPEN_WIKILINK_PICKER_EVENT, legacyListener)
    first.focus()
    editorOf(first).commands.focus('end')
    typeText(editorOf(first), '[[liv')

    expect(firstRequests.length).toBeGreaterThan(0)
    expect(firstRequests.at(-1)).toEqual(expect.objectContaining({
      query: 'liv',
      matchedText: '[[liv',
      range: { from: 5, to: 10 },
    }))
    expect(secondRequests).toHaveLength(0)
    expect(leakedLegacyEvents).toBe(0)
    document.removeEventListener(OPEN_WIKILINK_PICKER_EVENT, legacyListener)
  })

  it('asks only the injected resolver and emits scoped suggestions', async () => {
    const resolver = vi.fn().mockResolvedValue([
      {
        label: 'Living Codex',
        targetDocId: 'doc:living-codex',
        targetGraphId: 'sophia-code-lab',
      },
    ])
    const suggestions: HojaWikiLinkSuggestionsDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'See '
      hoja.resolveWikiLinks = resolver
      hoja.addEventListener('hoja-wikilink-suggestions', event => {
        suggestions.push((event as CustomEvent<HojaWikiLinkSuggestionsDetail>).detail)
      })
    })
    element.focus()
    editorOf(element).commands.focus('end')
    typeText(editorOf(element), '[[liv')
    await Promise.resolve()
    await Promise.resolve()

    expect(resolver).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'liv' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(suggestions[0]?.suggestions[0]).toEqual(expect.objectContaining({
      targetDocId: 'doc:living-codex',
    }))
  })

  it('accepts a host suggestion, replaces only the active trigger, and reports resolved attrs', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'See '
      hoja.onChange = detail => changes.push(detail)
    })
    element.focus()
    let requestId = 0
    element.addEventListener('hoja-wikilink-request', event => {
      requestId = (event as CustomEvent<HojaWikiLinkRequestDetail>).detail.requestId
    })
    editorOf(element).commands.focus('end')
    typeText(editorOf(element), '[[liv')

    const accepted = element.acceptWikiLink({
      label: 'Living Codex',
      targetDocId: 'doc:living-codex',
      targetGraphId: 'sophia-code-lab',
    }, requestId)

    expect(accepted).toBe(true)
    expect(changes.at(-1)?.value).toBe('See [[Living Codex]]')
    expect(changes.at(-1)?.references).toEqual([
      expect.objectContaining({
        label: 'Living Codex',
        targetDocId: 'doc:living-codex',
        targetGraphId: 'sophia-code-lab',
      }),
    ])
    expect(element.acceptWikiLink({
      label: 'Stale',
      targetDocId: 'doc:stale',
    }, requestId)).toBe(false)
  })

  it('renders a host-resolved listbox and uses Arrow/Enter without sending the chat', async () => {
    const changes: HojaComposerDetail[] = []
    const submit = vi.fn()
    const element = await mount(hoja => {
      hoja.value = 'Ask '
      hoja.onChange = detail => changes.push(detail)
      hoja.onSubmit = submit
      hoja.resolveWikiLinks = () => [
        { label: 'First', targetDocId: 'doc:first', targetGraphId: 'graph:a' },
        { label: 'Second', targetDocId: 'doc:second', targetGraphId: 'graph:b' },
      ]
    })
    editorOf(element).commands.focus('end')
    element.querySelector<HTMLButtonElement>('.hoja-editor__wikilink-toggle')?.click()
    await settle(element)

    const listbox = element.querySelector<HTMLElement>('[role="listbox"]')!
    expect(listbox).not.toBeNull()
    expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(element.querySelector('.ProseMirror')?.getAttribute('aria-controls')).toBe(listbox.id)

    keydown(element, { key: 'ArrowDown' })
    expect(element.querySelector('.ProseMirror')?.getAttribute('aria-activedescendant')).toContain(
      'option-1',
    )
    keydown(element, { key: 'Enter' })
    await settle(element)

    expect(submit).not.toHaveBeenCalled()
    expect(changes.at(-1)?.value).toBe('Ask [[Second]]')
    expect(element.querySelector('[role="listbox"]')).toBeNull()
  })

  it('keeps loading, empty, and error resolver states honest', async () => {
    let resolveResults: ((value: readonly never[]) => void) | undefined
    const submit = vi.fn()
    const element = await mount(hoja => {
      hoja.value = 'Unresolved trigger'
      hoja.onSubmit = submit
      hoja.resolveWikiLinks = () => new Promise(resolve => {
        resolveResults = resolve
      })
    })
    element.focus()
    element.querySelector<HTMLButtonElement>('.hoja-editor__wikilink-toggle')?.click()
    await settle(element)

    expect(element.querySelector('[data-state="loading"]')?.textContent).toContain('Searching')
    expect(element.querySelector('.ProseMirror')?.getAttribute('aria-autocomplete')).toBe('list')
    const blockedEnter = keydown(element, { key: 'Enter' })
    expect(blockedEnter.defaultPrevented).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    resolveResults?.([])
    await Promise.resolve()
    await settle(element)
    expect(element.querySelector('[data-state="empty"]')?.textContent).toContain('No matching')

    element.resolveWikiLinks = () => Promise.reject(new Error('offline'))
    element.querySelector<HTMLButtonElement>('.hoja-editor__wikilink-toggle')?.click()
    await Promise.resolve()
    await settle(element)
    expect(element.querySelector('[data-state="error"]')?.textContent).toContain('Couldn’t load')
  })

  it('aborts a superseded resolver and ignores its late results', async () => {
    const signals: AbortSignal[] = []
    const resolvers: Array<(value: readonly [{ label: string; targetDocId: string }]) => void> = []
    const element = await mount(hoja => {
      hoja.resolveWikiLinks = (_request, { signal }) => {
        signals.push(signal)
        return new Promise(resolve => resolvers.push(resolve))
      }
    })
    element.focus()
    const toggle = element.querySelector<HTMLButtonElement>('.hoja-editor__wikilink-toggle')!
    toggle.click()
    toggle.click()

    expect(signals).toHaveLength(2)
    expect(signals[0]?.aborted).toBe(true)
    resolvers[0]?.([{ label: 'Stale', targetDocId: 'doc:stale' }])
    resolvers[1]?.([{ label: 'Fresh', targetDocId: 'doc:fresh' }])
    await Promise.resolve()
    await settle(element)

    expect(element.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(element.querySelector('[role="option"]')?.textContent).toContain('Fresh')
  })

  it('supports pointer selection without stealing editor focus and Escape closes locally', async () => {
    const element = await mount(hoja => {
      hoja.resolveWikiLinks = () => [
        { label: 'Pointer target', targetDocId: 'doc:pointer' },
      ]
    })
    element.focus()
    const toggle = element.querySelector<HTMLButtonElement>('.hoja-editor__wikilink-toggle')!
    toggle.click()
    await settle(element)
    const option = element.querySelector<HTMLElement>('[role="option"]')!
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    option.dispatchEvent(pointer)

    expect(pointer.defaultPrevented).toBe(true)
    expect(editorOf(element).isFocused).toBe(true)
    expect(element.getJSON().content?.[0]?.content?.some(node => node.type === 'wikilink')).toBe(true)

    toggle.click()
    await settle(element)
    keydown(element, { key: 'Escape' })
    await settle(element)
    expect(element.querySelector('[role="listbox"]')).toBeNull()
    expect(element.querySelector('.ProseMirror')?.hasAttribute('aria-controls')).toBe(false)
  })
})
