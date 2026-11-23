import { len3 } from '../core/math.js';
import { ContactEffect } from './ContactEffect.js';

// Slap Wave — волна по поверхности при ударе: «плоскость-триггер» бежит через плоть вдоль
// направления шлепка, и кожа вспучивается в полосе у плоскости (с ложбиной позади).
// Срабатывает сама по силе удара (auto) или вручную: slap.trigger({ point, direction, strength }).

export class SlapWave extends ContactEffect {
  static type = 'slapWave';
  static defaults = {
    amplitude: 0.012, // высота волны (м) для удара 1 м/с
    speed: 1.5, // скорость волны, м/с
    width: 0.03, // ширина гребня (м)
    range: 0.35, // путь волны до затухания (м)
    lateralWidth: 0.2, // ширина фронта поперёк направления (м)
    trough: 0.5, // глубина ложбины за гребнем (доля)
    relaxTime: 0.4,
    smoothing: 2,
    auto: true, // запускать по ударам коллайдеров
    minHitSpeed: 0.5, // порог скорости удара для auto (м/с)
    impactSensitivity: 1.5,
    collisionOffset: 0.0015,
    maxWaves: 4,
    exactContact: 0,
  };

  init() {
    super.init();
    this.waves = [];
    const M = this.sm.nodeCount;
    this.out = new Float32Array(3 * M);
    this.work = new Int32Array(M);
    this.tmp = new Float32Array(3 * M);
  }
  reset() { super.reset(); if (this.waves) this.waves.length = 0; }

  onHit(ev) { if (this.params.auto) this.trigger({ point: ev.point, direction: ev.direction, strength: ev.strength }); }

  // Ручной запуск. direction — направление шлепка в мире (касательная часть станет направлением волны).
  trigger({ point, direction = null, strength = 1 } = {}) {
    const sm = this.sm;
    if (!sm) return;
    const anchor = sm.nearestNode(point);
    const nx = sm.baseN[3 * anchor], ny = sm.baseN[3 * anchor + 1], nz = sm.baseN[3 * anchor + 2];
    let dx, dy, dz;
    if (direction) { dx = direction[0] ?? direction.x; dy = direction[1] ?? direction.y; dz = direction[2] ?? direction.z; }
    else { dx = sm.base[3 * anchor] - sm.center.x; dy = sm.base[3 * anchor + 1] - sm.center.y; dz = sm.base[3 * anchor + 2] - sm.center.z; }
    const dn = dx * nx + dy * ny + dz * nz;
    dx -= dn * nx; dy -= dn * ny; dz -= dn * nz;
    let l = len3(dx, dy, dz);
    const radial = l < 1e-4;
    if (!radial) { dx /= l; dy /= l; dz /= l; }
    // точка привязки в локальных координатах узла: волна следует за мешем
    this.waves.push({ anchor, t: 0, strength, dir: [dx, dy, dz], radial });
    if (this.waves.length > this.params.maxWaves) this.waves.shift();
    this.energy += strength;
    return this;
  }
  hit(point, strength = 1, direction = null) { return this.trigger({ point, strength, direction }); }

  apply(ctx) {
    const p = this.params, sm = this.sm, dt = ctx.dt, q = this.quality;
    if (p.auto) this.gatherContacts(false);
    this.energy *= Math.exp(-dt / Math.max(p.relaxTime, 0.01));
    if (!this.waves.length) return;
    const { base, baseN } = sm;
    const nodes = this.nodeList(), mask = this.maskNodes(), out = this.out, work = this.work;
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => p.speed * w.t < p.range + p.width * 4);
    for (const n of nodes) { out[3 * n] = 0; out[3 * n + 1] = 0; out[3 * n + 2] = 0; }
    const gain = p.amplitude * (p.impactSensitivity / 1.5);
    for (const w of this.waves) {
      const a = w.anchor, ox = base[3 * a], oy = base[3 * a + 1], oz = base[3 * a + 2];
      const s = p.speed * w.t;
      const fade = Math.exp(-w.t / Math.max(p.relaxTime, 0.01)) * Math.min(1, (p.range + p.width * 4 - s) / (p.width * 4));
      const rise = Math.min(1, w.t / 0.03);
      const A = gain * w.strength * fade * rise;
      const [dx, dy, dz] = w.dir;
      for (const n of nodes) {
        const rx = base[3 * n] - ox, ry = base[3 * n + 1] - oy, rz = base[3 * n + 2] - oz;
        let along, lat;
        if (w.radial) { along = len3(rx, ry, rz); lat = 0; }
        else {
          along = rx * dx + ry * dy + rz * dz;
          lat = len3(rx - along * dx, ry - along * dy, rz - along * dz);
          if (along < -p.width * 3) continue;
        }
        const x = (along - s) / p.width;
        if (x > 4 || x < -6) continue;
        let h = Math.exp(-x * x) - p.trough * Math.exp(-((x + 1.8) ** 2));
        h *= A * mask[n];
        if (!w.radial) h *= Math.exp(-((lat / p.lateralWidth) ** 2));
        out[3 * n] += baseN[3 * n] * h; out[3 * n + 1] += baseN[3 * n + 1] * h; out[3 * n + 2] += baseN[3 * n + 2] * h;
      }
    }
    let wc = 0;
    for (const n of nodes) if (out[3 * n] || out[3 * n + 1] || out[3 * n + 2]) work[wc++] = n;
    if (p.smoothing > 0) sm.topo.blurVec(out, work, wc, Math.round(p.smoothing * q.smoothingScale), this.tmp, 0.5);
    const disp = sm.disp;
    for (let i = 0; i < wc; i++) { const n = work[i]; disp[3 * n] += out[3 * n]; disp[3 * n + 1] += out[3 * n + 1]; disp[3 * n + 2] += out[3 * n + 2]; }
  }
}
