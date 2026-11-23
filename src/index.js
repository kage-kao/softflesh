// SoftFlesh.js — мягкие деформации для веб-игр на Three.js.
export { SoftFlesh, SoftFlesh as World, SoftModel, VERSION } from './SoftFlesh.js';
export { SoftMesh } from './core/SoftMesh.js';
export { SoftBodyGroup, softBodyDefaults } from './core/SoftBodyGroup.js';
export { SoftFleshBake } from './core/Bake.js';
export { Mask } from './core/Mask.js';
export { QUALITY, resolveQuality, detectQuality } from './core/Quality.js';
export { Topology } from './core/Topology.js';
export { ContactSolver, SelfContact, ImpulseTracker } from './core/contact.js';
export { Collider, SphereCollider, CapsuleCollider, BoxCollider, PlaneCollider } from './colliders/Collider.js';
export { MeshCollider } from './colliders/MeshCollider.js';
export { ColliderGroup, colliderFromObject, collidersFromSkeleton, colliderFromJSON, toCollider } from './colliders/factory.js';
export { Effect } from './effects/Effect.js';
export { ContactEffect } from './effects/ContactEffect.js';
export { EFFECTS, registerEffect, createEffect, Contact, Squish, SquishInflate, SquishOrganic, FatJiggle, Ripple, Penetration, SlapWave } from './effects/index.js';
export { PRESETS, registerPreset, getPreset, listPresets } from './presets.js';
export { SoftFlesh as default } from './SoftFlesh.js';
