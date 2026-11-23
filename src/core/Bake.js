import { len3 } from './math.js';
import * as THREE from 'three';

// Запекание (Bake): записывает деформацию по кадрам, чтобы в игре не считать её заново.
// Хранится разреженно: на кадр — только сдвинутые узлы (индексы + локальные смещения).
// Проигрывание: bake.apply(time) или world.playBake(bake). Экспорт: toJSON() / toAnimationClip().

function b64(buf) {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str, Type) {
  let u8;
  if (typeof Buffer !== 'undefined') u8 = new Uint8Array(Buffer.from(str, 'base64'));
  else { const s = atob(str); u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); }
  return new Type(u8.buffer, 0, u8.byteLength / Type.BYTES_PER_ELEMENT);
}

export class SoftFleshBake {
  constructor({ fps = 30, tracks = [], loop = true } = {}) {
    this.isSoftFleshBake = true;
    this.fps = fps;
    this.tracks = tracks; // [{ name, nodeCount, frames: [{ idx: Uint32Array, val: Float32Array }] }]
    this.loop = loop;
  }

  get frameCount() { return this.tracks.length ? this.tracks[0].frames.length : 0; }
  get duration() { return this.frameCount / this.fps; }

  // Запись: onFrame(i, dt, t) — продвиньте свою анимацию (mixer.update(dt), движение коллайдеров).
  static record(world, opts = {}) {
    const fps = opts.fps ?? 30, frames = opts.frames ?? Math.round((opts.duration ?? 2) * fps), dt = 1 / fps;
    const list = (opts.meshes || world.meshes).flatMap((m) => (m.isSoftModel ? m.meshes : [m]));
    const tracks = list.map((sm) => ({ name: sm.name, sm, nodeCount: sm.nodeCount, frames: [] }));
    const warm = opts.warmup ?? 0;
    for (let i = 0; i < warm; i++) { opts.onFrame && opts.onFrame(-1, dt, 0); world.update(dt, { force: true }); }
    for (let f = 0; f < frames; f++) {
      if (opts.onFrame) opts.onFrame(f, dt, f * dt);
      world.update(dt, { force: true });
      for (const tr of tracks) {
        const sm = tr.sm, c = sm.activeCount;
        const idx = new Uint32Array(c), val = new Float32Array(3 * c);
        for (let i = 0; i < c; i++) {
          const n = sm.activeList[i];
          idx[i] = n;
          val[3 * i] = sm.localOff[3 * n]; val[3 * i + 1] = sm.localOff[3 * n + 1]; val[3 * i + 2] = sm.localOff[3 * n + 2];
        }
        tr.frames.push({ idx, val });
      }
      if (opts.onProgress) opts.onProgress((f + 1) / frames);
    }
    const bake = new SoftFleshBake({ fps, tracks, loop: opts.loop !== false });
    if (opts.smoothPops !== false) bake.smoothPops(opts.popThreshold);
    return bake;
  }

  // Сглаживание «щелчков»: кадр, резко выбивающийся из соседей, заменяется средним.
  smoothPops(threshold) {
    for (const tr of this.tracks) {
      const M = tr.nodeCount, F = tr.frames.length;
      if (F < 3) continue;
      const th = threshold ?? (tr.sm ? tr.sm.topo.meanEdge * 0.35 : 0.002);
      const dense = [0, 1, 2].map(() => new Float32Array(3 * M));
      const fill = (arr, fr) => { arr.fill(0); for (let i = 0; i < fr.idx.length; i++) { const n = fr.idx[i]; arr[3 * n] = fr.val[3 * i]; arr[3 * n + 1] = fr.val[3 * i + 1]; arr[3 * n + 2] = fr.val[3 * i + 2]; } };
      fill(dense[0], tr.frames[0]); fill(dense[1], tr.frames[1]);
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
          if (jump > th && jump > span) { cur[i] = ax; cur[i + 1] = ay; cur[i + 2] = az; changed = true; }
        }
        if (changed) {
          const idx = [], val = [];
          for (let n = 0; n < M; n++) if (cur[3 * n] || cur[3 * n + 1] || cur[3 * n + 2]) { idx.push(n); val.push(cur[3 * n], cur[3 * n + 1], cur[3 * n + 2]); }
          tr.frames[f] = { idx: Uint32Array.from(idx), val: Float32Array.from(val) };
        }
      }
    }
    return this;
  }

  _frameAt(time) {
    let x = time * this.fps;
    const F = this.frameCount;
    if (this.loop) x = ((x % F) + F) % F; else x = Math.min(Math.max(x, 0), F - 1);
    const a = Math.floor(x), b = this.loop ? (a + 1) % F : Math.min(a + 1, F - 1);
    return [a, b, x - a];
  }

  // Применить запечённую деформацию к SoftMesh (по имени трека) на момент time (сек).
  applyTo(sm, time, track = null) {
    const tr = track || this.tracks.find((t) => t.sm === sm) || this.tracks.find((t) => t.name === sm.name);
    if (!tr || !this.frameCount) return false;
    if (tr.nodeCount !== sm.nodeCount) { console.warn('SoftFlesh: запекание не подходит к мешу ' + sm.name); return false; }
    const [a, b, t] = this._frameAt(time);
    const off = sm.localOff, mark = sm._bakeMark || (sm._bakeMark = new Int32Array(sm.nodeCount)), st = (sm._bakeStamp = (sm._bakeStamp || 0) + 1);
    let cnt = 0;
    const put = (fr, w) => {
      for (let i = 0; i < fr.idx.length; i++) {
        const n = fr.idx[i];
        if (mark[n] !== st) { mark[n] = st; off[3 * n] = 0; off[3 * n + 1] = 0; off[3 * n + 2] = 0; sm.activeList[cnt++] = n; }
        off[3 * n] += fr.val[3 * i] * w; off[3 * n + 1] += fr.val[3 * i + 1] * w; off[3 * n + 2] += fr.val[3 * i + 2] * w;
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
  toAnimationClip(sm, { step = 2, name = 'SoftFleshBake', trackPrefix = '' } = {}) {
    const tr = this.tracks.find((t) => t.sm === sm) || this.tracks.find((t) => t.name === sm.name);
    if (!tr) throw new Error('SoftFlesh: нет трека для ' + sm.name);
    const g = sm.mesh.geometry, V = g.attributes.position.count, v2n = sm.topo.vertToNode;
    if (!g.morphAttributes.position) { g.morphAttributes.position = []; g.morphTargetsRelative = true; }
    const relative = g.morphTargetsRelative;
    const startIdx = g.morphAttributes.position.length;
    const times = [];
    for (let f = 0; f < tr.frames.length; f += step) {
      const fr = tr.frames[f], dense = new Float32Array(3 * sm.nodeCount);
      for (let i = 0; i < fr.idx.length; i++) { const n = fr.idx[i]; dense[3 * n] = fr.val[3 * i]; dense[3 * n + 1] = fr.val[3 * i + 1]; dense[3 * n + 2] = fr.val[3 * i + 2]; }
      const arr = new Float32Array(3 * V);
      for (let v = 0; v < V; v++) {
        const n = v2n[v];
        arr[3 * v] = dense[3 * n] + (relative ? 0 : sm.restPos[3 * v]);
        arr[3 * v + 1] = dense[3 * n + 1] + (relative ? 0 : sm.restPos[3 * v + 1]);
        arr[3 * v + 2] = dense[3 * n + 2] + (relative ? 0 : sm.restPos[3 * v + 2]);
      }
      const attr = new THREE.Float32BufferAttribute(arr, 3);
      attr.name = `softflesh_${f}`;
      g.morphAttributes.position.push(attr);
      times.push(f / this.fps);
    }
    sm.mesh.updateMorphTargets();
    const tracks = [];
    const K = times.length, end = tr.frames.length / this.fps;
    for (let k = 0; k < K; k++) {
      const t = [], v = [];
      if (k > 0) { t.push(0, times[k - 1]); v.push(0, 0); }
      t.push(times[k]); v.push(1);
      if (k < K - 1) { t.push(times[k + 1], end); v.push(0, 0); } else if (times[k] < end) { t.push(end); v.push(this.loop ? 0 : 1); }
      const ut = [], uv = [];
      t.forEach((x, i) => { if (!ut.length || x > ut[ut.length - 1]) { ut.push(x); uv.push(v[i]); } });
      tracks.push(new THREE.NumberKeyframeTrack(`${trackPrefix}.morphTargetInfluences[${startIdx + k}]`, ut, uv));
    }
    return new THREE.AnimationClip(name, end, tracks);
  }

  toJSON() {
    return {
      format: 'softflesh-bake', version: 1, fps: this.fps, loop: this.loop,
      tracks: this.tracks.map((t) => ({
        name: t.name, nodeCount: t.nodeCount,
        frames: t.frames.map((f) => ({ i: b64(f.idx), v: b64(f.val) })),
      })),
    };
  }

  static fromJSON(j) {
    if (typeof j === 'string') j = JSON.parse(j);
    return new SoftFleshBake({
      fps: j.fps, loop: j.loop,
      tracks: j.tracks.map((t) => ({ name: t.name, nodeCount: t.nodeCount, frames: t.frames.map((f) => ({ idx: unb64(f.i, Uint32Array), val: unb64(f.v, Float32Array) })) })),
    });
  }
}
