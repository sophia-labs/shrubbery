/**
 * What the panel shows of the billing design, inside the real <sh-chat-panel> (NO MOCKS:
 * a live Lit element in a real happy-dom document, driven by real DOM events).
 *
 * The kernel computes no money. The host hands it words, a multiple and a flag; the
 * panel renders them and reports what the person chose. Each test names the defect it
 * guards: a premium voice switched on by a stray click, a button that does nothing, a
 * balance line that prints an empty label.
 */
import type { HojaEditor } from '@shrubbery/hoja'
import { afterEach, describe, expect, it } from 'vitest'

import { ShChatPanel } from '../chat-panel.js'
import type { ChatComposerNotice, ChatMessage, ChatModelOption } from '../types.js'
import { HOUSE_VOICE, voiceRoster } from './fixtures/voice-roster.js'

void ShChatPanel

const PREMIUM_NOTE = 'A short reply costs about $0.15, roughly 8.2× House.'

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
}

async function showMoonshot(el: ShChatPanel): Promise<void> {
  el.querySelector<HTMLButtonElement>('[data-model-provider="Moonshot"]')!.click()
  await settle(el)
}

const option = (el: ShChatPanel, id: string): HTMLButtonElement =>
  el.querySelector<HTMLButtonElement>(`.model-picker [data-model-id="${id}"]`)!

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

/** The live roster as the host annotates it: a multiple on priced voices, a flag on the priciest. */
function billedRoster(): ChatModelOption[] {
  return voiceRoster().map(model => {
    if (model.id === 'moonshotai/kimi-k2.5') return { ...model, multipleOfHouse: 1.4 }
    if (model.id === 'moonshotai/kimi-k2.6') return { ...model, multipleOfHouse: 1.8 }
    if (model.id === 'moonshotai/kimi-k3') {
      return { ...model, multipleOfHouse: 8.2, premium: true, premiumNote: PREMIUM_NOTE }
    }
    return model
  })
}

function keydown(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the multiple of House on a voice row', () => {
  it('shows it beside the price on every voice that has one, and never on the House default', async () => {
    const el = mount()
    el.models = billedRoster().map(model => (model.house ? { ...model, multipleOfHouse: 1 } : model))
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)

    // Even a multiple the host filled in for House is not shown: House is the measure.
    expect(el.querySelector('.model-picker-pinned .voice-multiple')).toBeNull()

    await showMoonshot(el)
    const k26 = squash(option(el, 'moonshotai/kimi-k2.6').querySelector('.voice-multiple')?.textContent)
    const k25 = squash(option(el, 'moonshotai/kimi-k2.5').querySelector('.voice-multiple')?.textContent)
    expect(k26).toBe('1.8× House')
    expect(k25).toBe('1.4× House')
    // It sits with the price, in and out, which stays.
    expect(squash(option(el, 'moonshotai/kimi-k2.6').textContent)).toContain('$0.65 in · $3.41 out')
  })

  it('shows no multiple for a voice the host could not compare (an unpriced or legacy entry)', async () => {
    const el = mount()
    el.models = billedRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    el.querySelector<HTMLButtonElement>('[data-model-provider="Anthropic"]')!.click()
    await settle(el)
    expect(el.querySelectorAll('.model-picker-models .voice-multiple')).toHaveLength(0)
  })

  it('marks a premium voice as one', async () => {
    const el = mount()
    el.models = billedRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    await showMoonshot(el)
    expect(squash(option(el, 'moonshotai/kimi-k3').querySelector('.voice-badge.premium')?.textContent)).toBe('premium')
    expect(option(el, 'moonshotai/kimi-k2.6').querySelector('.voice-badge.premium')).toBeNull()
  })
})

describe('choosing a premium voice', () => {
  async function pickerWithK3(): Promise<{ el: ShChatPanel; chosen: string[] }> {
    const el = mount()
    const chosen: string[] = []
    el.models = billedRoster()
    el.currentModel = HOUSE_VOICE.id
    el.onModelChange = id => chosen.push(id)
    await settle(el)
    await open(el)
    await showMoonshot(el)
    return { el, chosen }
  }

  it('asks once, in words, and changes nothing until it is answered', async () => {
    const { el, chosen } = await pickerWithK3()
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)

    expect(chosen).toEqual([])
    const confirm = el.querySelector<HTMLElement>('[data-voice-confirm]')
    expect(confirm).not.toBeNull()
    const copy = squash(confirm!.textContent)
    expect(copy).toContain('Kimi K3')
    expect(copy).toContain(PREMIUM_NOTE)
    // The picker is still open and still the way out.
    expect(el.querySelector('.model-picker')).not.toBeNull()
  })

  it('chooses the voice, and closes the picker, when the person accepts', async () => {
    const { el, chosen } = await pickerWithK3()
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)
    el.querySelector<HTMLButtonElement>('[data-voice-confirm-accept]')!.click()
    await settle(el)

    expect(chosen).toEqual(['moonshotai/kimi-k3'])
    expect(el.querySelector('.model-picker')).toBeNull()
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()
  })

  it('leaves everything as it was when the person declines', async () => {
    const { el, chosen } = await pickerWithK3()
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)
    el.querySelector<HTMLButtonElement>('[data-voice-confirm-cancel]')!.click()
    await settle(el)

    expect(chosen).toEqual([])
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()
    expect(el.querySelector('.model-picker')).not.toBeNull()
  })

  it('takes a first Escape as "no" to the question and a second as "close", from the keyboard', async () => {
    const { el, chosen } = await pickerWithK3()
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)
    const accept = el.querySelector<HTMLButtonElement>('[data-voice-confirm-accept]')!

    keydown(accept, 'Escape')
    await settle(el)
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()
    expect(el.querySelector('.model-picker')).not.toBeNull()

    keydown(el.querySelector('.model-picker-model')!, 'Escape')
    await settle(el)
    expect(el.querySelector('.model-picker')).toBeNull()
    expect(chosen).toEqual([])
  })

  it('moves focus to the answer, so Enter is the whole gesture for a keyboard user', async () => {
    const { el } = await pickerWithK3()
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)
    await el.updateComplete
    expect(document.activeElement).toBe(el.querySelector('[data-voice-confirm-accept]'))
  })

  it('forgets a question left unanswered when the picker is closed and opened again', async () => {
    const { el, chosen } = await pickerWithK3()
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)
    el.querySelector<HTMLButtonElement>('.model-picker-close')!.click()
    await settle(el)
    await open(el)
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()
    expect(chosen).toEqual([])
  })

  it('does not ask for an ordinary voice, and does not ask again for the premium voice already in use', async () => {
    const { el, chosen } = await pickerWithK3()
    option(el, 'moonshotai/kimi-k2.6').click()
    await settle(el)
    expect(chosen).toEqual(['moonshotai/kimi-k2.6'])
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()

    // A conversation that already speaks in the premium voice (a continued one).
    const inUse = mount()
    const again: string[] = []
    inUse.models = billedRoster()
    inUse.currentModel = 'moonshotai/kimi-k3'
    inUse.onModelChange = id => again.push(id)
    await settle(inUse)
    trigger(inUse).click()
    await settle(inUse)
    inUse.querySelector<HTMLButtonElement>('[data-model-provider="Moonshot"]')!.click()
    await settle(inUse)
    inUse.querySelector<HTMLButtonElement>('.model-picker [data-model-id="moonshotai/kimi-k3"]')!.click()
    await settle(inUse)
    expect(inUse.querySelector('[data-voice-confirm]')).toBeNull()
  })

  it('cannot be switched on from a voice the host says is unavailable', async () => {
    const el = mount()
    const chosen: string[] = []
    el.models = billedRoster().map(model =>
      model.id === 'moonshotai/kimi-k3' ? { ...model, disabled: true, disabledReason: 'This voice cannot be priced right now.' } : model)
    el.currentModel = HOUSE_VOICE.id
    el.onModelChange = id => chosen.push(id)
    await settle(el)
    await open(el)
    await showMoonshot(el)
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)
    expect(chosen).toEqual([])
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()
  })
})

describe('the premium question, for the people who cannot see it and for a list that changes under it', () => {
  async function asked(): Promise<{ el: ShChatPanel; chosen: string[] }> {
    const el = mount()
    const chosen: string[] = []
    el.models = billedRoster()
    el.currentModel = HOUSE_VOICE.id
    el.onModelChange = id => chosen.push(id)
    await settle(el)
    await open(el)
    await showMoonshot(el)
    option(el, 'moonshotai/kimi-k3').click()
    await settle(el)
    return { el, chosen }
  }

  it('names the price to assistive technology: both answers are described by the note that carries it', async () => {
    // Defect guarded: focus lands on the answer, and Enter twice accepts a price nobody read out.
    const { el } = await asked()
    const note = el.querySelector<HTMLElement>('[data-voice-confirm-note]')
    expect(note).not.toBeNull()
    expect(note!.id).not.toBe('')
    expect(squash(note!.textContent)).toBe(PREMIUM_NOTE)
    for (const answer of ['[data-voice-confirm-accept]', '[data-voice-confirm-cancel]']) {
      expect(el.querySelector(answer)!.getAttribute('aria-describedby')).toBe(note!.id)
    }
  })

  it('lets go of a question whose voice has gone from the list: nothing dead is left on screen, and Escape closes the picker', async () => {
    const { el, chosen } = await asked()
    el.models = billedRoster().filter(model => model.id !== 'moonshotai/kimi-k3')
    await settle(el)
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()

    keydown(el.querySelector('.model-picker-model')!, 'Escape')
    await settle(el)
    expect(el.querySelector('.model-picker')).toBeNull()
    expect(chosen).toEqual([])
  })

  it('lets go of a question whose voice the host has since marked unavailable, rather than showing an answer that does nothing', async () => {
    const { el, chosen } = await asked()
    el.models = billedRoster().map(model =>
      model.id === 'moonshotai/kimi-k3' ? { ...model, disabled: true, disabledReason: 'Cannot be priced right now.' } : model)
    await settle(el)
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()
    expect(chosen).toEqual([])
  })

  it('gives focus back to the row that raised the question when it is declined, not to whichever row comes first', async () => {
    const { el } = await asked()
    el.querySelector<HTMLButtonElement>('[data-voice-confirm-cancel]')!.click()
    await settle(el)
    await el.updateComplete
    expect(document.activeElement).toBe(option(el, 'moonshotai/kimi-k3'))
  })

  it('takes a first Escape from anywhere on the page as "no" to the question, and a second as "close"', async () => {
    const { el, chosen } = await asked()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle(el)
    expect(el.querySelector('[data-voice-confirm]')).toBeNull()
    expect(el.querySelector('.model-picker')).not.toBeNull()

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle(el)
    expect(el.querySelector('.model-picker')).toBeNull()
    expect(chosen).toEqual([])
  })
})

describe('the new controls on a phone', () => {
  it('are touch-sized: the balance line’s button and the premium question’s answers sit in the compact block', () => {
    const css = (ShChatPanel.styles as unknown as { cssText: string }).cssText
    const phone = css.slice(css.lastIndexOf('@media (max-width: 600px)'))
    expect(phone).toMatch(/\.account-note-action\s*\{[^}]*min-height:\s*var\(--sh-chat-compact-target\)/)
    expect(phone).toMatch(/\.model-picker-confirm-actions button\s*\{[^}]*min-height:\s*var\(--sh-chat-compact-target\)/)
  })
})

describe('the picker foot says what the prices are', () => {
  it('words the price basis the way the host words it, instead of the bare caption', async () => {
    const el = mount()
    el.models = billedRoster()
    el.currentModel = HOUSE_VOICE.id
    el.voiceFootnote = 'US dollars per million tokens, before a 20% service fee.'
    await settle(el)
    await open(el)
    expect(squash(el.querySelector('.model-picker-foot-caption')?.textContent))
      .toBe('US dollars per million tokens, before a 20% service fee.')
  })

  it('keeps the bare caption when the host says nothing more', async () => {
    const el = mount()
    el.models = billedRoster()
    el.currentModel = HOUSE_VOICE.id
    await settle(el)
    await open(el)
    expect(squash(el.querySelector('.model-picker-foot-caption')?.textContent)).toBe('US dollars per million tokens')
  })
})

describe('the balance line and its button', () => {
  it('shows the action the host attached, and reports it, without knowing what it does', async () => {
    const el = mount()
    const heard: string[] = []
    el.accountNote = {
      label: 'Out of credits',
      value: '',
      tone: 'out',
      action: { id: 'add-credits', label: 'Add credits' },
    }
    el.onAccountAction = id => heard.push(id)
    await settle(el)

    const chip = el.querySelector<HTMLElement>('[data-account-note]')!
    expect(chip.classList.contains('out')).toBe(true)
    const button = chip.querySelector<HTMLButtonElement>('[data-account-action="add-credits"]')
    expect(button).not.toBeNull()
    expect(squash(button!.textContent)).toBe('Add credits')
    button!.click()
    expect(heard).toEqual(['add-credits'])
  })

  it('offers no button that nothing listens to', async () => {
    const el = mount()
    el.accountNote = {
      label: 'Out of credits',
      value: '',
      tone: 'out',
      action: { id: 'add-credits', label: 'Add credits' },
    }
    await settle(el)
    expect(el.querySelector('[data-account-action]')).toBeNull()
    expect(squash(el.querySelector('[data-account-note]')?.textContent)).toBe('Out of credits')
  })

  it('prints no empty label and no empty value (a line that is one sentence)', async () => {
    const el = mount()
    el.accountNote = { label: '', value: '$1.00 starter credit' }
    await settle(el)
    const chip = el.querySelector<HTMLElement>('[data-account-note]')!
    expect(chip.querySelector('.account-note-label')).toBeNull()
    expect(squash(chip.textContent)).toBe('$1.00 starter credit')

    el.accountNote = { label: 'Out of credits', value: '', tone: 'out' }
    await settle(el)
    expect(el.querySelector('[data-account-note] .account-note-value')).toBeNull()
  })

  it('keeps the two-part line as it always was', async () => {
    const el = mount()
    el.accountNote = { label: 'Credit', value: '$0.97', tone: 'ok' }
    await settle(el)
    expect(squash(el.querySelector('[data-account-note]')?.textContent)).toBe('Credit $0.97')
  })
})

describe('the notice above the composer', () => {
  it('carries a quiet detail line (the balance) and an action, and gates nothing', async () => {
    const el = mount()
    const heard: string[] = []
    const notice: ChatComposerNotice = {
      id: 'billing-refusal',
      tone: 'blocked',
      title: 'You’re out of credits.',
      body: 'Your message is saved. Add credits to continue.',
      detail: 'Balance $0.03',
      action: { id: 'add-credits', label: 'Add credits' },
    }
    el.composerNotice = notice
    el.onComposerNoticeAction = id => heard.push(id)
    await settle(el)

    const node = el.querySelector<HTMLElement>('.composer-notice')!
    expect(squash(node.textContent)).toContain('You’re out of credits. Your message is saved. Add credits to continue.')
    expect(squash(node.querySelector('.composer-notice-detail')?.textContent)).toBe('Balance $0.03')
    node.querySelector<HTMLButtonElement>('.banner-action')!.click()
    expect(heard).toEqual(['add-credits'])
    expect(el.querySelector<HojaEditor>('hoja-editor[posture="composer"]')!.disabled).toBe(false)
  })

  it('renders no detail line when there is none', async () => {
    const el = mount()
    el.composerNotice = { id: 'x', tone: 'warning', title: 'Only a title.' }
    await settle(el)
    expect(el.querySelector('.composer-notice-detail')).toBeNull()
  })
})

describe('a notice the person can put away', () => {
  const credits: ChatComposerNotice = {
    id: 'credits-notice',
    tone: 'info',
    title: 'Credits start on October 12, 2026.',
    body: 'From then each message uses credits from your balance.',
    action: { id: 'credits-notice-details', label: 'Details' },
    dismiss: { id: 'dismiss-credits-notice', label: 'Dismiss' },
  }

  it('offers one control to dismiss it, beside the action, and reports each by its own id', async () => {
    const el = mount()
    const heard: string[] = []
    el.composerNotice = credits
    el.onComposerNoticeAction = id => heard.push(id)
    await settle(el)

    const node = el.querySelector<HTMLElement>('.composer-notice')!
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons.map(button => squash(button.textContent))).toEqual(['Details', 'Dismiss'])
    buttons[1].click()
    buttons[0].click()
    expect(heard).toEqual(['dismiss-credits-notice', 'credits-notice-details'])
    // It says what it says in the same slot, and gates nothing.
    expect(el.querySelector<HojaEditor>('hoja-editor[posture="composer"]')!.disabled).toBe(false)
  })

  it('is a status, not an alert: a heads-up must not interrupt a screen reader', async () => {
    const el = mount()
    el.composerNotice = credits
    el.onComposerNoticeAction = () => undefined
    await settle(el)
    expect(el.querySelector('.composer-notice')!.getAttribute('role')).toBe('status')
  })

  it('names its dismiss control for assistive technology by the notice it puts away', async () => {
    const el = mount()
    el.composerNotice = credits
    el.onComposerNoticeAction = () => undefined
    await settle(el)
    const dismiss = el.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss: Credits start on October 12, 2026.')
  })

  it('draws no dismiss control for a notice that cannot be put away (a refusal stays until it is answered)', async () => {
    const el = mount()
    el.composerNotice = { id: 'billing-refusal', tone: 'blocked', title: 'You’re out of credits.', action: { id: 'add-credits', label: 'Add credits' } }
    el.onComposerNoticeAction = () => undefined
    await settle(el)
    expect(el.querySelector('[data-notice-dismiss]')).toBeNull()
    expect(Array.from(el.querySelectorAll('.composer-notice button')).map(button => squash(button.textContent))).toEqual(['Add credits'])
  })

  it('draws no dismiss control where nothing listens: a button that goes nowhere is dead UI', async () => {
    const el = mount()
    el.composerNotice = credits
    await settle(el)
    expect(el.querySelector('[data-notice-dismiss]')).toBeNull()
    expect(el.querySelector('.composer-notice')!.textContent).toContain('Credits start on October 12, 2026.')
  })
})

describe('the line beside a reply (the cost chip)', () => {
  it('shows what the host’s formatter says about the message, and only for a message it says something about', async () => {
    const el = mount()
    const costed: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'hello',
      parts: [{ type: 'text', content: 'hello' }],
      isStreaming: false,
      toolCalls: [],
      createdAt: 1,
      costMicroUsd: 848,
    }
    const free: ChatMessage = { ...costed, id: 'a2', costMicroUsd: undefined }
    el.messages = [costed, free]
    el.formatModelAnnotation = message => (message.costMicroUsd ? `$${(message.costMicroUsd / 1_000_000).toFixed(4)}` : null)
    await settle(el)

    const chips = Array.from(el.querySelectorAll<HTMLElement>('.message-annotation'))
    expect(chips.map(chip => squash(chip.textContent))).toEqual(['$0.0008'])
  })
})
