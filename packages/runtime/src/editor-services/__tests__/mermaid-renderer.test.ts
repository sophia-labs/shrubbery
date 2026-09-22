import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyMermaidSvg,
  buildMermaidThemeVariables,
  makeMermaidRenderHost,
  parseSafeMermaidSvg,
  type MermaidEngine,
  type MermaidRenderController,
} from '../mermaid-renderer.js'

const controllers: MermaidRenderController[] = []

afterEach(() => {
  for (const controller of controllers) controller.dispose()
  controllers.length = 0
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-skin')
  document.documentElement.removeAttribute('style')
})

function engine(result = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>') {
  return {
    initialize: vi.fn<MermaidEngine['initialize']>(),
    render: vi.fn<MermaidEngine['render']>().mockResolvedValue({ svg: result }),
  } satisfies MermaidEngine
}

function hostFor(value: MermaidEngine) {
  const controller = makeMermaidRenderHost({ loadEngine: async () => value })
  controllers.push(controller)
  return controller
}

describe('runtime Mermaid renderer — production host seam', () => {
  it('initializes Mermaid with the strict Garden security/layout contract', async () => {
    const value = engine()
    const host = hostFor(value)
    const preview = document.createElement('div')
    expect(await host.render('graph TD; A-->B', preview, () => true)).toBe(true)

    expect(value.initialize).toHaveBeenCalledOnce()
    expect(value.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      flowchart: { htmlLabels: false, useMaxWidth: true },
    }))
    expect(value.render).toHaveBeenCalledWith(expect.stringMatching(/^sh-mermaid-/), 'graph TD; A-->B')
    expect(preview.querySelector('svg')?.getAttribute('role')).toBe('img')
    expect(preview.dataset.mermaidRenderKey).toBe('graph TD; A-->B')
    expect(preview.hasAttribute('aria-busy')).toBe(false)
  })

  it('derives light/dark colors from the live semantic token root', () => {
    const root = document.documentElement
    root.setAttribute('data-theme', 'dark')
    root.style.setProperty('--mn-color-text-primary', '#fafafa')
    root.style.setProperty('--mn-color-border-accent', '#77aa99')
    const variables = buildMermaidThemeVariables(root)
    expect(variables).toMatchObject({
      darkMode: true,
      primaryTextColor: '#fafafa',
      primaryBorderColor: '#77aa99',
      actorTextColor: '#fafafa',
    })
  })

  it('admits only an SVG root and strips executable SVG features', () => {
    expect(parseSafeMermaidSvg('<div>not svg</div>')).toBeNull()
    expect(parseSafeMermaidSvg('<svg></svg><p>sibling</p>')).toBeNull()

    const safe = parseSafeMermaidSvg(
      '<svg onclick="steal()"><script>steal()</script><foreignObject>x</foreignObject>' +
      '<a href="javascript:steal()"><text>safe text</text></a></svg>',
    )!
    expect(safe.getAttribute('role')).toBe('img')
    expect(safe.hasAttribute('onclick')).toBe(false)
    expect(safe.querySelector('script')).toBeNull()
    expect(safe.querySelector('foreignObject')).toBeNull()
    expect(safe.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(safe.textContent).toContain('safe text')
  })

  it('rejects non-SVG renderer output without injecting its markup', () => {
    const preview = document.createElement('div')
    expect(applyMermaidSvg(preview, 'bad', '<img src=x onerror=steal()>')).toBe(false)
    expect(preview.querySelector('img')).toBeNull()
    expect(preview.querySelector('.mermaid-error')?.textContent).toContain('Unable')
  })

  it('reuses the LRU output across views and preserves the live SVG element on refresh', async () => {
    const value = engine('<svg data-version="one"><text>One</text></svg>')
    const host = hostFor(value)
    const first = document.createElement('div')
    const second = document.createElement('div')
    await host.render('graph TD; A-->B', first, () => true)
    await host.render('graph TD; A-->B', second, () => true)
    expect(value.render).toHaveBeenCalledOnce()
    expect(second.querySelector('svg')?.textContent).toBe('One')

    const live = first.querySelector('svg')!
    expect(applyMermaidSvg(first, 'next', '<svg data-version="two"><text>Two</text></svg>')).toBe(true)
    expect(first.querySelector('svg')).toBe(live)
    expect(live.getAttribute('data-version')).toBe('two')
    expect(live.textContent).toBe('Two')
  })

  it('does not apply a render superseded by the NodeView token guard', async () => {
    const value = engine()
    const host = hostFor(value)
    const preview = document.createElement('div')
    expect(await host.render('graph TD; A-->B', preview, () => false)).toBe(false)
    expect(preview.querySelector('svg')).toBeNull()
  })

  it('surfaces parse errors as text and retains a previous good SVG', async () => {
    const value = engine()
    const host = hostFor(value)
    const preview = document.createElement('div')
    await host.render('graph TD; A-->B', preview, () => true)
    value.render.mockRejectedValueOnce(new Error('<unsafe parse detail>'))
    await host.render('graph TD; A-->C', preview, () => true)
    expect(preview.querySelector('svg')).not.toBeNull()
    expect(preview.querySelector('.mermaid-error')?.textContent).toBe('<unsafe parse detail>')
    expect(preview.innerHTML).not.toContain('<unsafe parse detail></')
  })

  it('reinitializes and notifies mounted NodeViews when theme/skin attributes change', async () => {
    const root = document.documentElement
    root.setAttribute('data-theme', 'light')
    const value = engine()
    const controller = makeMermaidRenderHost({ loadEngine: async () => value, root })
    controllers.push(controller)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe!(listener)
    await controller.render('graph TD; A-->B', document.createElement('div'), () => true)
    expect(value.initialize).toHaveBeenCalledTimes(1)

    root.setAttribute('data-theme', 'dark')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listener).toHaveBeenCalledOnce()
    expect(value.initialize).toHaveBeenCalledTimes(2)
    expect(value.initialize.mock.calls[1]?.[0]).toMatchObject({
      themeVariables: expect.objectContaining({ darkMode: true }),
    })

    unsubscribe()
    root.setAttribute('data-theme', 'light')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listener).toHaveBeenCalledOnce()
  })
})
