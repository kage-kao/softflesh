// Пружинное поле: смещение узлов догоняет целевое с перелётом (желе, упругость).
export class SpringField {
  constructor(M) {
    this.y = new Float32Array(3 * M);
    this.v = new Float32Array(3 * M);
    this.mark = new Int32Array(M);
    this.stamp = 1;
    this.list = new Int32Array(M);
    this.count = 0;
    this.target = new Float32Array(3 * M);
  }

  reset() { this.y.fill(0); this.v.fill(0); this.target.fill(0); this.count = 0; }

  // nodes: узлы с ненулевой целью в этом кадре (цель в this.target).
  step(nodes, n, dt, omega, zeta, maxSub = 1 / 120) {
    const st = ++this.stamp, mark = this.mark, y = this.y, v = this.v, T = this.target;
    const next = [];
    for (let i = 0; i < n; i++) { const k = nodes[i]; if (mark[k] !== st) { mark[k] = st; next.push(k); } }
    for (let i = 0; i < this.count; i++) { const k = this.list[i]; if (mark[k] !== st) { mark[k] = st; next.push(k); } }
    const sub = Math.max(1, Math.ceil(dt / maxSub)), h = dt / sub;
    const w2 = omega * omega, c = 2 * zeta * omega;
    let cnt = 0;
    for (const k of next) {
      let alive = false;
      for (let a = 0; a < 3; a++) {
        const i = 3 * k + a;
        let yy = y[i], vv = v[i];
        const t = T[i];
        for (let s = 0; s < sub; s++) { vv += (w2 * (t - yy) - c * vv) * h; yy += vv * h; }
        y[i] = yy; v[i] = vv;
        if (Math.abs(yy) > 1e-6 || Math.abs(vv) > 1e-5 || t !== 0) alive = true;
      }
      if (alive) this.list[cnt++] = k; else { y[3 * k] = y[3 * k + 1] = y[3 * k + 2] = 0; v[3 * k] = v[3 * k + 1] = v[3 * k + 2] = 0; }
    }
    this.count = cnt;
    // цель обнуляется — её заново задают в следующем кадре
    for (const k of next) { T[3 * k] = 0; T[3 * k + 1] = 0; T[3 * k + 2] = 0; }
  }

  addTo(disp, scale = 1) {
    const y = this.y;
    for (let i = 0; i < this.count; i++) {
      const k = this.list[i];
      disp[3 * k] += y[3 * k] * scale; disp[3 * k + 1] += y[3 * k + 1] * scale; disp[3 * k + 2] += y[3 * k + 2] * scale;
    }
  }

  kick(k, x, y, z) { this.v[3 * k] += x; this.v[3 * k + 1] += y; this.v[3 * k + 2] += z; if (this.count < this.list.length) this.list[this.count++] = k; }
}
