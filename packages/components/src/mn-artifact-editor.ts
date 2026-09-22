/**
 * mn-artifact-editor - controlled image-editing surface lifted from Garden.
 *
 * Garden's original editor owns one external effect: image generation. This
 * Shrubbery lift keeps the real local Fabric canvas editor, but generation is a
 * host-owned intent. It never imports services, stores, runtime, or persistence.
 */
import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { Canvas, FabricImage, PencilBrush, Point, Rect, filters } from 'fabric'
import { icon, iconStyles } from './icons.js'

export type MnArtifactEditorTool = 'pan' | 'draw' | 'crop'
export type MnArtifactEditorGenerateTarget = 'version' | 'artifact'

export interface MnArtifactEditorSaveDetail {
  readonly dataUrl: string
  readonly mimeType: 'image/png' | 'image/jpeg'
}

export interface MnArtifactEditorGenerateDetail extends MnArtifactEditorSaveDetail {
  readonly prompt: string
  readonly target: MnArtifactEditorGenerateTarget
}

@customElement('mn-artifact-editor')
export class MnArtifactEditor extends LitElement {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-sunken, #f8fafc);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .toolbar,
    .promptbar {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      box-sizing: border-box;
    }

    .toolbar {
      flex-wrap: wrap;
    }

    .group {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 6px);
      min-height: 32px;
      padding-right: var(--mn-space-2, 8px);
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .group:last-of-type {
      border-right: 0;
    }

    button,
    select,
    input {
      font: inherit;
    }

    button,
    select {
      display: inline-flex;
      min-height: 30px;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 0 9px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      box-sizing: border-box;
    }

    button:hover:not(:disabled),
    select:hover:not(:disabled) {
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    button:focus-visible,
    select:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, #2563eb);
      outline-offset: 2px;
    }

    button.active {
      border-color: transparent;
      color: var(--mn-color-on-accent, #fff);
      background: var(--mn-color-accent, #4f46e5);
    }

    button.primary {
      border-color: transparent;
      color: var(--mn-color-on-accent, #fff);
      background: var(--mn-color-accent, #4f46e5);
    }

    button:disabled,
    select:disabled,
    input:disabled {
      cursor: default;
      opacity: 0.52;
    }

    label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    input[type='range'] {
      width: 86px;
      accent-color: var(--mn-color-accent, #4f46e5);
    }

    input[type='color'] {
      width: 30px;
      height: 30px;
      padding: 2px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
    }

    .zoom {
      min-width: 42px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-align: center;
    }

    .spacer {
      flex: 1 1 auto;
      min-width: 12px;
    }

    .prompt {
      flex: 1 1 auto;
      min-width: 180px;
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-sizing: border-box;
    }

    .error {
      max-width: min(34vw, 320px);
      overflow: hidden;
      color: var(--mn-color-danger, #dc2626);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stage {
      position: relative;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background:
        linear-gradient(45deg, rgba(148, 163, 184, 0.14) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(148, 163, 184, 0.14) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.14) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.14) 75%),
        var(--mn-color-surface-sunken, #f8fafc);
      background-position: 0 0, 0 10px, 10px -10px, -10px 0;
      background-size: 20px 20px;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .headless {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: var(--mn-space-6, 24px);
      color: var(--mn-color-text-tertiary, #6b7280);
      text-align: center;
      box-sizing: border-box;
      pointer-events: none;
    }
  `

  @property({ type: String }) srcUrl = ''
  @property({ type: String }) mimeType = 'image/png'
  @property({ type: String }) prompt = ''
  @property({ type: String }) generationTarget: MnArtifactEditorGenerateTarget = 'version'
  @property({ type: Boolean }) generating = false
  @property({ type: String }) generationError = ''

  @state() private _tool: MnArtifactEditorTool = 'pan'
  @state() private _brightness = 0
  @state() private _contrast = 0
  @state() private _saturation = 0
  @state() private _brushColor = '#ff3b30'
  @state() private _brushWidth = 6
  @state() private _zoomPct = 100
  @state() private _setupError = ''

  private _canvas: Canvas | null = null
  private _base: FabricImage | null = null
  private _cropRect: Rect | null = null
  private _resizeObserver: ResizeObserver | null = null
  private _natW = 0
  private _natH = 0
  private _panning = false
  private _lastX = 0
  private _lastY = 0
  private _fitted = false

  firstUpdated(): void {
    this._setupCanvas()
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('srcUrl') && this._canvas) {
      this._loadImage(this.srcUrl).catch((error: unknown) => {
        this._setupError = error instanceof Error ? error.message : 'Image could not be loaded.'
      })
    }
  }

  disconnectedCallback(): void {
    this._resizeObserver?.disconnect()
    this._resizeObserver = null
    this._canvas?.dispose()
    this._canvas = null
    super.disconnectedCallback()
  }

  private _setupCanvas(): void {
    const element = this.renderRoot.querySelector('canvas') as HTMLCanvasElement | null
    const stage = this.renderRoot.querySelector('.stage') as HTMLElement | null
    if (!element || !stage) return

    try {
      const canvas = new Canvas(element, { selection: false, preserveObjectStacking: true })
      this._canvas = canvas
      this._resizeCanvas(stage)

      canvas.on('mouse:wheel', (opt) => {
        const event = opt.e as WheelEvent
        const zoom = Math.min(8, Math.max(0.05, canvas.getZoom() * 0.999 ** event.deltaY))
        canvas.zoomToPoint(new Point(event.offsetX, event.offsetY), zoom)
        this._zoomPct = Math.round(zoom * 100)
        event.preventDefault()
        event.stopPropagation()
      })

      canvas.on('mouse:down', (opt) => {
        if (this._tool !== 'pan') return
        const event = opt.e as MouseEvent
        this._panning = true
        this._lastX = event.clientX
        this._lastY = event.clientY
        canvas.setCursor('grabbing')
      })

      canvas.on('mouse:move', (opt) => {
        if (!this._panning) return
        const event = opt.e as MouseEvent
        canvas.relativePan(new Point(event.clientX - this._lastX, event.clientY - this._lastY))
        this._lastX = event.clientX
        this._lastY = event.clientY
      })

      canvas.on('mouse:up', () => {
        this._panning = false
        canvas.setCursor(this._tool === 'pan' ? 'grab' : 'default')
      })

      if ('ResizeObserver' in globalThis) {
        this._resizeObserver = new ResizeObserver(() => {
          this._resizeCanvas(stage)
          if (!this._fitted) this._fitViewport()
          this._canvas?.requestRenderAll()
        })
        this._resizeObserver.observe(stage)
      }

      canvas.setCursor('grab')
      this._loadImage(this.srcUrl).catch((error: unknown) => {
        this._setupError = error instanceof Error ? error.message : 'Image could not be loaded.'
      })
    } catch (error) {
      this._setupError = error instanceof Error ? error.message : 'Canvas editor is unavailable.'
    }
  }

  private _resizeCanvas(stage: HTMLElement): void {
    const canvas = this._canvas
    if (!canvas) return
    const rect = stage.getBoundingClientRect()
    const width = Math.max(1, rect.width || stage.clientWidth || 960)
    const height = Math.max(1, rect.height || stage.clientHeight || 540)
    canvas.setDimensions({ width, height })
  }

  private async _loadImage(url: string): Promise<void> {
    const canvas = this._canvas
    if (!canvas || !url) return
    const image = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
    this._natW = image.width ?? 0
    this._natH = image.height ?? 0
    canvas.clear()
    image.set({
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      hasControls: false,
    })
    this._base = image
    canvas.add(image)
    this._applyFilters()
    this._fitted = false
    this._fitViewport()
  }

  private _fitViewport(): void {
    const canvas = this._canvas
    if (!canvas || !this._natW || !this._natH) return
    const width = canvas.getWidth()
    const height = canvas.getHeight()
    if (width <= 0 || height <= 0) return
    const zoom = Math.min(width / this._natW, height / this._natH) || 1
    canvas.setViewportTransform([zoom, 0, 0, zoom, (width - this._natW * zoom) / 2, (height - this._natH * zoom) / 2])
    this._zoomPct = Math.round(zoom * 100)
    this._fitted = true
    canvas.requestRenderAll()
  }

  private _setZoom(value: number): void {
    const canvas = this._canvas
    if (!canvas) return
    const zoom = Math.min(8, Math.max(0.05, value))
    canvas.zoomToPoint(new Point(canvas.getWidth() / 2, canvas.getHeight() / 2), zoom)
    this._zoomPct = Math.round(zoom * 100)
  }

  private _applyFilters(): void {
    const base = this._base
    if (!base) return
    const activeFilters: object[] = []
    if (this._brightness) activeFilters.push(new filters.Brightness({ brightness: this._brightness / 100 }))
    if (this._contrast) activeFilters.push(new filters.Contrast({ contrast: this._contrast / 100 }))
    if (this._saturation) activeFilters.push(new filters.Saturation({ saturation: this._saturation / 100 }))
    base.filters = activeFilters as never
    base.applyFilters()
    this._canvas?.requestRenderAll()
  }

  private _exportDataUrl(region?: { left: number; top: number; width: number; height: number }): string {
    const canvas = this._canvas
    if (!canvas) return ''
    const previousTransform = canvas.viewportTransform
      ? ([...canvas.viewportTransform] as [number, number, number, number, number, number])
      : null
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    const rect = region ?? { left: 0, top: 0, width: this._natW || canvas.getWidth(), height: this._natH || canvas.getHeight() }
    const dataUrl = canvas.toDataURL({ format: this._exportFormat(), multiplier: 1, ...rect })
    if (previousTransform) canvas.setViewportTransform(previousTransform)
    return dataUrl
  }

  private _exportFormat(): 'png' | 'jpeg' {
    return this.mimeType === 'image/jpeg' || this.mimeType === 'image/jpg' ? 'jpeg' : 'png'
  }

  private _exportMimeType(): 'image/png' | 'image/jpeg' {
    return this._exportFormat() === 'jpeg' ? 'image/jpeg' : 'image/png'
  }

  private async _bakeWithTransform(rotate: 0 | 90 | 180 | 270, flipX: boolean, flipY: boolean): Promise<void> {
    const dataUrl = this._exportDataUrl()
    if (!dataUrl) return
    const image = await loadHtmlImage(dataUrl)
    const swap = rotate === 90 || rotate === 270
    const outWidth = swap ? image.height : image.width
    const outHeight = swap ? image.width : image.height
    const offscreen = this.ownerDocument.createElement('canvas')
    offscreen.width = outWidth
    offscreen.height = outHeight
    const context = offscreen.getContext('2d')
    if (!context) return
    context.translate(outWidth / 2, outHeight / 2)
    context.rotate((rotate * Math.PI) / 180)
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1)
    context.drawImage(image, -image.width / 2, -image.height / 2)
    this._resetFilters()
    await this._loadImage(offscreen.toDataURL('image/png'))
  }

  private _setTool(tool: MnArtifactEditorTool): void {
    const canvas = this._canvas
    if (!canvas) return
    if (this._tool === 'crop' && tool !== 'crop' && this._cropRect) {
      canvas.remove(this._cropRect)
      this._cropRect = null
    }
    this._tool = tool
    canvas.isDrawingMode = tool === 'draw'
    canvas.setCursor(tool === 'pan' ? 'grab' : 'default')
    if (tool === 'draw') {
      const brush = new PencilBrush(canvas)
      brush.color = this._brushColor
      brush.width = this._brushWidth
      canvas.freeDrawingBrush = brush
    }
    if (tool === 'crop') this._startCrop(canvas)
  }

  private _startCrop(canvas: Canvas): void {
    if (this._cropRect) canvas.remove(this._cropRect)
    const width = this._natW || canvas.getWidth()
    const height = this._natH || canvas.getHeight()
    const rect = new Rect({
      left: width * 0.2,
      top: height * 0.2,
      width: width * 0.6,
      height: height * 0.6,
      fill: 'rgba(79,70,229,0.08)',
      stroke: '#4f46e5',
      strokeWidth: 2 / Math.max(canvas.getZoom(), 0.1),
      cornerColor: '#4f46e5',
      transparentCorners: false,
    })
    this._cropRect = rect
    canvas.add(rect)
    canvas.setActiveObject(rect)
    canvas.requestRenderAll()
  }

  private async _applyCrop(): Promise<void> {
    const rect = this._cropRect
    const canvas = this._canvas
    if (!rect || !canvas) return
    const region = {
      left: Math.max(0, rect.left ?? 0),
      top: Math.max(0, rect.top ?? 0),
      width: Math.max(1, (rect.width ?? 0) * (rect.scaleX ?? 1)),
      height: Math.max(1, (rect.height ?? 0) * (rect.scaleY ?? 1)),
    }
    canvas.remove(rect)
    this._cropRect = null
    this._tool = 'pan'
    this._resetFilters()
    const dataUrl = this._exportDataUrl(region)
    if (dataUrl) await this._loadImage(dataUrl)
  }

  private _resetFilters(): void {
    this._brightness = 0
    this._contrast = 0
    this._saturation = 0
  }

  private _onSlider(which: 'brightness' | 'contrast' | 'saturation', value: number): void {
    if (which === 'brightness') this._brightness = value
    else if (which === 'contrast') this._contrast = value
    else this._saturation = value
    this._applyFilters()
  }

  private _save(): void {
    if (this.generating) return
    this.dispatchEvent(
      new CustomEvent<MnArtifactEditorSaveDetail>('mn-artifact-editor-save', {
        detail: { dataUrl: this._exportDataUrl(), mimeType: this._exportMimeType() },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _cancel(): void {
    this.dispatchEvent(new CustomEvent('mn-artifact-editor-cancel', { bubbles: true, composed: true }))
  }

  private _generate(): void {
    const prompt = this.prompt.trim()
    if (!prompt || this.generating) return
    this.dispatchEvent(
      new CustomEvent<MnArtifactEditorGenerateDetail>('mn-artifact-editor-generate', {
        detail: {
          dataUrl: this._exportDataUrl(),
          mimeType: this._exportMimeType(),
          prompt,
          target: this.generationTarget,
        },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _renderHeadlessState(): TemplateResult | typeof nothing {
    if (!this._setupError) return nothing
    return html`<div class="headless">${this._setupError}</div>`
  }

  render(): TemplateResult {
    return html`
      <div class="toolbar">
        <div class="group" aria-label="Viewport controls">
          <button type="button" class=${this._tool === 'pan' ? 'active' : ''} @click=${() => this._setTool('pan')}>Pan</button>
          <button type="button" title="Zoom out" aria-label="Zoom out" @click=${() => this._setZoom(this._zoomPct / 100 - 0.2)}>-</button>
          <span class="zoom" aria-live="polite">${this._zoomPct}%</span>
          <button type="button" title="Zoom in" aria-label="Zoom in" @click=${() => this._setZoom(this._zoomPct / 100 + 0.2)}>+</button>
          <button type="button" @click=${() => this._fitViewport()}>Fit</button>
          <button type="button" @click=${() => this._setZoom(1)}>1:1</button>
        </div>
        <div class="group" aria-label="Transform controls">
          <button type="button" title="Rotate 90 degrees" @click=${() => void this._bakeWithTransform(90, false, false)}>
            ${icon('rotate-ccw', { size: 14 })} Rotate
          </button>
          <button type="button" @click=${() => void this._bakeWithTransform(0, true, false)}>Flip X</button>
          <button type="button" @click=${() => void this._bakeWithTransform(0, false, true)}>Flip Y</button>
        </div>
        <div class="group" aria-label="Crop controls">
          <button type="button" class=${this._tool === 'crop' ? 'active' : ''} @click=${() => this._setTool(this._tool === 'crop' ? 'pan' : 'crop')}>
            Crop
          </button>
          ${this._tool === 'crop'
            ? html`<button type="button" class="primary" @click=${() => void this._applyCrop()}>Apply</button>`
            : nothing}
        </div>
        <div class="group" aria-label="Draw controls">
          <button type="button" class=${this._tool === 'draw' ? 'active' : ''} @click=${() => this._setTool(this._tool === 'draw' ? 'pan' : 'draw')}>
            ${icon('pencil', { size: 14 })} Draw
          </button>
          ${this._tool === 'draw'
            ? html`
                <input
                  type="color"
                  aria-label="Brush color"
                  .value=${this._brushColor}
                  @input=${(event: Event) => {
                    this._brushColor = (event.target as HTMLInputElement).value
                    if (this._canvas?.freeDrawingBrush) this._canvas.freeDrawingBrush.color = this._brushColor
                  }}
                />
                <input
                  type="range"
                  aria-label="Brush width"
                  min="1"
                  max="40"
                  .value=${String(this._brushWidth)}
                  @input=${(event: Event) => {
                    this._brushWidth = Number((event.target as HTMLInputElement).value)
                    if (this._canvas?.freeDrawingBrush) this._canvas.freeDrawingBrush.width = this._brushWidth
                  }}
                />
              `
            : nothing}
        </div>
        <div class="group" aria-label="Filter controls">
          <label>Bright<input type="range" min="-100" max="100" .value=${String(this._brightness)} @input=${(event: Event) => this._onSlider('brightness', Number((event.target as HTMLInputElement).value))} /></label>
          <label>Contrast<input type="range" min="-100" max="100" .value=${String(this._contrast)} @input=${(event: Event) => this._onSlider('contrast', Number((event.target as HTMLInputElement).value))} /></label>
          <label>Sat<input type="range" min="-100" max="100" .value=${String(this._saturation)} @input=${(event: Event) => this._onSlider('saturation', Number((event.target as HTMLInputElement).value))} /></label>
        </div>
        <div class="spacer"></div>
        <button type="button" @click=${this._cancel}>Cancel</button>
        <button type="button" class="primary" ?disabled=${this.generating} @click=${this._save}>${icon('save', { size: 14 })} Save version</button>
      </div>
      <div class="promptbar">
        <input
          class="prompt"
          type="text"
          placeholder="Describe an image edit to generate..."
          .value=${this.prompt}
          ?disabled=${this.generating}
          @input=${(event: Event) => {
            this.prompt = (event.target as HTMLInputElement).value
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter') this._generate()
          }}
        />
        <select
          .value=${this.generationTarget}
          ?disabled=${this.generating}
          @change=${(event: Event) => {
            this.generationTarget = (event.target as HTMLSelectElement).value as MnArtifactEditorGenerateTarget
          }}
        >
          <option value="version">New version</option>
          <option value="artifact">New artifact</option>
        </select>
        <button type="button" class="primary" ?disabled=${this.generating || !this.prompt.trim()} @click=${this._generate}>
          ${this.generating ? 'Generating...' : 'Generate'}
        </button>
        ${this.generationError ? html`<span class="error">${this.generationError}</span>` : nothing}
      </div>
      <div class="stage">
        <canvas aria-label="Artifact image editor canvas"></canvas>
        ${this._renderHeadlessState()}
      </div>
    `
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image could not be decoded.'))
    image.src = url
  })
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-artifact-editor': MnArtifactEditor
  }
}
