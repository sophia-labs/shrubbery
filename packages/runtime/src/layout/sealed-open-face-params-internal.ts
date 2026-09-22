/**
 * sealed-open-face-params-internal.ts — F5 quarantine (repair round 3,
 * faces-mvp review finding F5): the ONE legal import path for
 * `sealedOpenFaceParamsSchema`, the reviewed open-params escape hatch
 * (types.ts's own header: "NO open escape hatch" is the default guard
 * rail — this is the explicit, justification-bearing exception to it).
 *
 * `sealedOpenFaceParamsSchema` is DELIBERATELY NOT exported from the public
 * `@shrubbery/runtime/layout` barrel (`layout/index.ts`) — see that file's
 * own comment. A casual consumer of `@shrubbery/runtime/layout` must not
 * reach it by accident; reaching for it at all requires importing this
 * explicitly-internal subpath instead, which is a visible, greppable choice
 * at the call site.
 *
 * Defense in depth, not the only gate: even a caller who imports this module
 * and successfully mints an open schema still cannot silently register it —
 * `FaceRegistry.register` (face-registry.ts) rejects any open-schema
 * registration whose `faceId` was not explicitly named in
 * `new FaceRegistry({ allowOpenParamsFaceIds: [...] })` at construction (see
 * `UnallowlistedOpenFaceParamsError`).
 *
 * v1 ships no genuinely open-ended face — nothing in this codebase imports
 * this module yet (verified at F5 review time). It exists so a face that
 * genuinely needs it later has a legitimate path, one that is impossible to
 * reach by accident via the ratified public barrel.
 */
export { sealedOpenFaceParamsSchema } from './types.js'
