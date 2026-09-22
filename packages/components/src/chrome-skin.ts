/**
 * Backend-free presentation metadata for the shared chrome identity control.
 * Cycling and persistence remain shell concerns; bars only need to reflect the
 * current identity with a truthful label and icon.
 */
export type ChromeSkinId = 'garden' | 'emporium' | '98' | 'glass' | 'research' | 'greenhouse' | 'observatory'

export interface ChromeSkinMeta {
  readonly label: string
  readonly icon: string
}

const CHROME_SKINS: Readonly<Record<ChromeSkinId, ChromeSkinMeta>> = {
  garden: { label: 'Garden', icon: 'sprout' },
  emporium: { label: 'Sophia', icon: 'eye' },
  '98': { label: '98', icon: 'monitor' },
  glass: { label: 'Glass', icon: 'diamond' },
  research: { label: 'Research', icon: 'search' },
  greenhouse: { label: 'Greenhouse', icon: 'leaf' },
  observatory: { label: 'Observatory', icon: 'telescope' },
}

export function chromeSkinMeta(skin: ChromeSkinId): ChromeSkinMeta {
  return CHROME_SKINS[skin] ?? CHROME_SKINS.garden
}
