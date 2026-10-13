/** CodeMirror attached to Garden's existing codeBlock XmlText, never a second body. */
import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import * as Y from 'yjs'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, hoverTooltip } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { autocompletion, completionKeymap, type Completion } from '@codemirror/autocomplete'
import { linter, lintGutter } from '@codemirror/lint'
import { foldGutter, bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { yCollab, yUndoManagerKeymap, ySyncFacet } from 'y-codemirror.next'
import type { ProviderHandle, DevelopmentEditorTools } from '@shrubbery/nucleus'

/** Resolves identity, not ordinal position. Missing/ambiguous structures fail closed. */
export function gardenCodeText(doc: Y.Doc, blockId: string): Y.XmlText {
  const matches: Y.XmlElement[] = []
  const visit = (node: Y.XmlFragment): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      if ((child.getAttribute('data-block-id') ?? child.getAttribute('blockId')) === blockId) matches.push(child)
      visit(child)
    }
  }
  visit(doc.getXmlFragment('content'))
  if (matches.length !== 1) throw new Error(`Expected one Garden block ${blockId}; found ${matches.length}.`)
  const block = matches[0]!
  if (block.nodeName !== 'codeBlock') throw new Error(`Garden block ${blockId} is ${block.nodeName}, not a codeBlock.`)
  const children = block.toArray()
  if (children.length !== 1 || !(children[0] instanceof Y.XmlText)) {
    throw new Error(`Garden codeBlock ${blockId} must contain one shared XmlText. Reopen after the document schema is repaired.`)
  }
  const text = children[0]
  if (text.toDelta().some((part: { insert?: unknown; attributes?: Record<string, unknown> }) => typeof part.insert !== 'string' || Object.keys(part.attributes ?? {}).length > 0)) {
    throw new Error(`Garden codeBlock ${blockId} contains rich-text marks or embeds; source editing is unavailable.`)
  }
  if (gardenCodeSource(text).includes('\r')) {
    throw new Error(`Garden codeBlock ${blockId} needs the workspace's explicit LF newline policy before source editing.`)
  }
  return text
}

export function gardenCodeSource(text: Y.XmlText): string {
  return text.toDelta().map((part: { insert: string }) => part.insert).join('')
}

@customElement('sh-development-code-editor')
export class ShDevelopmentCodeEditor extends LitElement {
  static styles = css`
    :host { display:block; min-width:0; }
    .editor { min-height:120px; border:1px solid var(--mn-color-border-subtle,#dadfd9); border-radius:6px; overflow:hidden; }
    .status { display:flex; justify-content:space-between; gap:8px; font:11px system-ui,sans-serif; color:var(--mn-color-text-tertiary,#647064); padding:5px 0; }
    .error { color:var(--mn-color-danger,#a33333); }
    :host([fill]) { height:100%; display:flex; flex-direction:column; min-height:0; }
    :host([fill]) .editor { flex:1; min-height:0; border:0; border-radius:0; }
    :host([fill]) .editor .cm-editor { height:100%; }
    :host([fill]) .status { flex-shrink:0; padding:5px 10px; }
  `
  @property({ attribute: false }) provider: ProviderHandle | null = null
  @property({ type: String }) blockId = ''
  @property({ type: String }) language = ''
  @property({ type: String }) label = 'Shared source'
  @property({ type:Boolean,reflect:true }) fill = false
  @property({ attribute:false }) tools:DevelopmentEditorTools|null = null
  @property({ attribute:false }) reveal:{readonly offset:number;readonly token:number}|null = null
  @state() private connection = 'Opening shared document…'
  @state() private error = ''
  @state() private editable = false
  /** Read-only handle for integration tests and editor command dispatch. */
  get editorView(): EditorView | null { return this.view }
  private view: EditorView | null = null
  private text: Y.XmlText | null = null
  private undoManager: Y.UndoManager | null = null
  private editing = new Compartment()
  private languageTools = new Compartment()
  private epoch = 0
  private cleanups: (() => void)[] = []

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('provider') || changed.has('blockId') || changed.has('language')) void this.connect()
    else if (changed.has('tools')) this.view?.dispatch({effects:this.languageTools.reconfigure(this.toolExtensions())})
    if (changed.has('reveal')) this.revealSelection()
  }
  connectedCallback(): void {
    super.connectedCallback()
    if (this.hasUpdated) void this.updateComplete.then(() => this.connect())
  }
  disconnectedCallback(): void { this.close(); super.disconnectedCallback() }

  private revealSelection():void {
    if (!this.view || !this.reveal) return
    const offset = Math.min(Math.max(this.reveal.offset,0),this.view.state.doc.length)
    this.view.dispatch({selection:{anchor:offset},effects:EditorView.scrollIntoView(offset,{y:'center'})})
    this.view.focus()
  }
  private toolExtensions():Extension[] {
    if (!this.tools) return []
    const command = (action:'definitions'|'references'|'format'|'rename') => (view:EditorView):boolean => {
      this.tools?.command(action,{source:view.state.doc.toString(),offset:view.state.selection.main.head}); return true
    }
    return [
      keymap.of([{key:'F12',run:command('definitions')},{key:'Shift-F12',run:command('references')},{key:'F2',run:command('rename')},{key:'Alt-Shift-f',run:command('format')},...completionKeymap]),
      autocompletion({override:[async context => {
        const source = context.state.doc.toString()
        const word = context.matchBefore(/[\w$]+/)
        if (!context.explicit && !word && source[context.pos-1] !== '.') return null
        try {
          const entries = await this.tools?.completions({source,offset:context.pos}) ?? []
          if (!this.view || this.view.state.doc.toString() !== source || context.aborted) return null
          return {from:word?.from ?? context.pos,validFor:/^[\w$]*$/,options:entries.map(entry => ({
            label:entry.name,detail:entry.kind,type:entry.kind === 'method' ? 'function' : ['function','class','interface','keyword','property','module'].includes(entry.kind) ? entry.kind : 'variable',
            apply:(view:EditorView,_completion:Completion,from:number,to:number) => {
              const start=entry.replacementSpan?.start??from,end=entry.replacementSpan?start+entry.replacementSpan.length:to
              if(start<0||end>view.state.doc.length||end<start)return
              const insert=entry.insertText??entry.name
              view.dispatch({changes:{from:start,to:end,insert},selection:{anchor:start+insert.length},userEvent:'input.complete'})
            },
          }))}
        } catch { return null }
      }]}),
      lintGutter(),linter(async view => {
        const source = view.state.doc.toString()
        try {
          const diagnostics = await this.tools?.diagnostics({source,offset:view.state.selection.main.head}) ?? []
          if (!this.view || this.view.state.doc.toString() !== source) return []
          return diagnostics.filter(item => item.from <= source.length).map(item => ({...item,to:Math.min(item.to,source.length)}))
        } catch { return [] }
      },{delay:650}),
      hoverTooltip(async (view,offset) => {
        const source = view.state.doc.toString()
        try {
          const result = await this.tools?.hover({source,offset})
          if (!result || !this.view || this.view.state.doc.toString() !== source) return null
          return {pos:result.from,end:result.to,above:true,create:() => {
            const dom = document.createElement('pre'); dom.textContent = result.text
            dom.style.cssText='max-width:600px;max-height:260px;overflow:auto;white-space:pre-wrap;padding:10px;margin:0;font:12px ui-monospace,monospace'
            return {dom}
          }}
        } catch { return null }
      }),
    ]
  }

  private destroyView(): void {
    // 0.3.5 creates an auxiliary manager in YSyncConfig even with an injected
    // undo manager. Release it as well as our attachment's manager on unmount.
    const auxiliary = this.view?.state.facet(ySyncFacet).undoManager
    this.view?.destroy()
    auxiliary?.destroy()
    this.undoManager?.destroy()
    this.view = null
    this.undoManager = null
    this.text = null
  }
  private close(): void {
    this.epoch++
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.destroyView()
    this.editable = false
  }
  private setEditable(editable: boolean): void {
    this.editable = editable
    this.view?.dispatch({ effects: this.editing.reconfigure([
      EditorState.readOnly.of(!editable), EditorView.editable.of(editable),
    ]) })
  }
  private async connect(): Promise<void> {
    this.close()
    this.error = ''
    const provider = this.provider
    if (!provider || !this.blockId || !this.isConnected) return
    const epoch = this.epoch
    let mayEdit = false
    let conflicted = false
    const updateConnection = (): void => {
      const state = provider.lifecycle.get()
      this.connection = `${state.connection}${state.synchronized ? ' · room synchronized' : ' · synchronizing'}`
    }
    updateConnection()
    this.cleanups.push(provider.lifecycle.subscribe(updateConnection))
    if (provider.activation) this.cleanups.push(provider.activation.subscribe(state => {
      conflicted = state.phase === 'conflict'
      this.setEditable(mayEdit && !conflicted)
      if (conflicted) this.error = `Document ${state.conflict ?? 'activation'} conflict. Editing paused.`
    }))
    try {
      await provider.whenRenderable
      if (epoch !== this.epoch || !this.isConnected) return
      const doc = provider.doc as Y.Doc
      const bind = (): void => {
        try {
          const text = gardenCodeText(doc, this.blockId)
          if (text === this.text) return
          this.destroyView()
          this.text = text
          this.undoManager = new Y.UndoManager(text, { trackedOrigins: new Set() })
          const extensions: Extension[] = [
            lineNumbers(), highlightActiveLine(),foldGutter(),bracketMatching(),highlightSelectionMatches(),syntaxHighlighting(defaultHighlightStyle),
            keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...searchKeymap, indentWithTab]),
            this.languageTools.of(this.toolExtensions()),
            EditorView.updateListener.of(update => {
              if (update.selectionSet || update.focusChanged) {
                const offset = update.state.selection.main.head
                const line = update.state.doc.lineAt(offset)
                this.tools?.selection?.(offset,line.number-1,offset-line.from)
              }
            }),
            this.editing.of([EditorState.readOnly.of(!this.editable), EditorView.editable.of(this.editable)]),
            EditorView.contentAttributes.of({ 'aria-label': this.label }),
            EditorView.theme({
              '&': { color: 'var(--mn-color-text-primary, #21302a)', backgroundColor: 'var(--mn-color-surface-base, #fff)', fontSize: '13px' },
              '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, monospace', padding: '12px 0', minHeight: '100px' },
              '.cm-gutters': { backgroundColor: 'var(--mn-color-panel-bg, #f4f6f3)', color: '#788477', border: 'none' },
              '.cm-scroller': { overflow: 'auto' },
              '.cm-activeLine': { backgroundColor: '#89a7850c' },
              '&.cm-focused': { outline: '2px solid var(--mn-color-accent, #52855a)', outlineOffset: '-2px' },
            }),
            yCollab(text, provider.awareness, { undoManager: this.undoManager }),
          ]
          if (this.language === 'python') extensions.push(python())
          if (['javascript', 'typescript', 'js', 'ts'].includes(this.language)) extensions.push(javascript({ typescript: ['typescript','ts'].includes(this.language) }))
          this.view = new EditorView({
            state: EditorState.create({ doc: gardenCodeSource(text), extensions }),
            parent: this.renderRoot.querySelector('.editor')!,
          })
          this.revealSelection()
          this.error = ''
        } catch (error) {
          this.destroyView()
          this.error = error instanceof Error ? error.message : String(error)
        }
      }
      bind()
      // Agent block replacement/deletion must never leave an editor on detached text.
      const onStructure = (): void => { queueMicrotask(() => { if (epoch === this.epoch) bind() }) }
      doc.getXmlFragment('content').observeDeep(onStructure)
      this.cleanups.push(() => doc.getXmlFragment('content').unobserveDeep(onStructure))
      await provider.whenEditable
      if (epoch !== this.epoch) return
      mayEdit = true
      this.setEditable(!conflicted)
    } catch (error) {
      if (epoch === this.epoch) this.error = error instanceof Error ? error.message : String(error)
    }
  }
  render() {
    return html`<div class="editor"></div><div class="status"><span role="status">${this.error ? html`<span class="error">${this.error}</span>` : this.connection}</span><span>${this.editable && this.view ? 'Shared editing' : 'Read only'}</span></div>`
  }
}

declare global { interface HTMLElementTagNameMap { 'sh-development-code-editor': ShDevelopmentCodeEditor } }
