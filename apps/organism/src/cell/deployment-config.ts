import type { GatewayGraphInfo } from './gateway-transport.js'

export interface OrganismDeploymentEnvironment {
  readonly VITE_GATEWAY_BASE_URL?: string
  readonly VITE_COGNITO_REGION?: string
  readonly VITE_COGNITO_CLIENT_ID?: string
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_CHAT_API_BASE_URL?: string
  /** Non-secret subject used only with the Vite server-side service proxy. */
  readonly VITE_CLOUD2_SERVICE_PROXY_SUBJECT?: string
}

export interface PlaygroundDeploymentConfig {
  readonly mode: 'playground'
}

export interface HostedDeploymentConfig {
  readonly mode: 'hosted'
  readonly gatewayBaseUrl: string
  readonly cognito: {
    readonly region: string
    readonly clientId: string
    readonly userPoolId?: string
  }
  readonly chatApiBaseUrl: string | null
  readonly devServiceProxySubject?: string
}

export type OrganismDeploymentConfig = PlaygroundDeploymentConfig | HostedDeploymentConfig

function trimmed(value: string | undefined): string {
  return value?.trim() ?? ''
}

/** Resolve the shell profile once at boot; partial hosted config fails loudly. */
export function resolveOrganismDeploymentConfig(
  environment: OrganismDeploymentEnvironment,
): OrganismDeploymentConfig {
  const gatewayBaseUrl = trimmed(environment.VITE_GATEWAY_BASE_URL).replace(/\/+$/, '')
  if (!gatewayBaseUrl) return { mode: 'playground' }
  if (!/^https?:\/\//.test(gatewayBaseUrl)) {
    throw new Error('VITE_GATEWAY_BASE_URL must be an absolute http(s) URL')
  }

  const region = trimmed(environment.VITE_COGNITO_REGION) || 'us-west-1'
  const clientId = trimmed(environment.VITE_COGNITO_CLIENT_ID)
  if (!clientId) {
    throw new Error(
      'Hosted Organism requires VITE_COGNITO_CLIENT_ID.',
    )
  }
  const userPoolId = trimmed(environment.VITE_COGNITO_USER_POOL_ID)
  const chatApiBaseUrl = trimmed(environment.VITE_CHAT_API_BASE_URL).replace(/\/+$/, '')
  const devServiceProxySubject = trimmed(environment.VITE_CLOUD2_SERVICE_PROXY_SUBJECT)
  return {
    mode: 'hosted',
    gatewayBaseUrl,
    cognito: {
      region,
      clientId,
      ...(userPoolId ? { userPoolId } : {}),
    },
    chatApiBaseUrl: chatApiBaseUrl || null,
    ...(devServiceProxySubject ? { devServiceProxySubject } : {}),
  }
}

/** URL selection wins; otherwise prefer an already-running accessible graph. */
export function selectHostedGraphId(
  location: Pick<Location, 'href'> | URL,
  graphs: readonly GatewayGraphInfo[],
): string | null {
  const url = location instanceof URL ? location : new URL(location.href)
  const requested = (url.searchParams.get('graph_id') ?? url.searchParams.get('graph') ?? '').trim()
  if (requested) {
    if (!graphs.some(graph => graph.graphId === requested)) {
      throw new Error(`Graph "${requested}" is not available to this account.`)
    }
    return requested
  }
  return graphs.find(graph => graph.cellState === 'running')?.graphId ?? graphs[0]?.graphId ?? null
}
