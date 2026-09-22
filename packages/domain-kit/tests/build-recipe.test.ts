import { describe, expect, it } from 'vitest'
import {
  buildDomainBuildRecipe,
  domainBuildRecipeDigest,
  parseDomainBuildRecipe,
} from '../src/build-recipe.js'

const recipe = buildDomainBuildRecipe({
  recipeId: 'shrubbery.planter',
  repository: 'sophia-labs/shrubbery',
  contextSubdir: '.',
  dockerfile: 'Dockerfile.planter',
  dockerfileSha256: '5d1eabcc76760d1b44f936c455766c10a876ae5d4f5554ef1a99ad00306c84ef',
  checkScript: 'native-builder-check.sh',
  checkScriptSha256: 'c4371bbe4679e9a99198c3afdee12787e6fadc76ee82bccaf7c83212d53a57ca',
  imageRepository: 'planter-pool',
  instanceType: 'c6i.2xlarge',
  maxImageBytes: 536_870_912,
  maxDurationSeconds: 3_300,
  estimatedCostMicrousd: 2_500_000,
  cargoJobs: 1,
  requireCheck: true,
  requireLockArtifact: false,
  pushImage: true,
})

describe('Domain native-build recipe', () => {
  it('has the exact cross-service digest', () => {
    expect(domainBuildRecipeDigest(recipe)).toBe('289749e5cec026eb97dc227904bb5c3b002e1c997092238ed5e9a6943307cf3a')
  })

  it('rejects hidden fields and coordinates the builder service would reject', () => {
    expect(() => parseDomainBuildRecipe({ ...recipe, command: 'curl attacker.invalid' })).toThrow(/fields are not exact/)
    expect(() => parseDomainBuildRecipe({ ...recipe, repository: 'sophia-labs/..' })).toThrow(/repository is invalid/)
    expect(() => parseDomainBuildRecipe({ ...recipe, instanceType: 'GPU!!!' })).toThrow(/instanceType is invalid/)
    expect(() => parseDomainBuildRecipe({ ...recipe, checkScriptSha256: '0'.repeat(63) })).toThrow(/lowercase SHA-256/)
  })
})
