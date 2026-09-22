import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = readFileSync(
  fileURLToPath(new URL('../scripts/deploy-canary-prefix.sh', import.meta.url)),
  'utf8',
)

describe('canary prefix deploy guard', () => {
  it('can delete stale Hoja assets only inside /hoja/ and invalidates only that path', () => {
    expect(script).toContain('target="s3://${bucket}/hoja/"')
    expect(script).toContain('aws s3 sync dist/ "$target" --delete')
    expect(script).toContain('--paths "/hoja/*"')
    expect(script).not.toMatch(/aws s3 sync dist\/ "s3:\/\/${bucket}\/" --delete/)
  })

  it('is plan-only unless the caller explicitly supplies --apply', () => {
    expect(script).toContain('mode="${1:-plan}"')
    expect(script).toContain('aws s3 sync dist/ "$target" --delete --dryrun')
    expect(script).toContain('type hoja:')
  })
})
