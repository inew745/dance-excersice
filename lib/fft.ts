/**
 * Iterative radix-2 Cooley-Tukey FFT.
 *
 * The browser's AnalyserNode only reports the spectrum of whatever is playing
 * right now, which is no use when we need frame-accurate spectra for a track
 * we are rendering faster than real time. So we do our own transform.
 */
export class FFT {
  readonly size: number;
  private readonly levels: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.levels = Math.log2(size);

    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }

    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let j = 0; j < this.levels; j++) r |= ((i >>> j) & 1) << (this.levels - 1 - j);
      this.reverse[i] = r;
    }
  }

  /** In-place complex FFT. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.size;

    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    for (let span = 2; span <= n; span <<= 1) {
      const half = span >>> 1;
      const step = n / span;
      for (let i = 0; i < n; i += span) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const l = i + j;
          const h = l + half;
          const cos = this.cosTable[k];
          const sin = this.sinTable[k];
          const tre = re[h] * cos + im[h] * sin;
          const tim = -re[h] * sin + im[h] * cos;
          re[h] = re[l] - tre;
          im[h] = im[l] - tim;
          re[l] += tre;
          im[l] += tim;
        }
      }
    }
  }
}

/** Periodic Hann window — the usual choice for overlapping STFT analysis. */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  return w;
}
