// one-euro-filter.js — Filtro "One Euro" (Casiez et al., 2012) para N dimensiones.
// Suaviza mucho cuando la mano está casi quieta (quita el temblor) y poco cuando se
// mueve rápido (evita el retraso). La velocidad se mide como módulo del vector, así un
// movimiento diagonal se trata igual que uno horizontal.

function alpha(dtSec, cutoffHz) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  /**
   * @param {object} opts
   * @param {number} opts.minCutoff Hz. Menor = menos temblor en reposo, pero más retraso.
   * @param {number} opts.beta      Cuánto sube el corte con la velocidad. Mayor = menos retraso al moverse.
   * @param {number} opts.dCutoff   Hz del filtro de la derivada (normalmente 1).
   */
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.prev = null;
    this.dPrev = null;
    this.tPrev = 0;
  }

  /** @param {number[]} value  @param {number} tMs  @returns {number[]} */
  filter(value, tMs) {
    if (!this.prev) {
      this.prev = value.slice();
      this.dPrev = value.map(() => 0);
      this.tPrev = tMs;
      return value.slice();
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    this.tPrev = tMs;

    const aD = alpha(dt, this.dCutoff);
    let speed = 0;
    for (let i = 0; i < value.length; i++) {
      const d = (value[i] - this.prev[i]) / dt;
      this.dPrev[i] = aD * d + (1 - aD) * this.dPrev[i];
      speed += this.dPrev[i] * this.dPrev[i];
    }
    const a = alpha(dt, this.minCutoff + this.beta * Math.sqrt(speed));
    for (let i = 0; i < value.length; i++) {
      this.prev[i] = a * value[i] + (1 - a) * this.prev[i];
    }
    return this.prev.slice();
  }
}
