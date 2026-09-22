import { contentDigest, requireRecord, requireText } from './canonical.js'

export const DOMAIN_BUILD_RECIPE_SCHEMA = 'sophia.build-recipe.v1' as const

export interface DomainBuildRecipe {
  readonly schema: typeof DOMAIN_BUILD_RECIPE_SCHEMA
  readonly recipeId: string
  readonly repository: string
  readonly contextSubdir: string
  readonly dockerfile: string
  readonly dockerfileSha256: string
  readonly checkScript: string
  readonly checkScriptSha256: string
  readonly imageRepository: string
  readonly instanceType: string
  readonly maxImageBytes: number
  readonly maxDurationSeconds: number
  readonly estimatedCostMicrousd: number
  readonly cargoJobs: number
  readonly requireCheck: true
  readonly requireLockArtifact: boolean
  readonly pushImage: true
}

export function buildDomainBuildRecipe(input: Omit<DomainBuildRecipe, 'schema'>): DomainBuildRecipe {
  return parseDomainBuildRecipe({ schema: DOMAIN_BUILD_RECIPE_SCHEMA, ...input })
}

export function parseDomainBuildRecipe(value: unknown): DomainBuildRecipe {
  const input = requireRecord(value, 'build recipe')
  const fields = [
    'schema',
    'recipeId',
    'repository',
    'contextSubdir',
    'dockerfile',
    'dockerfileSha256',
    'checkScript',
    'checkScriptSha256',
    'imageRepository',
    'instanceType',
    'maxImageBytes',
    'maxDurationSeconds',
    'estimatedCostMicrousd',
    'cargoJobs',
    'requireCheck',
    'requireLockArtifact',
    'pushImage',
  ] as const
  if (Object.keys(input).length !== fields.length || fields.some((field) => !(field in input))) {
    throw new Error('build recipe fields are not exact')
  }
  if (input.schema !== DOMAIN_BUILD_RECIPE_SCHEMA) {
    throw new Error(`expected build recipe schema '${DOMAIN_BUILD_RECIPE_SCHEMA}'`)
  }
  for (const field of [
    'recipeId',
    'repository',
    'contextSubdir',
    'dockerfile',
    'checkScript',
    'imageRepository',
    'instanceType',
  ] as const) {
    requireText(input[field], `build recipe ${field}`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(input.recipeId))) {
    throw new Error('build recipe recipeId is invalid')
  }
  for (const field of ['dockerfileSha256', 'checkScriptSha256'] as const) {
    if (!/^[0-9a-f]{64}$/.test(String(input[field]))) {
      throw new Error(`build recipe ${field} must be a lowercase SHA-256`)
    }
  }
  if (
    !/^[A-Za-z0-9_.-]{1,100}\/[-A-Za-z0-9_.]{1,100}$/.test(String(input.repository)) ||
    String(input.repository).includes('..')
  ) {
    throw new Error('build recipe repository is invalid')
  }
  for (const field of ['contextSubdir', 'dockerfile', 'checkScript'] as const) {
    const path = String(input[field])
    const rootContext = field === 'contextSubdir' && path === '.'
    if (!rootContext && (path.startsWith('/') || path.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path))) {
      throw new Error(`build recipe ${field} is not a safe repository-relative path`)
    }
  }
  if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(String(input.imageRepository))) {
    throw new Error('build recipe imageRepository is invalid')
  }
  if (!/^[a-z0-9][a-z0-9.]{1,31}$/.test(String(input.instanceType))) {
    throw new Error('build recipe instanceType is invalid')
  }
  boundedInteger(input.maxImageBytes, 'build recipe maxImageBytes', 67_108_864, 2_147_483_648)
  boundedInteger(input.maxDurationSeconds, 'build recipe maxDurationSeconds', 60, 3_600)
  boundedInteger(input.estimatedCostMicrousd, 'build recipe estimatedCostMicrousd', 1, 100_000_000)
  boundedInteger(input.cargoJobs, 'build recipe cargoJobs', 1, 32)
  if (input.requireCheck !== true || typeof input.requireLockArtifact !== 'boolean' || input.pushImage !== true) {
    throw new Error('build recipe must require acceptance, declare lock posture, and publish an immutable image')
  }
  return input as unknown as DomainBuildRecipe
}

export function domainBuildRecipeDigest(recipe: DomainBuildRecipe): string {
  return contentDigest(parseDomainBuildRecipe(recipe))
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}]`)
  }
}
