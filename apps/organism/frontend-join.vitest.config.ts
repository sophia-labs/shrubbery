import { defineConfig } from 'vitest/config'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import config from './vitest.config.js'
export default defineConfig({ ...config, test: { ...config.test,
  execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-frontend-join-20260908.json')}`],
  maxWorkers: 1, fileParallelism: false,
} })
