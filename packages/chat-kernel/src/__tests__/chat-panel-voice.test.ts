/**
 * The Voice picker inside the real <sh-chat-panel> (NO MOCKS): a live Lit element
 * in a real (happy-dom) document, driven by real DOM events, fed a roster shaped
 * like the live catalogue. Each test names the defect it guards.
 */
import type { HojaEditor } from '@shrubbery/hoja'
import { afterEach, describe, expect, it } from 'vitest'

import { ShChatPanel } from '../chat-panel.js'
import type { ChatComposerNotice, ChatMessage, ChatModelOption } from '../types.js'
import { HOUSE_VOICE, legacyRoster, voiceRoster } from './fixtures/voice-roster.js'

void ShChatPanel

const DEFAULT_VIEWPORT_WIDTH = window.innerWidth

function mount(): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  document.body.appendChild(el)
  return el
}

async function settle(el: ShChatPanel): Promise<void> {
  await el.updateComplete
  const hoja = el.querySelector<HojaEditor>('hoja-editor')
  if (hoja) {
    await hoja.updateComplete
    await Promise.resolve()
    await hoja.updateComplete
  }
  await el.updateComplete
}

function trigger(el: ShChatPanel): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>('.model-selector-trigger')
  if (!button) throw new Error('voice trigger not mounted')
  return button
}

async function open(el: ShChatPanel): Promise<void> {
  trigger(el).click()
  await settle(el)
  await el.updateComplete
}

async function type(el: ShChatPanel, query: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>('.model-picker-search-input')
  if (!input) throw new Error('search box not mounted')
  input.value = query
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle(el)
}

function optionIds(el: ShChatPanel, scope = '.model-picker'): string[] {
  return Array.from(el.querySelectorAll<HTMLElement>(`${scope} [data-model-id]`)).map(
    option => option.dataset.modelId ?? '',
  )
}

function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function assistant(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'hello',
    parts: [{ type: 'text', content: 'hello' }],
    isStreaming: false,
    toolCalls: [],
    createdAt: 1,
    ...partial,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DEFAULT_VIEWPORT_WIDTH })
})

describe('the Voice picker over a live catalogue', () => {
  it('pins the House default first, named honestly, with its price, window and tools badge', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)

    const pinned = el.querySelector<HTMLElement>('.model-picker-pinned')
    expect(pinned).not.toBeNull()
    expect(pinned!.getAttribute('role')).toBe('listbox')
    expect(pinned!.getAttribute('aria-label')).toBe('House default')
    expect(optionIds(el, '.model-picker-pinned')).toEqual([HOUSE_VOICE.id])
    const text = squash(pinned!.textContent)
    expect(text).toContain('Gemini 2.5 Flash')
    expect(text).toContain('House default · via OpenRouter')
    expect(text).toContain('$0.30 in · $2.50 out')
    expect(text).toContain('1M ctx')
    expect(text).toContain('tools')
    // It comes before every browse column in the sheet.
    const ids = optionIds(el)
    expect(ids[0]).toBe(HOUSE_VOICE.id)
    expect(pinned!.querySelector('.model-picker-model')?.classList.contains('selected')).toBe(true)
  })

  it('does not repeat the House default inside its maker group', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = 'moonshotai/kimi-k2.6'
    await settle(el)
    await open(el)

    const google = el.querySelector<HTMLElement>('[data-model-provider="Google"]')!
    expect(google.dataset.count).toBe('2')
    google.click()
    await settle(el)
    expect(optionIds(el, '.model-picker-models')).toEqual([
      'google/gemini-2.5-pro',
      'google/gemini-3-pro',
    ])
  })

  it('groups by maker, well-known makers first, and shows price in and out, context and tools on every entry', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = 'moonshotai/kimi-k2.6'
    await settle(el)
    await open(el)

    const providers = Array.from(el.querySelectorAll<HTMLElement>('.model-picker-provider')).map(
      button => button.dataset.modelProvider,
    )
    expect(providers.slice(0, 6)).toEqual([
      'DeepSeek',
      'Anthropic',
      'OpenAI',
      'Google',
      'Moonshot',
      'Thinking Machines',
    ])
    // Moonshot holds the selection, so it is the active column.
    const shown = Array.from(el.querySelectorAll<HTMLElement>('.model-picker-models .model-picker-model'))
    expect(shown.map(option => option.dataset.modelId)).toEqual([
      'moonshotai/kimi-k2.5',
      'moonshotai/kimi-k2.6',
      'moonshotai/kimi-k3',
    ])
    const k26 = squash(shown[1].textContent)
    expect(k26).toContain('Kimi K2.6')
    expect(k26).toContain('$0.65 in · $3.41 out')
    expect(k26).toContain('262K ctx')
    expect(k26).toContain('tools')
    expect(el.querySelector('.model-picker-foot-caption')?.textContent).toBe('US dollars per million tokens')
  })

  it('badges a voice that cannot use tools plainly rather than hiding the difference', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = 'perplexity/sonar-pro'
    await settle(el)
    await open(el)

    const sonar = el.querySelector<HTMLElement>('[data-model-id="perplexity/sonar-pro"]')!
    expect(squash(sonar.textContent)).toContain('no tools')
    expect(sonar.querySelector('.voice-badge.no-tools')).not.toBeNull()
  })

  it('offers a search box only for a long roster, and puts the cursor in it on a desktop', async () => {
    const short = mount()
    short.models = legacyRoster()
    short.currentModel = 'gpt-5.2'
    await settle(short)
    await open(short)
    expect(short.querySelector('.model-picker-search-input')).toBeNull()
    short.remove()

    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    const input = el.querySelector<HTMLInputElement>('.model-picker-search-input')
    expect(input).not.toBeNull()
    expect(input!.placeholder).toBe('Search 25 voices')
    expect(document.activeElement).toBe(input)
  })

  it('keeps the cursor out of the search box on a phone, where the keyboard would cover the sheet', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = 'moonshotai/kimi-k2.6'
    await settle(el)
    await open(el)

    expect(el.querySelector('.model-picker-search-input')).not.toBeNull()
    expect(document.activeElement).not.toBe(el.querySelector('.model-picker-search-input'))
    expect((document.activeElement as HTMLElement | null)?.dataset.modelProvider).toBe('Moonshot')
    expect(el.querySelector('.model-picker-sheet')?.getAttribute('aria-modal')).toBe('true')
  })
})

describe('searching the catalogue', () => {
  it('finds voices across every maker at once, grouped by maker, and drops the browse columns', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    await type(el, 'kimi')

    expect(el.querySelector('.model-picker-provider')).toBeNull()
    const groups = Array.from(el.querySelectorAll<HTMLElement>('.model-picker-result-group'))
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['Moonshot'])
    expect(optionIds(el, '.model-picker-models')).toEqual([
      'moonshotai/kimi-k2.5',
      'moonshotai/kimi-k2.6',
      'moonshotai/kimi-k3',
    ])
    // The House default does not match, so it is not dragged into the results.
    expect(el.querySelector('.model-picker-pinned')).toBeNull()
  })

  it('searches maker names and ids as well as display names', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    await type(el, 'deepseek')

    expect(optionIds(el, '.model-picker-models')).toEqual([
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
    ])
  })

  it('keeps the House default pinned when it matches the query', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = 'moonshotai/kimi-k2.6'
    await settle(el)
    await open(el)
    await type(el, 'gemini')

    expect(optionIds(el, '.model-picker-pinned')).toEqual([HOUSE_VOICE.id])
    expect(optionIds(el, '.model-picker-models')).toEqual([
      'google/gemini-2.5-pro',
      'google/gemini-3-pro',
    ])
  })

  it('says plainly when nothing matches', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    await type(el, 'zzzz')

    expect(el.querySelector('.model-picker-empty')?.textContent).toBe('No voices match “zzzz”.')
    expect(el.querySelector('[data-model-id]')).toBeNull()
  })

  it('clears the query when the picker is closed and reopened', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    await type(el, 'kimi')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle(el)
    expect(el.querySelector('.model-picker')).toBeNull()

    await open(el)
    expect(el.querySelector<HTMLInputElement>('.model-picker-search-input')!.value).toBe('')
    expect(el.querySelector('.model-picker-provider')).not.toBeNull()
  })

  it('moves between the search box and the results with the arrow keys', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    const input = el.querySelector<HTMLInputElement>('.model-picker-search-input')!

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect((document.activeElement as HTMLElement).dataset.modelId).toBe(HOUSE_VOICE.id)

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(input)
  })
})

describe('choosing a voice', () => {
  it('emits the intent for a voice found by search and closes the picker', async () => {
    const el = mount()
    const chosen: string[] = []
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    el.onModelChange = id => chosen.push(id)
    await settle(el)
    await open(el)
    await type(el, 'k2.6')

    el.querySelector<HTMLButtonElement>('[data-model-id="moonshotai/kimi-k2.6"]')!.click()
    await settle(el)
    expect(chosen).toEqual(['moonshotai/kimi-k2.6'])
    expect(el.querySelector('.model-picker')).toBeNull()
  })

  it('will not choose a listed voice the host marked unavailable', async () => {
    const el = mount()
    const chosen: string[] = []
    const unpriced: ChatModelOption = {
      id: 'acme/unpriced-1',
      label: 'Unpriced One',
      priceInPerMTok: null,
      priceOutPerMTok: null,
      disabled: true,
      disabledReason: 'This voice has no price yet, so it cannot be offered.',
    }
    el.models = [...voiceRoster(), unpriced]
    el.currentModel = HOUSE_VOICE.id
    el.onModelChange = id => chosen.push(id)
    await settle(el)
    await open(el)
    await type(el, 'unpriced')

    const option = el.querySelector<HTMLButtonElement>('[data-model-id="acme/unpriced-1"]')!
    expect(option.disabled).toBe(true)
    expect(option.title).toBe('This voice has no price yet, so it cannot be offered.')
    expect(squash(option.textContent)).toContain('price not listed')
    option.click()
    await settle(el)
    expect(chosen).toEqual([])
  })

  it('labels the trigger with the honest name of the current voice and locks after the first message', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = 'moonshotai/kimi-k2.6'
    await settle(el)
    expect(squash(trigger(el).textContent)).toBe('Kimi K2.6 v')
    expect(trigger(el).getAttribute('aria-label')).toBe('Voice: Kimi K2.6')
    expect(trigger(el).title).toBe('Choose a voice')

    el.messages = [assistant()]
    await settle(el)
    expect(trigger(el).disabled).toBe(true)
    expect(trigger(el).title).toBe('The voice is fixed once a conversation begins')
    expect(squash(trigger(el).textContent)).toContain('Kimi K2.6')
    trigger(el).click()
    await settle(el)
    expect(el.querySelector('.model-picker')).toBeNull()
  })

  it('shows no picker at all when the host offers no voices (an older Choreograph)', async () => {
    const el = mount()
    el.models = []
    await settle(el)
    expect(el.querySelector('.model-selector-trigger')).toBeNull()
    expect(el.querySelector('.model-dropdown')).toBeNull()
  })
})

describe('the account line and the reserved notice', () => {
  it('shows the host-projected balance beside the picker and in the sheet, computing nothing itself', async () => {
    const el = mount()
    el.models = voiceRoster()
    el.currentModel = HOUSE_VOICE.id
    el.accountNote = { label: 'Credits', value: '$4.20', hint: 'Your credit balance.' }
    await settle(el)

    const chip = el.querySelector<HTMLElement>('[data-account-note]')
    expect(chip).not.toBeNull()
    expect(squash(chip!.textContent)).toBe('Credits $4.20')
    expect(chip!.title).toBe('Your credit balance.')

    await open(el)
    expect(el.querySelector('.model-picker-foot-account')?.textContent).toBe('Credits $4.20')
  })

  it('still shows the balance when there is no picker, because credits apply either way', async () => {
    const el = mount()
    el.models = []
    el.accountNote = { label: 'Credits', value: '$0.00' }
    await settle(el)
    expect(el.querySelector('.model-selector-trigger')).toBeNull()
    expect(squash(el.querySelector('[data-account-note]')?.textContent)).toBe('Credits $0.00')
  })

  it('renders the reserved composer notice with its action, and gates nothing', async () => {
    const el = mount()
    const actions: string[] = []
    const notice: ChatComposerNotice = {
      id: 'reserved',
      tone: 'blocked',
      title: 'Reserved slot',
      body: 'Filled by the billing design.',
      action: { id: 'open-billing', label: 'Open billing' },
    }
    el.composerNotice = notice
    el.onComposerNoticeAction = id => actions.push(id)
    await settle(el)

    const node = el.querySelector<HTMLElement>('.composer-notice')
    expect(node).not.toBeNull()
    expect(node!.classList.contains('blocked')).toBe(true)
    expect(node!.getAttribute('role')).toBe('alert')
    expect(squash(node!.textContent)).toContain('Reserved slot')
    expect(squash(node!.textContent)).toContain('Filled by the billing design.')

    node!.querySelector<HTMLButtonElement>('.banner-action')!.click()
    expect(actions).toEqual(['open-billing'])

    // The notice is a slot, not a gate: only the host's sendDisabled gates sending.
    expect(el.querySelector<HojaEditor>('hoja-editor[posture="composer"]')!.disabled).toBe(false)
  })

  it('renders no notice unless the host projects one', async () => {
    const el = mount()
    await settle(el)
    expect(el.querySelector('.composer-notice')).toBeNull()
    expect(el.querySelector('[data-account-note]')).toBeNull()
  })
})

describe('the line under a reply on a narrow screen', () => {
  // Defect seen in WebKit at 390 px (voices-browser-harness): "11:10 PM" broke into "11:10" over "PM",
  // and "voice: gemini-2.5-flash" into two lines, because the pieces were flex items that could wrap inside.
  it('wraps between its pieces, never inside one: the time, the voice and the cost each stay whole', () => {
    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    expect(css).toMatch(/sh-chat-panel \.message-meta\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(css).toMatch(
      /sh-chat-panel \.message-meta > :is\(\.message-time, \.message-voice, \.message-annotation\)\s*\{[^}]*white-space:\s*nowrap/,
    )
  })
})
