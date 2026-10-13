/**
 * Policy for caller-owned HTML rendered ONLY in an opaque-origin iframe.
 * This is containment, not sanitization: preserve the source literally after
 * the first policy meta. Never insert the resulting document in Garden's DOM.
 *
 * CSP controls subresources, not every self-frame navigation. In particular,
 * links/location/meta refresh may navigate the frame and send a request with
 * ambient destination credentials. Sandbox still denies parent DOM, top-level
 * navigation, popups and forms; this is NOT absolute network isolation.
 * A destination document may replace this srcdoc's CSP while remaining under
 * the iframe sandbox. Host frame policy/actual browser checks remain separate.
 * The embedding app must also allow srcdoc/inline policy under its own CSP.
 * References: https://www.w3.org/TR/CSP3/#meta-element
 * https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
 */
export function artifactHtmlSandbox(allowScripts = false): string {
  return allowScripts === true ? 'allow-scripts' : ''
}

export function artifactHtmlCsp(allowScripts = false): string {
  return [
    "default-src 'none'",
    `script-src ${allowScripts === true ? "'unsafe-inline'" : "'none'"}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "manifest-src 'none'",
  ].join('; ')
}

export function artifactHtmlSrcdoc(source: string, allowScripts = false): string {
  // Policy values are constants, never interpolated from artifact content.
  // A later artifact-supplied CSP can only add restrictions, not relax this.
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="'
    + artifactHtmlCsp(allowScripts)
    + '"><meta charset="utf-8"><meta name="referrer" content="no-referrer">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '</head><body>' + source + '</body></html>'
}
