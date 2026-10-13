import type { VisualIdentitySkin } from '@shrubbery/tokens'

import { flowAppEnabled } from './flow-workspace.js'

/**
 * The Mithras deployment — Garden served beside Mithras Flow (mithras.local,
 * where Flow is an app in the same picker) — should arrive wearing Flow's
 * clothes so the two read as one product.
 *
 * The deployment is recognised by the SAME build flag that puts Flow in the
 * app picker: `VITE_SHRUBBERY_FLOW_APP=1`. The predicate lives in ONE place —
 * flow-workspace.ts `flowAppEnabled` — and this module delegates to it, so
 * the skin and the picker can never disagree about which deployment they are
 * in (folded 2026-09-23 when the Flow line merged to main).
 *
 * Only the DEFAULT changes: a visitor's own stored skin still wins, and every
 * other build keeps Garden's default byte-for-byte.
 */
export function mithrasDeployment(env: Readonly<Record<string, unknown>> | undefined): boolean {
  return env != null && flowAppEnabled(env)
}

/** The default skin for a build: Mithras on the Mithras deployment, else the site's own. */
export function defaultSkinForBuild(
  env: Readonly<Record<string, unknown>> | undefined,
  siteDefault: VisualIdentitySkin,
): VisualIdentitySkin {
  return mithrasDeployment(env) ? 'mithras' : siteDefault
}
