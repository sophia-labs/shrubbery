/** The ported tract (tract-engine.js): its handle is the page's `window.__tract`, plus start and dispose. */
export interface TractHandle {
  readonly state: Float32Array
  readonly wasmRtf: number | null
  readonly dspLoad: number | null
  readonly live: boolean
  readonly pixelRatio: number
  readonly hits: number
  send(message: Record<string, unknown>): void
  handleKey(key: string): boolean
  fireOrb(): void
  start(): Promise<void>
  dispose(): void
}

export interface TractOptions {
  /** The element whose classes carry the page's `tv` and `panel-open` states. */
  readonly host: HTMLElement
  readonly loadWasm: () => Promise<ArrayBuffer>
  readonly workletUrl: string | URL
  /** The query the tract reads (`tv=1`, `mute`, `lite`); default `location.search`. */
  readonly search?: string
}

export function mountTract(root: ShadowRoot, opts: TractOptions): Promise<TractHandle | null>
