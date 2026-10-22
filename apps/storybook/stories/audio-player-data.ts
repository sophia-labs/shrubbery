/**
 * Real tracks for the mn-audio-player stories: the Ovillo fixture's three Ariadne
 * pieces (apps/ovillo/fixture, computed from the renders of 2026-10-20). The
 * mp3s are the real files, imported as URLs; the peaks, energy traces and
 * receipts are the real JSON, parsed by the component package's own readers.
 * Nothing here is invented for the story.
 */
import {
  parseEnergyTrace,
  parsePeaks,
  type MnAudioTrack,
  type MnEnergyLedger,
} from '@shrubbery/components'

import hiloMp3 from '../../ovillo/fixture/site/media/hilo-de-luz.mp3?url'
import giganteMp3 from '../../ovillo/fixture/site/media/gigante-y-juguete.mp3?url'
import aguaMp3 from '../../ovillo/fixture/site/media/agua-mansa.mp3?url'
import hiloPeaks from '../../ovillo/fixture/site/media/hilo-de-luz.peaks.json'
import gigantePeaks from '../../ovillo/fixture/site/media/gigante-y-juguete.peaks.json'
import aguaPeaks from '../../ovillo/fixture/site/media/agua-mansa.peaks.json'
import hiloEnergy from '../../ovillo/fixture/site/media/hilo-de-luz.energy.json'
import giganteEnergy from '../../ovillo/fixture/site/media/gigante-y-juguete.energy.json'
import giganteReceipt from '../../ovillo/fixture/site/receipts/gigante-y-juguete.json'

const ID = 'https://ovillo.sophia-labs.com/id/piece/'

export const OVILLO_FIXTURE_TRACKS: readonly MnAudioTrack[] = [
  {
    id: `${ID}hilo-de-luz`,
    title: 'Hilo de luz',
    subtitle: 'steel-string world · DADGAD',
    src: hiloMp3,
    duration: 53.090896,
    tags: ['pretty'],
    peaks: parsePeaks(hiloPeaks),
    energy: parseEnergyTrace(hiloEnergy),
  },
  {
    id: `${ID}gigante-y-juguete`,
    title: 'Gigante y juguete',
    subtitle: 'two steel-string worlds',
    src: giganteMp3,
    duration: 32.7,
    tags: ['playful', 'weird'],
    peaks: parsePeaks(gigantePeaks),
    energy: parseEnergyTrace(giganteEnergy),
  },
  {
    id: `${ID}agua-mansa`,
    title: 'Agua mansa',
    subtitle: 'bench: simulated guitar → Ariadne World',
    src: aguaMp3,
    duration: 34,
    tags: ['pretty'],
    peaks: parsePeaks(aguaPeaks),
  },
]

interface ReceiptWorld {
  readonly instrument: string
  readonly anatomy: string
  readonly plucks: number
  readonly hammerOns: number
  readonly pullOffs: number
  readonly slides: number
  readonly sourceWork: number
  readonly controlWork: number
  readonly internalLoss: number
  readonly radiation: number
  readonly cumulativeClosureResidual: number
  readonly maximumFrameResidual: number
}

/** Gigante y juguete's two Worlds, as its receipt states them. */
export const OVILLO_FIXTURE_LEDGERS: readonly MnEnergyLedger[] = (
  giganteReceipt as { ariadneWorlds: readonly ReceiptWorld[] }
).ariadneWorlds.map((w) => ({
  world: w.instrument,
  anatomy: w.anatomy,
  plucks: w.plucks,
  hammerOns: w.hammerOns,
  pullOffs: w.pullOffs,
  slides: w.slides,
  sourceWork: w.sourceWork,
  controlWork: w.controlWork,
  internalLoss: w.internalLoss,
  radiation: w.radiation,
  closureResidual: w.cumulativeClosureResidual,
  maxFrameResidual: w.maximumFrameResidual,
}))
