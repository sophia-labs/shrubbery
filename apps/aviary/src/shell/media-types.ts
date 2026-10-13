/**
 * media-types.ts — extension → media type, and nothing else.
 *
 * Deliberately DEPENDENCY-FREE (no workspace packages, no node builtins beyond
 * a string split). Vite's config loader externalizes bare specifiers to their
 * resolved FS path and hands them to plain Node, which cannot execute the
 * workspace packages' TypeScript — so anything reachable from `vite.config.ts`
 * must stay in this weight class. The RDF projection, which does need nucleus,
 * is loaded through Vite's own module graph instead (see aigua-plugin.ts).
 */

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** Media preference when one logical artifact has several encodings: the
 *  lossless original first, the compressed proxy second. Ordering only — every
 *  encoding found on disk is projected, and the UI shows them all. */
export const AUDIO_RANK: readonly string[] = ['.wav', '.flac', '.ogg', '.mp3', '.m4a']

/** Lowercased extension including the dot, or '' when there is none. */
export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return dot > slash ? path.slice(dot).toLowerCase() : ''
}

/** The media type for a path, or null when it is not media this shell serves. */
export function mediaTypeOf(path: string): string | null {
  const ext = extensionOf(path)
  return AUDIO_TYPES[ext] ?? IMAGE_TYPES[ext] ?? null
}

export function isAudioPath(path: string): boolean {
  return extensionOf(path) in AUDIO_TYPES
}

export function audioRankOf(path: string): number {
  const i = AUDIO_RANK.indexOf(extensionOf(path))
  return i === -1 ? AUDIO_RANK.length : i
}
