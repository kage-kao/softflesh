import * as THREE from 'three';
import { Topology } from './Topology.js';
import { len3, solve3, smoothstep } from './math.js';
import { createEffect } from '../effects/index.js';
import { getPreset } from '../presets.js';

// SoftMesh — обёртка над THREE.Mesh / SkinnedMesh.
// Каждый кадр: считает «базу» (позиции после скелета и морфов в мировых координатах),
// эффекты складывают смещения в disp (мир), затем смещения переводятся в локальное
// пространство меша и записываются в атрибут position. Скиннинг three.js применяется поверх.

const _e = new THREE.Matrix4();
const _A = new THREE.Matrix4();

function ensureFloatAttribute(g, name) {
  const a = g.attributes[name];
  if (!a) return null;
  if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized) return a;
  const n = a.count, s = a.itemSize, arr = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[i * s + k] = a.getComponent(i, k);
  const na = new THREE.BufferAttribute(arr, s);
  g.setAttribute(name, na);
  return na;
}

export class SoftMesh {
  constructor(world, mesh, opts = {}) {
    this.isSoftMesh = true;
    this.world = world;
    this.mesh = mesh;
    this.name = opts.name || mesh.name || 'mesh';
    this.enabled = true;
    this.effects = [];
    this.mode = 'live'; // 'live' | 'baked'
    this.bake = null;
    this.bakeTime = 0;
    this.softBody = null; // настройки участия в SoftBodyGroup

    if (opts.cloneGeometry !== false) mesh.geometry = mesh.geometry.clone();
    const g = mesh.geometry;
    ensureFloatAttribute(g, 'position');
    if (!g.attributes.normal) g.computeVertexNormals();
    ensureFloatAttribute(g, 'normal');
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    this.restPos = g.attributes.position.array.slice();
    this.restNrm = g.attributes.normal.array.slice();
    if (!g.boundingBox) g.computeBoundingBox();
    const diag = g.boundingBox.getSize(new THREE.Vector3()).length() || 1;
    const topo = (this.topo = new Topology(this.restPos, g.index ? g.index.array : null, opts.weldEpsilon ?? diag * 1e-5));
    const M = (this.nodeCount = topo.nodeCount);

    this.base = new Float32Array(3 * M);
    this.prevBase = new Float32Array(3 * M);
    this.baseN = new Float32Array(3 * M);
    this.vel = new Float32Array(3 * M);
    this.disp = new Float32Array(3 * M);
    this.localOff = new Float32Array(3 * M);
    this.area = new Float32Array(M);
    this.active = new Uint8Array(M);
    this.activeList = new Int32Array(M);
    this.activeCount = 0;
    this.prevActive = new Int32Array(M);
    this.prevActiveCount = 0;
    this._hasPrev = false;
    this.meanEdgeWorld = topo.meanEdge;
    this.bmin = new THREE.Vector3();
    this.bmax = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.radius = 0;

    // Нормали узлов в покое (локально) — для переноса изменения нормали на исходные нормали.
    this.restNodeN = new Float32Array(3 * M);
    topo.computeNormals(topo.nodeRest, this.restNodeN);
    this.localNodePos = topo.nodeRest.slice();
    this.localNodeN = new Float32Array(3 * M);
    this.nodeVerts = this._nodeVerts();

    // Скелет: веса первой вершины узла.
    this.skinned = !!mesh.isSkinnedMesh && !!g.attributes.skinIndex;
    if (this.skinned) {
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      this.skinIdx = new Uint16Array(4 * M);
      this.skinW = new Float32Array(4 * M);
      for (let n = 0; n < M; n++) {
        const v = topo.nodeFirstVert[n];
        for (let k = 0; k < 4; k++) { this.skinIdx[4 * n + k] = si.getComponent(v, k); this.skinW[4 * n + k] = sw.getComponent(v, k); }
      }
      this.T3 = new Float32Array(9 * M);
    }
    // Морфы (shape keys): учитываются в базе.
    this.morphs = [];
    const mp = g.morphAttributes && g.morphAttributes.position;
    if (mp && mp.length) {
      for (const a of mp) {
        const d = new Float32Array(3 * M);
        for (let n = 0; n < M; n++) { const v = topo.nodeFirstVert[n]; d[3 * n] = a.getX(v); d[3 * n + 1] = a.getY(v); d[3 * n + 2] = a.getZ(v); }
        this.morphs.push(d);
      }
      this.morphRelative = g.morphTargetsRelative;
    }
    this._r = topo.nodeRest.slice();

    // Атрибуты-выходы (например, влажность от Penetration) — создаются по запросу.
    this.outputs = {};
    this.frameCounter = 0;
    this.exactNodes = null;
    this._exactDirty = true;
    if (g.boundingSphere) g.boundingSphere.radius *= 1.3; else { g.computeBoundingSphere(); g.boundingSphere.radius *= 1.3; }
  }

  _nodeVerts() {
    const { vertToNode, nodeCount } = this.topo;
    const start = new Int32Array(nodeCount + 1);
    for (let v = 0; v < vertToNode.length; v++) start[vertToNode[v] + 1]++;
    for (let n = 0; n < nodeCount; n++) start[n + 1] += start[n];
    const list = new Int32Array(vertToNode.length);
    const fill = start.slice(0, nodeCount);
    for (let v = 0; v < vertToNode.length; v++) list[fill[vertToNode[v]]++] = v;
    return { start, list };
  }

  // ----- эффекты -----
  // addEffect('squish', {intensity: 1}, {mask, colliders, regions}) или addEffect(new Squish(...))
  addEffect(effect, params = {}, opts = {}) {
    if (typeof effect === 'string') effect = createEffect(effect, params, opts);
    this.effects.push(effect);
    effect.attach(this);
    this._exactDirty = true;
    return effect;
  }
  removeEffect(effect) {
    const i = this.effects.indexOf(effect);
    if (i >= 0) { this.effects.splice(i, 1); effect.detach(); this._exactDirty = true; }
  }
  // Пресет: набор эффектов. overrides: { colliders, mask, regions, params: { fatJiggle: {...} }, softBody }
  applyPreset(name, overrides = {}) {
    const p = getPreset(name);
    const out = p.effects.map((e) => this.addEffect(e.type, { ...e.params, ...((overrides.params || {})[e.type] || {}) }, { mask: overrides.mask, colliders: overrides.colliders, regions: overrides.regions }));
    if (p.softBody && overrides.softBody !== false && this.world) this.world.softBodies.add(this, { ...p.softBody, ...(overrides.softBody || {}) });
    return out;
  }
  getEffects(type) { return this.effects.filter((e) => e.type === type); }
  toJSON() {
    return { name: this.name, effects: this.effects.map((e) => e.toJSON()), softBody: this.softBody ? { ...this.softBody.params, mask: this.softBody.maskSpec.toJSON() } : null };
  }
  getEffect(typeOrName) { return this.effects.find((e) => e.type === typeOrName || e.name === typeOrName) || null; }
  clearEffects() { [...this.effects].forEach((e) => this.removeEffect(e)); }

  // Создаёт/возвращает выходной атрибут на вершины (itemSize 1) — например 'softfleshWet'.
  output(name) {
    if (!this.outputs[name]) {
      const g = this.mesh.geometry;
      const a = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.outputs[name] = { attr: a, node: new Float32Array(this.nodeCount) };
    }
    return this.outputs[name];
  }

  // ----- база -----
  computeBase(dt) {
    const mesh = this.mesh, topo = this.topo, M = this.nodeCount;
    mesh.updateWorldMatrix(true, false);
    const r = this._r;
    r.set(topo.nodeRest);
    if (this.morphs.length && mesh.morphTargetInfluences) {
      const inf = mesh.morphTargetInfluences;
      let sum = 0;
      for (let k = 0; k < this.morphs.length; k++) {
        const w = inf[k] || 0;
        if (!w) continue;
        sum += w;
        const d = this.morphs[k];
        if (this.morphRelative) for (let i = 0; i < 3 * M; i++) r[i] += w * d[i];
        else for (let i = 0; i < 3 * M; i++) r[i] += w * (d[i] - topo.nodeRest[i]);
      }
    }
    const base = this.base;
    this.prevBase.set(base);
    if (this.skinned) {
      const sk = mesh.skeleton;
      sk.update();
      const bm = sk.boneMatrices;
      _A.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
      const T = this.T3;
      const m = _e.elements;
      for (let n = 0; n < M; n++) {
        // blend = Σ w * boneMatrix
        for (let k = 0; k < 16; k++) m[k] = 0;
        for (let j = 0; j < 4; j++) {
          const w = this.skinW[4 * n + j];
          if (!w) continue;
          const o = this.skinIdx[4 * n + j] * 16;
          for (let k = 0; k < 16; k++) m[k] += w * bm[o + k];
        }
        // S = A * blend * B (только аффинная часть)
        _e.premultiply(_A).multiply(mesh.bindMatrix);
        const x = r[3 * n], y = r[3 * n + 1], z = r[3 * n + 2];
        base[3 * n] = m[0] * x + m[4] * y + m[8] * z + m[12];
        base[3 * n + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        base[3 * n + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const t = 9 * n;
        T[t] = m[0]; T[t + 1] = m[1]; T[t + 2] = m[2]; T[t + 3] = m[4]; T[t + 4] = m[5]; T[t + 5] = m[6]; T[t + 6] = m[8]; T[t + 7] = m[9]; T[t + 8] = m[10];
      }
    } else {
      const m = mesh.matrixWorld.elements;
      for (let n = 0; n < M; n++) {
        const x = r[3 * n], y = r[3 * n + 1], z = r[3 * n + 2];
        base[3 * n] = m[0] * x + m[4] * y + m[8] * z + m[12];
        base[3 * n + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        base[3 * n + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      const t = (this._T1 = this._T1 || new Float32Array(9));
      t[0] = m[0]; t[1] = m[1]; t[2] = m[2]; t[3] = m[4]; t[4] = m[5]; t[5] = m[6]; t[6] = m[8]; t[7] = m[9]; t[8] = m[10];
    }
    // ограничивающий объём, скорости
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let n = 0; n < M; n++) {
      const x = base[3 * n], y = base[3 * n + 1], z = base[3 * n + 2];
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
      if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    this.bmin.set(x0, y0, z0); this.bmax.set(x1, y1, z1);
    this.center.addVectors(this.bmin, this.bmax).multiplyScalar(0.5);
    this.radius = this.bmin.distanceTo(this.bmax) / 2;
    const idt = this._hasPrev && dt > 0 ? 1 / dt : 0;
    const vel = this.vel, pb = this.prevBase;
    let teleport = false;
    for (let i = 0; i < 3 * M; i++) vel[i] = (base[i] - pb[i]) * idt;
    if (idt) {
      // телепорт: скачок больше половины размера меша — гасим скорость
      const jump = len3(base[0] - pb[0], base[1] - pb[1], base[2] - pb[2]);
      if (jump > this.radius) teleport = true;
    }
    if (teleport) vel.fill(0);
    this.teleported = teleport;
    this._hasPrev = true;
    topo.computeNormals(base, this.baseN);
    // масштаб мира: площадь и средняя длина ребра в мировых единицах
    const s = Math.cbrt(Math.abs(mesh.matrixWorld.determinant())) || 1;
    if (s !== this._lastScale) {
      this._lastScale = s;
      for (let n = 0; n < M; n++) this.area[n] = topo.restArea[n] * s * s;
      this.meanEdgeWorld = topo.meanEdge * s;
    }
    this.frameCounter++;
  }

  // ----- финальный проход «точного контакта»: ничего не остаётся внутри коллайдеров -----
  _collectExact() {
    const M = this.nodeCount;
    const ex = new Float32Array(M), off = new Float32Array(M), hard = new Float32Array(M).fill(1);
    const cols = new Set();
    for (const e of this.effects) {
      if (!e.enabled || !(e.params.exactContact > 0) || e.usesColliders === false) continue;
      e.resolveColliders().forEach((c) => cols.add(c));
      const m = e.maskNodes();
      const o = e.params.collisionOffset ?? 0.001;
      const h = e.params.contactHardness ?? 1;
      for (let n = 0; n < M; n++) if (m[n] > 0) { ex[n] = Math.max(ex[n], e.params.exactContact); off[n] = Math.max(off[n], o); hard[n] = Math.min(hard[n], h); }
    }
    const list = [];
    for (let n = 0; n < M; n++) if (ex[n] > 0) list.push(n);
    this.exactNodes = Int32Array.from(list);
    this.exactAmount = ex;
    this.exactOffset = off;
    this.exactHard = hard;
    this._exactCols = [...cols];
    this._exactDirty = false;
  }

  finalExact() {
    if (this._exactDirty) this._collectExact();
    const cols = this._exactCols.filter((c) => c.enabled);
    if (!cols.length || !this.exactNodes.length) return;
    const live = cols.filter((c) => c.center.distanceTo(this.center) < c.radius + this.radius + 0.05);
    if (!live.length) return;
    const hit = this._hit || (this._hit = { d: 0, nx: 0, ny: 0, nz: 0 });
    const { base, disp, baseN } = this;
    const nodes = this.exactNodes, ex = this.exactAmount, off = this.exactOffset;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (let round = 0; round < 2; round++) {
        const px = base[3 * n] + disp[3 * n], py = base[3 * n + 1] + disp[3 * n + 1], pz = base[3 * n + 2] + disp[3 * n + 2];
        let moved = false;
        for (const c of live) {
          const dc = len3(px - c.center.x, py - c.center.y, pz - c.center.z);
          if (dc > c.radius + off[n] + 1e-4) continue;
          c.sdf(px, py, pz, hit);
          const skin = Math.max(off[n], 0.0005);
          if (hit.d >= skin) continue;
          // внешний коллайдер не должен «закапываться» под кожу: выход только внутрь тела
          const outward = hit.nx * baseN[3 * n] + hit.ny * baseN[3 * n + 1] + hit.nz * baseN[3 * n + 2];
          if (c.side === 'outside' && outward > 0.35) continue;
          // Contact Hardness < 1: большие коллайдеры (мяч, бедро) могут слегка входить в плоть
          const large = smoothstep(0.03, 0.06, c.radius);
          const push = (skin - hit.d) * ex[n] * (1 - large * (1 - this.exactHard[n]) * 0.6);
          disp[3 * n] += hit.nx * push; disp[3 * n + 1] += hit.ny * push; disp[3 * n + 2] += hit.nz * push;
          moved = true;
        }
        if (!moved) break;
      }
    }
  }

  // ----- запись в геометрию -----
  writeBack(recomputeNormals = true) {
    const M = this.nodeCount, disp = this.disp, off = this.localOff;
    const eps = 1e-7;
    // список активных узлов
    let cnt = 0;
    for (let n = 0; n < M; n++) {
      const a = Math.abs(disp[3 * n]) + Math.abs(disp[3 * n + 1]) + Math.abs(disp[3 * n + 2]) > eps;
      if (a) this.activeList[cnt++] = n;
    }
    this.activeCount = cnt;
    for (let i = 0; i < cnt; i++) {
      const n = this.activeList[i];
      if (this.skinned) solve3(this.T3, 9 * n, disp[3 * n], disp[3 * n + 1], disp[3 * n + 2], off, 3 * n);
      else solve3(this._T1, 0, disp[3 * n], disp[3 * n + 1], disp[3 * n + 2], off, 3 * n);
    }
    this._writeLocal(recomputeNormals);
  }

  // Запись локальных смещений узлов (this.localOff для activeList) — используется и при проигрывании запекания.
  _writeLocal(recomputeNormals) {
    const g = this.mesh.geometry, pos = g.attributes.position.array, nrm = g.attributes.normal.array;
    const { start, list } = this.nodeVerts;
    const off = this.localOff, rp = this.restPos, rn = this.restNrm, topo = this.topo;
    const lp = this.localNodePos, nr = topo.nodeRest;
    const touched = this.active;
    // сброс узлов, которые были активны в прошлом кадре
    for (let i = 0; i < this.prevActiveCount; i++) {
      const n = this.prevActive[i];
      touched[n] = 2;
    }
    for (let i = 0; i < this.activeCount; i++) touched[this.activeList[i]] = 1;
    const dirty = this._dirty || (this._dirty = new Int32Array(this.nodeCount));
    let dc = 0;
    for (let i = 0; i < this.prevActiveCount; i++) {
      const n = this.prevActive[i];
      if (touched[n] === 2) {
        lp[3 * n] = nr[3 * n]; lp[3 * n + 1] = nr[3 * n + 1]; lp[3 * n + 2] = nr[3 * n + 2];
        for (let k = start[n]; k < start[n + 1]; k++) {
          const v = list[k];
          pos[3 * v] = rp[3 * v]; pos[3 * v + 1] = rp[3 * v + 1]; pos[3 * v + 2] = rp[3 * v + 2];
        }
        touched[n] = 0;
        dirty[dc++] = n;
      }
    }
    for (let i = 0; i < this.activeCount; i++) {
      const n = this.activeList[i];
      touched[n] = 0;
      lp[3 * n] = nr[3 * n] + off[3 * n]; lp[3 * n + 1] = nr[3 * n + 1] + off[3 * n + 1]; lp[3 * n + 2] = nr[3 * n + 2] + off[3 * n + 2];
      for (let k = start[n]; k < start[n + 1]; k++) {
        const v = list[k];
        pos[3 * v] = rp[3 * v] + off[3 * n]; pos[3 * v + 1] = rp[3 * v + 1] + off[3 * n + 1]; pos[3 * v + 2] = rp[3 * v + 2] + off[3 * n + 2];
      }
      dirty[dc++] = n;
    }
    // нормали: узлы активные + их соседи
    if (recomputeNormals && dc) {
      const set = this._nset || (this._nset = new Uint8Array(this.nodeCount));
      const nl = this._nl || (this._nl = new Int32Array(this.nodeCount));
      let nc = 0;
      for (let i = 0; i < dc; i++) {
        const n = dirty[i];
        if (!set[n]) { set[n] = 1; nl[nc++] = n; }
        for (let k = topo.adjStart[n]; k < topo.adjStart[n + 1]; k++) { const j = topo.adj[k]; if (!set[j]) { set[j] = 1; nl[nc++] = j; } }
      }
      topo.computeNormals(lp, this.localNodeN, nl, nc);
      const ln = this.localNodeN, r0 = this.restNodeN;
      for (let i = 0; i < nc; i++) {
        const n = nl[i];
        set[n] = 0;
        const dx = ln[3 * n] - r0[3 * n], dy = ln[3 * n + 1] - r0[3 * n + 1], dz = ln[3 * n + 2] - r0[3 * n + 2];
        for (let k = start[n]; k < start[n + 1]; k++) {
          const v = list[k];
          let x = rn[3 * v] + dx, y = rn[3 * v + 1] + dy, z = rn[3 * v + 2] + dz;
          const l = Math.sqrt(x * x + y * y + z * z) || 1;
          nrm[3 * v] = x / l; nrm[3 * v + 1] = y / l; nrm[3 * v + 2] = z / l;
        }
      }
    }
    this.prevActive.set(this.activeList.subarray(0, this.activeCount));
    this.prevActiveCount = this.activeCount;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    for (const k in this.outputs) {
      const o = this.outputs[k];
      const arr = o.attr.array;
      for (let v = 0; v < arr.length; v++) arr[v] = o.node[topo.vertToNode[v]];
      o.attr.needsUpdate = true;
    }
  }

  // Вернуть меш в исходное состояние.
  reset() {
    this.disp.fill(0);
    this.activeCount = 0;
    this._writeLocal(true);
    for (const e of this.effects) e.reset();
  }

  // Узел, ближайший к мировой точке (для ручных ударов).
  nearestNode(p) {
    let best = Infinity, bi = 0;
    const b = this.base;
    for (let n = 0; n < this.nodeCount; n++) {
      const d = (b[3 * n] - p.x) ** 2 + (b[3 * n + 1] - p.y) ** 2 + (b[3 * n + 2] - p.z) ** 2;
      if (d < best) { best = d; bi = n; }
    }
    return bi;
  }

  dispose() {
    this.clearEffects();
    this.reset();
    if (this.world) this.world.remove(this);
  }
}
