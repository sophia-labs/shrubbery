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
import type { ChatMessage, ChatSeam } from '../types.js'
import { unrecordedVoiceMark } from '../voice-roster.js'

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

  it('strips a real <img onerror> payload from an earlier conversation carried in a window', async () => {
    // Defect guarded: the window is "already sent, read-only", and a path that trusted it would
    // render an old conversation's HTML as it came. An imported conversation is untrusted text:
    // it goes through the same sanitize seam as every other message. (This guard lives here, under
    // jsdom, and not in chat-panel-seam.test.ts: happy-dom degrades DOMPurify, so a payload
    // assertion there would be a false proof. The seam test only holds that the seam is on the path.)
    delete (window as unknown as { __pwned?: boolean }).__pwned
    const payload = 'hi <img src=x onerror="window.__pwned = true"> there'
    const seam: ChatSeam = {
      omittedCount: 3,
      originalTitle: 'An old chat',
      pickedUpAt: '2026-09-28T19:30:00.000Z',
      voiceLabel: 'Kimi K2.6',
      providerNotice: 'Continuing sends this conversation to Moonshot through OpenRouter.',
    }
    const el = mount()
    el.seam = seam
    el.messages = [
      {
        id: 'w-evil',
        role: 'assistant',
        content: payload,
        parts: [{ type: 'text', content: payload }],
        isStreaming: false,
        toolCalls: [],
        createdAt: Date.UTC(2026, 7, 2, 15, 0),
        origin: 'window',
        voice: unrecordedVoiceMark(),
      },
    ]
    await el.updateComplete

    // It really is on screen as a carried message under the seam (the test cannot pass by rendering nothing).
    const carried = el.querySelector('.message.assistant.window')
    expect(carried).not.toBeNull()
    expect(el.querySelector('[data-seam]')).not.toBeNull()
    const md = carried!.querySelector('.markdown-content')
    expect(md).not.toBeNull()
    // The benign prose survived; the handler did not.
    expect(md!.textContent).toContain('hi')
    expect(md!.textContent).toContain('there')
    expect(el.querySelector('img[onerror]')).toBeNull()
    expect(el.innerHTML).not.toContain('onerror')
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
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
