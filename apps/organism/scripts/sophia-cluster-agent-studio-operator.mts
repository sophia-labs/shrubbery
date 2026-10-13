import { StaticAuth } from '@shrubbery/source'
import { GatewayTransport } from '@shrubbery/source/gateway'
import {
  operateSophiaClusterAgentStudio,
  parseActiveRevision,
  parseRevision,
  SOPHIA_CLUSTER_AGENT_STUDIO_GATEWAY,
  type SophiaClusterAgentStudioAction,
  type SophiaClusterAgentStudioConfirmation,
} from './sophia-cluster-agent-studio-operator-lib.js'

const TOKEN_ENV = 'SOPHIA_CLOUD2_BEARER_TOKEN'
const RUNTIME_ENV = 'SOPHIA_AGENT_RUNTIME_BUNDLE_DIGEST'

interface Arguments {
  readonly action: SophiaClusterAgentStudioAction
  readonly confirmation?: SophiaClusterAgentStudioConfirmation
}

try {
  const parsed = parseArguments(process.argv.slice(2))
  const token = requiredEnvironment(TOKEN_ENV)
  const runtimeBundleDigest = requiredEnvironment(RUNTIME_ENV)
  const gateway = new GatewayTransport({
    gatewayBaseUrl: SOPHIA_CLUSTER_AGENT_STUDIO_GATEWAY,
    auth: new StaticAuth(token, 'sophia-agent-studio-operator'),
  })
  const result = await operateSophiaClusterAgentStudio(gateway, {
    action: parsed.action,
    runtimeBundleDigest,
    ...(parsed.confirmation ? { confirmation: parsed.confirmation } : {}),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  const token = process.env[TOKEN_ENV] ?? ''
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = token ? raw.replaceAll(token, '[REDACTED]') : raw
  process.stderr.write(`${JSON.stringify({
    schema: 'sophia.agent-studio-operator-error.v1',
    error: redacted.slice(0, 320),
  })}\n`)
  process.exitCode = 1
}

function parseArguments(argv: readonly string[]): Arguments {
  let action: SophiaClusterAgentStudioAction = 'inspect'
  let profileDigest: string | undefined
  let profileRevision: number | undefined
  let activeDefinitionRevision: number | 'absent' | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--save' || argument === '--publish') {
      if (action !== 'inspect') throw new Error('--save and --publish are separate operations')
      action = argument === '--save' ? 'save' : 'publish'
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${argument} requires a value`)
    if (argument === '--confirm-profile-digest') profileDigest = value
    else if (argument === '--expect-profile-revision') profileRevision = parseRevision(value, 'profile revision')
    else if (argument === '--expect-active-revision') activeDefinitionRevision = parseActiveRevision(value)
    else throw new Error(`Unsupported argument '${argument}'`)
    index += 1
  }
  if (action === 'inspect') {
    if (profileDigest !== undefined || profileRevision !== undefined || activeDefinitionRevision !== undefined) {
      throw new Error('Inspect mode accepts no mutation confirmation flags')
    }
    return { action }
  }
  if (!profileDigest || profileRevision === undefined) {
    throw new Error(`${action} requires --confirm-profile-digest and --expect-profile-revision`)
  }
  if (action === 'publish' && activeDefinitionRevision === undefined) {
    throw new Error('publish requires --expect-active-revision <revision|absent>')
  }
  if (action === 'save' && activeDefinitionRevision !== undefined) {
    throw new Error('save does not accept --expect-active-revision')
  }
  return {
    action,
    confirmation: {
      profileDigest,
      profileRevision,
      ...(activeDefinitionRevision === undefined ? {} : { activeDefinitionRevision }),
    },
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
