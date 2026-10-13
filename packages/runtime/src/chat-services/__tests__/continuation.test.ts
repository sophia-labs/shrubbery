/**
 * "Continue with...": the window, the seed and the source's voice (NO MOCKS).
 *
 * A real in-memory `ConversationArchive` pages fifty messages at a time exactly as
 * the gateway's does; `readContinuationPlan` reads it the way production will. Each
 * test names the defect it guards: a window that reorders the conversation, a
 * payload that blows through the seed store's cap once JSON has escaped it, a
 * tool trace or a deleted message that leaves the browser, a voice mark that
 * claims more than the record says.
 */
import type { ChatModelOption } from '@shrubbery/chat-kernel'
import { describe, expect, it } from 'vitest'
import {
  ContinuationError,
  DEFAULT_WINDOW_LIMITS,
  familyOf,
  matchSourceVoice,
  providerNoticeFor,
  readContinuationPlan,
  recordedVoiceOf,
  seamVoiceLabel,
  seedPayloadFor,
  serializedBytes,
  sourceVoiceMark,
  windowToChatMessages,
  type ContinuationPlan,
} from '../continuation.js'
import {
  alternating,
  CONVERSATION_ID,
  MemoryArchive,
  REVISION_ID,
  turn,
  type FixtureMessage,
} from './fixtures/memory-archive.js'

const INTENT = {
  conversationId: CONVERSATION_ID,
  revisionId: REVISION_ID,
  title: 'Monads, again',
  messagesLoaded: 50,
}

function priced(id: string, label: string, extra: Partial<ChatModelOption> = {}): ChatModelOption {
  return { id, label, priceInPerMTok: 1, priceOutPerMTok: 2, contextLength: 200_000, supportsTools: true, ...extra }
}

/** A roster shaped like the live catalogue: OpenRouter author/model ids. */
const ROSTER: ChatModelOption[] = [
  priced('google/gemini-2.5-flash', 'Gemini 2.5 Flash', { house: true }),
  priced('moonshotai/kimi-k2.5', 'Kimi K2.5'),
  priced('moonshotai/kimi-k2.6', 'Kimi K2.6'),
  priced('moonshotai/kimi-k3', 'Kimi K3'),
  priced('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5'),
  priced('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro'),
]

async function plan(
  messages: readonly FixtureMessage[],
  options: { maxBytes?: number; maxMessageChars?: number; roster?: ChatModelOption[] } = {},
): Promise<{ plan: ContinuationPlan; archive: MemoryArchive }> {
  const archive = new MemoryArchive(messages)
  const built = await readContinuationPlan(archive, INTENT, {
    limits: {
      maxBytes: options.maxBytes ?? DEFAULT_WINDOW_LIMITS.maxBytes,
      maxMessageChars: options.maxMessageChars ?? DEFAULT_WINDOW_LIMITS.maxMessageChars,
    },
    roster: options.roster ?? ROSTER,
  })
  return { plan: built, archive }
}

const ids = (built: ContinuationPlan): string[] => built.window.messages.map(message => message.id)

describe('the window: the first user turn plus the tail, within the cap', () => {
  // Defect guarded: the byte cap is not the only cap. The seed store refuses a seed of more than 2,000 messages
  // (`seed_invalid`), and 3,000 undated one-word turns serialise to about 84,000 bytes, well inside the 114,000, so a
  // window cut by bytes alone would have been refused at the person's first message, and that conversation could never be
  // continued. More than half of the live archive's conversations are undated, which is what makes small messages cheap.
  it.each([
    [2_000, 0],
    [2_001, 1],
    [3_000, 1_000],
  ])('never carries more than 2,000 messages, however small: %i messages, %i left out', async (count, omitted) => {
    const tiny = Array.from({ length: count }, (_, index) => turn(index, index % 2 === 0 ? 'user' : 'assistant', 'ok'))
    const { plan: built } = await plan(tiny)
    expect(built.window.messages).toHaveLength(count - omitted)
    expect(built.window.total).toBe(count)
    expect(built.window.omitted).toBe(omitted)
    expect(seedPayloadFor(built).messages.length).toBeLessThanOrEqual(2_000)
    // The first user turn and the unbroken tail up to the last message.
    expect(ids(built)[0]).toBe('msg-0000')
    expect(ids(built).at(-1)).toBe(`msg-${String(count - 1).padStart(4, '0')}`)
    if (omitted > 0) expect(ids(built)[1]).toBe(`msg-${String(omitted + 1).padStart(4, '0')}`)
  })

  it('carries a short conversation whole, in archive order, and omits nothing', async () => {
    const { plan: built } = await plan(alternating(6))
    expect(ids(built)).toEqual(['msg-0000', 'msg-0001', 'msg-0002', 'msg-0003', 'msg-0004', 'msg-0005'])
    expect(built.window.total).toBe(6)
    expect(built.window.omitted).toBe(0)
  })

  it('keeps the first user turn and the tail of a long conversation, and counts what it dropped', async () => {
    const cap = 40_000
    const { plan: built } = await plan(alternating(300, 200), { maxBytes: cap })
    const carried = ids(built)
    expect(carried[0]).toBe('msg-0000')
    // The rest is the unbroken tail ending at the conversation's last message.
    const tail = carried.slice(1)
    expect(tail.length).toBeGreaterThan(50)
    expect(tail.at(-1)).toBe('msg-0299')
    tail.forEach((id, position) => {
      expect(id).toBe(`msg-${String(300 - tail.length + position).padStart(4, '0')}`)
    })
    expect(built.window.total).toBe(300)
    expect(built.window.omitted).toBe(300 - carried.length)
    // It fills the cap rather than sending a token amount, and never passes it.
    const bytes = serializedBytes(seedPayloadFor(built))
    expect(bytes).toBeLessThanOrEqual(cap)
    expect(bytes).toBeGreaterThan(cap * 0.9)
  })

  it('reads only what it needs from a very long conversation', async () => {
    const { archive } = await plan(alternating(5_000, 200), { maxBytes: 40_000 })
    expect(archive.reads.length).toBeLessThanOrEqual(8)
    expect(archive.reads[0]).toBe(0)
    expect(archive.reads.every(cursor => cursor >= 0 && cursor < 5_000)).toBe(true)
  })

  it('keeps archive order when the conversation opens with an assistant greeting', async () => {
    // Defect guarded: the anchor was placed first and the rest after it, so the
    // greeting that came BEFORE the first user turn was moved to after it.
    const messages = [
      turn(0, 'assistant', 'Hello, how can I help?'),
      turn(1, 'user', 'What is a monad?'),
      turn(2, 'assistant', 'A monad is a design pattern.'),
    ]
    const { plan: built } = await plan(messages)
    expect(ids(built)).toEqual(['msg-0000', 'msg-0001', 'msg-0002'])
  })

  it('anchors on the first USER turn, dropping an assistant greeting that does not fit', async () => {
    const messages = [
      turn(0, 'assistant', 'Hello, how can I help?'),
      ...alternating(300, 200).map((message, index) => ({
        ...message,
        messageId: `msg-${String(index + 1).padStart(4, '0')}`,
      })),
    ]
    const { plan: built } = await plan(messages, { maxBytes: 30_000 })
    expect(ids(built)[0]).toBe('msg-0001')
    expect(ids(built)).not.toContain('msg-0000')
    expect(built.window.omitted).toBe(built.window.total - built.window.messages.length)
  })

  it('finds the first user turn on a later page when the opening pages carry no text', async () => {
    const toolOnly = (index: number): FixtureMessage =>
      turn(index, 'assistant', '', { extraParts: [{ kind: 'tool', content: { name: 'search' } }] })
    const messages = [
      ...Array.from({ length: 70 }, (_, index) => toolOnly(index)),
      turn(70, 'user', 'Finally, a question.', { at: Date.UTC(2026, 0, 5, 12, 0) }),
      ...Array.from({ length: 19 }, (_, index) => turn(71 + index, index % 2 === 0 ? 'assistant' : 'user', `later ${index}`)),
    ]
    const { plan: built } = await plan(messages)
    const carried = ids(built)
    expect(carried[0]).toBe('msg-0070')
    // The anchor sits inside the tail here: it is carried once, not twice.
    expect(new Set(carried).size).toBe(carried.length)
    expect(carried).toHaveLength(20)
    expect(built.window.total).toBe(90)
    expect(built.window.omitted).toBe(70)
  })

  it('cuts one message longer than the per-message cap and says so in its text', async () => {
    const messages = [turn(0, 'user', 'Short question.'), turn(1, 'assistant', 'y'.repeat(60_000))]
    const { plan: built } = await plan(messages, { maxMessageChars: 5_000 })
    const last = built.window.messages.at(-1)!
    expect(last.text.startsWith('y'.repeat(5_000))).toBe(true)
    expect(last.text).toContain('55,000 more characters of this message are not included')
    expect(last.text.length).toBeLessThan(5_200)
  })

  it('keeps the most recent turn, cut to fit, rather than send a conversation without its end', async () => {
    const messages = [turn(0, 'user', 'A question.'), turn(1, 'assistant', 'z'.repeat(80_000))]
    const cap = 9_000
    const { plan: built } = await plan(messages, { maxBytes: cap, maxMessageChars: 200_000 })
    expect(ids(built)).toEqual(['msg-0000', 'msg-0001'])
    expect(built.window.messages[1].text).toContain('more characters of this message are not included')
    expect(serializedBytes(seedPayloadFor(built))).toBeLessThanOrEqual(cap)
  })

  it('counts JSON escaping against the cap: quotes and newlines double in size on the wire', async () => {
    // Defect guarded: bytes were counted on the raw text, so a message full of
    // quotes and line breaks serialised to roughly twice the size the cap allowed.
    const nasty = '"\n'.repeat(3_000)
    const messages = [
      turn(0, 'user', nasty),
      turn(1, 'assistant', nasty),
      turn(2, 'user', nasty),
      turn(3, 'assistant', nasty),
      turn(4, 'user', nasty),
      turn(5, 'assistant', nasty),
    ]
    const cap = 14_000
    const { plan: built } = await plan(messages, { maxBytes: cap, maxMessageChars: 200_000 })
    expect(serializedBytes(seedPayloadFor(built))).toBeLessThanOrEqual(cap)
    expect(built.window.messages.length).toBeGreaterThan(0)
  })

  it('never splits a character that takes two code units when it cuts', async () => {
    const face = '\u{1F600}'
    const messages = [turn(0, 'user', 'Hi.'), turn(1, 'assistant', face.repeat(3_000))]
    // 2,001 is odd: the cut would land between the halves of an emoji.
    const { plan: built } = await plan(messages, { maxMessageChars: 2_001 })
    const text = built.window.messages[1].text
    const kept = text.slice(0, text.indexOf('\n\n[…'))
    expect(kept).toBe(face.repeat(1_000))
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(kept)).toBe(false)
  })

  it('counts a very long title against the cap too', async () => {
    const archive = new MemoryArchive(alternating(40, 400))
    const cap = 12_000
    const built = await readContinuationPlan(
      archive,
      { ...INTENT, title: 'T'.repeat(4_000) },
      { limits: { maxBytes: cap, maxMessageChars: 24_000 }, roster: ROSTER },
    )
    expect(serializedBytes(seedPayloadFor(built))).toBeLessThanOrEqual(cap)
  })
})

describe('what leaves the browser: text of user and assistant turns, nothing else', () => {
  it('never carries reasoning, tool traces, attachments, deleted messages or non-conversation roles', async () => {
    const messages: FixtureMessage[] = [
      turn(0, 'user', 'Please look this up.', {
        extraParts: [{ kind: 'file', content: { name: 'private-notes.pdf' } }],
      }),
      turn(1, 'assistant', 'Here is what I found.', {
        extraParts: [
          { kind: 'reasoning', content: 'PRIVATE-CHAIN-OF-THOUGHT' },
          { kind: 'tool', content: { name: 'search', input: 'PRIVATE-TOOL-INPUT' } },
        ],
      }),
      turn(2, 'user', 'A deleted turn.', { state: 'deleted' }),
      turn(3, 'assistant', 'A system note.', { role: 'system' }),
      turn(4, 'assistant', 'A tool message.', { role: 'tool' }),
      turn(5, 'user', 'Thanks.'),
    ]
    const { plan: built } = await plan(messages)
    expect(built.window.messages.map(message => message.text)).toEqual([
      'Please look this up.',
      'Here is what I found.',
      'Thanks.',
    ])
    const wire = JSON.stringify(seedPayloadFor(built))
    for (const secret of ['PRIVATE-CHAIN-OF-THOUGHT', 'PRIVATE-TOOL-INPUT', 'private-notes.pdf', 'A deleted turn', 'A system note']) {
      expect(wire).not.toContain(secret)
    }
    // What was left out is still counted as not included.
    expect(built.window.total).toBe(6)
    expect(built.window.omitted).toBe(3)
  })

  it('joins the text parts of one message and drops empty ones', async () => {
    const message: FixtureMessage = {
      ...turn(0, 'user', 'First part.'),
      parts: [
        { partId: 'a', kind: 'text', mediaType: 'text/markdown', content: '  First part.  ' },
        { partId: 'b', kind: 'text', mediaType: 'text/markdown', content: '   ' },
        { partId: 'c', kind: 'text', mediaType: 'text/markdown', content: 'Second part.' },
      ],
    }
    const { plan: built } = await plan([message, turn(1, 'assistant', 'Reply.')])
    expect(built.window.messages[0].text).toBe('First part.\n\nSecond part.')
  })
})

describe('reading fails visibly and typed, never quietly short', () => {
  it('names an unreadable archive', async () => {
    const archive = new MemoryArchive(alternating(10), { failAtCursor: 0 })
    const failure = await readContinuationPlan(archive, INTENT).catch(error => error)
    expect(failure).toBeInstanceOf(ContinuationError)
    expect(failure).toMatchObject({ code: 'archive-unavailable' })
    expect((failure as Error).message).toMatch(/could not be loaded/)
  })

  it('names an archive that fails on a later page', async () => {
    const archive = new MemoryArchive(alternating(400, 300), { failAtCursor: 350 })
    const failure = await readContinuationPlan(archive, INTENT, {
      limits: { maxBytes: 40_000, maxMessageChars: 24_000 },
    }).catch(error => error)
    expect(failure).toMatchObject({ code: 'archive-unavailable' })
  })

  it('refuses a page that came back with messages missing', async () => {
    const archive = new MemoryArchive(alternating(120), { shortAtCursor: 0 })
    const failure = await readContinuationPlan(archive, INTENT).catch(error => error)
    expect(failure).toMatchObject({ code: 'archive-page-short' })
  })

  it('says so when there is no text to carry over', async () => {
    const toolOnly = Array.from({ length: 4 }, (_, index) =>
      turn(index, 'assistant', '', { extraParts: [{ kind: 'tool', content: {} }] }))
    const failure = await plan(toolOnly).catch(error => error)
    expect(failure).toMatchObject({ code: 'empty-window' })
  })
})

describe('the same bytes are shown and sent', () => {
  it('renders the window read-only in the order, text and time that are sent', async () => {
    const at = Date.UTC(2026, 7, 2, 15, 0)
    const messages = [
      turn(0, 'user', 'What is a monad?', { at }),
      turn(1, 'assistant', 'A monad is a design pattern.', { at: at + 30_000 }),
      turn(2, 'user', 'And a functor?'),
    ]
    const { plan: built } = await plan(messages)
    const shown = windowToChatMessages(built.window.messages)
    const sent = seedPayloadFor(built).messages
    expect(shown.map(message => message.content)).toEqual(sent.map(message => message.text))
    expect(shown.map(message => message.role)).toEqual(sent.map(message => message.role))
    expect(shown.every(message => message.origin === 'window' && !message.isStreaming)).toBe(true)
    expect(shown[0].createdAt).toBe(at)
    expect(shown[1].createdAt).toBe(at + 30_000)
    // A time the source never recorded stays unknown (0): never the clock's "now".
    expect(shown[2].createdAt).toBe(0)
    expect(sent[2].occurredAt).toBeNull()
    expect(sent[0].occurredAt).toBe(new Date(at).toISOString())
    expect(sent[1].occurredAt).toBe(new Date(at + 30_000).toISOString())
  })

  it('gives every shown message an id that cannot collide with a live one', async () => {
    const { plan: built } = await plan(alternating(4))
    const shown = windowToChatMessages(built.window.messages)
    expect(new Set(shown.map(message => message.id)).size).toBe(4)
    expect(shown.every(message => message.id.startsWith('window:'))).toBe(true)
  })

  it('is exactly `sophia.chat-seed.v1` and its messages, and nothing else: the store reads those keys and no others', async () => {
    // The live seed store (Choreograph e9a2948) reads `schema` and `messages[{ role, text, occurredAt, voice: { model } }]`.
    // A body that adds `source`, `total` or `omitted`, or spells a date `at`, is read as a conversation with no dates and
    // no recorded model, and is told so to the model; the counts and the lineage travel on the launch, not in the body.
    const at = Date.UTC(2026, 7, 2, 15, 0)
    const { plan: built } = await plan([
      turn(0, 'user', 'What is a monad?', { at }),
      turn(1, 'assistant', 'A design pattern.', { at: at + 30_000, voice: { id: 'moonshotai/kimi-k2.5', provider: 'opencode' } }),
      turn(2, 'user', 'And a functor?'),
      turn(3, 'assistant', 'Something that maps.'),
    ])
    const payload = seedPayloadFor(built)
    expect(Object.keys(payload).sort()).toEqual(['messages', 'schema'])
    expect(payload).toEqual({
      schema: 'sophia.chat-seed.v1',
      messages: [
        { role: 'user', text: 'What is a monad?', occurredAt: new Date(at).toISOString() },
        { role: 'assistant', text: 'A design pattern.', occurredAt: new Date(at + 30_000).toISOString(), voice: { model: 'moonshotai/kimi-k2.5' } },
        { role: 'user', text: 'And a functor?', occurredAt: null },
        { role: 'assistant', text: 'Something that maps.', occurredAt: null },
      ],
    })
  })

  it('names a voice only where the source recorded one, and only on an assistant message', async () => {
    const { plan: built } = await plan([
      turn(0, 'user', 'Q'),
      turn(1, 'assistant', 'recorded', { voice: { id: 'moonshotai/kimi-k2.5' } }),
      turn(2, 'user', 'Q2'),
      turn(3, 'assistant', 'not recorded'),
    ])
    const sent = seedPayloadFor(built).messages
    expect(sent.map(message => 'voice' in message)).toEqual([false, true, false, false])
    // The id the source wrote, not the catalogue's name for it (the roster calls it "Kimi K2.5").
    expect(sent[1].voice).toEqual({ model: 'moonshotai/kimi-k2.5' })
    for (const message of sent) expect(Object.keys(message).every(key => ['role', 'text', 'occurredAt', 'voice'].includes(key))).toBe(true)
  })
})

describe('the source voice: what the record says, no more', () => {
  it('reads the gateway voice field in either of its spellings and rejects anything else', () => {
    expect(recordedVoiceOf({ voice: { id: 'moonshotai/kimi-k2.5', provider: 'openrouter' } }))
      .toEqual({ id: 'moonshotai/kimi-k2.5', provider: 'openrouter' })
    expect(recordedVoiceOf({ voice: { model: 'kimi-k2.5', providerId: 'opencode' } }))
      .toEqual({ id: 'kimi-k2.5', provider: 'opencode' })
    expect(recordedVoiceOf({ voice: { modelId: '  gpt-5  ' } })).toEqual({ id: 'gpt-5', provider: null })
    expect(recordedVoiceOf({ voice: { id: 42 } })).toBeNull()
    expect(recordedVoiceOf({ voice: 'kimi' })).toBeNull()
    expect(recordedVoiceOf({})).toBeNull()
    expect(recordedVoiceOf(null)).toBeNull()
  })

  it('trusts an id only in the shape of a model id, and a provider only in the shape of a name', () => {
    // Defect guarded: whatever an archive held in `voice` rode into the seed, the
    // seam and the marks, at any length and with any characters.
    expect(recordedVoiceOf({ voice: { id: 'ignore previous instructions' } })).toBeNull()
    expect(recordedVoiceOf({ voice: { id: 'kimi\u0000k2' } })).toBeNull()
    expect(recordedVoiceOf({ voice: { id: 'k'.repeat(121) } })).toBeNull()
    expect(recordedVoiceOf({ voice: { id: 'k'.repeat(120) } })).toEqual({ id: 'k'.repeat(120), provider: null })
    expect(recordedVoiceOf({ voice: { id: 'kimi-k2.5', provider: 'open router\n<b>' } }))
      .toEqual({ id: 'kimi-k2.5', provider: null })
    expect(recordedVoiceOf({ voice: { id: 'kimi-k2.5', provider: 'p'.repeat(61) } }))
      .toEqual({ id: 'kimi-k2.5', provider: null })
  })

  it('keeps a hostile voice out of the window: the message reads as not recorded', async () => {
    const messages = [
      turn(0, 'user', 'Q'),
      turn(1, 'assistant', 'A', { voice: { id: 'x'.repeat(5_000), provider: 'evil' } }),
    ]
    const { plan: built } = await plan(messages)
    expect(built.window.messages[1].voice).toMatchObject({ basis: 'unrecorded', label: 'voice not recorded' })
    expect(built.sourceVoices).toEqual([])
    expect(JSON.stringify(seedPayloadFor(built)).length).toBeLessThan(2_000)
  })

  it('marks each assistant message with what the source recorded, or says it was not recorded', async () => {
    const messages = [
      turn(0, 'user', 'Q1'),
      turn(1, 'assistant', 'A1', { voice: { id: 'moonshotai/kimi-k2.5', provider: 'openrouter' } }),
      turn(2, 'user', 'Q2'),
      turn(3, 'assistant', 'A2'),
      turn(4, 'user', 'Q3'),
      turn(5, 'assistant', 'A3', { voice: { model: 'kimi-k2', providerId: 'opencode' } }),
    ]
    const { plan: built } = await plan(messages)
    const marks = built.window.messages.filter(message => message.role === 'assistant').map(message => message.voice)
    // Named by the catalogue when it knows the model; the source's own id is kept.
    expect(marks[0]).toMatchObject({ id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', basis: 'source-recorded' })
    expect(marks[1]).toMatchObject({ id: null, label: 'voice not recorded', basis: 'unrecorded' })
    // A model the catalogue does not carry is named by the source's own id, not a neighbour's.
    expect(marks[2]).toMatchObject({ id: 'kimi-k2', label: 'kimi-k2', basis: 'source-recorded' })
    // User turns carry no voice.
    expect(built.window.messages.filter(message => message.role === 'user').every(message => message.voice === undefined)).toBe(true)
  })

  it('lists the source models, most recently heard last', async () => {
    const messages = [
      turn(0, 'user', 'Q'),
      turn(1, 'assistant', 'A', { voice: { id: 'moonshotai/kimi-k2.5' } }),
      turn(2, 'user', 'Q'),
      turn(3, 'assistant', 'A', { voice: { id: 'moonshotai/kimi-k2.6' } }),
      turn(4, 'user', 'Q'),
      turn(5, 'assistant', 'A', { voice: { id: 'moonshotai/kimi-k2.5' } }),
    ]
    const { plan: built } = await plan(messages)
    expect(built.sourceVoices.map(voice => voice.id)).toEqual(['moonshotai/kimi-k2.6', 'moonshotai/kimi-k2.5'])
    // The seed names the model on each message it spoke, and has no list of its own.
    expect(seedPayloadFor(built).messages.flatMap(message => message.voice?.model ?? []))
      .toEqual(['moonshotai/kimi-k2.5', 'moonshotai/kimi-k2.6', 'moonshotai/kimi-k2.5'])
  })

  it('dates the plan by what the source recorded', async () => {
    const first = Date.UTC(2026, 0, 5, 12, 0)
    const last = Date.UTC(2026, 0, 9, 18, 30)
    const messages = [
      turn(0, 'user', 'Q', { at: first }),
      turn(1, 'assistant', 'A', { at: first + 1_000 }),
      turn(2, 'user', 'Q2', { at: last }),
    ]
    const { plan: built } = await plan(messages)
    expect(built.firstAt).toBe(new Date(first).toISOString())
    expect(built.lastAt).toBe(new Date(last).toISOString())
    const undated = await plan([turn(0, 'user', 'Q'), turn(1, 'assistant', 'A')])
    expect(undated.plan.firstAt).toBeNull()
    expect(undated.plan.lastAt).toBeNull()
  })

  it('names a mark from the catalogue only when the catalogue carries that very model', () => {
    const exact = sourceVoiceMark({ id: 'moonshotai/kimi-k2.5', provider: 'opencode' }, ROSTER)
    expect(exact).toMatchObject({ id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', provider: 'Moonshot', basis: 'source-recorded' })
    const neighbour = sourceVoiceMark({ id: 'kimi-k2', provider: 'opencode' }, ROSTER)
    expect(neighbour).toEqual({ id: 'kimi-k2', label: 'kimi-k2', provider: 'opencode', basis: 'source-recorded' })
  })
})

describe('matching the source voice to today’s catalogue', () => {
  it('finds the exact model, whichever maker’s slug it wears', () => {
    expect(matchSourceVoice({ id: 'moonshotai/kimi-k2.5', provider: null }, ROSTER)).toMatchObject({
      kind: 'exact',
      model: { id: 'moonshotai/kimi-k2.5' },
    })
    // The old garden wrote bare ids.
    expect(matchSourceVoice({ id: 'kimi-k2.6', provider: 'opencode' }, ROSTER)).toMatchObject({
      kind: 'exact',
      model: { id: 'moonshotai/kimi-k2.6' },
    })
    expect(matchSourceVoice({ id: 'MoonshotAI/Kimi-K2.5', provider: null }, ROSTER)).toMatchObject({ kind: 'exact' })
  })

  it('offers the House default as the same voice when that is what the source recorded', () => {
    expect(matchSourceVoice({ id: 'google/gemini-2.5-flash', provider: 'openrouter' }, ROSTER)).toMatchObject({
      kind: 'exact',
      model: { id: 'google/gemini-2.5-flash', house: true },
    })
  })

  it('names the closest model in the same family when the exact one is gone, newest among equals', () => {
    const kimi = matchSourceVoice({ id: 'kimi-k2.6-thinking', provider: 'opencode' }, ROSTER)
    expect(kimi).toMatchObject({ kind: 'closest', model: { id: 'moonshotai/kimi-k2.6' } })
    const old = matchSourceVoice({ id: 'kimi-k2', provider: 'opencode' }, ROSTER)
    expect(old.kind).toBe('closest')
    const sonnet = matchSourceVoice({ id: 'claude-sonnet-4-5', provider: 'anthropic' }, ROSTER)
    expect(sonnet).toMatchObject({ kind: 'closest', model: { id: 'anthropic/claude-sonnet-4.5' } })
  })

  it('offers nothing rather than inventing a neighbour', () => {
    expect(matchSourceVoice({ id: 'llama-3-70b', provider: null }, ROSTER)).toEqual({
      kind: 'none',
      source: { id: 'llama-3-70b', provider: null },
    })
    expect(matchSourceVoice(null, ROSTER)).toEqual({ kind: 'none', source: null })
    expect(matchSourceVoice({ id: '', provider: null }, ROSTER).kind).toBe('none')
    expect(matchSourceVoice({ id: 'kimi-k2.5', provider: null }, [])).toMatchObject({ kind: 'none' })
  })

  it('never offers a voice the person cannot pick', () => {
    const roster = ROSTER.map(model =>
      model.id === 'moonshotai/kimi-k2.5' ? { ...model, disabled: true, disabledReason: 'Not on the allowlist' } : model)
    const match = matchSourceVoice({ id: 'moonshotai/kimi-k2.5', provider: null }, roster)
    expect(match.kind).toBe('closest')
    expect(match).not.toMatchObject({ model: { id: 'moonshotai/kimi-k2.5' } })
  })

  it('reads a model family up to its first version digit', () => {
    expect(familyOf('moonshotai/kimi-k2.5')).toBe('kimi-k')
    expect(familyOf('kimi-k3')).toBe('kimi-k')
    expect(familyOf('claude-sonnet-4-5')).toBe('claude-sonnet')
    expect(familyOf('gpt-5.2')).toBe('gpt')
    expect(familyOf('qwen3-coder')).toBe('qwen')
    expect(familyOf('o3-mini')).toBe('')
  })
})

describe('matching the models the old garden really recorded (the backfill’s own list, 2026-10-01)', () => {
  // The backfill applied at 16:58 on 2026-10-01 recovered 4,784 assistant voices in 582 conversations: bare ids, the
  // legacy platform's provider ("mnemosyne"), Anthropic's ids spelt with a hyphen where the catalogue writes a dot
  // (`claude-sonnet-4-5` against `anthropic/claude-sonnet-4.5`). Defect guarded: against the real catalogue, which carries
  // Sonnet 4, 4.5 and 4.6 and Opus 4.1 to 4.8, a conversation that ended on Claude Sonnet 4.5 was offered "Closest
  // available: Claude Sonnet 4.6" (the nearest name was the one with the same prefix up to the dot, and the newest won the
  // tie), and one that ended on Opus 4.5 or 4.7 was offered Opus 4.8: a different, newer and dearer model, with the
  // identical one on offer a hyphen away.
  const REAL_ROSTER: ChatModelOption[] = [
    priced('google/gemini-2.5-flash', 'Gemini 2.5 Flash', { house: true }),
    priced('google/gemini-3-flash-preview', 'Gemini 3 Flash Preview'),
    priced('moonshotai/kimi-k2', 'Kimi K2'),
    priced('moonshotai/kimi-k2.5', 'Kimi K2.5'),
    priced('moonshotai/kimi-k2.6', 'Kimi K2.6'),
    priced('anthropic/claude-sonnet-4', 'Claude Sonnet 4'),
    priced('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5'),
    priced('anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6'),
    priced('anthropic/claude-haiku-4.5', 'Claude Haiku 4.5'),
    priced('anthropic/claude-opus-4.1', 'Claude Opus 4.1'),
    priced('anthropic/claude-opus-4.5', 'Claude Opus 4.5'),
    priced('anthropic/claude-opus-4.6', 'Claude Opus 4.6'),
    priced('anthropic/claude-opus-4.7', 'Claude Opus 4.7'),
    priced('anthropic/claude-opus-4.8', 'Claude Opus 4.8'),
    priced('openai/gpt-5', 'GPT-5'),
    priced('openai/gpt-5.2', 'GPT-5.2'),
    priced('openai/gpt-5.2-codex', 'GPT-5.2-Codex'),
    priced('minimax/minimax-m2.1', 'MiniMax M2.1'),
  ]
  const recorded: ReadonlyArray<readonly [string, 'exact' | 'closest' | 'none', string | null]> = [
    ['kimi-k2.6', 'exact', 'moonshotai/kimi-k2.6'],
    ['kimi-k2.5', 'exact', 'moonshotai/kimi-k2.5'],
    ['claude-sonnet-4-5', 'closest', 'anthropic/claude-sonnet-4.5'],
    ['claude-haiku-4-5', 'closest', 'anthropic/claude-haiku-4.5'],
    ['claude-opus-4-5', 'closest', 'anthropic/claude-opus-4.5'],
    ['claude-opus-4-7', 'closest', 'anthropic/claude-opus-4.7'],
    ['claude-opus-4-8', 'closest', 'anthropic/claude-opus-4.8'],
    ['gpt-5', 'exact', 'openai/gpt-5'],
    ['gpt-5.2', 'exact', 'openai/gpt-5.2'],
    ['gpt-5.2-codex', 'exact', 'openai/gpt-5.2-codex'],
    ['kimi-k2.5-free', 'closest', 'moonshotai/kimi-k2.5'],
    ['gemini-3-flash', 'closest', 'google/gemini-3-flash-preview'],
    ['minimax-m2.1-free', 'closest', 'minimax/minimax-m2.1'],
    ['big-pickle', 'none', null],
    ['trinity-large-preview-free', 'none', null],
    ['alpha-g5', 'none', null],
    ['claude-3-5-haiku', 'none', null],
  ]

  it.each(recorded)('%s is offered as %s: %s', (id, kind, offered) => {
    const match = matchSourceVoice({ id, provider: 'mnemosyne' }, REAL_ROSTER)
    expect(match.kind).toBe(kind)
    if (offered) expect(match).toMatchObject({ model: { id: offered } })
    else expect(match).not.toHaveProperty('model')
  })

  it('keeps the source’s own id on the mark whatever the catalogue calls the model', () => {
    for (const [id] of recorded) {
      expect(sourceVoiceMark({ id, provider: 'mnemosyne' }, REAL_ROSTER)).toMatchObject({ id, basis: 'source-recorded' })
    }
  })
})

describe('the words around the seam', () => {
  it('names where the window goes: the maker, through OpenRouter', () => {
    expect(providerNoticeFor(ROSTER[2])).toBe('Continuing sends this conversation to Moonshot through OpenRouter.')
    expect(providerNoticeFor(ROSTER[0])).toBe('Continuing sends this conversation to Google through OpenRouter.')
  })

  it('still names the route when the voice is not known', () => {
    expect(providerNoticeFor(null)).toMatch(/^Continuing sends this conversation to OpenRouter/)
  })

  it('names the new voice on the seam, by its catalogue name or, failing that, its id', () => {
    expect(seamVoiceLabel(ROSTER[2], 'moonshotai/kimi-k2.6')).toBe('Kimi K2.6')
    expect(seamVoiceLabel(null, 'moonshotai/kimi-k2.6')).toBe('kimi-k2.6')
  })
})
