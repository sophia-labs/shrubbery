/**
 * Runtime-owned KaTeX renderer for the pure editor-kernel math seam
 * (`KernelOptions.renderMath`). The kernel deliberately severed its KaTeX
 * coupling and falls back to raw LaTeX text; until now no host supplied a
 * renderer, so every Shrubbery editor showed `\sigma_m/\sigma_1` verbatim.
 *
 * Output is MathML (`output: 'mathml'`): browsers render it natively, so no
 * KaTeX stylesheet or font has to reach inside `sh-editor-host`'s shadow root.
 * KaTeX is imported lazily so a document without math never loads it.
 * `throwOnError: false` renders a bad expression as KaTeX's own error span
 * (source kept visible) instead of breaking the node view.
 */
import { type MathRenderer, watchScrollEdges } from '@shrubbery/editor-kernel'

type Katex = { renderToString(src: string, opts: Record<string, unknown>): string }
let katexPromise: Promise<Katex> | null = null
const loadKatex = (): Promise<Katex> => (katexPromise ??= import('katex').then(m => ((m as { default?: Katex }).default ?? (m as unknown as Katex))))

/** Display math narrower than this share of its natural width scrolls instead of shrinking. */
export const MATH_MIN_SCALE = 0.8

/**
 * Keep display math inside its column (the §1 commutator ran off the phone
 * screen): when the formula overflows by a little (scale ≥ MATH_MIN_SCALE) it
 * is scaled down through font-size — KaTeX MathML scales with the font; when it
 * overflows by more, it keeps its size and the block scrolls horizontally
 * (watchScrollEdges marks the overflowing side, which the kernel's
 * scroll-edge stylesheet fades out). Returns the applied scale.
 */
export function fitDisplayMath(target: HTMLElement): number {
  target.style.removeProperty('font-size')
  target.removeAttribute('data-math-overflow')
  const available = target.clientWidth
  const natural = target.scrollWidth
  if (!available || natural <= available + 1) return 1
  const scale = available / natural
  if (scale >= MATH_MIN_SCALE) {
    target.style.fontSize = `${(scale * 100).toFixed(2)}%`
    return scale
  }
  target.setAttribute('data-math-overflow', '')
  return 1
}

let mathObserver: ResizeObserver | null = null
const observed = new Set<HTMLElement>()
function watchDisplayMath(target: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return
  mathObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const element = entry.target as HTMLElement
      if (!element.isConnected) {
        mathObserver?.unobserve(element)
        observed.delete(element)
        continue
      }
      fitDisplayMath(element)
    }
  })
  if (!observed.has(target)) {
    observed.add(target)
    mathObserver.observe(target)
  }
}

export const katexMathRenderer: MathRenderer = async (target, request) => {
  const katex = await loadKatex()
  // renderToString (not render): KaTeX's DOM entry refuses quirks-mode documents;
  // the string path has no such check and is the same trusted KaTeX output (trust: false).
  target.innerHTML = katex.renderToString(request.src, {
    displayMode: request.displayMode,
    output: 'mathml',
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  })
  if (request.displayMode) {
    fitDisplayMath(target)
    watchDisplayMath(target)
    // A formula too wide to shrink scrolls; its overflowing side fades out.
    watchScrollEdges(target)
  }
}
