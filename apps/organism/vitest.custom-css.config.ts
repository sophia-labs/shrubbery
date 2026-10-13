import { defineConfig } from 'vitest/config'
import base from './vitest.config.js'
export default defineConfig({ ...base, test: {
  ...base.test,
  setupFiles: ['./tests/setup.ts', './tests/custom-css-storage-setup.ts'],
  execArgv: [`--localstorage-file=${process.env.SHRUBBERY_CSS_TEST_STORAGE ?? '/tmp/vitest-custom-css-settings-20260908.json'}`],
} })
