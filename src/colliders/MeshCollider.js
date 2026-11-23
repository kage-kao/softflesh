import { len3 } from '../core/math.js';
import * as THREE from 'three';
import { Collider } from './Collider.js';

// Коллайдер из произвольного (жёсткого) меша. Ближайший треугольник ищется по равномерной сетке.
// Знак — по интерполированной нормали в ближайшей точке. Для открытых мешей (лист, ткань)
// задайте twoSided:false — тогда «внутри» считается сторона, противоположная нормалям.
// Для анимированных со скелетом колliders используйте капсулы костей (collidersFromSkeleton).

export class MeshCollider extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = 'mesh';
    const geo = opts.geometry || (opts.object && opts.object.geometry);
    if (!geo) throw new Error('SoftFlesh: MeshCollider требует geometry или object с geometry');
    this.reach = opts.reach ?? null;
    this._build(geo);
  }

  _build(geo) {
    const pa = geo.attributes.position;
    const V = pa.count;
    const p = new Float32Array(3 * V);
    for (let i = 0; i < V; i++) { p[3 * i] = pa.getX(i); p[3 * i + 1] = pa.getY(i); p[3 * i + 2] = pa.getZ(i); }
    const idx = geo.index ? Array.from(geo.index.array) : Array.from({ length: V }, (_, i) => i);
    this.p = p;
    this.t = Int32Array.from(idx);
    const T = this.t.length / 3;
    // Нормали вершин со сваркой по позиции — для устойчивого знака.
    const n = new Float32Array(3 * V);
    const key = (i) => `${Math.round(p[3 * i] * 1e5)},${Math.round(p[3 * i + 1] * 1e5)},${Math.round(p[3 * i + 2] * 1e5)}`;
    const weld = new Map();
    const w = new Int32Array(V);
    for (let i = 0; i < V; i++) { const k = key(i); if (!weld.has(k)) weld.set(k, i); w[i] = weld.get(k); }
    this.fn = new Float32Array(3 * T);
    for (let t = 0; t < T; t++) {
      const a = this.t[3 * t], b = this.t[3 * t + 1], c = this.t[3 * t + 2];
      const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
      const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const l = len3(cx, cy, cz) || 1;
      this.fn[3 * t] = cx / l; this.fn[3 * t + 1] = cy / l; this.fn[3 * t + 2] = cz / l;
      for (const v of [a, b, c]) { n[3 * w[v]] += cx; n[3 * w[v] + 1] += cy; n[3 * w[v] + 2] += cz; }
    }
    for (let i = 0; i < V; i++) {
      const r = w[i];
      const l = len3(n[3 * r], n[3 * r + 1], n[3 * r + 2]) || 1;
      n[3 * i] = n[3 * r] / l; n[3 * i + 1] = n[3 * r + 1] / l; n[3 * i + 2] = n[3 * r + 2] / l;
    }
    this.vn = n;
    const box = new THREE.Box3().setFromBufferAttribute(pa);
    this.box = box;
    const size = box.getSize(new THREE.Vector3());
    const diag = size.length() || 1;
    this._lr = Math.max(box.min.length(), box.max.length());
    if (this.reach == null) this.reach = diag * 0.5;
    const res = Math.max(4, Math.min(48, Math.round(Math.cbrt(T) * 1.5)));
    this.cell = diag / res;
    this.min = box.min.clone().subScalar(this.cell * 0.5);
    this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((size.getComponent(k) + this.cell) / this.cell)));
    const cells = new Map();
    for (let t = 0; t < T; t++) {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const v = this.t[3 * t + k];
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[3 * v + a]); hi[a] = Math.max(hi[a], p[3 * v + a]); }
      }
      const c0 = lo.map((x, a) => Math.floor((x - this.min.getComponent(a)) / this.cell));
      const c1 = hi.map((x, a) => Math.floor((x - this.min.getComponent(a)) / this.cell));
      for (let x = c0[0]; x <= c1[0]; x++) for (let y = c0[1]; y <= c1[1]; y++) for (let z = c0[2]; z <= c1[2]; z++) {
        const k = (x * this.dims[1] + y) * this.dims[2] + z;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(t);
      }
    }
    this.cells = cells;
    this._cp = new Float32Array(3);
  }

  localRadius() { return this._lr; }

  _closestOnTri(px, py, pz, t, out) {
    const p = this.p, i = this.t;
    const a = 3 * i[3 * t], b = 3 * i[3 * t + 1], c = 3 * i[3 * t + 2];
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const abx = p[b] - ax, aby = p[b + 1] - ay, abz = p[b + 2] - az;
    const acx = p[c] - ax, acy = p[c + 1] - ay, acz = p[c + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let u, v, w;
    if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
    else {
      const bpx = px - p[b], bpy = py - p[b + 1], bpz = pz - p[b + 2];
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = px - p[c], cpy = py - p[c + 1], cpz = pz - p[c + 2];
      const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
      else if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const s = d1 / (d1 - d3); u = 1 - s; v = s; w = 0; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const s = d2 / (d2 - d6); u = 1 - s; v = 0; w = s; }
      else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const s = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - s; w = s; }
      else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
    }
    out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
    out[3] = u; out[4] = v; out[5] = w;
  }

  localSdf(x, y, z, out) {
    const cell = this.cell, d = this.dims;
    const cx = Math.floor((x - this.min.x) / cell), cy = Math.floor((y - this.min.y) / cell), cz = Math.floor((z - this.min.z) / cell);
    const maxShell = Math.ceil(this.reach / cell) + 1;
    let best = Infinity, bt = -1;
    const tmp = this._tmp || (this._tmp = new Float32Array(6));
    const bestP = this._bp || (this._bp = new Float32Array(6));
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let s = 0; s <= maxShell; s++) {
      for (let ix = cx - s; ix <= cx + s; ix++) for (let iy = cy - s; iy <= cy + s; iy++) for (let iz = cz - s; iz <= cz + s; iz++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy), Math.abs(iz - cz)) !== s) continue;
        if (ix < 0 || iy < 0 || iz < 0 || ix >= d[0] || iy >= d[1] || iz >= d[2]) continue;
        const list = this.cells.get((ix * d[1] + iy) * d[2] + iz);
        if (!list) continue;
        for (const t of list) {
          if (seen.has(t)) continue;
          seen.add(t);
          this._closestOnTri(x, y, z, t, tmp);
          const dd = (tmp[0] - x) ** 2 + (tmp[1] - y) ** 2 + (tmp[2] - z) ** 2;
          if (dd < best) { best = dd; bt = t; bestP.set(tmp); }
        }
      }
      if (bt >= 0 && Math.sqrt(best) <= s * cell) break;
    }
    if (bt < 0) { out.d = 1e3; out.nx = 0; out.ny = 1; out.nz = 0; return; }
    const i = this.t, n = this.vn;
    const a = 3 * i[3 * bt], b = 3 * i[3 * bt + 1], c = 3 * i[3 * bt + 2];
    const nx = n[a] * bestP[3] + n[b] * bestP[4] + n[c] * bestP[5];
    const ny = n[a + 1] * bestP[3] + n[b + 1] * bestP[4] + n[c + 1] * bestP[5];
    const nz = n[a + 2] * bestP[3] + n[b + 2] * bestP[4] + n[c + 2] * bestP[5];
    const dx = x - bestP[0], dy = y - bestP[1], dz = z - bestP[2];
    const dist = Math.sqrt(best);
    const sign = dx * nx + dy * ny + dz * nz < 0 ? -1 : 1;
    out.d = sign * dist;
    if (dist > 1e-7) { out.nx = sign * dx / dist; out.ny = sign * dy / dist; out.nz = sign * dz / dist; }
    else { const l = len3(nx, ny, nz) || 1; out.nx = nx / l; out.ny = ny / l; out.nz = nz / l; }
  }
}
