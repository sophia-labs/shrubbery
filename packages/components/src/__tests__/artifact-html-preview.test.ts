import { describe, expect, it } from 'vitest'
import { artifactHtmlCsp, artifactHtmlSandbox, artifactHtmlSrcdoc } from '../artifact-html-preview.js'

describe('HTML artifact containment policy - static contract, not browser enforcement', () => {
  it('defaults to an empty sandbox and denies scripts', () => {
    expect(artifactHtmlSandbox()).toBe('')
    expect(artifactHtmlCsp()).toContain("script-src 'none'")
  })
  it('grants only explicitly selected inline scripting', () => {
    expect(artifactHtmlSandbox(true)).toBe('allow-scripts')
    expect(artifactHtmlCsp(true)).toContain("script-src 'unsafe-inline'")
    expect(artifactHtmlCsp(true)).not.toMatch(/unsafe-eval|https?:|\*/)
  })
  for (const scripts of [false, true]) {
    it(`retains all resource and navigation restrictions with scripts=${scripts}`, () => {
      const csp = artifactHtmlCsp(scripts)
      for (const directive of ['default-src', 'connect-src', 'frame-src', 'child-src', 'worker-src', 'object-src', 'base-uri', 'form-action', 'manifest-src']) {
        expect(csp.split('; ')).toContain(`${directive} 'none'`)
      }
      expect(csp.split('; ')).toContain("style-src 'unsafe-inline'")
      expect(csp.split('; ')).toContain('img-src data: blob:')
      expect(csp.split('; ')).toContain('font-src data:')
      expect(artifactHtmlSandbox(scripts)).not.toMatch(/same-origin|top-navigation|popups|forms|modals|downloads/)
    })
  }
  it('puts the fixed policy before arbitrary source without claiming sanitization', () => {
    const source = '</body></html><meta http-equiv="Content-Security-Policy" content="default-src *"><script>parent.injected = true</script>'
    const result = artifactHtmlSrcdoc(source, true)
    expect(result.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(result).toContain(`content="${artifactHtmlCsp(true)}"`)
    expect(result).toContain('</head><body>' + source + '</body></html>')
    expect(result.indexOf(artifactHtmlCsp(true))).toBeLessThan(result.indexOf(source))
  })
  it('retains valid empty HTML and yields identical source for identical input', () => {
    expect(artifactHtmlSrcdoc('')).toContain('</head><body></body></html>')
    expect(artifactHtmlSrcdoc('<p>🪴</p>')).toBe(artifactHtmlSrcdoc('<p>🪴</p>'))
    expect(artifactHtmlSrcdoc('<p>🪴</p>', true)).not.toBe(artifactHtmlSrcdoc('<p>🪴</p>'))
  })
})
