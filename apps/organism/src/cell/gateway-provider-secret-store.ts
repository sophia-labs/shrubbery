import type { AiProvider, ProviderSecretStore } from './provider-secret-store.js'
import type { GatewayTransport } from './gateway-transport.js'

/** Account-scoped, write-only Choreograph credential adapter. */
export class GatewayProviderSecretStore implements ProviderSecretStore {
  readonly providers = ['openrouter'] as const
  readonly storageLabel = 'Choreograph account-scoped encrypted secret store'

  constructor(private readonly gateway: GatewayTransport) {}

  async status(): Promise<Readonly<Record<string, boolean>>> {
    const status = await this.gateway.providerCredentialStatus('openrouter')
    return Object.freeze({ openrouter: status.configured })
  }

  async store(provider: AiProvider, secret: string): Promise<void> {
    if (provider !== 'openrouter') throw new Error(`Choreograph provider is unsupported: ${provider}`)
    await this.gateway.putProviderCredential(provider, secret)
  }

  async delete(provider: AiProvider): Promise<void> {
    if (provider !== 'openrouter') throw new Error(`Choreograph provider is unsupported: ${provider}`)
    await this.gateway.deleteProviderCredential(provider)
  }
}
