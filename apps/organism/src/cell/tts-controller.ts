/**
 * Browser-owned document text-to-speech for the Organism shell.
 *
 * Garden can ask a backend to synthesize "classic" and "enhanced" voices. The
 * Shrubbery shell does not currently have that backend contract, so this
 * controller deliberately exposes only the honest browser-local tier. Playback
 * state is projected into the controlled `mn-tts-player`; this module owns the
 * SpeechSynthesis lifecycle, document block segmentation, and cleanup.
 */

import type {
  WorkspaceTtsActionDetail,
  WorkspaceTtsOptions,
} from '@shrubbery/runtime'

const PREFERENCES_KEY = 'shrubbery:tts-preferences'
const HIGHLIGHT_CLASS = 'tts-reading-highlight'
const HIGHLIGHT_STYLE_ATTRIBUTE = 'data-organism-tts-highlight'
const SPEEDS = Object.freeze([0.75, 1, 1.25, 1.5, 2] as const)
const LOCAL_TIERS = Object.freeze([
  Object.freeze({ value: 'local', label: 'Browser voice' }),
])

export interface TtsEditorHandle {
  getActiveBlockId(): string | null
}

export interface TtsEditorHost extends HTMLElement {
  readonly liveEditor?: TtsEditorHandle | null
}

export interface SpeechUtteranceLike {
  readonly text: string
  rate: number
  lang: string
  onstart: ((event?: Event) => void) | null
  onend: ((event?: Event) => void) | null
  onerror: ((event: { readonly error?: string }) => void) | null
  onpause?: ((event?: Event) => void) | null
  onresume?: ((event?: Event) => void) | null
}

export interface SpeechSynthesisLike {
  speak(utterance: SpeechUtteranceLike): void
  cancel(): void
  pause(): void
  resume(): void
}

export interface TtsControllerOptions {
  readonly requestRender: () => void
  readonly synthesis?: SpeechSynthesisLike | null
  readonly createUtterance?: ((text: string) => SpeechUtteranceLike) | null
  readonly storage?: Storage | null
  readonly document?: Document | null
}

export interface SpeechBlock {
  readonly id: string | null
  readonly text: string
  readonly element: HTMLElement | null
}

interface PersistedPreferences {
  readonly speed?: unknown
}

function browserSynthesis(): SpeechSynthesisLike | null {
  const candidate = globalThis.speechSynthesis
  return candidate ? candidate as unknown as SpeechSynthesisLike : null
}

function browserUtteranceFactory(): ((text: string) => SpeechUtteranceLike) | null {
  const Constructor = globalThis.SpeechSynthesisUtterance
  if (typeof Constructor !== 'function') return null
  return (text: string) => new Constructor(text) as unknown as SpeechUtteranceLike
}

function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'object' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

function loadSpeed(storage: Storage | null): number {
  if (!storage) return 1
  try {
    const parsed = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? 'null') as PersistedPreferences | null
    const speed = typeof parsed?.speed === 'number' ? parsed.speed : 1
    return SPEEDS.includes(speed as (typeof SPEEDS)[number]) ? speed : 1
  } catch {
    return 1
  }
}

function saveSpeed(storage: Storage | null, speed: number): void {
  if (!storage) return
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify({ tier: 'local', speed }))
  } catch {
    // A denied/quota-limited storage surface must not break playback.
  }
}

function blockText(element: HTMLElement): string {
  if (element.matches('pre, code, .code-block-wrapper, .mermaid-code-block-wrapper')) return ''
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll('pre, code, img, svg, button, [aria-hidden="true"]').forEach(node => node.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function cssAttributeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, ' ')
}

/**
 * Collect the editor's leaf semantic blocks in document order.
 *
 * List items/table cells may contain another `data-block-id` node. Selecting
 * leaves avoids speaking both a parent wrapper and its child text.
 */
export function collectSpeechBlocks(editorRoot: ParentNode | null): SpeechBlock[] {
  if (!editorRoot) return []
  const candidates = Array.from(editorRoot.querySelectorAll<HTMLElement>('[data-block-id]'))
  const candidateSet = new Set(candidates)
  const containers = new Set<HTMLElement>()
  for (const candidate of candidates) {
    let ancestor = candidate.parentElement?.closest<HTMLElement>('[data-block-id]') ?? null
    while (ancestor && candidateSet.has(ancestor)) {
      containers.add(ancestor)
      ancestor = ancestor.parentElement?.closest<HTMLElement>('[data-block-id]') ?? null
    }
  }
  const leaves = candidates.filter(candidate => !containers.has(candidate))
  return leaves
    .map(element => ({
      id: element.getAttribute('data-block-id'),
      text: blockText(element),
      element,
    }))
    .filter(block => block.text.length > 0)
}

function selectionText(doc: Document, editorRoot: HTMLElement): string | null {
  const selection = doc.getSelection?.()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  if (!anchor || !focus || !editorRoot.contains(anchor) || !editorRoot.contains(focus)) return null
  return selection.toString().replace(/\s+/g, ' ').trim() || null
}

function isEditableControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

export class OrganismTtsController {
  private readonly requestRender: () => void
  private readonly synthesis: SpeechSynthesisLike | null
  private readonly createUtterance: ((text: string) => SpeechUtteranceLike) | null
  private readonly storage: Storage | null
  private readonly doc: Document | null
  private editorHost: TtsEditorHost | null = null
  private graphId: string | null = null
  private documentId: string | null = null
  private blocks: SpeechBlock[] = []
  private currentUtterance: SpeechUtteranceLike | null = null
  private playbackSequence = 0
  private destroyed = false
  private renderQueued = false
  private status: WorkspaceTtsOptions['status'] = 'idle'
  private currentBlockIndex = 0
  private speed: number

  constructor(options: TtsControllerOptions) {
    this.requestRender = options.requestRender
    this.synthesis = options.synthesis === undefined ? browserSynthesis() : options.synthesis
    this.createUtterance = options.createUtterance === undefined
      ? browserUtteranceFactory()
      : options.createUtterance
    this.storage = options.storage === undefined ? browserStorage() : options.storage
    this.doc = options.document === undefined ? globalThis.document ?? null : options.document
    this.speed = loadSpeed(this.storage)
    this.doc?.addEventListener('keydown', this.onKeyDown, { capture: true })
  }

  get available(): boolean {
    return Boolean(this.synthesis && this.createUtterance)
  }

  setScope(graphId: string, documentId: string | null): void {
    if (this.graphId === graphId && this.documentId === documentId) return
    this.stop(false)
    this.graphId = graphId
    this.documentId = documentId
  }

  setEditorHost(host: TtsEditorHost | null): void {
    if (this.editorHost === host) return
    const wasActive = this.status !== 'idle'
    if (wasActive) this.stop(false)
    this.editorHost = host
    if (wasActive) this.scheduleRender()
  }

  snapshot(): WorkspaceTtsOptions {
    const current = this.blocks[this.currentBlockIndex]
    return {
      available: this.available,
      status: this.status,
      currentBlockIndex: this.currentBlockIndex,
      totalBlocks: this.blocks.length,
      currentBlockText: current?.text ?? '',
      tier: 'local',
      speed: this.speed,
      speeds: SPEEDS,
      tiers: LOCAL_TIERS,
      onAction: detail => this.handleAction(detail),
      onToolbarToggle: detail => this.toggleFromToolbar(detail.shiftKey),
    }
  }

  toggleFromToolbar(fromBeginning = false): void {
    if (this.status !== 'idle') {
      this.stop()
      return
    }
    this.start(fromBeginning)
  }

  start(fromBeginning = false): boolean {
    if (!this.available || !this.editorHost?.liveEditor || !this.documentId) return false
    const root = this.editorRoot()
    if (!root) return false

    this.stop(false)
    const selected = fromBeginning ? null : selectionText(this.doc ?? root.ownerDocument, root)
    if (selected) {
      this.blocks = [{ id: null, text: selected, element: null }]
      this.currentBlockIndex = 0
    } else {
      this.blocks = collectSpeechBlocks(root)
      if (this.blocks.length === 0) return false
      const activeBlockId = fromBeginning ? null : this.editorHost.liveEditor.getActiveBlockId()
      this.currentBlockIndex = activeBlockId ? this.indexForBlock(activeBlockId) : 0
    }
    this.playCurrent()
    return true
  }

  pause(): void {
    if (this.status !== 'playing' || !this.synthesis) return
    this.synthesis.pause()
    this.setStatus('paused')
  }

  resume(): void {
    if (this.status !== 'paused' || !this.synthesis) return
    this.synthesis.resume()
    this.setStatus('playing')
  }

  skipBack(): void {
    if (this.blocks.length === 0 || this.currentBlockIndex === 0) return
    this.cancelCurrent()
    this.currentBlockIndex -= 1
    this.playCurrent()
  }

  skipForward(): void {
    if (this.blocks.length === 0) return
    if (this.currentBlockIndex >= this.blocks.length - 1) {
      this.stop()
      return
    }
    this.cancelCurrent()
    this.currentBlockIndex += 1
    this.playCurrent()
  }

  setSpeed(speed: number): void {
    if (!SPEEDS.includes(speed as (typeof SPEEDS)[number]) || this.speed === speed) return
    this.speed = speed
    saveSpeed(this.storage, speed)
    if (this.status === 'idle') {
      this.scheduleRender()
      return
    }
    this.cancelCurrent()
    this.playCurrent()
  }

  stop(render = true): void {
    this.cancelCurrent()
    this.clearHighlight()
    const changed = this.status !== 'idle' || this.blocks.length > 0
    this.blocks = []
    this.currentBlockIndex = 0
    this.status = 'idle'
    if (render && changed) this.scheduleRender()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.doc?.removeEventListener('keydown', this.onKeyDown, { capture: true })
    this.stop(false)
    this.editorHost = null
  }

  private editorRoot(): HTMLElement | null {
    return this.editorHost?.shadowRoot?.querySelector<HTMLElement>('.ProseMirror') ?? null
  }

  private indexForBlock(activeBlockId: string): number {
    const direct = this.blocks.findIndex(block => block.id === activeBlockId)
    if (direct >= 0) return direct
    const root = this.editorRoot()
    const active = Array.from(root?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])
      .find(element => element.getAttribute('data-block-id') === activeBlockId)
    if (!active) return 0
    const related = this.blocks.findIndex(block =>
      Boolean(block.element && (block.element.contains(active) || active.contains(block.element))))
    return related >= 0 ? related : 0
  }

  private playCurrent(): void {
    const synthesis = this.synthesis
    const makeUtterance = this.createUtterance
    const block = this.blocks[this.currentBlockIndex]
    if (!synthesis || !makeUtterance || !block) {
      this.stop()
      return
    }

    const sequence = ++this.playbackSequence
    this.clearHighlight()
    this.highlight(block)
    block.element?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    this.status = 'loading'
    this.scheduleRender()

    try {
      const utterance = makeUtterance(block.text)
      utterance.rate = this.speed
      utterance.lang = 'en-US'
      utterance.onstart = () => {
        if (sequence !== this.playbackSequence) return
        this.setStatus('playing')
      }
      utterance.onpause = () => {
        if (sequence !== this.playbackSequence) return
        this.setStatus('paused')
      }
      utterance.onresume = () => {
        if (sequence !== this.playbackSequence) return
        this.setStatus('playing')
      }
      utterance.onend = () => {
        if (sequence !== this.playbackSequence) return
        this.currentUtterance = null
        if (this.currentBlockIndex >= this.blocks.length - 1) this.stop()
        else {
          this.currentBlockIndex += 1
          this.playCurrent()
        }
      }
      utterance.onerror = event => {
        if (sequence !== this.playbackSequence || event.error === 'canceled') return
        this.currentUtterance = null
        if (this.currentBlockIndex >= this.blocks.length - 1) this.stop()
        else {
          this.currentBlockIndex += 1
          this.playCurrent()
        }
      }
      this.currentUtterance = utterance
      synthesis.speak(utterance)
    } catch {
      if (sequence === this.playbackSequence) this.stop()
    }
  }

  private cancelCurrent(): void {
    ++this.playbackSequence
    if (this.currentUtterance || this.status !== 'idle') this.synthesis?.cancel()
    this.currentUtterance = null
  }

  private clearHighlight(): void {
    this.editorHost?.shadowRoot
      ?.querySelectorAll(`.${HIGHLIGHT_CLASS}`)
      .forEach(element => element.classList.remove(HIGHLIGHT_CLASS))
    this.editorHost?.shadowRoot
      ?.querySelectorAll(`[${HIGHLIGHT_STYLE_ATTRIBUTE}]`)
      .forEach(element => element.remove())
  }

  private highlight(block: SpeechBlock): void {
    block.element?.classList.add(HIGHLIGHT_CLASS)
    if (!block.id || !this.editorHost?.shadowRoot) return
    // ProseMirror is allowed to reconcile classes on managed block nodes. A
    // host-shadow style keyed by the durable block id keeps the visual cue
    // stable without mutating editor state or introducing a decoration plugin.
    const style = this.editorHost.ownerDocument.createElement('style')
    style.setAttribute(HIGHLIGHT_STYLE_ATTRIBUTE, '')
    style.textContent = `
      .editor-mount .ProseMirror [data-block-id="${cssAttributeValue(block.id)}"] {
        background: var(--mn-color-surface-accent-subtle, rgba(61, 127, 95, 0.14)) !important;
        box-shadow: inset 3px 0 0 var(--mn-color-border-accent, #3d7f5f) !important;
      }
    `
    this.editorHost.shadowRoot.append(style)
  }

  private setStatus(status: WorkspaceTtsOptions['status']): void {
    if (this.status === status) return
    this.status = status
    this.scheduleRender()
  }

  /** Coalesce shell renders and let the originating click/key event settle first. */
  private scheduleRender(): void {
    if (this.destroyed || this.renderQueued) return
    this.renderQueued = true
    queueMicrotask(() => {
      this.renderQueued = false
      if (!this.destroyed) this.requestRender()
    })
  }

  private handleAction(detail: WorkspaceTtsActionDetail): void {
    if (detail.action === 'play') this.start()
    else if (detail.action === 'pause') this.pause()
    else if (detail.action === 'resume') this.resume()
    else if (detail.action === 'stop') this.stop()
    else if (detail.action === 'skip-back') this.skipBack()
    else if (detail.action === 'skip-forward') this.skipForward()
    else if (detail.action === 'speed' && typeof detail.speed === 'number') this.setSpeed(detail.speed)
    // The only advertised tier is local. Ignore forged remote-tier intents.
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || isEditableControl(event.target) || !this.available) return
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.code !== 'KeyL' && event.key.toLowerCase() !== 'l') return
    if (!this.editorHost?.liveEditor || !this.documentId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.altKey) {
      this.stop()
    } else if (event.shiftKey) {
      if (this.status !== 'idle') this.stop(false)
      this.start(true)
    } else if (this.status === 'playing') {
      this.pause()
    } else if (this.status === 'paused') {
      this.resume()
    } else {
      this.start()
    }
  }
}
