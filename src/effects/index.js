import { Contact } from './Contact.js';
import { Squish, SquishInflate } from './Squish.js';
import { SquishOrganic } from './SquishOrganic.js';
import { FatJiggle } from './FatJiggle.js';
import { Ripple } from './Ripple.js';
import { Penetration } from './Penetration.js';
import { SlapWave } from './SlapWave.js';

// Реестр эффектов: тип-строка -> класс. Свои эффекты: registerEffect(MyEffect).
export const EFFECTS = { contact: Contact, squish: Squish, squishInflate: SquishInflate, squishOrganic: SquishOrganic, fatJiggle: FatJiggle, ripple: Ripple, penetration: Penetration, slapWave: SlapWave };

// Синонимы (как в аддонах)
const ALIASES = { fleshy: 'contact', 'squish&inflate': 'squishInflate', squish_inflate: 'squishInflate', organic: 'squishOrganic', jiggle: 'fatJiggle', fat: 'fatJiggle', slap: 'slapWave', wave: 'slapWave' };

export function registerEffect(Cls) { EFFECTS[Cls.type] = Cls; return Cls; }

export function createEffect(type, params = {}, opts = {}) {
  const t = EFFECTS[type] ? type : ALIASES[type] || ALIASES[String(type).toLowerCase()];
  const Cls = EFFECTS[t];
  if (!Cls) throw new Error(`SoftFlesh: неизвестный эффект "${type}". Доступно: ${Object.keys(EFFECTS).join(', ')}`);
  return new Cls(params, opts);
}

export { Contact, Squish, SquishInflate, SquishOrganic, FatJiggle, Ripple, Penetration, SlapWave };
