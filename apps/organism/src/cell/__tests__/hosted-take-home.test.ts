// @vitest-environment node
/**
 * Settings → Account → Download my gardens, from the SPA to a real gateway-shaped server.
 * Node environment on purpose: a real fetch sends the bearer (happy-dom strips it under
 * `credentials: 'omit'`), and these tests assert it. The server answers the way platform-next
 * `gateway/src/take_home.rs` does: a one-time link, or a refusal with a code.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  HostedTakeHome,
  SELF_HOST_GUIDE_ACTION,
  SELF_HOST_GUIDE_URL,
  TAKE_HOME_ACTION,
  TAKE_HOME_DESCRIPTION,
  TAKE_HOME_MESSAGES,
} from '../hosted-take-home.js'
import { createDefaultSettingsService } from '../settings-service.js'

interface Seen { method: string; path: string; authorization: string | undefined }
interface Answer { status: number; body: unknown }

let server: Server
let base = ''
const seen: Seen[] = []
let answer: Answer = { status: 200, body: {} }

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://loopback.invalid')
    seen.push({ method: request.method ?? 'GET', path: url.pathname, authorization: request.headers.authorization })
    response.writeHead(answer.status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' })
    response.end(JSON.stringify(answer.body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})
beforeEach(() => { seen.length = 0 })

function takeHomeOn(gateway: string) {
  const downloads: string[] = []
  const opened: string[] = []
  const takeHome = new HostedTakeHome(
    { userId: () => 'alice', token: () => 'id-token' },
    gateway,
    undefined,
    url => { downloads.push(url) },
    url => { opened.push(url) },
  )
  return { takeHome, downloads, opened }
}

const account = { id: 'account', title: 'Account' } as const

describe('Download my gardens', () => {
  it('sits first in Account with its one line, and only on hosted Account', () => {
    const { takeHome } = takeHomeOn(base)
    const view = takeHome.decorate({ ...account, actions: [{ id: 'sign-out', label: 'Sign out', variant: 'danger' }] })
    expect(view.actions?.map(action => action.id)).toEqual([TAKE_HOME_ACTION, SELF_HOST_GUIDE_ACTION, 'sign-out'])
    expect(view.actions?.[0]).toMatchObject({ label: 'Download my gardens', description: TAKE_HOME_DESCRIPTION, disabled: false })
    expect(view.actions?.[1]).toMatchObject({ label: 'How to run it yourself', icon: 'external-link' })
    expect(TAKE_HOME_DESCRIPTION).toMatch(/own computer/)
    expect(takeHome.decorate({ id: 'billing', title: 'Billing' }).actions).toBeUndefined()
  })

  it('mints the one-time link with the bearer, then hands the browser the gateway URL', async () => {
    answer = { status: 200, body: { ok: true, url: '/me/export/garden.tar?ticket=t1', expiresInSeconds: 120, graphs: 2, dailyLimit: 3 } }
    const { takeHome, downloads } = takeHomeOn(base)
    await takeHome.start()
    expect(seen).toEqual([{ method: 'POST', path: '/me/export/garden', authorization: 'Bearer id-token' }])
    expect(downloads).toEqual([`${base}/me/export/garden.tar?ticket=t1`])
    const notes = takeHome.decorate(account).notes?.join(' ') ?? ''
    expect(notes).toContain('Your download has started (2 gardens)')
    expect(notes).toContain('gardend')
  })

  it.each([
    [429, 'take_home_daily_limit', TAKE_HOME_MESSAGES.dailyLimit],
    [503, 'take_home_busy', TAKE_HOME_MESSAGES.busy],
    [404, 'take_home_nothing_owned', TAKE_HOME_MESSAGES.nothingOwned],
    [403, 'human_user_required', TAKE_HOME_MESSAGES.signIn],
    [500, 'something_else', TAKE_HOME_MESSAGES.unavailable],
  ])('a %i %s refusal is said in our words and starts nothing', async (status, code, message) => {
    answer = { status, body: { ok: false, code, error: 'gateway prose that is never shown' } }
    const { takeHome, downloads } = takeHomeOn(base)
    await takeHome.start()
    expect(downloads).toEqual([])
    const notes = takeHome.decorate(account).notes ?? []
    expect(notes).toEqual([message])
  })

  it('refuses a link that points anywhere but the download route on the same gateway', async () => {
    answer = { status: 200, body: { ok: true, url: 'https://elsewhere.example/me/export/garden.tar?ticket=t1' } }
    const { takeHome, downloads } = takeHomeOn(base)
    await takeHome.start()
    expect(downloads).toEqual([])
    expect(takeHome.decorate(account).notes).toEqual([TAKE_HOME_MESSAGES.unavailable])
  })

  it('says so when the gateway cannot be reached', async () => {
    const { takeHome, downloads } = takeHomeOn('http://127.0.0.1:1')
    await takeHome.start()
    expect(downloads).toEqual([])
    expect(takeHome.decorate(account).notes).toEqual([TAKE_HOME_MESSAGES.unreachable])
  })

  it('runs through the hosted settings service as an Account action', async () => {
    answer = { status: 200, body: { ok: true, url: '/me/export/garden.tar?ticket=t2', graphs: 1 } }
    const { takeHome, downloads } = takeHomeOn(base)
    const hosted = createDefaultSettingsService({ runtimeMode: 'hosted', takeHome })
    const before = await hosted.load()
    expect(before.sections.find(section => section.id === 'account')?.actions?.[0]?.id).toBe(TAKE_HOME_ACTION)
    await hosted.action({ sectionId: 'account', actionId: TAKE_HOME_ACTION })
    expect(downloads).toEqual([`${base}/me/export/garden.tar?ticket=t2`])
    const after = await hosted.load()
    expect(after.sections.find(section => section.id === 'account')?.notes?.join(' ')).toContain('(1 garden)')

    expect(before.sections.find(section => section.id === 'account')?.actions?.[1]?.id).toBe(SELF_HOST_GUIDE_ACTION)
    const local = createDefaultSettingsService({ runtimeMode: 'local', takeHome })
    const localAccount = (await local.load()).sections.find(section => section.id === 'account')
    expect(localAccount?.actions?.some(action => action.id === TAKE_HOME_ACTION) ?? false).toBe(false)
    expect(localAccount?.actions?.some(action => action.id === SELF_HOST_GUIDE_ACTION) ?? false).toBe(false)
  })

  it('opens the self-host guide from the row beside the download, and fetches nothing', async () => {
    const { takeHome, downloads, opened } = takeHomeOn(base)
    const hosted = createDefaultSettingsService({ runtimeMode: 'hosted', takeHome })
    await hosted.load()
    await hosted.action({ sectionId: 'account', actionId: SELF_HOST_GUIDE_ACTION })
    expect(opened).toEqual([SELF_HOST_GUIDE_URL])
    expect(SELF_HOST_GUIDE_URL).toBe('https://github.com/sophia-labs/gardend/blob/main/docs/self-host-cloudflare-tunnel.md')
    expect(downloads).toEqual([])
    expect(seen).toEqual([])
  })
})
