/**
 * The type-only seam of the vendored `snapping.ts`: the three names it imports from the editor's `types.ts`, narrowed to the
 * fields it reads (found by grep; see ./snapping.ts). Written here, not vendored: the editor's own `types.ts` drags in React.
 * MIT-licensed upstream code does not depend on anything below at runtime.
 */
import type { ExcalidrawElement } from '@excalidraw/element/types'

export interface AppState {
  readonly zoom: { readonly value: number }
  readonly activeTool: { readonly type: string }
  readonly selectedElementsAreBeingDragged: boolean
  readonly objectsSnapModeEnabled: boolean
  readonly gridModeEnabled: boolean
  readonly selectedElementIds: Readonly<Record<ExcalidrawElement['id'], true>>
  readonly selectedGroupIds: Readonly<Record<string, boolean>>
  readonly editingGroupId: string | null
  readonly scrollX: number
  readonly scrollY: number
  readonly width: number
  readonly height: number
  readonly offsetLeft: number
  readonly offsetTop: number
}

export interface AppClassProperties {
  readonly props: { readonly gridModeEnabled?: boolean }
  readonly state: AppState
}

export interface KeyboardModifiersObject {
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}
