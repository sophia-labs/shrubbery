/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build's default source: 'nt' (built N-Triples beside the page) or 'gardend' (a public-mode gardend's /mcp). */
  readonly VITE_OVILLO_SOURCE?: string
}
