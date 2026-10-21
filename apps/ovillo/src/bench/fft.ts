/**
 * A radix-2 FFT with its tables made once: magnitude in dBFS (a full-scale sine
 * reads about 0) of a Hann-windowed frame, written into `out`. Ported from the
 * ovillo bench (site/bench/bench.js, makeFft) unchanged in arithmetic.
 */
export interface Fft {
  mag(x: Float32Array, out: Float32Array): void
}

export function makeFft(n: number): Fft {
  const bits = Math.log2(n) | 0
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const cos = new Float32Array(n / 2)
  const sin = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = -Math.sin((2 * Math.PI * i) / n)
  }
  const win = new Float32Array(n)
  let wsum = 0
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    wsum += win[i]
  }
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  return {
    mag(x, out) {
      for (let i = 0; i < n; i++) {
        re[rev[i]] = x[i] * win[i]
        im[rev[i]] = 0
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1
        const step = n / size
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j
            const b = a + half
            const tr = re[b] * cos[k] - im[b] * sin[k]
            const ti = re[b] * sin[k] + im[b] * cos[k]
            re[b] = re[a] - tr
            im[b] = im[a] - ti
            re[a] += tr
            im[a] += ti
          }
        }
      }
      const norm = 2 / wsum
      for (let i = 0; i < n / 2; i++) {
        const m = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * norm
        out[i] = 20 * Math.log10(m + 1e-12)
      }
    },
  }
}
