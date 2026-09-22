/** Write-only provider-secret boundary used by Settings. */

export const AI_PROVIDERS = ['openrouter', 'anthropic', 'openai'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export interface ProviderSecretStore {
  readonly providers: readonly AiProvider[]
  /** Returns set/unset metadata only. Secret values must never cross this seam. */
  status(): Promise<Readonly<Record<string, boolean>>>
  store(provider: AiProvider, secret: string): Promise<void>
  delete(provider: AiProvider): Promise<void>
  /** Honest user-facing description of the backing store. */
  readonly storageLabel: string
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export class TauriProviderSecretStore implements ProviderSecretStore {
  readonly providers = AI_PROVIDERS
  readonly storageLabel = 'Garden owner-only local secret store'

  constructor(private readonly invoke: TauriInvoke) {}

  async status(): Promise<Readonly<Record<string, boolean>>> {
    const value = await this.invoke<Record<string, boolean>>('provider_key_status')
    return Object.freeze({ ...value })
  }

  async store(provider: AiProvider, secret: string): Promise<void> {
    await this.invoke<void>('store_provider_key', { provider, apiKey: secret })
  }

  async delete(provider: AiProvider): Promise<void> {
    await this.invoke<void>('delete_provider_key', { provider })
  }
}

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value)
}
