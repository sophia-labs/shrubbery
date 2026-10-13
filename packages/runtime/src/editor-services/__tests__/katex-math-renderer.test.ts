import { describe, expect, it } from 'vitest'
import { katexMathRenderer } from '../katex-math-renderer.js'
import { buildKernelOptions } from '../assemble.js'

describe('katexMathRenderer — real KaTeX, MathML output (no stylesheet needed inside a shadow root)', () => {
  it('renders inline LaTeX as MathML, not raw source text', async () => {
    const target = document.createElement('span')
    await katexMathRenderer(target, { src: '\\sigma_m/\\sigma_1 < 0.5', displayMode: false })
    expect(target.querySelector('math')).not.toBeNull()
    // The TeX source survives only in MathML's <annotation>, which browsers never display.
    const visible = target.cloneNode(true) as HTMLElement
    visible.querySelectorAll('annotation').forEach(a => a.remove())
    expect(visible.textContent).toContain('σ')
    expect(visible.textContent).not.toContain('\\sigma')
  })

  it('renders display math as a block <math display="block">', async () => {
    const target = document.createElement('div')
    await katexMathRenderer(target, { src: '\\kappa \\le 2', displayMode: true })
    expect(target.querySelector('math')?.getAttribute('display')).toBe('block')
  })

  it('shows a KaTeX error in place rather than throwing on bad input', async () => {
    const target = document.createElement('span')
    await katexMathRenderer(target, { src: '\\frac{', displayMode: false })
    expect(target.textContent).toContain('\\frac{')
  })

  it('is what the production kernel options carry (organism main.ts builds through buildKernelOptions)', () => {
    const opts = buildKernelOptions({
      navigation: { openDocument() {}, openZoteroSource() {} },
    } as never, { graphId: 'g', documentId: 'd' } as never)
    expect(opts.renderMath).toBe(katexMathRenderer)
  })
})
