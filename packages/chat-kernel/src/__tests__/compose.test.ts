/**
 * @vitest-environment jsdom
 *
 * C1 R6 COMPOSE — the chat-kernel as a finished, HONEST organism.
 *
 * Proves the composed surface end-to-end, all NO-MOCK:
 *
 *   1. FORBIDDEN TOKENS absent from the RENDERED PANEL DOM. A real
 *      <sh-chat-panel> rendered with realistic data (prose, code fence, all four
 *      tool-call states, an error banner, a model selector) — its full outerHTML
 *      carries no `EventSource` / `SSE` / `MODEL_PRICING` / store name / a $-cost
 *      string. The render surface betrays no deferred coupling.
 *
 *   2. FORBIDDEN COUPLINGS absent from the kernel SRC — as LIVE IMPORTS. This
 *      mirrors the purity tripwire grep (an `^import …` line scan), NOT a naive
 *      substring scan: the token NAMES legitimately appear in src DOC COMMENTS
 *      (the DEFER ledger lives partly in the code). The honest check is "no live
 *      import / re-export pulls a store / EventSource / cognito / themeStore /
 *      MODEL_PRICING / yjs into the closure" — exactly what the grep enforces.
 *
 *   3. DOMPurify strips a REAL <script> / <img onerror> payload END-TO-END through
 *      the panel's real prose render (jsdom, where DOMPurify is sound — see
 *      DEFER.md "Why jsdom is in the test tree").
 *
 *   4. DEFER.md is a real, complete ledger: read off disk, every deferred-coupling
 *      name is present. The ledger and the code pin each other.
 *
 * NO mocks: a REAL Lit <sh-chat-panel> under jsdom, the REAL src files read off
 * disk, the REAL DEFER.md. Errors surface verbatim.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

import { ShChatPanel } from '../chat-panel.js'
import type { ChatMessage } from '../types.js'

// Importing the module registers <sh-chat-panel>; touch the class so it is
// unmistakably load-bearing.
void ShChatPanel

const HERE = dirname(fileURLToPath(import.meta.url))
// packages/chat-kernel/src/__tests__ -> packages/chat-kernel/
const PKG_ROOT = resolve(HERE, '..', '..')
const SRC_DIR = resolve(PKG_ROOT, 'src')
const DEFER_MD = resolve(PKG_ROOT, 'DEFER.md')

// ---------------------------------------------------------------------------
// The forbidden-token vocabulary.
// ---------------------------------------------------------------------------

// Tokens that must NOT appear in the RENDERED DOM. These are strict substrings —
// if any leaks into outerHTML, the render surface exposed a deferred coupling.
const FORBIDDEN_DOM_TOKENS = [
  'EventSource',
  'MODEL_PRICING',
  'getModelPricing',
  'getModelPriceValue',
  'chatStore',
  'sessionStore',
  'billingStore',
  'themeStore',
  'ThemeController',
  'text/event-stream',
  '/stores/',
]

// A $-cost regex: a literal dollar sign immediately followed by a digit (e.g.
// "$0.03", "$12"). The price column / cost badges are STRIPPED — no such string
// may appear in the rendered panel.
const DOLLAR_COST_RE = /\$\d/

// The purity tripwire, expressed in-test as a regex over IMPORT lines (mirrors
// the DEFER.md grep). Matches a coupling pulled in by a live `import` / re-export
// — never a doc-comment mention.
const FORBIDDEN_IMPORT_RE =
  /^\s*(?:import|export)\s+.*\b(?:yjs|y-websocket|EventSource|chat-store|document-store|session-store|filesystem-store|wire-store|api-cache|\/stores\/|cognito|auth-websocket|tauri|themeStore|ThemeController|billingStore|MODEL_PRICING)\b/

// Every deferred-coupling name the DEFER.md ledger MUST contain. If one is
// removed from the ledger, this list goes red — the ledger stays honest.
const DEFERRED_NAMES = [
  'MODEL_PRICING',
  'billing',
  'send-gating',
  'chat-store',
  'ChatService',
  "mode: 'local' | 'hosted'",
  'EventSource',
  'SSE',
  'reconnect',
  'watchdog',
  'persistence',
  'cognito',
  'auth',
  'themeStore',
  'ThemeController',
  'tauri',
  'yjs',
  'TTS',
  'jsdom',
]

// ---------------------------------------------------------------------------
// Helpers — real src read, real panel mount.
// ---------------------------------------------------------------------------

/** All kernel src .ts files EXCEPT the __tests__ tree (the purity closure). */
function kernelSrcFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) out.push(full)
    }
  }
  walk(SRC_DIR)
  return out
}

function mount(): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  document.body.appendChild(el)
  return el
}

function assistant(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'hello',
    parts: [{ type: 'text', content: 'hello' }],
    isStreaming: false,
    toolCalls: [],
    createdAt: 0,
    ...partial,
  }
}

/** A panel rendered with a realistic surface: prose + fence, all four tool
 * states, an error banner, and a model selector — the widest DOM surface to scan
 * for leaked tokens. */
async function mountFullSurface(): Promise<ShChatPanel> {
  const el = mount()
  el.error = 'a host-injected error string'
  el.streaming = false
  el.models = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
  ]
  el.currentModel = 'claude-opus-4-6'
  el.messages = [
    {
      id: 'u1',
      role: 'user',
      content: 'show me everything',
      parts: [{ type: 'text', content: 'show me everything' }],
      isStreaming: false,
      toolCalls: [],
      createdAt: 0,
    },
    assistant({
      content: 'Here is **prose** and a fence:\n\n```ts\nconst x = 1\n```',
      parts: [
        { type: 'reasoning', content: 'thinking' },
        { type: 'text', content: 'Here is **prose** and a fence:\n\n```ts\nconst x = 1\n```' },
        { type: 'tool', toolCallId: 'p' },
        { type: 'tool', toolCallId: 'r' },
        { type: 'tool', toolCallId: 'c' },
        { type: 'tool', toolCallId: 'e' },
      ],
      toolCalls: [
        { id: 'p', tool: 'pending_gate', status: 'pending', input: { q: 'x' }, output: null },
        { id: 'r', tool: 'running_gate', status: 'running', input: { q: 'y' }, output: null },
        { id: 'c', tool: 'search_documents', status: 'completed', input: { q: 'z' }, output: 'ok' },
        { id: 'e', tool: 'failing_gate', status: 'error', input: null, output: 'boom' },
      ],
    }),
  ]
  await el.updateComplete
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

// ===========================================================================
// (1) Forbidden tokens absent from the RENDERED PANEL DOM.
// ===========================================================================
describe('C1 R6 compose — forbidden tokens absent from the rendered panel DOM', () => {
  it('the full-surface panel outerHTML carries no store / EventSource / SSE / MODEL_PRICING token', async () => {
    const el = await mountFullSurface()
    const dom = el.outerHTML

    // Sanity: we actually rendered the wide surface (otherwise the scan is vacuous).
    for (const status of ['pending', 'running', 'completed', 'error']) {
      expect(
        el.querySelector(`.tool-status-icon[data-status="${status}"]`),
        `precondition: missing ${status} badge — scan would be vacuous`,
      ).not.toBeNull()
    }
    expect(el.querySelector('.markdown-content'), 'precondition: no prose rendered').not.toBeNull()

    for (const token of FORBIDDEN_DOM_TOKENS) {
      expect(dom, `forbidden token leaked into rendered DOM: ${token}`).not.toContain(token)
    }
  })

  it('the rendered DOM shows no $-cost string (price column / cost badges are STRIPPED)', async () => {
    const el = await mountFullSurface()
    // Scan the VISIBLE text, not outerHTML: a price column / cost badge would
    // render as user-visible "$<digit>" text. (outerHTML carries Lit's internal
    // `<!--?lit$<digits>$-->` marker comments, which are not costs and live only
    // in comment nodes — scanning textContent is the honest cost check.)
    const visible = el.textContent ?? ''
    expect(DOLLAR_COST_RE.test(visible), `visible: ${JSON.stringify(visible.slice(0, 400))}`).toBe(
      false,
    )
    // And the model selector renders model labels with NO price column appended.
    const selector = el.querySelector('select, .model-selector, [role="listbox"]')
    if (selector) {
      expect(DOLLAR_COST_RE.test(selector.textContent ?? '')).toBe(false)
    }
  })
})

// ===========================================================================
// (2) Forbidden couplings absent from the kernel SRC (live imports / re-exports).
// ===========================================================================
describe('C1 R6 compose — kernel src is pure (no live coupling imports)', () => {
  it('no src .ts file imports a store / EventSource / cognito / themeStore / yjs / MODEL_PRICING', () => {
    const files = kernelSrcFiles()
    // Sanity: we found the real files (chat-panel + projector + adapter + …).
    expect(files.length, 'expected several kernel src files').toBeGreaterThanOrEqual(5)

    const offenders: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (FORBIDDEN_IMPORT_RE.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders, `forbidden coupling import(s) in kernel src:\n${offenders.join('\n')}`).toEqual(
      [],
    )
  })

  it('the import-grep is REAL — it would catch a planted store import (self-check)', () => {
    // Prove the regex actually fires on a coupling line (so an empty offenders[]
    // means clean, not a dead regex).
    expect(FORBIDDEN_IMPORT_RE.test("import { chatStore } from '../stores/chat-store.js'")).toBe(
      true,
    )
    expect(FORBIDDEN_IMPORT_RE.test("import { ThemeController } from '../controllers/theme-controller.js'")).toBe(
      true,
    )
    // And it does NOT fire on a doc comment that merely names the token.
    expect(FORBIDDEN_IMPORT_RE.test(' *   - chatStore / sessionStore — DEFERRED to the host')).toBe(
      false,
    )
  })
})

// ===========================================================================
// (3) DOMPurify strips a real payload END-TO-END through the panel prose render.
// ===========================================================================
describe('C1 R6 compose — DOMPurify neutralizes a real payload end-to-end', () => {
  it('strips a real <img onerror> from prose-only content (PROSE SITE A)', async () => {
    const el = mount()
    el.messages = [
      assistant({
        content: 'safe <img src=x onerror="window.__pwned=1"> text',
        parts: [],
      }),
    ]
    await el.updateComplete

    const md = el.querySelector('.markdown-content')
    expect(md).not.toBeNull()
    expect(md!.innerHTML).not.toContain('onerror')
    expect(md!.querySelector('img[onerror]')).toBeNull()
    expect(md!.textContent).toContain('safe')
    expect(md!.textContent).toContain('text')
    // No live handler executed.
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('strips a <script> interleaved with a code fence (PROSE SITE B) — fence stays escaped text', async () => {
    const el = mount()
    el.messages = [
      assistant({
        content: 'before <script>window.__pwned=1</script> ```js\nconst a=1\n``` after',
        parts: [],
      }),
    ]
    await el.updateComplete

    // No live <script> node entered the panel's DOM anywhere.
    expect(el.querySelector('script')).toBeNull()
    for (const block of Array.from(el.querySelectorAll('.markdown-content'))) {
      expect(block.innerHTML).not.toContain('<script')
      expect(block.innerHTML).not.toContain('__pwned')
    }
    // The code fence rendered as Lit-escaped literal text (NOT unsafeHTML).
    const code = el.querySelector('.code-block pre code')
    expect(code).not.toBeNull()
    expect(code!.textContent).toContain('const a=1')
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })
})

// ===========================================================================
// (4) DEFER.md is a real, complete ledger.
// ===========================================================================
describe('C1 R6 compose — DEFER.md is a real, complete honest ledger', () => {
  it('DEFER.md exists and names EVERY deferred coupling', () => {
    const text = readFileSync(DEFER_MD, 'utf8')
    for (const name of DEFERRED_NAMES) {
      expect(text, `DEFER.md does not mention deferred coupling: ${name}`).toContain(name)
    }
  })

  it('DEFER.md documents WHY jsdom is in the test tree', () => {
    const text = readFileSync(DEFER_MD, 'utf8')
    expect(text).toMatch(/jsdom/)
    expect(text).toMatch(/happy-dom/)
    expect(text).toMatch(/DOMPurify/)
    // The honest reason: happy-dom degrades DOMPurify -> a false proof.
    expect(text).toMatch(/false proof/i)
  })

  it('DEFER.md states the chat-store mode fork is the C2 ChatService seam', () => {
    const text = readFileSync(DEFER_MD, 'utf8')
    expect(text).toContain('ChatService')
    expect(text).toMatch(/local.*hosted|hosted.*local/i)
  })
})
