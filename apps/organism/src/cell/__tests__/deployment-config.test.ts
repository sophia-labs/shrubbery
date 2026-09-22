import { describe, expect, it } from 'vitest'
import {
  resolveOrganismDeploymentConfig,
  selectHostedGraphId,
} from '../deployment-config.js'

describe('Organism deployment config', () => {
  it('keeps the source playground when no gateway is configured', () => {
    expect(resolveOrganismDeploymentConfig({})).toEqual({ mode: 'playground' })
  })

  it('requires a complete Cognito profile and normalizes hosted origins', () => {
    expect(() => resolveOrganismDeploymentConfig({
      VITE_GATEWAY_BASE_URL: 'https://gateway.test',
    })).toThrow('VITE_COGNITO_CLIENT_ID')
    expect(resolveOrganismDeploymentConfig({
      VITE_GATEWAY_BASE_URL: ' https://gateway.test/ ',
      VITE_COGNITO_REGION: 'us-west-1',
      VITE_COGNITO_CLIENT_ID: 'client',
      VITE_COGNITO_USER_POOL_ID: 'pool',
      VITE_CHAT_API_BASE_URL: 'https://chat.test/',
    })).toEqual({
      mode: 'hosted',
      gatewayBaseUrl: 'https://gateway.test',
      cognito: { region: 'us-west-1', clientId: 'client', userPoolId: 'pool' },
      chatApiBaseUrl: 'https://chat.test',
    })
  })

  it('selects an explicit accessible graph, then a running graph, then any graph', () => {
    const graphs = [
      { graphId: 'stopped', title: 'Stopped', role: 'owner' as const, cellState: 'stopped' as const },
      { graphId: 'running', title: 'Running', role: 'editor' as const, cellState: 'running' as const },
    ]
    expect(selectHostedGraphId(new URL('https://app.test/?graph=stopped'), graphs)).toBe('stopped')
    expect(selectHostedGraphId(new URL('https://app.test/'), graphs)).toBe('running')
    expect(selectHostedGraphId(new URL('https://app.test/'), [graphs[0]])).toBe('stopped')
    expect(selectHostedGraphId(new URL('https://app.test/'), [])).toBeNull()
    expect(() => selectHostedGraphId(new URL('https://app.test/?graph=missing'), graphs)).toThrow(
      'not available',
    )
  })
})
