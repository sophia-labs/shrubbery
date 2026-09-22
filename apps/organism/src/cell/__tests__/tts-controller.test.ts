import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OrganismTtsController,
  collectSpeechBlocks,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike,
  type TtsEditorHost,
} from '../tts-controller.js'

class FakeUtterance implements SpeechUtteranceLike {
  rate = 1
  lang = ''
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { readonly error?: string }) => void) | null = null
  onpause: (() => void) | null = null
  onresume: (() => void) | null = null

  constructor(readonly text: string) {}
}

class FakeSynthesis implements SpeechSynthesisLike {
  readonly spoken: FakeUtterance[] = []
  current: FakeUtterance | null = null
  cancelCount = 0
  pauseCount = 0
  resumeCount = 0

  speak(utterance: SpeechUtteranceLike): void {
    this.current = utterance as FakeUtterance
    this.spoken.push(this.current)
    this.current.onstart?.()
  }

  cancel(): void {
    this.cancelCount += 1
    const stale = this.current
    this.current = null
    stale?.onerror?.({ error: 'canceled' })
    stale?.onend?.()
  }

  pause(): void {
    this.pauseCount += 1
    this.current?.onpause?.()
  }

  resume(): void {
    this.resumeCount += 1
    this.current?.onresume?.()
  }

  finish(): void {
    const current = this.current
    this.current = null
    current?.onend?.()
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function editorHost(activeBlockId = 'block-two'): TtsEditorHost {
  const host = document.createElement('section') as TtsEditorHost & {
    liveEditor: { getActiveBlockId(): string | null }
  }
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<div class="ProseMirror">
    <h1 data-block-id="block-one">First heading</h1>
    <li data-block-id="list-outer"><p data-block-id="block-two">Second paragraph</p></li>
    <pre data-block-id="block-code"><code>const secret = true</code></pre>
    <p data-block-id="block-three">Third <button>Copy</button> paragraph</p>
  </div>`
  host.liveEditor = { getActiveBlockId: () => activeBlockId }
  document.body.append(host)
  return host
}

function controller(
  synthesis: FakeSynthesis,
  render = vi.fn(),
  storage: Storage | null = new MemoryStorage(),
): OrganismTtsController {
  return new OrganismTtsController({
    requestRender: render,
    synthesis,
    createUtterance: text => new FakeUtterance(text),
    storage,
    document,
  })
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('collectSpeechBlocks', () => {
  it('segments leaf editor blocks without duplicate wrappers, code, or control text', () => {
    const host = editorHost()
    const blocks = collectSpeechBlocks(host.shadowRoot!.querySelector('.ProseMirror'))
    expect(blocks.map(block => [block.id, block.text])).toEqual([
      ['block-one', 'First heading'],
      ['block-two', 'Second paragraph'],
      ['block-three', 'Third paragraph'],
    ])
  })
})

describe('OrganismTtsController', () => {
  it('starts at the live cursor block, advances blocks, highlights, and stops at the end', async () => {
    const synthesis = new FakeSynthesis()
    const render = vi.fn()
    const host = editorHost()
    const tts = controller(synthesis, render)
    tts.setScope('graph-a', 'doc-a')
    tts.setEditorHost(host)

    expect(tts.start()).toBe(true)
    expect(synthesis.spoken.map(item => item.text)).toEqual(['Second paragraph'])
    expect(tts.snapshot()).toMatchObject({
      status: 'playing',
      currentBlockIndex: 1,
      totalBlocks: 3,
      currentBlockText: 'Second paragraph',
      tier: 'local',
    })
    expect(host.shadowRoot!.querySelector('[data-block-id="block-two"]')?.classList)
      .toContain('tts-reading-highlight')

    synthesis.finish()
    expect(synthesis.spoken.map(item => item.text)).toEqual(['Second paragraph', 'Third paragraph'])
    expect(tts.snapshot()).toMatchObject({ status: 'playing', currentBlockIndex: 2 })

    synthesis.finish()
    expect(tts.snapshot()).toMatchObject({ status: 'idle', totalBlocks: 0 })
    expect(host.shadowRoot!.querySelector('.tts-reading-highlight')).toBeNull()
    await Promise.resolve()
    expect(render).toHaveBeenCalled()
    tts.destroy()
  })

  it('pauses, resumes, skips, restarts at a new speed, and rejects forged remote tiers', () => {
    const synthesis = new FakeSynthesis()
    const storage = new MemoryStorage()
    const tts = controller(synthesis, vi.fn(), storage)
    const host = editorHost('block-one')
    tts.setScope('graph-a', 'doc-a')
    tts.setEditorHost(host)
    tts.start(true)

    const firstSnapshot = tts.snapshot()
    firstSnapshot.onAction?.({ action: 'pause', status: 'playing' })
    expect(synthesis.pauseCount).toBe(1)
    expect(tts.snapshot().status).toBe('paused')
    tts.snapshot().onAction?.({ action: 'resume', status: 'paused' })
    expect(synthesis.resumeCount).toBe(1)
    expect(tts.snapshot().status).toBe('playing')

    tts.snapshot().onAction?.({ action: 'skip-forward', status: 'playing' })
    expect(synthesis.spoken.at(-1)?.text).toBe('Second paragraph')
    expect(tts.snapshot().currentBlockIndex).toBe(1)

    tts.snapshot().onAction?.({ action: 'speed', status: 'playing', speed: 1.5 })
    expect(synthesis.spoken.at(-1)).toMatchObject({ text: 'Second paragraph', rate: 1.5 })
    expect(JSON.parse(storage.getItem('shrubbery:tts-preferences')!)).toEqual({
      tier: 'local',
      speed: 1.5,
    })

    tts.snapshot().onAction?.({ action: 'tier', status: 'playing', tier: 'enhanced' })
    expect(tts.snapshot().tier).toBe('local')
    expect(tts.snapshot().tiers).toEqual([{ value: 'local', label: 'Browser voice' }])
    tts.destroy()
  })

  it('honors document shortcuts and cleans active speech on scope/provider teardown', () => {
    const synthesis = new FakeSynthesis()
    const render = vi.fn()
    const host = editorHost('block-three')
    const tts = controller(synthesis, render)
    tts.setScope('graph-a', 'doc-a')
    tts.setEditorHost(host)

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', ctrlKey: true }))
    expect(synthesis.spoken.at(-1)?.text).toBe('Third paragraph')
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', ctrlKey: true }))
    expect(tts.snapshot().status).toBe('paused')
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', ctrlKey: true }))
    expect(tts.snapshot().status).toBe('playing')

    tts.setScope('graph-a', 'doc-b')
    expect(tts.snapshot().status).toBe('idle')
    expect(synthesis.cancelCount).toBeGreaterThan(0)
    expect(host.shadowRoot!.querySelector('.tts-reading-highlight')).toBeNull()

    tts.destroy()
    const spoken = synthesis.spoken.length
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', ctrlKey: true }))
    expect(synthesis.spoken).toHaveLength(spoken)
  })

  it('advertises unavailable honestly when SpeechSynthesis is absent', () => {
    const tts = new OrganismTtsController({
      requestRender: vi.fn(),
      synthesis: null,
      createUtterance: null,
      storage: null,
      document,
    })
    tts.setScope('graph-a', 'doc-a')
    tts.setEditorHost(editorHost())

    expect(tts.snapshot()).toMatchObject({ available: false, status: 'idle', tier: 'local' })
    expect(tts.start()).toBe(false)
    tts.destroy()
  })
})
