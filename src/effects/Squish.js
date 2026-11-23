import { ContactEffect } from './ContactEffect.js';
import { len3, clamp } from '../core/math.js';

// Squish — чистое сплющивание об коллайдер: точная вмятина, кольцо объёма, растекание.
export class Squish extends ContactEffect {
  static type = 'squish';
  static defaults = {
    intensity: 1, // 1 — вмятина точно повторяет коллайдер
    shapeSmoothing: 6, // скругление края вмятины
    spread: 9, // ширина кольца объёма (в кольцах вершин)
    volumePreservation: 0.6, // доля вдавленного объёма, вернувшаяся выпуклостью
    lateralFlow: 0, // растекание ореола вдоль поверхности
    correctiveSmooth: 4, // сглаживание смещений
    collisionOffset: 0.0015,
    contactHardness: 1, // большие коллайдеры: 1 — никогда не проходят внутрь
    splay: 0.2, // 0 — сплющить, 1 — растечь вбок
    selfCollision: false, // мягкая плоть давит сама на себя (складки)
    exactContact: 1,
    inflatePressure: 0,
    minHitSpeed: 0.15,
    impactSensitivity: 1.5,
  };
  static regionParams = ['intensity', 'volumePreservation'];

  apply() {
    const p = this.params, q = this.quality, s = this.solver;
    if (!this.gatherContacts(p.selfCollision, { gap: 0.0005 })) return;
    const inten = this.nodeParam('intensity');
    const scale = this._scale || (this._scale = new Float32Array(this.sm.nodeCount));
    if (this._src !== inten) { for (let n = 0; n < inten.length; n++) scale[n] = Math.min(inten[n], 1); this._src = inten; }
    const rings = Math.min(Math.round(p.spread) + 2, q.maxRings);
    s.computeDent({
      scale, splay: p.splay, axisIters: 3, rings,
      rimIters: Math.round(p.shapeSmoothing * 0.6 * q.smoothingScale), rim: 0.35 + 0.4 * clamp(p.intensity - 1, 0, 1),
    });
    const vp = this.nodeParam('volumePreservation');
    s.bulge({ volume: 1, rings: p.spread, mask: this.maskNodes(), bulgeMul: vp, lateralFlow: p.lateralFlow });
    if (p.inflatePressure > 0) this._inflate(p.inflatePressure * (1 - p.volumePreservation));
    s.smooth(p.correctiveSmooth * 0.6 * q.smoothingScale);
    s.commit();
  }

  // Оставшийся объём раздувает всю маску, сильнее рядом с контактом.
  _inflate(share) {
    const s = this.solver, sm = this.sm, { base, baseN, area } = sm;
    const leftover = s.volume * share;
    if (leftover <= 0) return;
    let cx = 0, cy = 0, cz = 0, wsum = 0;
    for (let k = 0; k < s.count; k++) {
      const n = s.cNodes[k], d = s.cDepth[k];
      cx += base[3 * n] * d; cy += base[3 * n + 1] * d; cz += base[3 * n + 2] * d; wsum += d;
    }
    if (wsum <= 0) return;
    cx /= wsum; cy /= wsum; cz /= wsum;
    const mask = this.maskNodes(), nodes = this.nodeList();
    const R = Math.max(sm.radius * 0.5, 1e-4);
    const w = this._iw || (this._iw = new Float32Array(sm.nodeCount));
    let sum = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (s.cIndex[n] >= 0) { w[n] = 0; continue; }
      const d = len3(base[3 * n] - cx, base[3 * n + 1] - cy, base[3 * n + 2] - cz);
      w[n] = mask[n] * (0.35 + 0.65 * Math.exp(-d / R));
      sum += w[n] * area[n];
    }
    if (sum <= 0) return;
    const f = s.field, maxH = s.maxDepth;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!w[n]) continue;
      const h = Math.min((leftover * w[n]) / sum, maxH);
      s.include(n);
      f[3 * n] += baseN[3 * n] * h; f[3 * n + 1] += baseN[3 * n + 1] * h; f[3 * n + 2] += baseN[3 * n + 2] * h;
    }
  }
}

// Squish & Inflate — сплющивание с сохранением объёма: не вернувшийся по кольцу объём надувает маску.
export class SquishInflate extends Squish {
  static type = 'squishInflate';
  static defaults = {
    ...Squish.defaults,
    squishStrength: 1.38, // ≥1 — точная вмятина, выше — мягче край
    inflatePressure: 1,
    shapeSmoothing: 11,
    spread: 9,
    volumePreservation: 0.26,
    correctiveSmooth: 10,
    collisionOffset: 0.0011,
    contactHardness: 0,
    splay: 0,
  };
  static regionParams = ['squishStrength', 'volumePreservation'];

  apply() {
    this.params.intensity = this.params.squishStrength;
    if (this.hasRegionParam('squishStrength')) {
      for (const r of this.regions) if (r.params.squishStrength !== undefined) r.params.intensity = r.params.squishStrength;
    }
    super.apply();
  }
}
