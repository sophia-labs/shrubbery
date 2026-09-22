import type { LocalClip } from './catalog'

export interface PlayoutEvents {
  onClipChange: (clip: LocalClip) => void
  onBufferChange: (ready: LocalClip | null) => void
}

interface Deck {
  element: HTMLVideoElement
  clip: LocalClip | null
}

export class VideoPlayout {
  private readonly decks: [Deck, Deck]
  private activeIndex = 0
  private readyClip: LocalClip | null = null
  private pendingClips: LocalClip[] = []
  private idleClips: [LocalClip, LocalClip]
  private idleIndex = 0
  private transitionTimer: number | null = null

  constructor(elements: [HTMLVideoElement, HTMLVideoElement], idleClips: [LocalClip, LocalClip], private events: PlayoutEvents) {
    this.decks = [
      { element: elements[0], clip: null },
      { element: elements[1], clip: null },
    ]
    this.idleClips = idleClips

    for (const deck of this.decks) {
      deck.element.addEventListener('ended', () => {
        if (deck !== this.decks[this.activeIndex]) return
        void this.handleEnded()
      })
    }
  }

  async start(): Promise<void> {
    await this.loadInto(this.decks[0], this.idleClips[0])
    this.decks[0].element.classList.add('is-active')
    this.decks[0].element.loop = true
    await this.decks[0].element.play()
    this.events.onClipChange(this.idleClips[0])
  }

  async queue(clip: LocalClip): Promise<void> {
    await this.queueSequence([clip])
  }

  async queueSequence(clips: LocalClip[]): Promise<void> {
    this.pendingClips.push(...clips)
    await this.prepareNext()
  }

  private async prepareNext(): Promise<void> {
    if (this.readyClip || this.pendingClips.length === 0) return
    const clip = this.pendingClips.shift()!
    const standby = this.decks[1 - this.activeIndex]
    await this.loadInto(standby, clip)
    this.readyClip = clip
    this.events.onBufferChange(clip)
    if (this.decks[this.activeIndex].clip?.kind === 'idle') this.scheduleCut()
  }

  private scheduleCut(): void {
    if (!this.readyClip || this.transitionTimer !== null) return
    const active = this.decks[this.activeIndex].element
    const remaining = Number.isFinite(active.duration) ? active.duration - active.currentTime : 0
    const waitMs = Math.max(180, Math.min(900, remaining * 1000))
    this.transitionTimer = window.setTimeout(() => {
      this.transitionTimer = null
      void this.cutToReady()
    }, waitMs)
  }

  private async cutToReady(): Promise<void> {
    const clip = this.readyClip
    if (!clip) return

    const outgoing = this.decks[this.activeIndex]
    const nextIndex = 1 - this.activeIndex
    const incoming = this.decks[nextIndex]
    this.readyClip = null
    this.events.onBufferChange(null)

    incoming.element.loop = false
    incoming.element.currentTime = 0
    await incoming.element.play()
    incoming.element.classList.add('is-active')
    outgoing.element.classList.remove('is-active')
    outgoing.element.pause()
    this.activeIndex = nextIndex
    this.events.onClipChange(clip)
    await this.prepareNext()
  }

  private async handleEnded(): Promise<void> {
    if (this.readyClip) {
      await this.cutToReady()
      return
    }
    if (this.pendingClips.length > 0) {
      await this.prepareNext()
      await this.cutToReady()
      return
    }

    this.idleIndex = 1 - this.idleIndex
    const idle = this.idleClips[this.idleIndex]
    const standby = this.decks[1 - this.activeIndex]
    await this.loadInto(standby, idle)
    this.readyClip = idle
    await this.cutToReady()
    this.decks[this.activeIndex].element.loop = true
  }

  private async loadInto(deck: Deck, clip: LocalClip): Promise<void> {
    deck.clip = clip
    deck.element.loop = false
    deck.element.poster = clip.poster
    deck.element.src = clip.src
    deck.element.load()
    if (deck.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return

    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        cleanup()
        resolve()
      }
      const failed = () => {
        cleanup()
        reject(new Error(`Could not decode ${clip.src}`))
      }
      const cleanup = () => {
        deck.element.removeEventListener('loadeddata', ready)
        deck.element.removeEventListener('error', failed)
      }
      deck.element.addEventListener('loadeddata', ready, { once: true })
      deck.element.addEventListener('error', failed, { once: true })
    })
  }
}
