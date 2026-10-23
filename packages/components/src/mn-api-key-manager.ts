/**
 * Hosted account API-key management presentation.
 *
 * This component has no fetch, identity provider, graph routing, storage, or logging
 * dependency. It receives an account-root store and keeps only form state;
 * the store owns the ephemeral one-time secret lifecycle.
 */

import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { css, html, LitElement, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

export type MnApiKeyScope = 'graphs.read' | 'graphs.write' | 'mcp.read' | 'mcp.write'

export interface MnApiKeyGraphKey {
  readonly owner: string
  readonly graphId: string
}

export interface MnApiKeyMetadata {
  readonly keyId: string
  readonly displayLabel: string
  readonly createdAtUnixSeconds: number
  readonly expiresAtUnixSeconds: number
  readonly lastUsedAtUnixSeconds: number | null
  readonly lastUsedOutcome: 'authorized' | null
  readonly status: 'active' | 'revoked' | 'deleted'
  readonly scopes: readonly MnApiKeyScope[]
  readonly graphAccess?: 'selected' | 'all_accessible'
  readonly graphAllowlist: readonly MnApiKeyGraphKey[]
  readonly credentialVersion: number
  readonly terminalAtUnixSeconds: number | null
}

export interface MnApiKeyCreateRequest {
  readonly displayLabel: string
  readonly expiresAtUnixSeconds: number
  readonly scopes: readonly MnApiKeyScope[]
  readonly graphAccess?: 'selected' | 'all_accessible'
  readonly graphAllowlist: readonly MnApiKeyGraphKey[]
}

/** The opaque value deliberately does not expose an enumerable plaintext field. */
export interface MnOneTimeApiKeySecret {
  reveal(): string
  toJSON(): undefined
}

export interface MnApiKeyStoreSnapshot {
  readonly status?: string
  readonly apiKeys?: readonly MnApiKeyMetadata[]
  readonly code?: string | null
  readonly httpStatus?: number | null
  readonly operationId?: string | null
  readonly oneTimeSecret?: MnOneTimeApiKeySecret | null
  readonly secretKeyId?: string | null
  readonly secretCopied?: boolean
  readonly replayedCreate?: boolean
  readonly deleteResult?: { readonly deleted: boolean; readonly revocationEpoch: number } | null
}

export interface MnApiKeyStoreLike {
  snapshot(): MnApiKeyStoreSnapshot
  subscribe(callback: () => void): () => void
  load(): Promise<void>
  create(request: MnApiKeyCreateRequest): Promise<void>
  retryCreate(): Promise<void>
  remove(keyId: string): Promise<void>
  retryDelete(): Promise<void>
  markSecretCopied(): void
  acknowledgeSecret(): void
  discardOneTimeSecret(): void
}

interface GraphDraft { readonly owner: string; readonly graphId: string }

const SCOPES: readonly MnApiKeyScope[] = ['graphs.read', 'graphs.write', 'mcp.read', 'mcp.write']
const OWNER = /^(?:user|agent|service|organization):[A-Za-z0-9_.@:-]{1,192}$/
function isGraphId(value: string): boolean {
  return value.length >= 1
    && value.length <= 40
    && /^[a-z0-9-]+$/.test(value)
    && !value.startsWith('-')
    && !value.endsWith('-')
}

function defaultExpiry(): string {
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusOf(snapshot: MnApiKeyStoreSnapshot): string {
  return String(snapshot.status ?? (snapshot.apiKeys ? 'ready' : 'loading')).trim().toLowerCase()
}

function isBusy(status: string): boolean {
  return status === 'loading' || status === 'creating' || status === 'deleting'
}

function dateLabel(value: number | null): string {
  if (!value) return 'Never'
  const date = new Date(value * 1_000)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString(localeSource.get())
}

function errorText(code: string): string {
  switch (code) {
    case 'idempotency_key_reused': return t('This create request conflicts with an earlier request. Change the fields and try again.')
    case 'api_key_quota_exceeded': return t('You have reached the API-key limit for this account.')
    case 'api_keys_erased': return t('API keys are unavailable because this account has been erased.')
    case 'cognito_human_required': return t('A current human hosted session is required to manage API keys.')
    case 'api_key_authority_unavailable': return t('API-key management is temporarily unavailable. Try again later.')
    case 'one_time_secret_unavailable': return t('The key was created earlier, but its secret cannot be shown again. Revoke it and create a replacement if needed.')
    case 'authentication': return t('Sign in again to manage API keys.')
    case 'authorization': return t('This session cannot manage API keys.')
    case 'invalid_scope': return t('Choose at least one permitted scope.')
    case 'invalid_graph_allowlist': return t('Each allowlist row needs an exact owner and graph ID.')
    case 'duplicate_graph': return t('Each graph can appear only once in the allowlist.')
    default: return code ? 'The API-key request could not be completed.' : ''
  }
}

@customElement('mn-api-key-manager')
export class MnApiKeyManager extends SkinAware(LitElement) {
  protected readonly _locale = new LocaleController(this)

  static styles = css`
    :host { display:block; color:var(--mn-color-text-primary,#111827); font-family:var(--mn-font-chrome,system-ui,sans-serif); }
    .panel { display:grid; gap:18px; padding:20px; border:1px solid var(--mn-color-border-subtle,#e5e7eb); border-radius:10px; background:var(--mn-color-surface-raised,#fffefa); }
    h3 { margin:0; font-family:var(--mn-font-display,Georgia,serif); font-size:20px; color:var(--mn-color-text-title,var(--mn-color-text-primary,#25231f)); }
    h4 { margin:0; font-size:15px; } p { margin:0; } .intro,.hint,.meta,.status { color:var(--mn-color-text-secondary,#4b5563); font-size:13px; line-height:1.45; }
    .form,.fields,.graphs,.key-list { display:grid; gap:12px; } .field { display:grid; gap:5px; } .row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto; gap:8px; align-items:end; }
    label,legend { font-size:13px; font-weight:600; } input,button { font:inherit; } input[type=text],input[type=datetime-local],input[readonly] { box-sizing:border-box; width:100%; padding:9px 10px; border:1px solid var(--mn-color-border-default,#d1d5db); border-radius:6px; background:var(--mn-color-surface-sunken,#fff); color:inherit; }
    button { min-height:34px; padding:7px 11px; border:1px solid var(--mn-color-border-default,#cbd5e1); border-radius:6px; background:transparent; color:inherit; cursor:pointer; font-size:13px; font-weight:600; }
    button.primary { background:var(--mn-color-accent,#2563eb); border-color:var(--mn-color-accent,#2563eb); color:var(--mn-color-on-accent,#fff); } button.danger { border-color:var(--mn-color-danger,#b91c1c); color:var(--mn-color-danger,#b91c1c); } button:disabled,input:disabled { opacity:.55; cursor:not-allowed; }
    input:focus-visible,button:focus-visible { outline:2px solid var(--mn-color-border-focus,#2563eb); outline-offset:2px; }
    fieldset { display:grid; gap:8px; margin:0; padding:0; border:0; } .scope-options { display:flex; flex-wrap:wrap; gap:8px 16px; } .workspace-access-options { display:grid; gap:8px; } .workspace-access-options label,.scope-options label,.ack { display:flex; gap:7px; align-items:flex-start; font-weight:400; }
    .actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; } .status { padding:10px; border-radius:6px; background:var(--mn-color-surface-sunken,#f8fafc); } .status[data-tone=danger] { color:var(--mn-color-danger,#b91c1c); } .status[data-tone=warning] { color:var(--mn-color-warning,#a16207); }
    .key { display:grid; gap:8px; padding:13px; border:1px solid var(--mn-color-border-subtle,#e5e7eb); border-radius:7px; } .key-header { display:flex; justify-content:space-between; gap:12px; align-items:baseline; } .key-label { font-weight:700; } .tag { padding:2px 7px; border-radius:999px; background:var(--mn-color-surface-sunken,#f1f5f9); font-size:12px; } .tag[data-status=active] { color:var(--mn-color-success,#166534); } .tag[data-status=revoked],.tag[data-status=deleted] { color:var(--mn-color-danger,#b91c1c); }
    .secret { display:grid; gap:12px; padding:14px; border:1px solid var(--mn-color-warning,#d97706); border-radius:7px; background:var(--mn-color-surface-sunken,#fffdf5); } .secret code { overflow-wrap:anywhere; } .confirm { display:grid; gap:9px; padding:12px; border:1px solid var(--mn-color-danger,#b91c1c); border-radius:7px; }
    @media (max-width:560px) { .panel { padding:16px; } .row { grid-template-columns:1fr; align-items:stretch; } .row button { width:100%; } }
  `

  @property({ attribute: false }) gatewayUrl = ''
  @state() private copiedUrl = ''
  @property({ attribute: false }) store: MnApiKeyStoreLike | null = null
  @property({ attribute: false }) listGraphs: (() => Promise<readonly (MnApiKeyGraphKey & { title?: string })[]>) | null = null
  @state() private graphChoices: readonly (MnApiKeyGraphKey & { title?: string })[] = []
  @state() private graphsLoading = false
  @state() private graphsError = ''
  private graphLoadVersion = 0
  @state() private snapshot: MnApiKeyStoreSnapshot = { status: 'unavailable', apiKeys: [] }
  @state() private displayLabel = ''
  @state() private expiresAt = defaultExpiry()
  @state() private scopes = new Set<MnApiKeyScope>(['graphs.read'])
  @state() private graphAccess: 'selected' | 'all_accessible' = 'selected'
  @state() private graphs: readonly GraphDraft[] = [{ owner: '', graphId: '' }]
  @state() private validation = ''
  @state() private operationError = ''
  @state() private confirmationKeyId: string | null = null
  @state() private acknowledged = false

  private unsubscribe = (): void => undefined
  private loadStartedFor: MnApiKeyStoreLike | null = null
  private confirmationInvoker: HTMLElement | null = null
  private readonly onPageHide = (): void => { this.store?.discardOneTimeSecret() }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('listGraphs') && this.listGraphs) {
      const version = ++this.graphLoadVersion
      this.graphs = []
      this.graphsLoading = true
      this.graphsError = ''
      void this.listGraphs().then(rows => {
        if (version === this.graphLoadVersion && this.isConnected) this.graphChoices = rows
      }).catch(() => { if (version === this.graphLoadVersion) this.graphsError = 'Workspaces could not be loaded. Reopen this page to retry.' })
        .finally(() => { if (version === this.graphLoadVersion) this.graphsLoading = false })
    }
    if (!changed.has('store')) return
    const previousStore = changed.get('store') as MnApiKeyStoreLike | null | undefined
    // A different store represents an account/gateway transition, not an
    // ordinary render. The prior account's secret must not survive it.
    if (previousStore && previousStore !== this.store) previousStore.discardOneTimeSecret()
    this.unsubscribe()
    this.validation = ''
    this.operationError = ''
    this.confirmationKeyId = null
    this.acknowledged = false
    if (!this.store) {
      this.snapshot = { status: 'unavailable', apiKeys: [] }
      return
    }
    this.syncFromStore()
    this.unsubscribe = this.store.subscribe(() => this.syncFromStore())
  }

  protected updated(changed: PropertyValues<this>): void {
    if (!changed.has('store') || !this.store || this.loadStartedFor === this.store) return
    const status = statusOf(this.snapshot)
    if (status === 'idle' || status === 'loading') {
      this.loadStartedFor = this.store
      void this.store.load().catch(() => { this.operationError = 'API keys could not be loaded.' })
    }
  }

  disconnectedCallback(): void {
    this.graphLoadVersion += 1
    // Removal ends the account-slot lease; routine renders preserve the
    // element and never call this cleanup.
    this.store?.discardOneTimeSecret()
    globalThis.removeEventListener('pagehide', this.onPageHide)
    this.unsubscribe()
    this.unsubscribe = (): void => undefined
    super.disconnectedCallback()
  }

  connectedCallback(): void {
    super.connectedCallback()
    globalThis.addEventListener('pagehide', this.onPageHide)
  }

  private syncFromStore(): void {
    if (!this.store) return
    const priorSecret = this.snapshot.oneTimeSecret
    this.snapshot = this.store.snapshot()
    if (priorSecret !== this.snapshot.oneTimeSecret) this.acknowledged = false
    if (this.snapshot.status === 'ready') this.operationError = ''
  }

  private setGraph(index: number, field: keyof GraphDraft, value: string): void {
    this.graphs = this.graphs.map((graph, position) => position === index ? { ...graph, [field]: value } : graph)
    this.validation = ''
  }

  private addGraph(): void {
    if (this.graphs.length < 128) this.graphs = [...this.graphs, { owner: '', graphId: '' }]
  }

  private removeGraph(index: number): void {
    this.graphs = this.graphs.length === 1 ? [{ owner: '', graphId: '' }] : this.graphs.filter((_, position) => position !== index)
    this.validation = ''
  }

  private toggleScope(scope: MnApiKeyScope, checked: boolean): void {
    const next = new Set(this.scopes)
    if (checked) next.add(scope)
    else next.delete(scope)
    if (scope === 'mcp.write' && checked) next.add('mcp.read')
    if (scope === 'mcp.read' && !checked) next.delete('mcp.write')
    this.scopes = next
    this.validation = ''
  }

  private request(): MnApiKeyCreateRequest | null {
    const displayLabel = this.displayLabel.normalize('NFC').trim()
    const milliseconds = new Date(this.expiresAt).getTime()
    if (!displayLabel || Array.from(displayLabel).length > 100) {
      this.validation = 'Give this key a private label of 1–100 characters.'
      return null
    }
    if (!Number.isFinite(milliseconds) || milliseconds <= Date.now()) {
      this.validation = 'Choose an expiry date in the future.'
      return null
    }
    if (!this.scopes.size) {
      this.validation = 'Choose at least one scope.'
      return null
    }
    const graphAllowlist = this.graphAccess === 'all_accessible' ? [] : this.graphs.map(graph => ({ owner: graph.owner.trim(), graphId: graph.graphId.trim() }))
    if ((this.graphAccess === 'selected' && !graphAllowlist.length) || graphAllowlist.some(graph => !OWNER.test(graph.owner) || !isGraphId(graph.graphId) || graph.owner.includes('*') || graph.graphId.includes('*'))) {
      this.validation = 'Choose at least one workspace with a valid owner and graph ID.'
      return null
    }
    const unique = new Set(graphAllowlist.map(graph => `${graph.owner}\u0000${graph.graphId}`))
    if (unique.size !== graphAllowlist.length) {
      this.validation = 'Each graph can be allowed only once.'
      return null
    }
    this.validation = ''
    return {
      displayLabel,
      expiresAtUnixSeconds: Math.floor(milliseconds / 1_000),
      scopes: SCOPES.filter(scope => this.scopes.has(scope)),
      graphAllowlist,
      ...(this.graphAccess === 'all_accessible' ? { graphAccess: this.graphAccess } : {}),
    }
  }

  private async create(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const request = this.request()
    if (!request || !this.store || isBusy(statusOf(this.snapshot))) return
    this.operationError = ''
    try { await this.store.create(request) } catch { this.operationError = 'The key could not be created.' }
  }

  private async retryCreate(): Promise<void> {
    if (!this.store) return
    this.operationError = ''
    try { await this.store.retryCreate() } catch { this.operationError = 'The create request could not be retried.' }
  }

  private async revoke(keyId: string): Promise<void> {
    if (!this.store) return
    this.operationError = ''
    this.closeConfirmation(keyId)
    try { await this.store.remove(keyId) } catch { this.operationError = 'The key could not be revoked.' }
  }

  private openConfirmation(keyId: string, invoker: HTMLElement): void {
    this.confirmationKeyId = keyId
    this.confirmationInvoker = invoker
    void this.updateComplete.then(() => {
      const dialog = this.shadowRoot?.querySelector<HTMLElement>(`[data-confirm-key-id="${keyId}"]`)
      // Cancel is the first safe choice: confirmation never lands on the
      // destructive control merely by opening the dialog.
      dialog?.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.focus()
    })
  }

  private closeConfirmation(keyId: string): void {
    const invoker = this.confirmationInvoker
    this.confirmationKeyId = null
    this.confirmationInvoker = null
    void this.updateComplete.then(() => {
      if (invoker?.isConnected) {
        invoker.focus()
        return
      }
      const row = this.shadowRoot?.querySelector<HTMLElement>(`[data-key-id="${keyId}"]`)
      row?.querySelector<HTMLElement>('[data-revoke-key-id]')?.focus()
      if (!this.shadowRoot?.activeElement) row?.focus()
    })
  }

  private confirmationKeydown(event: KeyboardEvent, keyId: string): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.closeConfirmation(keyId)
      return
    }
    if (event.key !== 'Tab') return
    const dialog = event.currentTarget as HTMLElement
    const controls = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    if (controls.length < 2) return
    const first = controls[0]!
    const last = controls[controls.length - 1]!
    const focused = this.shadowRoot?.activeElement
    if ((event.shiftKey && focused === first) || (!event.shiftKey && focused === last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }

  private async retryDelete(): Promise<void> {
    if (!this.store) return
    this.operationError = ''
    try { await this.store.retryDelete() } catch { this.operationError = 'The revocation could not be retried.' }
  }

  private async copySecret(): Promise<void> {
    const secret = this.snapshot.oneTimeSecret
    if (!secret) return
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await globalThis.navigator.clipboard.writeText(secret.reveal())
      this.store?.markSecretCopied()
      this.operationError = ''
    } catch {
      // The value remains visibly selectable; never pass it into an error or log.
      this.operationError = 'Clipboard copying is unavailable. Select the value and copy it before acknowledging.'
    }
  }

  private status(): unknown {
    const status = statusOf(this.snapshot)
    const code = String(this.snapshot.code ?? '').toLowerCase()
    const text = this.operationError || errorText(code)
    if (text) return html`<div class="status" data-tone=${code === 'one_time_secret_unavailable' ? 'warning' : 'danger'} role="alert" aria-live="polite">${text}</div>`
    if (status === 'loading') return html`<div class="status" role="status" aria-live="polite">${t('Loading API keys…')}</div>`
    if (status === 'creating') return html`<div class="status" role="status" aria-live="polite">${t('Creating API key…')}</div>`
    if (status === 'deleting') return html`<div class="status" role="status" aria-live="polite">${t('Revoking API key…')}</div>`
    if (this.snapshot.deleteResult) return html`<div class="status" role="status" aria-live="polite">${t('API key revoked. Future requests using it are denied.')}</div>`
    return nothing
  }

  private renderSecret(): unknown {
    const secret = this.snapshot.oneTimeSecret
    if (!secret) return nothing
    return html`
      <section class="secret" aria-label=${t('Copy your API key once')}>
        <h4>${t('Copy this secret now')}</h4>
        <p class="hint">${t('It is shown only once and is not saved in this browser. Do not share it or put it in client-side code.')}</p>
        <input aria-label=${t('One-time API key secret')} type="text" readonly .value=${secret.reveal()} autocomplete="off" spellcheck="false" />
        <div class="actions"><button type="button" class="primary" @click=${() => { void this.copySecret() }}>${t('Copy secret')}</button>${this.snapshot.secretCopied ? html`<span class="meta">${t('Copied to clipboard.')}</span>` : nothing}</div>
        <label class="ack"><input type="checkbox" .checked=${this.acknowledged} @change=${(event: Event) => { this.acknowledged = (event.target as HTMLInputElement).checked }} /> <span>${t('I have copied and stored this secret. I understand it cannot be shown again.')}</span></label>
        <div class="actions"><button type="button" ?disabled=${!this.acknowledged} @click=${() => this.store?.acknowledgeSecret()}>${t('I’ve saved it')}</button></div>
      </section>
    `
  }

  private mcpUrl(graph: MnApiKeyGraphKey): string {
    try {
      const base = new URL(this.gatewayUrl)
      if (!['https:', 'http:'].includes(base.protocol)) return ''
      return `${base.origin}/o/${encodeURIComponent(graph.owner)}/g/${encodeURIComponent(graph.graphId)}/mcp`
    } catch { return '' }
  }

  private async copyUrl(url: string): Promise<void> {
    try { await navigator.clipboard.writeText(url); this.copiedUrl = url }
    catch { this.operationError = 'Copy failed. Select and copy the URL directly.' }
  }

  private renderConnection(key: MnApiKeyMetadata): unknown {
    if (key.status !== 'active' || !key.scopes.includes('mcp.read') || !this.gatewayUrl) return nothing
    return html`<details><summary>${t('Connect an MCP client')}</summary>
      <div class="fields">
        <p class="hint">${t('Transport: Streamable HTTP. Add the authorization header below using the secret you saved when creating this key.')}</p>
        <code>Authorization: Bearer &lt;your API key&gt;</code>
        ${key.graphAccess === 'all_accessible' ? html`<p class="hint">${t('This global key works with all workspaces you can access, including future and shared workspaces. Choose a workspace URL below.')}</p>` : nothing}
        ${(key.graphAccess === 'all_accessible' ? this.graphChoices : key.graphAllowlist).map(graph => {
          const url = this.mcpUrl(graph)
          return url ? html`<div class="field"><label>${graph.graphId} · ${graph.owner}</label>
            <input readonly aria-label=${`MCP URL for ${graph.graphId}`} .value=${url} />
            <button type="button" @click=${() => { void this.copyUrl(url) }}>${this.copiedUrl === url ? t('Copied URL') : t('Copy MCP URL')}</button></div>` : nothing
        })}
        <p class="hint">${t('Each URL connects to one workspace. A sleeping workspace may need a moment to start; reconnect if your client reports it is activating.')}</p>
        <p class="hint">${t('With sophia-mcp: set SOPHIA_MCP_BACKEND to the workspace URL and SOPHIA_MCP_TOKEN to your key. Requires sophia-mcp 0.2.2 or later.')}</p>
      </div></details>`
  }

  private renderKey(key: MnApiKeyMetadata): unknown {
    const confirming = this.confirmationKeyId === key.keyId
    return html`
      <article class="key" data-key-id=${key.keyId} tabindex="-1">
        <div class="key-header"><span class="key-label">${key.displayLabel}</span><span class="tag" data-status=${key.status}>${key.status}</span></div>
        <div class="meta">ID: ${key.keyId} · Expires: ${dateLabel(key.expiresAtUnixSeconds)} · Last used: ${dateLabel(key.lastUsedAtUnixSeconds)}</div>
        <div class="meta">Scopes: ${key.scopes.join(', ')} · Workspaces: ${key.graphAccess === 'all_accessible' ? 'All my workspaces (including future and shared)' : key.graphAllowlist.map(graph => `${graph.owner}/${graph.graphId}`).join(', ')}</div>
        ${key.status === 'active' && !confirming ? html`<div class="actions"><button type="button" class="danger" data-revoke-key-id=${key.keyId} @click=${(event: Event) => this.openConfirmation(key.keyId, event.currentTarget as HTMLElement)}>${t('Revoke key…')}</button></div>` : nothing}
        ${this.renderConnection(key)}
        ${confirming ? html`<div class="confirm" role="alertdialog" aria-modal="true" aria-label=${`Confirm revocation of ${key.displayLabel}`} data-confirm-key-id=${key.keyId} @keydown=${(event: KeyboardEvent) => this.confirmationKeydown(event, key.keyId)}><strong>${t('Revoke this API key?')}</strong><p class="hint">${t('This cannot be undone. The next request using this key will be denied.')}</p><div class="actions"><button type="button" data-confirm-cancel @click=${() => this.closeConfirmation(key.keyId)}>${t('Cancel')}</button><button type="button" class="danger" @click=${() => { void this.revoke(key.keyId) }}>${t('Revoke key')}</button></div></div>` : nothing}
      </article>
    `
  }

  render() {
    const status = statusOf(this.snapshot)
    const disabled = !this.store || isBusy(status) || status === 'unavailable' || status === 'unauthenticated'
    const canRetryCreate = Boolean(this.snapshot.operationId) && (status === 'error' || status === 'unavailable' || status === 'unauthenticated')
    return html`
      <section class="panel" aria-label=${t('API keys')}>
        <div><h3>${t('API keys')}</h3><p class="intro">${t('Create keys for scripts and integrations. Choose an expiry and the workspaces each key can access.')}</p></div>
        <p class="hint">${t('Enable MCP Read to connect an agent. Add MCP Write to let it edit. Existing workspace permissions still apply.')}</p>
        ${this.status()}
        ${this.renderSecret()}
        <form class="form" @submit=${(event: SubmitEvent) => { void this.create(event) }}>
          <h4>${t('Create an API key')}</h4>
          <div class="field"><label for="api-key-label">${t('Private label')}</label><input id="api-key-label" type="text" maxlength="200" .value=${this.displayLabel} .disabled=${disabled} @input=${(event: Event) => { this.displayLabel = (event.target as HTMLInputElement).value; this.validation = '' }} /><p class="hint">${t('For example, “Local automation”. This is visible only in your account settings.')}</p></div>
          <div class="field"><label for="api-key-expiry">${t('Expires')}</label><input id="api-key-expiry" type="datetime-local" .value=${this.expiresAt} .disabled=${disabled} @input=${(event: Event) => { this.expiresAt = (event.target as HTMLInputElement).value; this.validation = '' }} /></div>
          <fieldset .disabled=${disabled}><legend>${t('Permissions')}</legend><div class="scope-options">${SCOPES.map(scope => html`<label><input type="checkbox" .checked=${this.scopes.has(scope)} @change=${(event: Event) => this.toggleScope(scope, (event.target as HTMLInputElement).checked)} /> ${{ 'graphs.read': 'HTTP Read', 'graphs.write': 'HTTP Write', 'mcp.read': 'MCP Read', 'mcp.write': 'MCP Write' }[scope]}</label>`)}</div></fieldset>
          <fieldset .disabled=${disabled}><legend>${t('Workspace access')}</legend><div class="workspace-access-options">
            <label><input type="radio" name="api-key-graph-access" value="selected" .checked=${this.graphAccess === 'selected'} @change=${() => { this.graphAccess = 'selected'; this.validation = '' }} /> Selected workspaces</label>
            <label><input type="radio" name="api-key-graph-access" value="all_accessible" .checked=${this.graphAccess === 'all_accessible'} @change=${() => { this.graphAccess = 'all_accessible'; this.validation = '' }} /> All my workspaces</label>
          </div><p class="hint">${t('Global keys include current, future and shared workspaces. Your permissions still apply to every request.')}</p></fieldset>
          ${this.graphAccess === 'all_accessible' ? nothing : this.listGraphs ? html`<fieldset .disabled=${disabled}><legend>${t('Workspaces')}</legend>
            <p class="hint">${t('Choose the workspaces this key can access. Your existing permissions still apply.')}</p>
            ${this.graphsLoading ? html`<p role="status">${t('Loading workspaces…')}</p>` : nothing}
            ${this.graphsError ? html`<p role="alert">${this.graphsError}</p>` : nothing}
            ${this.graphChoices.map(graph => html`<label class="ack"><input type="checkbox"
              .checked=${this.graphs.some(row => row.owner === graph.owner && row.graphId === graph.graphId)}
              @change=${(event: Event) => {
                this.graphs = this.graphs.filter(row => row.owner !== graph.owner || row.graphId !== graph.graphId)
                if ((event.target as HTMLInputElement).checked) this.graphs = [...this.graphs, { owner: graph.owner, graphId: graph.graphId }]
                this.validation = ''
              }} /> <span>${graph.title || graph.graphId}<small class="meta"> · ${graph.graphId}</small></span></label>`)}
          </fieldset>` : html`<fieldset .disabled=${disabled}><legend>${t('Exact graph allowlist')}</legend><p class="hint">${t('Each entry is an exact GraphKey. Collaborator graphs may be listed only by their exact owner and graph ID.')}</p><div class="graphs">${this.graphs.map((graph, index) => html`<div class="row"><div class="field"><label for=${`api-key-owner-${index}`}>${t('Owner')}</label><input id=${`api-key-owner-${index}`} type="text" placeholder="user:alice" .value=${graph.owner} @input=${(event: Event) => this.setGraph(index, 'owner', (event.target as HTMLInputElement).value)} /></div><div class="field"><label for=${`api-key-graph-${index}`}>${t('Graph ID')}</label><input id=${`api-key-graph-${index}`} type="text" placeholder="research" .value=${graph.graphId} @input=${(event: Event) => this.setGraph(index, 'graphId', (event.target as HTMLInputElement).value)} /></div><button type="button" ?disabled=${disabled} @click=${() => this.removeGraph(index)}>${t('Remove')}</button></div>`)}</div><div class="actions"><button type="button" ?disabled=${disabled || this.graphs.length >= 128} @click=${() => this.addGraph()}>${t('Add graph')}</button></div></fieldset>`}

          ${this.validation ? html`<div class="status" data-tone="danger" role="alert">${this.validation}</div>` : nothing}
          <div class="actions"><button type="submit" class="primary" ?disabled=${disabled || (this.graphAccess === 'selected' && (this.graphsLoading || Boolean(this.graphsError)))}>${status === 'creating' ? 'Creating…' : t('Create API key')}</button>${canRetryCreate ? html`<button type="button" @click=${() => { void this.retryCreate() }}>${t('Retry exact create')}</button>` : nothing}${status === 'error' ? html`<button type="button" @click=${() => { void this.retryDelete() }}>${t('Retry revocation')}</button>` : nothing}</div>
        </form>
        <div class="key-list" aria-label=${t('Existing API keys')}><h4>${t('Existing API keys')}</h4>${this.snapshot.apiKeys?.length ? this.snapshot.apiKeys.map(key => this.renderKey(key)) : html`<p class="hint">${t('No API keys have been created.')}</p>`}</div>
        <p class="hint">${t('Migrating from Cloud-1? Existing')} <code>mnemo_</code> keys cannot be imported. Reissue a new scoped API key here and update the client.</p>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-api-key-manager': MnApiKeyManager
  }
}
