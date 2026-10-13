/**
 * The boundary adapter carries the account line, the composer notice, the price footnote
 * and the seam to the kernel untouched, and their intents back to the host (NO MOCKS:
 * real sources and projections, no framework doubles).
 */
import type { ChatAccountNote, ChatComposerNotice, ChatSeam } from '@shrubbery/chat-kernel'
import { describe, expect, it } from 'vitest'
import { buildChatKernelOptions, type ChatProjection } from '../assemble.js'

function projection(extra: Partial<ChatProjection> = {}): ChatProjection {
  return {
    messages: [],
    streaming: false,
    error: null,
    readOnly: false,
    models: [],
    currentModel: '',
    sessionTitle: null,
    activeSlot: 0,
    slotSessions: [null, null, null],
    ...extra,
  }
}

const NOTE: ChatAccountNote = { label: 'Credit', value: '$0.00376', tone: 'ok' }
const NOTICE: ChatComposerNotice = { id: 'out-of-credits', tone: 'blocked', title: 'You are out of credits.' }
const SEAM: ChatSeam = {
  omittedCount: 12,
  originalTitle: 'Monads, again',
  pickedUpAt: '2026-09-29T20:00:00.000Z',
  voiceLabel: 'Kimi K2.6',
}

describe('buildChatKernelOptions — the account line, the reserved notice and the seam', () => {
  it('projects them as they are', () => {
    const opts = buildChatKernelOptions({ send() {} }, () => projection({ accountNote: NOTE, composerNotice: NOTICE, seam: SEAM }))
    expect(opts.accountNote).toBe(NOTE)
    expect(opts.composerNotice).toBe(NOTICE)
    expect(opts.seam).toBe(SEAM)
  })

  it('projects nothing when the host has nothing to say', () => {
    const opts = buildChatKernelOptions({ send() {} }, () => projection())
    expect(opts.accountNote).toBeNull()
    expect(opts.composerNotice).toBeNull()
    expect(opts.seam).toBeNull()
  })

  it('routes the notice’s action and the seam’s action back to the host', () => {
    const heard: string[] = []
    const opts = buildChatKernelOptions(
      {
        send() {},
        composerNoticeAction: id => heard.push(`notice:${id}`),
        seamAction: action => heard.push(`seam:${action.type}`),
      },
      () => projection({ composerNotice: NOTICE, seam: SEAM }),
    )
    opts.onComposerNoticeAction?.('buy-credits')
    opts.onSeamAction?.({ type: 'open-original' })
    expect(heard).toEqual(['notice:buy-credits', 'seam:open-original'])
  })

  it('is safe when the host does not handle them', () => {
    const opts = buildChatKernelOptions({ send() {} }, () => projection({ composerNotice: NOTICE, seam: SEAM }))
    expect(() => opts.onComposerNoticeAction?.('buy-credits')).not.toThrow()
    expect(() => opts.onSeamAction?.({ type: 'open-original' })).not.toThrow()
  })
})

describe('buildChatKernelOptions — the balance line’s action and the price footnote', () => {
  it('projects the footnote as it is, and none when the host has none', () => {
    const said = buildChatKernelOptions({ send() {} }, () => projection({ voiceFootnote: 'Prices are US dollars per million tokens, with the 20% service fee included.' }))
    expect(said.voiceFootnote).toBe('Prices are US dollars per million tokens, with the 20% service fee included.')
    const none = buildChatKernelOptions({ send() {} }, () => projection())
    expect(none.voiceFootnote).toBeNull()
  })

  it('routes the balance line’s action back to the host', () => {
    const heard: string[] = []
    const opts = buildChatKernelOptions(
      { send() {}, accountAction: id => heard.push(`account:${id}`) },
      () => projection({ accountNote: { label: 'Out of credits', value: '', tone: 'out', action: { id: 'add-credits', label: 'Add credits' } } }),
    )
    opts.onAccountAction?.('add-credits')
    expect(heard).toEqual(['account:add-credits'])
  })

  it('is safe when the host does not handle it', () => {
    const opts = buildChatKernelOptions({ send() {} }, () => projection())
    expect(() => opts.onAccountAction?.('add-credits')).not.toThrow()
  })
})
