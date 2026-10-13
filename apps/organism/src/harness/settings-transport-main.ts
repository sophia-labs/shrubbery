import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import { GardendLocalAiSettings } from '../cell/local-ai-settings.js'
import { GardendSettingsOperations } from '../cell/settings-operations.js'
import { createDefaultSettingsService } from '../cell/settings-service.js'
import { mountOrganismAppRoute } from '../cell/app-routes.js'
import type { ShrubberyContract } from '@shrubbery/nucleus'

const query = new URLSearchParams(location.search)
const mode = query.get('mode') === 'local' ? 'local' : 'hosted'
const api = query.get('api') ?? ''
if (new URL(api).hostname !== '127.0.0.1') throw new Error('Fixture API must be isolated loopback')
const graphId = 'settings-transport-fixture'
const contract: Pick<ShrubberyContract, 'auth' | 'runtime' | 'ui'> = {
  auth: { token: () => 'synthetic-settings-token', userId: () => 'synthetic-settings-user',
    whenReady: async () => {}, isAuthenticated: () => true, onChange: () => () => {} },
  runtime: { mode: () => mode, isGateway: () => mode === 'hosted', graphBaseUrl: () => api },
  ui: { confirm: async () => { throw new Error('No mutations in this browser fixture') }, icon: () => ({}) as never, presenceColors: [] },
}
applySkinTheme({ skin: 'garden', theme: 'light' })
const operations = new GardendSettingsOperations(contract, graphId, 'document-fixture', mode)
const localAi = new GardendLocalAiSettings(contract, graphId, { runtimeMode: mode, canWrite: async () => false })
const service = createDefaultSettingsService({ runtimeMode: mode, operations, localAi })
const mount = mountOrganismAppRoute(document.getElementById('settings-fixture')!, {
  location: new URL('/settings#local-ai', location.origin), settingsService: service,
})!
await mount.ready
const page = document.querySelector('mn-settings-page') as HTMLElement & { updateComplete: Promise<unknown> }
await page.updateComplete
const snapshot = await service.load()
;(window as unknown as { __settingsTransportSnapshot: unknown }).__settingsTransportSnapshot = {
  sections: snapshot.sections.filter(section => section.id === 'local-ai' || section.id === 'history'),
  historyStatus: operations.snapshot().historyStatus,
  historyError: operations.snapshot().historyError,
}
await document.fonts.ready
document.body.dataset.settingsTransportReady = 'true'
