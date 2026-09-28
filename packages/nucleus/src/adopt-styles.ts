/**
 * Runtime stylesheets that the packaged app's CSP allows.
 *
 * The desktop app's Content Security Policy has a nonce in style-src (Tauri
 * adds it). When a nonce is present, the browser ignores 'unsafe-inline' for
 * <style> ELEMENTS, so a <style> created at runtime is refused. It works in
 * the dev server, in Playwright and in Storybook, which send no such policy,
 * and it silently does nothing in the app. That is how the whole mobile shell
 * stylesheet went missing in the desktop app: its inactive shell rendered
 * unstyled below the desktop layout, and a drag selection scrolled down to it.
 *
 * Constructable stylesheets (adoptedStyleSheets) are not governed by
 * style-src. Lit already uses them for every component, which is why component
 * styles always worked. Measured in WebKit and Chromium under the app's CSP
 * shape: a runtime <style> is refused, an adopted sheet applies.
 *
 * Use adoptStyleSheet wherever code used to append a <style> to a document
 * head or a shadow root.
 */

type StyleRoot = Document | ShadowRoot

const sheetsByRoot = new WeakMap<StyleRoot, Map<string, CSSStyleSheet>>()
const sourceBySheet = new WeakMap<CSSStyleSheet, string>()

/**
 * Adopt `css` onto `root` under `key`. Idempotent per root and key: a second
 * call with the same key replaces that sheet's rules instead of adding a sheet.
 */
export function adoptStyleSheet(root: StyleRoot, key: string, css: string): CSSStyleSheet {
  let sheets = sheetsByRoot.get(root)
  if (!sheets) {
    sheets = new Map()
    sheetsByRoot.set(root, sheets)
  }
  const existing = sheets.get(key)
  if (existing) {
    existing.replaceSync(css)
    sourceBySheet.set(existing, css)
    if (!root.adoptedStyleSheets.includes(existing)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, existing]
    }
    return existing
  }
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  sourceBySheet.set(sheet, css)
  sheets.set(key, sheet)
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
  return sheet
}

/** Remove the sheet adopted under `key`, if any. */
export function dropAdoptedStyleSheet(root: StyleRoot, key: string): void {
  const sheet = sheetsByRoot.get(root)?.get(key)
  if (!sheet) return
  sheetsByRoot.get(root)?.delete(key)
  root.adoptedStyleSheets = root.adoptedStyleSheets.filter(candidate => candidate !== sheet)
}

/**
 * The root a <style> placed inside `node` would have styled: its shadow root,
 * or its document.
 */
export function styleRootOf(node: Node): StyleRoot {
  const root = node.getRootNode()
  return root instanceof ShadowRoot ? root : (node.ownerDocument ?? document)
}

/**
 * The CSS text adopted under `key`, exactly as it was passed in, or null.
 * The sheet's own cssRules are re-serialized by the browser, which rewrites
 * quotes and whitespace, so this is what to read when checking content.
 */
export function adoptedStyleSheetText(root: StyleRoot, key: string): string | null {
  const sheet = sheetsByRoot.get(root)?.get(key)
  return sheet ? (sourceBySheet.get(sheet) ?? null) : null
}
