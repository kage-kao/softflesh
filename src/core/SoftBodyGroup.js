import { ContactSolver } from './contact.js';
import { SpatialHash } from './SpatialHash.js';
import { Mask } from './Mask.js';
import { smoothstep } from './math.js';

// Мягкие тела: два и более SoftMesh давят друг на друга. Оба уступают (Yield),
// встречаются на общей поверхности контакта, вдавленный объём возвращается выпуклостью.
// Контакт считается по «базовым» формам (после скелета, до эффектов) — как в SquishyFX.

export const softBodyDefaults = {
  yield: 1, // насколько тело мягче других (0 — жёсткое)
  cushion: 0.003, // мягкое начало контакта (м)
  skinGap: 0.0005, // зазор между кожами
  volumePreservation: 1,
  bulgeSpread: 0.06, // как далеко расходится выпуклость (м)
  bulgeFocus: 4, // 0 — тело раздувается равномерно
  smoothing: 3,
  mask: null,
};

export class SoftBodyGroup {
  constructor(world) {
    this.world = world;
    this.members = [];
    this.enabled = true;
    this._frame = -1;
  }

  add(sm, params = {}) {
    if (sm.isSoftModel) { sm.meshes.forEach((m) => this.add(m, params)); return this; }
    if (this.members.some((m) => m.sm === sm)) return this.set(sm, params);
    const member = { sm, params: { ...softBodyDefaults, ...params }, mask: null, solver: null, hash: null };
    member.maskSpec = Mask.from(member.params.mask);
    sm.softBody = member;
    this.members.push(member);
    return this;
  }
  set(sm, params) {
    const m = this.members.find((x) => x.sm === sm);
    if (m) { Object.assign(m.params, params); if (params.mask !== undefined) { m.maskSpec = Mask.from(params.mask); m.mask = null; } }
    return this;
  }
  remove(sm) {
    const i = this.members.findIndex((m) => m.sm === sm);
    if (i >= 0) { this.members[i].sm.softBody = null; this.members.splice(i, 1); }
    return this;
  }
  get count() { return this.members.length; }

  _prep(m) {
    if (!m.solver) m.solver = new ContactSolver(m.sm);
    if (!m.hash) m.hash = new SpatialHash(m.sm.nodeCount, 14);
    if (!m.mask) {
      m.mask = m.maskSpec.resolve(m.sm.mesh, m.sm.topo);
      const list = [];
      for (let i = 0; i < m.mask.length; i++) if (m.mask[i] > 0) list.push(i);
      m.list = Int32Array.from(list);
    }
    m.solver.clear();
    m._hashed = false;
  }

  apply() {
    const act = this.members.filter((m) => m.sm.enabled && m.sm.mode === 'live');
    if (!this.enabled || act.length < 2) return;
    act.forEach((m) => this._prep(m));
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const A = act[i], B = act[j];
      const reach = Math.max(A.params.cushion, B.params.cushion) * 4 + 0.01;
      if (A.sm.center.distanceTo(B.sm.center) > A.sm.radius + B.sm.radius + reach) continue;
      this._collide(A, B);
      this._collide(B, A);
    }
    for (const m of act) this._resolve(m);
  }

  // Узлы A, вошедшие в B (поверхность B — плоскости касания ближайших узлов).
  _collide(A, B) {
    const smA = A.sm, smB = B.sm;
    const cell = Math.max(smA.meanEdgeWorld, smB.meanEdgeWorld) * 2.5 + B.params.cushion * 2;
    if (!B._hashed) { B.hash.build(smB.base, null, smB.nodeCount, cell); B._hashed = true; B._cell = cell; }
    const R = B._cell;
    const pa = smA.base, pb = smB.base, nb = smB.baseN;
    const gap = Math.max(A.params.skinGap, B.params.skinGap) + smA.meanEdgeWorld * 0.03;
    const cush = Math.max(A.params.cushion, smA.meanEdgeWorld * 0.6);
    const thr = gap + cush;
    const lo = smB.bmin, hi = smB.bmax;
    const yA = A.params.yield, yB = B.params.yield;
    for (const n of A.list) {
      const x = pa[3 * n], y = pa[3 * n + 1], z = pa[3 * n + 2];
      if (x < lo.x - R || y < lo.y - R || z < lo.z - R || x > hi.x + R || y > hi.y + R || z > hi.z + R) continue;
      let best = -1, bd = Infinity;
      B.hash.query(x, y, z, R, (j, d2) => { if (d2 < bd) { bd = d2; best = j; } });
      if (best < 0) continue;
      const nx = nb[3 * best], ny = nb[3 * best + 1], nz = nb[3 * best + 2];
      const s = (x - pb[3 * best]) * nx + (y - pb[3 * best + 1]) * ny + (z - pb[3 * best + 2]) * nz;
      if (s >= thr) continue;
      const xx = thr - s;
      const pen = xx > 2 * cush ? xx - cush : (xx * xx) / (4 * cush);
      const wa = yA * A.mask[n], wb = yB * (B.mask[best] || 0);
      const share = wa + wb > 0 ? wa / (wa + wb) : 0;
      if (share <= 0) continue;
      A.solver.push(n, pen * share, nx, ny, nz, 2, null, 1);
    }
  }

  _resolve(m) {
    const s = m.solver, sm = m.sm, p = m.params, q = this.world.quality;
    if (!s.count) return;
    const edge = sm.meanEdgeWorld || 1;
    const rings = Math.min(Math.ceil(p.bulgeSpread / edge) + 2, q.maxRings * 2);
    s.computeDent({ scale: 1, splay: 0, axisIters: 2, rings, rimIters: Math.round(p.smoothing * q.smoothingScale), rim: 1 });
    // выпуклость с фокусом
    const V = s.volume * p.volumePreservation;
    if (V > 0) {
      const { baseN, area } = sm, f = s.field, w = s.tmp;
      if (p.bulgeFocus <= 0) for (const n of m.list) s.include(n);
      let sum = 0;
      for (let i = 0; i < s.regionCount; i++) {
        const n = s.region[i];
        let wi = 0;
        if (s.cIndex[n] < 0) {
          const d = s.ring[n] >= 1 << 20 ? p.bulgeSpread : s.dist[n];
          wi = m.mask[n] * (p.bulgeFocus > 0 ? Math.exp((-p.bulgeFocus * d) / p.bulgeSpread) * (1 - smoothstep(0.7 * p.bulgeSpread, p.bulgeSpread, d)) : 1);
          wi *= smoothstep(0, edge * 1.5, d);
        }
        w[i] = wi;
        sum += wi * area[n];
      }
      if (sum > 0) {
        const maxH = s.maxDepth * 1.5;
        for (let i = 0; i < s.regionCount; i++) {
          if (w[i] <= 0) continue;
          const n = s.region[i];
          const h = Math.min((V * w[i]) / sum, maxH);
          f[3 * n] += baseN[3 * n] * h; f[3 * n + 1] += baseN[3 * n + 1] * h; f[3 * n + 2] += baseN[3 * n + 2] * h;
        }
      }
    }
    s.smooth(p.smoothing * q.smoothingScale);
    s.commit();
  }

  toJSON() { return this.members.map((m) => ({ mesh: m.sm.name, params: { ...m.params, mask: m.maskSpec.toJSON() } })); }
}
