import { describe, expect, it } from 'vitest'
import { CANARY_COGNITO_CLIENT_ID, resolveHojaDeploymentConfig } from '../src/deployment.js'

describe('resolveHojaDeploymentConfig', () => {
  it('keeps the existing local Soil posture when no gateway is configured', () => {
    expect(resolveHojaDeploymentConfig({})).toEqual({ mode: 'soil' })
  })

  it('builds the canary Cognito + graph cell posture with conservative defaults', () => {
    expect(resolveHojaDeploymentConfig({
      VITE_GATEWAY_BASE_URL: ' https://api.canary.sophia-labs.com/ ',
      VITE_HOJA_GRAPH_ID: ' obs-hoja-1 ',
    })).toEqual({
      mode: 'cell',
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      graphId: 'obs-hoja-1',
      cognito: { region: 'us-west-1', clientId: CANARY_COGNITO_CLIENT_ID },
    })
  })

  it('rejects a non-HTTP gateway instead of silently falling back to local data', () => {
    expect(() => resolveHojaDeploymentConfig({ VITE_GATEWAY_BASE_URL: 'api.example.test' }))
      .toThrow(/absolute http/i)
  })
})
