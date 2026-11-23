import * as THREE from 'three';

// Базовый коллайдер. Работает как поле расстояний со знаком (SDF) в мировых координатах:
// d < 0 — точка внутри, нормаль указывает наружу из коллайдера.
// Коллайдер может следовать за любым Object3D (attach) или задаваться своим положением.

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
let _ids = 0;

export class Collider {
  constructor(opts = {}) {
    this.id = ++_ids;
    this.type = 'base';
    this.name = opts.name || '';
    this.enabled = opts.enabled !== false;
    this.object = opts.object || null;
    this.position = new THREE.Vector3().fromArray(opts.position || [0, 0, 0]);
    this.quaternion = opts.quaternion ? new THREE.Quaternion().fromArray(opts.quaternion) : new THREE.Quaternion();
    this.scale = opts.scale || 1;
    this.offsetMatrix = opts.offsetMatrix ? opts.offsetMatrix.clone() : null; // локальное смещение относительно object
    // Firmness коллайдера (0..100): насколько сильно он продавливает плоть.
    this.firmness = opts.firmness ?? 100;
    // 'outside' — давит снаружи (руки, предметы); 'inside' — распирает изнутри (кость под кожей).
    this.side = opts.side || 'outside';
    this.matrix = new THREE.Matrix4();
    this.prevMatrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.worldScale = 1;
    this.center = new THREE.Vector3();
    this.radius = 1;
    this._frame = -1;
    this._hasPrev = false;
    this._dt = 1 / 60;
    this.velocity = new THREE.Vector3();
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
  localRadius() { return 1; }
  // Локальное SDF: записывает d и нормаль в out (переопределяется).
  localSdf(x, y, z, out) { out.d = Math.hypot(x, y, z) - 1; }

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
    if (!this._hasPrev) { this.prevMatrix.copy(this.matrix); this._hasPrev = true; }
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
  resetMotion() { this._hasPrev = false; }

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
    out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
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
    out[0] = (px - qx) * idt; out[1] = (py - qy) * idt; out[2] = (pz - qz) * idt;
    return out;
  }

  // Ближайшая точка оси (для Penetration); по умолчанию — центр.
  axisPoint(px, py, pz, out) { out[0] = this.center.x; out[1] = this.center.y; out[2] = this.center.z; return false; }

  toJSON() {
    return {
      type: this.type, name: this.name, enabled: this.enabled, firmness: this.firmness, side: this.side,
      object: this.object ? this.object.name : null,
      position: this.position.toArray(), quaternion: this.quaternion.toArray(), scale: this.scale,
      ...this.shapeJSON(),
    };
  }
  shapeJSON() { return {}; }
}

export class SphereCollider extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = 'sphere';
    this.r = opts.radius ?? 0.1;
    this.localCenter = new THREE.Vector3().fromArray(opts.center || [0, 0, 0]);
  }
  localRadius() { return this.r + this.localCenter.length(); }
  localSdf(x, y, z, out) {
    x -= this.localCenter.x; y -= this.localCenter.y; z -= this.localCenter.z;
    const l = Math.sqrt(x * x + y * y + z * z);
    out.d = l - this.r;
    if (l > 1e-9) { out.nx = x / l; out.ny = y / l; out.nz = z / l; } else { out.nx = 0; out.ny = 1; out.nz = 0; }
  }
  shapeJSON() { return { radius: this.r, center: this.localCenter.toArray() }; }
}

// Капсула: отрезок a-b с радиусом. По умолчанию вдоль локальной оси Y, длина = height (без полусфер).
export class CapsuleCollider extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = 'capsule';
    this.r = opts.radius ?? 0.03;
    const h = opts.height ?? 0.1;
    this.a = new THREE.Vector3().fromArray(opts.start || [0, -h / 2, 0]);
    this.b = new THREE.Vector3().fromArray(opts.end || [0, h / 2, 0]);
    this.r2 = opts.endRadius ?? this.r; // «сферическая капсула»: разные радиусы концов
  }
  localRadius() { return Math.max(this.a.length(), this.b.length()) + Math.max(this.r, this.r2); }
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
    if (l > 1e-9) { out.nx = dx / l; out.ny = dy / l; out.nz = dz / l; } else { out.nx = 1; out.ny = 0; out.nz = 0; }
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
  shapeJSON() { return { radius: this.r, endRadius: this.r2, start: this.a.toArray(), end: this.b.toArray() }; }
}

// Скруглённый бокс: halfSize + радиус скругления.
export class BoxCollider extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = 'box';
    const s = opts.size || [0.2, 0.2, 0.2];
    this.round = opts.rounding ?? 0.005;
    this.h = new THREE.Vector3(s[0] / 2 - this.round, s[1] / 2 - this.round, s[2] / 2 - this.round).max(new THREE.Vector3(1e-6, 1e-6, 1e-6));
  }
  localRadius() { return this.h.length() + this.round; }
  localSdf(x, y, z, out) {
    const qx = Math.abs(x) - this.h.x, qy = Math.abs(y) - this.h.y, qz = Math.abs(z) - this.h.z;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const inside = Math.min(Math.max(qx, qy, qz), 0);
    out.d = outside + inside - this.round;
    if (outside > 1e-9) { out.nx = Math.sign(x) * ox / outside; out.ny = Math.sign(y) * oy / outside; out.nz = Math.sign(z) * oz / outside; }
    else if (qx >= qy && qx >= qz) { out.nx = Math.sign(x) || 1; out.ny = 0; out.nz = 0; }
    else if (qy >= qz) { out.nx = 0; out.ny = Math.sign(y) || 1; out.nz = 0; }
    else { out.nx = 0; out.ny = 0; out.nz = Math.sign(z) || 1; }
  }
  shapeJSON() { return { size: [(this.h.x + this.round) * 2, (this.h.y + this.round) * 2, (this.h.z + this.round) * 2], rounding: this.round }; }
}

// Полупространство: всё ниже локальной плоскости y=0 — «внутри». size ограничивает плоскость (0 = бесконечная).
export class PlaneCollider extends Collider {
  constructor(opts = {}) {
    super(opts);
    this.type = 'plane';
    this.size = opts.size || [0, 0];
    this.thickness = opts.thickness ?? 1;
  }
  localRadius() { return this.size[0] ? Math.hypot(this.size[0], this.size[1]) / 2 + this.thickness : 1e6; }
  localSdf(x, y, z, out) {
    out.nx = 0; out.ny = 1; out.nz = 0;
    out.d = y < -this.thickness ? -y - 2 * this.thickness : y;
    if (this.size[0] && (Math.abs(x) > this.size[0] / 2 || Math.abs(z) > this.size[1] / 2)) out.d = Math.max(out.d, 1e3);
  }
  shapeJSON() { return { size: this.size, thickness: this.thickness }; }
}
