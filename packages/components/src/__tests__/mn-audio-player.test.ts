/**
 * REAL mn-audio-player and mn-energy-ledger in happy-dom, on the Ovillo
 * fixture's real render data (apps/ovillo/fixture: three Ariadne pieces, their
 * peaks, energy traces and receipts). NO MOCKS of the player's own logic: the
 * engine is the real createAudioPlayer over happy-dom's real HTMLAudioElement;
 * what happy-dom cannot do (decode mp3, Web Audio, a 2D canvas) is asserted as
 * the honest absence it is (no analyser → the screen says so).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import '../mn-audio-player.js'
import '../mn-energy-ledger.js'
import type { MnAudioPlayer, MnAudioTrack, MnAudioTrackChangeDetail } from '../mn-audio-player.js'
import type { MnEnergyLedgerElement } from '../mn-energy-ledger.js'
import { createAudioPlayer } from '../audio-player.js'
import { energyAt, energyLevel, parseEnergyTrace, parsePeaks, type MnEnergyLedger } from '../audio-visuals.js'

const here = dirname(fileURLToPath(import.meta.url))
const SITE = resolve(here, '../../../../apps/ovillo/fixture/site')
const json = (rel: string): unknown => JSON.parse(readFileSync(resolve(SITE, rel), 'utf8'))

const hiloEnergy = parseEnergyTrace(json('media/hilo-de-luz.energy.json'))
const TRACKS: MnAudioTrack[] = [
  {
    id: 'https://ovillo.sophia-labs.com/id/piece/hilo-de-luz',
    title: 'Hilo de luz',
    subtitle: 'steel-string world · DADGAD',
    src: '/media/hilo-de-luz.mp3',
    duration: 53.090896,
    tags: ['pretty'],
    href: '#/piece/hilo-de-luz',
    peaks: parsePeaks(json('media/hilo-de-luz.peaks.json')),
    energy: hiloEnergy,
  },
  {
    id: 'https://ovillo.sophia-labs.com/id/piece/gigante-y-juguete',
    title: 'Gigante y juguete',
    subtitle: 'two steel-string worlds',
    src: '/media/gigante-y-juguete.mp3',
    duration: 32.7,
    tags: ['playful', 'weird'],
    peaks: parsePeaks(json('media/gigante-y-juguete.peaks.json')),
    energy: parseEnergyTrace(json('media/gigante-y-juguete.energy.json')),
  },
  {
    id: 'https://ovillo.sophia-labs.com/id/piece/agua-mansa',
    title: 'Agua mansa',
    subtitle: 'bench: simulated guitar → Ariadne World',
    src: '/media/agua-mansa.mp3',
    duration: 34,
    peaks: parsePeaks(json('media/agua-mansa.peaks.json')),
  },
]

async function mount(props: Partial<MnAudioPlayer> = {}): Promise<MnAudioPlayer> {
  const el = document.createElement('mn-audio-player') as MnAudioPlayer
  Object.assign(el, { engine: createAudioPlayer(new Audio(), { analyse: true }), tracks: TRACKS, label: 'Fixture', ...props })
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const q = <T extends Element>(el: MnAudioPlayer, sel: string): T | null => el.shadowRoot!.querySelector<T>(sel)
const qa = <T extends Element>(el: MnAudioPlayer, sel: string): T[] => [...el.shadowRoot!.querySelectorAll<T>(sel)]
const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('mn-audio-player — the playlist', () => {
  it('lists every piece with its number, tags, subtitle and duration, and the total', async () => {
    const el = await mount()
    const rows = qa<HTMLElement>(el, '.row')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.querySelector('.t b')!.textContent)).toEqual(['Hilo de luz', 'Gigante y juguete', 'Agua mansa'])
    expect(rows[0].querySelector('.n')!.textContent!.trim()).toBe('01')
    expect(rows[0].querySelector('.d')!.textContent).toBe('0:53')
    expect(rows[1].querySelector('.t span')!.textContent).toBe('playful · weird — two steel-string worlds')
    // 53.09 + 32.7 + 34 = 119.79 s
    expect(q(el, '.list-head .sum')!.textContent).toBe('3 pieces · 1:59')
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
    // Only a track with an href has an open button.
    expect(rows[0].querySelector('.open')).not.toBeNull()
    expect(rows[1].querySelector('.open')).toBeNull()
  })

  it('a click on a row plays it through the engine, and says which track it is', async () => {
    const el = await mount()
    const changes: MnAudioTrackChangeDetail[] = []
    el.addEventListener('mn-audio-track-change', (e) => changes.push((e as CustomEvent<MnAudioTrackChangeDetail>).detail))
    qa<HTMLElement>(el, '.row')[1].click()
    await el.updateComplete
    const engine = el.engine!
    expect(engine.get().track?.iri).toBe(TRACKS[1].id)
    expect(engine.element.getAttribute('src') ?? engine.element.src).toContain('/media/gigante-y-juguete.mp3')
    expect(engine.get().status).not.toBe('idle')
    expect(changes.at(-1)).toMatchObject({ id: TRACKS[1].id, index: 1, reason: 'select' })
    expect(q(el, '.title')!.textContent).toBe('Gigante y juguete')
    expect(el.dataset.trackId).toBe(TRACKS[1].id)
  })

  it('next and previous move through the play order; next by hand wraps', async () => {
    const el = await mount()
    el.next()
    await el.updateComplete
    expect(el.currentTrack?.id).toBe(TRACKS[1].id)
    el.next()
    el.next()
    await el.updateComplete
    expect(el.currentTrack?.id).toBe(TRACKS[0].id)
    el.previous()
    await el.updateComplete
    expect(el.currentTrack?.id).toBe(TRACKS[2].id)
  })

  it('the shuffle and repeat buttons toggle and say so', async () => {
    const el = await mount()
    const shuffle = q<HTMLButtonElement>(el, 'button[aria-label="Shuffle"]')!
    shuffle.click()
    await el.updateComplete
    expect(el.shuffle).toBe(true)
    expect(el.hasAttribute('shuffle')).toBe(true)
    expect(q(el, 'button[aria-label="Shuffle"]')!.getAttribute('aria-pressed')).toBe('true')
    const repeat = () => q<HTMLButtonElement>(el, '.btn[data-repeat]')!
    repeat().click()
    await el.updateComplete
    expect(el.repeat).toBe('all')
    repeat().click()
    await el.updateComplete
    expect(el.repeat).toBe('one')
    expect(repeat().getAttribute('aria-label')).toBe('Repeat: one')
  })

  it('a track that plays to its end moves on (repeat all wraps; repeat off stops after the last)', async () => {
    const el = await mount({ repeat: 'all' })
    el.play(TRACKS[2].id)
    await el.updateComplete
    el.engine!.element.dispatchEvent(new Event('ended'))
    await el.updateComplete
    expect(el.engine!.get().track?.iri).toBe(TRACKS[0].id)

    el.repeat = 'off'
    el.play(TRACKS[2].id)
    await el.updateComplete
    el.engine!.element.dispatchEvent(new Event('ended'))
    await el.updateComplete
    expect(el.engine!.get().track?.iri).toBe(TRACKS[2].id)
    expect(el.engine!.get().status).toBe('paused')
  })

  it('two players sharing one engine: only the one that started it advances', async () => {
    const engine = createAudioPlayer(new Audio(), { analyse: true })
    const a = await mount({ engine })
    const b = await mount({ engine, variant: 'single', tracks: [TRACKS[0]] })
    a.play(TRACKS[0].id)
    await a.updateComplete
    // b shows the same sound live, because the track is one of its own.
    await b.updateComplete
    expect(b.dataset.status).toBe(a.dataset.status)
    engine.element.dispatchEvent(new Event('ended'))
    await a.updateComplete
    expect(engine.get().track?.iri).toBe(TRACKS[1].id)
  })

  it('keyboard: N/P and Shift+arrows move, S shuffles, R repeats, M changes the visualizer, Z X C V B are Winamp', async () => {
    const el = await mount()
    const layout = q<HTMLElement>(el, '.layout')!
    press(layout, 'n')
    await el.updateComplete
    expect(el.currentTrack?.id).toBe(TRACKS[1].id)
    press(layout, 'ArrowLeft', { shiftKey: true })
    await el.updateComplete
    expect(el.currentTrack?.id).toBe(TRACKS[0].id)
    press(layout, 's')
    press(layout, 'r')
    await el.updateComplete
    expect(el.shuffle).toBe(true)
    expect(el.repeat).toBe('all')
    expect(el.effectiveVisualizer).toBe('energy')
    press(layout, 'm')
    await el.updateComplete
    expect(el.effectiveVisualizer).toBe('spectrum')
    press(layout, 'x')
    await el.updateComplete
    expect(el.engine!.get().track?.iri).toBe(el.currentTrack?.id)
    press(layout, 'v')
    await el.updateComplete
    expect(el.engine!.get().status).toBe('idle')
  })

  it('in the playlist, arrows move focus and Enter plays', async () => {
    const el = await mount()
    const rows = qa<HTMLElement>(el, '.row')
    rows[0].focus()
    press(rows[0], 'ArrowDown')
    expect(el.shadowRoot!.activeElement).toBe(rows[1])
    press(rows[1], 'Enter')
    await el.updateComplete
    expect(el.engine!.get().track?.iri).toBe(TRACKS[1].id)
  })

  it('open asks the shell to go to the piece', async () => {
    const el = await mount()
    let detail: unknown = null
    el.addEventListener('mn-audio-open', (e) => { detail = (e as CustomEvent).detail })
    qa<HTMLButtonElement>(el, '.open')[0].click()
    expect(detail).toEqual({ id: TRACKS[0].id, href: '#/piece/hilo-de-luz' })
    // Opening is not playing.
    expect(el.engine!.get().status).toBe('idle')
  })
})

describe('mn-audio-player — the visualizers', () => {
  it('the waveform scrubber draws the peaks, and the touches as ticks', async () => {
    const el = await mount()
    const scrub = q<HTMLElement>(el, '.scrub')!
    expect(scrub.getAttribute('role')).toBe('slider')
    expect(scrub.dataset.hasPeaks).toBe('true')
    const path = scrub.querySelector('svg.base path')!.getAttribute('d')!
    expect(path.match(/M/g)!.length).toBe(240)
    expect(scrub.querySelectorAll('svg.ticks line').length).toBe(hiloEnergy.touches.length)
    expect(scrub.getAttribute('aria-valuemax')).toBe('53')
  })

  it('energy is the default for a piece with a trace: a meter per body, the traces, a light per string', async () => {
    const el = await mount()
    expect(el.dataset.visualizer).toBe('energy')
    expect(qa(el, '.meter').map((m) => (m as HTMLElement).dataset.body)).toEqual(['strings', 'box', 'room'])
    expect(qa(el, '.meter .name').map((n) => n.textContent)).toEqual(['Strings', 'Box', 'Room'])
    expect(qa(el, '.trace polyline')).toHaveLength(3)
    expect(qa<HTMLElement>(el, '.led').map((l) => l.dataset.string)).toEqual(['6', '5', '4', '3', '2', '1'])
    expect(q(el, '.screen-caption')!.textContent).toContain("dB re the World's unit")
  })

  it('the meters follow the World’s stored energy at the playhead', async () => {
    const el = await mount()
    el.play(TRACKS[0].id)
    await el.updateComplete
    const t = 21.37
    el.seek(t)
    await el.updateComplete
    const want = energyAt(hiloEnergy, t).map((db) => energyLevel(hiloEnergy, db))
    const got = qa<HTMLElement>(el, '.meter').map((m) => Number(m.dataset.level))
    for (const [i, level] of got.entries()) expect(level).toBeCloseTo(want[i], 2)
    // The strings are sounding 21 s into a lullaby; the meters are not at the floor.
    expect(got[0]).toBeGreaterThan(0.2)
    const head = q<SVGLineElement>(el, '.trace .head')!
    expect(Number(head.getAttribute('x1'))).toBeCloseTo((t / hiloEnergy.durationSeconds) * 1000, 1)
    expect(q(el, '.scrub')!.getAttribute('aria-valuetext')).toBe('0:21 of 0:53')
  })

  it('a touch passing the playhead lights its string', async () => {
    const el = await mount()
    el.play(TRACKS[0].id)
    await el.updateComplete
    const touch = hiloEnergy.touches.find((t) => t.t > 5 && t.string !== undefined)!
    el.seek(touch.t - 0.05)
    await el.updateComplete
    // The paint loop runs off the media clock; step it across the touch the way a frame would.
    ;(el as unknown as { paintFrame(t: number, dt: number): void }).paintFrame(touch.t + 0.01, 1 / 60)
    const led = q<HTMLElement>(el, `.led[data-string="${touch.string}"]`)!
    expect(led.dataset.lit).toBe('true')
    expect(Number(led.style.opacity)).toBeGreaterThan(0.8)
  })

  it('a piece without a trace offers spectrum and scope only, and says the spectrum is live', async () => {
    const el = await mount({ selectedId: TRACKS[2].id })
    expect(el.dataset.visualizer).toBe('spectrum')
    const energyButton = q<HTMLButtonElement>(el, '.modes button[data-mode="energy"]')!
    expect(energyButton.disabled).toBe(true)
    expect(q(el, 'canvas.viz')).not.toBeNull()
    expect(q(el, '.viz-note')!.textContent!.trim()).toBe('Drawn live from the sound while it plays.')
  })

  it('a trace that fails to load says so, verbatim', async () => {
    const el = await mount({
      tracks: [{ ...TRACKS[0], energy: null, energyUrl: '/media/missing.energy.json' }],
      loader: async (url) => { throw new Error(`GET ${url} → 404`) },
    })
    await new Promise((r) => setTimeout(r, 0))
    await el.updateComplete
    expect(q(el, '.viz-note')!.textContent).toContain('GET /media/missing.energy.json → 404')
  })

  it('loads peaks and energy from the URLs a track names, through the loader', async () => {
    const asked: string[] = []
    const el = await mount({
      tracks: [{ ...TRACKS[0], peaks: null, energy: null, peaksUrl: '/media/hilo-de-luz.peaks.json', energyUrl: '/media/hilo-de-luz.energy.json' }],
      loader: async (url) => { asked.push(url); return json(url.replace(/^\//, '')) },
    })
    await new Promise((r) => setTimeout(r, 20))
    await el.updateComplete
    expect(asked.sort()).toEqual(['/media/hilo-de-luz.energy.json', '/media/hilo-de-luz.peaks.json'])
    expect(q(el, '.scrub')!.getAttribute('data-has-peaks')).toBe('true')
    expect(qa(el, '.meter')).toHaveLength(3)
  })

  it('the clock flips between elapsed and remaining', async () => {
    const el = await mount()
    el.play(TRACKS[0].id)
    el.seek(10)
    await el.updateComplete
    const clock = q<HTMLButtonElement>(el, '.clock')!
    expect(clock.querySelector('.elapsed')!.textContent).toBe('0:10')
    clock.click()
    await el.updateComplete
    expect(clock.querySelector('.elapsed')!.textContent).toBe('−0:43')
    expect(clock.querySelector('.total')!.textContent).toBe('0:53')
  })

  it('the single variant is a deck without a playlist', async () => {
    const el = await mount({ variant: 'single', tracks: [TRACKS[0]] })
    expect(q(el, '.list-card')).toBeNull()
    expect(q(el, '.deck')).not.toBeNull()
    expect(q(el, 'button[aria-label="Shuffle"]')).toBeNull()
  })
})

describe('mn-energy-ledger', () => {
  const receipt = json('receipts/gigante-y-juguete.json') as { ariadneWorlds: Array<Record<string, number | string>> }
  const ledgers: MnEnergyLedger[] = receipt.ariadneWorlds.map((w) => ({
    world: String(w.instrument),
    anatomy: String(w.anatomy),
    plucks: Number(w.plucks),
    hammerOns: Number(w.hammerOns),
    pullOffs: Number(w.pullOffs),
    slides: Number(w.slides),
    sourceWork: Number(w.sourceWork),
    controlWork: Number(w.controlWork),
    internalLoss: Number(w.internalLoss),
    radiation: Number(w.radiation),
    closureResidual: Number(w.cumulativeClosureResidual),
    maxFrameResidual: Number(w.maximumFrameResidual),
  }))

  async function ledger(props: Partial<MnEnergyLedgerElement>): Promise<MnEnergyLedgerElement> {
    const el = document.createElement('mn-energy-ledger') as MnEnergyLedgerElement
    Object.assign(el, props)
    document.body.appendChild(el)
    await el.updateComplete
    return el
  }

  it('one section per World, each quantity with its unit and the exact stated value', async () => {
    const el = await ledger({ ledgers })
    const worlds = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.world')]
    expect(worlds.map((w) => w.dataset.world)).toEqual(['jj', 'gg'])
    const source = worlds[0].querySelector('[data-key="sourceWork"] dd')!
    expect(source.querySelector('.unit')!.textContent).toMatch(/J$/)
    expect(source.getAttribute('data-exact')).toBe(`${ledgers[0].sourceWork!.toExponential()} J`)
    expect(worlds[0].querySelector('.unitnote')!.textContent).toBe("the receipt's joules: the World's own units")
    expect([...worlds[0].querySelectorAll('.counts li')].map((li) => li.textContent)).toEqual([
      `${ledgers[0].plucks} plucks`, `${ledgers[0].hammerOns} hammer-ons`.replace(/^1 hammer-ons$/, '1 hammer-on'),
      `${ledgers[0].pullOffs} pull-offs`.replace(/^1 pull-offs$/, '1 pull-off'), `${ledgers[0].slides} slides`.replace(/^1 slides$/, '1 slide'),
    ])
  })

  it('says what it computed, and an absent quantity is an em dash, never a zero', async () => {
    const el = await ledger({ ledgers: [{ world: 'gt', sourceWork: 1e-7 }] })
    const radiation = el.shadowRoot!.querySelector('[data-key="radiation"] dd')!
    expect(radiation.textContent).toBe('—')
    expect(el.shadowRoot!.querySelector('[data-computed]')).toBeNull()
    const full = await ledger({ ledgers })
    const prose = full.shadowRoot!.querySelector('[data-computed="balance"]')!.textContent!
    expect(prose).toContain('Computed here from the stated parts')
    expect(prose).toMatch(/^Of the work in \([0-9.]+ [a-zµ]?J\), [0-9.]+% went to internal loss, [0-9.]+% was radiated and .+ is the World's stored change; the closure residual is .+ × 10⁻[⁰¹²³⁴⁵⁶⁷⁸⁹]+ of the work in\./)
  })

  it('no ledger is said plainly', async () => {
    const el = await ledger({ ledgers: [], empty: 'The bench run states no ledger.' })
    expect(el.shadowRoot!.textContent).toContain('The bench run states no ledger.')
  })
})
