/* SoftFlesh.js v1.0.0 — мягкие деформации для веб-игр на Three.js. Требует three >= 0.150 */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/core/SoftMesh.js
import * as THREE3 from "three";

// src/core/math.js
var clamp = (x, a, b) => x < a ? a : x > b ? b : x;
var len3 = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);
var lerp = (a, b, t) => a + (b - a) * t;
var smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
var bulgeProfile = (x) => x <= 0 || x >= 1 ? 0 : 6.75 * x * (1 - x) * (1 - x);
function solve3(t, k, vx, vy, vz, out, o) {
  const a11 = t[k], a21 = t[k + 1], a31 = t[k + 2];
  const a12 = t[k + 3], a22 = t[k + 4], a32 = t[k + 5];
  const a13 = t[k + 6], a23 = t[k + 7], a33 = t[k + 8];
  const i11 = a22 * a33 - a23 * a32, i12 = a13 * a32 - a12 * a33, i13 = a12 * a23 - a13 * a22;
  const i21 = a23 * a31 - a21 * a33, i22 = a11 * a33 - a13 * a31, i23 = a13 * a21 - a11 * a23;
  const i31 = a21 * a32 - a22 * a31, i32 = a12 * a31 - a11 * a32, i33 = a11 * a22 - a12 * a21;
  let det = a11 * i11 + a12 * i21 + a13 * i31;
  if (Math.abs(det) < 1e-20) det = 1e-20;
  const id = 1 / det;
  out[o] = (i11 * vx + i12 * vy + i13 * vz) * id;
  out[o + 1] = (i21 * vx + i22 * vy + i23 * vz) * id;
  out[o + 2] = (i31 * vx + i32 * vy + i33 * vz) * id;
}
function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177 | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}
function makeHit() {
  return { d: Infinity, nx: 0, ny: 1, nz: 0, collider: null, index: -1 };
}

// src/core/Topology.js
var Topology = class {
  constructor(positions, index, weldEps) {
    const V = positions.length / 3;
    this.vertexCount = V;
    const vertToNode = new Int32Array(V);
    const map = /* @__PURE__ */ new Map();
    const inv = 1 / weldEps;
    let M = 0;
    const firstVert = [];
    for (let v = 0; v < V; v++) {
      const key = Math.round(positions[3 * v] * inv) + "," + Math.round(positions[3 * v + 1] * inv) + "," + Math.round(positions[3 * v + 2] * inv);
      let n = map.get(key);
      if (n === void 0) {
        n = M++;
        map.set(key, n);
        firstVert.push(v);
      }
      vertToNode[v] = n;
    }
    this.nodeCount = M;
    this.vertToNode = vertToNode;
    this.nodeFirstVert = Int32Array.from(firstVert);
    const nodeRest = new Float32Array(3 * M);
    for (let n = 0; n < M; n++) {
      const v = firstVert[n];
      nodeRest[3 * n] = positions[3 * v];
      nodeRest[3 * n + 1] = positions[3 * v + 1];
      nodeRest[3 * n + 2] = positions[3 * v + 2];
    }
    this.nodeRest = nodeRest;
    const triCount = index ? index.length / 3 : V / 3;
    const tris = [];
    for (let t = 0; t < triCount; t++) {
      const a = vertToNode[index ? index[3 * t] : 3 * t];
      const b = vertToNode[index ? index[3 * t + 1] : 3 * t + 1];
      const c = vertToNode[index ? index[3 * t + 2] : 3 * t + 2];
      if (a === b || b === c || a === c) continue;
      tris.push(a, b, c);
    }
    this.tris = Int32Array.from(tris);
    const F = this.tris.length / 3;
    this.triCount = F;
    const edgeCount = /* @__PURE__ */ new Map();
    const neigh = Array.from({ length: M }, () => []);
    const nodeTris = Array.from({ length: M }, () => []);
    const addEdge = (a, b) => {
      const key = a < b ? a * M + b : b * M + a;
      const c = edgeCount.get(key);
      if (c === void 0) {
        edgeCount.set(key, 1);
        neigh[a].push(b);
        neigh[b].push(a);
      } else edgeCount.set(key, c + 1);
    };
    for (let t = 0; t < F; t++) {
      const a = this.tris[3 * t], b = this.tris[3 * t + 1], c = this.tris[3 * t + 2];
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
      nodeTris[a].push(t);
      nodeTris[b].push(t);
      nodeTris[c].push(t);
    }
    this.adjStart = new Int32Array(M + 1);
    let total = 0;
    for (let n = 0; n < M; n++) {
      this.adjStart[n] = total;
      total += neigh[n].length;
    }
    this.adjStart[M] = total;
    this.adj = new Int32Array(total);
    for (let n = 0, k = 0; n < M; n++) for (const j of neigh[n]) this.adj[k++] = j;
    this.triStart = new Int32Array(M + 1);
    total = 0;
    for (let n = 0; n < M; n++) {
      this.triStart[n] = total;
      total += nodeTris[n].length;
    }
    this.triStart[M] = total;
    this.nodeTris = new Int32Array(total);
    for (let n = 0, k = 0; n < M; n++) for (const t of nodeTris[n]) this.nodeTris[k++] = t;
    this.boundary = new Uint8Array(M);
    for (const [key, c] of edgeCount) {
      if (c !== 1) continue;
      const a = Math.floor(key / M), b = key - a * M;
      this.boundary[a] = 1;
      this.boundary[b] = 1;
    }
    this.restArea = new Float32Array(M);
    for (let t = 0; t < F; t++) {
      const a = this.tris[3 * t], b = this.tris[3 * t + 1], c = this.tris[3 * t + 2];
      const ux = nodeRest[3 * b] - nodeRest[3 * a], uy = nodeRest[3 * b + 1] - nodeRest[3 * a + 1], uz = nodeRest[3 * b + 2] - nodeRest[3 * a + 2];
      const vx = nodeRest[3 * c] - nodeRest[3 * a], vy = nodeRest[3 * c + 1] - nodeRest[3 * a + 1], vz = nodeRest[3 * c + 2] - nodeRest[3 * a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const ar = Math.sqrt(cx * cx + cy * cy + cz * cz) / 6;
      this.restArea[a] += ar;
      this.restArea[b] += ar;
      this.restArea[c] += ar;
    }
    let el = 0, ec = 0;
    for (let n = 0; n < M; n++) for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
      const j = this.adj[k];
      if (j < n) continue;
      el += len3(nodeRest[3 * j] - nodeRest[3 * n], nodeRest[3 * j + 1] - nodeRest[3 * n + 1], nodeRest[3 * j + 2] - nodeRest[3 * n + 2]);
      ec++;
    }
    this.meanEdge = ec ? el / ec : 1;
    this.stamp = new Int32Array(M);
    this.stampValue = 0;
    this.queue = new Int32Array(M);
    this.ring = new Int32Array(M);
    this.dist = new Float32Array(M);
    this.src = new Int32Array(M);
    this.boundaryRing = this._ringsFromBoundary();
  }
  _ringsFromBoundary() {
    const M = this.nodeCount;
    const r = new Uint8Array(M).fill(255);
    const q = new Int32Array(M);
    let head = 0, tail = 0;
    for (let n = 0; n < M; n++) if (this.boundary[n]) {
      r[n] = 0;
      q[tail++] = n;
    }
    while (head < tail) {
      const n = q[head++];
      if (r[n] >= 254) continue;
      for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
        const j = this.adj[k];
        if (r[j] === 255) {
          r[j] = r[n] + 1;
          q[tail++] = j;
        }
      }
    }
    return r;
  }
  // Обход в ширину от набора узлов-источников с геодезическим расстоянием по позициям pos.
  // Возвращает число посещённых узлов; список в this.queue[0..count), кольца/дистанции/источник в this.ring/dist/src.
  bfs(sources, count, maxRings, maxDist, pos) {
    const s = ++this.stampValue;
    const { stamp, queue, ring, dist, src, adj, adjStart } = this;
    let tail = 0;
    for (let i = 0; i < count; i++) {
      const n = sources[i];
      if (stamp[n] === s) continue;
      stamp[n] = s;
      ring[n] = 0;
      dist[n] = 0;
      src[n] = n;
      queue[tail++] = n;
    }
    let head = 0;
    while (head < tail) {
      const n = queue[head++];
      if (ring[n] >= maxRings) continue;
      const px = pos[3 * n], py = pos[3 * n + 1], pz = pos[3 * n + 2];
      for (let k = adjStart[n]; k < adjStart[n + 1]; k++) {
        const j = adj[k];
        const d = dist[n] + len3(pos[3 * j] - px, pos[3 * j + 1] - py, pos[3 * j + 2] - pz);
        if (stamp[j] === s) {
          if (d < dist[j] && ring[j] === ring[n] + 1) {
            dist[j] = d;
            src[j] = src[n];
          }
          continue;
        }
        if (d > maxDist) continue;
        stamp[j] = s;
        ring[j] = ring[n] + 1;
        dist[j] = d;
        src[j] = src[n];
        queue[tail++] = j;
      }
    }
    return tail;
  }
  isVisited(n) {
    return this.stamp[n] === this.stampValue;
  }
  // Размытие векторного поля по списку узлов (Якоби). keepMax: модуль не уменьшается (правило «максимум из точного и размытого»).
  blurVec(field, nodes, count, iterations, tmp, lambda = 0.5, keepMax = false) {
    const { adj, adjStart } = this;
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < count; i++) {
        const n = nodes[i];
        let sx = 0, sy = 0, sz = 0;
        const a = adjStart[n], b = adjStart[n + 1];
        for (let k = a; k < b; k++) {
          const j = adj[k];
          sx += field[3 * j];
          sy += field[3 * j + 1];
          sz += field[3 * j + 2];
        }
        const c = b - a || 1;
        const fx = field[3 * n], fy = field[3 * n + 1], fz = field[3 * n + 2];
        let nx = fx + lambda * (sx / c - fx), ny = fy + lambda * (sy / c - fy), nz = fz + lambda * (sz / c - fz);
        if (keepMax) {
          const l0 = fx * fx + fy * fy + fz * fz, l1 = nx * nx + ny * ny + nz * nz;
          if (l1 < l0) {
            nx = fx;
            ny = fy;
            nz = fz;
          }
        }
        tmp[3 * i] = nx;
        tmp[3 * i + 1] = ny;
        tmp[3 * i + 2] = nz;
      }
      for (let i = 0; i < count; i++) {
        const n = nodes[i];
        field[3 * n] = tmp[3 * i];
        field[3 * n + 1] = tmp[3 * i + 1];
        field[3 * n + 2] = tmp[3 * i + 2];
      }
    }
  }
  blurScalar(field, nodes, count, iterations, tmp, lambda = 0.5) {
    const { adj, adjStart } = this;
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < count; i++) {
        const n = nodes[i];
        let s = 0;
        const a = adjStart[n], b = adjStart[n + 1];
        for (let k = a; k < b; k++) s += field[adj[k]];
        tmp[i] = field[n] + lambda * (s / (b - a || 1) - field[n]);
      }
      for (let i = 0; i < count; i++) field[nodes[i]] = tmp[i];
    }
  }
  // Нормали узлов по позициям pos (взвешены площадью). nodes: если задан, считаются только они.
  computeNormals(pos, out, nodes = null, count = 0) {
    const { tris, nodeTris, triStart } = this;
    const one = (n) => {
      let sx = 0, sy = 0, sz = 0;
      for (let k = triStart[n]; k < triStart[n + 1]; k++) {
        const t = nodeTris[k];
        const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
        const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
        const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
        sx += uy * vz - uz * vy;
        sy += uz * vx - ux * vz;
        sz += ux * vy - uy * vx;
      }
      const l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      out[3 * n] = sx / l;
      out[3 * n + 1] = sy / l;
      out[3 * n + 2] = sz / l;
    };
    if (nodes) {
      for (let i = 0; i < count; i++) one(nodes[i]);
      return;
    }
    out.fill(0);
    const F = this.triCount;
    for (let t = 0; t < F; t++) {
      const a = 3 * tris[3 * t], b = 3 * tris[3 * t + 1], c = 3 * tris[3 * t + 2];
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      out[a] += x;
      out[a + 1] += y;
      out[a + 2] += z;
      out[b] += x;
      out[b + 1] += y;
      out[b + 2] += z;
      out[c] += x;
      out[c + 1] += y;
      out[c + 2] += z;
    }
    for (let n = 0; n < this.nodeCount; n++) {
      const x = out[3 * n], y = out[3 * n + 1], z = out[3 * n + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      out[3 * n] = x / l;
      out[3 * n + 1] = y / l;
      out[3 * n + 2] = z / l;
    }
  }
};

// src/core/Mask.js
import * as THREE from "three";
var Mask = class _Mask {
  constructor(spec) {
    this.spec = spec;
  }
  static all() {
    return new _Mask({ type: "all" });
  }
  static attribute(name, channel = 0) {
    return new _Mask({ type: "attribute", name, channel });
  }
  static color(channel = "r", attribute = "color") {
    return new _Mask({ type: "color", channel, attribute });
  }
  static bones(names, opts = {}) {
    return new _Mask({ type: "bones", names: [].concat(names), includeChildren: !!opts.includeChildren });
  }
  static sphere(center, radius, falloff = 0.5) {
    return new _Mask({ type: "sphere", center, radius, falloff });
  }
  static box(min, max, falloff = 0) {
    return new _Mask({ type: "box", min, max, falloff });
  }
  static fn(f) {
    return new _Mask({ type: "fn", f });
  }
  static values(arr) {
    return new _Mask({ type: "values", arr });
  }
  static max(...m) {
    return new _Mask({ type: "max", items: m.map(_Mask.from) });
  }
  static min(...m) {
    return new _Mask({ type: "min", items: m.map(_Mask.from) });
  }
  static multiply(...m) {
    return new _Mask({ type: "mul", items: m.map(_Mask.from) });
  }
  static subtract(a, b) {
    return new _Mask({ type: "sub", items: [_Mask.from(a), _Mask.from(b)] });
  }
  invert() {
    return new _Mask({ type: "invert", items: [this] });
  }
  blur(rings = 2) {
    return new _Mask({ type: "blur", items: [this], rings });
  }
  normalize() {
    return new _Mask({ type: "normalize", items: [this] });
  }
  scale(k) {
    return new _Mask({ type: "scale", items: [this], k });
  }
  threshold(t = 0.5) {
    return new _Mask({ type: "threshold", items: [this], t });
  }
  // Короткая запись строкой: 'all' | 'attr:_fat' | 'color:r' | 'bones:Breast.L,Breast.R'
  static from(x) {
    if (!x) return _Mask.all();
    if (x instanceof _Mask) return x;
    if (typeof x === "function") return _Mask.fn(x);
    if (ArrayBuffer.isView(x) || Array.isArray(x)) return _Mask.values(x);
    if (typeof x === "string") {
      const [k, v = ""] = x.split(":");
      if (k === "all") return _Mask.all();
      if (k === "attr" || k === "attribute") {
        const [n, c] = v.split(".");
        return _Mask.attribute(n, c ? Number(c) || "xyzw".indexOf(c) : 0);
      }
      if (k === "color") return _Mask.color(v || "r");
      if (k === "bones" || k === "bone") return _Mask.bones(v.split(",").map((s) => s.trim()).filter(Boolean));
      throw new Error("SoftFlesh: неизвестная маска " + x);
    }
    if (x.type) return _Mask.fromJSON(x);
    throw new Error("SoftFlesh: неизвестная маска");
  }
  static fromJSON(j) {
    if (j.items) return new _Mask({ ...j, items: j.items.map(_Mask.fromJSON) });
    return new _Mask(j);
  }
  toJSON() {
    const s = this.spec;
    if (s.type === "fn" || s.type === "values") {
      console.warn("SoftFlesh: маска-функция/массив не сохраняется в JSON");
      return { type: "all" };
    }
    const o = { ...s };
    if (s.items) o.items = s.items.map((m) => m.toJSON());
    return o;
  }
  // Вес на вершину (Float32Array длиной vertexCount)
  resolveVertices(mesh, topo) {
    const g = mesh.geometry, s = this.spec;
    const V = g.attributes.position.count;
    const out = new Float32Array(V);
    const pos = g.attributes.position;
    switch (s.type) {
      case "all":
        out.fill(1);
        break;
      case "attribute": {
        const a = g.attributes[s.name] || g.attributes[String(s.name).toLowerCase()] || g.attributes["_" + String(s.name).toLowerCase()];
        if (!a) {
          console.warn(`SoftFlesh: атрибут ${s.name} не найден, маска пустая`);
          break;
        }
        const c = typeof s.channel === "string" ? Math.max(0, "xyzwrgba".indexOf(s.channel) % 4) : s.channel;
        for (let i = 0; i < V; i++) out[i] = a.getComponent(i, Math.min(c, a.itemSize - 1));
        break;
      }
      case "color": {
        const a = g.attributes[s.attribute];
        if (!a) {
          console.warn("SoftFlesh: нет цвета вершин, маска пустая");
          break;
        }
        const c = Math.max(0, "rgba".indexOf(s.channel));
        for (let i = 0; i < V; i++) out[i] = a.getComponent(i, Math.min(c, a.itemSize - 1));
        break;
      }
      case "bones": {
        if (!mesh.isSkinnedMesh) {
          console.warn("SoftFlesh: маска по костям требует SkinnedMesh");
          break;
        }
        const bones = mesh.skeleton.bones;
        const set = /* @__PURE__ */ new Set();
        bones.forEach((b, i) => {
          let ok = s.names.includes(b.name);
          if (!ok && s.includeChildren) {
            let p = b.parent;
            while (p && !ok) {
              ok = p.isBone && s.names.includes(p.name);
              p = p.parent;
            }
          }
          if (ok) set.add(i);
        });
        const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
        for (let i = 0; i < V; i++) {
          let w = 0;
          for (let k = 0; k < 4; k++) if (set.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
          out[i] = Math.min(1, w);
        }
        break;
      }
      case "sphere": {
        const c = new THREE.Vector3().fromArray(s.center);
        for (let i = 0; i < V; i++) {
          const d = len3(pos.getX(i) - c.x, pos.getY(i) - c.y, pos.getZ(i) - c.z);
          const inner = s.radius * (1 - s.falloff);
          out[i] = d <= inner ? 1 : d >= s.radius ? 0 : 1 - (d - inner) / (s.radius - inner);
        }
        break;
      }
      case "box": {
        for (let i = 0; i < V; i++) {
          const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
          let w = 1;
          for (let k = 0; k < 3; k++) {
            const lo = s.min[k], hi = s.max[k];
            const d = Math.max(lo - p[k], p[k] - hi, 0);
            w *= s.falloff > 0 ? Math.max(0, 1 - d / s.falloff) : d > 0 ? 0 : 1;
          }
          out[i] = w;
        }
        break;
      }
      case "fn":
        for (let i = 0; i < V; i++) out[i] = s.f(pos.getX(i), pos.getY(i), pos.getZ(i), i);
        break;
      case "values":
        for (let i = 0; i < V; i++) out[i] = s.arr[i] ?? 0;
        break;
      case "max":
      case "min":
      case "mul": {
        const arrs = s.items.map((m) => m.resolveVertices(mesh, topo));
        for (let i = 0; i < V; i++) {
          let w = s.type === "max" ? 0 : 1;
          for (const a of arrs) w = s.type === "max" ? Math.max(w, a[i]) : s.type === "min" ? Math.min(w, a[i]) : w * a[i];
          out[i] = w;
        }
        break;
      }
      case "sub": {
        const a = s.items[0].resolveVertices(mesh, topo), b = s.items[1].resolveVertices(mesh, topo);
        for (let i = 0; i < V; i++) out[i] = a[i] - b[i];
        break;
      }
      case "invert": {
        const a = s.items[0].resolveVertices(mesh, topo);
        for (let i = 0; i < V; i++) out[i] = 1 - a[i];
        break;
      }
      case "scale": {
        const a = s.items[0].resolveVertices(mesh, topo);
        for (let i = 0; i < V; i++) out[i] = a[i] * s.k;
        break;
      }
      case "threshold": {
        const a = s.items[0].resolveVertices(mesh, topo);
        for (let i = 0; i < V; i++) out[i] = a[i] >= s.t ? 1 : 0;
        break;
      }
      case "normalize": {
        const a = s.items[0].resolveVertices(mesh, topo);
        let m = 0;
        for (let i = 0; i < V; i++) m = Math.max(m, a[i]);
        for (let i = 0; i < V; i++) out[i] = m > 0 ? a[i] / m : 0;
        break;
      }
      case "blur": {
        const a = s.items[0].resolve(mesh, topo);
        const M = topo.nodeCount, all = new Int32Array(M).map((_, i) => i), tmp = new Float32Array(M);
        topo.blurScalar(a, all, M, s.rings * 2, tmp, 0.6);
        for (let i = 0; i < V; i++) out[i] = a[topo.vertToNode[i]];
        break;
      }
      default:
        throw new Error("SoftFlesh: неизвестный тип маски " + s.type);
    }
    for (let i = 0; i < V; i++) out[i] = out[i] < 0 ? 0 : out[i] > 1 ? 1 : out[i];
    return out;
  }
  // Вес на узел (сваренную вершину): максимум по дублям.
  resolve(mesh, topo) {
    const v = this.resolveVertices(mesh, topo);
    const out = new Float32Array(topo.nodeCount);
    for (let i = 0; i < v.length; i++) {
      const n = topo.vertToNode[i];
      if (v[i] > out[n]) out[n] = v[i];
    }
    return out;
  }
};

// src/colliders/Collider.js
import * as THREE2 from "three";
var _m = new THREE2.Matrix4();
var _v = new THREE2.Vector3();
var _s = new THREE2.Vector3();
var _q = new THREE2.Quaternion();
var _ids = 0;
var Collider = class {
  constructor(opts = {}) {
    this.id = ++_ids;
    this.type = "base";
    this.name = opts.name || "";
    this.enabled = opts.enabled !== false;
    this.object = opts.object || null;
    this.position = new THREE2.Vector3().fromArray(opts.position || [0, 0, 0]);
    this.quaternion = opts.quaternion ? new THREE2.Quaternion().fromArray(opts.quaternion) : new THREE2.Quaternion();
    this.scale = opts.scale || 1;
    this.offsetMatrix = opts.offsetMatrix ? opts.offsetMatrix.clone() : null;
    this.firmness = opts.firmness ?? 100;
    this.side = opts.side || "outside";
    this.matrix = new THREE2.Matrix4();
    this.prevMatrix = new THREE2.Matrix4();
    this.inverse = new THREE2.Matrix4();
    this.worldScale = 1;
    this.center = new THREE2.Vector3();
    this.radius = 1;
    this._frame = -1;
    this._hasPrev = false;
    this._dt = 1 / 60;
    this.velocity = new THREE2.Vector3();
    this._te = this.matrix.elements;
    this._ie = this.inverse.elements;
    this._pe = this.prevMatrix.elements;
  }
  attach(object, offsetMatrix = null) {
    this.object = object;
    this.offsetMatrix = offsetMatrix;
    return this;
  }
  // Локальный радиус ограничивающей сферы (переопределяется).
  localRadius() {
    return 1;
  }
  // Локальное SDF: записывает d и нормаль в out (переопределяется).
  localSdf(x, y, z, out) {
    out.d = Math.hypot(x, y, z) - 1;
  }
  update(dt, frame) {
    if (this._frame === frame) return;
    this._frame = frame;
    this.prevMatrix.copy(this.matrix);
    if (this.object) {
      this.object.updateWorldMatrix(true, false);
      this.matrix.copy(this.object.matrixWorld);
      if (this.offsetMatrix) this.matrix.multiply(this.offsetMatrix);
    } else {
      this.matrix.compose(this.position, this.quaternion, _s.set(this.scale, this.scale, this.scale));
    }
    if (!this._hasPrev) {
      this.prevMatrix.copy(this.matrix);
      this._hasPrev = true;
    }
    this.inverse.copy(this.matrix).invert();
    this.matrix.decompose(_v, _q, _s);
    this.worldScale = (Math.abs(_s.x) + Math.abs(_s.y) + Math.abs(_s.z)) / 3;
    const oldC = this.center.clone();
    this.center.set(0, 0, 0).applyMatrix4(this.matrix);
    this.velocity.copy(this.center).sub(oldC).divideScalar(dt || 1 / 60);
    this.radius = this.localRadius() * this.worldScale;
    this._dt = dt || 1 / 60;
  }
  // Мгновенный «телепорт» без всплеска скорости (например, после респавна).
  resetMotion() {
    this._hasPrev = false;
  }
  // Мировое SDF. out: {d, nx, ny, nz}
  sdf(px, py, pz, out) {
    const e = this._ie;
    const x = e[0] * px + e[4] * py + e[8] * pz + e[12];
    const y = e[1] * px + e[5] * py + e[9] * pz + e[13];
    const z = e[2] * px + e[6] * py + e[10] * pz + e[14];
    this.localSdf(x, y, z, out);
    const m = this._te;
    const nx = m[0] * out.nx + m[4] * out.ny + m[8] * out.nz;
    const ny = m[1] * out.nx + m[5] * out.ny + m[9] * out.nz;
    const nz = m[2] * out.nx + m[6] * out.ny + m[10] * out.nz;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out.nx = nx / l;
    out.ny = ny / l;
    out.nz = nz / l;
    out.d *= this.worldScale;
    return out.d;
  }
  // Скорость поверхности коллайдера в мировой точке (учитывает вращение).
  velocityAt(px, py, pz, out) {
    const e = this._ie, p = this._pe;
    const x = e[0] * px + e[4] * py + e[8] * pz + e[12];
    const y = e[1] * px + e[5] * py + e[9] * pz + e[13];
    const z = e[2] * px + e[6] * py + e[10] * pz + e[14];
    const qx = p[0] * x + p[4] * y + p[8] * z + p[12];
    const qy = p[1] * x + p[5] * y + p[9] * z + p[13];
    const qz = p[2] * x + p[6] * y + p[10] * z + p[14];
    const idt = 1 / this._dt;
    out[0] = (px - qx) * idt;
    out[1] = (py - qy) * idt;
    out[2] = (pz - qz) * idt;
    return out;
  }
  // Ближайшая точка оси (для Penetration); по умолчанию — центр.
  axisPoint(px, py, pz, out) {
    out[0] = this.center.x;
    out[1] = this.center.y;
    out[2] = this.center.z;
    return false;
  }
  toJSON() {
    return {
      type: this.type,
      name: this.name,
      enabled: this.enabled,
      firmness: this.firmness,
      side: this.side,
      object: this.object ? this.object.name : null,
      position: this.position.toArray(),
      quaternion: this.quaternion.toArray(),
      scale: this.scale,
      ...this.shapeJSON()
    };
  }
  shapeJSON() {
    return {};
  }
};
var SphereCollider = class extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = "sphere";
    this.r = opts.radius ?? 0.1;
    this.localCenter = new THREE2.Vector3().fromArray(opts.center || [0, 0, 0]);
  }
  localRadius() {
    return this.r + this.localCenter.length();
  }
  localSdf(x, y, z, out) {
    x -= this.localCenter.x;
    y -= this.localCenter.y;
    z -= this.localCenter.z;
    const l = Math.sqrt(x * x + y * y + z * z);
    out.d = l - this.r;
    if (l > 1e-9) {
      out.nx = x / l;
      out.ny = y / l;
      out.nz = z / l;
    } else {
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
    }
  }
  shapeJSON() {
    return { radius: this.r, center: this.localCenter.toArray() };
  }
};
var CapsuleCollider = class extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = "capsule";
    this.r = opts.radius ?? 0.03;
    const h = opts.height ?? 0.1;
    this.a = new THREE2.Vector3().fromArray(opts.start || [0, -h / 2, 0]);
    this.b = new THREE2.Vector3().fromArray(opts.end || [0, h / 2, 0]);
    this.r2 = opts.endRadius ?? this.r;
  }
  localRadius() {
    return Math.max(this.a.length(), this.b.length()) + Math.max(this.r, this.r2);
  }
  _closest(x, y, z) {
    const ax = this.a.x, ay = this.a.y, az = this.a.z;
    const bx = this.b.x - ax, by = this.b.y - ay, bz = this.b.z - az;
    const L = bx * bx + by * by + bz * bz || 1e-12;
    let t = ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / L;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t;
  }
  localSdf(x, y, z, out) {
    const t = this._closest(x, y, z);
    const cx = this.a.x + (this.b.x - this.a.x) * t, cy = this.a.y + (this.b.y - this.a.y) * t, cz = this.a.z + (this.b.z - this.a.z) * t;
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out.d = l - (this.r + (this.r2 - this.r) * t);
    if (l > 1e-9) {
      out.nx = dx / l;
      out.ny = dy / l;
      out.nz = dz / l;
    } else {
      out.nx = 1;
      out.ny = 0;
      out.nz = 0;
    }
  }
  axisPoint(px, py, pz, out) {
    const e = this._ie, m = this._te;
    const x = e[0] * px + e[4] * py + e[8] * pz + e[12];
    const y = e[1] * px + e[5] * py + e[9] * pz + e[13];
    const z = e[2] * px + e[6] * py + e[10] * pz + e[14];
    const t = this._closest(x, y, z);
    const cx = this.a.x + (this.b.x - this.a.x) * t, cy = this.a.y + (this.b.y - this.a.y) * t, cz = this.a.z + (this.b.z - this.a.z) * t;
    out[0] = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
    out[1] = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
    out[2] = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
    return true;
  }
  shapeJSON() {
    return { radius: this.r, endRadius: this.r2, start: this.a.toArray(), end: this.b.toArray() };
  }
};
var BoxCollider = class extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = "box";
    const s = opts.size || [0.2, 0.2, 0.2];
    this.round = opts.rounding ?? 5e-3;
    this.h = new THREE2.Vector3(s[0] / 2 - this.round, s[1] / 2 - this.round, s[2] / 2 - this.round).max(new THREE2.Vector3(1e-6, 1e-6, 1e-6));
  }
  localRadius() {
    return this.h.length() + this.round;
  }
  localSdf(x, y, z, out) {
    const qx = Math.abs(x) - this.h.x, qy = Math.abs(y) - this.h.y, qz = Math.abs(z) - this.h.z;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const inside = Math.min(Math.max(qx, qy, qz), 0);
    out.d = outside + inside - this.round;
    if (outside > 1e-9) {
      out.nx = Math.sign(x) * ox / outside;
      out.ny = Math.sign(y) * oy / outside;
      out.nz = Math.sign(z) * oz / outside;
    } else if (qx >= qy && qx >= qz) {
      out.nx = Math.sign(x) || 1;
      out.ny = 0;
      out.nz = 0;
    } else if (qy >= qz) {
      out.nx = 0;
      out.ny = Math.sign(y) || 1;
      out.nz = 0;
    } else {
      out.nx = 0;
      out.ny = 0;
      out.nz = Math.sign(z) || 1;
    }
  }
  shapeJSON() {
    return { size: [(this.h.x + this.round) * 2, (this.h.y + this.round) * 2, (this.h.z + this.round) * 2], rounding: this.round };
  }
};
var PlaneCollider = class extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = "plane";
    this.size = opts.size || [0, 0];
    this.thickness = opts.thickness ?? 1;
  }
  localRadius() {
    return this.size[0] ? Math.hypot(this.size[0], this.size[1]) / 2 + this.thickness : 1e6;
  }
  localSdf(x, y, z, out) {
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.d = y < -this.thickness ? -y - 2 * this.thickness : y;
    if (this.size[0] && (Math.abs(x) > this.size[0] / 2 || Math.abs(z) > this.size[1] / 2)) out.d = Math.max(out.d, 1e3);
  }
  shapeJSON() {
    return { size: this.size, thickness: this.thickness };
  }
};

// src/effects/Effect.js
var Effect = class {
  constructor(params = {}, opts = {}) {
    const C = this.constructor;
    this.type = C.type;
    this.name = opts.name || C.type;
    this.enabled = opts.enabled !== false;
    this.params = { ...C.defaults, ...params };
    this.mask = Mask.from(opts.mask);
    this.regions = (opts.regions || []).map((r) => ({ name: r.name || "", mask: Mask.from(r.mask), params: { ...r.params } }));
    this.colliders = opts.colliders ?? null;
    this.sm = null;
    this.energy = 0;
    this._cache = {};
  }
  attach(sm) {
    this.sm = sm;
    this._cache = {};
    this.init();
  }
  detach() {
    this.reset();
    this.sm = null;
  }
  init() {
  }
  reset() {
  }
  get world() {
    return this.sm && this.sm.world;
  }
  set(params) {
    for (const k in params) if (!(k in this.params)) console.warn(`SoftFlesh: у эффекта ${this.type} нет параметра "${k}"`);
    Object.assign(this.params, params);
    this._cache.params = null;
    if (this.sm) this.sm._exactDirty = true;
    return this;
  }
  setMask(mask) {
    this.mask = Mask.from(mask);
    this._cache = {};
    if (this.sm) this.sm._exactDirty = true;
    return this;
  }
  setRegions(regions) {
    this.regions = regions.map((r) => ({ name: r.name || "", mask: Mask.from(r.mask), params: { ...r.params } }));
    this._cache = {};
    return this;
  }
  addRegion(mask, params, name = "") {
    this.regions.push({ name, mask: Mask.from(mask), params });
    this._cache = {};
    return this;
  }
  setColliders(c) {
    this.colliders = c;
    if (this.sm) this.sm._exactDirty = true;
    return this;
  }
  enable(on = true) {
    this.enabled = on;
    if (!on) this.reset();
    if (this.sm) this.sm._exactDirty = true;
    return this;
  }
  // Вес маски на узел.
  maskNodes() {
    if (!this._cache.mask) {
      let m = this.mask.resolve(this.sm.mesh, this.sm.topo);
      if (this.params.normalizeMask) {
        let mx = 0;
        for (let i = 0; i < m.length; i++) mx = Math.max(mx, m[i]);
        if (mx > 0 && mx < 1) for (let i = 0; i < m.length; i++) m[i] /= mx;
      }
      this._cache.mask = m;
      const list = [];
      for (let i = 0; i < m.length; i++) if (m[i] > 0) list.push(i);
      this._cache.list = Int32Array.from(list);
      this._cache.regionMasks = this.regions.map((r) => r.mask.resolve(this.sm.mesh, this.sm.topo));
      this._cache.params = null;
    }
    return this._cache.mask;
  }
  nodeList() {
    this.maskNodes();
    return this._cache.list;
  }
  // Параметр на узел с учётом регионов (кэшируется до изменения параметров).
  nodeParam(name) {
    this.maskNodes();
    if (!this._cache.params) this._cache.params = {};
    let a = this._cache.params[name];
    if (!a) {
      const M = this.sm.nodeCount;
      a = new Float32Array(M).fill(this.params[name]);
      this.regions.forEach((r, i) => {
        if (r.params[name] === void 0) return;
        const w = this._cache.regionMasks[i], v = r.params[name];
        for (let n = 0; n < M; n++) if (w[n] > 0) a[n] += (v - a[n]) * w[n];
      });
      this._cache.params[name] = a;
    }
    return a;
  }
  hasRegionParam(name) {
    return this.regions.some((r) => r.params[name] !== void 0);
  }
  // Список коллайдеров: свой (объект/группа/массив) или общий группы мира по умолчанию.
  resolveColliders() {
    const w = this.world;
    const src = this.colliders ?? (w ? w.colliders : []);
    const out = [];
    const add = (x) => {
      if (!x) return;
      if (Array.isArray(x)) x.forEach(add);
      else if (x.isColliderGroup) x.items.forEach(add);
      else if (x instanceof Collider) out.push(x);
      else if (x.isObject3D && w) out.push(w.colliderFor(x));
    };
    add(src);
    return out;
  }
  apply() {
  }
  // Ручной удар (для эффектов с импульсами): point — THREE.Vector3 в мире.
  hit() {
  }
  toJSON() {
    const cols = this.colliders == null ? null : [].concat(this.colliders).map((c) => c && (c.name || c.object && c.object.name || null));
    return {
      type: this.type,
      name: this.name,
      enabled: this.enabled,
      params: { ...this.params },
      mask: this.mask.toJSON(),
      regions: this.regions.map((r) => ({ name: r.name, mask: r.mask.toJSON(), params: r.params })),
      colliders: cols
    };
  }
};

// src/core/SpatialHash.js
var SpatialHash = class {
  constructor(capacity, tableBits = 15) {
    this.size = 1 << tableBits;
    this.mask = this.size - 1;
    this.head = new Int32Array(this.size);
    this.next = new Int32Array(capacity);
    this.cell = 1;
    this.pos = null;
  }
  _key(ix, iy, iz) {
    return (ix * 73856093 ^ iy * 19349663 ^ iz * 83492791) & this.mask;
  }
  build(pos, nodes, count, cellSize) {
    if (this.next.length < pos.length / 3) this.next = new Int32Array(pos.length / 3);
    this.head.fill(-1);
    this.cell = cellSize;
    this.pos = pos;
    const inv = 1 / cellSize;
    for (let i = 0; i < count; i++) {
      const n = nodes ? nodes[i] : i;
      const k = this._key(Math.floor(pos[3 * n] * inv), Math.floor(pos[3 * n + 1] * inv), Math.floor(pos[3 * n + 2] * inv));
      this.next[n] = this.head[k];
      this.head[k] = n;
    }
  }
  // Вызывает fn(node, distSq) для всех точек в радиусе r (r <= cellSize).
  query(x, y, z, r, fn) {
    const inv = 1 / this.cell;
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    const r2 = r * r, pos = this.pos;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (let n = this.head[this._key(cx + dx, cy + dy, cz + dz)]; n !== -1; n = this.next[n]) {
        const ex = pos[3 * n] - x, ey = pos[3 * n + 1] - y, ez = pos[3 * n + 2] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 <= r2) fn(n, d2);
      }
    }
  }
};

// src/core/contact.js
var _v2 = new Float32Array(3);
var ContactSolver = class {
  constructor(sm) {
    const M = sm.nodeCount;
    this.sm = sm;
    this.cNodes = new Int32Array(M);
    this.cDepth = new Float32Array(M);
    this.cN = new Float32Array(3 * M);
    this.cEsc = new Float32Array(3 * M);
    this.cFlag = new Uint8Array(M);
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
    this.perCollider = /* @__PURE__ */ new Map();
    this.hit = makeHit();
    this.best = makeHit();
    this.liveColliders = [];
  }
  // Очистить поле прошлого кадра.
  clear() {
    const f = this.field;
    for (let i = 0; i < this.regionCount; i++) {
      const n = this.region[i];
      f[3 * n] = 0;
      f[3 * n + 1] = 0;
      f[3 * n + 2] = 0;
    }
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
    const offset = P.offset ?? 1e-3;
    const reach = (P.reach ?? 0) + offset;
    const live = this.liveColliders = [];
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
      best.d = Infinity;
      best.collider = null;
      for (let c = 0; c < live.length; c++) {
        const col = live[c];
        const dc = len3(px - col.center.x, py - col.center.y, pz - col.center.z) - col.radius;
        if (dc > reach) continue;
        col.sdf(px, py, pz, hit);
        if (hit.d < best.d) {
          best.d = hit.d;
          best.nx = hit.nx;
          best.ny = hit.ny;
          best.nz = hit.nz;
          best.collider = col;
        }
      }
      if (!best.collider || best.d >= (P.reach ?? 0)) continue;
      const vx = baseN[3 * n], vy = baseN[3 * n + 1], vz = baseN[3 * n + 2];
      const outward = best.nx * vx + best.ny * vy + best.nz * vz;
      let w = 1;
      if (P.closeOpenings && topo.boundaryRing[n] < (P.openingRings ?? 3)) {
        if (outward > -0.2) continue;
        w = (topo.boundaryRing[n] + 1) / ((P.openingRings ?? 3) + 1);
      }
      const pen = -best.d;
      const depth = pen > 0 ? pen + offset * Math.min(pen / (2 * offset), 1) : 0;
      const flag = best.collider.side === "outside" && outward > 0.35 ? 1 : 0;
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
    this.cN[3 * k] = nx;
    this.cN[3 * k + 1] = ny;
    this.cN[3 * k + 2] = nz;
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
    for (let k = 0; k < K; k++) {
      const n = this.cNodes[k], d = this.cDepth[k] + 1e-6;
      f[3 * n] = this.cN[3 * k] * d;
      f[3 * n + 1] = this.cN[3 * k + 1] * d;
      f[3 * n + 2] = this.cN[3 * k + 2] * d;
    }
    if (P.axisIters) topo.blurVec(f, this.cNodes, K, P.axisIters, tmp, 0.6);
    const splay = P.splay ?? 0;
    const hit = this.hit;
    for (let k = 0; k < K; k++) {
      const n = this.cNodes[k];
      let ax = f[3 * n], ay = f[3 * n + 1], az = f[3 * n + 2];
      const flag = this.cFlag[k];
      if (flag === 1) {
        ax = -baseN[3 * n];
        ay = -baseN[3 * n + 1];
        az = -baseN[3 * n + 2];
      }
      const l = len3(ax, ay, az);
      if (l < 1e-9) {
        ax = this.cN[3 * k];
        ay = this.cN[3 * k + 1];
        az = this.cN[3 * k + 2];
      } else {
        ax /= l;
        ay /= l;
        az /= l;
      }
      const depth = this.cDepth[k];
      let t = depth;
      const col = this.cCol[k];
      if (col && flag !== 2) {
        const px = base[3 * n] + disp[3 * n], py = base[3 * n + 1] + disp[3 * n + 1], pz = base[3 * n + 2] + disp[3 * n + 2];
        const target = depth - Math.max(0, -this._sdf(col, px, py, pz, hit));
        t = 0;
        const cap = depth * 3 + (P.maxEscape ?? 0.04);
        for (let it = 0; it < 10; it++) {
          const d = col.sdf(px + ax * t, py + ay * t, pz + az * t, hit);
          const need = target - d;
          if (need <= 1e-5) break;
          t += need;
          if (t > cap) {
            t = cap;
            break;
          }
        }
      }
      let ex = ax * t, ey = ay * t, ez = az * t;
      if (splay > 0 && flag === 0) {
        ex += (this.cN[3 * k] * depth - ex) * splay;
        ey += (this.cN[3 * k + 1] * depth - ey) * splay;
        ez += (this.cN[3 * k + 2] * depth - ez) * splay;
      }
      let s = typeof P.scale === "number" ? P.scale : P.scale[n];
      if (col && col.firmness < 100) s *= col.firmness / 100;
      this.cEsc[3 * k] = ex * s;
      this.cEsc[3 * k + 1] = ey * s;
      this.cEsc[3 * k + 2] = ez * s;
    }
    const rings = Math.max(1, Math.round(P.rings ?? 8));
    const cnt = topo.bfs(this.cNodes, K, rings, Infinity, base);
    for (let i = 0; i < cnt; i++) {
      const n = topo.queue[i];
      this.region[i] = n;
      this.inRegion[n] = this.regionStamp;
      this.ring[n] = topo.ring[n];
      this.dist[n] = topo.dist[n];
      this.src[n] = topo.src[n];
      f[3 * n] = 0;
      f[3 * n + 1] = 0;
      f[3 * n + 2] = 0;
    }
    this.regionCount = cnt;
    for (let k = 0; k < K; k++) {
      const n = this.cNodes[k];
      f[3 * n] = this.cEsc[3 * k];
      f[3 * n + 1] = this.cEsc[3 * k + 1];
      f[3 * n + 2] = this.cEsc[3 * k + 2];
    }
    const rimIters = Math.round(P.rimIters ?? 0);
    if (rimIters > 0 && (P.rim ?? 0) > 0) {
      topo.blurVec(f, this.region, cnt, rimIters, tmp, 0.5, true);
      const rim = P.rim;
      for (let i = 0; i < cnt; i++) {
        const n = this.region[i];
        if (this.cIndex[n] >= 0) continue;
        f[3 * n] *= rim;
        f[3 * n + 1] *= rim;
        f[3 * n + 2] *= rim;
      }
    }
    let V = 0;
    for (let i = 0; i < cnt; i++) {
      const n = this.region[i];
      const inward = -(f[3 * n] * baseN[3 * n] + f[3 * n + 1] * baseN[3 * n + 1] + f[3 * n + 2] * baseN[3 * n + 2]);
      if (inward > 0) V += inward * sm.area[n];
    }
    this.volume = V;
  }
  _sdf(col, x, y, z, hit) {
    return col.sdf(x, y, z, hit);
  }
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
        const Wn = typeof W === "number" ? W : W[n];
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
      let h = V * w[i] / sum;
      if (P.bulgeMul) h *= P.bulgeMul[n];
      if (h > maxH) h = maxH;
      const nx = baseN[3 * n], ny = baseN[3 * n + 1], nz = baseN[3 * n + 2];
      f[3 * n] += nx * h;
      f[3 * n + 1] += ny * h;
      f[3 * n + 2] += nz * h;
      if (lat) {
        const s = this.src[n];
        let tx = base[3 * n] - base[3 * s], ty = base[3 * n + 1] - base[3 * s + 1], tz = base[3 * n + 2] - base[3 * s + 2];
        const dn = tx * nx + ty * ny + tz * nz;
        tx -= dn * nx;
        ty -= dn * ny;
        tz -= dn * nz;
        const l = len3(tx, ty, tz) || 1;
        const k = lat * h / l;
        f[3 * n] += tx * k;
        f[3 * n + 1] += ty * k;
        f[3 * n + 2] += tz * k;
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
      if (proj < 1) {
        const a = 1 - proj;
        f[3 * n] += ex * a;
        f[3 * n + 1] += ey * a;
        f[3 * n + 2] += ez * a;
      }
    }
  }
  // Прибавить поле к смещениям меша.
  commit(scale = 1) {
    const d = this.sm.disp, f = this.field;
    for (let i = 0; i < this.regionCount; i++) {
      const n = this.region[i];
      d[3 * n] += f[3 * n] * scale;
      d[3 * n + 1] += f[3 * n + 1] * scale;
      d[3 * n + 2] += f[3 * n + 2] * scale;
    }
  }
  // Средняя точка и нормаль самого глубокого контакта для данного коллайдера.
  contactPoint(rec, out) {
    const b = this.sm.base, n = rec.node;
    out.x = b[3 * n];
    out.y = b[3 * n + 1];
    out.z = b[3 * n + 2];
    return out;
  }
};
var SelfContact = class {
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
    let isStatic = !sm.skinned && !(sm.morphs.length && sm.mesh.morphTargetInfluences && sm.mesh.morphTargetInfluences.some((w) => w));
    if (isStatic) for (let i = 0; i < softNodes.length && isStatic; i++) {
      const n = softNodes[i];
      if (disp[3 * n] || disp[3 * n + 1] || disp[3 * n + 2]) isStatic = false;
    }
    const key = isStatic ? sm._lastScale + ":" + sm.mesh.matrixWorld.elements.join(",") : null;
    if (isStatic && this.valid && key === this.staticKey) return this._replay(solver);
    const every = sm.world ? sm.world.quality.selfContactEvery || 1 : 1;
    if (!isStatic && this.valid && this.staticKey === null && sm.frameCounter % every !== 0) return this._replay(solver);
    this.staticKey = key;
    this.valid = true;
    this.cCount = 0;
    const pos = this.pos;
    for (let i = 0; i < 3 * M; i++) pos[i] = base[i] + disp[i];
    const edge = sm.meanEdgeWorld;
    const gap = P.gap ?? 5e-4;
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
        for (let b = head[((cx + dx) * 73856093 ^ (cy + dy) * 19349663 ^ (cz + dz) * 83492791) & hm]; b !== -1; b = next[b]) {
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
          if (depth > bestDepth) {
            bestDepth = depth;
            bnx = bnx2;
            bny = bny2;
            bnz = bnz2;
            share = mask[b] > 0 ? 0.5 : 1;
          }
        }
      }
      if (bestDepth > 0) {
        bestDepth = Math.min(bestDepth, edge * 6) * share;
        const k = this.cCount++, d = 4 * k;
        this.cNodes[k] = a;
        this.cData[d] = bestDepth;
        this.cData[d + 1] = bnx;
        this.cData[d + 2] = bny;
        this.cData[d + 3] = bnz;
      }
    }
    return this._replay(solver);
  }
};
var ImpulseTracker = class {
  constructor() {
    this.state = /* @__PURE__ */ new Map();
  }
  update(solver, params, cb) {
    const sm = solver.sm, vel = sm.vel, minSpeed = params.minHitSpeed ?? 0.15, sens = (params.impactSensitivity ?? 1.5) / 1.5;
    const seen = /* @__PURE__ */ new Set();
    for (const [col, rec] of solver.perCollider) {
      seen.add(col);
      let st = this.state.get(col);
      const n = rec.node;
      const b = sm.base;
      col.velocityAt(b[3 * n], b[3 * n + 1], b[3 * n + 2], _v2);
      const rvx = _v2[0] - vel[3 * n], rvy = _v2[1] - vel[3 * n + 1], rvz = _v2[2] - vel[3 * n + 2];
      const closing = rvx * rec.nx + rvy * rec.ny + rvz * rec.nz;
      const speed = clamp(closing, 0, 50);
      if (!st) {
        st = { contact: false, armed: true, speed: 0, dir: [0, 0, 0] };
        this.state.set(col, st);
      }
      const fire = !st.contact && speed > minSpeed || st.contact && st.armed && speed > minSpeed * 1.5;
      if (fire) {
        st.armed = false;
        const l = len3(rvx, rvy, rvz) || 1;
        cb({ collider: col, node: n, speed, strength: speed * sens, normal: [rec.nx, rec.ny, rec.nz], direction: [rvx / l, rvy / l, rvz / l] });
      }
      if (speed < minSpeed * 0.5) st.armed = true;
      st.contact = true;
      st.speed = speed;
    }
    for (const [col, st] of this.state) if (!seen.has(col)) {
      st.contact = false;
      st.armed = true;
      st.speed = 0;
    }
  }
  // Удерживается ли сейчас какой-то контакт
  get holding() {
    for (const st of this.state.values()) if (st.contact) return true;
    return false;
  }
};

// src/effects/ContactEffect.js
var ContactEffect = class extends Effect {
  init() {
    this.solver = new ContactSolver(this.sm);
    this.self = null;
    this.tracker = new ImpulseTracker();
    this.lastHit = null;
  }
  reset() {
    if (this.solver) this.solver.clear();
    this.energy = 0;
  }
  get quality() {
    return this.world.quality;
  }
  // Поиск контактов + самоконтакт + удары. Возвращает число контактов.
  gatherContacts(selfOn, selfParams = {}) {
    const p = this.params, s = this.solver;
    s.clear();
    const mask = this.maskNodes(), nodes = this.nodeList();
    s.detect(this.resolveColliders(), nodes, mask, { offset: p.collisionOffset, closeOpenings: p.closeOpenings, openingRings: p.openingRings });
    if (selfOn && this.quality.selfContact) {
      if (!this.self) this.self = new SelfContact(this.sm);
      this.self.detect(s, nodes, mask, selfParams);
    }
    this.tracker.update(s, p, (h) => this._onHit(h));
    return s.count;
  }
  _onHit(h) {
    const b = this.sm.base, n = h.node;
    const point = { x: b[3 * n], y: b[3 * n + 1], z: b[3 * n + 2] };
    const ev = { type: "hit", effect: this, softMesh: this.sm, collider: h.collider, point, normal: h.normal, direction: h.direction, speed: h.speed, strength: h.strength };
    this.lastHit = ev;
    this.onHit(ev);
    this.world.emit("hit", ev);
  }
  onHit() {
  }
  // Карта «сжатия складки» для Corner Taper: >0 — вогнутость (сгиб колена/локтя).
  concavity(n) {
    const { base, baseN, topo, meanEdgeWorld } = this.sm;
    let cx = 0, cy = 0, cz = 0;
    const a = topo.adjStart[n], b = topo.adjStart[n + 1];
    for (let k = a; k < b; k++) {
      const j = topo.adj[k];
      cx += base[3 * j];
      cy += base[3 * j + 1];
      cz += base[3 * j + 2];
    }
    const c = b - a || 1;
    cx = cx / c - base[3 * n];
    cy = cy / c - base[3 * n + 1];
    cz = cz / c - base[3 * n + 2];
    return (cx * baseN[3 * n] + cy * baseN[3 * n + 1] + cz * baseN[3 * n + 2]) / (meanEdgeWorld || 1);
  }
};

// src/effects/Contact.js
var Contact = class extends ContactEffect {
  apply() {
    const p = this.params, q = this.quality, s = this.solver;
    if (!this.gatherContacts(p.selfContact, { gap: p.selfGap })) return;
    const firm = this.nodeParam("firmness");
    const scale = this._scale || (this._scale = new Float32Array(this.sm.nodeCount));
    if (this._scaleSrc !== firm) {
      for (let n = 0; n < firm.length; n++) scale[n] = 1 - 0.85 * Math.min(firm[n], 100) / 100;
      this._scaleSrc = firm;
    }
    const regional = this.hasRegionParam("bulgeWidth");
    const W = regional ? this.nodeParam("bulgeWidth") : p.bulgeWidth;
    let maxW = p.bulgeWidth;
    if (regional) {
      for (const r of this.regions) if (r.params.bulgeWidth > maxW) maxW = r.params.bulgeWidth;
    }
    const rings = Math.min(Math.round(maxW) + 2, q.maxRings);
    const dent = this.hasRegionParam("dent") ? Math.max(p.dent, ...this.regions.map((r) => r.params.dent ?? 0)) : p.dent;
    s.computeDent({
      scale,
      splay: p.splay,
      axisIters: 3,
      rings,
      rimIters: Math.round((2 + maxW * 0.3) * q.smoothingScale),
      rim: Math.min(1, dent / 50)
    });
    let taper = null;
    if (p.cornerTaper) {
      taper = this._taper || (this._taper = new Float32Array(this.sm.nodeCount));
      const amt = this.nodeParam("taperAmount");
      const c0 = (1 - p.taperReach) * 0.4, c1 = c0 + p.taperFalloff * 0.6 + 0.05;
      for (let i = 0; i < s.regionCount; i++) {
        const n = s.region[i];
        taper[n] = 1 - amt[n] * smoothstep(c0, c1, this.concavity(n));
      }
    }
    s.bulge({ volume: 1, rings: W, mask: this.maskNodes(), bulgeMul: this.nodeParam("bulge"), taper, lateralFlow: p.lateralFlow });
    s.smooth(p.smoothing * q.smoothingScale);
    s.commit();
  }
};
__publicField(Contact, "type", "contact");
__publicField(Contact, "defaults", {
  bulge: 1,
  // сила выпуклости: 1 — объём сохраняется, 0 — чистая вмятина (подушка)
  bulgeWidth: 15,
  // ширина выпуклости в рядах (кольцах) вершин
  dent: 15,
  // Dent %: мягкая «воронка» вокруг вмятины
  firmness: 0,
  // Firmness %: плотная плоть продавливается меньше
  smoothing: 4,
  // сглаживание результата
  collisionOffset: 1e-3,
  // толщина «кожи» между плотью и коллайдером
  splay: 0.25,
  // 0 — сплющивание вдоль оси давления, 1 — растекание по нормали коллайдера
  lateralFlow: 0,
  // смещение выпуклости вдоль поверхности от центра контакта
  cornerTaper: false,
  // меньше выпуклости в сгибах (колени, локти)
  taperAmount: 1,
  taperReach: 0.85,
  taperFalloff: 1,
  closeOpenings: false,
  // защита от ложных касаний у открытых краёв меша
  openingRings: 3,
  selfContact: true,
  // касание объекта с самим собой
  selfGap: 5e-4,
  exactContact: 1,
  minHitSpeed: 0.15,
  impactSensitivity: 1.5
});
__publicField(Contact, "regionParams", ["bulge", "bulgeWidth", "dent", "firmness", "taperAmount"]);

// src/effects/Squish.js
var Squish = class extends ContactEffect {
  apply() {
    const p = this.params, q = this.quality, s = this.solver;
    if (!this.gatherContacts(p.selfCollision, { gap: 5e-4 })) return;
    const inten = this.nodeParam("intensity");
    const scale = this._scale || (this._scale = new Float32Array(this.sm.nodeCount));
    if (this._src !== inten) {
      for (let n = 0; n < inten.length; n++) scale[n] = Math.min(inten[n], 1);
      this._src = inten;
    }
    const rings = Math.min(Math.round(p.spread) + 2, q.maxRings);
    s.computeDent({
      scale,
      splay: p.splay,
      axisIters: 3,
      rings,
      rimIters: Math.round(p.shapeSmoothing * 0.6 * q.smoothingScale),
      rim: 0.35 + 0.4 * clamp(p.intensity - 1, 0, 1)
    });
    const vp = this.nodeParam("volumePreservation");
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
      cx += base[3 * n] * d;
      cy += base[3 * n + 1] * d;
      cz += base[3 * n + 2] * d;
      wsum += d;
    }
    if (wsum <= 0) return;
    cx /= wsum;
    cy /= wsum;
    cz /= wsum;
    const mask = this.maskNodes(), nodes = this.nodeList();
    const R = Math.max(sm.radius * 0.5, 1e-4);
    const w = this._iw || (this._iw = new Float32Array(sm.nodeCount));
    let sum = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (s.cIndex[n] >= 0) {
        w[n] = 0;
        continue;
      }
      const d = len3(base[3 * n] - cx, base[3 * n + 1] - cy, base[3 * n + 2] - cz);
      w[n] = mask[n] * (0.35 + 0.65 * Math.exp(-d / R));
      sum += w[n] * area[n];
    }
    if (sum <= 0) return;
    const f = s.field, maxH = s.maxDepth;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!w[n]) continue;
      const h = Math.min(leftover * w[n] / sum, maxH);
      s.include(n);
      f[3 * n] += baseN[3 * n] * h;
      f[3 * n + 1] += baseN[3 * n + 1] * h;
      f[3 * n + 2] += baseN[3 * n + 2] * h;
    }
  }
};
__publicField(Squish, "type", "squish");
__publicField(Squish, "defaults", {
  intensity: 1,
  // 1 — вмятина точно повторяет коллайдер
  shapeSmoothing: 6,
  // скругление края вмятины
  spread: 9,
  // ширина кольца объёма (в кольцах вершин)
  volumePreservation: 0.6,
  // доля вдавленного объёма, вернувшаяся выпуклостью
  lateralFlow: 0,
  // растекание ореола вдоль поверхности
  correctiveSmooth: 4,
  // сглаживание смещений
  collisionOffset: 15e-4,
  contactHardness: 1,
  // большие коллайдеры: 1 — никогда не проходят внутрь
  splay: 0.2,
  // 0 — сплющить, 1 — растечь вбок
  selfCollision: false,
  // мягкая плоть давит сама на себя (складки)
  exactContact: 1,
  inflatePressure: 0,
  minHitSpeed: 0.15,
  impactSensitivity: 1.5
});
__publicField(Squish, "regionParams", ["intensity", "volumePreservation"]);
var SquishInflate = class extends Squish {
  apply() {
    this.params.intensity = this.params.squishStrength;
    if (this.hasRegionParam("squishStrength")) {
      for (const r of this.regions) if (r.params.squishStrength !== void 0) r.params.intensity = r.params.squishStrength;
    }
    super.apply();
  }
};
__publicField(SquishInflate, "type", "squishInflate");
__publicField(SquishInflate, "defaults", {
  ...Squish.defaults,
  squishStrength: 1.38,
  // ≥1 — точная вмятина, выше — мягче край
  inflatePressure: 1,
  shapeSmoothing: 11,
  spread: 9,
  volumePreservation: 0.26,
  correctiveSmooth: 10,
  collisionOffset: 11e-4,
  contactHardness: 0,
  splay: 0
});
__publicField(SquishInflate, "regionParams", ["squishStrength", "volumePreservation"]);

// src/core/SpringField.js
var SpringField = class {
  constructor(M) {
    this.y = new Float32Array(3 * M);
    this.v = new Float32Array(3 * M);
    this.mark = new Int32Array(M);
    this.stamp = 1;
    this.list = new Int32Array(M);
    this.count = 0;
    this.target = new Float32Array(3 * M);
  }
  reset() {
    this.y.fill(0);
    this.v.fill(0);
    this.target.fill(0);
    this.count = 0;
  }
  // nodes: узлы с ненулевой целью в этом кадре (цель в this.target).
  step(nodes, n, dt, omega, zeta, maxSub = 1 / 120) {
    const st = ++this.stamp, mark = this.mark, y = this.y, v = this.v, T = this.target;
    const next = [];
    for (let i = 0; i < n; i++) {
      const k = nodes[i];
      if (mark[k] !== st) {
        mark[k] = st;
        next.push(k);
      }
    }
    for (let i = 0; i < this.count; i++) {
      const k = this.list[i];
      if (mark[k] !== st) {
        mark[k] = st;
        next.push(k);
      }
    }
    const sub = Math.max(1, Math.ceil(dt / maxSub)), h = dt / sub;
    const w2 = omega * omega, c = 2 * zeta * omega;
    let cnt = 0;
    for (const k of next) {
      let alive = false;
      for (let a = 0; a < 3; a++) {
        const i = 3 * k + a;
        let yy = y[i], vv = v[i];
        const t = T[i];
        for (let s = 0; s < sub; s++) {
          vv += (w2 * (t - yy) - c * vv) * h;
          yy += vv * h;
        }
        y[i] = yy;
        v[i] = vv;
        if (Math.abs(yy) > 1e-6 || Math.abs(vv) > 1e-5 || t !== 0) alive = true;
      }
      if (alive) this.list[cnt++] = k;
      else {
        y[3 * k] = y[3 * k + 1] = y[3 * k + 2] = 0;
        v[3 * k] = v[3 * k + 1] = v[3 * k + 2] = 0;
      }
    }
    this.count = cnt;
    for (const k of next) {
      T[3 * k] = 0;
      T[3 * k + 1] = 0;
      T[3 * k + 2] = 0;
    }
  }
  addTo(disp, scale = 1) {
    const y = this.y;
    for (let i = 0; i < this.count; i++) {
      const k = this.list[i];
      disp[3 * k] += y[3 * k] * scale;
      disp[3 * k + 1] += y[3 * k + 1] * scale;
      disp[3 * k + 2] += y[3 * k + 2] * scale;
    }
  }
  kick(k, x, y, z) {
    this.v[3 * k] += x;
    this.v[3 * k + 1] += y;
    this.v[3 * k + 2] += z;
    if (this.count < this.list.length) this.list[this.count++] = k;
  }
};

// src/effects/SquishOrganic.js
var SquishOrganic = class extends ContactEffect {
  init() {
    super.init();
    this.spring = new SpringField(this.sm.nodeCount);
    this.speed = 0;
    this.travel = [0, 0, 0];
  }
  reset() {
    super.reset();
    if (this.spring) this.spring.reset();
  }
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
      let best = null;
      for (const [c, r] of s.perCollider) if (!best || r.depth > best.r.depth) best = { c, r };
      if (best) {
        const n = best.r.node, v = [0, 0, 0];
        best.c.velocityAt(base[3 * n], base[3 * n + 1], base[3 * n + 2], v);
        v[0] -= vel[3 * n];
        v[1] -= vel[3 * n + 1];
        v[2] -= vel[3 * n + 2];
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
      s.bulge({ volume: p.volumePreservation * (1 - p.skinTension), rings: Math.max(3, Math.round(wR / meanEdgeWorld)), mask: this.maskNodes() });
      this._ridge(R0, wR);
      s.smooth(p.smoothing * q.smoothingScale);
      const T = this.spring.target, f = s.field;
      for (let i = 0; i < s.regionCount; i++) {
        const n = s.region[i];
        T[3 * n] = f[3 * n];
        T[3 * n + 1] = f[3 * n + 1];
        T[3 * n + 2] = f[3 * n + 2];
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
      let h = sum > 0 ? V * w[i] / sum : 0;
      const d = s.dist[n];
      if (d < R0 && p.wrinkleDepth > 0) {
        const x = d / R0;
        h -= p.wrinkleDepth * depth * 0.5 * Math.sin(Math.PI * p.wrinkleCount * x) ** 2 * (1 - x) * mask[n];
      }
      h = clamp(h, -depth, depth * 1.5);
      f[3 * n] += baseN[3 * n] * h;
      f[3 * n + 1] += baseN[3 * n + 1] * h;
      f[3 * n + 2] += baseN[3 * n + 2] * h;
    }
  }
};
__publicField(SquishOrganic, "type", "squishOrganic");
__publicField(SquishOrganic, "defaults", {
  squishIntensity: 1,
  directionInfluence: 0.7,
  // насколько направление движения коллайдера смещает деформацию
  volumePreservation: 0.9,
  collisionStrength: 1.2,
  collisionSoftness: 0.4,
  stiffness: 0.6,
  // жёсткость: выше — быстрее успокаивается
  velocityInfluence: 1,
  jiggle: 0.4,
  // вторичное покачивание
  collisionOffset: 15e-4,
  impactSensitivity: 1.5,
  relaxTime: 0.6,
  skinTension: 0.6,
  // доля объёма, уходящая в валик, а не в выпуклость на месте
  ridgeDistance: 0.05,
  // базовое расстояние от контакта до валика (м)
  wrinkleDepth: 0.35,
  wrinkleCount: 3,
  smoothing: 4,
  exactContact: 1,
  minHitSpeed: 0.15
});

// src/effects/FatJiggle.js
var FatJiggle = class extends ContactEffect {
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
    if (this.u) {
      this.u.fill(0);
      this.v.fill(0);
      this.sleeping = true;
      this._first = true;
    }
  }
  _maskRadius() {
    const nodes = this.nodeList(), b = this.sm.base;
    let cx = 0, cy = 0, cz = 0;
    for (const n of nodes) {
      cx += b[3 * n];
      cy += b[3 * n + 1];
      cz += b[3 * n + 2];
    }
    const c = nodes.length || 1;
    cx /= c;
    cy /= c;
    cz /= c;
    let r = 0;
    for (const n of nodes) r = Math.max(r, len3(b[3 * n] - cx, b[3 * n + 1] - cy, b[3 * n + 2] - cz));
    return r || this.sm.radius;
  }
  onHit(ev) {
    this.hit(ev.point, ev.strength, ev.direction ? [-ev.normal[0], -ev.normal[1], -ev.normal[2]] : null, false);
  }
  // Ручной удар: point {x,y,z} в мире, strength ~ скорость удара в м/с, direction — куда толкнуть (по умолчанию внутрь кожи).
  hit(point, strength = 1, direction = null, forwarded = false) {
    const sm = this.sm;
    if (!sm) return;
    if (!this.maskRadius) this.maskRadius = this._maskRadius();
    const p = this.params, { base, baseN } = sm;
    const mask = this.maskNodes(), nodes = this.nodeList(), amp = this.nodeParam("amplitude");
    const R = Math.max(this.maskRadius * 0.6 * (p.decay / 1.2), sm.meanEdgeWorld * 2);
    const k = strength * 0.5;
    for (const n of nodes) {
      const d = len3(base[3 * n] - point.x, base[3 * n + 1] - point.y, base[3 * n + 2] - point.z);
      if (d > R * 2) continue;
      const g = Math.exp(-((d / R) ** 2) * 2) * mask[n] * (amp[n] / 0.25) * k;
      const dx = direction ? direction[0] : -baseN[3 * n], dy = direction ? direction[1] : -baseN[3 * n + 1], dz = direction ? direction[2] : -baseN[3 * n + 2];
      this.v[3 * n] += dx * g;
      this.v[3 * n + 1] += dy * g;
      this.v[3 * n + 2] += dz * g;
    }
    this.energy += strength;
    this.sleeping = false;
    if (p.passHitsOn && !forwarded) {
      for (const e of sm.effects) if (e !== this && e.type === "fatJiggle" && e.enabled && e.params.passHitsOn) e.hit(point, strength * 0.35, direction, true);
    }
  }
  apply(ctx) {
    const p = this.params, sm = this.sm, q = this.quality, s = this.solver, dt = ctx.dt;
    if (!this.maskRadius) this.maskRadius = this._maskRadius();
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
    const nodes = this.nodeList(), mask = this.maskNodes(), amp = this.nodeParam("amplitude");
    const u = this.u, v = this.v, pv = this.prevVel;
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
        const m = mask[n], gain = amp[n] / 0.25 * m * p.inertia;
        let sx = 0, sy = 0, sz = 0;
        const a0 = topo.adjStart[n], a1 = topo.adjStart[n + 1];
        for (let k = a0; k < a1; k++) {
          const j = topo.adj[k];
          sx += u[3 * j];
          sy += u[3 * j + 1];
          sz += u[3 * j + 2];
        }
        const cn = a1 - a0 || 1;
        for (let a = 0; a < 3; a++) {
          const i = 3 * n + a;
          const lap = (a === 0 ? sx : a === 1 ? sy : sz) / cn - u[i];
          let f = -w2 * u[i] - c * v[i] + kap * lap - acc[i] * gain;
          if (a === 1 && g) f -= g * m * Math.abs(acc[i]);
          v[i] += f * h;
        }
      }
      for (const n of nodes) {
        u[3 * n] += v[3 * n] * h;
        u[3 * n + 1] += v[3 * n + 1] * h;
        u[3 * n + 2] += v[3 * n + 2] * h;
      }
    }
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
      if (l > cap && l > 0) {
        const k = cap / l;
        ox *= k;
        oy *= k;
        oz *= k;
      }
      disp[3 * n] += ox;
      disp[3 * n + 1] += oy;
      disp[3 * n + 2] += oz;
      const e = Math.abs(ux) + Math.abs(uy) + Math.abs(uz) + (Math.abs(v[3 * n]) + Math.abs(v[3 * n + 1]) + Math.abs(v[3 * n + 2])) * 0.05;
      if (e > maxU) maxU = e;
    }
    if (maxU < 1e-6 && maxA * p.inertia < 0.05) {
      this.sleeping = true;
      for (const n of nodes) {
        u[3 * n] = u[3 * n + 1] = u[3 * n + 2] = 0;
        v[3 * n] = v[3 * n + 1] = v[3 * n + 2] = 0;
      }
    }
  }
};
__publicField(FatJiggle, "type", "fatJiggle");
__publicField(FatJiggle, "defaults", {
  amplitude: 0.25,
  // сила движения жира
  wobbleSpeed: 3.8,
  // частота колебаний, Гц (ниже — тяжелее и медленнее)
  lateralMotion: 1,
  // движение вдоль кожи
  normalMotion: 0.6,
  // движение внутрь/наружу кожи
  decay: 1.2,
  // размер массы жира, на которую ложится удар
  dentDepth: 1,
  // глубина статичной вмятины от контакта
  impactSensitivity: 1.5,
  // 1.5 = x1; 1 м/с — один полный импульс
  relaxTime: 0.5,
  // секунды до затухания в e раз
  smoothing: 10,
  // сглаживание пятна контакта
  collisionOffset: 15e-4,
  sustain: 0,
  // держит тряску, пока контакт удерживается
  inertia: 1,
  // реакция на движение самого тела/персонажа
  gravity: 0,
  // провисание при вертикальных ускорениях
  passHitsOn: true,
  // передавать удары другим Fat Jiggle на этом меше (одна половина -> другая)
  normalizeMask: true,
  maxOffset: 0.08,
  exactContact: 1,
  minHitSpeed: 0.15
});
__publicField(FatJiggle, "regionParams", ["amplitude"]);

// src/effects/Ripple.js
var Ripple = class extends ContactEffect {
  init() {
    super.init();
    this.ripples = [];
    this.out = new Float32Array(3 * this.sm.nodeCount);
    this.work = new Int32Array(this.sm.nodeCount);
    this.tmp = new Float32Array(3 * this.sm.nodeCount);
    this._sustainT = 0;
  }
  reset() {
    super.reset();
    if (this.ripples) this.ripples.length = 0;
  }
  onHit(ev) {
    this.hit(ev.point, ev.strength, ev.direction);
  }
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
        if (this._sustainT > period) {
          this._sustainT = 0;
          this.hit(this.lastHit.point, this.lastHit.strength * p.sustain, this.lastHit.direction);
        }
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
    for (const n of nodes) {
      out[3 * n] = 0;
      out[3 * n + 1] = 0;
      out[3 * n + 2] = 0;
    }
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
        let hgt = env * Math.cos(2 * Math.PI * x / lambda) * Math.exp(-((x / half) ** 2)) * Math.exp(-d / Math.max(p.decay, 1e-4));
        hgt *= Math.min(1, d / (lambda * 0.5) + 0.2);
        if (fatOn) hgt += fenv * Math.exp(-((d / fatR) ** 2));
        hgt *= mask[n];
        out[3 * n] += baseN[3 * n] * hgt;
        out[3 * n + 1] += baseN[3 * n + 1] * hgt;
        out[3 * n + 2] += baseN[3 * n + 2] * hgt;
      }
    }
    for (const n of nodes) if (out[3 * n] || out[3 * n + 1] || out[3 * n + 2]) work[wc++] = n;
    if (p.smoothing > 0) sm.topo.blurVec(out, work, wc, Math.round(p.smoothing * q.smoothingScale), this.tmp, 0.5);
    const disp = sm.disp;
    for (let i = 0; i < wc; i++) {
      const n = work[i];
      disp[3 * n] += out[3 * n];
      disp[3 * n + 1] += out[3 * n + 1];
      disp[3 * n + 2] += out[3 * n + 2];
    }
  }
};
__publicField(Ripple, "type", "ripple");
__publicField(Ripple, "defaults", {
  amplitude: 0.04,
  // высота волны (м) для удара 1 м/с
  frequency: 3,
  // число гребней в пакете
  waveSpeed: 0.7,
  // скорость кольца, м/с
  waveRange: 0.25,
  // ширина волнового пакета (м)
  decay: 0.15,
  // затухание с расстоянием (м)
  dentDepth: 1,
  impactSensitivity: 1.5,
  relaxTime: 0.6,
  smoothing: 2,
  collisionOffset: 15e-4,
  sustain: 0,
  fat: false,
  fatAmplitude: 0.01,
  fatWaveScale: 2,
  fatRelax: 0.8,
  fatSpeed: 4,
  maxRipples: 8,
  exactContact: 1,
  minHitSpeed: 0.15
});

// src/effects/Penetration.js
var Penetration = class extends Effect {
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
  reset() {
    if (this.spring) this.spring.reset();
    this.energy = 0;
  }
  apply(ctx) {
    const p = this.params, sm = this.sm, q = this.world.quality, dt = ctx.dt;
    const { base, disp, baseN, vel } = sm;
    this.time += dt;
    this.energy *= Math.exp(-dt / Math.max(p.relaxTime, 0.01));
    const cols = this.resolveColliders().filter((c) => c.enabled && c.center.distanceTo(sm.center) < c.radius + sm.radius + p.falloffDistance);
    const wet = p.wetness > 0 ? sm.output("softfleshWet") : null;
    if (wet) {
      const k = Math.exp(-dt / Math.max(p.wetDryTime, 0.01));
      for (let n = 0; n < wet.node.length; n++) wet.node[n] *= k;
    }
    const nodes = this.nodeList(), mask = this.maskNodes(), hit = this.hitObj, f = this.field;
    let cnt = 0;
    if (cols.length) {
      const pen = /* @__PURE__ */ new Map();
      for (const n of nodes) {
        const px = base[3 * n] + disp[3 * n], py = base[3 * n + 1] + disp[3 * n + 1], pz = base[3 * n + 2] + disp[3 * n + 2];
        for (const c of cols) {
          if (len3(px - c.center.x, py - c.center.y, pz - c.center.z) > c.radius + p.falloffDistance + p.collisionOffset) continue;
          c.sdf(px, py, pz, hit);
          const d = p.collisionOffset - hit.d;
          if (d > (pen.get(c) || 0)) pen.set(c, d);
        }
      }
      const fake = { sm, perCollider: /* @__PURE__ */ new Map() };
      for (const [c, d] of pen) if (d > 0) {
        c.velocityAt(c.center.x, c.center.y, c.center.z, this._v);
        const sp = len3(this._v[0], this._v[1], this._v[2]);
        this.energy = clamp(this.energy + sp * dt * 4 * (p.impactSensitivity / 1.5), 0, 1);
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
            rx = px - this._ax[0];
            ry = py - this._ax[1];
            rz = pz - this._ax[2];
            const l2 = len3(rx, ry, rz) || 1;
            rx /= l2;
            ry /= l2;
            rz /= l2;
          } else {
            rx = hit.nx;
            ry = hit.ny;
            rz = hit.nz;
          }
          let dx = rx * p.radialBias - baseN[3 * n] * (1 - p.radialBias);
          let dy = ry * p.radialBias - baseN[3 * n + 1] * (1 - p.radialBias);
          let dz = rz * p.radialBias - baseN[3 * n + 2] * (1 - p.radialBias);
          const l = len3(dx, dy, dz) || 1;
          bx = dx / l;
          by = dy / l;
          bz = dz / l;
          wetV = Math.max(wetV, 1 - smoothstep(0, p.falloffDistance * 0.5, Math.max(gap, 0)));
        }
        if (bestAmt <= 0) continue;
        if (p.maxExpansion > 0) bestAmt = Math.min(bestAmt, p.maxExpansion);
        bestAmt *= m;
        f[3 * n] = bx * bestAmt;
        f[3 * n + 1] = by * bestAmt;
        f[3 * n + 2] = bz * bestAmt;
        this.list[cnt++] = n;
        if (wet) wet.node[n] = Math.max(wet.node[n], wetV * p.wetness * m);
      }
      if (p.smoothing > 0 && cnt) sm.topo.blurVec(f, this.list, cnt, Math.round(p.smoothing * q.smoothingScale), this.tmp, 0.5, true);
    }
    const T = this.spring.target;
    for (let i = 0; i < cnt; i++) {
      const n = this.list[i];
      T[3 * n] = f[3 * n];
      T[3 * n + 1] = f[3 * n + 1];
      T[3 * n + 2] = f[3 * n + 2];
      f[3 * n] = 0;
      f[3 * n + 1] = 0;
      f[3 * n + 2] = 0;
    }
    const omega = 2 * Math.PI * 6, zeta = 1 - 0.8 * p.jiggle * (0.3 + 0.7 * this.energy);
    this.spring.step(this.list, cnt, dt, omega, Math.max(zeta, 0.15));
    this.spring.addTo(disp);
  }
};
__publicField(Penetration, "type", "penetration");
__publicField(Penetration, "defaults", {
  expansionStrength: 1,
  falloffDistance: 0.06,
  // на каком расстоянии окружающая плоть раскрывается следом (м)
  softness: 0.5,
  // 0 — тугая кромка у контакта, 1 — широкое плавное раскрытие
  radialBias: 0.75,
  // 1 — радиально от оси, 0 — вдоль нормали поверхности
  maxExpansion: 0.12,
  // предел смещения (м), 0 — без предела
  collisionOffset: 6e-3,
  organicDetail: 0,
  clenchAmount: 0.3,
  clenchSpeed: 3,
  jiggle: 0.4,
  wetness: 0.5,
  // пишет атрибут softfleshWet (0..1), не деформирует
  wetDryTime: 4,
  // секунды высыхания
  smoothing: 3,
  impactSensitivity: 1.5,
  relaxTime: 0.6,
  exactContact: 1,
  minHitSpeed: 0.15
});

// src/effects/SlapWave.js
var SlapWave = class extends ContactEffect {
  init() {
    super.init();
    this.waves = [];
    const M = this.sm.nodeCount;
    this.out = new Float32Array(3 * M);
    this.work = new Int32Array(M);
    this.tmp = new Float32Array(3 * M);
  }
  reset() {
    super.reset();
    if (this.waves) this.waves.length = 0;
  }
  onHit(ev) {
    if (this.params.auto) this.trigger({ point: ev.point, direction: ev.direction, strength: ev.strength });
  }
  // Ручной запуск. direction — направление шлепка в мире (касательная часть станет направлением волны).
  trigger({ point, direction = null, strength = 1 } = {}) {
    const sm = this.sm;
    if (!sm) return;
    const anchor = sm.nearestNode(point);
    const nx = sm.baseN[3 * anchor], ny = sm.baseN[3 * anchor + 1], nz = sm.baseN[3 * anchor + 2];
    let dx, dy, dz;
    if (direction) {
      dx = direction[0] ?? direction.x;
      dy = direction[1] ?? direction.y;
      dz = direction[2] ?? direction.z;
    } else {
      dx = sm.base[3 * anchor] - sm.center.x;
      dy = sm.base[3 * anchor + 1] - sm.center.y;
      dz = sm.base[3 * anchor + 2] - sm.center.z;
    }
    const dn = dx * nx + dy * ny + dz * nz;
    dx -= dn * nx;
    dy -= dn * ny;
    dz -= dn * nz;
    let l = len3(dx, dy, dz);
    const radial = l < 1e-4;
    if (!radial) {
      dx /= l;
      dy /= l;
      dz /= l;
    }
    this.waves.push({ anchor, t: 0, strength, dir: [dx, dy, dz], radial });
    if (this.waves.length > this.params.maxWaves) this.waves.shift();
    this.energy += strength;
    return this;
  }
  hit(point, strength = 1, direction = null) {
    return this.trigger({ point, strength, direction });
  }
  apply(ctx) {
    const p = this.params, sm = this.sm, dt = ctx.dt, q = this.quality;
    if (p.auto) this.gatherContacts(false);
    this.energy *= Math.exp(-dt / Math.max(p.relaxTime, 0.01));
    if (!this.waves.length) return;
    const { base, baseN } = sm;
    const nodes = this.nodeList(), mask = this.maskNodes(), out = this.out, work = this.work;
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => p.speed * w.t < p.range + p.width * 4);
    for (const n of nodes) {
      out[3 * n] = 0;
      out[3 * n + 1] = 0;
      out[3 * n + 2] = 0;
    }
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
        if (w.radial) {
          along = len3(rx, ry, rz);
          lat = 0;
        } else {
          along = rx * dx + ry * dy + rz * dz;
          lat = len3(rx - along * dx, ry - along * dy, rz - along * dz);
          if (along < -p.width * 3) continue;
        }
        const x = (along - s) / p.width;
        if (x > 4 || x < -6) continue;
        let h = Math.exp(-x * x) - p.trough * Math.exp(-((x + 1.8) ** 2));
        h *= A * mask[n];
        if (!w.radial) h *= Math.exp(-((lat / p.lateralWidth) ** 2));
        out[3 * n] += baseN[3 * n] * h;
        out[3 * n + 1] += baseN[3 * n + 1] * h;
        out[3 * n + 2] += baseN[3 * n + 2] * h;
      }
    }
    let wc = 0;
    for (const n of nodes) if (out[3 * n] || out[3 * n + 1] || out[3 * n + 2]) work[wc++] = n;
    if (p.smoothing > 0) sm.topo.blurVec(out, work, wc, Math.round(p.smoothing * q.smoothingScale), this.tmp, 0.5);
    const disp = sm.disp;
    for (let i = 0; i < wc; i++) {
      const n = work[i];
      disp[3 * n] += out[3 * n];
      disp[3 * n + 1] += out[3 * n + 1];
      disp[3 * n + 2] += out[3 * n + 2];
    }
  }
};
__publicField(SlapWave, "type", "slapWave");
__publicField(SlapWave, "defaults", {
  amplitude: 0.012,
  // высота волны (м) для удара 1 м/с
  speed: 1.5,
  // скорость волны, м/с
  width: 0.03,
  // ширина гребня (м)
  range: 0.35,
  // путь волны до затухания (м)
  lateralWidth: 0.2,
  // ширина фронта поперёк направления (м)
  trough: 0.5,
  // глубина ложбины за гребнем (доля)
  relaxTime: 0.4,
  smoothing: 2,
  auto: true,
  // запускать по ударам коллайдеров
  minHitSpeed: 0.5,
  // порог скорости удара для auto (м/с)
  impactSensitivity: 1.5,
  collisionOffset: 15e-4,
  maxWaves: 4,
  exactContact: 0
});

// src/effects/index.js
var EFFECTS = { contact: Contact, squish: Squish, squishInflate: SquishInflate, squishOrganic: SquishOrganic, fatJiggle: FatJiggle, ripple: Ripple, penetration: Penetration, slapWave: SlapWave };
var ALIASES = { fleshy: "contact", "squish&inflate": "squishInflate", squish_inflate: "squishInflate", organic: "squishOrganic", jiggle: "fatJiggle", fat: "fatJiggle", slap: "slapWave", wave: "slapWave" };
function registerEffect(Cls) {
  EFFECTS[Cls.type] = Cls;
  return Cls;
}
function createEffect(type, params = {}, opts = {}) {
  const t = EFFECTS[type] ? type : ALIASES[type] || ALIASES[String(type).toLowerCase()];
  const Cls = EFFECTS[t];
  if (!Cls) throw new Error(`SoftFlesh: неизвестный эффект "${type}". Доступно: ${Object.keys(EFFECTS).join(", ")}`);
  return new Cls(params, opts);
}

// src/presets.js
var PRESETS = {
  pillow: {
    description: "Подушка: чистая вмятина без выпуклости, мягкая воронка вокруг",
    effects: [{ type: "contact", params: { bulge: 0, dent: 60, bulgeWidth: 10, smoothing: 6, selfContact: false } }]
  },
  mattress: {
    description: "Матрас: широкая неглубокая вмятина, лёгкая упругость",
    effects: [{ type: "contact", params: { bulge: 0.2, dent: 50, firmness: 20, bulgeWidth: 20, smoothing: 6, selfContact: false } }]
  },
  cushion: {
    description: "Диванная подушка: сплющивание с небольшим возвратом объёма",
    effects: [{ type: "squish", params: { volumePreservation: 0.3, shapeSmoothing: 8, spread: 12, correctiveSmooth: 6 } }]
  },
  softCharacter: {
    description: "Мягкий персонаж: вмятины и выпуклости от касаний, складки в сгибах, защита у краёв одежды",
    effects: [{ type: "contact", params: { bulge: 1, dent: 15, bulgeWidth: 15, smoothing: 4, cornerTaper: true, closeOpenings: true, selfContact: true } }]
  },
  firmCharacter: {
    description: "Плотный/спортивный персонаж: продавливается меньше",
    effects: [{ type: "contact", params: { bulge: 0.7, dent: 8, firmness: 45, bulgeWidth: 10, cornerTaper: true, closeOpenings: true } }]
  },
  jelly: {
    description: "Желе: сплющивание с раздуванием, долгая тряска, рябь от ударов",
    effects: [
      { type: "squishInflate", params: { volumePreservation: 0.35, inflatePressure: 1 } },
      { type: "fatJiggle", params: { amplitude: 0.5, wobbleSpeed: 2.4, relaxTime: 1.4, decay: 1.6, lateralMotion: 1.2, normalMotion: 0.9, dentDepth: 0 } },
      { type: "ripple", params: { amplitude: 0.02, waveSpeed: 0.8, relaxTime: 0.8, dentDepth: 0 } }
    ]
  },
  ball: {
    description: "Надувной мяч: объём сохраняется, тело раздувается по бокам",
    effects: [{ type: "squishInflate", params: { squishStrength: 1, volumePreservation: 0.15, inflatePressure: 1, shapeSmoothing: 6, spread: 14, correctiveSmooth: 6 } }]
  },
  stressBall: {
    description: "Мячик-антистресс: валик вокруг пальцев, морщины, медленное восстановление",
    effects: [{ type: "squishOrganic", params: { skinTension: 0.7, wrinkleDepth: 0.2, jiggle: 0.15, stiffness: 0.25 } }]
  },
  slime: {
    description: "Слайм: текучее органичное сплющивание и вязкая тряска",
    effects: [
      { type: "squishOrganic", params: { skinTension: 0.4, wrinkleDepth: 0, jiggle: 0.8, stiffness: 0.1, relaxTime: 1.5 } },
      { type: "fatJiggle", params: { amplitude: 0.6, wobbleSpeed: 1.6, relaxTime: 2, dentDepth: 0 } }
    ]
  },
  belly: {
    description: "Живот: сплющивание с раздуванием + тряска при движении",
    effects: [
      { type: "squishInflate", params: {} },
      { type: "fatJiggle", params: { amplitude: 0.3, wobbleSpeed: 3, relaxTime: 0.6, dentDepth: 0 } }
    ]
  },
  glutes: {
    description: "Ягодицы: сплющивание, тряска жира, рябь от шлепка",
    effects: [
      { type: "squish", params: { volumePreservation: 0.7 } },
      { type: "fatJiggle", params: { amplitude: 0.25, wobbleSpeed: 3.8, dentDepth: 0 } },
      { type: "ripple", params: { amplitude: 0.015, fat: true, dentDepth: 0 } }
    ]
  },
  breasts: {
    description: "Грудь: сплющивание с раздуванием, мягкая инерционная тряска",
    effects: [
      { type: "squishInflate", params: { selfCollision: true } },
      { type: "fatJiggle", params: { amplitude: 0.3, wobbleSpeed: 3.2, relaxTime: 0.7, lateralMotion: 0.8, dentDepth: 0 } }
    ]
  },
  waterbed: {
    description: "Водяной матрас: вмятина и долгие волны",
    effects: [
      { type: "contact", params: { bulge: 0.5, dent: 40, selfContact: false } },
      { type: "ripple", params: { amplitude: 0.03, waveSpeed: 1.2, decay: 0.5, relaxTime: 1.5, fat: true, fatAmplitude: 0.015, dentDepth: 0 } }
    ]
  },
  punchingBag: {
    description: "Боксёрская груша / мягкий манекен: вмятина, волна от удара, лёгкая тряска",
    effects: [
      { type: "squish", params: { volumePreservation: 0.5 } },
      { type: "slapWave", params: { amplitude: 0.01, speed: 2 } },
      { type: "fatJiggle", params: { amplitude: 0.12, wobbleSpeed: 4.5, relaxTime: 0.4, dentDepth: 0 } }
    ]
  },
  creature: {
    description: "Мягкое существо: желеобразное тело, давит на другие мягкие тела",
    effects: [
      { type: "squishInflate", params: { volumePreservation: 0.4 } },
      { type: "fatJiggle", params: { amplitude: 0.35, wobbleSpeed: 2.8, relaxTime: 0.9, dentDepth: 0 } }
    ],
    softBody: { yield: 1, volumePreservation: 1 }
  }
};
function registerPreset(name, def) {
  PRESETS[name] = def;
  return def;
}
function getPreset(name) {
  const p = PRESETS[name];
  if (!p) throw new Error(`SoftFlesh: пресет "${name}" не найден. Доступно: ${Object.keys(PRESETS).join(", ")}`);
  return JSON.parse(JSON.stringify(p));
}
function listPresets() {
  return Object.entries(PRESETS).map(([name, p]) => ({ name, description: p.description }));
}

// src/core/SoftMesh.js
var _e = new THREE3.Matrix4();
var _A = new THREE3.Matrix4();
function ensureFloatAttribute(g, name) {
  const a = g.attributes[name];
  if (!a) return null;
  if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized) return a;
  const n = a.count, s = a.itemSize, arr = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[i * s + k] = a.getComponent(i, k);
  const na = new THREE3.BufferAttribute(arr, s);
  g.setAttribute(name, na);
  return na;
}
var SoftMesh = class {
  constructor(world, mesh, opts = {}) {
    this.isSoftMesh = true;
    this.world = world;
    this.mesh = mesh;
    this.name = opts.name || mesh.name || "mesh";
    this.enabled = true;
    this.effects = [];
    this.mode = "live";
    this.bake = null;
    this.bakeTime = 0;
    this.softBody = null;
    if (opts.cloneGeometry !== false) mesh.geometry = mesh.geometry.clone();
    const g = mesh.geometry;
    ensureFloatAttribute(g, "position");
    if (!g.attributes.normal) g.computeVertexNormals();
    ensureFloatAttribute(g, "normal");
    g.attributes.position.setUsage(THREE3.DynamicDrawUsage);
    g.attributes.normal.setUsage(THREE3.DynamicDrawUsage);
    this.restPos = g.attributes.position.array.slice();
    this.restNrm = g.attributes.normal.array.slice();
    if (!g.boundingBox) g.computeBoundingBox();
    const diag = g.boundingBox.getSize(new THREE3.Vector3()).length() || 1;
    const topo = this.topo = new Topology(this.restPos, g.index ? g.index.array : null, opts.weldEpsilon ?? diag * 1e-5);
    const M = this.nodeCount = topo.nodeCount;
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
    this.bmin = new THREE3.Vector3();
    this.bmax = new THREE3.Vector3();
    this.center = new THREE3.Vector3();
    this.radius = 0;
    this.restNodeN = new Float32Array(3 * M);
    topo.computeNormals(topo.nodeRest, this.restNodeN);
    this.localNodePos = topo.nodeRest.slice();
    this.localNodeN = new Float32Array(3 * M);
    this.nodeVerts = this._nodeVerts();
    this.skinned = !!mesh.isSkinnedMesh && !!g.attributes.skinIndex;
    if (this.skinned) {
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      this.skinIdx = new Uint16Array(4 * M);
      this.skinW = new Float32Array(4 * M);
      for (let n = 0; n < M; n++) {
        const v = topo.nodeFirstVert[n];
        for (let k = 0; k < 4; k++) {
          this.skinIdx[4 * n + k] = si.getComponent(v, k);
          this.skinW[4 * n + k] = sw.getComponent(v, k);
        }
      }
      this.T3 = new Float32Array(9 * M);
    }
    this.morphs = [];
    const mp = g.morphAttributes && g.morphAttributes.position;
    if (mp && mp.length) {
      for (const a of mp) {
        const d = new Float32Array(3 * M);
        for (let n = 0; n < M; n++) {
          const v = topo.nodeFirstVert[n];
          d[3 * n] = a.getX(v);
          d[3 * n + 1] = a.getY(v);
          d[3 * n + 2] = a.getZ(v);
        }
        this.morphs.push(d);
      }
      this.morphRelative = g.morphTargetsRelative;
    }
    this._r = topo.nodeRest.slice();
    this.outputs = {};
    this.frameCounter = 0;
    this.exactNodes = null;
    this._exactDirty = true;
    if (g.boundingSphere) g.boundingSphere.radius *= 1.3;
    else {
      g.computeBoundingSphere();
      g.boundingSphere.radius *= 1.3;
    }
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
    if (typeof effect === "string") effect = createEffect(effect, params, opts);
    this.effects.push(effect);
    effect.attach(this);
    this._exactDirty = true;
    return effect;
  }
  removeEffect(effect) {
    const i = this.effects.indexOf(effect);
    if (i >= 0) {
      this.effects.splice(i, 1);
      effect.detach();
      this._exactDirty = true;
    }
  }
  // Пресет: набор эффектов. overrides: { colliders, mask, regions, params: { fatJiggle: {...} }, softBody }
  applyPreset(name, overrides = {}) {
    const p = getPreset(name);
    const out = p.effects.map((e) => this.addEffect(e.type, { ...e.params, ...(overrides.params || {})[e.type] || {} }, { mask: overrides.mask, colliders: overrides.colliders, regions: overrides.regions }));
    if (p.softBody && overrides.softBody !== false && this.world) this.world.softBodies.add(this, { ...p.softBody, ...overrides.softBody || {} });
    return out;
  }
  getEffects(type) {
    return this.effects.filter((e) => e.type === type);
  }
  toJSON() {
    return { name: this.name, effects: this.effects.map((e) => e.toJSON()), softBody: this.softBody ? { ...this.softBody.params, mask: this.softBody.maskSpec.toJSON() } : null };
  }
  getEffect(typeOrName) {
    return this.effects.find((e) => e.type === typeOrName || e.name === typeOrName) || null;
  }
  clearEffects() {
    [...this.effects].forEach((e) => this.removeEffect(e));
  }
  // Создаёт/возвращает выходной атрибут на вершины (itemSize 1) — например 'softfleshWet'.
  output(name) {
    if (!this.outputs[name]) {
      const g = this.mesh.geometry;
      const a = new THREE3.BufferAttribute(new Float32Array(g.attributes.position.count), 1);
      a.setUsage(THREE3.DynamicDrawUsage);
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
        for (let k = 0; k < 16; k++) m[k] = 0;
        for (let j = 0; j < 4; j++) {
          const w = this.skinW[4 * n + j];
          if (!w) continue;
          const o = this.skinIdx[4 * n + j] * 16;
          for (let k = 0; k < 16; k++) m[k] += w * bm[o + k];
        }
        _e.premultiply(_A).multiply(mesh.bindMatrix);
        const x = r[3 * n], y = r[3 * n + 1], z = r[3 * n + 2];
        base[3 * n] = m[0] * x + m[4] * y + m[8] * z + m[12];
        base[3 * n + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        base[3 * n + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const t = 9 * n;
        T[t] = m[0];
        T[t + 1] = m[1];
        T[t + 2] = m[2];
        T[t + 3] = m[4];
        T[t + 4] = m[5];
        T[t + 5] = m[6];
        T[t + 6] = m[8];
        T[t + 7] = m[9];
        T[t + 8] = m[10];
      }
    } else {
      const m = mesh.matrixWorld.elements;
      for (let n = 0; n < M; n++) {
        const x = r[3 * n], y = r[3 * n + 1], z = r[3 * n + 2];
        base[3 * n] = m[0] * x + m[4] * y + m[8] * z + m[12];
        base[3 * n + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        base[3 * n + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      const t = this._T1 = this._T1 || new Float32Array(9);
      t[0] = m[0];
      t[1] = m[1];
      t[2] = m[2];
      t[3] = m[4];
      t[4] = m[5];
      t[5] = m[6];
      t[6] = m[8];
      t[7] = m[9];
      t[8] = m[10];
    }
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let n = 0; n < M; n++) {
      const x = base[3 * n], y = base[3 * n + 1], z = base[3 * n + 2];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    }
    this.bmin.set(x0, y0, z0);
    this.bmax.set(x1, y1, z1);
    this.center.addVectors(this.bmin, this.bmax).multiplyScalar(0.5);
    this.radius = this.bmin.distanceTo(this.bmax) / 2;
    const idt = this._hasPrev && dt > 0 ? 1 / dt : 0;
    const vel = this.vel, pb = this.prevBase;
    let teleport = false;
    for (let i = 0; i < 3 * M; i++) vel[i] = (base[i] - pb[i]) * idt;
    if (idt) {
      const jump = len3(base[0] - pb[0], base[1] - pb[1], base[2] - pb[2]);
      if (jump > this.radius) teleport = true;
    }
    if (teleport) vel.fill(0);
    this.teleported = teleport;
    this._hasPrev = true;
    topo.computeNormals(base, this.baseN);
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
    const cols = /* @__PURE__ */ new Set();
    for (const e of this.effects) {
      if (!e.enabled || !(e.params.exactContact > 0) || e.usesColliders === false) continue;
      e.resolveColliders().forEach((c) => cols.add(c));
      const m = e.maskNodes();
      const o = e.params.collisionOffset ?? 1e-3;
      const h = e.params.contactHardness ?? 1;
      for (let n = 0; n < M; n++) if (m[n] > 0) {
        ex[n] = Math.max(ex[n], e.params.exactContact);
        off[n] = Math.max(off[n], o);
        hard[n] = Math.min(hard[n], h);
      }
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
          const skin = Math.max(off[n], 5e-4);
          if (hit.d >= skin) continue;
          const outward = hit.nx * baseN[3 * n] + hit.ny * baseN[3 * n + 1] + hit.nz * baseN[3 * n + 2];
          if (c.side === "outside" && outward > 0.35) continue;
          const large = smoothstep(0.03, 0.06, c.radius);
          const push = (skin - hit.d) * ex[n] * (1 - large * (1 - this.exactHard[n]) * 0.6);
          disp[3 * n] += hit.nx * push;
          disp[3 * n + 1] += hit.ny * push;
          disp[3 * n + 2] += hit.nz * push;
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
        lp[3 * n] = nr[3 * n];
        lp[3 * n + 1] = nr[3 * n + 1];
        lp[3 * n + 2] = nr[3 * n + 2];
        for (let k = start[n]; k < start[n + 1]; k++) {
          const v = list[k];
          pos[3 * v] = rp[3 * v];
          pos[3 * v + 1] = rp[3 * v + 1];
          pos[3 * v + 2] = rp[3 * v + 2];
        }
        touched[n] = 0;
        dirty[dc++] = n;
      }
    }
    for (let i = 0; i < this.activeCount; i++) {
      const n = this.activeList[i];
      touched[n] = 0;
      lp[3 * n] = nr[3 * n] + off[3 * n];
      lp[3 * n + 1] = nr[3 * n + 1] + off[3 * n + 1];
      lp[3 * n + 2] = nr[3 * n + 2] + off[3 * n + 2];
      for (let k = start[n]; k < start[n + 1]; k++) {
        const v = list[k];
        pos[3 * v] = rp[3 * v] + off[3 * n];
        pos[3 * v + 1] = rp[3 * v + 1] + off[3 * n + 1];
        pos[3 * v + 2] = rp[3 * v + 2] + off[3 * n + 2];
      }
      dirty[dc++] = n;
    }
    if (recomputeNormals && dc) {
      const set = this._nset || (this._nset = new Uint8Array(this.nodeCount));
      const nl = this._nl || (this._nl = new Int32Array(this.nodeCount));
      let nc = 0;
      for (let i = 0; i < dc; i++) {
        const n = dirty[i];
        if (!set[n]) {
          set[n] = 1;
          nl[nc++] = n;
        }
        for (let k = topo.adjStart[n]; k < topo.adjStart[n + 1]; k++) {
          const j = topo.adj[k];
          if (!set[j]) {
            set[j] = 1;
            nl[nc++] = j;
          }
        }
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
          nrm[3 * v] = x / l;
          nrm[3 * v + 1] = y / l;
          nrm[3 * v + 2] = z / l;
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
      if (d < best) {
        best = d;
        bi = n;
      }
    }
    return bi;
  }
  dispose() {
    this.clearEffects();
    this.reset();
    if (this.world) this.world.remove(this);
  }
};

// src/core/SoftBodyGroup.js
var softBodyDefaults = {
  yield: 1,
  // насколько тело мягче других (0 — жёсткое)
  cushion: 3e-3,
  // мягкое начало контакта (м)
  skinGap: 5e-4,
  // зазор между кожами
  volumePreservation: 1,
  bulgeSpread: 0.06,
  // как далеко расходится выпуклость (м)
  bulgeFocus: 4,
  // 0 — тело раздувается равномерно
  smoothing: 3,
  mask: null
};
var SoftBodyGroup = class {
  constructor(world) {
    this.world = world;
    this.members = [];
    this.enabled = true;
    this._frame = -1;
  }
  add(sm, params = {}) {
    if (sm.isSoftModel) {
      sm.meshes.forEach((m) => this.add(m, params));
      return this;
    }
    if (this.members.some((m) => m.sm === sm)) return this.set(sm, params);
    const member = { sm, params: { ...softBodyDefaults, ...params }, mask: null, solver: null, hash: null };
    member.maskSpec = Mask.from(member.params.mask);
    sm.softBody = member;
    this.members.push(member);
    return this;
  }
  set(sm, params) {
    const m = this.members.find((x) => x.sm === sm);
    if (m) {
      Object.assign(m.params, params);
      if (params.mask !== void 0) {
        m.maskSpec = Mask.from(params.mask);
        m.mask = null;
      }
    }
    return this;
  }
  remove(sm) {
    const i = this.members.findIndex((m) => m.sm === sm);
    if (i >= 0) {
      this.members[i].sm.softBody = null;
      this.members.splice(i, 1);
    }
    return this;
  }
  get count() {
    return this.members.length;
  }
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
    const act = this.members.filter((m) => m.sm.enabled && m.sm.mode === "live");
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
    if (!B._hashed) {
      B.hash.build(smB.base, null, smB.nodeCount, cell);
      B._hashed = true;
      B._cell = cell;
    }
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
      B.hash.query(x, y, z, R, (j, d2) => {
        if (d2 < bd) {
          bd = d2;
          best = j;
        }
      });
      if (best < 0) continue;
      const nx = nb[3 * best], ny = nb[3 * best + 1], nz = nb[3 * best + 2];
      const s = (x - pb[3 * best]) * nx + (y - pb[3 * best + 1]) * ny + (z - pb[3 * best + 2]) * nz;
      if (s >= thr) continue;
      const xx = thr - s;
      const pen = xx > 2 * cush ? xx - cush : xx * xx / (4 * cush);
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
          wi = m.mask[n] * (p.bulgeFocus > 0 ? Math.exp(-p.bulgeFocus * d / p.bulgeSpread) * (1 - smoothstep(0.7 * p.bulgeSpread, p.bulgeSpread, d)) : 1);
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
          const h = Math.min(V * w[i] / sum, maxH);
          f[3 * n] += baseN[3 * n] * h;
          f[3 * n + 1] += baseN[3 * n + 1] * h;
          f[3 * n + 2] += baseN[3 * n + 2] * h;
        }
      }
    }
    s.smooth(p.smoothing * q.smoothingScale);
    s.commit();
  }
  toJSON() {
    return this.members.map((m) => ({ mesh: m.sm.name, params: { ...m.params, mask: m.maskSpec.toJSON() } }));
  }
};

// src/core/Bake.js
import * as THREE4 from "three";
function b64(buf) {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
  return btoa(s);
}
function unb64(str, Type) {
  let u8;
  if (typeof Buffer !== "undefined") u8 = new Uint8Array(Buffer.from(str, "base64"));
  else {
    const s = atob(str);
    u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  }
  return new Type(u8.buffer, 0, u8.byteLength / Type.BYTES_PER_ELEMENT);
}
var SoftFleshBake = class _SoftFleshBake {
  constructor({ fps = 30, tracks = [], loop = true } = {}) {
    this.isSoftFleshBake = true;
    this.fps = fps;
    this.tracks = tracks;
    this.loop = loop;
  }
  get frameCount() {
    return this.tracks.length ? this.tracks[0].frames.length : 0;
  }
  get duration() {
    return this.frameCount / this.fps;
  }
  // Запись: onFrame(i, dt, t) — продвиньте свою анимацию (mixer.update(dt), движение коллайдеров).
  static record(world, opts = {}) {
    const fps = opts.fps ?? 30, frames = opts.frames ?? Math.round((opts.duration ?? 2) * fps), dt = 1 / fps;
    const list = (opts.meshes || world.meshes).flatMap((m) => m.isSoftModel ? m.meshes : [m]);
    const tracks = list.map((sm) => ({ name: sm.name, sm, nodeCount: sm.nodeCount, frames: [] }));
    const warm = opts.warmup ?? 0;
    for (let i = 0; i < warm; i++) {
      opts.onFrame && opts.onFrame(-1, dt, 0);
      world.update(dt, { force: true });
    }
    for (let f = 0; f < frames; f++) {
      if (opts.onFrame) opts.onFrame(f, dt, f * dt);
      world.update(dt, { force: true });
      for (const tr of tracks) {
        const sm = tr.sm, c = sm.activeCount;
        const idx = new Uint32Array(c), val = new Float32Array(3 * c);
        for (let i = 0; i < c; i++) {
          const n = sm.activeList[i];
          idx[i] = n;
          val[3 * i] = sm.localOff[3 * n];
          val[3 * i + 1] = sm.localOff[3 * n + 1];
          val[3 * i + 2] = sm.localOff[3 * n + 2];
        }
        tr.frames.push({ idx, val });
      }
      if (opts.onProgress) opts.onProgress((f + 1) / frames);
    }
    const bake = new _SoftFleshBake({ fps, tracks, loop: opts.loop !== false });
    if (opts.smoothPops !== false) bake.smoothPops(opts.popThreshold);
    return bake;
  }
  // Сглаживание «щелчков»: кадр, резко выбивающийся из соседей, заменяется средним.
  smoothPops(threshold) {
    for (const tr of this.tracks) {
      const M = tr.nodeCount, F = tr.frames.length;
      if (F < 3) continue;
      const th = threshold ?? (tr.sm ? tr.sm.topo.meanEdge * 0.35 : 2e-3);
      const dense = [0, 1, 2].map(() => new Float32Array(3 * M));
      const fill = (arr, fr) => {
        arr.fill(0);
        for (let i = 0; i < fr.idx.length; i++) {
          const n = fr.idx[i];
          arr[3 * n] = fr.val[3 * i];
          arr[3 * n + 1] = fr.val[3 * i + 1];
          arr[3 * n + 2] = fr.val[3 * i + 2];
        }
      };
      fill(dense[0], tr.frames[0]);
      fill(dense[1], tr.frames[1]);
      for (let f = 1; f < F - 1; f++) {
        const prev = dense[(f - 1) % 3], cur = dense[f % 3], next = dense[(f + 1) % 3];
        fill(next, tr.frames[f + 1]);
        let changed = false;
        for (let n = 0; n < M; n++) {
          const i = 3 * n;
          const ax = (prev[i] + next[i]) / 2, ay = (prev[i + 1] + next[i + 1]) / 2, az = (prev[i + 2] + next[i + 2]) / 2;
          const dx = cur[i] - ax, dy = cur[i + 1] - ay, dz = cur[i + 2] - az;
          const jump = len3(dx, dy, dz);
          const span = len3(next[i] - prev[i], next[i + 1] - prev[i + 1], next[i + 2] - prev[i + 2]);
          if (jump > th && jump > span) {
            cur[i] = ax;
            cur[i + 1] = ay;
            cur[i + 2] = az;
            changed = true;
          }
        }
        if (changed) {
          const idx = [], val = [];
          for (let n = 0; n < M; n++) if (cur[3 * n] || cur[3 * n + 1] || cur[3 * n + 2]) {
            idx.push(n);
            val.push(cur[3 * n], cur[3 * n + 1], cur[3 * n + 2]);
          }
          tr.frames[f] = { idx: Uint32Array.from(idx), val: Float32Array.from(val) };
        }
      }
    }
    return this;
  }
  _frameAt(time) {
    let x = time * this.fps;
    const F = this.frameCount;
    if (this.loop) x = (x % F + F) % F;
    else x = Math.min(Math.max(x, 0), F - 1);
    const a = Math.floor(x), b = this.loop ? (a + 1) % F : Math.min(a + 1, F - 1);
    return [a, b, x - a];
  }
  // Применить запечённую деформацию к SoftMesh (по имени трека) на момент time (сек).
  applyTo(sm, time, track = null) {
    const tr = track || this.tracks.find((t2) => t2.sm === sm) || this.tracks.find((t2) => t2.name === sm.name);
    if (!tr || !this.frameCount) return false;
    if (tr.nodeCount !== sm.nodeCount) {
      console.warn("SoftFlesh: запекание не подходит к мешу " + sm.name);
      return false;
    }
    const [a, b, t] = this._frameAt(time);
    const off = sm.localOff, mark = sm._bakeMark || (sm._bakeMark = new Int32Array(sm.nodeCount)), st = sm._bakeStamp = (sm._bakeStamp || 0) + 1;
    let cnt = 0;
    const put = (fr, w) => {
      for (let i = 0; i < fr.idx.length; i++) {
        const n = fr.idx[i];
        if (mark[n] !== st) {
          mark[n] = st;
          off[3 * n] = 0;
          off[3 * n + 1] = 0;
          off[3 * n + 2] = 0;
          sm.activeList[cnt++] = n;
        }
        off[3 * n] += fr.val[3 * i] * w;
        off[3 * n + 1] += fr.val[3 * i + 1] * w;
        off[3 * n + 2] += fr.val[3 * i + 2] * w;
      }
    };
    put(tr.frames[a], 1 - t);
    if (t > 0) put(tr.frames[b], t);
    sm.activeCount = cnt;
    sm._writeLocal(true);
    return true;
  }
  apply(target, time) {
    const list = target.meshes ? target.meshes : target.isSoftModel ? target.meshes : [target];
    list.forEach((sm) => this.applyTo(sm, time));
  }
  // Морф-таргеты + AnimationClip: деформация проигрывается штатным AnimationMixer, без SoftFlesh в рантайме.
  // step — брать каждый N-й кадр. Перед использованием отключите эффекты меша (или world.remove(sm)).
  toAnimationClip(sm, { step = 2, name = "SoftFleshBake", trackPrefix = "" } = {}) {
    const tr = this.tracks.find((t) => t.sm === sm) || this.tracks.find((t) => t.name === sm.name);
    if (!tr) throw new Error("SoftFlesh: нет трека для " + sm.name);
    const g = sm.mesh.geometry, V = g.attributes.position.count, v2n = sm.topo.vertToNode;
    if (!g.morphAttributes.position) {
      g.morphAttributes.position = [];
      g.morphTargetsRelative = true;
    }
    const relative = g.morphTargetsRelative;
    const startIdx = g.morphAttributes.position.length;
    const times = [];
    for (let f = 0; f < tr.frames.length; f += step) {
      const fr = tr.frames[f], dense = new Float32Array(3 * sm.nodeCount);
      for (let i = 0; i < fr.idx.length; i++) {
        const n = fr.idx[i];
        dense[3 * n] = fr.val[3 * i];
        dense[3 * n + 1] = fr.val[3 * i + 1];
        dense[3 * n + 2] = fr.val[3 * i + 2];
      }
      const arr = new Float32Array(3 * V);
      for (let v = 0; v < V; v++) {
        const n = v2n[v];
        arr[3 * v] = dense[3 * n] + (relative ? 0 : sm.restPos[3 * v]);
        arr[3 * v + 1] = dense[3 * n + 1] + (relative ? 0 : sm.restPos[3 * v + 1]);
        arr[3 * v + 2] = dense[3 * n + 2] + (relative ? 0 : sm.restPos[3 * v + 2]);
      }
      const attr = new THREE4.Float32BufferAttribute(arr, 3);
      attr.name = `softflesh_${f}`;
      g.morphAttributes.position.push(attr);
      times.push(f / this.fps);
    }
    sm.mesh.updateMorphTargets();
    const tracks = [];
    const K = times.length, end = tr.frames.length / this.fps;
    for (let k = 0; k < K; k++) {
      const t = [], v = [];
      if (k > 0) {
        t.push(0, times[k - 1]);
        v.push(0, 0);
      }
      t.push(times[k]);
      v.push(1);
      if (k < K - 1) {
        t.push(times[k + 1], end);
        v.push(0, 0);
      } else if (times[k] < end) {
        t.push(end);
        v.push(this.loop ? 0 : 1);
      }
      const ut = [], uv = [];
      t.forEach((x, i) => {
        if (!ut.length || x > ut[ut.length - 1]) {
          ut.push(x);
          uv.push(v[i]);
        }
      });
      tracks.push(new THREE4.NumberKeyframeTrack(`${trackPrefix}.morphTargetInfluences[${startIdx + k}]`, ut, uv));
    }
    return new THREE4.AnimationClip(name, end, tracks);
  }
  toJSON() {
    return {
      format: "softflesh-bake",
      version: 1,
      fps: this.fps,
      loop: this.loop,
      tracks: this.tracks.map((t) => ({
        name: t.name,
        nodeCount: t.nodeCount,
        frames: t.frames.map((f) => ({ i: b64(f.idx), v: b64(f.val) }))
      }))
    };
  }
  static fromJSON(j) {
    if (typeof j === "string") j = JSON.parse(j);
    return new _SoftFleshBake({
      fps: j.fps,
      loop: j.loop,
      tracks: j.tracks.map((t) => ({ name: t.name, nodeCount: t.nodeCount, frames: t.frames.map((f) => ({ idx: unb64(f.i, Uint32Array), val: unb64(f.v, Float32Array) })) }))
    });
  }
};

// src/core/Quality.js
var QUALITY = {
  low: { level: "low", smoothingScale: 0.5, maxRings: 10, selfContact: false, selfContactEvery: 4, jiggleRate: 60, updateEvery: 2, normals: true },
  medium: { level: "medium", smoothingScale: 0.75, maxRings: 16, selfContact: true, selfContactEvery: 3, jiggleRate: 90, updateEvery: 1, normals: true },
  high: { level: "high", smoothingScale: 1, maxRings: 24, selfContact: true, selfContactEvery: 2, jiggleRate: 120, updateEvery: 1, normals: true },
  ultra: { level: "ultra", smoothingScale: 1.25, maxRings: 32, selfContact: true, selfContactEvery: 1, jiggleRate: 180, updateEvery: 1, normals: true }
};
var QUALITY_ORDER = ["low", "medium", "high", "ultra"];
function detectQuality() {
  if (typeof navigator === "undefined") return "high";
  const ua = navigator.userAgent || "";
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile) return cores >= 8 ? "medium" : "low";
  return cores >= 8 ? "high" : "medium";
}
function resolveQuality(q) {
  if (q && typeof q === "object") return { ...QUALITY[q.level || "high"], ...q };
  const name = !q || q === "auto" ? detectQuality() : q;
  if (!QUALITY[name]) throw new Error("SoftFlesh: неизвестное качество " + q);
  return { ...QUALITY[name] };
}

// src/colliders/factory.js
import * as THREE6 from "three";

// src/colliders/MeshCollider.js
import * as THREE5 from "three";
var MeshCollider = class extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = "mesh";
    const geo = opts.geometry || opts.object && opts.object.geometry;
    if (!geo) throw new Error("SoftFlesh: MeshCollider требует geometry или object с geometry");
    this.reach = opts.reach ?? null;
    this._build(geo);
  }
  _build(geo) {
    const pa = geo.attributes.position;
    const V = pa.count;
    const p = new Float32Array(3 * V);
    for (let i = 0; i < V; i++) {
      p[3 * i] = pa.getX(i);
      p[3 * i + 1] = pa.getY(i);
      p[3 * i + 2] = pa.getZ(i);
    }
    const idx = geo.index ? Array.from(geo.index.array) : Array.from({ length: V }, (_, i) => i);
    this.p = p;
    this.t = Int32Array.from(idx);
    const T = this.t.length / 3;
    const n = new Float32Array(3 * V);
    const key = (i) => `${Math.round(p[3 * i] * 1e5)},${Math.round(p[3 * i + 1] * 1e5)},${Math.round(p[3 * i + 2] * 1e5)}`;
    const weld = /* @__PURE__ */ new Map();
    const w = new Int32Array(V);
    for (let i = 0; i < V; i++) {
      const k = key(i);
      if (!weld.has(k)) weld.set(k, i);
      w[i] = weld.get(k);
    }
    this.fn = new Float32Array(3 * T);
    for (let t = 0; t < T; t++) {
      const a = this.t[3 * t], b = this.t[3 * t + 1], c = this.t[3 * t + 2];
      const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
      const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const l = len3(cx, cy, cz) || 1;
      this.fn[3 * t] = cx / l;
      this.fn[3 * t + 1] = cy / l;
      this.fn[3 * t + 2] = cz / l;
      for (const v of [a, b, c]) {
        n[3 * w[v]] += cx;
        n[3 * w[v] + 1] += cy;
        n[3 * w[v] + 2] += cz;
      }
    }
    for (let i = 0; i < V; i++) {
      const r = w[i];
      const l = len3(n[3 * r], n[3 * r + 1], n[3 * r + 2]) || 1;
      n[3 * i] = n[3 * r] / l;
      n[3 * i + 1] = n[3 * r + 1] / l;
      n[3 * i + 2] = n[3 * r + 2] / l;
    }
    this.vn = n;
    const box = new THREE5.Box3().setFromBufferAttribute(pa);
    this.box = box;
    const size = box.getSize(new THREE5.Vector3());
    const diag = size.length() || 1;
    this._lr = Math.max(box.min.length(), box.max.length());
    if (this.reach == null) this.reach = diag * 0.5;
    const res = Math.max(4, Math.min(48, Math.round(Math.cbrt(T) * 1.5)));
    this.cell = diag / res;
    this.min = box.min.clone().subScalar(this.cell * 0.5);
    this.dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((size.getComponent(k) + this.cell) / this.cell)));
    const cells = /* @__PURE__ */ new Map();
    for (let t = 0; t < T; t++) {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const v = this.t[3 * t + k];
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], p[3 * v + a]);
          hi[a] = Math.max(hi[a], p[3 * v + a]);
        }
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
  localRadius() {
    return this._lr;
  }
  _closestOnTri(px, py, pz, t, out) {
    const p = this.p, i = this.t;
    const a = 3 * i[3 * t], b = 3 * i[3 * t + 1], c = 3 * i[3 * t + 2];
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const abx = p[b] - ax, aby = p[b + 1] - ay, abz = p[b + 2] - az;
    const acx = p[c] - ax, acy = p[c + 1] - ay, acz = p[c + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let u, v, w;
    if (d1 <= 0 && d2 <= 0) {
      u = 1;
      v = 0;
      w = 0;
    } else {
      const bpx = px - p[b], bpy = py - p[b + 1], bpz = pz - p[b + 2];
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = px - p[c], cpy = py - p[c + 1], cpz = pz - p[c + 2];
      const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) {
        u = 0;
        v = 1;
        w = 0;
      } else if (d6 >= 0 && d5 <= d6) {
        u = 0;
        v = 0;
        w = 1;
      } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const s = d1 / (d1 - d3);
        u = 1 - s;
        v = s;
        w = 0;
      } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const s = d2 / (d2 - d6);
        u = 1 - s;
        v = 0;
        w = s;
      } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const s = (d4 - d3) / (d4 - d3 + (d5 - d6));
        u = 0;
        v = 1 - s;
        w = s;
      } else {
        const den = 1 / (va + vb + vc);
        v = vb * den;
        w = vc * den;
        u = 1 - v - w;
      }
    }
    out[0] = ax + abx * v + acx * w;
    out[1] = ay + aby * v + acy * w;
    out[2] = az + abz * v + acz * w;
    out[3] = u;
    out[4] = v;
    out[5] = w;
  }
  localSdf(x, y, z, out) {
    const cell = this.cell, d = this.dims;
    const cx = Math.floor((x - this.min.x) / cell), cy = Math.floor((y - this.min.y) / cell), cz = Math.floor((z - this.min.z) / cell);
    const maxShell = Math.ceil(this.reach / cell) + 1;
    let best = Infinity, bt = -1;
    const tmp = this._tmp || (this._tmp = new Float32Array(6));
    const bestP = this._bp || (this._bp = new Float32Array(6));
    const seen = this._seen || (this._seen = /* @__PURE__ */ new Set());
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
          if (dd < best) {
            best = dd;
            bt = t;
            bestP.set(tmp);
          }
        }
      }
      if (bt >= 0 && Math.sqrt(best) <= s * cell) break;
    }
    if (bt < 0) {
      out.d = 1e3;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      return;
    }
    const i = this.t, n = this.vn;
    const a = 3 * i[3 * bt], b = 3 * i[3 * bt + 1], c = 3 * i[3 * bt + 2];
    const nx = n[a] * bestP[3] + n[b] * bestP[4] + n[c] * bestP[5];
    const ny = n[a + 1] * bestP[3] + n[b + 1] * bestP[4] + n[c + 1] * bestP[5];
    const nz = n[a + 2] * bestP[3] + n[b + 2] * bestP[4] + n[c + 2] * bestP[5];
    const dx = x - bestP[0], dy = y - bestP[1], dz = z - bestP[2];
    const dist = Math.sqrt(best);
    const sign = dx * nx + dy * ny + dz * nz < 0 ? -1 : 1;
    out.d = sign * dist;
    if (dist > 1e-7) {
      out.nx = sign * dx / dist;
      out.ny = sign * dy / dist;
      out.nz = sign * dz / dist;
    } else {
      const l = len3(nx, ny, nz) || 1;
      out.nx = nx / l;
      out.ny = ny / l;
      out.nz = nz / l;
    }
  }
};

// src/colliders/factory.js
var ColliderGroup = class {
  constructor(name = "", colliders = []) {
    this.isColliderGroup = true;
    this.name = name;
    this.items = [];
    colliders.forEach((c) => this.add(c));
  }
  add(c) {
    const col = toCollider(c);
    if (!this.items.includes(col)) this.items.push(col);
    return col;
  }
  remove(c) {
    const i = this.items.findIndex((x) => x === c || x.object === c);
    if (i >= 0) this.items.splice(i, 1);
  }
  clear() {
    this.items.length = 0;
  }
  get size() {
    return this.items.length;
  }
};
function colliderFromObject(object, opts = {}) {
  if (object instanceof Collider) return object;
  const ud = object.userData && object.userData.softCollider || null;
  const shape = opts.shape || (typeof ud === "string" ? ud : "auto");
  const g = object.geometry;
  const margin = opts.margin || 0;
  const base = { object, name: object.name, firmness: opts.firmness, side: opts.side };
  if (shape === "mesh") return new MeshCollider({ ...base, geometry: g, reach: opts.reach });
  const p = g && g.parameters ? g.parameters : {};
  const t = g ? g.type : "";
  if (shape === "auto") {
    if (t === "SphereGeometry" || t === "IcosahedronGeometry" || t === "OctahedronGeometry") return new SphereCollider({ ...base, radius: (p.radius ?? 1) + margin });
    if (t === "CapsuleGeometry") return new CapsuleCollider({ ...base, radius: p.radius + margin, height: p.length ?? p.height });
    if (t === "BoxGeometry") return new BoxCollider({ ...base, size: [p.width + 2 * margin, p.height + 2 * margin, p.depth + 2 * margin], rounding: Math.max(margin, 2e-3) });
    if (t === "PlaneGeometry") return new PlaneCollider({ ...base, size: [p.width, p.height], offsetMatrix: new THREE6.Matrix4().makeRotationX(Math.PI / 2) });
    if (g && g.attributes.position.count <= 4e3) return new MeshCollider({ ...base, geometry: g, reach: opts.reach });
  }
  if (!g) throw new Error("SoftFlesh: у объекта нет геометрии для коллайдера");
  if (!g.boundingBox) g.computeBoundingBox();
  const box = g.boundingBox;
  const size = box.getSize(new THREE6.Vector3());
  const c = box.getCenter(new THREE6.Vector3());
  const off = new THREE6.Matrix4().makeTranslation(c.x, c.y, c.z);
  if (shape === "sphere" || shape === "auto") {
    return new SphereCollider({ ...base, radius: Math.max(size.x, size.y, size.z) / 2 + margin, offsetMatrix: off });
  }
  if (shape === "box") return new BoxCollider({ ...base, size: [size.x + 2 * margin, size.y + 2 * margin, size.z + 2 * margin], offsetMatrix: off });
  const axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  const len = size[axis];
  const r = (axis === "x" ? Math.max(size.y, size.z) : axis === "y" ? Math.max(size.x, size.z) : Math.max(size.x, size.y)) / 2 + margin;
  const h = Math.max(0, len - 2 * r) / 2;
  const a = [0, 0, 0], b = [0, 0, 0];
  const ai = { x: 0, y: 1, z: 2 }[axis];
  a[ai] = -h;
  b[ai] = h;
  return new CapsuleCollider({ ...base, radius: r, start: a, end: b, offsetMatrix: off });
}
function toCollider(x) {
  if (x instanceof Collider) return x;
  if (x && x.isObject3D) return colliderFromObject(x);
  if (x && typeof x === "object" && x.type) return colliderFromJSON(x);
  throw new Error("SoftFlesh: не удалось создать коллайдер из " + x);
}
function colliderFromJSON(j, root = null) {
  const object = j.object && root ? root.getObjectByName(j.object) : j.objectRef || null;
  const o = { ...j, object };
  switch (j.type) {
    case "sphere":
      return new SphereCollider(o);
    case "capsule":
      return new CapsuleCollider(o);
    case "box":
      return new BoxCollider(o);
    case "plane":
      return new PlaneCollider(o);
    case "mesh":
      if (object) return new MeshCollider(o);
      break;
  }
  throw new Error("SoftFlesh: неизвестный коллайдер " + j.type);
}
function collidersFromSkeleton(source, opts = {}) {
  const skeleton = source.isSkinnedMesh ? source.skeleton : source.isSkeleton ? source : null;
  const bones = skeleton ? skeleton.bones : [];
  if (!skeleton) source.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  let want = opts.bones;
  if (Array.isArray(want) && opts.mirror) {
    const extra = [];
    for (const n of want) {
      const m = n.replace(/([._-])(L|R|l|r|Left|Right)$/, (s, sep, side) => sep + { L: "R", R: "L", l: "r", r: "l", Left: "Right", Right: "Left" }[side]);
      if (m !== n) extra.push(m);
    }
    want = [...want, ...extra];
  }
  const pick = typeof want === "function" ? want : Array.isArray(want) ? (b) => want.includes(b.name) : () => true;
  const group = new ColliderGroup(opts.name || "bones");
  const mul = opts.radiusMultiplier ?? 1;
  const margin = opts.margin ?? 2e-3;
  for (const bone of bones) {
    if (!pick(bone)) continue;
    const child = bone.children.find((c) => c.isBone);
    const end = child ? child.position.clone() : new THREE6.Vector3(0, opts.tipLength ?? 0.03, 0);
    const len = end.length();
    if (len < (opts.minLength ?? 1e-4)) continue;
    bone.updateWorldMatrix(true, false);
    const ws = bone.getWorldScale(new THREE6.Vector3());
    const s = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;
    const rWorld = typeof opts.radius === "function" ? opts.radius(bone, len * s) : opts.radius ?? len * s * 0.22;
    const radius = (rWorld * mul + margin) / s;
    const col = new CapsuleCollider({ object: bone, name: "COL_" + bone.name, radius, start: [0, 0, 0], end: end.toArray(), firmness: opts.firmness });
    col.bone = bone;
    group.add(col);
  }
  return group;
}

// src/SoftFlesh.js
var VERSION = "1.0.0";
var SoftModel = class {
  constructor(meshes) {
    this.isSoftModel = true;
    this.meshes = meshes;
  }
  addEffect(type, params, opts) {
    return this.meshes.map((m) => m.addEffect(type, params, opts));
  }
  applyPreset(name, o) {
    return this.meshes.flatMap((m) => m.applyPreset(name, o));
  }
  get effects() {
    return this.meshes.flatMap((m) => m.effects);
  }
  getEffects(type) {
    return this.effects.filter((e) => e.type === type);
  }
  set(type, params) {
    this.getEffects(type).forEach((e) => e.set(params));
    return this;
  }
  enable(on = true) {
    this.meshes.forEach((m) => {
      m.enabled = on;
      if (!on) m.reset();
    });
    return this;
  }
  reset() {
    this.meshes.forEach((m) => m.reset());
  }
  find(name) {
    return this.meshes.find((m) => m.name === name || m.mesh.name === name) || null;
  }
  toJSON() {
    return this.meshes.map((m) => m.toJSON());
  }
};
var SoftFlesh = class {
  constructor(opts = {}) {
    this.quality = resolveQuality(opts.quality ?? "auto");
    this._baseQuality = this.quality.level;
    this.adaptive = opts.adaptive ?? false;
    this.budgetMs = opts.budgetMs ?? 4;
    this.maxDt = opts.maxDt ?? 1 / 20;
    this.autoUpdateMatrices = opts.autoUpdateMatrices !== false;
    this.meshes = [];
    this.colliders = new ColliderGroup("default");
    this.softBodies = new SoftBodyGroup(this);
    this.time = 0;
    this.frame = 0;
    this.paused = false;
    this.stats = { ms: 0, avgMs: 0, meshes: 0, activeNodes: 0 };
    this._listeners = {};
    this._colCache = /* @__PURE__ */ new WeakMap();
    this._accum = 0;
    this._slow = 0;
    this._fast = 0;
    this._bakeClock = 0;
  }
  // ---------- меши ----------
  // add(meshOrScene, { preset | effect + params | effects:[...], colliders, mask, regions, softBody, meshFilter })
  add(object, opts = {}) {
    const meshes = [];
    if (object.isMesh) meshes.push(object);
    else object.traverse((o) => {
      if (o.isMesh && (!opts.meshFilter || opts.meshFilter(o))) meshes.push(o);
    });
    if (!meshes.length) throw new Error("SoftFlesh: в объекте нет мешей");
    const list = meshes.map((mesh) => {
      let sm = this.meshes.find((m) => m.mesh === mesh);
      if (!sm) {
        sm = new SoftMesh(this, mesh, opts);
        this.meshes.push(sm);
      }
      const eo = { mask: opts.mask, colliders: opts.colliders, regions: opts.regions };
      if (opts.preset) sm.applyPreset(opts.preset, { ...eo, params: opts.presetParams, softBody: opts.softBody });
      if (opts.effect) sm.addEffect(opts.effect, opts.params || {}, eo);
      if (opts.effects) for (const e of opts.effects) sm.addEffect(e.type, e.params || {}, { ...eo, ...e });
      if (opts.softBody) this.softBodies.add(sm, opts.softBody === true ? {} : opts.softBody);
      return sm;
    });
    return list.length === 1 ? list[0] : new SoftModel(list);
  }
  remove(target) {
    const list = target.isSoftModel ? target.meshes : [target.isSoftMesh ? target : this.get(target)].filter(Boolean);
    for (const sm of list) {
      const i = this.meshes.indexOf(sm);
      if (i < 0) continue;
      this.meshes.splice(i, 1);
      this.softBodies.remove(sm);
      sm.reset();
      sm.world = null;
    }
  }
  get(meshOrName) {
    return this.meshes.find((m) => m.mesh === meshOrName || m.name === meshOrName) || null;
  }
  // ---------- коллайдеры ----------
  addCollider(x, opts = {}) {
    let c;
    if (x instanceof Collider) c = x;
    else if (x && x.isObject3D) {
      c = this._colCache.get(x);
      if (!c) {
        c = colliderFromObject(x, opts);
        this._colCache.set(x, c);
      }
    } else c = toCollider(x);
    this.colliders.add(c);
    return c;
  }
  removeCollider(x) {
    this.colliders.remove(this._colCache.get(x) || x);
  }
  colliderFor(obj) {
    let c = this._colCache.get(obj);
    if (!c) {
      c = colliderFromObject(obj);
      this._colCache.set(obj, c);
    }
    return c;
  }
  createEffect(type, params, opts) {
    return createEffect(type, params, opts);
  }
  // ---------- события ----------
  on(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const l = this._listeners[type];
    if (l) this._listeners[type] = l.filter((f) => f !== fn);
  }
  emit(type, ev) {
    const l = this._listeners[type];
    if (l) for (const f of l) f(ev);
  }
  setQuality(q) {
    this.quality = resolveQuality(q);
    this._baseQuality = this.quality.level;
    return this;
  }
  // ---------- кадр ----------
  update(dt, { force = false } = {}) {
    if (this.paused && !force) return;
    dt = Math.min(Math.max(dt || 0, 0), this.maxDt);
    this.frame++;
    this._accum += dt;
    const q = this.quality;
    if (!force && q.updateEvery > 1 && this.frame % q.updateEvery !== 0) return;
    const step = Math.min(this._accum, this.maxDt * 2);
    this._accum = 0;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.time += step;
    this._bakeClock += step;
    if (this.autoUpdateMatrices) {
      const roots = /* @__PURE__ */ new Set();
      for (const sm of this.meshes) if (sm.enabled) {
        let r = sm.mesh;
        while (r.parent) r = r.parent;
        roots.add(r);
      }
      roots.forEach((r) => r.updateMatrixWorld());
    }
    const cols = new Set(this.colliders.items);
    for (const sm of this.meshes) for (const e of sm.effects) if (e.enabled) e.resolveColliders().forEach((c) => cols.add(c));
    cols.forEach((c) => c.update(step, this.frame));
    const ctx = { dt: step, time: this.time, world: this };
    let active = 0;
    const live = [];
    for (const sm of this.meshes) {
      if (!sm.enabled) continue;
      if (sm.mode === "baked" && sm.bake) {
        const t = sm.bakeTimeSource ? sm.bakeTimeSource() : this._bakeClock * (sm.bakeSpeed ?? 1);
        sm.bake.applyTo(sm, t);
        continue;
      }
      sm.computeBase(step);
      sm.disp.fill(0);
      for (const e of sm.effects) if (e.enabled) e.apply(ctx);
      live.push(sm);
    }
    this.softBodies.apply(ctx);
    for (const sm of live) {
      sm.finalExact();
      sm.writeBack(q.normals);
      active += sm.activeCount;
    }
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    this.stats.ms = ms;
    this.stats.avgMs = this.stats.avgMs * 0.95 + ms * 0.05;
    this.stats.meshes = this.meshes.length;
    this.stats.activeNodes = active;
    if (this.adaptive) this._adapt();
  }
  _adapt() {
    const i = QUALITY_ORDER.indexOf(this.quality.level);
    if (this.stats.avgMs > this.budgetMs) {
      if (++this._slow > 30 && i > 0) {
        this.quality = { ...QUALITY[QUALITY_ORDER[i - 1]] };
        this._slow = 0;
        this.emit("quality", this.quality);
      }
    } else this._slow = 0;
    if (this.stats.avgMs < this.budgetMs * 0.35) {
      if (++this._fast > 180 && i < QUALITY_ORDER.indexOf(this._baseQuality)) {
        this.quality = { ...QUALITY[QUALITY_ORDER[i + 1]] };
        this._fast = 0;
        this.emit("quality", this.quality);
      }
    } else this._fast = 0;
  }
  reset() {
    this.meshes.forEach((m) => m.reset());
  }
  // ---------- запекание ----------
  bake(opts = {}) {
    return SoftFleshBake.record(this, opts);
  }
  // Проигрывать запекание вместо расчёта. opts: { meshes, speed, timeSource: () => action.time }
  playBake(bake, opts = {}) {
    const list = (opts.meshes || this.meshes).flatMap((m) => m.isSoftModel ? m.meshes : [m]);
    this._bakeClock = 0;
    for (const sm of list) {
      sm.mode = "baked";
      sm.bake = bake;
      sm.bakeSpeed = opts.speed ?? 1;
      sm.bakeTimeSource = opts.timeSource || null;
    }
    return this;
  }
  stopBake(meshes) {
    const list = (meshes || this.meshes).flatMap((m) => m.isSoftModel ? m.meshes : [m]);
    for (const sm of list) {
      sm.mode = "live";
      sm.bake = null;
      sm.reset();
    }
    return this;
  }
  // ---------- JSON ----------
  toJSON() {
    return {
      format: "softflesh",
      version: VERSION,
      quality: this.quality.level,
      colliders: this.colliders.items.map((c) => c.toJSON()),
      meshes: this.meshes.map((m) => m.toJSON())
    };
  }
  // Загрузить настройки: root — сцена, где искать меши и объекты коллайдеров по имени.
  loadJSON(json, root) {
    if (typeof json === "string") json = JSON.parse(json);
    if (json.quality) this.setQuality(json.quality);
    const byName = /* @__PURE__ */ new Map();
    for (const cj of json.colliders || []) {
      try {
        const c = colliderFromJSON(cj, root);
        this.colliders.add(c);
        if (c.name) byName.set(c.name, c);
      } catch (e) {
        console.warn(e.message);
      }
    }
    const findCol = (name) => {
      if (byName.has(name)) return byName.get(name);
      const c = this.colliders.items.find((x) => x.name === name);
      if (c) return c;
      const o = root && root.getObjectByName(name);
      return o ? this.colliderFor(o) : null;
    };
    const out = [];
    for (const mj of json.meshes || []) {
      let sm = this.get(mj.name);
      if (!sm && root) {
        let mesh = null;
        root.traverse((o) => {
          if (!mesh && o.isMesh && o.name === mj.name) mesh = o;
        });
        if (mesh) sm = this.add(mesh);
      }
      if (!sm) {
        console.warn("SoftFlesh: меш не найден: " + mj.name);
        continue;
      }
      sm.clearEffects();
      for (const ej of mj.effects) {
        const colliders = ej.colliders ? ej.colliders.map(findCol).filter(Boolean) : null;
        sm.addEffect(ej.type, ej.params, { name: ej.name, enabled: ej.enabled, mask: Mask.fromJSON(ej.mask || { type: "all" }), regions: (ej.regions || []).map((r) => ({ ...r, mask: Mask.fromJSON(r.mask) })), colliders });
      }
      if (mj.softBody) this.softBodies.add(sm, { ...mj.softBody, mask: Mask.fromJSON(mj.softBody.mask || { type: "all" }) });
      out.push(sm);
    }
    return out;
  }
  dispose() {
    [...this.meshes].forEach((m) => this.remove(m));
    this.colliders.clear();
    this._listeners = {};
  }
};
export {
  BoxCollider,
  CapsuleCollider,
  Collider,
  ColliderGroup,
  Contact,
  ContactEffect,
  ContactSolver,
  EFFECTS,
  Effect,
  FatJiggle,
  ImpulseTracker,
  Mask,
  MeshCollider,
  PRESETS,
  Penetration,
  PlaneCollider,
  QUALITY,
  Ripple,
  SelfContact,
  SlapWave,
  SoftBodyGroup,
  SoftFlesh,
  SoftFleshBake,
  SoftMesh,
  SoftModel,
  SphereCollider,
  Squish,
  SquishInflate,
  SquishOrganic,
  Topology,
  VERSION,
  SoftFlesh as World,
  colliderFromJSON,
  colliderFromObject,
  collidersFromSkeleton,
  createEffect,
  SoftFlesh as default,
  detectQuality,
  getPreset,
  listPresets,
  registerEffect,
  registerPreset,
  resolveQuality,
  softBodyDefaults,
  toCollider
};
