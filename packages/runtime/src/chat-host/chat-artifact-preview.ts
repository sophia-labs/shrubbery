/**
 * <sh-chat-artifact-preview> — a written HTML artifact, live in the chat (the empowered-chat design §5, §10.4).
 *
 * When a turn creates or writes a `text/html` artifact, the panel asks the host for a preview under the
 * reply that last changed it. This element is that preview: the shell's own `<mn-artifact-view>` (the same
 * sandboxed frame and CSP as the center pane), fed by a shell-owned port that reads the artifact's bytes and
 * watches the workspace room, so the person watches it change as the agent rewrites it.
 *
 * "Live" means the agent rewrites the page and every open view updates; it never means a page that runs
 * code. Scripts are off here, always: `allowHtmlScripts` is false whatever a port or a view says.
 *
 * Its buttons stay in the chat: refresh asks the port to read again, download asks the port, and the
 * history button is the shell's "open the artifact's revisions" (a change link). None of the view's events
 * escape to the page, so the center pane's own artifact handlers never act on a chat preview.
 *
 * The element stamps `<mn-artifact-view>` by tag (the shell registers `@shrubbery/components`); this
 * package depends on nothing but lit.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

/** What the shell has read of one artifact. */
export interface ChatArtifactPreviewView {
  readonly status: 'loading' | 'ready' | 'error'
  readonly graphId: string
  readonly title: string | null
  readonly mimeType: string | null
  /** The committed HTML source; null when there is none to show. */
  readonly html: string | null
  /** Changes when the committed bytes change (the view keeps one frame per identity). */
  readonly identity: string | null
  readonly error?: string
}

/** One artifact, open in the chat: read it again, or let it go. */
export interface ChatArtifactPreviewHandle {
  refresh(): void
  close(): void
}

/** What the shell offers the chat to preview an artifact: read it, watch it, hand it over. */
export interface ChatArtifactPreviewPort {
  /** Start reading and watching one artifact; every new reading goes to `onChange`. */
  open(artifactId: string, onChange: (view: ChatArtifactPreviewView) => void): ChatArtifactPreviewHandle
  /** Hand the artifact's bytes to the person (the shell's download). Absent: the download does nothing. */
  download?(artifactId: string): void
}

const VIEW_EVENTS = [
  'mn-artifact-refresh',
  'mn-artifact-history-open',
  'mn-artifact-download',
  'mn-artifact-edit-open',
  'mn-artifact-open-document',
] as const

function isHtml(mimeType: string | null | undefined): boolean {
  return (mimeType ?? '').split(';', 1)[0]!.trim().toLowerCase() === 'text/html'
}

@customElement('sh-chat-artifact-preview')
export class ShChatArtifactPreview extends LitElement {
  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      height: clamp(220px, 42vh, 380px);
      max-width: 100%;
      overflow: hidden;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-base, #fff);
    }
    :host([hidden]) {
      display: none;
    }
    mn-artifact-view {
      display: block;
      height: 100%;
    }
  `

  /** The artifact to show. */
  @property({ type: String }) artifactId = ''
  /** A name to show until the shell has read one. */
  @property({ type: String }) title = ''
  /** The shell's port. Absent: nothing to show. */
  @property({ attribute: false }) port?: ChatArtifactPreviewPort
  /** The artifact's history button: the shell opens its revisions. */
  @property({ attribute: false }) onOpenRevisions?: (artifactId: string) => void

  @state() private view: ChatArtifactPreviewView | null = null

  private handle: ChatArtifactPreviewHandle | null = null
  private openFor: { readonly port: ChatArtifactPreviewPort; readonly artifactId: string } | null = null

  /** Heard at the shadow root, where the view's own events arrive before they could reach the page. */
  private readonly onViewEvent = (event: Event): void => {
    event.stopPropagation()
    switch (event.type) {
      case 'mn-artifact-refresh': this.handle?.refresh(); return
      case 'mn-artifact-history-open': this.onOpenRevisions?.(this.artifactId); return
      case 'mn-artifact-download': this.port?.download?.(this.artifactId); return
      default: return
    }
  }

  override connectedCallback(): void {
    super.connectedCallback()
    for (const type of VIEW_EVENTS) this.renderRoot.addEventListener(type, this.onViewEvent)
    this.reopen()
  }

  override disconnectedCallback(): void {
    for (const type of VIEW_EVENTS) this.renderRoot.removeEventListener(type, this.onViewEvent)
    this.release()
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('port') || changed.has('artifactId')) this.reopen()
  }

  protected override updated(): void {
    const hide = this.view?.status === 'ready' && this.view.mimeType !== null && !isHtml(this.view.mimeType)
    this.toggleAttribute('hidden', hide)
  }

  private reopen(): void {
    if (!this.isConnected) return
    const port = this.port
    const artifactId = this.artifactId.trim()
    if (this.openFor && this.openFor.port === port && this.openFor.artifactId === artifactId) return
    this.release()
    if (!port || !artifactId) return
    const openFor = { port, artifactId }
    this.openFor = openFor
    try {
      this.handle = port.open(artifactId, view => {
        if (this.openFor !== openFor) return
        this.view = view
      })
    } catch (error) {
      this.view = {
        status: 'error', graphId: '', title: null, mimeType: null, html: null, identity: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private release(): void {
    const handle = this.handle
    this.handle = null
    this.openFor = null
    this.view = null
    try {
      handle?.close()
    } catch {
      // Letting go never fails the chat.
    }
  }

  override render(): TemplateResult | typeof nothing {
    const view = this.view
    if (!view) return nothing
    if (view.status === 'ready' && view.mimeType !== null && !isHtml(view.mimeType)) return nothing
    return html`<mn-artifact-view
      .graphId=${view.graphId}
      .artifactId=${this.artifactId}
      .title=${view.title ?? this.title}
      .mimeType=${view.mimeType ?? 'text/html'}
      .previewHtml=${view.html}
      .previewIdentity=${view.identity}
      .allowHtmlScripts=${false}
      .status=${view.status}
      .error=${view.error ?? ''}
    ></mn-artifact-view>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-chat-artifact-preview': ShChatArtifactPreview
  }
}
