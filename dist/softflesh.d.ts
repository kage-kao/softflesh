// Типы SoftFlesh.js (для подсказок в редакторе и AI-агентов).
import type { Object3D, Mesh, SkinnedMesh, Vector3, Matrix4, Quaternion, BufferGeometry, AnimationClip, Skeleton, Bone } from 'three';

export const VERSION: string;

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra' | 'auto';
export interface QualitySettings {
  level: string; smoothingScale: number; maxRings: number; selfContact: boolean; selfContactEvery: number;
  jiggleRate: number; updateEvery: number; normals: boolean;
}
export const QUALITY: Record<'low' | 'medium' | 'high' | 'ultra', QualitySettings>;
export function resolveQuality(q?: QualityLevel | Partial<QualitySettings>): QualitySettings;
export function detectQuality(): 'low' | 'medium' | 'high';

export type Vec3 = [number, number, number];
export type ColliderLike = Collider | ColliderGroup | Object3D | Array<Collider | ColliderGroup | Object3D>;
export type MaskLike = Mask | string | ((x: number, y: number, z: number, i: number) => number) | ArrayLike<number> | object | null;

export type EffectType = 'contact' | 'squish' | 'squishInflate' | 'squishOrganic' | 'fatJiggle' | 'ripple' | 'penetration' | 'slapWave' | string;

export interface RegionDef { name?: string; mask: MaskLike; params: Record<string, number | boolean>; }
export interface EffectOptions { name?: string; enabled?: boolean; mask?: MaskLike; regions?: RegionDef[]; colliders?: ColliderLike | null; }

export interface HitEvent {
  type: 'hit'; effect: Effect; softMesh: SoftMesh; collider: Collider;
  point: { x: number; y: number; z: number }; normal: Vec3; direction: Vec3; speed: number; strength: number;
}

export interface AddOptions extends EffectOptions {
  preset?: string;
  presetParams?: Record<string, Record<string, number | boolean>>;
  effect?: EffectType;
  params?: Record<string, number | boolean>;
  effects?: Array<{ type: EffectType; params?: Record<string, number | boolean> } & EffectOptions>;
  softBody?: boolean | Partial<SoftBodyParams>;
  meshFilter?: (mesh: Mesh) => boolean;
  cloneGeometry?: boolean;
  weldEpsilon?: number;
  name?: string;
}

export interface SoftFleshOptions { quality?: QualityLevel | Partial<QualitySettings>; adaptive?: boolean; budgetMs?: number; maxDt?: number; autoUpdateMatrices?: boolean; }

export class SoftFlesh {
  constructor(opts?: SoftFleshOptions);
  quality: QualitySettings;
  meshes: SoftMesh[];
  colliders: ColliderGroup;
  softBodies: SoftBodyGroup;
  time: number;
  paused: boolean;
  adaptive: boolean;
  budgetMs: number;
  stats: { ms: number; avgMs: number; meshes: number; activeNodes: number };
  add(object: Mesh | SkinnedMesh | Object3D, opts?: AddOptions): SoftMesh | SoftModel;
  remove(target: SoftMesh | SoftModel | Mesh | string): void;
  get(meshOrName: Mesh | string): SoftMesh | null;
  addCollider(x: Collider | Object3D | object, opts?: ColliderFitOptions): Collider;
  removeCollider(x: Collider | Object3D): void;
  colliderFor(obj: Object3D): Collider;
  createEffect(type: EffectType, params?: object, opts?: EffectOptions): Effect;
  on(type: 'hit', fn: (e: HitEvent) => void): () => void;
  on(type: 'quality', fn: (q: QualitySettings) => void): () => void;
  off(type: string, fn: Function): void;
  emit(type: string, ev: any): void;
  setQuality(q: QualityLevel | Partial<QualitySettings>): this;
  update(dt: number, opts?: { force?: boolean }): void;
  reset(): void;
  bake(opts?: BakeOptions): SoftFleshBake;
  playBake(bake: SoftFleshBake, opts?: { meshes?: Array<SoftMesh | SoftModel>; speed?: number; timeSource?: () => number }): this;
  stopBake(meshes?: Array<SoftMesh | SoftModel>): this;
  toJSON(): object;
  loadJSON(json: object | string, root?: Object3D): SoftMesh[];
  dispose(): void;
}
export { SoftFlesh as World };
export default SoftFlesh;

export class SoftModel {
  readonly isSoftModel: true;
  meshes: SoftMesh[];
  readonly effects: Effect[];
  addEffect(type: EffectType | Effect, params?: object, opts?: EffectOptions): Effect[];
  applyPreset(name: string, overrides?: PresetOverrides): Effect[];
  getEffects(type: EffectType): Effect[];
  set(type: EffectType, params: object): this;
  enable(on?: boolean): this;
  reset(): void;
  find(name: string): SoftMesh | null;
  toJSON(): object[];
}

export interface PresetOverrides { colliders?: ColliderLike; mask?: MaskLike; regions?: RegionDef[]; params?: Record<string, Record<string, number | boolean>>; softBody?: false | Partial<SoftBodyParams>; }

export class SoftMesh {
  readonly isSoftMesh: true;
  world: SoftFlesh | null;
  mesh: Mesh | SkinnedMesh;
  name: string;
  enabled: boolean;
  effects: Effect[];
  mode: 'live' | 'baked';
  nodeCount: number;
  activeCount: number;
  topo: Topology;
  base: Float32Array; baseN: Float32Array; disp: Float32Array; vel: Float32Array;
  center: Vector3; radius: number;
  addEffect<T extends Effect = Effect>(effect: EffectType | T, params?: object, opts?: EffectOptions): T;
  removeEffect(effect: Effect): void;
  getEffect<T extends Effect = Effect>(typeOrName: string): T | null;
  getEffects(type: EffectType): Effect[];
  clearEffects(): void;
  applyPreset(name: string, overrides?: PresetOverrides): Effect[];
  output(name: string): { attr: any; node: Float32Array };
  nearestNode(p: { x: number; y: number; z: number }): number;
  reset(): void;
  dispose(): void;
  toJSON(): object;
}

export class Effect {
  static type: string;
  static defaults: Record<string, number | boolean>;
  type: string; name: string; enabled: boolean;
  params: Record<string, any>;
  mask: Mask; regions: RegionDef[];
  colliders: ColliderLike | null;
  energy: number;
  sm: SoftMesh | null;
  constructor(params?: object, opts?: EffectOptions);
  set(params: Record<string, number | boolean>): this;
  setMask(mask: MaskLike): this;
  setRegions(regions: RegionDef[]): this;
  addRegion(mask: MaskLike, params: object, name?: string): this;
  setColliders(c: ColliderLike | null): this;
  enable(on?: boolean): this;
  resolveColliders(): Collider[];
  maskNodes(): Float32Array;
  nodeParam(name: string): Float32Array;
  apply(ctx: { dt: number; time: number; world: SoftFlesh }): void;
  reset(): void;
  hit(point: { x: number; y: number; z: number }, strength?: number, direction?: Vec3 | null): void;
  toJSON(): object;
}
export class ContactEffect extends Effect { solver: ContactSolver; tracker: ImpulseTracker; lastHit: HitEvent | null; onHit(ev: HitEvent): void; }
export class Contact extends ContactEffect {}
export class Squish extends ContactEffect {}
export class SquishInflate extends Squish {}
export class SquishOrganic extends ContactEffect {}
export class FatJiggle extends ContactEffect { sleeping: boolean; hit(point: { x: number; y: number; z: number }, strength?: number, direction?: Vec3 | null, forwarded?: boolean): void; }
export class Ripple extends ContactEffect {}
export class Penetration extends Effect {}
export class SlapWave extends ContactEffect { trigger(o: { point: { x: number; y: number; z: number }; direction?: Vec3 | Vector3 | null; strength?: number }): this; }
export const EFFECTS: Record<string, typeof Effect>;
export function registerEffect<T extends typeof Effect>(cls: T): T;
export function createEffect(type: EffectType, params?: object, opts?: EffectOptions): Effect;

export interface ColliderOptions { name?: string; enabled?: boolean; object?: Object3D | null; position?: Vec3; quaternion?: [number, number, number, number]; scale?: number; offsetMatrix?: Matrix4 | null; firmness?: number; side?: 'outside' | 'inside'; }
export class Collider {
  id: number; type: string; name: string; enabled: boolean; object: Object3D | null;
  position: Vector3; quaternion: Quaternion; scale: number; firmness: number; side: 'outside' | 'inside';
  center: Vector3; radius: number; velocity: Vector3; matrix: Matrix4;
  constructor(opts?: ColliderOptions);
  attach(object: Object3D, offsetMatrix?: Matrix4 | null): this;
  update(dt: number, frame: number): void;
  resetMotion(): void;
  sdf(x: number, y: number, z: number, out: { d: number; nx: number; ny: number; nz: number }): number;
  velocityAt(x: number, y: number, z: number, out: Float32Array | number[]): Float32Array | number[];
  toJSON(): object;
}
export class SphereCollider extends Collider { constructor(opts?: ColliderOptions & { radius?: number; center?: Vec3 }); r: number; }
export class CapsuleCollider extends Collider { constructor(opts?: ColliderOptions & { radius?: number; endRadius?: number; height?: number; start?: Vec3; end?: Vec3 }); r: number; r2: number; a: Vector3; b: Vector3; }
export class BoxCollider extends Collider { constructor(opts?: ColliderOptions & { size?: Vec3; rounding?: number }); }
export class PlaneCollider extends Collider { constructor(opts?: ColliderOptions & { size?: [number, number]; thickness?: number }); }
export class MeshCollider extends Collider { constructor(opts?: ColliderOptions & { geometry?: BufferGeometry; reach?: number }); }
export class ColliderGroup {
  readonly isColliderGroup: true; name: string; items: Collider[]; readonly size: number;
  constructor(name?: string, colliders?: Array<Collider | Object3D>);
  add(c: Collider | Object3D | object): Collider; remove(c: Collider | Object3D): void; clear(): void;
}
export interface ColliderFitOptions { shape?: 'auto' | 'sphere' | 'capsule' | 'box' | 'mesh'; margin?: number; firmness?: number; side?: 'outside' | 'inside'; reach?: number; }
export function colliderFromObject(object: Object3D, opts?: ColliderFitOptions): Collider;
export function collidersFromSkeleton(source: SkinnedMesh | Skeleton | Object3D, opts?: { bones?: string[] | ((b: Bone) => boolean); radius?: number | ((bone: Bone, length: number) => number); radiusMultiplier?: number; margin?: number; mirror?: boolean; tipLength?: number; minLength?: number; firmness?: number; name?: string }): ColliderGroup;
export function colliderFromJSON(j: object, root?: Object3D | null): Collider;
export function toCollider(x: any): Collider;

export class Mask {
  spec: any;
  static all(): Mask;
  static attribute(name: string, channel?: number | string): Mask;
  static color(channel?: 'r' | 'g' | 'b' | 'a', attribute?: string): Mask;
  static bones(names: string | string[], opts?: { includeChildren?: boolean }): Mask;
  static sphere(center: Vec3, radius: number, falloff?: number): Mask;
  static box(min: Vec3, max: Vec3, falloff?: number): Mask;
  static fn(f: (x: number, y: number, z: number, i: number) => number): Mask;
  static values(arr: ArrayLike<number>): Mask;
  static max(...m: MaskLike[]): Mask;
  static min(...m: MaskLike[]): Mask;
  static multiply(...m: MaskLike[]): Mask;
  static subtract(a: MaskLike, b: MaskLike): Mask;
  static from(x: MaskLike): Mask;
  static fromJSON(j: object): Mask;
  invert(): Mask; blur(rings?: number): Mask; normalize(): Mask; scale(k: number): Mask; threshold(t?: number): Mask;
  resolve(mesh: Mesh, topo: Topology): Float32Array;
  resolveVertices(mesh: Mesh, topo: Topology): Float32Array;
  toJSON(): object;
}

export interface SoftBodyParams { yield: number; cushion: number; skinGap: number; volumePreservation: number; bulgeSpread: number; bulgeFocus: number; smoothing: number; mask: MaskLike; }
export const softBodyDefaults: SoftBodyParams;
export class SoftBodyGroup {
  enabled: boolean; readonly count: number;
  add(sm: SoftMesh | SoftModel, params?: Partial<SoftBodyParams>): this;
  set(sm: SoftMesh, params: Partial<SoftBodyParams>): this;
  remove(sm: SoftMesh): this;
  toJSON(): object[];
}

export interface BakeOptions { frames?: number; duration?: number; fps?: number; warmup?: number; meshes?: Array<SoftMesh | SoftModel>; onFrame?: (frame: number, dt: number, time: number) => void; onProgress?: (p: number) => void; smoothPops?: boolean; popThreshold?: number; loop?: boolean; }
export class SoftFleshBake {
  readonly isSoftFleshBake: true; fps: number; loop: boolean; tracks: any[];
  readonly frameCount: number; readonly duration: number;
  static record(world: SoftFlesh, opts?: BakeOptions): SoftFleshBake;
  static fromJSON(j: object | string): SoftFleshBake;
  smoothPops(threshold?: number): this;
  applyTo(sm: SoftMesh, time: number): boolean;
  apply(target: SoftMesh | SoftModel | SoftFlesh, time: number): void;
  toAnimationClip(sm: SoftMesh, opts?: { step?: number; name?: string; trackPrefix?: string }): AnimationClip;
  toJSON(): object;
}

export interface PresetDef { description: string; effects: Array<{ type: EffectType; params: object }>; softBody?: Partial<SoftBodyParams>; }
export const PRESETS: Record<string, PresetDef>;
export function registerPreset(name: string, def: PresetDef): PresetDef;
export function getPreset(name: string): PresetDef;
export function listPresets(): Array<{ name: string; description: string }>;

export class Topology { nodeCount: number; vertexCount: number; meanEdge: number; vertToNode: Int32Array; nodeRest: Float32Array; boundary: Uint8Array; }
export class ContactSolver { count: number; volume: number; maxDepth: number; }
export class SelfContact {}
export class ImpulseTracker { readonly holding: boolean; }
