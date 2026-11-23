import { Mask } from '../core/Mask.js';
import { Collider } from '../colliders/Collider.js';

// Базовый класс эффекта. Параметры — обычный объект, меняются на лету через set().
// Маска/регионы: регион переопределяет числовые параметры (из regionParams) с весом своей маски.

export class Effect {
  constructor(params = {}, opts = {}) {
    const C = this.constructor;
    this.type = C.type;
    this.name = opts.name || C.type;
    this.enabled = opts.enabled !== false;
    this.params = { ...C.defaults, ...params };
    this.mask = Mask.from(opts.mask);
    this.regions = (opts.regions || []).map((r) => ({ name: r.name || '', mask: Mask.from(r.mask), params: { ...r.params } }));
    this.colliders = opts.colliders ?? null;
    this.sm = null;
    this.energy = 0;
    this._cache = {};
  }

  attach(sm) { this.sm = sm; this._cache = {}; this.init(); }
  detach() { this.reset(); this.sm = null; }
  init() {}
  reset() {}

  get world() { return this.sm && this.sm.world; }

  set(params) {
    for (const k in params) if (!(k in this.params)) console.warn(`SoftFlesh: у эффекта ${this.type} нет параметра "${k}"`);
    Object.assign(this.params, params);
    this._cache.params = null;
    if (this.sm) this.sm._exactDirty = true;
    return this;
  }
  setMask(mask) { this.mask = Mask.from(mask); this._cache = {}; if (this.sm) this.sm._exactDirty = true; return this; }
  setRegions(regions) { this.regions = regions.map((r) => ({ name: r.name || '', mask: Mask.from(r.mask), params: { ...r.params } })); this._cache = {}; return this; }
  addRegion(mask, params, name = '') { this.regions.push({ name, mask: Mask.from(mask), params }); this._cache = {}; return this; }
  setColliders(c) { this.colliders = c; if (this.sm) this.sm._exactDirty = true; return this; }
  enable(on = true) { this.enabled = on; if (!on) this.reset(); if (this.sm) this.sm._exactDirty = true; return this; }

  // Вес маски на узел.
  maskNodes() {
    if (!this._cache.mask) {
      let m = this.mask.resolve(this.sm.mesh, this.sm.topo);
      if (this.params.normalizeMask) {
        let mx = 0; for (let i = 0; i < m.length; i++) mx = Math.max(mx, m[i]);
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
  nodeList() { this.maskNodes(); return this._cache.list; }

  // Параметр на узел с учётом регионов (кэшируется до изменения параметров).
  nodeParam(name) {
    this.maskNodes();
    if (!this._cache.params) this._cache.params = {};
    let a = this._cache.params[name];
    if (!a) {
      const M = this.sm.nodeCount;
      a = new Float32Array(M).fill(this.params[name]);
      this.regions.forEach((r, i) => {
        if (r.params[name] === undefined) return;
        const w = this._cache.regionMasks[i], v = r.params[name];
        for (let n = 0; n < M; n++) if (w[n] > 0) a[n] += (v - a[n]) * w[n];
      });
      this._cache.params[name] = a;
    }
    return a;
  }
  hasRegionParam(name) { return this.regions.some((r) => r.params[name] !== undefined); }

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

  apply() {}

  // Ручной удар (для эффектов с импульсами): point — THREE.Vector3 в мире.
  hit() {}

  toJSON() {
    const cols = this.colliders == null ? null : [].concat(this.colliders).map((c) => c && (c.name || (c.object && c.object.name) || null));
    return {
      type: this.type, name: this.name, enabled: this.enabled, params: { ...this.params },
      mask: this.mask.toJSON(), regions: this.regions.map((r) => ({ name: r.name, mask: r.mask.toJSON(), params: r.params })), colliders: cols,
    };
  }
}
