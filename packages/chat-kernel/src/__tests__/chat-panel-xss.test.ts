/**
 * @vitest-environment jsdom
 *
 * <sh-chat-panel> — END-TO-END XSS proof (NO MOCKS, real jsdom DOM).
 *
 * The companion to chat-panel.test.ts (happy-dom). That file proves the sanitize
 * seam is WIRED at both prose sites; THIS file proves it WORKS end-to-end: a real
 * attacker payload, rendered through the real Lit panel's real default sanitizer
 * (DOMPurify), is neutralized in the live DOM the panel produced.
 *
 * WHY jsdom (mirrors sanitize.test.ts): DOMPurify only sanitizes correctly on a
 * spec-compliant DOM. happy-dom 15 (the package default, fine for the panel's Lit
 * functional tests) degrades DOMPurify (strips block wrappers, can leak handlers),
 * which would make a payload assertion a FALSE proof. jsdom gives a REAL one. This
 * is the documented no-mock scoping call: per-file env, no package-default change.
 * jsdom is a pure test-only devDep outside the src/ purity closure.
 */
import { describe, it, expect, afterEach } from 'vitest'

import { ShChatPanel } from '../chat-panel.js'
import type { ChatMessage } from '../types.js'

void ShChatPanel

function mount(): ShChatPanel {
  const el = document.createElement('sh-chat-panel') as ShChatPanel
  document.body.appendChild(el)
  return el
}

function assistantMsg(content: string): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content,
    parts: [],
    isStreaming: false,
    toolCalls: [],
    createdAt: 0,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('<sh-chat-panel> END-TO-END XSS neutralization (real DOMPurify)', () => {
  it('strips a real <img onerror> payload from prose-only content (PROSE SITE A)', async () => {
    const el = mount()
    el.messages = [assistantMsg('safe <img src=x onerror="window.__pwned=1"> text')]
    await el.updateComplete

    const md = el.querySelector('.markdown-content')
    expect(md).not.toBeNull()
    expect(md!.innerHTML).not.toContain('onerror')
    expect(md!.querySelector('img[onerror]')).toBeNull()
    // The benign prose survived.
    expect(md!.textContent).toContain('safe')
    expect(md!.textContent).toContain('text')
  })

  it('strips a <script> payload interleaved with a code fence (PROSE SITE B)', async () => {
    const el = mount()
    // The code fence forces the parts[] loop branch (site B). The surrounding
    // prose payload must STILL be neutralized; the fence stays escaped text.
    el.messages = [
      assistantMsg('before <script>window.__pwned=1</script> ```js\nconst a=1\n``` after'),
    ]
    await el.updateComplete

    const proseBlocks = Array.from(el.querySelectorAll('.markdown-content'))
    expect(proseBlocks.length).toBeGreaterThan(0)
    for (const block of proseBlocks) {
      expect(block.innerHTML).not.toContain('<script')
      expect(block.innerHTML).not.toContain('__pwned')
    }
    // No live <script> node entered the panel's DOM anywhere.
    expect(el.querySelector('script')).toBeNull()

    // The code fence rendered as Lit-escaped literal text (NOT unsafeHTML).
    const code = el.querySelector('.code-block pre code')
    expect(code).not.toBeNull()
    expect(code!.textContent).toContain('const a=1')
  })

  it('neutralizes a javascript: href in prose', async () => {
    const el = mount()
    el.messages = [assistantMsg('[click](javascript:window.__pwned=1) and **safe**')]
    await el.updateComplete

    const md = el.querySelector('.markdown-content')
    expect(md).not.toBeNull()
    expect(md!.innerHTML).not.toContain('javascript:')
    // benign markdown emphasis survived.
    expect(md!.querySelector('strong')?.textContent).toBe('safe')
  })
})
