import { Effect } from './Effect.js';
import { ImpulseTracker } from '../core/contact.js';
import { SpringField } from '../core/SpringField.js';
import { len3, makeHit, noise3, smoothstep, clamp } from '../core/math.js';

// Penetration — продавливание / вхождение коллайдера в мягкую поверхность:
// стенки раздвигаются радиально от оси (капсулы), окружающая плоть тянется следом,
// пульсирующее сжатие (clench), вторичная тряска и атрибут влажности для шейдера.

export class Penetration extends Effect {
  static type = 'penetration';
  static defaults = {
    expansionStrength: 1,
    falloffDistance: 0.06, // на каком расстоянии окружающая плоть раскрывается следом (м)
    softness: 0.5, // 0 — тугая кромка у контакта, 1 — широкое плавное раскрытие
    radialBias: 0.75, // 1 — радиально от оси, 0 — вдоль нормали поверхности
    maxExpansion: 0.12, // предел смещения (м), 0 — без предела
    collisionOffset: 0.006,
    organicDetail: 0,
    clenchAmount: 0.3,
    clenchSpeed: 3,
    jiggle: 0.4,
    wetness: 0.5, // пишет атрибут softfleshWet (0..1), не деформирует
    wetDryTime: 4, // секунды высыхания
    smoothing: 3,
    impactSensitivity: 1.5,
    relaxTime: 0.6,
    exactContact: 1,
    minHitSpeed: 0.15,
  };

  init() {
    const M = this.sm.nodeCount;
    this.field = new Float32Array(3 * M);
    this.list = new Int32Array(M);
    this.tmp = new Float32Array(3 * M);
    this.spring = new SpringField(M);
    this.hitObj = makeHit();
    this.tracker = new ImpulseTracker();
    this.time = 0;
    this._ax = new Float32Array(3);
    this._v = new Float32Array(3);
  }
  reset() { if (this.spring) this.spring.reset(); this.energy = 0; }

  apply(ctx) {
    const p = this.params, sm = this.sm, q = this.world.quality, dt = ctx.dt;
    const { base, disp, baseN, vel } = sm;
    this.time += dt;
    this.energy *= Math.exp(-dt / Math.max(p.relaxTime, 0.01));
    const cols = this.resolveColliders().filter((c) => c.enabled && c.center.distanceTo(sm.center) < c.radius + sm.radius + p.falloffDistance);
    const wet = p.wetness > 0 ? sm.output('softfleshWet') : null;
    if (wet) { const k = Math.exp(-dt / Math.max(p.wetDryTime, 0.01)); for (let n = 0; n < wet.node.length; n++) wet.node[n] *= k; }
    const nodes = this.nodeList(), mask = this.maskNodes(), hit = this.hitObj, f = this.field;
    let cnt = 0;
    if (cols.length) {
      // проход 1: глубина проникновения на каждый коллайдер
      const pen = new Map();
      for (const n of nodes) {
        const px = base[3 * n] + disp[3 * n], py = base[3 * n + 1] + disp[3 * n + 1], pz = base[3 * n + 2] + disp[3 * n + 2];
        for (const c of cols) {
          if (len3(px - c.center.x, py - c.center.y, pz - c.center.z) > c.radius + p.falloffDistance + p.collisionOffset) continue;
          c.sdf(px, py, pz, hit);
          const d = p.collisionOffset - hit.d;
          if (d > (pen.get(c) || 0)) pen.set(c, d);
        }
      }
      // импульсы от движения вглубь/наружу → энергия для clench и jiggle
      const fake = { sm, perCollider: new Map() };
      for (const [c, d] of pen) if (d > 0) {
        c.velocityAt(c.center.x, c.center.y, c.center.z, this._v);
        const sp = len3(this._v[0], this._v[1], this._v[2]);
        this.energy = clamp(this.energy + sp * dt * 4 * (p.impactSensitivity / 1.5), 0, 1);
        void fake;
      }
      const clench = 1 - p.clenchAmount * 0.5 * (1 + Math.sin(2 * Math.PI * p.clenchSpeed * this.time)) * this.energy;
      const shapeExp = 3 - 2.3 * p.softness;
      for (const n of nodes) {
        const m = mask[n];
        const px = base[3 * n] + disp[3 * n], py = base[3 * n + 1] + disp[3 * n + 1], pz = base[3 * n + 2] + disp[3 * n + 2];
        let bx = 0, by = 0, bz = 0, bestAmt = 0, wetV = 0;
        for (const c of cols) {
          const P = pen.get(c) || 0;
          if (P <= 0) continue;
          if (len3(px - c.center.x, py - c.center.y, pz - c.center.z) > c.radius + p.falloffDistance + p.collisionOffset) continue;
          c.sdf(px, py, pz, hit);
          const gap = hit.d - p.collisionOffset;
          let amt;
          if (gap < 0) amt = -gap * Math.max(1, p.expansionStrength);
          else if (gap < p.falloffDistance) amt = P * p.expansionStrength * Math.pow(1 - smoothstep(0, 1, gap / p.falloffDistance), shapeExp);
          else continue;
          if (gap > 0) amt *= clench;
          if (p.organicDetail > 0) amt *= 1 + p.organicDetail * noise3(sm.topo.nodeRest[3 * n] * 40, sm.topo.nodeRest[3 * n + 1] * 40, sm.topo.nodeRest[3 * n + 2] * 40);
          if (amt <= bestAmt) continue;
          bestAmt = amt;
          let rx, ry, rz;
          if (c.axisPoint(px, py, pz, this._ax)) {
            rx = px - this._ax[0]; ry = py - this._ax[1]; rz = pz - this._ax[2];
            const l = len3(rx, ry, rz) || 1; rx /= l; ry /= l; rz /= l;
          } else { rx = hit.nx; ry = hit.ny; rz = hit.nz; }
          let dx = rx * p.radialBias - baseN[3 * n] * (1 - p.radialBias);
          let dy = ry * p.radialBias - baseN[3 * n + 1] * (1 - p.radialBias);
          let dz = rz * p.radialBias - baseN[3 * n + 2] * (1 - p.radialBias);
          const l = len3(dx, dy, dz) || 1;
          bx = dx / l; by = dy / l; bz = dz / l;
          wetV = Math.max(wetV, 1 - smoothstep(0, p.falloffDistance * 0.5, Math.max(gap, 0)));
        }
        if (bestAmt <= 0) continue;
        if (p.maxExpansion > 0) bestAmt = Math.min(bestAmt, p.maxExpansion);
        bestAmt *= m;
        f[3 * n] = bx * bestAmt; f[3 * n + 1] = by * bestAmt; f[3 * n + 2] = bz * bestAmt;
        this.list[cnt++] = n;
        if (wet) wet.node[n] = Math.max(wet.node[n], wetV * p.wetness * m);
      }
      if (p.smoothing > 0 && cnt) sm.topo.blurVec(f, this.list, cnt, Math.round(p.smoothing * q.smoothingScale), this.tmp, 0.5, true);
    }
    // упругое следование + тряска
    const T = this.spring.target;
    for (let i = 0; i < cnt; i++) {
      const n = this.list[i];
      T[3 * n] = f[3 * n]; T[3 * n + 1] = f[3 * n + 1]; T[3 * n + 2] = f[3 * n + 2];
      f[3 * n] = 0; f[3 * n + 1] = 0; f[3 * n + 2] = 0;
    }
    const omega = 2 * Math.PI * 6, zeta = 1 - 0.8 * p.jiggle * (0.3 + 0.7 * this.energy);
    this.spring.step(this.list, cnt, dt, omega, Math.max(zeta, 0.15));
    this.spring.addTo(disp);
    void vel;
  }
}
