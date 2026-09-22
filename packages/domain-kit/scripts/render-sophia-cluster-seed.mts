import {
  AGENT_STUDIO_PROFILE_SCHEMA,
  canonicalJson,
  compileAgentStudioProfile,
  createSophiaClusterLeadProfile,
  SOPHIA_CLUSTER_LEAD_HARNESS,
} from '../src/agent-studio.js'

const args = new Map<string, string>()
const cliArguments = process.argv.slice(2).filter((value) => value !== '--')
for (let index = 0; index < cliArguments.length; index += 2) {
  const key = cliArguments[index]
  const value = cliArguments[index + 1]
  if (!key?.startsWith('--') || value === undefined) throw new Error('arguments must be --name value pairs')
  args.set(key.slice(2), value)
}

const ownerPrincipal = required('owner-principal')
const runtimeBundleDigest = required('runtime-bundle-digest')
const promotedAt = Number(required('promoted-at'))
if (!Number.isSafeInteger(promotedAt) || promotedAt < 0) throw new Error('--promoted-at must be a non-negative epoch millisecond')

const profile = createSophiaClusterLeadProfile({ ownerPrincipal, runtimeBundleDigest })
const publication = await compileAgentStudioProfile(profile, {
  promotedBy: ownerPrincipal,
  promotedAt,
  promptDocument: {},
})
const seed = {
  schema: 'sophia.agent-studio-seed.v1',
  graphId: 'sophia-cluster',
  ownerPrincipal,
  authorityGraphId: profile.grantAuthority.graphId,
  authorityOwnerPrincipal: profile.grantAuthority.ownerPrincipal,
  uxConfigSeed: 'apps/organism/seeds/sophia-cluster-workspace.ux.nt',
  definitionDocumentId: publication.definitionDocumentId,
  grantDocumentId: publication.activeDocumentIds.grant,
  graphDocuments: {
    ...publication.homeDocuments,
    'agent-studio-profile': canonicalJson(profile),
    [SOPHIA_CLUSTER_LEAD_HARNESS.harnessId]: canonicalJson(SOPHIA_CLUSTER_LEAD_HARNESS),
  },
  authorityDocuments: publication.authorityDocuments,
  publication: {
    profileSchema: AGENT_STUDIO_PROFILE_SCHEMA,
    publicationId: publication.publicationId,
    publicationDigest: publication.digest,
  },
}

process.stdout.write(`${JSON.stringify(seed, null, 2)}\n`)

function required(name: string): string {
  const value = args.get(name)?.trim()
  if (!value) throw new Error(`--${name} is required`)
  return value
}
