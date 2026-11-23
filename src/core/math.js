// Мелкая математика без аллокаций: работа напрямую с Float32Array.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// Длина вектора (быстрее Math.hypot), z можно опустить
export const len3 = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};

// Профиль выпуклости: 0 в x=0 и x=1, максимум 1 при x=1/3.
export const bulgeProfile = (x) => (x <= 0 || x >= 1 ? 0 : 6.75 * x * (1 - x) * (1 - x));

// Решение T * x = v для матрицы 3x3 (column-major как в three.js), результат в out[o..o+2].
export function solve3(t, k, vx, vy, vz, out, o) {
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

// Детерминированный value-noise для «органических» неровностей.
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

// Результат запроса расстояния до коллайдера (переиспользуемый объект).
export function makeHit() {
  return { d: Infinity, nx: 0, ny: 1, nz: 0, collider: null, index: -1 };
}
