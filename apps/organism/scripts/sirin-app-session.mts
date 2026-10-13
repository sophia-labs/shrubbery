/**
 * sirin-app-session.mts — mint or accept a Cognito token set, seed it into a
 * Playwright storageState for the DEPLOYED Sirin Organism
 * (https://app.sirin.sophia-labs.com by default), and PROVE the resulting
 * session by navigating the real app and asserting real rendered content —
 * not a screenshot a human must interpret.
 *
 * Why this exists: the SPA stores its Cognito token set in localStorage under
 * `shrubbery.cognito.tokens.v1` (see src/cell/cognito-auth-session.ts,
 * DEFAULT_STORAGE_KEY). A Playwright context that seeds that key before
 * navigation is signed in from the client's point of view. But "signed in
 * from the client's point of view" and "accepted by the gateway" are TWO
 * DIFFERENT FACTS — this script checks both and reports which one it
 * witnessed, rather than conflating them.
 *
 * TOKEN SOURCE — pluggable, exactly one required:
 *   SIRIN_APP_TOKEN_FILE       path to a JSON file holding a bare
 *                              CognitoTokenSet: {accessToken, idToken,
 *                              refreshToken, expiresAt(ms epoch)}
 *   SIRIN_APP_TOKEN_JSON       the same shape, inline as a JSON string
 *   SIRIN_APP_USERNAME +
 *   SIRIN_APP_PASSWORD         mint a fresh token set with a REAL
 *                              USER_PASSWORD_AUTH call against Cognito,
 *                              reusing the SAME production class
 *                              (createCognitoAuthSession) the deployed SPA
 *                              itself uses — no reimplementation, no drift.
 *
 * These three are equally first-class: whichever is supplied, the rest of
 * the script (storageState construction, navigation, proof, JSON result)
 * behaves identically. This is the "an env-supplied token set must work
 * identically" requirement — the lane is not blocked on minting.
 *
 * OTHER ENV VARS (all optional):
 *   SIRIN_APP_BASE_URL          default https://app.sirin.sophia-labs.com
 *   SIRIN_APP_COGNITO_CLIENT_ID default 46raltmjse1gjkkt6hvq30tsk7 (SPA client)
 *   SIRIN_APP_COGNITO_REGION    default us-west-1
 *   SIRIN_APP_SESSION_OUT       where to write the Playwright storageState
 *                                JSON (default under the artifact dir)
 *   SIRIN_APP_ARTIFACT_DIR      where result.json + screenshot land
 *                                (default ./browser-lane-artifacts/sirin-app-session/<ts>
 *                                 relative to cwd)
 *   SIRIN_APP_SKIP_PROOF        '1' skips live navigation (storageState only)
 *   SIRIN_APP_CELL_WAKE_TIMEOUT_MS  default 90000 — bonus, non-fatal wait for
 *                                the workspace chrome to paint once signed in.
 *                                Cold cells on the Sirin box are known to take
 *                                minutes to wake; a timeout here is reported
 *                                as "cellWarm: false", not treated as failure.
 *   HEADED                      '1' runs headed (matches prime-notebook-*
 *                                convention in this scripts/ directory)
 *
 * OUTPUT: one JSON object on stdout (schema sirin.app-session-proof.v1) and
 * the same object written to <artifact-dir>/result.json, plus a screenshot.
 * status is exactly one of:
 *   authenticated          — gateway accepted the bearer token (organismMode
 *                             flipped to 'hosted', which the app source only
 *                             does after a successful graphs() call)
 *   rejected-by-gateway    — token seeded and locally trusted, but the
 *                             gateway returned 401/403 (organismMode:'error')
 *   signed-out             — the app redirected to /signin: no token, an
 *                             unparseable token, or (critically) a token
 *                             whose in-flight refresh failed and was cleared
 *   boot-error             — organism reached mode:'error' for a reason
 *                             OTHER than a gateway 401/403 (named verbatim)
 *   harness-error          — this script itself could not complete (bad env,
 *                             navigation timeout, Cognito mint failure, ...)
 * Exit code is 0 only for status "authenticated"; nonzero otherwise, with the
 * JSON always printed first so a Bash-only caller can read the reason.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  createCognitoAuthSession,
  decodeJwtClaims,
  type CognitoTokenSet,
} from '../src/cell/cognito-auth-session.js'

const STORAGE_KEY = 'shrubbery.cognito.tokens.v1'
const SCHEMA = 'sirin.app-session-proof.v1'

const scriptDir = dirname(fileURLToPath(import.meta.url))

function usage(): string {
  return [
    'sirin-app-session.mts — mint/accept a Cognito session, seed it, prove it against the deployed app.',
    '',
    'Exactly one token source is required:',
    '  SIRIN_APP_TOKEN_FILE=<path>            bare CognitoTokenSet JSON on disk',
    '  SIRIN_APP_TOKEN_JSON=\'{"accessToken":...}\'  bare CognitoTokenSet JSON inline',
    '  SIRIN_APP_USERNAME=<u> SIRIN_APP_PASSWORD=<p>   mint fresh via real Cognito USER_PASSWORD_AUTH',
    '',
    'Optional: SIRIN_APP_BASE_URL, SIRIN_APP_COGNITO_CLIENT_ID, SIRIN_APP_COGNITO_REGION,',
    '          SIRIN_APP_SESSION_OUT, SIRIN_APP_ARTIFACT_DIR, SIRIN_APP_SKIP_PROOF,',
    '          SIRIN_APP_CELL_WAKE_TIMEOUT_MS, HEADED',
    '',
    'Run: node --import tsx scripts/sirin-app-session.mts',
  ].join('\n')
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`${usage()}\n`)
  process.exit(0)
}

interface ResolvedTokens {
  readonly tokens: CognitoTokenSet
  readonly source: 'token-file' | 'token-json' | 'username-password'
}

function isBareTokenSet(value: unknown): value is CognitoTokenSet {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.accessToken === 'string'
    && typeof v.idToken === 'string'
    && typeof v.refreshToken === 'string'
    && typeof v.expiresAt === 'number'
}

async function resolveTokens(): Promise<ResolvedTokens> {
  const tokenFile = process.env.SIRIN_APP_TOKEN_FILE?.trim()
  const tokenJson = process.env.SIRIN_APP_TOKEN_JSON?.trim()
  const username = process.env.SIRIN_APP_USERNAME?.trim()
  const password = process.env.SIRIN_APP_PASSWORD
  const suppliedCount = [tokenFile, tokenJson, username && password ? 'mint' : ''].filter(Boolean).length

  if (suppliedCount === 0) {
    throw new HarnessError(
      'no token source supplied: set exactly one of SIRIN_APP_TOKEN_FILE, SIRIN_APP_TOKEN_JSON, '
      + 'or SIRIN_APP_USERNAME+SIRIN_APP_PASSWORD.\n\n' + usage(),
    )
  }
  if (suppliedCount > 1) {
    throw new HarnessError(
      'more than one token source supplied — set exactly one of SIRIN_APP_TOKEN_FILE, '
      + 'SIRIN_APP_TOKEN_JSON, SIRIN_APP_USERNAME+SIRIN_APP_PASSWORD to keep the source unambiguous.',
    )
  }

  if (tokenFile) {
    let raw: string
    try {
      raw = await readFile(resolve(tokenFile), 'utf8')
    } catch (error) {
      throw new HarnessError(`SIRIN_APP_TOKEN_FILE "${tokenFile}" could not be read: ${String(error)}`)
    }
    const parsed = parseJsonOrThrow(raw, `SIRIN_APP_TOKEN_FILE "${tokenFile}"`)
    if (!isBareTokenSet(parsed)) {
      throw new HarnessError(
        `SIRIN_APP_TOKEN_FILE "${tokenFile}" did not contain a CognitoTokenSet `
        + '{accessToken:string, idToken:string, refreshToken:string, expiresAt:number}.',
      )
    }
    return { tokens: parsed, source: 'token-file' }
  }

  if (tokenJson) {
    const parsed = parseJsonOrThrow(tokenJson, 'SIRIN_APP_TOKEN_JSON')
    if (!isBareTokenSet(parsed)) {
      throw new HarnessError(
        'SIRIN_APP_TOKEN_JSON did not contain a CognitoTokenSet '
        + '{accessToken:string, idToken:string, refreshToken:string, expiresAt:number}.',
      )
    }
    return { tokens: parsed, source: 'token-json' }
  }

  // username + password: mint via the REAL production auth class, not a
  // reimplementation, so this stays honest about what Cognito actually says.
  const region = process.env.SIRIN_APP_COGNITO_REGION?.trim() || 'us-west-1'
  const clientId = process.env.SIRIN_APP_COGNITO_CLIENT_ID?.trim() || '46raltmjse1gjkkt6hvq30tsk7'
  // Node 25 ships a spec-shaped global `localStorage` that this library's
  // own browserStorage() fallback happily picks up when `storage` is
  // omitted/null (both are "nullish" to `??`) — but without
  // `--localstorage-file` that global throws on getItem/setItem
  // ("this.storage?.getItem is not a function"), a real defect this
  // harness's own red run caught. An explicit inert stub sidesteps it and
  // is all this mint path needs: signIn() returns the token set directly.
  const inertStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const session = createCognitoAuthSession({ config: { region, clientId }, storage: inertStorage })
  await session.whenReady()
  try {
    const tokens = await session.signIn(username!, password!)
    return { tokens, source: 'username-password' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new HarnessError(`Cognito USER_PASSWORD_AUTH mint failed for "${username}": ${message}`)
  }
}

function parseJsonOrThrow(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new HarnessError(`${label} was not valid JSON: ${String(error)}`)
  }
}

class HarnessError extends Error {}

function tokenDiagnostics(tokens: CognitoTokenSet): Record<string, unknown> {
  const claims = decodeJwtClaims(tokens.idToken)
  const expSeconds = typeof claims.exp === 'number' ? claims.exp : null
  const nowMs = Date.now()
  // Placeholder/synthetic refresh tokens (this harness's own red-run fixtures,
  // or a bare accessToken-only export) are short and non-JWT-shaped; a real
  // Cognito refresh token is a long opaque string. This is a heuristic
  // disclosed as one — it does not gate behavior, only annotates the receipt.
  const refreshLooksReal = tokens.refreshToken.length > 40 && !/synthetic|placeholder|invalid|no-refresh/i.test(tokens.refreshToken)
  return {
    subject: typeof claims.sub === 'string' ? claims.sub : null,
    identity: typeof claims.email === 'string'
      ? claims.email
      : (typeof claims['cognito:username'] === 'string' ? claims['cognito:username'] : null),
    idTokenExpSeconds: expSeconds,
    idTokenExpiresInMs: expSeconds != null ? expSeconds * 1000 - nowMs : null,
    storedExpiresAtMs: tokens.expiresAt,
    hasRefreshToken: tokens.refreshToken.length > 0,
    refreshTokenLooksReal: refreshLooksReal,
  }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.SIRIN_APP_BASE_URL?.trim() || 'https://app.sirin.sophia-labs.com').replace(/\/+$/, '')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const artifactDir = resolve(process.env.SIRIN_APP_ARTIFACT_DIR?.trim() || resolve(process.cwd(), 'browser-lane-artifacts', 'sirin-app-session', timestamp))
  const sessionOut = resolve(process.env.SIRIN_APP_SESSION_OUT?.trim() || resolve(artifactDir, 'storage-state.json'))
  const screenshotPath = resolve(artifactDir, 'proof.png')
  const resultPath = resolve(artifactDir, 'result.json')
  await mkdir(artifactDir, { recursive: true })

  const started = Date.now()
  let resolved: ResolvedTokens
  try {
    resolved = await resolveTokens()
  } catch (error) {
    await writeResultAndExit({
      schema: SCHEMA, ok: false, status: 'harness-error',
      reason: error instanceof Error ? error.message : String(error),
      baseUrl, tokenSource: null, tokenDiagnostics: null, domSnapshot: null,
      gatewayResponses: [], consoleErrors: [], elapsedMs: Date.now() - started,
      storageStatePath: null, screenshotPath: null, timestamp: new Date().toISOString(),
    }, resultPath)
    return
  }

  const diagnostics = tokenDiagnostics(resolved.tokens)
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: new URL(baseUrl).origin,
        localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(resolved.tokens) }],
      },
    ],
  }
  await writeFile(sessionOut, `${JSON.stringify(storageState, null, 2)}\n`, 'utf8')

  if (process.env.SIRIN_APP_SKIP_PROOF === '1') {
    await writeResultAndExit({
      schema: SCHEMA, ok: true, status: 'authenticated', // unverified — proof skipped by request
      reason: 'SIRIN_APP_SKIP_PROOF=1: storageState written but NOT navigated/proved. This is not evidence of a working session.',
      baseUrl, tokenSource: resolved.source, tokenDiagnostics: diagnostics, domSnapshot: null,
      gatewayResponses: [], consoleErrors: [], elapsedMs: Date.now() - started,
      storageStatePath: sessionOut, screenshotPath: null, timestamp: new Date().toISOString(),
    }, resultPath)
    return
  }

  const headed = process.env.HEADED === '1'
  const cellWakeTimeoutMs = Number(process.env.SIRIN_APP_CELL_WAKE_TIMEOUT_MS ?? 90_000)
  const browser = await chromium.launch({ headless: !headed })
  const consoleErrors: string[] = []
  const gatewayResponses: string[] = []
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState })
    const page = await context.newPage()
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('response', r => {
      if (r.status() >= 400) gatewayResponses.push(`${r.status()} ${r.url()}`)
    })

    let navError: string | null = null
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForFunction(() => {
        const mode = document.body.dataset.organismMode
        return mode === 'hosted' || mode === 'error' || document.body.dataset.organismRoute === 'auth'
      }, { timeout: 30_000 })
    } catch (error) {
      navError = error instanceof Error ? error.message : String(error)
    }
    await page.waitForTimeout(500)

    const domSnapshot = await page.evaluate(() => ({
      url: window.location.href,
      organismMode: document.body.dataset.organismMode ?? null,
      organismRoute: document.body.dataset.organismRoute ?? null,
      statusClass: document.getElementById('status')?.className ?? null,
      statusText: document.getElementById('status')?.textContent ?? null,
      authPagePresent: document.querySelector('mn-auth-page') != null,
    }))

    let cellWarm = false
    if (domSnapshot.organismMode === 'hosted') {
      cellWarm = await page.locator('sh-workspace-surface').first().waitFor({ state: 'visible', timeout: cellWakeTimeoutMs })
        .then(() => true)
        .catch(() => false)
    }

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

    const { status, reason } = classify(domSnapshot, navError, cellWarm, cellWakeTimeoutMs)
    await writeResultAndExit({
      schema: SCHEMA,
      ok: status === 'authenticated',
      status,
      reason,
      baseUrl,
      tokenSource: resolved.source,
      tokenDiagnostics: diagnostics,
      domSnapshot: { ...domSnapshot, cellWarm },
      gatewayResponses,
      consoleErrors,
      elapsedMs: Date.now() - started,
      storageStatePath: sessionOut,
      screenshotPath,
      timestamp: new Date().toISOString(),
    }, resultPath)
  } finally {
    await browser.close()
  }
}

function classify(
  domSnapshot: { organismMode: string | null; organismRoute: string | null; statusClass: string | null; statusText: string | null },
  navError: string | null,
  cellWarm: boolean,
  cellWakeTimeoutMs: number,
): { status: 'authenticated' | 'signed-out' | 'rejected-by-gateway' | 'boot-error' | 'harness-error'; reason: string } {
  if (navError) {
    return { status: 'harness-error', reason: `navigation/decision did not settle within timeout: ${navError}` }
  }
  if (domSnapshot.organismRoute === 'auth') {
    return {
      status: 'signed-out',
      reason: 'the app redirected to /signin — no valid session was recognized locally. '
        + 'Causes: no token seeded, a malformed token, or a near/past-expiry token whose refresh attempt failed '
        + '(cognito-auth-session.ts restore(): a failed refresh() calls clear(), wiping the seeded token before boot checks isAuthenticated()).',
    }
  }
  if (domSnapshot.organismMode === 'error') {
    const text = domSnapshot.statusText ?? ''
    const gatewayAuthFailure = /HTTP 401|HTTP 403|unauthorized/i.test(text)
    return {
      status: gatewayAuthFailure ? 'rejected-by-gateway' : 'boot-error',
      reason: gatewayAuthFailure
        ? `session was locally trusted (skipped /signin) but the gateway rejected the bearer token: ${text}`
        : `organism reached mode:'error' for a reason other than a gateway 401/403: ${text}`,
    }
  }
  if (domSnapshot.organismMode === 'hosted') {
    return {
      status: 'authenticated',
      reason: cellWarm
        ? 'gateway accepted the bearer token (organismMode=hosted, which the app only sets after a successful graphs() call) and the workspace chrome painted (sh-workspace-surface visible).'
        : `gateway accepted the bearer token (organismMode=hosted) but the workspace chrome did not paint within ${cellWakeTimeoutMs}ms — `
          + 'consistent with the known cold-cell-wake defect (separate investigation), not an auth failure. Sign-in is proved; workspace warmth is not.',
    }
  }
  return {
    status: 'harness-error',
    reason: `organism reached an unrecognized boot state: organismMode=${String(domSnapshot.organismMode)} organismRoute=${String(domSnapshot.organismRoute)} statusText=${String(domSnapshot.statusText)}`,
  }
}

async function writeResultAndExit(result: Record<string, unknown>, resultPath: string): Promise<void> {
  const text = `${JSON.stringify(result, null, 2)}\n`
  await writeFile(resultPath, text, 'utf8')
  process.stdout.write(text)
  process.exitCode = result.ok === true ? 0 : 1
}

await main()
