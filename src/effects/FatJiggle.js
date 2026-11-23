import { ContactEffect } from './ContactEffect.js';
import { len3, clamp } from '../core/math.js';

// Fat Jiggle — инерционная тряска «жира»: реагирует на ускорение тела (бег, прыжок, анимация)
// и на удары коллайдеров. Каждый узел — затухающий осциллятор, связанный с соседями,
// поэтому движение идёт волной по массе, а края маски держат форму (нет движения «блоком»).

export class FatJiggle extends ContactEffect {
  static type = 'fatJiggle';
  static defaults = {
    amplitude: 0.25, // сила движения жира
    wobbleSpeed: 3.8, // частота колебаний, Гц (ниже — тяжелее и медленнее)
    lateralMotion: 1, // движение вдоль кожи
    normalMotion: 0.6, // движение внутрь/наружу кожи
    decay: 1.2, // размер массы жира, на которую ложится удар
    dentDepth: 1, // глубина статичной вмятины от контакта
    impactSensitivity: 1.5, // 1.5 = x1; 1 м/с — один полный импульс
    relaxTime: 0.5, // секунды до затухания в e раз
    smoothing: 10, // сглаживание пятна контакта
    collisionOffset: 0.0015,
    sustain: 0, // держит тряску, пока контакт удерживается
    inertia: 1, // реакция на движение самого тела/персонажа
    gravity: 0, // провисание при вертикальных ускорениях
    passHitsOn: true, // передавать удары другим Fat Jiggle на этом меше (одна половина -> другая)
    normalizeMask: true,
    maxOffset: 0.08,
    exactContact: 1,
    minHitSpeed: 0.15,
  };
  static regionParams = ['amplitude'];

  init() {
    super.init();
    const M = this.sm.nodeCount;
    this.u = new Float32Array(3 * M);
    this.v = new Float32Array(3 * M);
    this.prevVel = new Float32Array(3 * M);
    this.tmp = new Float32Array(3 * M);
    this.sleeping = true;
    this._first = true;
    this.maskRadius = 0;
  }

  reset() {
    super.reset();
    if (this.u) { this.u.fill(0); this.v.fill(0); this.sleeping = true; this._first = true; }
  }

  _maskRadius() {
    const nodes = this.nodeList(), b = this.sm.base;
    let cx = 0, cy = 0, cz = 0;
    for (const n of nodes) { cx += b[3 * n]; cy += b[3 * n + 1]; cz += b[3 * n + 2]; }
    const c = nodes.length || 1;
    cx /= c; cy /= c; cz /= c;
    let r = 0;
    for (const n of nodes) r = Math.max(r, len3(b[3 * n] - cx, b[3 * n + 1] - cy, b[3 * n + 2] - cz));
    return r || this.sm.radius;
  }

  onHit(ev) { this.hit(ev.point, ev.strength, ev.direction ? [-ev.normal[0], -ev.normal[1], -ev.normal[2]] : null, false); }

  // Ручной удар: point {x,y,z} в мире, strength ~ скорость удара в м/с, direction — куда толкнуть (по умолчанию внутрь кожи).
  hit(point, strength = 1, direction = null, forwarded = false) {
    const sm = this.sm;
    if (!sm) return;
    if (!this.maskRadius) this.maskRadius = this._maskRadius();
    const p = this.params, { base, baseN } = sm;
    const mask = this.maskNodes(), nodes = this.nodeList(), amp = this.nodeParam('amplitude');
    const R = Math.max(this.maskRadius * 0.6 * (p.decay / 1.2), sm.meanEdgeWorld * 2);
    const k = strength * 0.5;
    for (const n of nodes) {
      const d = len3(base[3 * n] - point.x, base[3 * n + 1] - point.y, base[3 * n + 2] - point.z);
      if (d > R * 2) continue;
      const g = Math.exp(-((d / R) ** 2) * 2) * mask[n] * (amp[n] / 0.25) * k;
      const dx = direction ? direction[0] : -baseN[3 * n], dy = direction ? direction[1] : -baseN[3 * n + 1], dz = direction ? direction[2] : -baseN[3 * n + 2];
      this.v[3 * n] += dx * g; this.v[3 * n + 1] += dy * g; this.v[3 * n + 2] += dz * g;
    }
    this.energy += strength;
    this.sleeping = false;
    if (p.passHitsOn && !forwarded) {
      for (const e of sm.effects) if (e !== this && e.type === 'fatJiggle' && e.enabled && e.params.passHitsOn) e.hit(point, strength * 0.35, direction, true);
    }
  }

  apply(ctx) {
    const p = this.params, sm = this.sm, q = this.quality, s = this.solver, dt = ctx.dt;
    if (!this.maskRadius) this.maskRadius = this._maskRadius();
    // статичная вмятина от контакта
    if (this.gatherContacts(false)) {
      s.computeDent({ scale: p.dentDepth, splay: 0.3, axisIters: 2, rings: Math.min(6, q.maxRings), rimIters: Math.round(p.smoothing * 0.3 * q.smoothingScale), rim: 0.5 });
      s.smooth(Math.round(p.smoothing * 0.2 * q.smoothingScale));
      s.commit();
      if (p.sustain > 0 && this.lastHit) {
        const st = this.lastHit.strength * p.sustain * dt * 6;
        const b = sm.base, n = [...s.perCollider.values()][0];
        if (n) this.hit({ x: b[3 * n.node], y: b[3 * n.node + 1], z: b[3 * n.node + 2] }, st, null, true);
      }
    }
    this.energy *= Math.exp(-dt / Math.max(p.relaxTime, 0.01));
    const { vel, baseN, topo } = sm;
    const nodes = this.nodeList(), mask = this.maskNodes(), amp = this.nodeParam('amplitude');
    const u = this.u, v = this.v, pv = this.prevVel;
    // ускорение базы (движение тела)
    let maxA = 0;
    const idt = dt > 0 ? 1 / dt : 0;
    const acc = this.tmp;
    const first = this._first || sm.teleported;
    for (const n of nodes) {
      for (let a = 0; a < 3; a++) {
        const i = 3 * n + a;
        let ac = first ? 0 : (vel[i] - pv[i]) * idt;
        ac = clamp(ac, -150, 150);
        acc[i] = ac;
        pv[i] = vel[i];
        if (Math.abs(ac) > maxA) maxA = Math.abs(ac);
      }
    }
    this._first = false;
    if (this.sleeping && maxA * p.inertia < 0.05) return;
    const omega = 2 * Math.PI * Math.max(p.wobbleSpeed, 0.1);
    const w2 = omega * omega;
    const c = 2 / Math.max(p.relaxTime, 0.01);
    const kap = w2 * 1.5 * (p.decay / 1.2);
    const sub = Math.max(1, Math.ceil(dt / (1 / q.jiggleRate))), h = dt / sub;
    const g = p.gravity;
    for (let st = 0; st < sub; st++) {
      for (const n of nodes) {
        const m = mask[n], gain = (amp[n] / 0.25) * m * p.inertia;
        let sx = 0, sy = 0, sz = 0;
        const a0 = topo.adjStart[n], a1 = topo.adjStart[n + 1];
        for (let k = a0; k < a1; k++) { const j = topo.adj[k]; sx += u[3 * j]; sy += u[3 * j + 1]; sz += u[3 * j + 2]; }
        const cn = a1 - a0 || 1;
        for (let a = 0; a < 3; a++) {
          const i = 3 * n + a;
          const lap = (a === 0 ? sx : a === 1 ? sy : sz) / cn - u[i];
          let f = -w2 * u[i] - c * v[i] + kap * lap - acc[i] * gain;
          if (a === 1 && g) f -= g * m * Math.abs(acc[i]);
          v[i] += f * h;
        }
      }
      for (const n of nodes) { u[3 * n] += v[3 * n] * h; u[3 * n + 1] += v[3 * n + 1] * h; u[3 * n + 2] += v[3 * n + 2] * h; }
    }
    // вывод: раздельно нормальная и касательная составляющие
    const disp = sm.disp;
    let maxU = 0;
    for (const n of nodes) {
      const nx = baseN[3 * n], ny = baseN[3 * n + 1], nz = baseN[3 * n + 2];
      const ux = u[3 * n], uy = u[3 * n + 1], uz = u[3 * n + 2];
      const un = ux * nx + uy * ny + uz * nz;
      let ox = nx * un * p.normalMotion + (ux - nx * un) * p.lateralMotion;
      let oy = ny * un * p.normalMotion + (uy - ny * un) * p.lateralMotion;
      let oz = nz * un * p.normalMotion + (uz - nz * un) * p.lateralMotion;
      const l = len3(ox, oy, oz), cap = p.maxOffset * mask[n];
      if (l > cap && l > 0) { const k = cap / l; ox *= k; oy *= k; oz *= k; }
      disp[3 * n] += ox; disp[3 * n + 1] += oy; disp[3 * n + 2] += oz;
      const e = Math.abs(ux) + Math.abs(uy) + Math.abs(uz) + (Math.abs(v[3 * n]) + Math.abs(v[3 * n + 1]) + Math.abs(v[3 * n + 2])) * 0.05;
      if (e > maxU) maxU = e;
    }
    if (maxU < 1e-6 && maxA * p.inertia < 0.05) { this.sleeping = true; for (const n of nodes) { u[3 * n] = u[3 * n + 1] = u[3 * n + 2] = 0; v[3 * n] = v[3 * n + 1] = v[3 * n + 2] = 0; } }
  }
}
