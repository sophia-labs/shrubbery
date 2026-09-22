import type { HojaComposerDetail } from '@shrubbery/hoja'
import type { AuthSessionSnapshot, CognitoAuthSession } from '@shrubbery/source/gateway'
import { css, html, LitElement, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { firstLineTitle, relativeTime, snippetOf } from './notes.js'
import { type SeedStore, type SeedSummary, SoilStore } from './seed-store.js'

const SAVE_DEBOUNCE_MS = 500

/**
 * hoja — the app. A quiet two-pane notes surface where every row in the left
 * pane is a `.sd` seed file served by a local `soil app` process. The hoja
 * *component* renders the note; this element owns list, selection, and saves.
 */
@customElement('hoja-app')
export class HojaApp extends LitElement {
  @property({ attribute: false }) store: SeedStore = new SoilStore()
  @property({ attribute: false }) authSession: CognitoAuthSession | null = null
  @state() private seeds: SeedSummary[] = []
  @state() private selectedId: string | null = null
  @state() private draft = ''
  @state() private saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle'
  @state() private loadError: string | null = null
  @state() private mobileEditorOpen = false
  @state() private authSnapshot: AuthSessionSnapshot | null = null
  @state() private authBusy = false
  @state() private authError: string | null = null
  @state() private identity = ''
  @state() private password = ''

  private saveTimer: number | undefined
  private pendingSave: { id: string; markdown: string; json: unknown } | null = null
  private stopAuthListener: (() => void) | null = null
  private readonly onKeydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault()
      void this.createSeed()
    }
  }

  override connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('keydown', this.onKeydown)
    this.bindAuth()
  }

  override disconnectedCallback(): void {
    window.removeEventListener('keydown', this.onKeydown)
    this.stopAuthListener?.()
    this.stopAuthListener = null
    super.disconnectedCallback()
  }

  private bindAuth(): void {
    this.stopAuthListener?.()
    this.stopAuthListener = null
    if (!this.authSession) {
      void this.loadSeeds()
      return
    }
    const update = () => {
      this.authSnapshot = this.authSession?.snapshot() ?? null
      if (this.authSnapshot?.status === 'authenticated') {
        void this.loadSeeds()
      } else if (this.authSnapshot?.status === 'anonymous') {
        this.seeds = []
        this.selectedId = null
        this.draft = ''
      }
    }
    this.stopAuthListener = this.authSession.onChange(update)
    void this.authSession.whenReady().then(update)
  }

  private async loadSeeds(): Promise<void> {
    try {
      this.seeds = [...await this.store.list()]
      this.loadError = null
      if (this.selectedId === null && this.seeds.length > 0) {
        await this.select(this.seeds[0].id, { openMobile: false })
      }
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
    }
  }

  private async select(id: string, { openMobile = true } = {}): Promise<void> {
    await this.flushPendingSave()
    try {
      const data = await this.store.read(id)
      this.selectedId = data.id
      this.draft = data.markdown
      this.saveState = 'idle'
      if (openMobile) this.mobileEditorOpen = true
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
    }
  }

  private async createSeed(): Promise<void> {
    await this.flushPendingSave()
    try {
      const data = await this.store.create()
      await this.loadSeeds()
      await this.select(data.id)
      this.updateComplete.then(() => {
        this.renderRoot.querySelector<HTMLElement>('hoja-editor')?.focus()
      })
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
    }
  }

  private onEditorChange(detail: HojaComposerDetail): void {
    if (this.selectedId === null) return
    this.saveState = 'saving'
    this.pendingSave = { id: this.selectedId, markdown: detail.value, json: detail.json }
    const optimisticTitle = firstLineTitle(detail.value)
    const optimisticSnippet = snippetOf(detail.value)
    this.seeds = this.seeds.map((seed) =>
      seed.id === this.selectedId
        ? { ...seed, title: optimisticTitle, snippet: optimisticSnippet }
        : seed,
    )
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      void this.flushPendingSave()
    }, SAVE_DEBOUNCE_MS)
  }

  private async flushPendingSave(): Promise<void> {
    window.clearTimeout(this.saveTimer)
    const pending = this.pendingSave
    if (pending === null) return
    this.pendingSave = null
    try {
      const data = await this.store.save(pending.id, {
        markdown: pending.markdown,
        json: pending.json,
      })
      this.seeds = this.seeds
        .map((seed) =>
          seed.id === pending.id
            ? { ...seed, title: data.title, snippet: data.snippet, modified_ms: data.modified_ms }
            : seed,
        )
        .sort((a, b) => b.modified_ms - a.modified_ms)
      this.saveState = 'saved'
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
      this.saveState = 'error'
    }
  }

  private async signIn(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!this.authSession || this.authBusy) return
    this.authBusy = true
    this.authError = null
    try {
      await this.authSession.signIn(this.identity, this.password)
      this.password = ''
    } catch (error) {
      this.authError = error instanceof Error ? error.message : String(error)
    } finally {
      this.authBusy = false
    }
  }

  private async signOut(): Promise<void> {
    if (!this.authSession || this.authBusy) return
    await this.flushPendingSave()
    this.authBusy = true
    try {
      await this.authSession.signOut()
    } finally {
      this.authBusy = false
    }
  }

  override render() {
    if (this.authSession && this.authSnapshot?.status !== 'authenticated') {
      return this.renderSignIn()
    }
    return html`
      <div class="shell ${this.mobileEditorOpen ? 'editor-open' : ''}">
        <aside>
          <header>
            <h1 aria-label="hoja">
              <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
                <defs>
                  <mask id="hoja-vein">
                    <rect width="24" height="24" fill="white"></rect>
                    <path
                      d="M 9.1 20.2 C 9.8 16.2 10.8 12.2 13.4 7.6"
                      fill="none"
                      stroke="black"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    ></path>
                  </mask>
                </defs>
                <path
                  mask="url(#hoja-vein)"
                  fill="currentColor"
                  d="M 8.6 21.6 C 8.2 18.5 6.5 16.8 4.9 14.2 C 2.9 10.9 4.4 6.6 8.4 4.4 C 10.3 3.35 12.4 3.0 14.6 3.0 L 20.2 8.6 C 20.9 11.6 20.3 14.6 18.1 16.9 C 15.7 19.4 12.2 20.6 9.9 21.2 C 9.4 21.35 9.0 21.5 8.6 21.6 Z"
                ></path>
                <polygon fill="currentColor" opacity="0.45" points="14.6,3.0 20.2,8.6 15.1,8.4"></polygon>
              </svg>
            </h1>
            <button
              class="new-leaf"
              title="New leaf (⌘N)"
              aria-label="New leaf"
              data-testid="button.new-leaf"
              @click=${() => void this.createSeed()}
            >
              +
            </button>
          </header>
          ${this.loadError !== null
            ? html`<p class="load-error">${this.loadError}</p>`
            : nothing}
          <ul>
            ${this.seeds.map(
              (seed) => html`
                <li>
                  <button
                    class="row ${seed.id === this.selectedId ? 'selected' : ''}"
                    @click=${() => void this.select(seed.id)}
                  >
                    <span class="row-title">${seed.title}</span>
                    <span class="row-meta">
                      <span class="row-time">${relativeTime(seed.modified_ms)}</span>
                      <span class="row-snippet">${seed.snippet}</span>
                    </span>
                  </button>
                </li>
              `,
            )}
          </ul>
          ${this.seeds.length === 0 && this.loadError === null
            ? html`<p class="empty-list">No leaves yet.</p>`
            : nothing}
        </aside>
        <main>
          ${this.selectedId !== null
            ? html`
                <div class="editor-bar">
                  <button
                    class="back"
                    aria-label="Back to leaves"
                    data-testid="button.back"
                    @click=${() => (this.mobileEditorOpen = false)}
                  >‹</button>
                  <span class="save-state" data-state=${this.saveState}>
                    ${this.saveState === 'saving'
                      ? '…'
                      : this.saveState === 'saved'
                        ? '✓'
                        : this.saveState === 'error'
                          ? '✗'
                          : '·'}
                  </span>
                </div>
                <div class="page">
                  <hoja-editor
                    posture="page"
                    placeholder="Grow something…"
                    .value=${this.draft}
                    @hoja-change=${(event: CustomEvent<HojaComposerDetail>) =>
                      this.onEditorChange(event.detail)}
                  ></hoja-editor>
                </div>
              `
            : html`<div class="blank"><p>a leaf is a page</p></div>`}
        </main>
        ${this.authSession
          ? html`<button
              class="sign-out"
              title="Sign out"
              aria-label="Sign out"
              data-testid="button.sign-out"
              @click=${() => void this.signOut()}
            >↪</button>`
          : nothing}
      </div>
    `
  }

  private renderSignIn() {
    const restoring = this.authSnapshot === null || this.authSnapshot.status === 'restoring'
    return html`
      <main class="auth-shell">
        <div class="auth-card">
          <svg class="auth-mark" viewBox="0 0 24 24" role="img" aria-label="hoja">
            <path
              fill="currentColor"
              d="M 8.6 21.6 C 8.2 18.5 6.5 16.8 4.9 14.2 C 2.9 10.9 4.4 6.6 8.4 4.4 C 10.3 3.35 12.4 3.0 14.6 3.0 L 20.2 8.6 C 20.9 11.6 20.3 14.6 18.1 16.9 C 15.7 19.4 12.2 20.6 9.9 21.2 C 9.4 21.35 9.0 21.5 8.6 21.6 Z"
            ></path>
          </svg>
          ${restoring
            ? html`<p>finding your garden…</p>`
            : html`
                <h1>hoja</h1>
                <p class="auth-note">Sign in to open your Garden leaves.</p>
                <form @submit=${(event: SubmitEvent) => void this.signIn(event)}>
                  <label>
                    Email or username
                    <input
                      name="identity"
                      autocomplete="username"
                      .value=${this.identity}
                      @input=${(event: InputEvent) => {
                        this.identity = (event.currentTarget as HTMLInputElement).value
                      }}
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      autocomplete="current-password"
                      .value=${this.password}
                      @input=${(event: InputEvent) => {
                        this.password = (event.currentTarget as HTMLInputElement).value
                      }}
                      required
                    />
                  </label>
                  ${this.authError ? html`<p class="auth-error" role="alert">${this.authError}</p>` : nothing}
                  <button type="submit" ?disabled=${this.authBusy}>
                    ${this.authBusy ? 'signing in…' : 'open garden'}
                  </button>
                </form>
              `}
        </div>
      </main>
    `
  }

  static override styles = css`
    :host {
      display: block;
      height: 100vh;
      height: 100dvh;
    }

    .shell {
      display: grid;
      grid-template-columns: 288px 1fr;
      height: 100%;
    }

    .sign-out {
      position: fixed;
      left: 0.75rem;
      bottom: 0.6rem;
      border: 0;
      background: none;
      color: inherit;
      opacity: 0.28;
      cursor: pointer;
      z-index: 3;
    }

    .sign-out:hover {
      opacity: 0.75;
    }

    .auth-shell {
      min-height: 100vh;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      box-sizing: border-box;
    }

    .auth-card {
      width: min(22rem, 100%);
      text-align: center;
    }

    .auth-mark {
      width: 2.4rem;
      color: #4d7a5a;
    }

    .auth-card h1 {
      margin: 0.65rem 0 0;
      font-size: 1.15rem;
      font-weight: 600;
    }

    .auth-note,
    .auth-card > p {
      opacity: 0.55;
      font-size: 0.86rem;
    }

    .auth-card form {
      display: grid;
      gap: 0.9rem;
      margin-top: 1.4rem;
      text-align: left;
    }

    .auth-card label {
      display: grid;
      gap: 0.35rem;
      font-size: 0.75rem;
      opacity: 0.8;
    }

    .auth-card input {
      border: 1px solid rgba(125, 115, 95, 0.24);
      border-radius: 8px;
      padding: 0.65rem 0.7rem;
      background: rgba(125, 115, 95, 0.05);
      color: inherit;
    }

    .auth-card button[type='submit'] {
      border: 0;
      border-radius: 8px;
      padding: 0.72rem;
      background: #4d7a5a;
      color: white;
      cursor: pointer;
    }

    .auth-card button[disabled] {
      opacity: 0.55;
      cursor: wait;
    }

    .auth-error {
      color: #a3402f;
      font-size: 0.8rem;
      margin: 0;
    }

    aside {
      border-right: 1px solid rgba(125, 115, 95, 0.16);
      background: rgba(125, 115, 95, 0.05);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    aside header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 1.1rem 1rem 0.7rem;
      position: sticky;
      top: 0;
    }

    aside h1 {
      margin: 0;
      color: #4d7a5a;
      line-height: 0;
    }

    aside h1 svg {
      width: 24px;
      height: 24px;
    }

    :host-context([data-theme='dark']) aside h1 {
      color: #7fae8d;
    }

    .new-leaf {
      border: 0;
      background: none;
      color: inherit;
      opacity: 0.55;
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
      padding: 0 0.25rem;
    }

    .new-leaf:hover {
      opacity: 1;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0 0.5rem 1rem;
    }

    .row {
      display: block;
      width: 100%;
      text-align: left;
      border: 0;
      background: none;
      color: inherit;
      cursor: pointer;
      padding: 0.6rem 0.65rem;
      border-radius: 8px;
    }

    .row.selected {
      background: rgba(125, 115, 95, 0.14);
    }

    .row-title {
      display: block;
      font-size: 0.87rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row-meta {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      margin-top: 0.15rem;
    }

    .row-time {
      font-size: 0.72rem;
      opacity: 0.5;
      flex: none;
    }

    .row-snippet {
      font-size: 0.78rem;
      opacity: 0.6;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .empty-list,
    .load-error {
      padding: 0 1rem;
      font-size: 0.8rem;
      opacity: 0.6;
    }

    .load-error {
      color: #a3402f;
      opacity: 1;
    }

    main {
      overflow-y: auto;
      position: relative;
    }

    .editor-bar {
      position: sticky;
      top: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.55rem 1rem 0;
      z-index: 2;
    }

    .back {
      display: none;
      border: 0;
      background: none;
      color: inherit;
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
      opacity: 0.6;
      padding: 0 0.4rem;
    }

    .save-state {
      margin-left: auto;
      font-family: ui-monospace, monospace;
      font-size: 0.8rem;
      opacity: 0.45;
    }

    .save-state[data-state='error'] {
      color: #a3402f;
      opacity: 1;
    }

    .page {
      max-width: 42rem;
      margin: 0 auto;
      padding: 1.25rem 1.25rem 6rem;
    }

    hoja-editor {
      display: block;
      min-height: 70vh;
    }

    .blank {
      height: 100%;
      display: grid;
      place-items: center;
      opacity: 0.4;
      font-style: italic;
    }

    @media (max-width: 719px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .shell main {
        display: none;
      }

      .shell.editor-open aside {
        display: none;
      }

      .shell.editor-open main {
        display: block;
      }

      .back {
        display: block;
      }
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'hoja-app': HojaApp
  }
}
