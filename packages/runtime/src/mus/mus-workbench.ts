/**
 * `mountMusWorkbench` — Hoja's MUS mode with its verdict face, wired to the engine: the mount an app embeds.
 *
 *   import '@shrubbery/components/mus-verdict'            // registers <mn-mus-verdict> (components stays runtime-free)
 *   import { mountMusWorkbench } from '@shrubbery/runtime/mus'
 *
 *   const bench = mountMusWorkbench(host, {
 *     score,                                 // the MUS text
 *     title: 'Steel-string tour',            // optional heading and notes, as prose above the ```mus fence
 *     wasm: '/wasm/mus_wasm.wasm',           // same-origin; or `engine:` to share one engine between benches
 *     player: take => html`<mn-audio-player variant="single" .tracks=${[…]}></mn-audio-player>`,  // optional swap
 *     onTake: take => …,                     // a finished render: audio, WAV, receipt, energy trace
 *   })
 *   bench.dispose()
 *
 * What happens: a visitor edits the score in `<hoja-mus-editor>`; each edit is projected (exactly one ```mus fence),
 * checked in the engine's Worker after a short window, and the newest verdict is drawn into the fence (the token
 * underlined, a note at the end of its line) and listed in `<mn-mus-verdict>`. RENDER (enabled once the score checks
 * clean) renders it on its Ariadne World in the Worker, with progress, then plays it and shows the receipt's ledger.
 */
import { musPageDocument, type HojaMusEditor, type MusDiagnostic, type MusTake } from '@shrubbery/hoja/mus'
import '@shrubbery/hoja/mus'
import { createMusCheckController, type MusCheckController } from './mus-controller.js'
import { createMusWasmEngine, type MusWasmEngine } from './mus-engine.js'

/** `<mn-mus-verdict>`'s properties, structurally (the element lives in `@shrubbery/components`). */
interface VerdictElement extends HTMLElement {
  report: unknown
  current: boolean
  checking: boolean
  sourceError: string | null
  renderer: ((options: { signal: AbortSignal; onProgress: (p: unknown) => void }) => Promise<unknown>) | null
  player: ((take: never) => unknown) | null
  startRender(): Promise<unknown>
  cancel(): void
}

export interface MusWorkbenchOptions {
  readonly score: string
  readonly title?: string
  readonly notes?: string
  /** The engine's module (a same-origin URL or its bytes); one engine for this bench. */
  readonly wasm?: string | URL | ArrayBuffer
  /** Pin the module's SHA-256 (with `wasm`). */
  readonly sha256?: string
  /** An engine shared with other benches (takes precedence over `wasm`; not disposed with the bench). */
  readonly engine?: MusWasmEngine | Promise<MusWasmEngine>
  /** Swap the take player (default `<mn-mus-take-player>`). */
  readonly player?: (take: MusTake) => unknown
  readonly onTake?: (take: MusTake) => void
  /** Window between the last edit and the check. Default 250 ms. */
  readonly debounceMs?: number
  readonly label?: string
}

export interface MusWorkbench {
  readonly element: HTMLElement
  readonly editor: HojaMusEditor
  readonly verdict: VerdictElement
  readonly controller: MusCheckController
  readonly engine: Promise<MusWasmEngine>
  /** The score on screen (null when the page holds no single ```mus fence). */
  source(): string | null
  /** Render what is on screen now, as RENDER does. */
  render(): Promise<MusTake | null>
  dispose(): void
}

const STYLES = `
  .mus-workbench { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 16px; align-items: start; min-width: 0; }
  .mus-workbench > * { min-width: 0; }
  @media (max-width: 860px) { .mus-workbench { grid-template-columns: minmax(0, 1fr); } }
`
let sheet: CSSStyleSheet | null = null

function adopt(root: Node): void {
  if (typeof CSSStyleSheet === 'undefined' || typeof (CSSStyleSheet.prototype as { replaceSync?: unknown }).replaceSync !== 'function') return
  if (!sheet) {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(STYLES)
  }
  const r = root as Document | ShadowRoot
  if (r.adoptedStyleSheets && !r.adoptedStyleSheets.includes(sheet)) r.adoptedStyleSheets = [...r.adoptedStyleSheets, sheet]
}

export function mountMusWorkbench(host: HTMLElement, options: MusWorkbenchOptions): MusWorkbench {
  if (!customElements.get('mn-mus-verdict')) {
    throw new Error("mountMusWorkbench: <mn-mus-verdict> is not defined; import '@shrubbery/components/mus-verdict' first")
  }
  const ownEngine = !options.engine
  if (ownEngine && !options.wasm) throw new Error('mountMusWorkbench: pass `wasm` (the module URL) or a shared `engine`')
  const engine: Promise<MusWasmEngine> = options.engine
    ? Promise.resolve(options.engine)
    : createMusWasmEngine({ wasm: options.wasm!, sha256: options.sha256 })

  const element = document.createElement('div')
  element.className = 'mus-workbench'
  const editor = document.createElement('hoja-mus-editor') as HojaMusEditor
  editor.label = options.label ?? 'Score'
  editor.document = musPageDocument(options.score, { title: options.title, notes: options.notes })
  const verdict = document.createElement('mn-mus-verdict') as VerdictElement
  element.append(editor, verdict)
  host.append(element)
  adopt(element.getRootNode())

  const controller = createMusCheckController({ engine, debounceMs: options.debounceMs })
  let engineError: string | null = null
  let disposed = false

  const sync = (): void => {
    const s = controller.current()
    verdict.report = s.report
    verdict.current = s.current
    verdict.checking = s.checking || s.pending
    verdict.sourceError = s.sourceError ?? engineError ?? s.checkError
    if (s.report && s.checkedSource !== null) editor.setVerdict(s.checkedSource, s.report)
  }
  const unsubscribe = controller.subscribe(sync)

  const onSource = (event: Event): void => {
    const { source, error } = (event as CustomEvent<{ source: string | null; error: string | null }>).detail
    controller.update(source, error)
  }
  const onReveal = (event: Event): void => {
    editor.reveal((event as CustomEvent<{ diagnostic: MusDiagnostic }>).detail.diagnostic)
  }
  const onTake = (event: Event): void => {
    options.onTake?.((event as CustomEvent<{ take: MusTake }>).detail.take)
  }
  editor.addEventListener('mus-source-change', onSource)
  verdict.addEventListener('mn-mus-reveal', onReveal)
  verdict.addEventListener('mn-mus-take', onTake)
  if (options.player) verdict.player = options.player as VerdictElement['player']

  engine.then(
    e => {
      if (disposed) return
      verdict.renderer = ({ signal, onProgress }) => {
        const source = controller.current().source
        if (source === null) return Promise.reject(new Error('there is no score to render'))
        return e.render(source, { signal, onProgress: onProgress as never })
      }
    },
    error => {
      if (disposed) return
      engineError = `The MUS engine could not load: ${error instanceof Error ? error.message : String(error)}`
      sync()
    },
  )
  // The editor emits the first projection once it mounts; until then, project the options' score.
  controller.update(options.score)

  return {
    element,
    editor,
    verdict,
    controller,
    engine,
    source: () => editor.source ?? controller.current().source,
    render: () => verdict.startRender() as Promise<MusTake | null>,
    dispose() {
      if (disposed) return
      disposed = true
      verdict.cancel()
      unsubscribe()
      controller.dispose()
      editor.removeEventListener('mus-source-change', onSource)
      verdict.removeEventListener('mn-mus-reveal', onReveal)
      verdict.removeEventListener('mn-mus-take', onTake)
      element.remove()
      if (ownEngine) void engine.then(e => e.dispose(), () => {})
    },
  }
}
