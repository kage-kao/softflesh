import * as THREE from 'three';
import { Collider, SphereCollider, CapsuleCollider, BoxCollider, PlaneCollider } from './Collider.js';
import { MeshCollider } from './MeshCollider.js';

// Группа коллайдеров (аналог «Collision Collection»): всё, что в группе, давит на плоть.
export class ColliderGroup {
  constructor(name = '', colliders = []) {
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
  clear() { this.items.length = 0; }
  get size() { return this.items.length; }
}

// Подогнать примитив под объект («Fit to Selection»): по ограничивающему боксу геометрии.
export function colliderFromObject(object, opts = {}) {
  if (object instanceof Collider) return object;
  const ud = (object.userData && object.userData.softCollider) || null;
  const shape = opts.shape || (typeof ud === 'string' ? ud : 'auto');
  const g = object.geometry;
  const margin = opts.margin || 0;
  const base = { object, name: object.name, firmness: opts.firmness, side: opts.side };
  if (shape === 'mesh') return new MeshCollider({ ...base, geometry: g, reach: opts.reach });
  const p = g && g.parameters ? g.parameters : {};
  const t = g ? g.type : '';
  if (shape === 'auto') {
    if (t === 'SphereGeometry' || t === 'IcosahedronGeometry' || t === 'OctahedronGeometry') return new SphereCollider({ ...base, radius: (p.radius ?? 1) + margin });
    if (t === 'CapsuleGeometry') return new CapsuleCollider({ ...base, radius: p.radius + margin, height: p.length ?? p.height });
    if (t === 'BoxGeometry') return new BoxCollider({ ...base, size: [p.width + 2 * margin, p.height + 2 * margin, p.depth + 2 * margin], rounding: Math.max(margin, 0.002) });
    if (t === 'PlaneGeometry') return new PlaneCollider({ ...base, size: [p.width, p.height], offsetMatrix: new THREE.Matrix4().makeRotationX(Math.PI / 2) });
    if (g && g.attributes.position.count <= 4000) return new MeshCollider({ ...base, geometry: g, reach: opts.reach });
  }
  if (!g) throw new Error('SoftFlesh: у объекта нет геометрии для коллайдера');
  if (!g.boundingBox) g.computeBoundingBox();
  const box = g.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const off = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z);
  if (shape === 'sphere' || shape === 'auto') {
    return new SphereCollider({ ...base, radius: Math.max(size.x, size.y, size.z) / 2 + margin, offsetMatrix: off });
  }
  if (shape === 'box') return new BoxCollider({ ...base, size: [size.x + 2 * margin, size.y + 2 * margin, size.z + 2 * margin], offsetMatrix: off });
  // capsule: вдоль самой длинной оси
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const len = size[axis];
  const r = (axis === 'x' ? Math.max(size.y, size.z) : axis === 'y' ? Math.max(size.x, size.z) : Math.max(size.x, size.y)) / 2 + margin;
  const h = Math.max(0, len - 2 * r) / 2;
  const a = [0, 0, 0], b = [0, 0, 0];
  const ai = { x: 0, y: 1, z: 2 }[axis];
  a[ai] = -h; b[ai] = h;
  return new CapsuleCollider({ ...base, radius: r, start: a, end: b, offsetMatrix: off });
}

// Превратить что угодно (Collider | Object3D | описание {type,...}) в коллайдер.
export function toCollider(x) {
  if (x instanceof Collider) return x;
  if (x && x.isObject3D) return colliderFromObject(x);
  if (x && typeof x === 'object' && x.type) return colliderFromJSON(x);
  throw new Error('SoftFlesh: не удалось создать коллайдер из ' + x);
}

export function colliderFromJSON(j, root = null) {
  const object = j.object && root ? root.getObjectByName(j.object) : j.objectRef || null;
  const o = { ...j, object };
  switch (j.type) {
    case 'sphere': return new SphereCollider(o);
    case 'capsule': return new CapsuleCollider(o);
    case 'box': return new BoxCollider(o);
    case 'plane': return new PlaneCollider(o);
    case 'mesh': if (object) return new MeshCollider(o); break;
  }
  throw new Error('SoftFlesh: неизвестный коллайдер ' + j.type);
}

// Капсулы по костям скелета («Bone Colliders»). Каждая капсула следует за своей костью.
// opts: bones (имена или функция-фильтр), radius, radiusMultiplier, margin, mirror, minLength.
export function collidersFromSkeleton(source, opts = {}) {
  const skeleton = source.isSkinnedMesh ? source.skeleton : source.isSkeleton ? source : null;
  const bones = skeleton ? skeleton.bones : [];
  if (!skeleton) source.traverse((o) => { if (o.isBone) bones.push(o); });
  let want = opts.bones;
  if (Array.isArray(want) && opts.mirror) {
    const extra = [];
    for (const n of want) {
      const m = n.replace(/([._-])(L|R|l|r|Left|Right)$/, (s, sep, side) => sep + ({ L: 'R', R: 'L', l: 'r', r: 'l', Left: 'Right', Right: 'Left' })[side]);
      if (m !== n) extra.push(m);
    }
    want = [...want, ...extra];
  }
  const pick = typeof want === 'function' ? want : Array.isArray(want) ? (b) => want.includes(b.name) : () => true;
  const group = new ColliderGroup(opts.name || 'bones');
  const mul = opts.radiusMultiplier ?? 1;
  const margin = opts.margin ?? 0.002;
  for (const bone of bones) {
    if (!pick(bone)) continue;
    const child = bone.children.find((c) => c.isBone);
    const end = child ? child.position.clone() : new THREE.Vector3(0, (opts.tipLength ?? 0.03), 0);
    const len = end.length();
    if (len < (opts.minLength ?? 1e-4)) continue;
    bone.updateWorldMatrix(true, false);
    const ws = bone.getWorldScale(new THREE.Vector3());
    const s = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;
    // radius и margin заданы в мировых единицах, переводим в локальные единицы кости
    const rWorld = typeof opts.radius === 'function' ? opts.radius(bone, len * s) : opts.radius ?? len * s * 0.22;
    const radius = (rWorld * mul + margin) / s;
    const col = new CapsuleCollider({ object: bone, name: 'COL_' + bone.name, radius, start: [0, 0, 0], end: end.toArray(), firmness: opts.firmness });
    col.bone = bone;
    group.add(col);
  }
  return group;
}
