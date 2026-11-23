import { ContactEffect } from './ContactEffect.js';
import { smoothstep } from '../core/math.js';

// Contact — эффект касания в духе Fleshy: вмятина в точке контакта и мягкая выпуклость вокруг.
// Автоматически находит касания с коллайдерами и с самим собой (selfContact).

export class Contact extends ContactEffect {
  static type = 'contact';
  static defaults = {
    bulge: 1, // сила выпуклости: 1 — объём сохраняется, 0 — чистая вмятина (подушка)
    bulgeWidth: 15, // ширина выпуклости в рядах (кольцах) вершин
    dent: 15, // Dent %: мягкая «воронка» вокруг вмятины
    firmness: 0, // Firmness %: плотная плоть продавливается меньше
    smoothing: 4, // сглаживание результата
    collisionOffset: 0.001, // толщина «кожи» между плотью и коллайдером
    splay: 0.25, // 0 — сплющивание вдоль оси давления, 1 — растекание по нормали коллайдера
    lateralFlow: 0, // смещение выпуклости вдоль поверхности от центра контакта
    cornerTaper: false, // меньше выпуклости в сгибах (колени, локти)
    taperAmount: 1,
    taperReach: 0.85,
    taperFalloff: 1,
    closeOpenings: false, // защита от ложных касаний у открытых краёв меша
    openingRings: 3,
    selfContact: true, // касание объекта с самим собой
    selfGap: 0.0005,
    exactContact: 1,
    minHitSpeed: 0.15,
    impactSensitivity: 1.5,
  };
  static regionParams = ['bulge', 'bulgeWidth', 'dent', 'firmness', 'taperAmount'];

  apply() {
    const p = this.params, q = this.quality, s = this.solver;
    if (!this.gatherContacts(p.selfContact, { gap: p.selfGap })) return;
    const firm = this.nodeParam('firmness');
    const scale = this._scale || (this._scale = new Float32Array(this.sm.nodeCount));
    if (this._scaleSrc !== firm) { for (let n = 0; n < firm.length; n++) scale[n] = 1 - 0.85 * Math.min(firm[n], 100) / 100; this._scaleSrc = firm; }
    const regional = this.hasRegionParam('bulgeWidth');
    const W = regional ? this.nodeParam('bulgeWidth') : p.bulgeWidth;
    let maxW = p.bulgeWidth;
    if (regional) for (const r of this.regions) if (r.params.bulgeWidth > maxW) maxW = r.params.bulgeWidth;
    const rings = Math.min(Math.round(maxW) + 2, q.maxRings);
    const dent = this.hasRegionParam('dent') ? Math.max(p.dent, ...this.regions.map((r) => r.params.dent ?? 0)) : p.dent;
    s.computeDent({
      scale, splay: p.splay, axisIters: 3, rings,
      rimIters: Math.round((2 + maxW * 0.3) * q.smoothingScale), rim: Math.min(1, dent / 50),
    });
    let taper = null;
    if (p.cornerTaper) {
      taper = this._taper || (this._taper = new Float32Array(this.sm.nodeCount));
      const amt = this.nodeParam('taperAmount');
      const c0 = (1 - p.taperReach) * 0.4, c1 = c0 + p.taperFalloff * 0.6 + 0.05;
      for (let i = 0; i < s.regionCount; i++) {
        const n = s.region[i];
        taper[n] = 1 - amt[n] * smoothstep(c0, c1, this.concavity(n));
      }
    }
    s.bulge({ volume: 1, rings: W, mask: this.maskNodes(), bulgeMul: this.nodeParam('bulge'), taper, lateralFlow: p.lateralFlow });
    s.smooth(p.smoothing * q.smoothingScale);
    s.commit();
  }
}
