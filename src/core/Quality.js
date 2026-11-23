// Уровни качества для слабых устройств / мобильных.
export const QUALITY = {
  low: { level: 'low', smoothingScale: 0.5, maxRings: 10, selfContact: false, selfContactEvery: 4, jiggleRate: 60, updateEvery: 2, normals: true },
  medium: { level: 'medium', smoothingScale: 0.75, maxRings: 16, selfContact: true, selfContactEvery: 3, jiggleRate: 90, updateEvery: 1, normals: true },
  high: { level: 'high', smoothingScale: 1, maxRings: 24, selfContact: true, selfContactEvery: 2, jiggleRate: 120, updateEvery: 1, normals: true },
  ultra: { level: 'ultra', smoothingScale: 1.25, maxRings: 32, selfContact: true, selfContactEvery: 1, jiggleRate: 180, updateEvery: 1, normals: true },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

export function detectQuality() {
  if (typeof navigator === 'undefined') return 'high';
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile) return cores >= 8 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export function resolveQuality(q) {
  if (q && typeof q === 'object') return { ...QUALITY[q.level || 'high'], ...q };
  const name = !q || q === 'auto' ? detectQuality() : q;
  if (!QUALITY[name]) throw new Error('SoftFlesh: неизвестное качество ' + q);
  return { ...QUALITY[name] };
}
