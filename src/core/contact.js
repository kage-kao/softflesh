import { len3, makeHit, bulgeProfile, smoothstep, clamp } from './math.js';
import { SpatialHash } from './SpatialHash.js';

// Общее «ядро контакта» для всех эффектов:
// 1) поиск вершин внутри коллайдеров (+ самоконтакт), 2) локальная ось давления,
// 3) выход вершины из коллайдера вдоль оси (вмятина ровно по форме), 4) мягкий край,
// 5) объём, вдавленный внутрь, возвращается выпуклостью по кольцу вокруг контакта,
// 6) сглаживание смещений, 7) отслеживание ударов (импульсов).

const _v = new Float32Array(3);

export class ContactSolver {
  constructor(sm) {
    const M = sm.nodeCount;
    this.sm = sm;
    this.cNodes = new Int32Array(M);
    this.cDepth = new Float32Array(M);
    this.cN = new Float32Array(3 * M);
    this.cEsc = new Float32Array(3 * M);
    this.cFlag = new Uint8Array(M); // 1 — пересечь тонкий коллайдер, 2 — самоконтакт
    this.cWeight = new Float32Array(M);
    this.cCol = new Array(M);
    this.count = 0;
    this.cIndex = new Int32Array(M).fill(-1);
    this.field = new Float32Array(3 * M);
    this.tmp = new Float32Array(3 * M);
    this.region = new Int32Array(M);
    this.regionCount = 0;
    this.inRegion = new Int32Array(M);
    this.regionStamp = 1;
    this.ring = new Int32Array(M);
    this.dist = new Float32Array(M);
    this.src = new Int32Array(M);
    this.volume = 0;
    this.maxDepth = 0;
    this.perCollider = new Map();
    this.hit = makeHit();
    this.best = makeHit();
    this.liveColliders = [];
  }

  // Очистить поле прошлого кадра.
  clear() {
    const f = this.field;
    for (let i = 0; i < this.regionCount; i++) { const n = this.region[i]; f[3 * n] = 0; f[3 * n + 1] = 0; f[3 * n + 2] = 0; }
    for (let k = 0; k < this.count; k++) this.cIndex[this.cNodes[k]] = -1;
    this.regionCount = 0;
    this.regionStamp++;
    this.count = 0;
    this.volume = 0;
    this.maxDepth = 0;
    this.perCollider.clear();
  }

  // Поиск контактов. P: {offset, closeOpenings, openingRings, reach}
  detect(colliders, nodes, mask, P) {
    const sm = this.sm, { base, disp, baseN, topo } = sm;
    const offset = P.offset ?? 0.001;
    const reach = (P.reach ?? 0) + offset;
    const live = (this.liveColliders = []);
    for (const c of colliders) {
      if (!c.enabled) continue;
      if (c.center.distanceTo(sm.center) <= c.radius + sm.radius + reach) live.push(c);
    }
    if (!live.length) return 0;
    const hit = this.hit, best = this.best;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const m = mask[n];
      if (m <= 0) continue;
      const px = base[3 * n] + disp[3 * n], py = base[3 * n + 1] + disp[3 * n + 1], pz = base[3 * n + 2] + disp[3 * n + 2];
      best.d = Infinity; best.collider = null;
      for (let c = 0; c < live.length; c++) {
        const col = live[c];
        const dc = len3(px - col.center.x, py - col.center.y, pz - col.center.z) - col.radius;
        if (dc > reach) continue;
        col.sdf(px, py, pz, hit);
        if (hit.d < best.d) { best.d = hit.d; best.nx = hit.nx; best.ny = hit.ny; best.nz = hit.nz; best.collider = col; }
      }
      if (!best.collider || best.d >= (P.reach ?? 0)) continue;
      const vx = baseN[3 * n], vy = baseN[3 * n + 1], vz = baseN[3 * n + 2];
      const outward = best.nx * vx + best.ny * vy + best.nz * vz;
      let w = 1;
      if (P.closeOpenings && topo.boundaryRing[n] < (P.openingRings ?? 3)) {
        if (outward > -0.2) continue; // коллайдер не перед поверхностью — ложное касание у открытого края
        w = (topo.boundaryRing[n] + 1) / ((P.openingRings ?? 3) + 1);
      }
      const pen = -best.d;
      const depth = pen > 0 ? pen + offset * Math.min(pen / (2 * offset), 1) : 0;
      const flag = best.collider.side === 'outside' && outward > 0.35 ? 1 : 0;
      this.push(n, depth * w, best.nx, best.ny, best.nz, flag, best.collider, w);
    }
    return this.count;
  }

  push(n, depth, nx, ny, nz, flag, collider, weight = 1) {
    let k = this.cIndex[n];
    if (k >= 0) {
      if (depth <= this.cDepth[k]) return;
    } else {
      k = this.count++;
      this.cIndex[n] = k;
      this.cNodes[k] = n;
    }
    this.cDepth[k] = depth;
    this.cN[3 * k] = nx; this.cN[3 * k + 1] = ny; this.cN[3 * k + 2] = nz;
    this.cFlag[k] = flag;
    this.cCol[k] = collider;
    this.cWeight[k] = weight;
    if (depth > this.maxDepth) this.maxDepth = depth;
    if (collider) {
      const r = this.perCollider.get(collider);
      if (!r || depth > r.depth) this.perCollider.set(collider, { node: n, depth, nx, ny, nz, count: (r ? r.count : 0) + 1 });
      else r.count++;
    }
  }

  // Вмятина. P: {scale (Float32Array|number), splay, axisIters, maxEscape, firmnessOfCollider:boolean}
  computeDent(P) {
    const sm = this.sm, { base, disp, baseN, topo } = sm;
    const K = this.count;
    if (!K) return;
    const f = this.field, tmp = this.tmp;
    // локальная ось давления: усреднение нормалей коллайдера по пятну контакта
    for (let k = 0; k < K; k++) {
      const n = this.cNodes[k], d = this.cDepth[k] + 1e-6;
      f[3 * n] = this.cN[3 * k] * d; f[3 * n + 1] = this.cN[3 * k + 1] * d; f[3 * n + 2] = this.cN[3 * k + 2] * d;
    }
    if (P.axisIters) topo.blurVec(f, this.cNodes, K, P.axisIters, tmp, 0.6);
    const splay = P.splay ?? 0;
    const hit = this.hit;
    for (let k = 0; k < K; k++) {
      const n = this.cNodes[k];
      let ax = f[3 * n], ay = f[3 * n + 1], az = f[3 * n + 2];
      const flag = this.cFlag[k];
      if (flag === 1) { ax = -baseN[3 * n]; ay = -baseN[3 * n + 1]; az = -baseN[3 * n + 2]; }
      const l = len3(ax, ay, az);
      if (l < 1e-9) { ax = this.cN[3 * k]; ay = this.cN[3 * k + 1]; az = this.cN[3 * k + 2]; } else { ax /= l; ay /= l; az /= l; }
      const depth = this.cDepth[k];
      let t = depth;
      const col = this.cCol[k];
      if (col && flag !== 2) {
        // выход вдоль оси (sphere tracing по SDF)
        const px = base[3 * n] + disp[3 * n], py = base[3 * n + 1] + disp[3 * n + 1], pz = base[3 * n + 2] + disp[3 * n + 2];
        const target = depth - Math.max(0, -this._sdf(col, px, py, pz, hit));
        t = 0;
        const cap = depth * 3 + (P.maxEscape ?? 0.04);
        for (let it = 0; it < 10; it++) {
          const d = col.sdf(px + ax * t, py + ay * t, pz + az * t, hit);
          const need = target - d;
          if (need <= 1e-5) break;
          t += need;
          if (t > cap) { t = cap; break; }
        }
      }
      let ex = ax * t, ey = ay * t, ez = az * t;
      if (splay > 0 && flag === 0) {
        ex += (this.cN[3 * k] * depth - ex) * splay; ey += (this.cN[3 * k + 1] * depth - ey) * splay; ez += (this.cN[3 * k + 2] * depth - ez) * splay;
      }
      let s = typeof P.scale === 'number' ? P.scale : P.scale[n];
      if (col && col.firmness < 100) s *= col.firmness / 100;
      this.cEsc[3 * k] = ex * s; this.cEsc[3 * k + 1] = ey * s; this.cEsc[3 * k + 2] = ez * s;
    }
    // область влияния — кольца вокруг контакта
    const rings = Math.max(1, Math.round(P.rings ?? 8));
    const cnt = topo.bfs(this.cNodes, K, rings, Infinity, base);
    for (let i = 0; i < cnt; i++) {
      const n = topo.queue[i];
      this.region[i] = n; this.inRegion[n] = this.regionStamp;
      this.ring[n] = topo.ring[n]; this.dist[n] = topo.dist[n]; this.src[n] = topo.src[n];
      f[3 * n] = 0; f[3 * n + 1] = 0; f[3 * n + 2] = 0;
    }
    this.regionCount = cnt;
    for (let k = 0; k < K; k++) {
      const n = this.cNodes[k];
      f[3 * n] = this.cEsc[3 * k]; f[3 * n + 1] = this.cEsc[3 * k + 1]; f[3 * n + 2] = this.cEsc[3 * k + 2];
    }
    // мягкий край вмятины: максимум из точной вмятины и её размытия
    const rimIters = Math.round(P.rimIters ?? 0);
    if (rimIters > 0 && (P.rim ?? 0) > 0) {
      topo.blurVec(f, this.region, cnt, rimIters, tmp, 0.5, true);
      const rim = P.rim;
      for (let i = 0; i < cnt; i++) {
        const n = this.region[i];
        if (this.cIndex[n] >= 0) continue;
        f[3 * n] *= rim; f[3 * n + 1] *= rim; f[3 * n + 2] *= rim;
      }
    }
    // вдавленный объём
    let V = 0;
    for (let i = 0; i < cnt; i++) {
      const n = this.region[i];
      const inward = -(f[3 * n] * baseN[3 * n] + f[3 * n + 1] * baseN[3 * n + 1] + f[3 * n + 2] * baseN[3 * n + 2]);
      if (inward > 0) V += inward * sm.area[n];
    }
    this.volume = V;
  }

  _sdf(col, x, y, z, hit) { return col.sdf(x, y, z, hit); }

  // Выпуклость вокруг контакта. P: {volume, rings(number|array), mask, bulgeMul(array|null), taper(array|null), lateralFlow, maxHeight}
  bulge(P) {
    const sm = this.sm, { base, baseN } = sm;
    const V = this.volume * (P.volume ?? 1);
    if (V <= 0 || !this.regionCount) return;
    const f = this.field, mask = P.mask;
    const W = P.rings;
    let sum = 0;
    const w = this.tmp;
    for (let i = 0; i < this.regionCount; i++) {
      const n = this.region[i];
      let wi = 0;
      if (this.cIndex[n] < 0 && this.ring[n] > 0) {
        const Wn = typeof W === 'number' ? W : W[n];
        wi = bulgeProfile(this.ring[n] / (Wn + 1)) * mask[n];
        if (P.taper) wi *= P.taper[n];
      }
      w[i] = wi;
      sum += wi * sm.area[n];
    }
    if (sum <= 1e-12) return;
    const maxH = P.maxHeight ?? this.maxDepth * 1.5;
    const lat = P.lateralFlow ?? 0;
    for (let i = 0; i < this.regionCount; i++) {
      if (w[i] <= 0) continue;
      const n = this.region[i];
      let h = (V * w[i]) / sum;
      if (P.bulgeMul) h *= P.bulgeMul[n];
      if (h > maxH) h = maxH;
      const nx = baseN[3 * n], ny = baseN[3 * n + 1], nz = baseN[3 * n + 2];
      f[3 * n] += nx * h; f[3 * n + 1] += ny * h; f[3 * n + 2] += nz * h;
      if (lat) {
        const s = this.src[n];
        let tx = base[3 * n] - base[3 * s], ty = base[3 * n + 1] - base[3 * s + 1], tz = base[3 * n + 2] - base[3 * s + 2];
        const dn = tx * nx + ty * ny + tz * nz;
        tx -= dn * nx; ty -= dn * ny; tz -= dn * nz;
        const l = len3(tx, ty, tz) || 1;
        const k = (lat * h) / l;
        f[3 * n] += tx * k; f[3 * n + 1] += ty * k; f[3 * n + 2] += tz * k;
      }
    }
  }

  // Добавить узел в область (для эффектов, затрагивающих всю маску).
  include(n) {
    if (this.inRegion[n] === this.regionStamp) return;
    this.inRegion[n] = this.regionStamp;
    this.region[this.regionCount++] = n;
    this.ring[n] = 1 << 20;
  }

  // Сглаживание смещений; вмятина под коллайдером не становится мельче.
  smooth(iters) {
    if (iters <= 0 || !this.regionCount) return;
    const sm = this.sm, f = this.field;
    sm.topo.blurVec(f, this.region, this.regionCount, Math.round(iters), this.tmp, 0.5);
    for (let k = 0; k < this.count; k++) {
      const n = this.cNodes[k];
      const ex = this.cEsc[3 * k], ey = this.cEsc[3 * k + 1], ez = this.cEsc[3 * k + 2];
      const e2 = ex * ex + ey * ey + ez * ez;
      if (e2 <= 1e-14) continue;
      const proj = (f[3 * n] * ex + f[3 * n + 1] * ey + f[3 * n + 2] * ez) / e2;
      if (proj < 1) { const a = 1 - proj; f[3 * n] += ex * a; f[3 * n + 1] += ey * a; f[3 * n + 2] += ez * a; }
    }
  }

  // Прибавить поле к смещениям меша.
  commit(scale = 1) {
    const d = this.sm.disp, f = this.field;
    for (let i = 0; i < this.regionCount; i++) {
      const n = this.region[i];
      d[3 * n] += f[3 * n] * scale; d[3 * n + 1] += f[3 * n + 1] * scale; d[3 * n + 2] += f[3 * n + 2] * scale;
    }
  }

  // Средняя точка и нормаль самого глубокого контакта для данного коллайдера.
  contactPoint(rec, out) {
    const b = this.sm.base, n = rec.node;
    out.x = b[3 * n]; out.y = b[3 * n + 1]; out.z = b[3 * n + 2];
    return out;
  }
}

// Самоконтакт: части одного меша, вдавленные друг в друга (складки, сгибы, «ложбинка»).
// Дорогой этап: считается раз в quality.selfContactEvery кадров (результат переиспользуется),
// а у статичного меша (без скелета и морфов) — один раз.
export class SelfContact {
  constructor(sm) {
    this.sm = sm;
    this.hash = new SpatialHash(sm.nodeCount, 16);
    this.pos = new Float32Array(3 * sm.nodeCount);
    this.cNodes = new Int32Array(sm.nodeCount);
    this.cData = new Float32Array(4 * sm.nodeCount);
    this.cCount = 0;
    this.valid = false;
    this.staticKey = null;
  }

  _replay(solver) {
    for (let i = 0; i < this.cCount; i++) {
      const d = 4 * i;
      solver.push(this.cNodes[i], this.cData[d], this.cData[d + 1], this.cData[d + 2], this.cData[d + 3], 2, null, 1);
    }
    return this.cCount;
  }

  detect(solver, softNodes, mask, P) {
    const sm = this.sm, { base, disp, baseN, topo } = sm;
    const M = sm.nodeCount;
    // статичный меш без смещений от предыдущих эффектов: результат постоянный
    let isStatic = !sm.skinned && !(sm.morphs.length && sm.mesh.morphTargetInfluences && sm.mesh.morphTargetInfluences.some((w) => w));
    if (isStatic) for (let i = 0; i < softNodes.length && isStatic; i++) { const n = softNodes[i]; if (disp[3 * n] || disp[3 * n + 1] || disp[3 * n + 2]) isStatic = false; }
    const key = isStatic ? sm._lastScale + ':' + sm.mesh.matrixWorld.elements.join(',') : null;
    if (isStatic && this.valid && key === this.staticKey) return this._replay(solver);
    const every = sm.world ? sm.world.quality.selfContactEvery || 1 : 1;
    if (!isStatic && this.valid && this.staticKey === null && sm.frameCounter % every !== 0) return this._replay(solver);
    this.staticKey = key;
    this.valid = true;
    this.cCount = 0;
    const pos = this.pos;
    for (let i = 0; i < 3 * M; i++) pos[i] = base[i] + disp[i];
    const edge = sm.meanEdgeWorld;
    const gap = P.gap ?? 0.0005;
    const R = Math.max(edge * 2, gap * 4);
    const scale = sm._lastScale || 1;
    const minRest = edge * (P.minRings ?? 5);
    const minRest2 = (minRest / scale) ** 2;
    const nr = topo.nodeRest;
    const h = this.hash;
    if (P.collideWithBody !== false) h.build(pos, null, M, R);
    else h.build(pos, softNodes, softNodes.length, R);
    const head = h.head, next = h.next, hm = h.mask, inv = 1 / R, R2 = R * R;
    for (let i = 0; i < softNodes.length; i++) {
      const a = softNodes[i];
      if (mask[a] <= 0) continue;
      const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
      const anx = baseN[3 * a], any = baseN[3 * a + 1], anz = baseN[3 * a + 2];
      const rax = nr[3 * a], ray = nr[3 * a + 1], raz = nr[3 * a + 2];
      const cx = Math.floor(ax * inv), cy = Math.floor(ay * inv), cz = Math.floor(az * inv);
      let bestDepth = 0, bnx = 0, bny = 0, bnz = 0, share = 1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (let b = head[(((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791)) & hm]; b !== -1; b = next[b]) {
          const bnx2 = baseN[3 * b], bny2 = baseN[3 * b + 1], bnz2 = baseN[3 * b + 2];
          if (anx * bnx2 + any * bny2 + anz * bnz2 > -0.3) continue;
          const ex = ax - pos[3 * b], ey = ay - pos[3 * b + 1], ez = az - pos[3 * b + 2];
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 > R2) continue;
          const rx = rax - nr[3 * b], ry = ray - nr[3 * b + 1], rz = raz - nr[3 * b + 2];
          const rest2 = rx * rx + ry * ry + rz * rz;
          if (rest2 < minRest2 || d2 > rest2 * scale * scale * 0.36) continue;
          const s = ex * bnx2 + ey * bny2 + ez * bnz2;
          if (s >= gap) continue;
          const depth = gap - s;
          if (depth > bestDepth) { bestDepth = depth; bnx = bnx2; bny = bny2; bnz = bnz2; share = mask[b] > 0 ? 0.5 : 1; }
        }
      }
      if (bestDepth > 0) {
        bestDepth = Math.min(bestDepth, edge * 6) * share;
        const k = this.cCount++, d = 4 * k;
        this.cNodes[k] = a;
        this.cData[d] = bestDepth; this.cData[d + 1] = bnx; this.cData[d + 2] = bny; this.cData[d + 3] = bnz;
      }
    }
    return this._replay(solver);
  }
}

// Импульсы: удар = начало контакта или новый толчок при удерживаемом контакте.
// Сила удара = скорость сближения (м/с) * чувствительность / 1.5.
export class ImpulseTracker {
  constructor() { this.state = new Map(); }

  update(solver, params, cb) {
    const sm = solver.sm, vel = sm.vel, minSpeed = params.minHitSpeed ?? 0.15, sens = (params.impactSensitivity ?? 1.5) / 1.5;
    const seen = new Set();
    for (const [col, rec] of solver.perCollider) {
      seen.add(col);
      let st = this.state.get(col);
      const n = rec.node;
      const b = sm.base;
      col.velocityAt(b[3 * n], b[3 * n + 1], b[3 * n + 2], _v);
      const rvx = _v[0] - vel[3 * n], rvy = _v[1] - vel[3 * n + 1], rvz = _v[2] - vel[3 * n + 2];
      // нормаль коллайдера направлена из коллайдера в плоть: сближение = движение коллайдера вдоль нормали
      const closing = rvx * rec.nx + rvy * rec.ny + rvz * rec.nz;
      const speed = clamp(closing, 0, 50);
      if (!st) { st = { contact: false, armed: true, speed: 0, dir: [0, 0, 0] }; this.state.set(col, st); }
      const fire = (!st.contact && speed > minSpeed) || (st.contact && st.armed && speed > minSpeed * 1.5);
      if (fire) {
        st.armed = false;
        const l = len3(rvx, rvy, rvz) || 1;
        cb({ collider: col, node: n, speed, strength: speed * sens, normal: [rec.nx, rec.ny, rec.nz], direction: [rvx / l, rvy / l, rvz / l] });
      }
      if (speed < minSpeed * 0.5) st.armed = true;
      st.contact = true;
      st.speed = speed;
    }
    for (const [col, st] of this.state) if (!seen.has(col)) { st.contact = false; st.armed = true; st.speed = 0; }
  }

  // Удерживается ли сейчас какой-то контакт
  get holding() { for (const st of this.state.values()) if (st.contact) return true; return false; }
}

export { smoothstep };
