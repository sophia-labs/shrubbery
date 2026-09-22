import { defineConfig } from 'vite'

/** Produce one dependency-closed Node entry for the trusted stateless render
 * pool. The runtime image contains no workspace checkout or package manager. */
export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: 'dist-pool',
    ssr: 'src/pool.ts',
    target: 'node22',
    rollupOptions: {
      output: { entryFileNames: 'planter-pool.mjs' },
    },
  },
  ssr: { noExternal: true },
})
