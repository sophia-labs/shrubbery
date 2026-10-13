/** Actual Lit/happy-dom wiring. Iframe loading is explicitly disabled: these
 * prove containment markup and update behavior, NOT browser CSP enforcement. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { artifactKindFromMime, MnArtifactView } from '../mn-artifact-view.js'
import { artifactHtmlCsp, artifactHtmlSrcdoc } from '../artifact-html-preview.js'

const settings = (window as unknown as { happyDOM: { settings: {
  disableIframePageLoading: boolean; disableJavaScriptEvaluation: boolean
  disableJavaScriptFileLoading: boolean; disableCSSFileLoading: boolean
} } }).happyDOM.settings
let priorSettings: typeof settings
beforeEach(() => {
  // happy-dom's srcdoc path bypasses disableIframePageLoading and does not
  // implement browser sandbox/CSP enforcement. Disable evaluation explicitly.
  priorSettings = { ...settings }
  settings.disableIframePageLoading = true; settings.disableJavaScriptEvaluation = true
  settings.disableJavaScriptFileLoading = true; settings.disableCSSFileLoading = true
  delete document.body.dataset.compromised
})
afterEach(() => { Object.assign(settings, priorSettings); delete document.body.dataset.compromised; vi.restoreAllMocks() })
async function mount(source: string | null = '<h1>Garden artifact</h1>') {
  const el = document.createElement('mn-artifact-view') as MnArtifactView
  el.graphId = 'graph-a'; el.artifactId = 'artifact-a'; el.title = 'My HTML'
  el.mimeType = 'text/html; charset=utf-8'; el.status = 'ready'
  el.previewHtml = source; el.previewIdentity = 'revision-1'
  document.body.append(el); await el.updateComplete; return el
}
const frame = (el: MnArtifactView) => el.shadowRoot!.querySelector<HTMLIFrameElement>('iframe')

describe('HTML artifact classification', () => {
  for (const mime of ['text/html', ' TEXT/HTML ; charset=UTF-8', 'text/html;charset=utf-8'])
    it(`recognizes the normalized HTML MIME ${mime}`, () => expect(artifactKindFromMime(mime)).toBe('html'))
  for (const mime of ['text/plain', 'application/xhtml+xml', 'application/xml', 'text/xml'])
    it(`does not execute ${mime} as HTML`, () => expect(artifactKindFromMime(mime, 'html')).toBe('text'))
  it('does not infer executable HTML from an extension alone or SVG', () => {
    expect(artifactKindFromMime(null, 'html')).toBe('binary')
    expect(artifactKindFromMime('image/svg+xml')).toBe('image')
  })
  it('lets explicit HTML MIME take precedence over stale file-type hints', () => {
    expect(artifactKindFromMime('text/html; charset=utf-8', 'pdf')).toBe('html')
    expect(artifactKindFromMime('text/html', 'excalidraw')).toBe('html')
  })
})

describe('controlled HTML iframe', () => {
  it('uses an opaque inert sandbox, first policy and an accessible title under the Garden header', async () => {
    const el = await mount(), iframe = frame(el)!
    expect(customElements.get('mn-artifact-view')).toBe(MnArtifactView)
    expect(iframe, el.shadowRoot!.innerHTML).not.toBeNull()
    expect(el.allowHtmlScripts).toBe(false)
    expect(iframe.hasAttribute('sandbox')).toBe(true)
    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(iframe.title).toBe('HTML preview: My HTML')
    expect(iframe.srcdoc).toBe(artifactHtmlSrcdoc(el.previewHtml!))
    expect(iframe.srcdoc).toContain(`content="${artifactHtmlCsp()}"`)
    expect(el.shadowRoot!.querySelector('.header .title')?.textContent).toBe('My HTML')
    expect(el.shadowRoot!.querySelector('.surface-html')?.contains(iframe)).toBe(true)
    expect(iframe.hasAttribute('src')).toBe(false)
  })
  it('never places literal hostile artifact markup in the parent DOM', async () => {
    const source = '</iframe><script id="artifact-attack">parent.document.body.dataset.compromised="yes"</script><img id="artifact-image" src="https://example.invalid/pixel"><form id="artifact-form"></form>'
    const el = await mount(source)
    expect(frame(el)!.srcdoc).toContain(source)
    expect(el.shadowRoot!.querySelector('#artifact-attack, #artifact-image, #artifact-form')).toBeNull()
    expect(document.querySelector('#artifact-attack, #artifact-image, #artifact-form')).toBeNull()
    expect(document.body.dataset.compromised).toBeUndefined()
  })
  it('does not reassign srcdoc or replace the frame for unrelated rerenders and the same committed source', async () => {
    const el = await mount(), iframe = frame(el)!, writes = vi.spyOn(HTMLIFrameElement.prototype, 'srcdoc', 'set')
    el.title = 'Renamed'; el.artifactStatus = 'Indexed'; el.previewIdentity = 'revision-1'
    el.previewHtml = '<h1>Garden artifact</h1>'; el.requestUpdate(); await el.updateComplete
    expect(frame(el)).toBe(iframe)
    expect(writes).not.toHaveBeenCalled()
    expect(iframe.title).toBe('HTML preview: Renamed')
  })
  it('updates srcdoc on new content without a whole host reload', async () => {
    const el = await mount(), iframe = frame(el)!, writes = vi.spyOn(HTMLIFrameElement.prototype, 'srcdoc', 'set')
    el.previewHtml = '<p>Committed successor</p>'; await el.updateComplete
    expect(frame(el)).toBe(iframe)
    expect(writes).toHaveBeenCalledOnce()
    expect(iframe.srcdoc).toContain('<p>Committed successor</p>')
  })
  it('starts a fresh frame for a new committed identity, artifact, or scripting policy', async () => {
    const el = await mount(); let prior = frame(el)
    el.previewIdentity = 'revision-2'; await el.updateComplete
    expect(frame(el)).not.toBe(prior); prior = frame(el)
    el.artifactId = 'artifact-b'; await el.updateComplete
    expect(frame(el)).not.toBe(prior); prior = frame(el)
    el.allowHtmlScripts = true; await el.updateComplete
    expect(frame(el)).not.toBe(prior)
    expect(frame(el)!.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame(el)!.srcdoc).toContain("script-src 'unsafe-inline'")
    prior = frame(el); el.allowHtmlScripts = false; await el.updateComplete
    expect(frame(el)).not.toBe(prior)
    expect(frame(el)!.getAttribute('sandbox')).toBe('')
  })
  it('renders empty HTML but distinguishes unavailable source', async () => {
    const el = await mount('')
    expect(frame(el)).not.toBeNull()
    expect(frame(el)!.srcdoc).toContain('</head><body></body></html>')
    el.previewHtml = null; await el.updateComplete
    expect(frame(el)).toBeNull()
    expect(el.shadowRoot!.querySelector('mn-empty-state')?.getAttribute('title')).toBe('HTML preview unavailable')
  })
  it('does not render provided markup when the artifact MIME is plain text', async () => {
    const el = await mount('<script>ignored()</script>')
    el.mimeType = 'text/plain'; el.fileType = 'html'; await el.updateComplete
    expect(frame(el)).toBeNull()
    expect(el.shadowRoot!.querySelector('script')).toBeNull()
    expect(el.shadowRoot!.querySelector('mn-empty-state')?.getAttribute('title')).toBe('No inline preview for text')
  })
  it('does not enable scripts through attributes or truthy non-boolean policy values', async () => {
    const el = await mount()
    el.setAttribute('allow-html-scripts', 'true'); await el.updateComplete
    expect(frame(el)!.getAttribute('sandbox')).toBe('')
    ;(el as unknown as { allowHtmlScripts: unknown }).allowHtmlScripts = 'false'
    await el.updateComplete
    expect(frame(el)!.getAttribute('sandbox')).toBe('')
    expect(frame(el)!.srcdoc).toContain("script-src 'none'")
  })
  it('preserves controlled loading/error and switches back to image and scene views', async () => {
    const el = await mount(); el.status = 'loading'; await el.updateComplete
    expect(frame(el)).toBeNull(); expect(el.shadowRoot!.querySelector('mn-loading')).not.toBeNull()
    el.status = 'error'; el.error = 'Read refused'; await el.updateComplete
    expect(el.shadowRoot!.querySelector('mn-empty-state')?.getAttribute('description')).toBe('Read refused')
    el.status = 'ready'; el.mimeType = 'image/png'; el.previewUrl = 'blob:existing'; await el.updateComplete
    expect(frame(el)).toBeNull(); expect(el.shadowRoot!.querySelector('img')?.getAttribute('src')).toBe('blob:existing')
    el.mimeType = 'application/vnd.excalidraw+json'; await el.updateComplete
    expect(el.shadowRoot!.querySelector('mn-excalidraw-canvas')).not.toBeNull()
  })
})
