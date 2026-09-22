/**
 * Runtime-owned Mermaid renderer for the pure editor-kernel code-block seam.
 *
 * This module is the only editor path that imports Mermaid. It owns renderer
 * initialization, token-derived theming, an LRU SVG cache, in-flight
 * de-duplication, strict SVG admission, and theme invalidation. The kernel sees
 * only `MermaidRenderHost` callbacks and DOM outcomes.
 */
import type {
  MermaidRenderCurrentCheck,
  MermaidRenderHost,
} from '@shrubbery/editor-kernel'

export interface MermaidRenderResult {
  readonly svg: string
  readonly bindFunctions?: (element: Element) => void
}

export interface MermaidEngine {
  initialize(config: Record<string, unknown>): void
  render(id: string, source: string): Promise<MermaidRenderResult>
}

export interface MermaidRendererOptions {
  readonly loadEngine?: () => Promise<MermaidEngine>
  readonly root?: HTMLElement | (() => HTMLElement | null)
  readonly cacheLimit?: number
}

export interface MermaidRenderController extends MermaidRenderHost {
  /** Explicit invalidation seam used by non-attribute theme systems and tests. */
  invalidate(): void
  /** Release the observer/listeners owned by this controller. */
  dispose(): void
}

const DEFAULT_CACHE_LIMIT = 24

function sourceKey(source: string): string {
  return source.replace(/\r\n?/g, '\n').trim()
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback
}

function resolveRoot(option: MermaidRendererOptions['root']): HTMLElement | null {
  if (typeof option === 'function') return option()
  if (option) return option
  return typeof document === 'undefined' ? null : document.documentElement
}

/** Garden's semantic-token → Mermaid theme adapter, without a theme-store import. */
export function buildMermaidThemeVariables(root: HTMLElement | null): Record<string, unknown> {
  const dark = root?.getAttribute('data-theme') === 'dark'
  const styles = root ? getComputedStyle(root) : null
  const read = (name: string, fallback: string) =>
    styles ? readVar(styles, name, fallback) : fallback

  const textPrimary = read('--mn-color-text-primary', dark ? '#f7f5f0' : '#262522')
  const textSecondary = read('--mn-color-text-secondary', dark ? '#a8a49d' : '#5c5954')
  const surfaceRaised = read('--mn-color-surface-raised', dark ? '#1d1b1a' : '#ffffff')
  const borderDefault = read('--mn-color-border-default', dark ? '#383532' : '#e0ddd6')
  const borderStrong = read('--mn-color-border-strong', dark ? '#4a4744' : '#d1cec7')
  const previewBackground = read(
    '--mn-color-surface-elevated',
    read('--mn-color-neutral-50', dark ? '#1d1b1a' : '#f2f0eb'),
  )
  const fontFamily = read('--mn-font-sans', "'Literata', Georgia, serif")
  const fill = dark
    ? read('--mn-color-surface-accent', 'rgba(74, 139, 111, 0.12)')
    : read('--mn-color-surface-accent', '#f1f8f4')
  const border = dark
    ? read('--mn-color-border-accent', '#6fa588')
    : read('--mn-color-border-accent', '#39725a')
  const line = dark
    ? read('--mn-color-text-accent', '#6fa588')
    : read('--mn-color-text-accent-strong', '#2e5948')
  const secondaryFill = dark
    ? read('--mn-color-neutral-100', '#2b2926')
    : read('--mn-color-surface-accent', '#b2d1c1')

  return {
    darkMode: dark,
    primaryColor: fill,
    primaryBorderColor: border,
    primaryTextColor: textPrimary,
    secondaryColor: secondaryFill,
    secondaryTextColor: textPrimary,
    secondaryBorderColor: dark ? borderStrong : line,
    tertiaryColor: surfaceRaised,
    tertiaryTextColor: textSecondary,
    tertiaryBorderColor: borderStrong,
    lineColor: line,
    textColor: textPrimary,
    background: previewBackground,
    mainBkg: fill,
    nodeBkg: fill,
    nodeBorder: border,
    clusterBkg: surfaceRaised,
    clusterBorder: borderDefault,
    actorBorder: border,
    actorBkg: fill,
    actorTextColor: textPrimary,
    actorLineColor: line,
    signalColor: line,
    signalTextColor: textPrimary,
    labelBoxBkgColor: fill,
    labelBoxBorderColor: border,
    labelTextColor: textPrimary,
    loopTextColor: textPrimary,
    noteBkgColor: dark ? 'rgba(245, 158, 11, 0.16)' : read('--mn-color-accent-100', '#fef3c7'),
    noteBorderColor: read('--mn-color-accent-500', '#f59e0b'),
    noteTextColor: textPrimary,
    edgeLabelBackground: previewBackground,
    fontFamily,
    fontSize: '14px',
  }
}

function engineConfig(root: HTMLElement | null): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    secure: ['securityLevel', 'startOnLoad'],
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: buildMermaidThemeVariables(root),
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  }
}

function replaceMessage(preview: HTMLElement, className: string, message: string): void {
  const element = document.createElement('div')
  element.className = className
  element.textContent = message
  preview.replaceChildren(element)
}

function removeMessages(preview: HTMLElement): void {
  for (const child of Array.from(preview.children)) {
    if (
      child.classList.contains('mermaid-empty') ||
      child.classList.contains('mermaid-loading') ||
      child.classList.contains('mermaid-error')
    ) {
      child.remove()
    }
  }
}

function appendError(preview: HTMLElement, message: string): void {
  removeMessages(preview)
  const element = document.createElement('div')
  element.className = 'mermaid-error'
  element.textContent = message
  preview.appendChild(element)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Unable to render Mermaid diagram.'
}

function hasDangerousUrl(value: string): boolean {
  return /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i.test(value)
}

/**
 * Admit exactly one SVG root and strip executable SVG features defensively.
 * Mermaid also runs with `securityLevel: strict`; this is the DOM boundary's
 * independent invariant before any renderer output enters the document.
 */
export function parseSafeMermaidSvg(svg: string): SVGSVGElement | null {
  const container = document.createElement('div')
  container.innerHTML = svg.trim()
  const root = container.firstElementChild
  if (!root || root.tagName.toLowerCase() !== 'svg' || container.children.length !== 1) return null

  root.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((element) => element.remove())
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && hasDangerousUrl(attribute.value))) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  root.setAttribute('role', 'img')
  return root as SVGSVGElement
}

export function applyMermaidSvg(preview: HTMLElement, key: string, svg: string): boolean {
  const nextSvg = parseSafeMermaidSvg(svg)
  if (!nextSvg) {
    replaceMessage(preview, 'mermaid-error', 'Unable to render Mermaid diagram.')
    return false
  }

  const currentSvg = preview.querySelector('svg')
  removeMessages(preview)
  if (currentSvg) {
    for (const attribute of Array.from(currentSvg.attributes)) currentSvg.removeAttribute(attribute.name)
    for (const attribute of Array.from(nextSvg.attributes)) {
      currentSvg.setAttribute(attribute.name, attribute.value)
    }
    currentSvg.replaceChildren(...Array.from(nextSvg.childNodes))
  } else {
    preview.replaceChildren(nextSvg)
  }
  preview.dataset.mermaidRenderKey = key
  return true
}

async function loadDefaultEngine(): Promise<MermaidEngine> {
  const module = await import('mermaid')
  return module.default as unknown as MermaidEngine
}

function themeSignature(root: HTMLElement | null): string {
  if (!root) return ''
  return [
    root.getAttribute('data-theme') ?? '',
    root.getAttribute('data-skin') ?? '',
    root.getAttribute('data-design') ?? '',
  ].join('|')
}

export function makeMermaidRenderHost(options: MermaidRendererOptions = {}): MermaidRenderController {
  const loadEngine = options.loadEngine ?? loadDefaultEngine
  const cacheLimit = options.cacheLimit ?? DEFAULT_CACHE_LIMIT
  const cache = new Map<string, string>()
  const inflight = new Map<string, Promise<MermaidRenderResult>>()
  const listeners = new Set<() => void>()
  let enginePromise: Promise<MermaidEngine> | null = null
  let engine: MermaidEngine | null = null
  let epoch = 0
  let sequence = 0
  let observer: MutationObserver | null = null
  let observedSignature = themeSignature(resolveRoot(options.root))

  const initialize = (value: MermaidEngine) => {
    value.initialize(engineConfig(resolveRoot(options.root)))
  }

  const getEngine = (): Promise<MermaidEngine> => {
    if (!enginePromise) {
      enginePromise = loadEngine().then((value) => {
        engine = value
        initialize(value)
        return value
      })
    }
    return enginePromise
  }

  const cacheSvg = (key: string, svg: string) => {
    if (!key || !svg) return
    cache.delete(key)
    cache.set(key, svg)
    while (cache.size > cacheLimit) {
      const oldest = cache.keys().next().value
      if (typeof oldest !== 'string') break
      cache.delete(oldest)
    }
  }

  const renderSvg = (source: string, key: string): Promise<MermaidRenderResult> => {
    const existing = inflight.get(key)
    if (existing) return existing
    const startEpoch = epoch
    const promise = getEngine().then(async (value) => {
      const result = await value.render(`sh-mermaid-${Date.now()}-${++sequence}`, source)
      if (startEpoch === epoch) cacheSvg(key, result.svg)
      return result
    })
    inflight.set(key, promise)
    void promise.finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key)
    }).catch(() => {})
    return promise
  }

  const controller: MermaidRenderController = {
    async render(source, preview, isCurrent: MermaidRenderCurrentCheck) {
      const key = sourceKey(source)
      preview.setAttribute('aria-busy', 'true')

      if (!key) {
        preview.removeAttribute('aria-busy')
        replaceMessage(preview, 'mermaid-empty', 'Add Mermaid source to render a diagram.')
        preview.dataset.mermaidRenderKey = key
        return true
      }

      if (preview.dataset.mermaidRenderKey === key && preview.querySelector('svg')) {
        preview.removeAttribute('aria-busy')
        return true
      }

      const cached = cache.get(key)
      if (cached && applyMermaidSvg(preview, key, cached)) {
        preview.removeAttribute('aria-busy')
        return true
      }

      const hadSvg = preview.querySelector('svg') !== null
      if (hadSvg) removeMessages(preview)
      else replaceMessage(preview, 'mermaid-loading', 'Rendering diagram...')

      try {
        const result = await renderSvg(source, key)
        if (!isCurrent()) return false
        if (!applyMermaidSvg(preview, key, result.svg)) return false
        result.bindFunctions?.(preview)
        return true
      } catch (error) {
        if (!isCurrent()) return false
        if (preview.querySelector('svg')) appendError(preview, errorMessage(error))
        else replaceMessage(preview, 'mermaid-error', errorMessage(error))
        return false
      } finally {
        if (isCurrent()) preview.removeAttribute('aria-busy')
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      const root = resolveRoot(options.root)
      if (!observer && root && typeof MutationObserver !== 'undefined') {
        observedSignature = themeSignature(root)
        observer = new MutationObserver(() => {
          const next = themeSignature(root)
          if (next === observedSignature) return
          observedSignature = next
          controller.invalidate()
        })
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['data-theme', 'data-skin', 'data-design'],
        })
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          observer?.disconnect()
          observer = null
        }
      }
    },

    invalidate() {
      epoch += 1
      cache.clear()
      inflight.clear()
      if (engine) initialize(engine)
      for (const listener of listeners) {
        try {
          listener()
        } catch {
          // One detached/broken view must not prevent the remaining views.
        }
      }
    },

    dispose() {
      observer?.disconnect()
      observer = null
      listeners.clear()
      cache.clear()
      inflight.clear()
    },
  }

  return controller
}

/** Shared renderer: one engine import/cache/observer across all editor views. */
export const defaultMermaidRenderHost = makeMermaidRenderHost()
