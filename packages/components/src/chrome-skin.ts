/**
 * Backend-free presentation metadata for the shared chrome identity control.
 * Choosing and persistence remain shell concerns; the bars' skin picker only
 * needs to reflect the current identity and list the others, each with a
 * truthful label and icon.
 */
export type ChromeSkinId = 'garden' | 'emporium' | '98' | 'glass' | 'mithras' | 'hotdog-stand' | 'research' | 'greenhouse' | 'observatory'

export interface ChromeSkinMeta {
  readonly label: string
  readonly icon: string
}

const CHROME_SKINS: Readonly<Record<ChromeSkinId, ChromeSkinMeta>> = {
  garden: { label: 'Garden', icon: 'sprout' },
  emporium: { label: 'Sophia', icon: 'eye' },
  '98': { label: '98', icon: 'monitor' },
  glass: { label: 'Glass', icon: 'diamond' },
  mithras: { label: 'Mithras', icon: 'square' },
  'hotdog-stand': { label: 'Hotdog Stand', icon: 'flame' },
  research: { label: 'Research', icon: 'search' },
  greenhouse: { label: 'Greenhouse', icon: 'leaf' },
  observatory: { label: 'Observatory', icon: 'telescope' },
}

export function chromeSkinMeta(skin: ChromeSkinId): ChromeSkinMeta {
  return CHROME_SKINS[skin] ?? CHROME_SKINS.garden
}

/**
 * The skins the shared picker lists, in order: the global identity set, Hotdog Stand last.
 * (The components package is an island — it never imports token code — so this list is
 * kept equal to the registry's `VISUAL_IDENTITY_SKINS` by a test in the organism, where
 * both are importable. An app with its own set, like Aviary, passes `skins` to the bar.)
 */
export const CHROME_PICKER_SKINS: readonly ChromeSkinId[] = ['garden', 'emporium', '98', 'glass', 'mithras', 'hotdog-stand']
