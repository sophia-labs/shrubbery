/** Node entry for one explicitly bound Planter server.
 *
 * Kept separate from `server.ts` so importing the reusable renderer into the
 * pooled production bundle cannot accidentally execute this process boot after
 * Rollup coalesces modules into one output file.
 */

import { siteBundleFor } from '@shrubbery/site'
import { sourceFromBoot } from '@shrubbery/source'
import { createPlanterServer } from './server.js'
import { bootConfigFromProcessEnv } from './server-boot.js'

const port = Number(process.env.PORT ?? 8793)

Promise.resolve()
  .then(() => bootConfigFromProcessEnv(process.env))
  .then(async (config) => {
    const source = await sourceFromBoot(config)
    const server = createPlanterServer({
      source,
      graphId: config.graph,
      ...(config.configGraphIri !== undefined ? { configGraphIri: config.configGraphIri } : {}),
      authMode: config.auth.mode,
      ...(config.bundle !== undefined ? { bundle: siteBundleFor(config.bundle) } : {}),
    })
    server.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(
        `planter → http://localhost:${port}/site  ·  /source  ·  /health  ` +
          `(graph ${config.graph}, adapter ${source.description.kind})`,
      )
    })
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`planter: failed to boot — ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
