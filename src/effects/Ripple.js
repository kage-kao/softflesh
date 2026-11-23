import { len3 } from '../core/math.js';
import { ContactEffect } from './ContactEffect.js';

// Ripple — рябь: кольцевые волны расходятся от точки удара по поверхности.
// Каждый удар — своё кольцо со своими часами; кольцо «приклеено» к точке на меше.
// Fat — дополнительное мягкое колыхание массы под кольцом.

export class Ripple extends ContactEffect {
  static type = 'ripple';
  static defaults = {
    amplitude: 0.04, // высота волны (м) для удара 1 м/с
    frequency: 3, // число гребней в пакете
    waveSpeed: 0.7, // скорость кольца, м/с
    waveRange: 0.25, // ширина волнового пакета (м)
    decay: 0.15, // затухание с расстоянием (м)
    dentDepth: 1,
    impactSensitivity: 1.5,
    relaxTime: 0.6,
    smoothing: 2,
    collisionOffset: 0.0015,
    sustain: 0,
    fat: false,
    fatAmplitude: 0.01,
    fatWaveScale: 2,
    fatRelax: 0.8,
    fatSpeed: 4,
    maxRipples: 8,
    exactContact: 1,
    minHitSpeed: 0.15,
  };

  init() {
    super.init();
    this.ripples = [];
    this.out = new Float32Array(3 * this.sm.nodeCount);
    this.work = new Int32Array(this.sm.nodeCount);
    this.tmp = new Float32Array(3 * this.sm.nodeCount);
    this._sustainT = 0;
  }
  reset() { super.reset(); if (this.ripples) this.ripples.length = 0; }

  onHit(ev) { this.hit(ev.point, ev.strength, ev.direction); }

  // Ручной запуск волны: point {x,y,z} (мир), strength ~ скорость удара м/с.
  hit(point, strength = 1, direction = null) {
    if (!this.sm) return;
    const anchor = this.sm.nearestNode(point);
    this.ripples.push({ anchor, t: 0, strength, dir: direction || [0, 0, 0] });
    if (this.ripples.length > this.params.maxRipples) this.ripples.shift();
    this.energy += strength;
  }

  apply(ctx) {
    const p = this.params, q = this.quality, s = this.solver, sm = this.sm, dt = ctx.dt;
    if (this.gatherContacts(false)) {
      s.computeDent({ scale: p.dentDepth, splay: 0.3, axisIters: 2, rings: Math.min(6, q.maxRings), rimIters: 3, rim: 0.5 });
      s.smooth(2);
      s.commit();
      if (p.sustain > 0 && this.lastHit && this.tracker.holding) {
        this._sustainT += dt;
        const period = p.waveRange / Math.max(p.frequency, 0.5) / Math.max(p.waveSpeed, 0.01);
        if (this._sustainT > period) { this._sustainT = 0; this.hit(this.lastHit.point, this.lastHit.strength * p.sustain, this.lastHit.direction); }
      }
    }
    this.energy *= Math.exp(-dt / Math.max(p.relaxTime, 0.01));
    if (!this.ripples.length) return;
    const { base, baseN } = sm;
    const nodes = this.nodeList(), mask = this.maskNodes();
    const out = this.out, work = this.work;
    let wc = 0;
    const lambda = p.waveRange / Math.max(p.frequency, 0.5);
    const half = p.waveRange * 0.5;
    const gain = p.amplitude * (p.impactSensitivity / 1.5) / 1.5;
    for (const n of nodes) { out[3 * n] = 0; out[3 * n + 1] = 0; out[3 * n + 2] = 0; }
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => {
      const env = Math.exp(-r.t / Math.max(p.relaxTime, 0.01));
      const fenv = p.fat ? Math.exp(-r.t / Math.max(p.fatRelax, 0.01)) : 0;
      return env > 0.01 || fenv > 0.01;
    });
    for (const r of this.ripples) {
      const a = r.anchor, cx = base[3 * a], cy = base[3 * a + 1], cz = base[3 * a + 2];
      const env = Math.exp(-r.t / Math.max(p.relaxTime, 0.01)) * r.strength * gain;
      const front = p.waveSpeed * r.t;
      const fatOn = p.fat;
      const fenv = fatOn ? Math.exp(-r.t / Math.max(p.fatRelax, 0.01)) * Math.sin(2 * Math.PI * p.fatSpeed * r.t) * p.fatAmplitude * r.strength : 0;
      const fatR = p.decay * p.fatWaveScale * 2;
      const maxR = Math.max(front + half * 3, fatOn ? fatR * 3 : 0);
      for (const n of nodes) {
        const d = len3(base[3 * n] - cx, base[3 * n + 1] - cy, base[3 * n + 2] - cz);
        if (d > maxR) continue;
        const x = d - front;
        let hgt = env * Math.cos((2 * Math.PI * x) / lambda) * Math.exp(-((x / half) ** 2)) * Math.exp(-d / Math.max(p.decay, 1e-4));
        // в эпицентре волна гасится, чтобы не было «шипа»
        hgt *= Math.min(1, d / (lambda * 0.5) + 0.2);
        if (fatOn) hgt += fenv * Math.exp(-((d / fatR) ** 2));
        hgt *= mask[n];
        out[3 * n] += baseN[3 * n] * hgt; out[3 * n + 1] += baseN[3 * n + 1] * hgt; out[3 * n + 2] += baseN[3 * n + 2] * hgt;
      }
    }
    for (const n of nodes) if (out[3 * n] || out[3 * n + 1] || out[3 * n + 2]) work[wc++] = n;
    if (p.smoothing > 0) sm.topo.blurVec(out, work, wc, Math.round(p.smoothing * q.smoothingScale), this.tmp, 0.5);
    const disp = sm.disp;
    for (let i = 0; i < wc; i++) { const n = work[i]; disp[3 * n] += out[3 * n]; disp[3 * n + 1] += out[3 * n + 1]; disp[3 * n + 2] += out[3 * n + 2]; }
  }
}
