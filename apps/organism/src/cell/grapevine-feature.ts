import type { ShrubberyContract } from '@shrubbery/nucleus'
import type { ShellFeature } from './shell-feature-host.js'
import { MnGrapevinePane, emptyGrapevineSnapshot, type GrapevineMessage, type GrapevineTarget } from './grapevine-pane.js'
import { randomUUID } from '@shrubbery/nucleus/web-crypto'

type Contract = Pick<ShrubberyContract, 'auth' | 'runtime'>
export interface GrapevineAgentNavigation { agentRef: string; graphId: string; graphBaseUrl: string; principal: string }
export function acceptsGrapevineNavigation(contract: Contract | null, graphId: string, value: unknown): value is GrapevineAgentNavigation {
  const detail = value as GrapevineAgentNavigation
  try {
    return Boolean(contract && contract.auth.isAuthenticated() && detail && typeof detail.agentRef === 'string'
      && detail.agentRef.startsWith('urn:') && detail.graphId === graphId && detail.principal === contract.auth.userId()
      && `${detail.graphBaseUrl.replace(/\/$/, '')}/grapevine/api/v1` === grapevineEndpoint(contract, graphId))
  } catch { return false }
}
interface Bootstrap { graph: { owner: string; graphId: string }; identity: { cognitoSub: string; cognitoEmail: string; link: unknown }; targets: GrapevineTarget[] }

export function grapevineEndpoint(contract: Contract, graphId: string): string {
  if (contract.runtime.mode() !== 'hosted' || !contract.runtime.isGateway()) throw Error('Grapevine requires a hosted gateway workspace.')
  const url = new URL(contract.runtime.graphBaseUrl(graphId))
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw Error('Grapevine requires a secure gateway.')
  if (url.username || url.password || url.search || url.hash || !/^\/o\/[^/]+\/g\/[^/]+\/?$/.test(url.pathname)
    || decodeURIComponent(url.pathname.split('/')[4]) !== graphId) throw Error('An exact workspace owner binding is required. Refresh the workspace directory.')
  return `${url.href.replace(/\/$/, '')}/grapevine/api/v1`
}

function bootstrap(value: unknown): Bootstrap {
  const data = value as Bootstrap
  if (!data || typeof data.graph?.owner !== 'string' || typeof data.graph.graphId !== 'string' || typeof data.identity?.cognitoSub !== 'string' || typeof data.identity.cognitoEmail !== 'string'
    || !Object.hasOwn(data.identity, 'link') || !Array.isArray(data.targets)
    || data.targets.some(target => !target || ['id', 'label', 'channel', 'topic'].some(key => typeof (target as unknown as Record<string, unknown>)[key] !== 'string'))
    || data.targets.some(target => target.agentRef !== undefined && (typeof target.agentRef !== 'string' || !target.agentRef.startsWith('urn:')))
    || new Set(data.targets.map(target => target.id)).size !== data.targets.length) throw Error('Grapevine returned an invalid identity or target list.')
  return data
}

function messages(value: unknown): GrapevineMessage[] {
  const data = value as { messages: GrapevineMessage[] }
  if (!Array.isArray(data?.messages) || data.messages.some(message => !message || !Number.isSafeInteger(message.id) || message.id < 1
    || (message.content !== undefined && typeof message.content !== 'string')
    || (message.sender_full_name !== undefined && typeof message.sender_full_name !== 'string')
    || (message.timestamp !== undefined && (!Number.isFinite(message.timestamp) || message.timestamp < 0 || message.timestamp > 8.64e12)))
    || new Set(data.messages.map(message => message.id)).size !== data.messages.length) throw Error('Grapevine returned an invalid message list.')
  return data.messages
}

/** Vinea api.py::_send_response, v1. HTTP success alone is not delivery evidence. */
function confirmedSendReceipt(response: { status: number; body: unknown }): number {
  const receipt = response.body as Record<string, unknown> | null
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.keys(receipt).length !== 7
    || receipt.schema !== 'sophia.grapevine.send-receipt.v1'
    || typeof receipt.zulipMessageId !== 'number' || !Number.isSafeInteger(receipt.zulipMessageId) || receipt.zulipMessageId < 1
    || typeof receipt.replay !== 'boolean' || response.status !== (receipt.replay ? 200 : 201)
    || receipt.delivery !== 'zulip-accepted' || receipt.gardenPersistence !== 'not-attested-by-this-receipt'
    || receipt.recipientAcknowledgementRecorded !== false || receipt.runtimeLaunched !== false) {
    throw Error('Grapevine did not return a confirmed Zulip send receipt.')
  }
  return receipt.zulipMessageId
}

/** One shell-owned session: survives pane replacement, never crosses route/principal. */
export function createGrapevineFeature<TContract = unknown>(): ShellFeature<TContract> {
  let pane: MnGrapevinePane | null = null
  let scope = ''
  let epoch = 0
  let stopAuth: (() => void) | null = null
  let activeContract: Contract | null = null
  let abort: AbortController | null = null
  const dispose = () => { epoch++; abort?.abort(); abort = null; stopAuth?.(); stopAuth = null; pane = null; activeContract = null; scope = '' }
  return {
    id: 'grapevine-conversation',
    afterWorkspaceRender(context) {
      if (context.app !== 'grapevine') {
        // Retain the view/draft while switching apps within the same graph.
        if (pane && pane.snapshot.graphId !== context.graphId) dispose()
        return
      }
      const placeholder = context.host.querySelector<MnGrapevinePane>('mn-grapevine-pane')
      if (!placeholder) return
      const contract = context.contract as Contract | null
      let endpoint = ''
      let problem = ''
      try {
        if (!contract?.auth || !contract.runtime) throw Error('Connect the hosted workspace to use Grapevine.')
        endpoint = grapevineEndpoint(contract, context.graphId)
        if (!contract.auth.isAuthenticated()) throw Error('Sign in to Sophia to use Grapevine.')
      } catch (error) { problem = error instanceof Error ? error.message : 'Grapevine is unavailable.' }
      const nextScope = `${endpoint}|${contract?.auth?.userId() ?? ''}|${context.graphId}|${problem}`
      if (scope === nextScope && activeContract === contract && pane) {
        if (placeholder !== pane) placeholder.replaceWith(pane)
        return
      }
      dispose()
      scope = nextScope
      activeContract = contract
      pane = placeholder
      const view = pane
      view.snapshot = { ...emptyGrapevineSnapshot(), graphId: context.graphId, error: problem }
      if (problem || !contract) return
      const serial = epoch
      const userId = contract.auth.userId()
      const current = () => epoch === serial && contract.auth.isAuthenticated() && contract.auth.userId() === userId
      const publish = (patch: Partial<typeof view.snapshot>) => { if (current()) view.snapshot = { ...view.snapshot, ...patch } }
      const drafts = new Map<string, string>()
      let requestedAgent = ''
      const chooseRequestedAgent = () => {
        if (!requestedAgent || view.snapshot.busy || view.snapshot.status !== 'ready') return
        const agentRef = requestedAgent
        requestedAgent = ''
        const matches = view.snapshot.targets.filter(target => target.agentRef === agentRef)
        if (matches.length === 1) view.onTarget?.(matches[0].id)
        else publish({ error: matches.length ? `Several conversations are configured for ${agentRef}. Choose a channel / topic.` : `No conversation is configured for ${agentRef} in this workspace.` })
      }
      view.onAgentRequest = agentRef => {
        if (view.snapshot.mutating || view.snapshot.uncertain) { publish({ error: 'Finish or inspect the current send before changing conversation.' }); return }
        requestedAgent = agentRef
        chooseRequestedAgent()
      }
      abort = new AbortController()
      const signal = abort.signal
      const request = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
        const requestAbort = new AbortController()
        let rejectInterruption!: (error: Error) => void
        const interrupted = new Promise<never>((_resolve, reject) => { rejectInterruption = reject })
        const interrupt = (error: Error) => {
          // Settle the UI even if authentication/fetch is not cancellable.
          rejectInterruption(error)
          requestAbort.abort(error)
        }
        const cancel = () => interrupt(Error('Conversation request was disposed.'))
        signal.addEventListener('abort', cancel, { once: true })
        const timeout = setTimeout(() => interrupt(Error('Grapevine request timed out after 15 seconds, including sign-in readiness.')), 15000)
        if (signal.aborted) cancel()
        const work = async () => {
          await contract.auth.whenReady()
          // whenReady cannot necessarily be cancelled: a late resolution must
          // not acquire a token or start network work after timeout/disposal.
          if (requestAbort.signal.aborted || !current()) throw Error('Sign-in changed or the request expired; reopen this conversation.')
          const token = contract.auth.token()
          if (!token) throw Error('Sign-in changed; reopen this conversation.')
          const response = await fetch(`${endpoint}${path}`, {
            method, cache: 'no-store', redirect: 'error', signal: requestAbort.signal,
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          if (!response.ok) {
            if (response.status === 404 || response.status === 503) throw Error('Grapevine is not configured or is unavailable on this gateway.')
            if (response.status === 401 || response.status === 403) throw Error('Conversation access was denied. Check your sign-in and workspace permissions.')
            throw Error(`Grapevine request failed (${response.status}).`)
          }
          return { status: response.status, body: await response.json() as unknown }
        }
        try { return await Promise.race([work(), interrupted]) }
        finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel) }
      }
      let readGeneration = 0
      const readMessages = async () => {
        const generation = ++readGeneration
        const targetId = view.snapshot.targetId
        if (!targetId || !view.snapshot.linked) return
        const result = messages((await request('GET', `/messages?targetId=${encodeURIComponent(targetId)}`)).body)
        if (generation === readGeneration && view.snapshot.targetId === targetId) publish({ messages: result })
      }
      let operation = 0
      const perform = async (action: () => Promise<void>, supersede = false) => {
        if ((view.snapshot.busy && !supersede) || !current()) return
        const attempt = ++operation
        publish({ busy: true, error: '' })
        try { await action() } catch (error) {
          if (attempt === operation) publish({ status: 'error', error: error instanceof Error ? error.message : 'Conversation request failed.' })
        } finally { if (attempt === operation) publish({ busy: false }) }
      }
      const load = () => perform(async () => {
        publish({ status: 'loading' })
        const data = bootstrap((await request('GET', '/me')).body)
        if (!current()) return
        if (data.identity.cognitoSub !== userId && `user:${data.identity.cognitoSub}` !== userId) throw Error('Grapevine returned a different signed-in identity.')
        const route = new URL(endpoint).pathname.split('/')
        if (data.graph.owner !== decodeURIComponent(route[2]) || data.graph.graphId !== context.graphId) throw Error('Grapevine returned a different workspace owner or graph.')
        const targetId = data.targets.some(target => target.id === view.snapshot.targetId) ? view.snapshot.targetId : (data.targets[0]?.id ?? '')
        publish({ identity: data.identity.cognitoEmail, linked: Boolean(data.identity.link), targets: data.targets, targetId,
          draft: drafts.get(targetId) ?? '', messages: [], status: 'ready' })
        await readMessages()
      })
      view.onRefresh = () => { void load() }
      view.onTarget = id => {
        if (!view.snapshot.targets.some(target => target.id === id) || view.snapshot.mutating || view.snapshot.uncertain) return
        publish({ targetId: id, draft: drafts.get(id) ?? '', messages: [], delivery: '' })
        void perform(async () => { await readMessages(); if (view.snapshot.targetId === id) publish({ status: 'ready' }) }, true)
      }
      view.onDraft = value => { if (!view.snapshot.mutating && !view.snapshot.uncertain) { drafts.set(view.snapshot.targetId, value); publish({ draft: value }) } }
      view.onLink = () => { void perform(async () => { publish({ mutating: true }); try { await request('POST', '/link'); publish({ delivery: 'Account linked. Refresh to load your conversation.' }) } finally { publish({ mutating: false }) } }) }
      view.onSend = () => {
        const state = view.snapshot
        if (state.uncertain || state.status !== 'ready' || !state.linked || !state.targetId || !state.draft.trim()) return
        const clientNonce = randomUUID().replaceAll('-', '_')
        void perform(async () => {
          publish({ mutating: true })
          let messageId: number
          try {
            messageId = confirmedSendReceipt(await request('POST', '/messages', { targetId: state.targetId, content: state.draft, clientNonce }))
          } catch {
            publish({ mutating: false, uncertain: true, delivery: `Send outcome is uncertain. Draft retained; no automatic retry. Client nonce: ${clientNonce}. Inspect Zulip before sending again.` })
            return
          }
          drafts.delete(state.targetId)
          publish({ mutating: false, draft: '', delivery: `Zulip accepted message ${messageId}. This is not a recipient receipt or a Garden persistence acknowledgment.` })
          await readMessages()
        })
      }
      stopAuth = contract.auth.onChange(() => {
        if (!current()) { dispose(); view.snapshot = { ...emptyGrapevineSnapshot(), graphId: context.graphId, error: 'Sign-in changed. Reopen Grapevine to continue.' } }
      })
      void load().then(chooseRequestedAgent)
    },
    destroy: dispose,
  }
}
