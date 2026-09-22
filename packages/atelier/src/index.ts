/**
 * @shrubbery/atelier-vtuber — the WebGL/VRM avatar puppet, mn-vtuber.
 *
 * Importing this module REGISTERS the custom element as a side effect
 * (`@customElement(...)`), exactly like @shrubbery/components' barrel does for
 * its chrome/primitives: a host stamps `<mn-vtuber>` and this definition
 * UPGRADES that stamped tag in place.
 *
 * WHY THIS PACKAGE EXISTS (carved out of @shrubbery/components)
 * ───────────────────────────────────────────────────────────────
 * mn-vtuber is a genuinely lovely component, but it drags in a heavy, narrow
 * dependency (@pixiv/three-vrm + the three examples/jsm GLTFLoader) that the
 * rest of @shrubbery/components has no reason to carry. It gets its own home
 * so that dependency stays scoped to the one component that needs it.
 *
 * DEPENDENCY DIRECTION (load-bearing): this package MAY depend on
 * @shrubbery/components (it imports SkinAware, the skin/theme-mirroring
 * mixin, from there); @shrubbery/components must NEVER depend on this
 * package. mn-vtuber remains a manifested, catalog-known tag — see
 * @shrubbery/nucleus's known-components.ts / component-library.ts — only its
 * registration + implementation moved.
 *
 * Dependencies: @shrubbery/components (SkinAware only), lit, three,
 * @pixiv/three-vrm. NEVER stores, auth, tauri, yjs, or @shrubbery/runtime.
 */

// Side-effect registration (defines the custom element):
import './mn-vtuber.js'

export {
  MnVtuber,
  MN_VTUBER_EXPRESSION_NAMES,
  buildMnVtuberPose,
  buildMnVtuberPuppetPose,
  type MnVtuberAppearance,
  type MnVtuberArmPuppet,
  type MnVtuberCameraFrame,
  type MnVtuberExpressionPreset,
  type MnVtuberGesture,
  type MnVtuberMaterialMode,
  type MnVtuberPose,
  type MnVtuberPoseInput,
  type MnVtuberPuppetAngles,
  type MnVtuberPuppetState,
  type MnVtuberRenderStats,
  type MnVtuberRootMotion,
  type MnVtuberRotation,
  type MnVtuberStatus,
  type MnVtuberStatusDetail,
} from './mn-vtuber.js'
