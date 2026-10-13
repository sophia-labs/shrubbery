/**
 * continue-chooser.ts — <sh-continue-chooser>: where the voice of a continued
 * conversation is chosen, at the seam, before the conversation opens.
 *
 * A model cannot inherit another assistant's memory, and nobody pretends it can. What
 * the person is shown here is what "continue" honestly means: how much of the old
 * conversation will be carried (and how much will not), which voice will pick it up,
 * and where the text will go. "Same voice as before" is offered only where today's
 * catalogue really carries that model ("Closest available" where it carries a
 * neighbour, said as such), and is never chosen for the person: the House default
 * stands unless they choose otherwise.
 *
 * The chooser decides nothing and sends nothing. It raises `sh-continue-confirm`
 * with the voice picked, or `sh-continue-cancel`; the host does the rest. Its states
 * are the host's: reading the old conversation, choosing, starting, or refused (with
 * the words for why).
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  type ChatModelOption,
  groupVoices,
  modelIdTail,
  voiceDisplayName,
  voicePriceSummary,
  voiceProviderLabel,
} from '@shrubbery/chat-kernel'
import { type ContinuationPlan, matchSourceVoice, providerNoticeFor } from '../chat-services/continuation.js'

export type ContinuePhase = 'reading' | 'choosing' | 'starting' | 'refused'

export interface ContinueConfirmDetail {
  /** The catalogue id of the voice chosen; '' when the host offers no choice of voice. */
  readonly modelId: string
}

type ChoiceKey = 'same' | 'closest' | 'house' | 'other'

interface Choice {
  readonly key: Exclude<ChoiceKey, 'other'>
  readonly model: ChatModelOption
  readonly label: string
  readonly detail: string
}

const CONFIRM_EVENT = 'sh-continue-confirm'
const CANCEL_EVENT = 'sh-continue-cancel'

function detailLine(model: ChatModelOption, extra?: string): string {
  const price = voicePriceSummary(model)
  return [voiceDisplayName(model), voiceProviderLabel(model), price?.text, extra]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
}

@customElement('sh-continue-chooser')
export class ShContinueChooser extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      inset: 0;
      z-index: 70;
      display: block;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-color-text-primary, #18211b);
    }
    .backdrop {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      box-sizing: border-box;
      background: var(--mn-color-backdrop, rgb(18 32 23 / 0.24));
    }
    .sheet {
      width: min(30rem, 100%);
      max-height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 1.1rem 1.25rem 1rem;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 14px;
      background: var(--mn-color-surface-panel, var(--mn-color-surface-base, #fff));
      box-shadow: var(--mn-shadow-modal, 0 18px 48px rgb(15 30 20 / 0.22));
    }
    .sheet:focus { outline: none; }
    h2 {
      margin: 0 0 0.5rem;
      font: 650 1.15rem/1.25 var(--mn-font-display, Georgia, serif);
      letter-spacing: -0.02em;
    }
    p { margin: 0.5rem 0; font-size: 0.875rem; line-height: 1.45; }
    .window { color: var(--mn-color-text-secondary, #4b5563); }
    .status { color: var(--mn-color-text-secondary, #4b5563); }
    .error { color: var(--mn-color-danger-text, #b42318); }
    .choices { display: contents; }
    fieldset { margin: 0.75rem 0 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0; font-size: 0.75rem; font-weight: 650; color: var(--mn-color-text-secondary, #4b5563); }
    label.option {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.15rem 0.6rem;
      align-items: start;
      margin-top: 0.4rem;
      padding: 0.55rem 0.65rem;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 10px;
      background: var(--mn-color-surface-raised, #fff);
      cursor: pointer;
      font-size: 0.875rem;
    }
    label.option:has(input:checked) {
      border-color: var(--mn-color-text-accent-strong, #2d6a4f);
      background: var(--mn-color-surface-accent, #e9f5ef);
    }
    label.option input[type='radio'] { margin: 0.2rem 0 0; }
    .option-name { font-weight: 650; }
    .option-detail {
      grid-column: 2;
      color: var(--mn-color-text-muted, #66736a);
      font-size: 0.75rem;
    }
    select {
      grid-column: 2;
      min-height: 36px;
      max-width: 100%;
      border: 1px solid var(--mn-color-border-default, #d0d7de);
      border-radius: 8px;
      background: var(--mn-color-surface-sunken, #fff);
      color: inherit;
      font: inherit;
      font-size: 0.8125rem;
    }
    .notice {
      margin-top: 0.75rem;
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      background: var(--mn-color-surface-sunken, #f3f6f4);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.8125rem;
    }
    .actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
    button {
      min-height: 36px;
      padding: 0.45rem 0.9rem;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 10px;
      background: var(--mn-color-surface-raised, #fff);
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 0.8125rem;
    }
    button:hover { background: var(--mn-color-surface-hover, #eef2f7); }
    button:disabled { cursor: default; opacity: 0.6; }
    button.primary {
      border-color: var(--mn-color-text-accent-strong, #2d6a4f);
      background: var(--mn-color-text-accent-strong, #2d6a4f);
      color: var(--mn-color-surface-raised, #fff);
      font-weight: 650;
    }
    button:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #376d57);
      outline-offset: 2px;
    }
    @media (max-width: 600px) {
      .backdrop { align-items: flex-end; padding: 0; }
      .sheet { width: 100%; border-radius: 14px 14px 0 0; }
      button { min-height: 44px; }
    }
  `

  @property({ type: String }) phase: ContinuePhase = 'reading'
  /** The old conversation's title. */
  @property({ type: String, attribute: 'conversation-title' }) conversationTitle = ''
  @property({ attribute: false }) plan: ContinuationPlan | null = null
  /** The voices on offer (the service's roster); empty when the host offers no choice, or its catalogue is stale or would not load. */
  @property({ attribute: false }) roster: readonly ChatModelOption[] = []
  /** For `refused`: the words for why, said as the host said them. */
  @property({ type: String }) message = ''

  @state() private choice: ChoiceKey | null = null
  @state() private otherId = ''

  /** The named voices, in the order they are offered: the source's own (or nearest), then the House default. */
  private choices(): Choice[] {
    const roster = this.roster.filter(model => !model.disabled)
    const source = this.plan?.sourceVoices.at(-1) ?? null
    const match = matchSourceVoice(source, roster)
    const house = roster.find(model => model.house)
    const named: Choice[] = []
    if (match.kind === 'exact') {
      named.push({
        key: 'same',
        model: match.model,
        label: 'Same voice as before (source-recorded)',
        detail: detailLine(match.model, match.model.house ? 'also the House default' : undefined),
      })
    } else if (match.kind === 'closest') {
      named.push({
        key: 'closest',
        model: match.model,
        label: `Closest available: ${voiceDisplayName(match.model)}`,
        detail: detailLine(match.model, `the source recorded ${modelIdTail(match.source.id)}`),
      })
    }
    if (house && !(match.kind === 'exact' && match.model.id === house.id)) {
      named.push({
        key: 'house',
        model: house,
        label: `House default: ${voiceDisplayName(house)}`,
        detail: detailLine(house),
      })
    }
    return named
  }

  private others(): ChatModelOption[] {
    return this.roster.filter(model => !model.disabled)
  }

  /** The person's choice; until they make one, the House default (never the same voice). */
  private selected(): ChoiceKey | null {
    if (this.choice) return this.choice
    const named = this.choices()
    return named.find(choice => choice.key === 'house')?.key
      ?? (this.others().length > 0 ? 'other' : null)
  }

  private otherModelId(): string {
    const others = this.others()
    return others.some(model => model.id === this.otherId) ? this.otherId : others[0]?.id ?? ''
  }

  private chosenModel(): ChatModelOption | null {
    const key = this.selected()
    if (key === null) return null
    if (key === 'other') return this.others().find(model => model.id === this.otherModelId()) ?? null
    return this.choices().find(choice => choice.key === key)?.model ?? null
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent(CANCEL_EVENT, { bubbles: true, composed: true }))
  }

  private confirm(): void {
    const detail: ContinueConfirmDetail = { modelId: this.chosenModel()?.id ?? '' }
    this.dispatchEvent(new CustomEvent<ContinueConfirmDetail>(CONFIRM_EVENT, { detail, bubbles: true, composed: true }))
  }

  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.cancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      this.renderRoot.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'),
    )
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (active === first || active === null)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  override firstUpdated(): void {
    this.renderRoot.querySelector<HTMLElement>('[data-continue-chooser]')?.focus()
  }

  override updated(changed: Map<string, unknown>): void {
    // When the choices arrive, put the focus on the one that is selected.
    if (changed.has('phase') && this.phase === 'choosing') {
      const checked = this.renderRoot.querySelector<HTMLInputElement>('input[type="radio"]:checked')
      ;(checked ?? this.renderRoot.querySelector<HTMLElement>('[data-continue-chooser]'))?.focus()
    }
  }

  private windowLine(): string {
    const window = this.plan?.window
    if (!window) return ''
    const carried = window.messages.length
    if (window.omitted === 0) return `All ${window.total.toLocaleString('en-US')} messages will be carried over.`
    const said = window.omitted === 1 ? '1 earlier message is' : `${window.omitted.toLocaleString('en-US')} earlier messages are`
    return `${carried.toLocaleString('en-US')} of ${window.total.toLocaleString('en-US')} messages will be carried over: the first, and the most recent. ${said} not included.`
  }

  private renderOption(choice: Choice, selected: ChoiceKey | null, busy: boolean): TemplateResult {
    return html`
      <label class="option" data-voice-option=${choice.key}>
        <input
          type="radio"
          name="voice"
          value=${choice.key}
          .checked=${selected === choice.key}
          ?disabled=${busy}
          @change=${() => { this.choice = choice.key }}
          @click=${() => { this.choice = choice.key }}
        />
        <span class="option-name">${choice.label}</span>
        <span class="option-detail">${choice.detail}</span>
      </label>
    `
  }

  private renderVoices(busy: boolean): TemplateResult | typeof nothing {
    const others = this.others()
    if (others.length === 0) return nothing
    const selected = this.selected()
    const named = this.choices()
    const groups = groupVoices(others)
    return html`
      <fieldset data-continue-voices ?disabled=${busy}>
        <legend>Who picks this up?</legend>
        ${named.map(choice => this.renderOption(choice, selected, busy))}
        <label class="option" data-voice-option="other">
          <input
            type="radio"
            name="voice"
            value="other"
            .checked=${selected === 'other'}
            ?disabled=${busy}
            @change=${() => { this.choice = 'other' }}
            @click=${() => { this.choice = 'other' }}
          />
          <span class="option-name">Another voice…</span>
          <select
            aria-label="Another voice"
            ?disabled=${busy}
            .value=${this.otherModelId()}
            @change=${(event: Event) => {
              this.otherId = (event.target as HTMLSelectElement).value
              this.choice = 'other'
            }}
          >
            ${groups.map(group => html`
              <optgroup label=${group.provider}>
                ${group.models.map(model => html`
                  <option value=${model.id} ?selected=${model.id === this.otherModelId()}>${voiceDisplayName(model)}</option>
                `)}
              </optgroup>
            `)}
          </select>
        </label>
      </fieldset>
    `
  }

  private renderBody(): TemplateResult {
    if (this.phase === 'reading') {
      return html`
        <p class="status" role="status">Reading the conversation…</p>
        <div class="actions"><button type="button" data-continue-cancel @click=${() => this.cancel()}>Cancel</button></div>
      `
    }
    if (this.phase === 'refused') {
      return html`
        <p class="error" role="alert" data-continue-error>${this.message}</p>
        <div class="actions"><button type="button" data-continue-cancel @click=${() => this.cancel()}>Close</button></div>
      `
    }
    const busy = this.phase === 'starting'
    const model = this.chosenModel()
    const noticeText = providerNoticeFor(model)
    // The voices sit in an element of their own: two child bindings side by side between elements
    // are parsed by happy-dom into the wrong places (the notice ends up around the fieldset), and a
    // wrapper that is `display: contents` costs the browser nothing.
    return html`
      <p class="window" data-continue-window>${this.windowLine()}</p>
      <div class="choices">
        ${this.renderVoices(busy)}
        ${this.others().length === 0
          ? html`<p class="window" data-continue-default>This workspace’s own voice will pick it up.</p>`
          : nothing}
      </div>
      <p class="notice" role="note" data-continue-notice>${noticeText}</p>
      <div class="actions">
        <button type="button" data-continue-cancel ?disabled=${busy} @click=${() => this.cancel()}>Cancel</button>
        <button type="button" class="primary" data-continue-confirm ?disabled=${busy} @click=${() => this.confirm()}>
          ${busy ? 'Starting…' : 'Continue'}
        </button>
      </div>
    `
  }

  override render(): TemplateResult {
    return html`
      <div class="backdrop" data-continue-backdrop @click=${() => this.cancel()}>
        <section
          class="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="continue-title"
          data-continue-chooser
          tabindex="-1"
          @keydown=${(event: KeyboardEvent) => this.keydown(event)}
          @click=${(event: Event) => event.stopPropagation()}
        >
          <h2 id="continue-title">Continue “${this.conversationTitle || 'this conversation'}”</h2>
          ${this.renderBody()}
        </section>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-continue-chooser': ShContinueChooser
  }
}
