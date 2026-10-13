import '@shrubbery/hoja'
import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { HojaComposerDetail } from '@shrubbery/hoja'

export interface GrapevineTarget { id: string; channel: string; topic: string; label: string; agentRef?: string }
export interface GrapevineMessage {
  id: number; sender_id?: number; sender_full_name?: string; timestamp?: number; content?: string
}
export interface GrapevineSnapshot {
  graphId: string; status: 'unavailable' | 'loading' | 'ready' | 'error'
  error: string; identity: string; linked: boolean; targets: readonly GrapevineTarget[]
  targetId: string; messages: readonly GrapevineMessage[]; draft: string
  busy: boolean; mutating: boolean; delivery: string; uncertain: boolean
}
export const emptyGrapevineSnapshot = (): GrapevineSnapshot => ({
  graphId: '', status: 'unavailable', error: 'Open a hosted workspace to connect Grapevine.',
  identity: '', linked: false, targets: [], targetId: '', messages: [], draft: '',
  busy: false, mutating: false, delivery: '', uncertain: false,
})

/** Controlled, graph-scoped view. Reading it never sends or acknowledges mail. */
@customElement('mn-grapevine-pane')
export class MnGrapevinePane extends LitElement {
  @property({ attribute: false }) snapshot = emptyGrapevineSnapshot()
  @property({ attribute: false }) onRefresh?: () => void
  @property({ attribute: false }) onTarget?: (id: string) => void
  @property({ attribute: false }) onDraft?: (value: string) => void
  @property({ attribute: false }) onSend?: () => void
  @property({ attribute: false }) onLink?: () => void
  @property({ attribute: false }) onAgentRequest?: (agentRef: string) => void

  protected render() {
    const state = this.snapshot
    const target = state.targets.find(item => item.id === state.targetId)
    return html`
      <header><div><h1>Grapevine</h1><p>Conversation · ${state.graphId || 'no workspace'}</p></div>
        <button aria-label="Refresh conversation" ?disabled=${state.busy || state.status === 'unavailable'} @click=${() => this.onRefresh?.()}>Refresh</button></header>
      <section class="context" aria-label="Conversation context">
        ${state.identity ? html`<p>Signed in as ${state.identity}</p>` : nothing}
        ${state.targets.length ? html`<label>Channel / topic
          <select aria-label="Conversation target" .value=${state.targetId} ?disabled=${state.mutating || state.uncertain} @change=${(event: Event) => this.onTarget?.((event.target as HTMLSelectElement).value)}>
            ${state.targets.map(item => html`<option value=${item.id}>${item.label} · #${item.channel} / ${item.topic}</option>`)}
          </select></label>` : nothing}
        ${target?.agentRef ? html`<p class="qualification">Configured Agent association: ${target.agentRef} · not a presence report</p>` : nothing}
        <p class="qualification">Zulip conversation. Viewing does not acknowledge Demi mail or launch an agent. Garden retention is not confirmed by this pane.</p>
      </section>
      <section class="thread" aria-label=${target ? `Messages in ${target.channel} / ${target.topic}` : 'Conversation messages'} tabindex="0" aria-busy=${state.busy}>
        ${state.status === 'loading' ? html`<p role="status">Opening the conversation…</p>` : nothing}
        ${state.error ? html`<p role="alert">${state.error}</p>` : nothing}
        ${state.status === 'ready' && !state.linked ? html`<div><h2>Link your Zulip voice</h2><p>Your verified Sophia email must match a Zulip account. Linking is an explicit account action.</p><button ?disabled=${state.busy} @click=${() => this.onLink?.()}>Link account</button></div>` : nothing}
        ${state.status === 'ready' && state.linked && !state.targets.length ? html`<p>No conversation targets are configured for this workspace.</p>` : nothing}
        ${state.status === 'ready' && state.linked && target && !state.busy && !state.messages.length ? html`<p>No messages returned for this channel and topic.</p>` : nothing}
        ${state.messages.map(message => html`<article data-message-id=${message.id}>
          <div class="byline"><strong>${message.sender_full_name || 'Zulip sender'}</strong><span>sender ${message.sender_id ?? 'unknown'} · message ${message.id}</span>
            ${message.timestamp ? html`<time datetime=${new Date(message.timestamp * 1000).toISOString()}>${new Date(message.timestamp * 1000).toLocaleString()}</time>` : nothing}</div>
          <pre>${message.content ?? ''}</pre>
        </article>`)}
      </section>
      <footer>
        ${state.delivery ? html`<p role="status">${state.delivery}</p>` : nothing}
        <div class="composer"><hoja-editor posture="composer" label="Message" placeholder="Write to this conversation…"
          .value=${state.draft} .valueKey=${`${state.graphId}:${state.targetId}:${state.identity}`}
          .disabled=${state.busy || state.uncertain || !state.linked || !target || state.status !== 'ready'}
          .onChange=${(detail: HojaComposerDetail) => this.onDraft?.(detail.value)}
          .onSubmit=${() => this.onSend?.()}></hoja-editor></div>
        <button class="send" ?disabled=${state.busy || state.uncertain || !state.linked || !target || !state.draft.trim() || state.status !== 'ready'} @click=${() => this.onSend?.()}>Send to Zulip</button>
      </footer>`
  }

  static styles = css`
    :host { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; height: 100%; min-height: 0; min-width: 0; overflow: hidden; container-type: inline-size; color: var(--mn-color-text-primary); background: var(--mn-color-surface-base); font-family: var(--mn-font-ui, system-ui); }
    * { box-sizing: border-box; } header, .context, footer { padding: var(--mn-space-3, .75rem) var(--mn-space-4, 1rem); min-width: 0; }
    header { display: flex; align-items: center; justify-content: space-between; gap: .75rem; border-bottom: 1px solid var(--mn-color-border-subtle); } h1 { font: 600 1.1rem var(--mn-font-ui, system-ui); margin: 0; } h2 { font-size: 1rem; }
    p { margin: .3rem 0; overflow-wrap: anywhere; } header p, .qualification, .byline span, time { color: var(--mn-color-text-muted); font-size: .8rem; }
    label { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; font-size: .85rem; } select { min-width: 0; max-width: 100%; }
    button, select { font: inherit; color: inherit; background: var(--mn-color-surface-raised); border: 1px solid var(--mn-color-border-subtle); border-radius: var(--mn-radius-md, .4rem); padding: .45rem .7rem; }
    button { cursor: pointer; } button:disabled { cursor: default; opacity: .55; } button:focus-visible, select:focus-visible, .thread:focus-visible { outline: 2px solid var(--mn-color-border-focus, #43895c); outline-offset: 2px; }
    .thread { min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: .5rem 1rem; } article { padding: .8rem 0; border-bottom: 1px solid var(--mn-color-border-subtle); }
    .byline { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.5; margin: .35rem 0 0; }
    footer { border-top: 1px solid var(--mn-color-border-subtle); padding-bottom: max(.75rem, env(safe-area-inset-bottom)); } .composer { max-height: min(30dvh, 14rem); overflow: auto; min-height: 0; } .send { margin-top: .4rem; }
    [role='alert'] { color: var(--mn-color-text-danger, #9a302a); } @container (max-width: 38rem) { header, .context, footer { padding-inline: .65rem; } .thread { padding-inline: .65rem; } .qualification { font-size: .75rem; } }
  `
}
