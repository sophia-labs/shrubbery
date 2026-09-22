import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    // The kernel instantiates a REAL TipTap Editor, which mounts ProseMirror
    // into the DOM. happy-dom matches runtime + nucleus + garden/frontend's
    // vitest environment.
    environment: 'happy-dom',
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-editor-kernel-localstorage.json')}`],
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
