import { SoftMesh } from './core/SoftMesh.js';
import { SoftBodyGroup } from './core/SoftBodyGroup.js';
import { SoftFleshBake } from './core/Bake.js';
import { Mask } from './core/Mask.js';
import { resolveQuality, QUALITY_ORDER, QUALITY } from './core/Quality.js';
import { Collider } from './colliders/Collider.js';
import { ColliderGroup, colliderFromObject, colliderFromJSON, toCollider } from './colliders/factory.js';
import { createEffect } from './effects/index.js';

export const VERSION = '1.0.0';

// Набор SoftMesh, полученный из GLTF-сцены (несколько мешей): команды раздаются всем.
export class SoftModel {
  constructor(meshes) { this.isSoftModel = true; this.meshes = meshes; }
  addEffect(type, params, opts) { return this.meshes.map((m) => m.addEffect(type, params, opts)); }
  applyPreset(name, o) { return this.meshes.flatMap((m) => m.applyPreset(name, o)); }
  get effects() { return this.meshes.flatMap((m) => m.effects); }
  getEffects(type) { return this.effects.filter((e) => e.type === type); }
  set(type, params) { this.getEffects(type).forEach((e) => e.set(params)); return this; }
  enable(on = true) { this.meshes.forEach((m) => { m.enabled = on; if (!on) m.reset(); }); return this; }
  reset() { this.meshes.forEach((m) => m.reset()); }
  find(name) { return this.meshes.find((m) => m.name === name || m.mesh.name === name) || null; }
  toJSON() { return this.meshes.map((m) => m.toJSON()); }
}

// Главный объект библиотеки («мир» мягких деформаций).
export class SoftFlesh {
  constructor(opts = {}) {
    this.quality = resolveQuality(opts.quality ?? 'auto');
    this._baseQuality = this.quality.level;
    this.adaptive = opts.adaptive ?? false; // авто-понижение качества при нехватке бюджета
    this.budgetMs = opts.budgetMs ?? 4;
    this.maxDt = opts.maxDt ?? 1 / 20;
    this.autoUpdateMatrices = opts.autoUpdateMatrices !== false;
    this.meshes = [];
    this.colliders = new ColliderGroup('default'); // общая группа: используется эффектами без своих коллайдеров
    this.softBodies = new SoftBodyGroup(this);
    this.time = 0;
    this.frame = 0;
    this.paused = false;
    this.stats = { ms: 0, avgMs: 0, meshes: 0, activeNodes: 0 };
    this._listeners = {};
    this._colCache = new WeakMap();
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
    else object.traverse((o) => { if (o.isMesh && (!opts.meshFilter || opts.meshFilter(o))) meshes.push(o); });
    if (!meshes.length) throw new Error('SoftFlesh: в объекте нет мешей');
    const list = meshes.map((mesh) => {
      let sm = this.meshes.find((m) => m.mesh === mesh);
      if (!sm) { sm = new SoftMesh(this, mesh, opts); this.meshes.push(sm); }
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

  get(meshOrName) { return this.meshes.find((m) => m.mesh === meshOrName || m.name === meshOrName) || null; }

  // ---------- коллайдеры ----------
  addCollider(x, opts = {}) {
    let c;
    if (x instanceof Collider) c = x;
    else if (x && x.isObject3D) { c = this._colCache.get(x); if (!c) { c = colliderFromObject(x, opts); this._colCache.set(x, c); } }
    else c = toCollider(x);
    this.colliders.add(c);
    return c;
  }
  removeCollider(x) { this.colliders.remove(this._colCache.get(x) || x); }
  colliderFor(obj) {
    let c = this._colCache.get(obj);
    if (!c) { c = colliderFromObject(obj); this._colCache.set(obj, c); }
    return c;
  }
  createEffect(type, params, opts) { return createEffect(type, params, opts); }

  // ---------- события ----------
  on(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const l = this._listeners[type]; if (l) this._listeners[type] = l.filter((f) => f !== fn); }
  emit(type, ev) { const l = this._listeners[type]; if (l) for (const f of l) f(ev); }

  setQuality(q) { this.quality = resolveQuality(q); this._baseQuality = this.quality.level; return this; }

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
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.time += step;
    this._bakeClock += step;

    if (this.autoUpdateMatrices) {
      const roots = new Set();
      for (const sm of this.meshes) if (sm.enabled) { let r = sm.mesh; while (r.parent) r = r.parent; roots.add(r); }
      roots.forEach((r) => r.updateMatrixWorld());
    }
    // коллайдеры
    const cols = new Set(this.colliders.items);
    for (const sm of this.meshes) for (const e of sm.effects) if (e.enabled) e.resolveColliders().forEach((c) => cols.add(c));
    cols.forEach((c) => c.update(step, this.frame));

    const ctx = { dt: step, time: this.time, world: this };
    let active = 0;
    const live = [];
    for (const sm of this.meshes) {
      if (!sm.enabled) continue;
      if (sm.mode === 'baked' && sm.bake) {
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
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    this.stats.ms = ms;
    this.stats.avgMs = this.stats.avgMs * 0.95 + ms * 0.05;
    this.stats.meshes = this.meshes.length;
    this.stats.activeNodes = active;
    if (this.adaptive) this._adapt();
  }

  _adapt() {
    const i = QUALITY_ORDER.indexOf(this.quality.level);
    if (this.stats.avgMs > this.budgetMs) { if (++this._slow > 30 && i > 0) { this.quality = { ...QUALITY[QUALITY_ORDER[i - 1]] }; this._slow = 0; this.emit('quality', this.quality); } }
    else this._slow = 0;
    if (this.stats.avgMs < this.budgetMs * 0.35) {
      if (++this._fast > 180 && i < QUALITY_ORDER.indexOf(this._baseQuality)) { this.quality = { ...QUALITY[QUALITY_ORDER[i + 1]] }; this._fast = 0; this.emit('quality', this.quality); }
    } else this._fast = 0;
  }

  reset() { this.meshes.forEach((m) => m.reset()); }

  // ---------- запекание ----------
  bake(opts = {}) { return SoftFleshBake.record(this, opts); }

  // Проигрывать запекание вместо расчёта. opts: { meshes, speed, timeSource: () => action.time }
  playBake(bake, opts = {}) {
    const list = (opts.meshes || this.meshes).flatMap((m) => (m.isSoftModel ? m.meshes : [m]));
    this._bakeClock = 0;
    for (const sm of list) { sm.mode = 'baked'; sm.bake = bake; sm.bakeSpeed = opts.speed ?? 1; sm.bakeTimeSource = opts.timeSource || null; }
    return this;
  }
  stopBake(meshes) {
    const list = (meshes || this.meshes).flatMap((m) => (m.isSoftModel ? m.meshes : [m]));
    for (const sm of list) { sm.mode = 'live'; sm.bake = null; sm.reset(); }
    return this;
  }

  // ---------- JSON ----------
  toJSON() {
    return {
      format: 'softflesh', version: VERSION, quality: this.quality.level,
      colliders: this.colliders.items.map((c) => c.toJSON()),
      meshes: this.meshes.map((m) => m.toJSON()),
    };
  }

  // Загрузить настройки: root — сцена, где искать меши и объекты коллайдеров по имени.
  loadJSON(json, root) {
    if (typeof json === 'string') json = JSON.parse(json);
    if (json.quality) this.setQuality(json.quality);
    const byName = new Map();
    for (const cj of json.colliders || []) {
      try { const c = colliderFromJSON(cj, root); this.colliders.add(c); if (c.name) byName.set(c.name, c); } catch (e) { console.warn(e.message); }
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
        root.traverse((o) => { if (!mesh && o.isMesh && o.name === mj.name) mesh = o; });
        if (mesh) sm = this.add(mesh);
      }
      if (!sm) { console.warn('SoftFlesh: меш не найден: ' + mj.name); continue; }
      sm.clearEffects();
      for (const ej of mj.effects) {
        const colliders = ej.colliders ? ej.colliders.map(findCol).filter(Boolean) : null;
        sm.addEffect(ej.type, ej.params, { name: ej.name, enabled: ej.enabled, mask: Mask.fromJSON(ej.mask || { type: 'all' }), regions: (ej.regions || []).map((r) => ({ ...r, mask: Mask.fromJSON(r.mask) })), colliders });
      }
      if (mj.softBody) this.softBodies.add(sm, { ...mj.softBody, mask: Mask.fromJSON(mj.softBody.mask || { type: 'all' }) });
      out.push(sm);
    }
    return out;
  }

  dispose() { [...this.meshes].forEach((m) => this.remove(m)); this.colliders.clear(); this._listeners = {}; }
}

