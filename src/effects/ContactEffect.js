import { Effect } from './Effect.js';
import { ContactSolver, SelfContact, ImpulseTracker } from '../core/contact.js';

// Общая часть эффектов, работающих от контакта: решатель, самоконтакт, импульсы ударов.
export class ContactEffect extends Effect {
  init() {
    this.solver = new ContactSolver(this.sm);
    this.self = null;
    this.tracker = new ImpulseTracker();
    this.lastHit = null;
  }

  reset() {
    if (this.solver) this.solver.clear();
    this.energy = 0;
  }

  get quality() { return this.world.quality; }

  // Поиск контактов + самоконтакт + удары. Возвращает число контактов.
  gatherContacts(selfOn, selfParams = {}) {
    const p = this.params, s = this.solver;
    s.clear();
    const mask = this.maskNodes(), nodes = this.nodeList();
    s.detect(this.resolveColliders(), nodes, mask, { offset: p.collisionOffset, closeOpenings: p.closeOpenings, openingRings: p.openingRings });
    if (selfOn && this.quality.selfContact) {
      if (!this.self) this.self = new SelfContact(this.sm);
      this.self.detect(s, nodes, mask, selfParams);
    }
    this.tracker.update(s, p, (h) => this._onHit(h));
    return s.count;
  }

  _onHit(h) {
    const b = this.sm.base, n = h.node;
    const point = { x: b[3 * n], y: b[3 * n + 1], z: b[3 * n + 2] };
    const ev = { type: 'hit', effect: this, softMesh: this.sm, collider: h.collider, point, normal: h.normal, direction: h.direction, speed: h.speed, strength: h.strength };
    this.lastHit = ev;
    this.onHit(ev);
    this.world.emit('hit', ev);
  }

  onHit() {}

  // Карта «сжатия складки» для Corner Taper: >0 — вогнутость (сгиб колена/локтя).
  concavity(n) {
    const { base, baseN, topo, meanEdgeWorld } = this.sm;
    let cx = 0, cy = 0, cz = 0;
    const a = topo.adjStart[n], b = topo.adjStart[n + 1];
    for (let k = a; k < b; k++) { const j = topo.adj[k]; cx += base[3 * j]; cy += base[3 * j + 1]; cz += base[3 * j + 2]; }
    const c = b - a || 1;
    cx = cx / c - base[3 * n]; cy = cy / c - base[3 * n + 1]; cz = cz / c - base[3 * n + 2];
    return (cx * baseN[3 * n] + cy * baseN[3 * n + 1] + cz * baseN[3 * n + 2]) / (meanEdgeWorld || 1);
  }
}
