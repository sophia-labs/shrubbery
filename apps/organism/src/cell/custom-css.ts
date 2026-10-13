import '@shrubbery/hoja'
import type { HojaEditor } from '@shrubbery/hoja'
import type { MnContextMenu } from '@shrubbery/components'
import type { EditorRoomPool } from '@shrubbery/runtime'
import type { Doc } from 'yjs'
import type { CellContract } from './session-store.js'
import { cellAuthHeaders } from './cell-auth-headers.js'
import { graphCellUrl } from './rest-helpers.js'
import { randomUUID, sha256Digest } from '@shrubbery/nucleus/web-crypto'

export interface CustomCssSnapshot {
  schemaVersion: 1
  scope: 'graph'
  graphId: string
  graphIncarnation: string
  cssText: string
  contentHashSha256: string
  revision: number
}

export async function cssHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length > 65_536 || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== text) {
    throw new Error('CSS must be valid Unicode and at most 65,536 UTF-8 bytes.')
  }
  return Array.from(new Uint8Array(await sha256Digest(bytes)), b => b.toString(16).padStart(2, '0')).join('')
}

export async function decodeCustomCss(value: unknown, graphId: string): Promise<CustomCssSnapshot> {
  const data = value as Partial<CustomCssSnapshot> | null
  if (!data || data.schemaVersion !== 1 || data.scope !== 'graph' || data.graphId !== graphId
    || typeof data.graphIncarnation !== 'string' || !data.graphIncarnation
    || typeof data.cssText !== 'string' || typeof data.contentHashSha256 !== 'string'
    || !Number.isSafeInteger(data.revision) || data.revision! < 0
    || await cssHash(data.cssText) !== data.contentHashSha256) throw new Error('Invalid or mismatched workspace CSS response.')
  return data as CustomCssSnapshot
}

export function cssConsentKey(snapshot: Pick<CustomCssSnapshot, 'graphId' | 'graphIncarnation'>, accountId = ''): string {
  return `sophia.custom-css.approved:v2:${encodeURIComponent(accountId)}:${encodeURIComponent(snapshot.graphId)}:${encodeURIComponent(snapshot.graphIncarnation)}`
}

type PendingWrite = { method: 'PUT' | 'DELETE'; body: string; desiredText: string }
class CustomCssAuthorityError extends Error {
  constructor(message: string, readonly unavailable = false) { super(message) }
}

/** One native authority. Browser persistence stores consent, never CSS text. */
export class CustomCssController {
  private readonly style = document.createElement('style')
  private snapshot: CustomCssSnapshot | null = null
  private pending: PendingWrite | null = null
  private disposed = false
  private busy = false
  private refreshRequested = false
  private draftVersion = 0
  private generation = 0
  private suspended = false
  private approvalEpoch = 0
  private safeMode = new URLSearchParams(location.search).get('custom-css') === 'off'
  private dialog: HTMLDialogElement | null = null
  private editor: HojaEditor | null = null
  private status: HTMLElement | null = null
  private dirty = false
  private stopWatch: (() => void) | null = null
  private stopAuth: (() => void) | null = null
  private readonly accountId: string
  private readonly authenticated: boolean
  private focusReturn: HTMLElement | null = null
  private readonly requests = new Set<AbortController>()
  private authorityReady = false
  private reading = false
  private sourceActions: HTMLButtonElement[] = []

  constructor(private readonly contract: CellContract, private readonly graphId: string, pool?: EditorRoomPool) {
    this.accountId = contract.auth.userId()
    this.authenticated = contract.auth.isAuthenticated()
    this.stopAuth = contract.auth.onChange(() => { this.active() })
    this.style.dataset.sophiaCustomCss = graphId
    document.head.append(this.style)
    window.addEventListener('focus', this.onFocus)
    window.addEventListener('keydown', this.recover, true)
    if (pool) this.watch(pool)
    void this.refresh()
  }

  private readonly onFocus = (): void => { void this.refresh() }
  private readonly recover = (event: KeyboardEvent): void => {
    if (event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyC') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.disable()
      void this.open()
    }
  }

  private watch(pool: EditorRoomPool): void {
    let closed = false
    let release: (() => void) | null = null
    this.stopWatch = () => { closed = true; release?.() }
    void this.contract.auth.whenReady().then(() => {
      if (closed || this.disposed) return
      const lease = pool.acquire({ kind: 'workspace', graphId: this.graphId }, 'custom-css')
      const doc = lease.provider.doc as Doc
      const changed = (): void => { void this.refresh() }
      doc.on('update', changed)
      const unsubscribe = lease.provider.lifecycle.subscribe(() => {
        if (lease.provider.lifecycle.get().synchronized) void this.refresh()
      })
      release = () => { doc.off('update', changed); unsubscribe(); lease.release() }
    }).catch(error => this.message(`Live CSS updates unavailable: ${String(error)}`))
  }

  private message(text: string): void { if (this.status) this.status.textContent = text }

  private updateActions(): void {
    for (const button of this.sourceActions) button.disabled = !this.authorityReady || !this.snapshot || this.reading || this.busy || this.disposed
  }

  private authorityFailed(error: unknown): void {
    this.authorityReady = false
    this.updateActions()
    this.applyApproved()
    this.message(String(error))
  }

  private active(): boolean {
    if (this.disposed) return false
    if (!this.accountId || this.contract.auth.userId() !== this.accountId || this.contract.auth.isAuthenticated() !== this.authenticated) {
      this.dispose()
      return false
    }
    return true
  }

  private finishOperation(): void {
    this.busy = false
    this.updateActions()
    if (!this.disposed && this.refreshRequested) {
      this.refreshRequested = false
      void this.refresh()
    }
  }

  private approved(snapshot: CustomCssSnapshot): boolean {
    try { return localStorage.getItem(cssConsentKey(snapshot, this.accountId)) === snapshot.contentHashSha256 } catch { return false }
  }

  private applyApproved(): void {
    const value = this.snapshot
    this.style.textContent = !this.disposed && this.authorityReady && !this.safeMode && !this.suspended && value && this.approved(value) ? value.cssText : ''
  }

  disable(): void {
    ++this.approvalEpoch
    if (this.snapshot) {
      try { localStorage.removeItem(cssConsentKey(this.snapshot, this.accountId)) } catch { /* This session is still disabled. */ }
    }
    this.safeMode = true
    this.style.textContent = ''
    this.message('Custom CSS disabled on this device. Shared source is unchanged.')
  }

  private async request(method = 'GET', body?: string): Promise<CustomCssSnapshot> {
    const abort = new AbortController()
    this.requests.add(abort)
    const timeout = setTimeout(() => abort.abort(), 15_000)
    try {
      const response = await fetch(graphCellUrl(this.contract, this.graphId, `/graphs/${encodeURIComponent(this.graphId)}/ui/custom-css`), {
        method, body, signal: abort.signal, cache: 'no-store', headers: cellAuthHeaders(this.contract, { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }),
      })
      if (!response.ok) throw new CustomCssAuthorityError(response.status === 404
        ? "Custom CSS is not available on this workspace's engine yet (HTTP 404). Your draft is retained; recovery controls remain available."
        : `Custom CSS ${method} failed (HTTP ${response.status}). Reload to inspect the current shared source; your draft is retained.`, response.status === 404)
      try { return await decodeCustomCss(await response.json(), this.graphId) }
      catch (error) { throw new CustomCssAuthorityError(`Invalid or mismatched workspace CSS authority: ${String(error)}. Your draft is retained.`) }
    } finally { clearTimeout(timeout); this.requests.delete(abort) }
  }

  async refresh(): Promise<void> {
    if (!this.active()) return
    if (this.busy) { this.refreshRequested = true; return }
    const generation = ++this.generation
    this.reading = true
    this.updateActions()
    try {
      const next = await this.request()
      if (!this.active() || generation !== this.generation) return
      if (this.snapshot && this.snapshot.graphIncarnation !== next.graphIncarnation) {
        this.disable()
        this.message('Workspace replaced. Close and reopen this workspace before editing CSS.')
        this.disposed = true
        this.stopWatch?.()
        this.authorityReady = false
        return
      }
      this.authorityReady = true
      const changed = this.snapshot?.contentHashSha256 !== next.contentHashSha256
      if (changed && (this.dirty || this.pending)) {
        this.disable()
        this.message('Shared CSS changed. Your draft and original revision are retained. Reload explicitly before saving over the new revision.')
        return
      }
      this.snapshot = next
      this.applyApproved()
      if (this.editor && !this.dirty && !this.pending) this.editor.value = next.cssText
      if (changed && this.dirty) this.message('Shared CSS changed. Your draft is retained. Reload explicitly before saving over the new revision.')
    } catch (error) { if (!this.disposed && generation === this.generation) this.authorityFailed(error) }
    finally { if (generation === this.generation) { this.reading = false; this.updateActions() } }
  }

  async save(reset = false): Promise<void> {
    if (!this.active() || this.busy || this.reading || !this.authorityReady || !this.snapshot || !this.editor) return
    this.busy = true
    this.updateActions()
    const editor = this.editor
    const draftVersion = this.draftVersion
    const originalText = editor.value
    const snapshot = this.snapshot
    const approvalEpoch = this.approvalEpoch
    const desiredText = reset ? '' : originalText
    try {
      await cssHash(desiredText)
      if (!this.active() || this.editor !== editor) return
      if (this.pending && (this.pending.desiredText !== desiredText || this.pending.method !== (reset ? 'DELETE' : 'PUT'))) {
        throw new Error('A previous save is uncertain. Retry those exact bytes, or Reload before a new operation.')
      }
      this.pending ??= { method: reset ? 'DELETE' : 'PUT', desiredText, body: JSON.stringify({
        graphIncarnation: snapshot.graphIncarnation, expectedContentSha256: snapshot.contentHashSha256,
        expectedRevision: snapshot.revision, operationId: randomUUID(), ...(reset ? {} : { cssText: desiredText }),
      }) }
      this.busy = true
      ++this.generation
      this.message('Saving shared CSS…')
      const next = await this.request(this.pending.method, this.pending.body)
      if (!this.active() || this.editor !== editor) return
      if (next.graphIncarnation !== snapshot.graphIncarnation) {
        this.disable()
        throw new CustomCssAuthorityError('Workspace incarnation changed; refusing application.')
      }
      this.pending = null
      if (next.cssText !== desiredText) {
        this.disable()
        this.message('The operation completed, but newer shared CSS exists. Your draft is retained; reload to inspect it.')
        return
      }
      this.snapshot = next
      if (this.draftVersion !== draftVersion || editor.value !== originalText) {
        this.dirty = true
        this.message('The requested revision was saved. Your newer draft is retained and has not been applied; save it explicitly when ready.')
        return
      }
      if (approvalEpoch !== this.approvalEpoch) {
        this.message('Shared CSS saved. Application remains disabled by your newer recovery action.')
        return
      }
      try { localStorage.setItem(cssConsentKey(next, this.accountId), next.contentHashSha256) } catch {
        this.message('Saved shared source, but browser storage refused consent. CSS remains disabled.')
        return
      }
      this.safeMode = false
      this.dirty = false
      this.editor.value = next.cssText
      this.close()
    } catch (error) {
      if (error instanceof CustomCssAuthorityError) this.authorityFailed(error)
      else this.message(`${String(error)} Retry preserves the original operation identity.`)
    }
    finally { this.finishOperation() }
  }

  /** Reader-safe local consent: verify the displayed revision with GET only. */
  async applyReadRevision(): Promise<void> {
    if (!this.active() || this.busy || this.reading || !this.authorityReady || !this.snapshot || !this.editor) return
    const editor = this.editor
    const snapshot = this.snapshot
    if (this.pending || editor.value !== snapshot.cssText) {
      this.message('Save this draft to shared CSS, or reload a saved revision before applying locally.')
      return
    }
    this.busy = true
    this.updateActions()
    ++this.generation
    const draftVersion = this.draftVersion
    const approvalEpoch = this.approvalEpoch
    try {
      const next = await this.request()
      if (!this.active() || this.editor !== editor) return
      if (next.graphIncarnation !== snapshot.graphIncarnation || next.revision !== snapshot.revision || next.contentHashSha256 !== snapshot.contentHashSha256) {
        this.disable()
        this.message('The saved revision changed. Reload and inspect it before applying on this device.')
        return
      }
      if (approvalEpoch !== this.approvalEpoch || draftVersion !== this.draftVersion || editor.value !== snapshot.cssText) {
        this.message('Application was cancelled by your newer edit or Disable action. Your draft is retained.')
        return
      }
      localStorage.setItem(cssConsentKey(next, this.accountId), next.contentHashSha256)
      this.snapshot = next
      this.safeMode = false
      this.dirty = false
      this.close()
    } catch (error) { this.authorityFailed(`Could not apply this saved revision: ${String(error)}`) }
    finally { this.finishOperation() }
  }

  async open(): Promise<void> {
    if (!this.active()) return
    if (this.dialog) { this.editor?.focus(); return }
    this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.suspended = true
    this.applyApproved()
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-labelledby', 'custom-css-title')
    dialog.style.cssText = 'box-sizing:border-box;width:min(900px,calc(100vw - 24px));max-height:92dvh;padding:24px;border:1px solid #adb8b0;border-radius:16px;background:#fafcf9;color:#202921;overflow:auto;box-shadow:0 24px 100px #0005;'
    const title = document.createElement('h2')
    title.id = 'custom-css-title'
    title.textContent = 'Custom CSS'
    const help = document.createElement('p')
    help.textContent = `Shared source for workspace ${this.graphId}. Applying is opt-in on this device, for these exact bytes. Agents can stage changes; they never silently apply. Global selectors reach light DOM, inherited --mn-* tokens and exported ::part() hooks—not arbitrary shadow internals. Invalid declarations may be ignored; url()/@import follow host CSP.`
    help.style.cssText = 'font:14px/1.5 system-ui;max-width:76ch;'
    const editor = document.createElement('hoja-editor') as HojaEditor
    editor.sourceMode = true
    editor.posture = 'embedded'
    editor.label = 'Workspace custom CSS source'
    editor.placeholder = ':root { --mn-radius-control: 10px; }'
    editor.value = this.snapshot?.cssText ?? ''
    editor.style.cssText = 'display:block;height:46dvh;min-height:220px;font-family:monospace;'
    editor.onChange = detail => { editor.value = detail.value; this.dirty = true; ++this.draftVersion }
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    status.textContent = 'Recovery: Ctrl+Alt+Shift+C disables CSS and opens this editor. Start with ?custom-css=off for safe mode.'
    status.style.cssText = 'font:13px/1.5 system-ui;'
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;'
    this.sourceActions = []
    const button = (label: string, action: () => void, needsSource = false): void => {
      const el = document.createElement('button')
      el.type = 'button'; el.textContent = label
      el.style.cssText = 'padding:9px 14px;border:1px solid #819184;border-radius:8px;font:14px system-ui;background:#fff;color:#202921;cursor:pointer;'
      el.addEventListener('click', action); actions.append(el)
      if (needsSource) this.sourceActions.push(el)
    }
    button('Disable here', () => this.disable())
    button('Apply this revision here', () => { void this.applyReadRevision() }, true)
    button('Reload shared source', () => {
      if (this.busy || (this.dirty && !confirm('Discard this draft and reload shared CSS?'))) return
      this.dirty = false; this.pending = null; void this.refresh()
    })
    button('Reset shared CSS', () => { if (confirm('Reset the shared workspace stylesheet for everyone?')) void this.save(true) }, true)
    button('Cancel', () => { if (!this.busy && (!this.dirty || confirm('Discard this CSS draft?'))) this.close() })
    button('Save & apply here', () => { void this.save() }, true)
    this.updateActions()
    dialog.append(title, help, editor, status, actions)
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!this.busy && (!this.dirty || confirm('Discard this CSS draft?'))) this.close() })
    document.body.append(dialog)
    this.dialog = dialog; this.editor = editor; this.status = status
    dialog.showModal()
    await this.refresh()
    if (!this.disposed) editor.focus()
  }

  private close(): void {
    this.dialog?.close(); this.dialog?.remove()
    this.dialog = null; this.editor = null; this.status = null; this.dirty = false
    this.sourceActions = []
    this.suspended = false
    this.applyApproved()
    this.focusReturn?.focus()
  }

  dispose(): void {
    this.disposed = true; ++this.generation
    this.refreshRequested = false
    this.stopAuth?.(); this.stopAuth = null
    for (const request of this.requests) request.abort()
    this.stopWatch?.(); this.stopWatch = null
    window.removeEventListener('focus', this.onFocus)
    window.removeEventListener('keydown', this.recover, true)
    this.close(); this.style.remove()
  }
}

/** Uses the existing context-menu implementation; no pointer behavior changes. */
export function showCustomCssMenu(x: number, y: number, open: () => void): void {
  const menu = document.createElement('mn-context-menu') as MnContextMenu
  menu.items = [{ id: 'custom-css', label: 'Custom CSS…', shortcut: 'Ctrl+Alt+Shift+C' }]
  menu.addEventListener('mn-select', () => { open(); menu.remove() }, { once: true })
  menu.addEventListener('mn-close', () => menu.remove(), { once: true })
  document.body.append(menu)
  menu.show({ x, y }, 'top-left')
}
