let pdfJsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null

export async function loadPdfJs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      const maybeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
      if (worker.default) {
        const workerSrc = maybeProcess?.versions?.node && worker.default.startsWith('/@fs/')
          ? `file://${worker.default.slice('/@fs'.length)}`
          : worker.default
        if (!(maybeProcess?.versions?.node && workerSrc.startsWith('/node_modules/'))) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
        }
      }
      return pdfjs
    })
  }
  return pdfJsPromise
}
