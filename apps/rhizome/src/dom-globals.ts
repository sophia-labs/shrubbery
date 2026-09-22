/**
 * dom-globals.ts — install a happy-dom DOM onto Node's globalThis (server-side).
 *
 * The conneg server (server.ts) renders the `dom` face by driving the SAME render
 * path the browser + the smoke use: renderWorkspace + the lifted <rz-observatory>
 * (render-dom.ts). That path needs a real DOM (document, customElements, Lit's
 * reactive lifecycle). In the browser it's ambient; in vitest it's the happy-dom
 * environment. In a plain Node server it is absent — so we install it here, ONCE,
 * BEFORE the DOM render modules are imported (they call customElements.define at
 * module top).
 *
 * The mechanism is lifted verbatim from vitest's own happy-dom environment
 * (vitest/dist/chunks: getWindowKeys + populateGlobal): a GETTER-based define with
 * the KEYS allowlist + the `if (k in global) keysArray.includes(k)` filter. The
 * getter form (not a value-copy) is what avoids Node's getter-only globals
 * (navigator, and the lazy native DOMException property) — a blanket value-copy
 * crashes Node; this is the proven, version-matched recipe.
 *
 * Idempotent: a second call is a no-op (the flag on globalThis).
 *
 * IMPORTANT: import this and call installDom() BEFORE importing render-dom.ts /
 * @shrubbery/components / rz-observatory — they register custom elements eagerly.
 */

// The living-object + other keys vitest copies from a happy-dom window onto global
// (vitest@3 happy-dom env). Kept verbatim so the DOM surface matches the proven
// test environment exactly.
const LIVING_KEYS: readonly string[] = [
  'DOMException', 'URL', 'URLSearchParams', 'EventTarget', 'NamedNodeMap', 'Node', 'Attr',
  'Element', 'DocumentFragment', 'DOMImplementation', 'Document', 'XMLDocument', 'CharacterData',
  'Text', 'CDATASection', 'ProcessingInstruction', 'Comment', 'DocumentType', 'NodeList',
  'RadioNodeList', 'HTMLCollection', 'HTMLOptionsCollection', 'DOMStringMap', 'DOMTokenList',
  'StyleSheetList', 'HTMLElement', 'HTMLHeadElement', 'HTMLTitleElement', 'HTMLBaseElement',
  'HTMLLinkElement', 'HTMLMetaElement', 'HTMLStyleElement', 'HTMLBodyElement', 'HTMLHeadingElement',
  'HTMLParagraphElement', 'HTMLHRElement', 'HTMLPreElement', 'HTMLUListElement', 'HTMLOListElement',
  'HTMLLIElement', 'HTMLMenuElement', 'HTMLDListElement', 'HTMLDivElement', 'HTMLAnchorElement',
  'HTMLAreaElement', 'HTMLBRElement', 'HTMLButtonElement', 'HTMLCanvasElement', 'HTMLDataElement',
  'HTMLDataListElement', 'HTMLDetailsElement', 'HTMLDialogElement', 'HTMLDirectoryElement',
  'HTMLFieldSetElement', 'HTMLFontElement', 'HTMLFormElement', 'HTMLHtmlElement', 'HTMLImageElement',
  'HTMLInputElement', 'HTMLLabelElement', 'HTMLLegendElement', 'HTMLMapElement', 'HTMLMarqueeElement',
  'HTMLMediaElement', 'HTMLMeterElement', 'HTMLModElement', 'HTMLOptGroupElement', 'HTMLOptionElement',
  'HTMLOutputElement', 'HTMLPictureElement', 'HTMLProgressElement', 'HTMLQuoteElement',
  'HTMLScriptElement', 'HTMLSelectElement', 'HTMLSlotElement', 'HTMLSourceElement', 'HTMLSpanElement',
  'HTMLTableCaptionElement', 'HTMLTableCellElement', 'HTMLTableColElement', 'HTMLTableElement',
  'HTMLTimeElement', 'HTMLTableRowElement', 'HTMLTableSectionElement', 'HTMLTemplateElement',
  'HTMLTextAreaElement', 'HTMLUnknownElement', 'HTMLFrameElement', 'HTMLFrameSetElement',
  'HTMLIFrameElement', 'HTMLEmbedElement', 'HTMLObjectElement', 'HTMLParamElement', 'HTMLVideoElement',
  'HTMLAudioElement', 'HTMLTrackElement', 'HTMLFormControlsCollection', 'SVGElement',
  'SVGGraphicsElement', 'SVGSVGElement', 'SVGTitleElement', 'SVGAnimatedString', 'SVGNumber',
  'SVGStringList', 'Event', 'CloseEvent', 'CustomEvent', 'MessageEvent', 'ErrorEvent',
  'HashChangeEvent', 'PopStateEvent', 'StorageEvent', 'ProgressEvent', 'PageTransitionEvent',
  'SubmitEvent', 'UIEvent', 'FocusEvent', 'InputEvent', 'MouseEvent', 'KeyboardEvent', 'TouchEvent',
  'CompositionEvent', 'WheelEvent', 'BarProp', 'External', 'Location', 'History', 'Screen', 'Crypto',
  'Performance', 'Navigator', 'PluginArray', 'MimeTypeArray', 'Plugin', 'MimeType', 'FileReader',
  'Blob', 'File', 'FileList', 'ValidityState', 'DOMParser', 'XMLSerializer', 'FormData',
  'XMLHttpRequestEventTarget', 'XMLHttpRequestUpload', 'XMLHttpRequest', 'WebSocket', 'NodeFilter',
  'NodeIterator', 'TreeWalker', 'AbstractRange', 'Range', 'StaticRange', 'Selection', 'Storage',
  'CustomElementRegistry', 'ShadowRoot', 'MutationObserver', 'MutationRecord', 'Headers',
  'AbortController', 'AbortSignal', 'DOMRectReadOnly', 'DOMRect', 'Image', 'Audio', 'Option', 'CSS',
]

const OTHER_KEYS: readonly string[] = [
  'addEventListener', 'cancelAnimationFrame', 'dispatchEvent', 'document', 'getComputedStyle',
  'history', 'innerHeight', 'innerWidth', 'location', 'matchMedia', 'navigator', 'removeEventListener',
  'requestAnimationFrame', 'screen', 'self', 'Window', 'window', 'customElements',
]

const KEYS = [...LIVING_KEYS, ...OTHER_KEYS]
const SKIP_KEYS = ['window', 'self', 'top', 'parent']

const FLAG = '__rhizomeDomInstalled'

/**
 * Install a happy-dom DOM onto globalThis (idempotent). Returns true if it
 * installed (or was already installed). Mirrors vitest's populateGlobal: a getter
 * per allowlisted key, the `if (k in global) keysArray.includes(k)` filter, then
 * window/self/top/parent → global.
 */
export async function installDom(url = 'http://localhost'): Promise<void> {
  const g = globalThis as unknown as Record<string, unknown> & { [FLAG]?: boolean }
  if (g[FLAG]) return

  const hd = await import('happy-dom')
  const Ctor = (hd.GlobalWindow ?? hd.Window) as unknown as new (
    opts: { url?: string; settings?: { disableErrorCapturing?: boolean } },
  ) => Record<string, unknown>
  const win = new Ctor({ url, settings: { disableErrorCapturing: true } })
  win.Buffer = Buffer
  if (typeof structuredClone !== 'undefined' && !win.structuredClone) {
    win.structuredClone = structuredClone
  }

  // getWindowKeys: the allowlist ∪ the window's own props, minus skip keys, with
  // the "already on global ⇒ only if allowlisted" filter (skips Node's getter-only
  // globals like the lazy DOMException unless explicitly in KEYS).
  const keysArray = KEYS
  const winOwn = Object.getOwnPropertyNames(win)
  const keys = new Set<string>(
    [...keysArray, ...winOwn].filter((k) => {
      if (SKIP_KEYS.includes(k)) return false
      if (k in g) return keysArray.includes(k)
      return true
    }),
  )

  for (const key of keys) {
    const isClassLike = key[0] === key[0]?.toUpperCase()
    const fn = win[key]
    const bound = typeof fn === 'function' && !isClassLike ? (fn as (...a: unknown[]) => unknown).bind(win) : null
    try {
      Object.defineProperty(g, key, {
        configurable: true,
        get() {
          if (bound) return bound
          return win[key]
        },
        set(v: unknown) {
          win[key] = v
        },
      })
    } catch {
      // a non-configurable native getter (e.g. navigator on some Node builds) —
      // leave Node's; happy-dom's DOM surface doesn't need it for the render path.
    }
  }

  g.window = g
  g.self = g
  ;(g as { document?: { defaultView?: unknown } }).document &&
    Object.defineProperty((g as { document: object }).document, 'defaultView', {
      get: () => g,
      enumerable: true,
      configurable: true,
    })

  // Lit dev-mode: pre-seed the warning set so we don't spew on each render.
  ;(g as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set<string>()
  ;(g as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

  g[FLAG] = true
}
