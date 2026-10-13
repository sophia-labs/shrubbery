/**
 * media.ts — SHELL-SIDE: the ONE place a graph media path becomes a URL.
 *
 * The `aig:` graph names media by a path RELATIVE to the library root
 * (`samples/buzz_01.wav`) and says nothing about how to fetch it — that is the
 * shell's business, exactly as the `TripleSource` binding is. Keeping the join
 * here means the domain graph stays portable (serve the same triples from a
 * cell, an S3 bucket, or a Tauri app and only this function changes) and no UI
 * element ever concatenates a URL.
 */

/** The same-origin route the Vite plugin serves the library's bytes on. */
export const MEDIA_ROUTE = '/media/'

/** Library-relative path → same-origin URL. Each segment is encoded, so a name
 *  with a space or a `#` survives the round trip. */
export function mediaUrl(path: string): string {
  return MEDIA_ROUTE + path.split('/').map(encodeURIComponent).join('/')
}

/** Bytes → a short human size. Undefined stays undefined (never "0 B"). */
export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes)) return undefined
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
