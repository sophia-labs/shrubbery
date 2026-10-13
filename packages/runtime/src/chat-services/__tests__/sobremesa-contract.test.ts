/**
 * What the SPA reads of the voice catalogue, held to `C-choreograph-return.md` 1.7 (NO MOCKS,
 * no DOM, no service: a plain body in, a roster out).
 *
 * The catalogue is `choreograph.chat-models.v1`. Anything else answering at that route is NOT a
 * picker: the gateway's own `/chat/models` (its old projection: a fixed field set, float prices,
 * no word on which models a launch would admit) answers there today and must never be listed
 * as if it were. Each test names the defect it guards.
 */
import { describe, expect, it } from 'vitest'
import {
  VOICE_CATALOGUE_PATH,
  VOICE_CATALOGUE_SCHEMA,
  continuedTitle,
  parseBalance,
  parseCatalogue,
  parseSeedReceipt,
  seedInput,
  windowLimitsFrom,
} from '../sobremesa-contract.js'
import { DEFAULT_WINDOW_LIMITS } from '../continuation.js'
import { LIVE_HOST_LIMITS, workspaceWorkflow } from './fixtures/choreograph-sim.js'
import { LIVE_CATALOGUE_ROUTE_TODAY } from './fixtures/live-20260929.js'
import { chatModelsBody, premiumVoiceRow, voiceCatalogue, wireRow } from './fixtures/sobremesa-routes.js'

describe('where the catalogue is and what it is called', () => {
  it('is the gateway root’s /chat/models?view=chat, not a graph route, and says how many it wants', () => {
    expect(VOICE_CATALOGUE_PATH).toBe('/chat/models?view=chat&limit=1000')
    expect(VOICE_CATALOGUE_PATH.startsWith('/g/')).toBe(false)
    expect(VOICE_CATALOGUE_SCHEMA).toBe('choreograph.chat-models.v1')
  })
})

describe('parseCatalogue — the voices as Choreograph lists them', () => {
  it('turns each row into a voice: named without its maker, priced as the person pays, House marked', () => {
    const catalogue = parseCatalogue(chatModelsBody(voiceCatalogue()))!
    expect(catalogue).not.toBeNull()
    const [house, k25, k26] = catalogue.voices
    // "Google: Gemini 2.5 Flash" is grouped under Google already: the maker is not said twice.
    expect(house).toMatchObject({
      id: 'google/gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      house: true,
      note: 'House default · via OpenRouter',
      priceInPerMTok: 0.36,
      priceOutPerMTok: 3,
      contextLength: 1_048_576,
      supportsTools: true,
    })
    expect(k25).toMatchObject({ id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', priceInPerMTok: 0.54, priceOutPerMTok: 2.7 })
    expect(k26).toMatchObject({ label: 'Kimi K2.6', priceInPerMTok: 0.78, priceOutPerMTok: 4.092 })
    expect(catalogue.voices.every(voice => voice.disabled !== true)).toBe(true)
  })

  it('never puts "openrouter" where a maker belongs: the route is not the maker', () => {
    // Defect avoided: `provider` on the wire is the route ("openrouter"). Read as the maker it
    // would file every voice in one group and leave the picker with a single button.
    const { voices } = parseCatalogue(chatModelsBody(voiceCatalogue()))!
    expect(voices.every(voice => voice.provider === undefined)).toBe(true)
  })

  it('says so on a voice whose price rises with the prompt, and only on that one', () => {
    const { voices } = parseCatalogue(chatModelsBody(voiceCatalogue()))!
    expect(voices.find(voice => voice.id === 'anthropic/claude-sonnet-4.5')!.note).toBe('Price rises for long prompts')
    expect(voices.find(voice => voice.id === 'moonshotai/kimi-k3')!.note).toBeUndefined()
  })

  it('keeps a name with no maker in front of it as it is, and a name it cannot use falls back to the id', () => {
    const named = wireRow({ id: 'x/plain', label: 'Plain', priceInPerMTok: 1, priceOutPerMTok: 2 })
    const { voices } = parseCatalogue({
      ...chatModelsBody([]),
      models: [{ ...named, name: 'Plain Name' }, { ...named, id: 'x/blank', name: '' }, { ...named, id: 'x/colon', name: 'Maker: ' }],
    })!
    expect(voices.map(voice => voice.label)).toEqual(['Plain Name', 'blank', 'Maker:'])
  })

  it('carries the fee the prices already include, so the picker can say it', () => {
    expect(parseCatalogue(chatModelsBody(voiceCatalogue()))!.feePercent).toBe(20)
    expect(parseCatalogue(chatModelsBody(voiceCatalogue(), { markupPercent: 25 }))!.feePercent).toBe(25)
    const noFee = { ...chatModelsBody(voiceCatalogue()), pricing: undefined }
    expect(parseCatalogue(noFee)!.feePercent).toBeNull()
  })

  it('lists a voice with a price missing, or that cannot use tools, but disabled and with its reason', () => {
    const half = wireRow({ id: 'a/half', label: 'Half', priceInPerMTok: 1, priceOutPerMTok: null })
    const none = wireRow({ id: 'a/none', label: 'None', priceInPerMTok: null, priceOutPerMTok: null })
    const bare = wireRow({ id: 'a/bare', label: 'Bare', priceInPerMTok: 1, priceOutPerMTok: 2, supportsTools: false })
    const { voices } = parseCatalogue({ ...chatModelsBody([]), models: [half, none, bare] })!
    expect(voices.find(voice => voice.id === 'a/half')).toMatchObject({ disabled: true, disabledReason: expect.stringMatching(/no price/i) })
    expect(voices.find(voice => voice.id === 'a/none')).toMatchObject({ disabled: true, disabledReason: expect.stringMatching(/no price/i) })
    expect(voices.find(voice => voice.id === 'a/bare')).toMatchObject({ disabled: true, disabledReason: expect.stringMatching(/tools/i) })
  })

  it('drops a row with no id, a repeated id, and an id no request could carry', () => {
    const good = wireRow(premiumVoiceRow())
    const { voices } = parseCatalogue({
      ...chatModelsBody([]),
      models: [good, good, { ...good, id: '' }, { ...good, id: 'x'.repeat(201) }, 'not a row', null],
    })!
    expect(voices.map(voice => voice.id)).toEqual(['openai/gpt-5.4-pro'])
  })
})

describe('parseCatalogue — what is not the catalogue', () => {
  it('refuses the gateway’s own old projection, which has no schema and lists what a launch would refuse', () => {
    // Defect guarded: `GET /chat/models` answers today with the gateway's fixed projection of
    // every model OpenRouter lists (batch routes, free models, float prices). A picker built from
    // it would offer voices admission refuses, at prices nobody is charged.
    const legacy = {
      models: [
        { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', context_length: 1_048_576, pricing: { prompt: 3e-7, completion: 2.5e-6 } },
        { id: 'openai/gpt-5.4-pro:batch', name: 'OpenAI: GPT-5.4 Pro (batch)', pricing: { prompt: 1.5e-5, completion: 9e-5 } },
      ],
    }
    expect(parseCatalogue(legacy)).toBeNull()
    expect(parseCatalogue([legacy.models[0]])).toBeNull()
  })

  it('refuses what the live gateway answers at that route TODAY: real rows of its old projection', () => {
    // Read from production on 2026-09-30 with the probe account (fixtures/live-20260929.ts): 200, `{ health,
    // models }`, 456 models, snake_case, per-token prices, no schema. Not the catalogue, and nothing here may list it.
    expect(LIVE_CATALOGUE_ROUTE_TODAY.models).toHaveLength(3)
    expect(parseCatalogue(LIVE_CATALOGUE_ROUTE_TODAY)).toBeNull()
  })

  it('refuses another schema, a stale catalogue, and a body with no list of models', () => {
    const good = chatModelsBody(voiceCatalogue())
    expect(parseCatalogue({ ...good, schema: 'choreograph.chat-models.v2' })).toBeNull()
    expect(parseCatalogue({ ...good, stale: true })).toBeNull()
    expect(parseCatalogue({ ...good, models: undefined })).toBeNull()
    expect(parseCatalogue({ ...good, models: 'many' })).toBeNull()
    expect(parseCatalogue(null)).toBeNull()
    expect(parseCatalogue('choreograph.chat-models.v1')).toBeNull()
    expect(parseCatalogue(undefined)).toBeNull()
  })

  it('offers nothing when the catalogue says the House default would be refused', () => {
    // Defect guarded: with House not admissible, a chat started with no voice named is refused by
    // the host (`model_house_default_unavailable`); a picker that showed House as the default
    // would send people into that refusal.
    const refused = chatModelsBody(voiceCatalogue(), { houseAdmissible: false })
    const { voices } = parseCatalogue(refused)!
    expect(voices.some(voice => voice.house === true)).toBe(false)
  })
})

// ── the seed store and the launch input, as the live host takes them (C 1.2, 1.6) ──

const DIGEST = `sha256:${'ab'.repeat(32)}`

describe('the seed store’s receipt', () => {
  it('is read as the store writes it: a sha256 digest, the byte count and `expiresAt` in epoch milliseconds', () => {
    expect(parseSeedReceipt({ digest: DIGEST, bytes: 48_213, expiresAt: 1_790_003_600_000 }))
      .toEqual({ digest: DIGEST, bytes: 48_213, expiresAt: 1_790_003_600_000 })
    // `expiresAt` is information, not a condition: a receipt that omits it is still a receipt.
    expect(parseSeedReceipt({ digest: DIGEST, bytes: 10 })).toEqual({ digest: DIGEST, bytes: 10, expiresAt: null })
  })

  it('is refused when it is not the content address the launch must name', () => {
    // Defect guarded: whatever text came back was forwarded as the digest, and the host answered `workspace_chat_input_invalid`
    // for a conversation the person believed was carried over.
    for (const digest of ['', 'abc', `sha256:${'AB'.repeat(32)}`, `sha256:${'ab'.repeat(31)}`, `md5:${'ab'.repeat(16)}`, 42]) {
      expect(parseSeedReceipt({ digest, bytes: 10, expiresAt: 1 }), String(digest)).toBeNull()
    }
    for (const bytes of [0, -1, 1.5, '10', null, undefined]) {
      expect(parseSeedReceipt({ digest: DIGEST, bytes, expiresAt: 1 }), String(bytes)).toBeNull()
    }
    expect(parseSeedReceipt(null)).toBeNull()
    expect(parseSeedReceipt('sha256')).toBeNull()
  })
})

describe('the launch input `seed`', () => {
  const lineage = { archiveConversationUrn: `urn:sophia:conversation-archive:conversation:${'a'.repeat(64)}`, revisionId: 'b'.repeat(64) }

  it('is exactly what the host admits: digest, bytes, where it came from, the window as counts, the title', () => {
    expect(seedInput({ digest: DIGEST, bytes: 48_213, expiresAt: 1 }, lineage, { kept: 42, omitted: 118, total: 160 }, 'Ferry timetable · continued'))
      .toEqual({
        seedDigest: DIGEST,
        bytes: 48_213,
        continuesConversation: lineage,
        window: { kept: 42, omitted: 118, total: 160 },
        title: 'Ferry timetable · continued',
      })
  })

  it('carries no title key when there is none to carry (the host takes none, and derives none from the seed)', () => {
    const input = seedInput({ digest: DIGEST, bytes: 10, expiresAt: null }, lineage, { kept: 1, omitted: 0, total: 1 }, null)
    expect(Object.keys(input).sort()).toEqual(['bytes', 'continuesConversation', 'seedDigest', 'window'])
  })

  it('never states a window the host would refuse: at least one message kept, and total equal to kept plus omitted', () => {
    // The host answers 400 `workspace_chat_input_invalid` for either; the SPA refuses first, with nothing sent.
    expect(() => seedInput({ digest: DIGEST, bytes: 10, expiresAt: null }, lineage, { kept: 0, omitted: 3, total: 3 }, null)).toThrow(/window/i)
    expect(() => seedInput({ digest: DIGEST, bytes: 10, expiresAt: null }, lineage, { kept: 2, omitted: 3, total: 4 }, null)).toThrow(/window/i)
  })
})

describe('the title of a continued conversation', () => {
  it('is the old title and " · continued"', () => {
    expect(continuedTitle('Ferry timetable')).toBe('Ferry timetable · continued')
    expect(continuedTitle('  Ferry   timetable  ')).toBe('Ferry timetable · continued')
    expect(continuedTitle('')).toBe('Untitled conversation · continued')
  })

  it('stays inside the 200 characters the host takes, cutting the old title and keeping the suffix', () => {
    const title = continuedTitle('x'.repeat(500))
    expect(Array.from(title)).toHaveLength(200)
    expect(title.endsWith('… · continued')).toBe(true)
    // A character that is two code units is never split.
    const emoji = continuedTitle('\u{1F600}'.repeat(300))
    expect(Array.from(emoji)).toHaveLength(200)
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('the limits a window is built under', () => {
  it('are the registry host block’s: the seed store’s byte cap, and the characters the model is shown', () => {
    const entry = workspaceWorkflow({ seed: true, host: { limits: { seedMaxBytes: 200_000, seedRenderMaxChars: 60_000 } } })
    const limits = windowLimitsFrom(entry)
    // Under what the model is shown, and what the store takes: the host has nothing left to cut.
    expect(limits.maxBytes).toBeLessThanOrEqual(60_000)
    expect(limits.maxBytes).toBeGreaterThan(50_000)
    expect(limits.maxMessageChars).toBeLessThan(16_000)
  })

  it('are the live host’s when the entry has no host block (an older host)', () => {
    const limits = windowLimitsFrom(workspaceWorkflow({ seed: true }))
    expect(limits).toEqual(DEFAULT_WINDOW_LIMITS)
    expect(limits.maxBytes).toBeLessThanOrEqual(LIVE_HOST_LIMITS.seedRenderMaxChars)
    expect(limits.maxBytes).toBeLessThanOrEqual(LIVE_HOST_LIMITS.seedMaxBytes)
  })

  it('never exceed what the store accepts, whatever the render budget says', () => {
    const limits = windowLimitsFrom(workspaceWorkflow({ seed: true, host: { limits: { seedMaxBytes: 20_000, seedRenderMaxChars: 400_000 } } }))
    expect(limits.maxBytes).toBeLessThanOrEqual(20_000)
  })

  it('ignore a host block that is not numbers, and keep the live defaults', () => {
    const entry = { ...workspaceWorkflow({ seed: true }), host: { limits: { seedMaxBytes: 'big', seedRenderMaxChars: -5 } } }
    expect(windowLimitsFrom(entry)).toEqual(DEFAULT_WINDOW_LIMITS)
  })
})

describe('parseBalance — the balance and what the backend says beside it', () => {
  const USER = 'u-1'
  const body = { userId: USER, balanceMicroUsd: 970_000, initialized: true, can_make_requests: true }

  it('reads the balance as before', () => {
    expect(parseBalance(body, USER)).toEqual({ initialized: true, balanceMicroUsd: 970_000, canMakeRequests: true })
  })

  it('carries the credits facts when there are any', () => {
    expect(parseBalance({ ...body, feeBps: 2000, gateMode: 'enforce', creditsStartDate: '2026-10-12' }, USER)).toEqual({
      initialized: true,
      balanceMicroUsd: 970_000,
      canMakeRequests: true,
      facts: { feeBps: 2000, gateMode: 'enforce', startDate: 'October 12, 2026' },
    })
  })

  it('is no more willing to read another person’s balance for what it adds', () => {
    expect(parseBalance({ ...body, userId: 'someone-else', feeBps: 2000, gateMode: 'enforce' }, USER)).toBeNull()
  })
})
