/** A narrow adapter from the authenticated gateway root to API-key state. */

import {
  validateApiKeyCreateRequest,
  type ApiKeyCreateRequest,
  type ApiKeyCreateResponse,
  type ApiKeyDeleteResponse,
  type ApiKeyMetadata,
} from './api-key-contract.js'
import type { GatewayTransport } from './gateway-transport.js'

export interface ApiKeyGatewayRootTransport {
  listApiKeys(options?: { readonly signal?: AbortSignal }): Promise<readonly ApiKeyMetadata[]>
  createApiKey(
    request: ApiKeyCreateRequest,
    idempotencyKey: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApiKeyCreateResponse>
  deleteApiKey(
    keyId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApiKeyDeleteResponse>
}
export interface ApiKeyClient {
  list(options?: { readonly signal?: AbortSignal }): Promise<readonly ApiKeyMetadata[]>
  create(
    request: ApiKeyCreateRequest,
    idempotencyKey: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApiKeyCreateResponse>
  remove(keyId: string, options?: { readonly signal?: AbortSignal }): Promise<ApiKeyDeleteResponse>
}

/**
 * The transport has no owner, graph, or route argument. A caller can manage
 * only the keys of the Cognito session furnishing the fresh bearer token.
 */
export class GatewayApiKeyClient implements ApiKeyClient {
  constructor(private readonly gateway: ApiKeyGatewayRootTransport | GatewayTransport) {}

  list(options: { readonly signal?: AbortSignal } = {}): Promise<readonly ApiKeyMetadata[]> {
    return this.gateway.listApiKeys(options)
  }

  create(
    request: ApiKeyCreateRequest,
    idempotencyKey: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ApiKeyCreateResponse> {
    return this.gateway.createApiKey(validateApiKeyCreateRequest(request), idempotencyKey, options)
  }

  remove(keyId: string, options: { readonly signal?: AbortSignal } = {}): Promise<ApiKeyDeleteResponse> {
    return this.gateway.deleteApiKey(keyId, options)
  }
}

export function createGatewayApiKeyClient(
  gateway: ApiKeyGatewayRootTransport | GatewayTransport,
): GatewayApiKeyClient {
  return new GatewayApiKeyClient(gateway)
}
