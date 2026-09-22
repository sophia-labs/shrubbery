/**
 * editor-room-pool.ts — RE-EXPORT SHIM.
 *
 * `EditorRoomPool` was hoisted into `@shrubbery/runtime` (packages/runtime/
 * src/collab/editor-room-pool.ts) so the layout-as-data P2 face module
 * (`packages/runtime/src/layout/faces/hoja-document-face.ts`) can wrap it
 * without reimplementing its key/refcount logic (design doc §4.1, §9.2 Phase
 * 2: "do not duplicate"). This shim keeps organism's existing import path
 * (`./cell/editor-room-pool.js`) and `main.ts` untouched — there is exactly
 * ONE implementation now, at the runtime package; this file only re-exports
 * it. `editor-room-pool.test.ts` in this directory still exercises the real
 * class through this shim.
 */
export {
  EditorRoomPool,
  editorRoomKey,
  type EditorRoomKey,
  type EditorRoomLease,
  type EditorRoomDiagnostic,
  type EditorRoomPoolSnapshot,
} from '@shrubbery/runtime'
