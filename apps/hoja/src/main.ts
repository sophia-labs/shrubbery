import '@shrubbery/tokens/tokens.css'
import '@shrubbery/hoja'
import '@shrubbery/components/top-bar'
import { createCognitoAuthSession, GatewayTransport } from '@shrubbery/source/gateway'
import { localFeatureOptIns } from '@shrubbery/source/features'
import { CellStore } from './cell-store.js'
import { resolveHojaDeploymentConfig } from './deployment.js'
import { HojaApp } from './hoja-app.js'
import { SoilStore } from './seed-store.js'
import { unloadAwareFetch } from './unload.js'

const deployment = resolveHojaDeploymentConfig({
  VITE_GATEWAY_BASE_URL: import.meta.env.VITE_GATEWAY_BASE_URL,
  VITE_COGNITO_REGION: import.meta.env.VITE_COGNITO_REGION,
  VITE_COGNITO_CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID,
  VITE_COGNITO_USER_POOL_ID: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  VITE_HOJA_GRAPH_ID: import.meta.env.VITE_HOJA_GRAPH_ID,
})

const app = new HojaApp()
app.gardenHref = import.meta.env.VITE_GARDEN_APP_URL?.trim()
  || (import.meta.env.DEV ? 'http://127.0.0.1:5191/browser-harness.html' : '/')
app.localFeatures = localFeatureOptIns(import.meta.env)
app.choreographHref = import.meta.env.VITE_CHOREOGRAPH_APP_URL?.trim()
  || (import.meta.env.DEV ? 'http://127.0.0.1:5191/browser-harness.html?app=choreograph' : '/choreograph')
if (deployment.mode === 'cell') {
  const auth = createCognitoAuthSession({ config: deployment.cognito })
  const gateway = new GatewayTransport({ gatewayBaseUrl: deployment.gatewayBaseUrl, auth, fetch: unloadAwareFetch() })
  app.authSession = auth
  app.store = new CellStore({
    gateway,
    graphId: deployment.graphId,
    location: window.location,
    storage: window.sessionStorage,
  })
  const stopRefresh = auth.startAutoRefresh({
    onError: error => console.error('[hoja] Cognito token refresh failed; retrying', error),
  })
  window.addEventListener('pagehide', stopRefresh, { once: true })
} else {
  app.store = new SoilStore()
}

const host = document.getElementById('app')
if (!host) throw new Error('hoja app host is missing')
host.append(app)
