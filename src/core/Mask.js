import { len3 } from './math.js';
import * as THREE from 'three';

// Маски (регионы) — вес 0..1 на каждую вершину. Аналог групп вершин Blender.
// Источники: атрибут GLB (_FAT и т.п.), цвет вершин, веса костей, геометрические формы, функция, массив.
// Маска сериализуется в JSON (кроме fn/values).

export class Mask {
  constructor(spec) { this.spec = spec; }

  static all() { return new Mask({ type: 'all' }); }
  static attribute(name, channel = 0) { return new Mask({ type: 'attribute', name, channel }); }
  static color(channel = 'r', attribute = 'color') { return new Mask({ type: 'color', channel, attribute }); }
  static bones(names, opts = {}) { return new Mask({ type: 'bones', names: [].concat(names), includeChildren: !!opts.includeChildren }); }
  static sphere(center, radius, falloff = 0.5) { return new Mask({ type: 'sphere', center, radius, falloff }); }
  static box(min, max, falloff = 0) { return new Mask({ type: 'box', min, max, falloff }); }
  static fn(f) { return new Mask({ type: 'fn', f }); }
  static values(arr) { return new Mask({ type: 'values', arr }); }
  static max(...m) { return new Mask({ type: 'max', items: m.map(Mask.from) }); }
  static min(...m) { return new Mask({ type: 'min', items: m.map(Mask.from) }); }
  static multiply(...m) { return new Mask({ type: 'mul', items: m.map(Mask.from) }); }
  static subtract(a, b) { return new Mask({ type: 'sub', items: [Mask.from(a), Mask.from(b)] }); }

  invert() { return new Mask({ type: 'invert', items: [this] }); }
  blur(rings = 2) { return new Mask({ type: 'blur', items: [this], rings }); }
  normalize() { return new Mask({ type: 'normalize', items: [this] }); }
  scale(k) { return new Mask({ type: 'scale', items: [this], k }); }
  threshold(t = 0.5) { return new Mask({ type: 'threshold', items: [this], t }); }

  // Короткая запись строкой: 'all' | 'attr:_fat' | 'color:r' | 'bones:Breast.L,Breast.R'
  static from(x) {
    if (!x) return Mask.all();
    if (x instanceof Mask) return x;
    if (typeof x === 'function') return Mask.fn(x);
    if (ArrayBuffer.isView(x) || Array.isArray(x)) return Mask.values(x);
    if (typeof x === 'string') {
      const [k, v = ''] = x.split(':');
      if (k === 'all') return Mask.all();
      if (k === 'attr' || k === 'attribute') { const [n, c] = v.split('.'); return Mask.attribute(n, c ? Number(c) || 'xyzw'.indexOf(c) : 0); }
      if (k === 'color') return Mask.color(v || 'r');
      if (k === 'bones' || k === 'bone') return Mask.bones(v.split(',').map((s) => s.trim()).filter(Boolean));
      throw new Error('SoftFlesh: неизвестная маска ' + x);
    }
    if (x.type) return Mask.fromJSON(x);
    throw new Error('SoftFlesh: неизвестная маска');
  }

  static fromJSON(j) {
    if (j.items) return new Mask({ ...j, items: j.items.map(Mask.fromJSON) });
    return new Mask(j);
  }

  toJSON() {
    const s = this.spec;
    if (s.type === 'fn' || s.type === 'values') { console.warn('SoftFlesh: маска-функция/массив не сохраняется в JSON'); return { type: 'all' }; }
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
      case 'all': out.fill(1); break;
      case 'attribute': {
        const a = g.attributes[s.name] || g.attributes[String(s.name).toLowerCase()] || g.attributes['_' + String(s.name).toLowerCase()];
        if (!a) { console.warn(`SoftFlesh: атрибут ${s.name} не найден, маска пустая`); break; }
        const c = typeof s.channel === 'string' ? Math.max(0, 'xyzwrgba'.indexOf(s.channel) % 4) : s.channel;
        for (let i = 0; i < V; i++) out[i] = a.getComponent(i, Math.min(c, a.itemSize - 1));
        break;
      }
      case 'color': {
        const a = g.attributes[s.attribute];
        if (!a) { console.warn('SoftFlesh: нет цвета вершин, маска пустая'); break; }
        const c = Math.max(0, 'rgba'.indexOf(s.channel));
        for (let i = 0; i < V; i++) out[i] = a.getComponent(i, Math.min(c, a.itemSize - 1));
        break;
      }
      case 'bones': {
        if (!mesh.isSkinnedMesh) { console.warn('SoftFlesh: маска по костям требует SkinnedMesh'); break; }
        const bones = mesh.skeleton.bones;
        const set = new Set();
        bones.forEach((b, i) => {
          let ok = s.names.includes(b.name);
          if (!ok && s.includeChildren) { let p = b.parent; while (p && !ok) { ok = p.isBone && s.names.includes(p.name); p = p.parent; } }
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
      case 'sphere': {
        const c = new THREE.Vector3().fromArray(s.center);
        for (let i = 0; i < V; i++) {
          const d = len3(pos.getX(i) - c.x, pos.getY(i) - c.y, pos.getZ(i) - c.z);
          const inner = s.radius * (1 - s.falloff);
          out[i] = d <= inner ? 1 : d >= s.radius ? 0 : 1 - (d - inner) / (s.radius - inner);
        }
        break;
      }
      case 'box': {
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
      case 'fn': for (let i = 0; i < V; i++) out[i] = s.f(pos.getX(i), pos.getY(i), pos.getZ(i), i); break;
      case 'values': for (let i = 0; i < V; i++) out[i] = s.arr[i] ?? 0; break;
      case 'max': case 'min': case 'mul': {
        const arrs = s.items.map((m) => m.resolveVertices(mesh, topo));
        for (let i = 0; i < V; i++) {
          let w = s.type === 'max' ? 0 : 1;
          for (const a of arrs) w = s.type === 'max' ? Math.max(w, a[i]) : s.type === 'min' ? Math.min(w, a[i]) : w * a[i];
          out[i] = w;
        }
        break;
      }
      case 'sub': { const a = s.items[0].resolveVertices(mesh, topo), b = s.items[1].resolveVertices(mesh, topo); for (let i = 0; i < V; i++) out[i] = a[i] - b[i]; break; }
      case 'invert': { const a = s.items[0].resolveVertices(mesh, topo); for (let i = 0; i < V; i++) out[i] = 1 - a[i]; break; }
      case 'scale': { const a = s.items[0].resolveVertices(mesh, topo); for (let i = 0; i < V; i++) out[i] = a[i] * s.k; break; }
      case 'threshold': { const a = s.items[0].resolveVertices(mesh, topo); for (let i = 0; i < V; i++) out[i] = a[i] >= s.t ? 1 : 0; break; }
      case 'normalize': {
        const a = s.items[0].resolveVertices(mesh, topo);
        let m = 0; for (let i = 0; i < V; i++) m = Math.max(m, a[i]);
        for (let i = 0; i < V; i++) out[i] = m > 0 ? a[i] / m : 0;
        break;
      }
      case 'blur': {
        const a = s.items[0].resolve(mesh, topo);
        const M = topo.nodeCount, all = new Int32Array(M).map((_, i) => i), tmp = new Float32Array(M);
        topo.blurScalar(a, all, M, s.rings * 2, tmp, 0.6);
        for (let i = 0; i < V; i++) out[i] = a[topo.vertToNode[i]];
        break;
      }
      default: throw new Error('SoftFlesh: неизвестный тип маски ' + s.type);
    }
    for (let i = 0; i < V; i++) out[i] = out[i] < 0 ? 0 : out[i] > 1 ? 1 : out[i];
    return out;
  }

  // Вес на узел (сваренную вершину): максимум по дублям.
  resolve(mesh, topo) {
    const v = this.resolveVertices(mesh, topo);
    const out = new Float32Array(topo.nodeCount);
    for (let i = 0; i < v.length; i++) { const n = topo.vertToNode[i]; if (v[i] > out[n]) out[n] = v[i]; }
    return out;
  }
}
