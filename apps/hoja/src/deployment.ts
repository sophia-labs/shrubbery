export const CANARY_GATEWAY = 'https://api.canary.sophia-labs.com'
export const CANARY_COGNITO_CLIENT_ID = '46raltmjse1gjkkt6hvq30tsk7'

export interface HojaDeploymentEnvironment {
  readonly VITE_GATEWAY_BASE_URL?: string
  readonly VITE_COGNITO_REGION?: string
  readonly VITE_COGNITO_CLIENT_ID?: string
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_HOJA_GRAPH_ID?: string
}

export type HojaDeploymentConfig =
  | { readonly mode: 'soil' }
  | {
      readonly mode: 'cell'
      readonly gatewayBaseUrl: string
      readonly graphId?: string
      readonly cognito: {
        readonly region: string
        readonly clientId: string
        readonly userPoolId?: string
      }
    }

/** No gateway env keeps the existing Soil app shape byte-for-byte. */
export function resolveHojaDeploymentConfig(environment: HojaDeploymentEnvironment): HojaDeploymentConfig {
  const gatewayBaseUrl = trimmed(environment.VITE_GATEWAY_BASE_URL).replace(/\/+$/, '')
  if (!gatewayBaseUrl) return { mode: 'soil' }
  if (!/^https?:\/\//.test(gatewayBaseUrl)) {
    throw new Error('VITE_GATEWAY_BASE_URL must be an absolute http(s) URL')
  }
  const region = trimmed(environment.VITE_COGNITO_REGION) || 'us-west-1'
  const clientId = trimmed(environment.VITE_COGNITO_CLIENT_ID) || CANARY_COGNITO_CLIENT_ID
  const userPoolId = trimmed(environment.VITE_COGNITO_USER_POOL_ID)
  const graphId = trimmed(environment.VITE_HOJA_GRAPH_ID)
  return {
    mode: 'cell',
    gatewayBaseUrl,
    ...(graphId ? { graphId } : {}),
    cognito: {
      region,
      clientId,
      ...(userPoolId ? { userPoolId } : {}),
    },
  }
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? ''
}
