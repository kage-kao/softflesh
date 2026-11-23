import { ContactEffect } from './ContactEffect.js';
import { SpringField } from '../core/SpringField.js';
import { len3, clamp } from '../core/math.js';

// Squish Organic — органичное, неровное сплющивание: вытесненный объём уходит в валик,
// который отъезжает тем дальше, чем глубже контакт; между контактом и валиком — морщины.
// Реагирует на направление и скорость движения коллайдера, слегка покачивается.

export class SquishOrganic extends ContactEffect {
  static type = 'squishOrganic';
  static defaults = {
    squishIntensity: 1,
    directionInfluence: 0.7, // насколько направление движения коллайдера смещает деформацию
    volumePreservation: 0.9,
    collisionStrength: 1.2,
    collisionSoftness: 0.4,
    stiffness: 0.6, // жёсткость: выше — быстрее успокаивается
    velocityInfluence: 1,
    jiggle: 0.4, // вторичное покачивание
    collisionOffset: 0.0015,
    impactSensitivity: 1.5,
    relaxTime: 0.6,
    skinTension: 0.6, // доля объёма, уходящая в валик, а не в выпуклость на месте
    ridgeDistance: 0.05, // базовое расстояние от контакта до валика (м)
    wrinkleDepth: 0.35,
    wrinkleCount: 3,
    smoothing: 4,
    exactContact: 1,
    minHitSpeed: 0.15,
  };

  init() { super.init(); this.spring = new SpringField(this.sm.nodeCount); this.speed = 0; this.travel = [0, 0, 0]; }
  reset() { super.reset(); if (this.spring) this.spring.reset(); }

  onHit(ev) {
    this.energy += ev.strength;
    const s = this.solver, sp = this.spring, k = 0.25 * this.params.jiggle * ev.strength;
    for (let i = 0; i < s.count; i++) {
      const n = s.cNodes[i];
      const d = s.cDepth[i] * k * 30;
      sp.kick(n, s.cN[3 * i] * d, s.cN[3 * i + 1] * d, s.cN[3 * i + 2] * d);
    }
  }

  apply(ctx) {
    const p = this.params, q = this.quality, s = this.solver, sm = this.sm;
    const { base, vel, meanEdgeWorld } = sm;
    this.energy *= Math.exp(-ctx.dt / Math.max(p.relaxTime, 0.01));
    const count = this.gatherContacts(false);
    const omega = 2 * Math.PI * (1.2 + 4 * p.stiffness);
    const zeta = 0.2 + 0.75 * (1 - p.jiggle);
    if (count) {
      // скорость и направление движения коллайдера относительно плоти
      let best = null;
      for (const [c, r] of s.perCollider) if (!best || r.depth > best.r.depth) best = { c, r };
      if (best) {
        const n = best.r.node, v = [0, 0, 0];
        best.c.velocityAt(base[3 * n], base[3 * n + 1], base[3 * n + 2], v);
        v[0] -= vel[3 * n]; v[1] -= vel[3 * n + 1]; v[2] -= vel[3 * n + 2];
        const l = len3(v[0], v[1], v[2]);
        this.speed = l;
        if (l > 1e-4) this.travel = [v[0] / l, v[1] / l, v[2] / l];
      }
      const velBoost = 1 + p.velocityInfluence * 0.15 * clamp(this.speed, 0, 3);
      const scale = clamp(p.squishIntensity * velBoost, 0, 1.5) * Math.min(p.collisionStrength / 1.2, 1.2);
      const R0 = p.ridgeDistance + s.maxDepth * p.skinTension * 2;
      const wR = Math.max(p.ridgeDistance * 0.6, meanEdgeWorld);
      const rings = Math.min(Math.ceil((R0 + 2 * wR) / (meanEdgeWorld || 1)) + 2, q.maxRings * 2);
      s.computeDent({ scale, splay: 0.3, axisIters: 2, rings, rimIters: Math.round(2 + 6 * p.collisionSoftness), rim: p.collisionSoftness });
      // выпуклость на месте
      s.bulge({ volume: p.volumePreservation * (1 - p.skinTension), rings: Math.max(3, Math.round(wR / meanEdgeWorld)), mask: this.maskNodes() });
      this._ridge(R0, wR);
      s.smooth(p.smoothing * q.smoothingScale);
      const T = this.spring.target, f = s.field;
      for (let i = 0; i < s.regionCount; i++) {
        const n = s.region[i];
        T[3 * n] = f[3 * n]; T[3 * n + 1] = f[3 * n + 1]; T[3 * n + 2] = f[3 * n + 2];
      }
    }
    this.spring.step(s.region, count ? s.regionCount : 0, ctx.dt, omega, zeta);
    this.spring.addTo(sm.disp);
  }

  // Валик на расстоянии R0 и концентрические морщины в сжатой полосе.
  _ridge(R0, wR) {
    const p = this.params, s = this.solver, sm = this.sm, { base, baseN, area } = sm;
    const V = s.volume * p.volumePreservation * p.skinTension;
    const mask = this.maskNodes(), f = s.field, w = s.tmp;
    const [tx, ty, tz] = this.travel;
    const di = p.directionInfluence * clamp(this.speed * 2, 0, 1);
    let sum = 0;
    for (let i = 0; i < s.regionCount; i++) {
      const n = s.region[i];
      w[i] = 0;
      if (s.cIndex[n] >= 0) continue;
      const d = s.dist[n];
      let g = Math.exp(-(((d - R0) / wR) ** 2)) * mask[n];
      if (di > 0) {
        const src = s.src[n];
        let dx = base[3 * n] - base[3 * src], dy = base[3 * n + 1] - base[3 * src + 1], dz = base[3 * n + 2] - base[3 * src + 2];
        const l = len3(dx, dy, dz) || 1;
        g *= Math.max(0, 1 + di * ((dx * tx + dy * ty + dz * tz) / l));
      }
      w[i] = g;
      sum += g * area[n];
    }
    const depth = s.maxDepth;
    for (let i = 0; i < s.regionCount; i++) {
      const n = s.region[i];
      if (s.cIndex[n] >= 0) continue;
      let h = sum > 0 ? (V * w[i]) / sum : 0;
      const d = s.dist[n];
      if (d < R0 && p.wrinkleDepth > 0) {
        const x = d / R0;
        h -= p.wrinkleDepth * depth * 0.5 * Math.sin(Math.PI * p.wrinkleCount * x) ** 2 * (1 - x) * mask[n];
      }
      h = clamp(h, -depth, depth * 1.5);
      f[3 * n] += baseN[3 * n] * h; f[3 * n + 1] += baseN[3 * n + 1] * h; f[3 * n + 2] += baseN[3 * n + 2] * h;
    }
  }
}
