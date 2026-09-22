/**
 * HTML sanitization for the chat render path.
 *
 * WHY THIS EXISTS (a CONFIRMED live XSS hole being closed on relocation):
 * garden's `chat-panel.ts` imports `Marked`, configures it `breaks:true, gfm:true`
 * with NO sanitizer (the "safe rendering" comment is misleading — `marked` is NOT
 * a sanitizer), then `renderContent` does `marked.parse(content)` ->
 * `unsafeHTML(htmlContent)` on UNTRUSTED agent/markdown content. Relocating that
 * pattern unchanged would ship the hole. So the kernel — the thing that renders
 * untrusted content — owns sanitization (mirroring how editor-kernel owns schema
 * purity). The wiring is: insert `sanitize(html)` BETWEEN `marked.parse` and
 * `unsafeHTML` (at BOTH prose call sites; the literal ```code-fence``` path is
 * already escaped by Lit's default text binding and is left alone).
 *
 * PURITY: `dompurify` is a PURE DOM-only dependency — no backend, no network. It
 * does not breach the kernel's purity invariant. It ships its own v3 types, so
 * `@types/dompurify` (a deprecated v2 stub) is deliberately NOT installed.
 *
 * The default `sanitize` is overridable via `ChatKernelOptions.sanitize` (a later
 * rung) so a host can supply a stricter/looser policy, but the kernel NEVER ships
 * an unsanitized prose path.
 */

import DOMPurify from 'dompurify'

/** The kernel's default sanitizer: a real DOMPurify pass over rendered HTML. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html)
}
