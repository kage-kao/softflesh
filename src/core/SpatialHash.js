// Пространственный хэш точек для поиска соседей (самоконтакт, мягкие тела).

export class SpatialHash {
  constructor(capacity, tableBits = 15) {
    this.size = 1 << tableBits;
    this.mask = this.size - 1;
    this.head = new Int32Array(this.size);
    this.next = new Int32Array(capacity);
    this.cell = 1;
    this.pos = null;
  }

  _key(ix, iy, iz) {
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & this.mask;
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
}
