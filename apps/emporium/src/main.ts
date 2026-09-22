/**
 * The EMPORIUM app — boot.
 *
 * A DEDICATED Vite product shell (the 4th shell after garden desktop / cloud-2
 * cell SPA / choreograph Studio) for the live vocab-pack catalogue. It DEFAULTS to
 * the EMPORIUM skin (purple-400 #9472CE, Diatype, square, tight) — this app IS the
 * Emporium identity.
 *
 * What it wires (all REAL, all from the workspace packages):
 *   - @shrubbery/tokens — the layered design tokens + applySkinTheme (stamps the
 *     emporium skin on <html> by default).
 *   - @shrubbery/components — the chrome + general primitives (the upgrade seam),
 *     incl. the richer general product bar mn-app-bar.
 *   - the shell-side live /emporium read (EmporiumStore, hoisted to
 *     @shrubbery/source's './emporium' subpath — U10) + this app's own catalogue /
 *     pack-detail views (./vocab-views.ts, apps/emporium's only consumer).
 *   - the Emporium product shell (shell.ts): mn-app-bar + packs rail + content +
 *     breadcrumbs + hash-router nav (grammar mirrors the curl URLs).
 *
 * The library stays BACKEND-FREE; the live read stays shell-side; the browser
 * never sees the loopback token/port — the Vite proxy injects them server-side
 * (see vite.config.ts). NO MOCK: the shell reads a REAL gardend cell over /cell.
 */

import '@shrubbery/tokens/tokens.css'
import { bootShell } from './shell.js'

const appBarMount = document.getElementById('app-bar') as HTMLElement
const railMount = document.getElementById('rail') as HTMLElement
const contentMount = document.getElementById('content') as HTMLElement
const statusMount = document.getElementById('status') as HTMLElement

bootShell({ appBarMount, railMount, contentMount, statusMount })
