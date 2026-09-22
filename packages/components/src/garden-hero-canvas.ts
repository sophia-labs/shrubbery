/**
 * Garden hero canvas - abstract organic background lifted from Garden.
 *
 * Pure visual component. It owns only local drawing state and animation; callers
 * place it as a full-bleed background layer.
 */
import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'

const PALETTE = {
  cream: '#faf8f3',
  sage: {
    light: '#d4e4c8',
    mid: '#a8c99a',
    deep: '#7ba16d',
  },
  gold: {
    light: '#f7ecd0',
    mid: '#e8d4a8',
  },
  rose: {
    blush: '#f4e4e0',
    soft: '#e8c8c0',
  },
  stone: '#b8b0a8',
}

interface OrganicBlob {
  x: number
  y: number
  radius: number
  color: string
  opacity: number
  phase: number
  speed: number
  wobbleAmp: number
  wobbleFreq: number
}

interface FlowingLine {
  points: Array<{ x: number; y: number; vx: number; vy: number }>
  color: string
  opacity: number
  width: number
  phase: number
}

@customElement('garden-hero-canvas')
export class GardenHeroCanvas extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      background: #faf8f3;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `

  @property({ type: Number })
  blobCount = 12

  @property({ type: Boolean, attribute: 'animate' })
  animated = true

  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private animationFrameId: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private startTime = 0
  private blobs: OrganicBlob[] = []
  private flowingLines: FlowingLine[] = []
  private grainCanvas: HTMLCanvasElement | null = null
  private dpr = 1

  firstUpdated(): void {
    this.setupCanvas()
  }

  disconnectedCallback(): void {
    this.cleanup()
    super.disconnectedCallback()
  }

  private setupCanvas(): void {
    this.canvas = this.renderRoot.querySelector('canvas')
    if (!this.canvas) return

    this.ctx = this.canvas.getContext('2d')
    if (!this.ctx) return

    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
    this.handleResize()
    this.initializeBlobs()
    this.initializeFlowingLines()
    this.initGrainCanvas()

    if ('ResizeObserver' in globalThis) {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize()
        this.requestFrame()
      })
      this.resizeObserver.observe(this)
    }

    this.startTime = performance.now()
    this.requestFrame()
  }

  private requestFrame(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId)
    this.animationFrameId = requestAnimationFrame(this.renderFrame)
  }

  private handleResize(): void {
    if (!this.canvas || !this.ctx) return
    const rect = this.getBoundingClientRect()
    const width = Math.max(1, rect.width || 1200)
    const height = Math.max(1, rect.height || 720)

    this.canvas.width = Math.floor(width * this.dpr)
    this.canvas.height = Math.floor(height * this.dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  private initializeBlobs(): void {
    this.blobs = []
    const colors = [
      PALETTE.sage.light,
      PALETTE.sage.mid,
      PALETTE.gold.light,
      PALETTE.gold.mid,
      PALETTE.rose.blush,
      PALETTE.rose.soft,
    ]

    for (let i = 0; i < this.blobCount; i++) {
      const angle = (i / this.blobCount) * Math.PI * 2
      const radiusFromCenter = 0.25 + Math.random() * 0.35
      this.blobs.push({
        x: 0.5 + Math.cos(angle) * radiusFromCenter * (0.8 + Math.random() * 0.4),
        y: 0.5 + Math.sin(angle) * radiusFromCenter * (0.6 + Math.random() * 0.4),
        radius: 0.08 + Math.random() * 0.15,
        color: colors[i % colors.length],
        opacity: 0.15 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0003 + Math.random() * 0.0004,
        wobbleAmp: 0.02 + Math.random() * 0.03,
        wobbleFreq: 0.8 + Math.random() * 0.6,
      })
    }

    for (let i = 0; i < 4; i++) {
      this.blobs.push({
        x: 0.2 + Math.random() * 0.6,
        y: 0.2 + Math.random() * 0.6,
        radius: 0.2 + Math.random() * 0.25,
        color: i % 2 === 0 ? PALETTE.gold.light : PALETTE.sage.light,
        opacity: 0.06 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0001 + Math.random() * 0.0002,
        wobbleAmp: 0.01,
        wobbleFreq: 0.4,
      })
    }
  }

  private initializeFlowingLines(): void {
    this.flowingLines = []
    for (let i = 0; i < 5; i++) {
      const points: FlowingLine['points'] = []
      const startY = 0.3 + (i / 5) * 0.4
      for (let j = 0; j < 6; j++) {
        points.push({
          x: j / 5,
          y: startY + (Math.random() - 0.5) * 0.2,
          vx: (Math.random() - 0.5) * 0.0001,
          vy: (Math.random() - 0.5) * 0.0001,
        })
      }
      this.flowingLines.push({
        points,
        color: i % 2 === 0 ? PALETTE.sage.deep : PALETTE.stone,
        opacity: 0.08 + Math.random() * 0.06,
        width: 1 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
      })
    }
  }

  private initGrainCanvas(): void {
    this.grainCanvas = this.ownerDocument.createElement('canvas')
    this.grainCanvas.width = 256
    this.grainCanvas.height = 256
    const ctx = this.grainCanvas.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(256, 256)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.random() * 20
      data[i] = noise
      data[i + 1] = noise
      data[i + 2] = noise
      data[i + 3] = 15
    }
    ctx.putImageData(imageData, 0, 0)
  }

  private renderFrame = (): void => {
    this.animationFrameId = null
    if (!this.ctx || !this.canvas) return

    const elapsed = performance.now() - this.startTime
    const width = this.canvas.width / this.dpr
    const height = this.canvas.height / this.dpr

    this.ctx.fillStyle = PALETTE.cream
    this.ctx.fillRect(0, 0, width, height)
    this.drawGrain(width, height)
    this.drawFlowingLines(width, height, elapsed)
    this.drawBlobs(width, height, elapsed)
    this.drawVignette(width, height)

    if (this.animated) {
      this.animationFrameId = requestAnimationFrame(this.renderFrame)
    }
  }

  private drawGrain(width: number, height: number): void {
    if (!this.ctx || !this.grainCanvas) return
    this.ctx.globalCompositeOperation = 'overlay'
    const pattern = this.ctx.createPattern(this.grainCanvas, 'repeat')
    if (pattern) {
      this.ctx.fillStyle = pattern
      this.ctx.fillRect(0, 0, width, height)
    }
    this.ctx.globalCompositeOperation = 'source-over'
  }

  private drawBlobs(width: number, height: number, elapsed: number): void {
    if (!this.ctx) return
    for (const blob of this.blobs) {
      const time = elapsed * blob.speed + blob.phase
      const x = (blob.x + Math.sin(time * blob.wobbleFreq) * blob.wobbleAmp) * width
      const y = (blob.y + Math.cos(time * blob.wobbleFreq * 1.3) * blob.wobbleAmp * 0.8) * height
      const radius = blob.radius * Math.min(width, height)
      this.drawOrganicBlob(x, y, radius, blob.color, blob.opacity, time)
    }
  }

  private drawOrganicBlob(x: number, y: number, radius: number, color: string, opacity: number, time: number): void {
    if (!this.ctx) return
    this.ctx.save()
    this.ctx.globalAlpha = opacity
    this.ctx.beginPath()

    const points = 8
    const angleStep = (Math.PI * 2) / points
    for (let i = 0; i <= points; i++) {
      const angle = i * angleStep
      const radiusVar = radius * (0.85 + 0.3 * Math.sin(time * 0.5 + angle * 2))
      const px = x + Math.cos(angle) * radiusVar
      const py = y + Math.sin(angle) * radiusVar
      if (i === 0) {
        this.ctx.moveTo(px, py)
      } else {
        const cpAngle = angle - angleStep / 2
        const cpx = x + Math.cos(cpAngle) * radiusVar * 1.2
        const cpy = y + Math.sin(cpAngle) * radiusVar * 1.2
        this.ctx.quadraticCurveTo(cpx, cpy, px, py)
      }
    }

    this.ctx.closePath()
    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius * 1.2)
    gradient.addColorStop(0, color)
    gradient.addColorStop(0.7, color)
    gradient.addColorStop(1, this.hexToRgba(color, 0))
    this.ctx.fillStyle = gradient
    this.ctx.fill()
    this.ctx.restore()
  }

  private drawFlowingLines(width: number, height: number, elapsed: number): void {
    if (!this.ctx) return
    for (const line of this.flowingLines) {
      this.ctx.save()
      this.ctx.globalAlpha = line.opacity
      this.ctx.strokeStyle = line.color
      this.ctx.lineWidth = line.width
      this.ctx.lineCap = 'round'
      this.ctx.lineJoin = 'round'

      for (const point of line.points) {
        point.x += point.vx
        point.y += point.vy
        if (point.x < 0 || point.x > 1) point.vx *= -1
        if (point.y < 0.1 || point.y > 0.9) point.vy *= -1
        point.y += Math.sin(elapsed * 0.0003 + line.phase + point.x * 5) * 0.0001
      }

      const scaled = line.points.map((p) => ({ x: p.x * width, y: p.y * height }))
      this.ctx.beginPath()
      if (scaled.length >= 2) {
        this.ctx.moveTo(scaled[0].x, scaled[0].y)
        for (let i = 1; i < scaled.length - 1; i++) {
          this.ctx.quadraticCurveTo(scaled[i].x, scaled[i].y, (scaled[i].x + scaled[i + 1].x) / 2, (scaled[i].y + scaled[i + 1].y) / 2)
        }
        const last = scaled[scaled.length - 1]
        const secondLast = scaled[scaled.length - 2]
        this.ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y)
      }
      this.ctx.stroke()
      this.ctx.restore()
    }
  }

  private drawVignette(width: number, height: number): void {
    if (!this.ctx) return
    const gradient = this.ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.7)
    gradient.addColorStop(0, 'rgba(250, 248, 243, 0)')
    gradient.addColorStop(0.7, 'rgba(250, 248, 243, 0)')
    gradient.addColorStop(1, 'rgba(240, 235, 225, 0.4)')
    this.ctx.fillStyle = gradient
    this.ctx.fillRect(0, 0, width, height)
  }

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  private cleanup(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.canvas = null
    this.ctx = null
    this.grainCanvas = null
    this.blobs = []
    this.flowingLines = []
  }

  render() {
    return html`<canvas aria-hidden="true"></canvas>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'garden-hero-canvas': GardenHeroCanvas
  }
}
