import { len3 } from './math.js';
// Топология меша: сварка дублей вершин (швы UV), соседство, границы, площади.
// Все расчёты деформаций идут по «узлам» (сваренным вершинам), чтобы не рвать швы.

export class Topology {
  constructor(positions, index, weldEps) {
    const V = positions.length / 3;
    this.vertexCount = V;
    const vertToNode = new Int32Array(V);
    const map = new Map();
    const inv = 1 / weldEps;
    let M = 0;
    const firstVert = [];
    for (let v = 0; v < V; v++) {
      const key = Math.round(positions[3 * v] * inv) + ',' + Math.round(positions[3 * v + 1] * inv) + ',' + Math.round(positions[3 * v + 2] * inv);
      let n = map.get(key);
      if (n === undefined) { n = M++; map.set(key, n); firstVert.push(v); }
      vertToNode[v] = n;
    }
    this.nodeCount = M;
    this.vertToNode = vertToNode;
    this.nodeFirstVert = Int32Array.from(firstVert);
    const nodeRest = new Float32Array(3 * M);
    for (let n = 0; n < M; n++) {
      const v = firstVert[n];
      nodeRest[3 * n] = positions[3 * v]; nodeRest[3 * n + 1] = positions[3 * v + 1]; nodeRest[3 * n + 2] = positions[3 * v + 2];
    }
    this.nodeRest = nodeRest;

    // Треугольники в индексах узлов (вырожденные отбрасываются).
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

    // Рёбра: соседство + подсчёт для поиска открытых краёв.
    const edgeCount = new Map();
    const neigh = Array.from({ length: M }, () => []);
    const nodeTris = Array.from({ length: M }, () => []);
    const addEdge = (a, b) => {
      const key = a < b ? a * M + b : b * M + a;
      const c = edgeCount.get(key);
      if (c === undefined) { edgeCount.set(key, 1); neigh[a].push(b); neigh[b].push(a); } else edgeCount.set(key, c + 1);
    };
    for (let t = 0; t < F; t++) {
      const a = this.tris[3 * t], b = this.tris[3 * t + 1], c = this.tris[3 * t + 2];
      addEdge(a, b); addEdge(b, c); addEdge(c, a);
      nodeTris[a].push(t); nodeTris[b].push(t); nodeTris[c].push(t);
    }
    this.adjStart = new Int32Array(M + 1);
    let total = 0;
    for (let n = 0; n < M; n++) { this.adjStart[n] = total; total += neigh[n].length; }
    this.adjStart[M] = total;
    this.adj = new Int32Array(total);
    for (let n = 0, k = 0; n < M; n++) for (const j of neigh[n]) this.adj[k++] = j;
    this.triStart = new Int32Array(M + 1);
    total = 0;
    for (let n = 0; n < M; n++) { this.triStart[n] = total; total += nodeTris[n].length; }
    this.triStart[M] = total;
    this.nodeTris = new Int32Array(total);
    for (let n = 0, k = 0; n < M; n++) for (const t of nodeTris[n]) this.nodeTris[k++] = t;

    this.boundary = new Uint8Array(M);
    for (const [key, c] of edgeCount) {
      if (c !== 1) continue;
      const a = Math.floor(key / M), b = key - a * M;
      this.boundary[a] = 1; this.boundary[b] = 1;
    }

    // Площадь узла (1/3 площадей смежных треугольников) и средняя длина ребра.
    this.restArea = new Float32Array(M);
    for (let t = 0; t < F; t++) {
      const a = this.tris[3 * t], b = this.tris[3 * t + 1], c = this.tris[3 * t + 2];
      const ux = nodeRest[3 * b] - nodeRest[3 * a], uy = nodeRest[3 * b + 1] - nodeRest[3 * a + 1], uz = nodeRest[3 * b + 2] - nodeRest[3 * a + 2];
      const vx = nodeRest[3 * c] - nodeRest[3 * a], vy = nodeRest[3 * c + 1] - nodeRest[3 * a + 1], vz = nodeRest[3 * c + 2] - nodeRest[3 * a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const ar = Math.sqrt(cx * cx + cy * cy + cz * cz) / 6;
      this.restArea[a] += ar; this.restArea[b] += ar; this.restArea[c] += ar;
    }
    let el = 0, ec = 0;
    for (let n = 0; n < M; n++) for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
      const j = this.adj[k];
      if (j < n) continue;
      el += len3(nodeRest[3 * j] - nodeRest[3 * n], nodeRest[3 * j + 1] - nodeRest[3 * n + 1], nodeRest[3 * j + 2] - nodeRest[3 * n + 2]);
      ec++;
    }
    this.meanEdge = ec ? el / ec : 1;

    // Рабочие буферы обхода в ширину (штампы вместо очистки массивов).
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
    for (let n = 0; n < M; n++) if (this.boundary[n]) { r[n] = 0; q[tail++] = n; }
    while (head < tail) {
      const n = q[head++];
      if (r[n] >= 254) continue;
      for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
        const j = this.adj[k];
        if (r[j] === 255) { r[j] = r[n] + 1; q[tail++] = j; }
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
      stamp[n] = s; ring[n] = 0; dist[n] = 0; src[n] = n; queue[tail++] = n;
    }
    let head = 0;
    while (head < tail) {
      const n = queue[head++];
      if (ring[n] >= maxRings) continue;
      const px = pos[3 * n], py = pos[3 * n + 1], pz = pos[3 * n + 2];
      for (let k = adjStart[n]; k < adjStart[n + 1]; k++) {
        const j = adj[k];
        const d = dist[n] + len3(pos[3 * j] - px, pos[3 * j + 1] - py, pos[3 * j + 2] - pz);
        if (stamp[j] === s) { if (d < dist[j] && ring[j] === ring[n] + 1) { dist[j] = d; src[j] = src[n]; } continue; }
        if (d > maxDist) continue;
        stamp[j] = s; ring[j] = ring[n] + 1; dist[j] = d; src[j] = src[n]; queue[tail++] = j;
      }
    }
    return tail;
  }

  isVisited(n) { return this.stamp[n] === this.stampValue; }

  // Размытие векторного поля по списку узлов (Якоби). keepMax: модуль не уменьшается (правило «максимум из точного и размытого»).
  blurVec(field, nodes, count, iterations, tmp, lambda = 0.5, keepMax = false) {
    const { adj, adjStart } = this;
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < count; i++) {
        const n = nodes[i];
        let sx = 0, sy = 0, sz = 0;
        const a = adjStart[n], b = adjStart[n + 1];
        for (let k = a; k < b; k++) { const j = adj[k]; sx += field[3 * j]; sy += field[3 * j + 1]; sz += field[3 * j + 2]; }
        const c = b - a || 1;
        const fx = field[3 * n], fy = field[3 * n + 1], fz = field[3 * n + 2];
        let nx = fx + lambda * (sx / c - fx), ny = fy + lambda * (sy / c - fy), nz = fz + lambda * (sz / c - fz);
        if (keepMax) {
          const l0 = fx * fx + fy * fy + fz * fz, l1 = nx * nx + ny * ny + nz * nz;
          if (l1 < l0) { nx = fx; ny = fy; nz = fz; }
        }
        tmp[3 * i] = nx; tmp[3 * i + 1] = ny; tmp[3 * i + 2] = nz;
      }
      for (let i = 0; i < count; i++) {
        const n = nodes[i];
        field[3 * n] = tmp[3 * i]; field[3 * n + 1] = tmp[3 * i + 1]; field[3 * n + 2] = tmp[3 * i + 2];
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
        sx += uy * vz - uz * vy; sy += uz * vx - ux * vz; sz += ux * vy - uy * vx;
      }
      const l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      out[3 * n] = sx / l; out[3 * n + 1] = sy / l; out[3 * n + 2] = sz / l;
    };
    if (nodes) { for (let i = 0; i < count; i++) one(nodes[i]); return; }
    // весь меш: один проход по треугольникам
    out.fill(0);
    const F = this.triCount;
    for (let t = 0; t < F; t++) {
      const a = 3 * tris[3 * t], b = 3 * tris[3 * t + 1], c = 3 * tris[3 * t + 2];
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      out[a] += x; out[a + 1] += y; out[a + 2] += z;
      out[b] += x; out[b + 1] += y; out[b + 2] += z;
      out[c] += x; out[c + 1] += y; out[c + 2] += z;
    }
    for (let n = 0; n < this.nodeCount; n++) {
      const x = out[3 * n], y = out[3 * n + 1], z = out[3 * n + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      out[3 * n] = x / l; out[3 * n + 1] = y / l; out[3 * n + 2] = z / l;
    }
  }
}
