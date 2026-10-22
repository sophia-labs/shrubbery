/**
 * Media/Audio player — the REAL mn-audio-player and mn-energy-ledger on the Ovillo
 * fixture's three Ariadne pieces (real mp3s, peaks, energy traces, receipts).
 *
 * Press play: the waveform scrubber moves, the Energy screen plays the World's
 * stored energy by body (strings, box, room) in sync with the sound, and the
 * Spectrum and Scope screens draw live from the AnalyserNode the player taps.
 * Flip the Skin/Theme globals to see it in each skin, light and dark.
 */
import { html } from 'lit'
import type { Meta, StoryObj } from '@storybook/web-components'
import '@shrubbery/components'
import type { MnVisualizerMode } from '@shrubbery/components'
import { OVILLO_FIXTURE_LEDGERS, OVILLO_FIXTURE_TRACKS } from './audio-player-data.js'

interface PlayerArgs {
  visualizer: MnVisualizerMode | ''
  variant: 'full' | 'single'
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
}

const meta: Meta<PlayerArgs> = {
  title: 'Media/Audio player',
  parameters: { layout: 'padded' },
  args: { visualizer: '', variant: 'full', shuffle: false, repeat: 'off' },
  argTypes: {
    visualizer: { control: 'inline-radio', options: ['', 'energy', 'spectrum', 'scope'] },
    variant: { control: 'inline-radio', options: ['full', 'single'] },
    repeat: { control: 'inline-radio', options: ['off', 'all', 'one'] },
  },
}
export default meta
type Story = StoryObj<PlayerArgs>

export const Playlist: Story = {
  render: (args) => html`
    <div style="max-width: 1080px;">
      <mn-audio-player
        label="Fixture: three Ariadne pieces"
        .tracks=${OVILLO_FIXTURE_TRACKS}
        .visualizer=${args.visualizer}
        .variant=${args.variant}
        .shuffle=${args.shuffle}
        .repeat=${args.repeat}
      ></mn-audio-player>
    </div>
  `,
}

export const SingleOnPhone: Story = {
  args: { variant: 'single' },
  render: (args) => html`
    <div style="max-width: 390px;">
      <mn-audio-player .tracks=${[OVILLO_FIXTURE_TRACKS[0]]} variant="single" .visualizer=${args.visualizer}></mn-audio-player>
    </div>
  `,
}

export const EnergyLedger: Story = {
  render: () => html`
    <div style="max-width: 520px;">
      <mn-energy-ledger .ledgers=${OVILLO_FIXTURE_LEDGERS}></mn-energy-ledger>
    </div>
  `,
}
