/** Pierre owns navigation; the host owns file identity, persistence and document leases. */
import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { FileTree, prepareFileTreeInput, type GitStatus, type GitStatusEntry } from '@pierre/trees'
import type { IdeFile, IdeGitStatus } from '@shrubbery/nucleus'

/** Git porcelain has two columns. Conflict details remain in the Changes panel. */
export function repositoryTreeGitStatus(status: string): GitStatus | null {
  if (status === '??') return 'untracked'
  if (status === '!!') return 'ignored'
  if (status.includes('U') || status === 'AA' || status === 'DD') return null
  if (status.includes('D')) return 'deleted'
  if (status.includes('R')) return 'renamed'
  if (status.includes('A') || status.includes('C')) return 'added'
  if (status.includes('M') || status.includes('T')) return 'modified'
  return null
}

@customElement('wf-repository-tree')
export class WfRepositoryTree extends LitElement {
  @property({ attribute: false }) files: readonly IdeFile[] = []
  @property({ attribute: false }) git: IdeGitStatus | null = null
  @property({ type: String }) riftId = ''
  @property({ type: String }) activeFileId = ''
  @property({ type: String }) filter = ''
  @property({ type: String }) directory = ''
  @state() private noMatches = false
  private tree: FileTree | null = null
  private paths = new Map<string, IdeFile>()
  private ids = new Map<string, IdeFile>()
  private shape = ''
  private updating = false
  private mountedRift = ''
  private statuses = new Map<string, string>()

  static styles = css`
    :host { display:block; min-height:0; height:100%; }
    .mount { height:100%; min-height:0; }
    .mount[hidden] { display:none; }
    .empty { margin:12px; color:var(--mn-color-text-tertiary,#69766a); font:12px var(--mn-font-chrome,system-ui,sans-serif); }
    .empty[hidden] { display:none; }
    file-tree-container {
      height:100%; display:block;
      --trees-bg-override:var(--mn-color-panel-bg,#f8faf6);
      --trees-fg-override:var(--mn-color-text-primary,#26372b);
      --trees-fg-muted-override:var(--mn-color-text-tertiary,#69766a);
      --trees-selected-bg-override:var(--mn-color-accent-subtle,#e3eddf);
      --trees-selected-fg-override:var(--mn-color-text-primary,#26372b);
      --trees-focus-ring-color-override:var(--mn-color-accent,#598263);
      --trees-accent-override:var(--mn-color-accent,#598263);
      --trees-border-color-override:var(--mn-color-border-subtle,#dce2da);
      --trees-font-family-override:var(--mn-font-chrome,system-ui,sans-serif);
      --trees-font-size-override:12px;
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    if (this.hasUpdated) this.requestUpdate()
  }
  disconnectedCallback(): void { this.dispose(); super.disconnectedCallback() }
  private dispose(): void {
    const updating = this.updating
    this.updating = true
    try {
      this.tree?.cleanUp()
      this.tree = null
      this.paths.clear()
      this.ids.clear()
      this.statuses.clear()
      this.shape = ''
      this.renderRoot.querySelector('.mount')?.replaceChildren()
    } finally { this.updating = updating }
  }

  protected updated(changed: PropertyValues<this>): void {
    if (!this.isConnected) return
    if (this.tree && this.mountedRift !== this.riftId) this.dispose()
    const fresh = !this.tree
    // Capture local tree selection by stable ID before paths change remotely.
    const selected = this.tree?.getSelectedPaths().map(path => ({ path, id: this.paths.get(path)?.fileId })) ?? []
    const focused = this.tree?.getFocusedPath()
    const focusedId = focused ? this.paths.get(focused)?.fileId : undefined
    this.paths = new Map(this.files.map(file => [file.path, file]))
    this.ids = new Map(this.files.map(file => [file.fileId, file]))
    this.statuses = new Map(this.files.map(file => [file.path, file.gitStatus]))
    for (const entry of this.git?.files ?? []) this.statuses.set(entry.path, entry.status)
    const shape = JSON.stringify(this.files.map(file => [file.fileId, file.path]))
    const shapeChanged = shape !== this.shape
    this.updating = true
    try {
      if (!this.tree) {
        this.mountedRift = this.riftId
        this.tree = new FileTree({
          preparedInput: prepareFileTreeInput(this.files.map(file => file.path)),
          flattenEmptyDirectories: true,
          initialExpandedPaths: ['apps/', 'packages/'],
          initialVisibleRowCount: 24,
          overscan: 8,
          density: 'compact',
          // These callbacks cannot await the authoritative asynchronous mutation API.
          renaming: false,
          dragAndDrop: false,
          search: false,
          fileTreeSearchMode: 'hide-non-matches',
          onSearchChange: value => {
            if (!this.updating && this.isConnected) this.dispatchEvent(new CustomEvent('repository-filter-change', {
              detail: { filter: value ?? '', riftId: this.riftId }, bubbles: true, composed: true,
            }))
          },
          onSelectionChange: paths => {
            if (this.updating || !this.isConnected || paths.length !== 1) return
            const path = paths.at(-1)
            const file = path ? this.paths.get(path) : undefined
            if (file) this.dispatchEvent(new CustomEvent('repository-file-open', {
              detail: { path: file.path, fileId: file.fileId, riftId: this.riftId }, bubbles: true, composed: true,
            }))
          },
          renderRowDecoration: ({ item }) => {
            const file = this.paths.get(item.path)
            if (!file) return null
            const status = this.statuses.get(item.path) ?? ''
            if (status.includes('U') || status === 'AA' || status === 'DD') return { text: '!', title: `Git conflict (${status}) — see Changes` }
            if (!file.editable) return { text: '◈', title: `${file.kind} · read-only artifact` }
            return null
          },
        })
        this.tree.render({ containerWrapper: this.renderRoot.querySelector<HTMLElement>('.mount')! })
        this.tree.getFileTreeContainer()?.shadowRoot?.querySelector('[role="tree"]')?.setAttribute('aria-label', 'Repository files')
      } else if (shapeChanged) {
        this.tree.resetPaths({ preparedInput: prepareFileTreeInput(this.files.map(file => file.path)) })
        for (const path of this.tree.getSelectedPaths()) this.tree.getItem(path)?.deselect()
        for (const prior of selected) {
          const path = prior.id ? this.ids.get(prior.id)?.path : prior.path
          if (path) this.tree.getItem(path)?.select()
        }
        const path = focusedId ? this.ids.get(focusedId)?.path : focused
        if (path) this.tree.focusPath(path)
      }
      this.shape = shape
      if (fresh || changed.has('files') || changed.has('git')) {
        const statuses: GitStatusEntry[] = []
        for (const [path, value] of this.statuses) {
          const status = repositoryTreeGitStatus(value)
          if (status) statuses.push({ path, status })
        }
        this.tree.setGitStatus(statuses)
      }
      // beta.6 resetPaths keeps the query but drops its visible projection.
      // Rebuild that projection after metadata arrives or a remote path changes.
      if (shapeChanged && !fresh) this.tree.setSearch(null)
      if (fresh || shapeChanged || changed.has('filter')) this.tree.setSearch(this.filter || null)
      // Upstream falls back to the unfiltered tree on zero matches. An IDE
      // filter must make absence explicit, especially after switching Rifts.
      this.noMatches = !!this.filter.trim() && this.tree.getSearchMatchingPaths().length === 0
      if ((fresh || changed.has('directory')) && this.directory) {
        const path = `${this.directory.replace(/\/$/, '')}/`
        const item = this.tree.getItem(path)
        if (item && 'expand' in item) item.expand()
        this.tree.scrollToPath(path, { focus: false })
      }
      if (fresh || shapeChanged || changed.has('activeFileId')) {
        const file = this.ids.get(this.activeFileId)
        if (file) {
          for (const path of this.tree.getSelectedPaths()) this.tree.getItem(path)?.deselect()
          this.tree.getItem(file.path)?.select()
          // A tab change reveals its file without stealing focus from CodeMirror.
          this.tree.scrollToPath(file.path, { focus: false })
        }
      }
    } finally { this.updating = false }
  }

  protected render() { return html`<div class="mount" ?hidden=${this.noMatches}></div><p class="empty" role="status" ?hidden=${!this.noMatches}>No matching files</p>` }
}

declare global { interface HTMLElementTagNameMap { 'wf-repository-tree': WfRepositoryTree } }
