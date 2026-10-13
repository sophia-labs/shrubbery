import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'
export default defineConfig({ ...base, test: { ...base.test,
  include: ['src/cell/__tests__/grapevine-pane.test.ts'],
  execArgv: ['--localstorage-file=/tmp/vitest-trellis-grapevine-20260908.json'],
} })
