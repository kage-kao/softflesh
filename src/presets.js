// Готовые пресеты. Каждый — набор эффектов с параметрами (+ опционально мягкое тело).
// Свой пресет: registerPreset('имя', { description, effects: [{ type, params }] }).

export const PRESETS = {
  pillow: {
    description: 'Подушка: чистая вмятина без выпуклости, мягкая воронка вокруг',
    effects: [{ type: 'contact', params: { bulge: 0, dent: 60, bulgeWidth: 10, smoothing: 6, selfContact: false } }],
  },
  mattress: {
    description: 'Матрас: широкая неглубокая вмятина, лёгкая упругость',
    effects: [{ type: 'contact', params: { bulge: 0.2, dent: 50, firmness: 20, bulgeWidth: 20, smoothing: 6, selfContact: false } }],
  },
  cushion: {
    description: 'Диванная подушка: сплющивание с небольшим возвратом объёма',
    effects: [{ type: 'squish', params: { volumePreservation: 0.3, shapeSmoothing: 8, spread: 12, correctiveSmooth: 6 } }],
  },
  softCharacter: {
    description: 'Мягкий персонаж: вмятины и выпуклости от касаний, складки в сгибах, защита у краёв одежды',
    effects: [{ type: 'contact', params: { bulge: 1, dent: 15, bulgeWidth: 15, smoothing: 4, cornerTaper: true, closeOpenings: true, selfContact: true } }],
  },
  firmCharacter: {
    description: 'Плотный/спортивный персонаж: продавливается меньше',
    effects: [{ type: 'contact', params: { bulge: 0.7, dent: 8, firmness: 45, bulgeWidth: 10, cornerTaper: true, closeOpenings: true } }],
  },
  jelly: {
    description: 'Желе: сплющивание с раздуванием, долгая тряска, рябь от ударов',
    effects: [
      { type: 'squishInflate', params: { volumePreservation: 0.35, inflatePressure: 1 } },
      { type: 'fatJiggle', params: { amplitude: 0.5, wobbleSpeed: 2.4, relaxTime: 1.4, decay: 1.6, lateralMotion: 1.2, normalMotion: 0.9, dentDepth: 0 } },
      { type: 'ripple', params: { amplitude: 0.02, waveSpeed: 0.8, relaxTime: 0.8, dentDepth: 0 } },
    ],
  },
  ball: {
    description: 'Надувной мяч: объём сохраняется, тело раздувается по бокам',
    effects: [{ type: 'squishInflate', params: { squishStrength: 1, volumePreservation: 0.15, inflatePressure: 1, shapeSmoothing: 6, spread: 14, correctiveSmooth: 6 } }],
  },
  stressBall: {
    description: 'Мячик-антистресс: валик вокруг пальцев, морщины, медленное восстановление',
    effects: [{ type: 'squishOrganic', params: { skinTension: 0.7, wrinkleDepth: 0.2, jiggle: 0.15, stiffness: 0.25 } }],
  },
  slime: {
    description: 'Слайм: текучее органичное сплющивание и вязкая тряска',
    effects: [
      { type: 'squishOrganic', params: { skinTension: 0.4, wrinkleDepth: 0, jiggle: 0.8, stiffness: 0.1, relaxTime: 1.5 } },
      { type: 'fatJiggle', params: { amplitude: 0.6, wobbleSpeed: 1.6, relaxTime: 2, dentDepth: 0 } },
    ],
  },
  belly: {
    description: 'Живот: сплющивание с раздуванием + тряска при движении',
    effects: [
      { type: 'squishInflate', params: {} },
      { type: 'fatJiggle', params: { amplitude: 0.3, wobbleSpeed: 3, relaxTime: 0.6, dentDepth: 0 } },
    ],
  },
  glutes: {
    description: 'Ягодицы: сплющивание, тряска жира, рябь от шлепка',
    effects: [
      { type: 'squish', params: { volumePreservation: 0.7 } },
      { type: 'fatJiggle', params: { amplitude: 0.25, wobbleSpeed: 3.8, dentDepth: 0 } },
      { type: 'ripple', params: { amplitude: 0.015, fat: true, dentDepth: 0 } },
    ],
  },
  breasts: {
    description: 'Грудь: сплющивание с раздуванием, мягкая инерционная тряска',
    effects: [
      { type: 'squishInflate', params: { selfCollision: true } },
      { type: 'fatJiggle', params: { amplitude: 0.3, wobbleSpeed: 3.2, relaxTime: 0.7, lateralMotion: 0.8, dentDepth: 0 } },
    ],
  },
  waterbed: {
    description: 'Водяной матрас: вмятина и долгие волны',
    effects: [
      { type: 'contact', params: { bulge: 0.5, dent: 40, selfContact: false } },
      { type: 'ripple', params: { amplitude: 0.03, waveSpeed: 1.2, decay: 0.5, relaxTime: 1.5, fat: true, fatAmplitude: 0.015, dentDepth: 0 } },
    ],
  },
  punchingBag: {
    description: 'Боксёрская груша / мягкий манекен: вмятина, волна от удара, лёгкая тряска',
    effects: [
      { type: 'squish', params: { volumePreservation: 0.5 } },
      { type: 'slapWave', params: { amplitude: 0.01, speed: 2 } },
      { type: 'fatJiggle', params: { amplitude: 0.12, wobbleSpeed: 4.5, relaxTime: 0.4, dentDepth: 0 } },
    ],
  },
  creature: {
    description: 'Мягкое существо: желеобразное тело, давит на другие мягкие тела',
    effects: [
      { type: 'squishInflate', params: { volumePreservation: 0.4 } },
      { type: 'fatJiggle', params: { amplitude: 0.35, wobbleSpeed: 2.8, relaxTime: 0.9, dentDepth: 0 } },
    ],
    softBody: { yield: 1, volumePreservation: 1 },
  },
};

export function registerPreset(name, def) { PRESETS[name] = def; return def; }
export function getPreset(name) {
  const p = PRESETS[name];
  if (!p) throw new Error(`SoftFlesh: пресет "${name}" не найден. Доступно: ${Object.keys(PRESETS).join(', ')}`);
  return JSON.parse(JSON.stringify(p));
}
export function listPresets() { return Object.entries(PRESETS).map(([name, p]) => ({ name, description: p.description })); }
