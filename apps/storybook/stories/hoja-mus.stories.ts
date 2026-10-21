/**
 * Hoja's MUS mode — edit a score, see it checked, hear an Ariadne World render it, all in the browser.
 *
 * The REAL pieces, no stand-ins: `<hoja-mus-editor>` (Hoja with the MUS grammar and the checker's verdict drawn into
 * the ```mus fence), `<mn-mus-verdict>` beside it, and Ovillo's `mus-wasm` (the browser build of `mus check` and
 * `mus render`, Ariadne Worlds only) in a Worker, mounted together by `mountMusWorkbench`.
 *
 * The engine is a build artifact of the Ovillo repository, not of this one: build it (`mus-rs/crates/mus-wasm/build.sh
 * <dir>/mus_wasm.wasm`) and start Storybook with `MUS_WASM_DIR=<dir>`, which serves it at `/mus/mus_wasm.wasm`.
 * Without it the stories say the engine could not load, as a page would.
 */
import type { Meta, StoryObj } from '@storybook/web-components'
import '@shrubbery/components/mus-verdict'
import { mountMusWorkbench, type MusWorkbench } from '@shrubbery/runtime/mus'

const meta: Meta = {
  title: 'Hoja/MUS mode',
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

const WASM = '/mus/mus_wasm.wasm'

/** Bar 4 of Ovillo's steel-string tour (one fretted line: hammer-on, pull-off, slide), with one fret written wrong. */
export const WRONG_FRET = `# score: The left hand (bar 4 of the steel-string tour)
# tempo: 96    time: 4/4
# swing: 8 60
# master: rms=-16
# tab: standard

# text @b1: hammer-on, pull-off, slide: the stopped length moves under a ringing string

# instruments:
#   gt   = steel-string guitar (treble, -12, anatomy=steel-string-v0, tuning=E2 A2 D3 G3 B3 E4, capo=0)
#   gt.p = thumb, thumbpick (treble, pos=0.10, pick=0.85, pm=0.45)
#   gt.v = fingers (treble, pos=0.20, pick=0.45)

bar 1 [chord=Am]: gt.p=A2q@5:0 E3q@4:2 A2q@5:0 E3q@4:2  gt.v=A3e@3:2 B3e@3:4[ho] C4e@2:3 D4e@2:3[ho] C4e@2:1[po] B3e@2:0[po] A3e@3:2 B3e@3:4[sl]
`

/** The same bar with a second, non-Ariadne track: the browser refuses it (Ovillo plays Ariadne Worlds only). */
export const NOT_ARIADNE = WRONG_FRET.replace('C4e@2:3', 'C4e@2:1').replace(
  '#   gt.v = fingers (treble, pos=0.20, pick=0.45)\n',
  '#   gt.v = fingers (treble, pos=0.20, pick=0.45)\n#   pad  = pad (treble, synth=saw)\n',
).replace('B3e@3:4[sl]\n', 'B3e@3:4[sl]  pad=A3w\n')

function bench(score: string, title: string): HTMLElement {
  const host = document.createElement('div')
  host.style.maxWidth = '1200px'
  let mounted: MusWorkbench | null = null
  queueMicrotask(() => {
    mounted = mountMusWorkbench(host, {
      score,
      title,
      notes: 'Fix the score in the fence; the verdict follows each edit. RENDER plays it on the World.',
      wasm: WASM,
    })
    ;(host as unknown as { __bench: MusWorkbench | null }).__bench = mounted
  })
  return host
}

export const WrongFret: Story = {
  name: 'A wrong fret, then render',
  render: () => bench(WRONG_FRET, 'The left hand'),
}

export const NotAnAriadneWorld: Story = {
  name: 'Refused: a synth track',
  render: () => bench(NOT_ARIADNE, 'Not an Ariadne World'),
}
