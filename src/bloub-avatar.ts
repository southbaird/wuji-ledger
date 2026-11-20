import { BotEngine, type BotFrame } from './vendor/bloub/engine';
import {
  EXPRESSIONS,
  EXPRESSION_BY_ID,
  type ExpressionId,
} from './vendor/bloub/expressions';
import { RAYON } from './vendor/bloub/repere';
import { SHAPES, SHAPE_BY_ID, type ShapeId } from './vendor/bloub/skins';
import { STATE_BY_ID, type StateId } from './vendor/bloub/states';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COMBINATION_SECONDS = 14;
const SPECIAL_START_SECONDS = 5.2;
const FRAME_INTERVAL_MS = 1000 / 30;
const VIEWBOX_RADIUS = 138;

/**
 * Keep the compact avatar readable at 44–118 px. The upstream orbit/comet
 * scenes are intentionally omitted here: their rainbow trails disappear at
 * this scale and would violate the ledger's three-colour theme contract.
 */
export const BLOUB_MOTION_STATES = [
  'thinking',
  'wink',
  'wide',
  'alert',
  'notify',
  'exclaim',
] as const satisfies readonly StateId[];

export type BloubTone = 'primary' | 'secondary' | 'ink';
export type BloubShape = ShapeId;

export interface BloubVariant {
  shapeId: ShapeId;
  expressionId: ExpressionId;
  tone: BloubTone;
  motionState: (typeof BLOUB_MOTION_STATES)[number];
}

export interface BloubAvatarOptions {
  seed: number;
  epochMs: number;
  tone?: BloubTone;
  shape?: BloubShape;
  decorative?: boolean;
  label?: string;
}

export interface BloubAvatarController {
  readonly variant: BloubVariant;
  attach(host: HTMLElement): void;
  reroll(seed: number, epochMs: number): void;
  dispose(): void;
}

const SHAPE_LABELS: Record<ShapeId, string> = {
  cercle: '圆形',
  galet: '鹅卵石',
  squircle: '圆角方形',
  capsule: '胶囊',
  triangle: '三角形',
  hexagone: '六边形',
  nuage: '云朵',
  goutte: '水滴',
};

const EXPRESSION_LABELS: Record<ExpressionId, string> = {
  neutre: '平静',
  attentif: '专注',
  surpris: '惊讶',
  excite: '兴奋',
  heureux: '开心',
  hilare: '大笑',
  colere: '生气',
  triste: '难过',
  effraye: '紧张',
  mefiant: '怀疑',
  confus: '困惑',
  curieux: '好奇',
  fier: '得意',
  timide: '害羞',
  blase: '淡定',
  somnolent: '困倦',
};

const TONES: readonly BloubTone[] = ['primary', 'secondary', 'ink'];
let avatarId = 0;

interface DotNodes {
  circle: SVGCircleElement;
  path: SVGPathElement;
}

interface Schedule {
  bucket: number;
  bucketStart: number;
  local: number;
  variant: BloubVariant;
  specialEnd: number;
  desiredState: StateId;
}

interface SvgScene {
  svg: SVGSVGElement;
  maskBody: SVGPathElement;
  maskEyes: [SVGPathElement, SVGPathElement];
  maskNotch: SVGCircleElement;
  bodyFill: SVGRectElement;
  bodyGroup: SVGGElement;
  dotsBehind: SVGGElement;
  dotsFront: SVGGElement;
  behindDots: DotNodes[];
  frontDots: DotNodes[];
  notification: SVGCircleElement;
}

export function createBloubSeed(): number {
  const cryptoApi = window.crypto;
  if (cryptoApi?.getRandomValues) {
    return cryptoApi.getRandomValues(new Uint32Array(1))[0] ?? 0x51f15e;
  }
  return mix32(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
}

export function resolveDistinctBloubSeed(
  seed: number,
  previousExpression: ExpressionId,
): number {
  let candidate = seed >>> 0;
  for (let attempt = 0; attempt < EXPRESSIONS.length * 2; attempt += 1) {
    if (createBloubVariant(candidate, 0).expressionId !== previousExpression) {
      return candidate;
    }
    candidate = mix32(candidate + 0x9e3779b9 + attempt);
  }
  return candidate;
}

export function createBloubVariant(seed: number, bucket: number): BloubVariant {
  const current = rawVariant(seed, bucket);
  const previous = rawVariant(seed, bucket - 1);

  // A new round must visibly change even when every other dimension happens
  // to collide. Expressions already use a seeded, non-repeating cycle below.
  if (
    current.shapeId === previous.shapeId
    && current.tone === previous.tone
    && current.motionState === previous.motionState
  ) {
    const index = SHAPES.findIndex(({ id }) => id === current.shapeId);
    current.shapeId = SHAPES[(index + 1) % SHAPES.length]!.id;
  }

  return current;
}

export function describeBloubVariant(variant: BloubVariant): string {
  return `${SHAPE_LABELS[variant.shapeId]} · ${EXPRESSION_LABELS[variant.expressionId]}`;
}

export function createBloubAvatar(
  options: BloubAvatarOptions,
): BloubAvatarController {
  return new NativeBloubAvatar(options);
}

class NativeBloubAvatar implements BloubAvatarController {
  private seed: number;
  private epochMs: number;
  private readonly fixedTone?: BloubTone;
  private readonly fixedShape?: BloubShape;
  private readonly decorative: boolean;
  private readonly label: string;
  private host?: HTMLElement;
  private view?: Window;
  private environmentDocument?: Document;
  private media?: MediaQueryList;
  private observer?: IntersectionObserver;
  private scene?: SvgScene;
  private engine?: BotEngine;
  private currentBucket = Number.NaN;
  private currentState: StateId = 'idle';
  private currentVariant: BloubVariant;
  private reducedMotionBucket?: number;
  private frameRequest?: number;
  private lastFrameAt = -Infinity;
  private visible = true;
  private disposed = false;

  constructor(options: BloubAvatarOptions) {
    this.seed = options.seed >>> 0;
    this.epochMs = options.epochMs;
    this.fixedTone = options.tone;
    this.fixedShape = options.shape;
    this.decorative = options.decorative ?? false;
    this.label = options.label ?? '随机动态 Bloub 表情';
    this.currentVariant = withFixedAppearance(
      createBloubVariant(this.seed, 0),
      this.fixedTone,
      this.fixedShape,
    );
  }

  get variant(): BloubVariant {
    return { ...this.currentVariant };
  }

  attach(host: HTMLElement): void {
    if (this.disposed) {
      return;
    }

    const nextView = host.ownerDocument.defaultView;
    if (!nextView) {
      return;
    }
    const documentChanged = this.view !== nextView;
    if (documentChanged) {
      // Remove listeners from the previous document before switching the host.
      // Obsidian can move a view into a pop-out window, whose document has an
      // independent visibility lifecycle.
      this.stopEnvironment();
    }
    this.host = host;
    host.addClass('celtis-bloub-avatar');
    if (documentChanged || !this.scene) {
      this.view = nextView;
      this.scene = createSvgScene(host.ownerDocument, this.decorative, this.label);
      this.startEnvironment();
    }

    host.replaceChildren(this.scene.svg);
    // A view redraw replaces the host button while the controller survives.
    // Restore the current tone/data/accessible name even when the animation
    // bucket itself did not change.
    this.applyVariant(host, this.currentVariant);
    this.observer?.disconnect();
    this.observer?.observe(host);
    this.visible = true;
    this.renderNow(true);
    this.startLoop();
  }

  reroll(seed: number, epochMs: number): void {
    if (this.disposed) {
      return;
    }
    this.seed = seed >>> 0;
    this.epochMs = epochMs;
    this.currentBucket = Number.NaN;
    this.engine = undefined;
    this.currentState = 'idle';
    this.reducedMotionBucket = undefined;
    this.renderNow(true);
    this.startLoop();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopEnvironment();
    this.host = undefined;
    this.scene?.svg.remove();
    this.scene = undefined;
    this.engine = undefined;
  }

  private readonly tick = (timestamp: number): void => {
    this.frameRequest = undefined;
    if (!this.shouldAnimate()) {
      return;
    }
    if (timestamp - this.lastFrameAt >= FRAME_INTERVAL_MS) {
      this.lastFrameAt = timestamp;
      this.renderNow(false);
    }
    this.startLoop();
  };

  private readonly onVisibilityChange = (): void => {
    if (this.host?.ownerDocument.hidden) {
      this.stopLoop();
      return;
    }
    this.renderNow(true);
    this.startLoop();
  };

  private readonly onMotionPreferenceChange = (): void => {
    this.stopLoop();
    this.reducedMotionBucket = this.media?.matches
      ? this.getElapsedBucket()
      : undefined;
    this.currentBucket = Number.NaN;
    this.engine = undefined;
    this.renderNow(true);
    this.startLoop();
  };

  private startEnvironment(): void {
    const host = this.host;
    const view = this.view;
    if (!host || !view) {
      return;
    }

    this.media = view.matchMedia('(prefers-reduced-motion: reduce)');
    this.media.addEventListener('change', this.onMotionPreferenceChange);
    this.environmentDocument = host.ownerDocument;
    this.environmentDocument.addEventListener('visibilitychange', this.onVisibilityChange);

    const Observer = (
      view as unknown as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver;
    if (typeof Observer === 'function') {
      const observer = new Observer((entries: IntersectionObserverEntry[]) => {
        const entry = entries[entries.length - 1];
        this.visible = entry?.isIntersecting ?? true;
        if (this.visible) {
          this.renderNow(true);
          this.startLoop();
        } else {
          this.stopLoop();
        }
      }, { threshold: 0.01 });
      this.observer = observer;
      observer.observe(host);
    }
  }

  private stopEnvironment(): void {
    this.stopLoop();
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.media) {
      this.media.removeEventListener('change', this.onMotionPreferenceChange);
    }
    this.media = undefined;
    this.environmentDocument?.removeEventListener(
      'visibilitychange',
      this.onVisibilityChange,
    );
    this.environmentDocument = undefined;
  }

  private shouldAnimate(): boolean {
    const host = this.host;
    return !this.disposed
      && Boolean(this.view)
      && Boolean(host?.isConnected)
      && this.visible
      && !host?.ownerDocument.hidden
      && !this.media?.matches;
  }

  private startLoop(): void {
    if (this.frameRequest != null || !this.shouldAnimate()) {
      return;
    }
    this.frameRequest = this.view!.requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.frameRequest == null || !this.view) {
      return;
    }
    this.view.cancelAnimationFrame(this.frameRequest);
    this.frameRequest = undefined;
  }

  private renderNow(forceRebuild: boolean): void {
    const scene = this.scene;
    const host = this.host;
    if (!scene || !host) {
      return;
    }

    if (this.media?.matches) {
      const bucket = this.reducedMotionBucket ?? this.getElapsedBucket();
      this.reducedMotionBucket = bucket;
      const variant = withFixedAppearance(
        createBloubVariant(this.seed, bucket),
        this.fixedTone,
        this.fixedShape,
      );
      const engine = new BotEngine(
        RAYON,
        'idle',
        SHAPE_BY_ID.get(variant.shapeId)!.radii,
        EXPRESSION_BY_ID.get(variant.expressionId),
      );
      this.currentVariant = variant;
      this.currentBucket = bucket;
      this.currentState = 'idle';
      this.engine = engine;
      this.applyVariant(host, variant);
      renderFrame(scene, engine.sample(1.15));
      return;
    }

    const elapsed = Math.max(0, (Date.now() - this.epochMs) / 1000);
    const schedule = getSchedule(
      this.seed,
      elapsed,
      this.fixedTone,
      this.fixedShape,
    );
    const bucketJump = Number.isFinite(this.currentBucket)
      ? Math.abs(schedule.bucket - this.currentBucket)
      : Number.POSITIVE_INFINITY;

    if (
      !this.engine
      || bucketJump > 1
      || (forceRebuild && schedule.bucket !== this.currentBucket)
    ) {
      this.rebuildEngine(schedule, elapsed);
    } else if (!this.engine || schedule.bucket !== this.currentBucket) {
      this.enterBucket(schedule);
    }

    this.enterScheduledState(schedule);
    renderFrame(scene, this.engine!.sample(elapsed));
  }

  private getElapsedBucket(): number {
    const elapsed = Math.max(0, (Date.now() - this.epochMs) / 1000);
    return Math.floor(elapsed / COMBINATION_SECONDS);
  }

  private rebuildEngine(schedule: Schedule, elapsed: number): void {
    const previous = withFixedAppearance(
      createBloubVariant(this.seed, schedule.bucket - 1),
      this.fixedTone,
      this.fixedShape,
    );
    const engine = new BotEngine(
      RAYON,
      'idle',
      SHAPE_BY_ID.get(previous.shapeId)!.radii,
      EXPRESSION_BY_ID.get(previous.expressionId),
    );
    engine.setShape(SHAPE_BY_ID.get(schedule.variant.shapeId)!.radii, schedule.bucketStart);
    engine.setExpression(
      EXPRESSION_BY_ID.get(schedule.variant.expressionId)!,
      schedule.bucketStart,
    );

    this.engine = engine;
    this.currentBucket = schedule.bucket;
    this.currentState = 'idle';
    this.currentVariant = schedule.variant;
    this.applyVariant(this.host!, schedule.variant);

    if (elapsed >= schedule.bucketStart + SPECIAL_START_SECONDS) {
      engine.setState(
        schedule.variant.motionState,
        schedule.bucketStart + SPECIAL_START_SECONDS,
      );
      this.currentState = schedule.variant.motionState;
    }
    if (elapsed >= schedule.bucketStart + schedule.specialEnd) {
      engine.setState('idle', schedule.bucketStart + schedule.specialEnd);
      this.currentState = 'idle';
    }
  }

  private enterBucket(schedule: Schedule): void {
    this.currentBucket = schedule.bucket;
    this.currentVariant = schedule.variant;
    this.engine!.setShape(
      SHAPE_BY_ID.get(schedule.variant.shapeId)!.radii,
      schedule.bucketStart,
    );
    this.engine!.setExpression(
      EXPRESSION_BY_ID.get(schedule.variant.expressionId)!,
      schedule.bucketStart,
    );
    this.applyVariant(this.host!, schedule.variant);
  }

  private enterScheduledState(schedule: Schedule): void {
    if (schedule.desiredState === this.currentState) {
      return;
    }
    const at = schedule.desiredState === 'idle'
      ? schedule.bucketStart + (
          schedule.local < SPECIAL_START_SECONDS ? 0 : schedule.specialEnd
        )
      : schedule.bucketStart + SPECIAL_START_SECONDS;
    this.engine!.setState(schedule.desiredState, at);
    this.currentState = schedule.desiredState;
  }

  private applyVariant(host: HTMLElement, variant: BloubVariant): void {
    host.dataset.bloubTone = variant.tone;
    host.dataset.bloubShape = variant.shapeId;
    host.dataset.bloubExpression = variant.expressionId;
    host.dataset.bloubMotion = variant.motionState;
    const description = describeBloubVariant(variant);
    if (!this.decorative) {
      this.scene?.svg.setAttribute('aria-label', `${this.label}：${description}`);
    }
    const button = host.closest<HTMLButtonElement>('button');
    if (button?.dataset.bloubInteractive === 'true') {
      button.setAttr('aria-label', `${this.label}：${description}，点击换一个`);
      button.setAttr('title', `${description} · 点击换一个`);
    }
  }
}

function rawVariant(seed: number, bucket: number): BloubVariant {
  const random = createRng(mix32(seed ^ Math.imul(bucket + 0x9e3779b9, 0x85ebca6b)));
  return {
    shapeId: SHAPES[Math.floor(random() * SHAPES.length)]!.id,
    expressionId: expressionFor(seed, bucket),
    tone: TONES[Math.floor(random() * TONES.length)]!,
    motionState: BLOUB_MOTION_STATES[
      Math.floor(random() * BLOUB_MOTION_STATES.length)
    ]!,
  };
}

function expressionFor(seed: number, bucket: number): ExpressionId {
  // EXPRESSIONS.length is 16. Any odd stride is coprime with 16, so a seeded
  // offset + odd stride visits every expression exactly once per 16 rounds and
  // can never repeat on adjacent rounds (including negative bucket lookups).
  const strides = [1, 3, 5, 7, 9, 11, 13, 15] as const;
  const offset = mix32(seed ^ 0xa511e9b3) % EXPRESSIONS.length;
  const stride = strides[mix32(seed ^ 0x63d83595) % strides.length]!;
  const index = positiveModulo(offset + bucket * stride, EXPRESSIONS.length);
  return EXPRESSIONS[index]!.id;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function getSchedule(
  seed: number,
  elapsed: number,
  fixedTone?: BloubTone,
  fixedShape?: BloubShape,
): Schedule {
  const bucket = Math.floor(elapsed / COMBINATION_SECONDS);
  const bucketStart = bucket * COMBINATION_SECONDS;
  const local = elapsed - bucketStart;
  const variant = withFixedAppearance(
    createBloubVariant(seed, bucket),
    fixedTone,
    fixedShape,
  );
  const duration = STATE_BY_ID.get(variant.motionState)?.duration ?? 2;
  const specialEnd = SPECIAL_START_SECONDS + Math.min(2.8, Math.max(1.25, duration));
  const desiredState: StateId = local < SPECIAL_START_SECONDS || local >= specialEnd
    ? 'idle'
    : variant.motionState;
  return { bucket, bucketStart, local, variant, specialEnd, desiredState };
}

function withFixedAppearance(
  variant: BloubVariant,
  tone?: BloubTone,
  shape?: BloubShape,
): BloubVariant {
  return tone || shape
    ? { ...variant, tone: tone ?? variant.tone, shapeId: shape ?? variant.shapeId }
    : variant;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed || 0x6d2b79f5;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createSvgScene(
  document: Document,
  decorative: boolean,
  label: string,
): SvgScene {
  const id = `celtis-bloub-mask-${++avatarId}`;
  const svg = svgElement(document, 'svg', {
    class: 'celtis-bloub-svg',
    viewBox: `${-VIEWBOX_RADIUS} ${-VIEWBOX_RADIUS} ${VIEWBOX_RADIUS * 2} ${VIEWBOX_RADIUS * 2}`,
    preserveAspectRatio: 'xMidYMid meet',
    focusable: 'false',
  });
  if (decorative) {
    svg.setAttribute('aria-hidden', 'true');
  } else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  }

  const definitions = svgElement(document, 'defs');
  const mask = svgElement(document, 'mask', {
    id,
    maskUnits: 'userSpaceOnUse',
    x: String(-VIEWBOX_RADIUS),
    y: String(-VIEWBOX_RADIUS),
    width: String(VIEWBOX_RADIUS * 2),
    height: String(VIEWBOX_RADIUS * 2),
  });
  const maskBody = svgElement(document, 'path', { fill: '#ffffff' });
  const firstEye = svgElement(document, 'path', { fill: '#000000' });
  const secondEye = svgElement(document, 'path', { fill: '#000000' });
  const maskNotch = svgElement(document, 'circle', { fill: '#000000' });
  mask.append(maskBody, firstEye, secondEye, maskNotch);
  definitions.append(mask);

  const dotsBehind = svgElement(document, 'g', { class: 'celtis-bloub-dots is-behind' });
  const bodyGroup = svgElement(document, 'g', { class: 'celtis-bloub-body' });
  const bodyFill = svgElement(document, 'rect', {
    class: 'celtis-bloub-body-fill',
    x: String(-VIEWBOX_RADIUS),
    y: String(-VIEWBOX_RADIUS),
    width: String(VIEWBOX_RADIUS * 2),
    height: String(VIEWBOX_RADIUS * 2),
    mask: `url(#${id})`,
  });
  bodyGroup.append(bodyFill);
  const dotsFront = svgElement(document, 'g', { class: 'celtis-bloub-dots is-front' });
  const notification = svgElement(document, 'circle', {
    class: 'celtis-bloub-notification',
  });

  const behindDots = createDotPool(document, dotsBehind, 6);
  const frontDots = createDotPool(document, dotsFront, 6);
  svg.append(definitions, dotsBehind, bodyGroup, dotsFront, notification);

  return {
    svg,
    maskBody,
    maskEyes: [firstEye, secondEye],
    maskNotch,
    bodyFill,
    bodyGroup,
    dotsBehind,
    dotsFront,
    behindDots,
    frontDots,
    notification,
  };
}

function createDotPool(
  document: Document,
  group: SVGGElement,
  count: number,
): DotNodes[] {
  return Array.from({ length: count }, () => {
    const circle = svgElement(document, 'circle', { class: 'celtis-bloub-dot' });
    const path = svgElement(document, 'path', { class: 'celtis-bloub-dot' });
    setSvgVisible(circle, false);
    setSvgVisible(path, false);
    group.append(circle, path);
    return { circle, path };
  });
}

function renderFrame(scene: SvgScene, frame: BotFrame): void {
  scene.maskBody.setAttribute('d', frame.bodyPath);
  scene.bodyGroup.setAttribute('opacity', String(frame.bodyAlpha));

  for (let index = 0; index < scene.maskEyes.length; index += 1) {
    const node = scene.maskEyes[index]!;
    const eye = frame.eyes[index];
    if (!eye) {
      setSvgVisible(node, false);
      continue;
    }
    setSvgVisible(node, true);
    node.setAttribute('d', eye.d);
    node.setAttribute('transform', eye.matrix);
    node.setAttribute('opacity', String(eye.alpha));
  }

  if (frame.notch) {
    setSvgVisible(scene.maskNotch, true);
    setCircle(scene.maskNotch, frame.notch);
  } else {
    setSvgVisible(scene.maskNotch, false);
  }

  updateDots(scene.behindDots, frame.dotsBehind ? frame.dots : []);
  updateDots(scene.frontDots, frame.dotsBehind ? [] : frame.dots);

  if (frame.notif) {
    setSvgVisible(scene.notification, true);
    setCircle(scene.notification, frame.notif);
  } else {
    setSvgVisible(scene.notification, false);
  }
}

function updateDots(pool: DotNodes[], dots: BotFrame['dots']): void {
  for (let index = 0; index < pool.length; index += 1) {
    const nodes = pool[index]!;
    const dot = dots[index];
    if (!dot) {
      setSvgVisible(nodes.circle, false);
      setSvgVisible(nodes.path, false);
      continue;
    }
    const opacity = String(dot.opacity);
    if (dot.d) {
      setSvgVisible(nodes.circle, false);
      setSvgVisible(nodes.path, true);
      nodes.path.setAttribute('d', dot.d);
      nodes.path.setAttribute(
        'transform',
        `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`,
      );
      nodes.path.setAttribute('opacity', opacity);
    } else {
      setSvgVisible(nodes.path, false);
      setSvgVisible(nodes.circle, true);
      setCircle(nodes.circle, dot);
      nodes.circle.setAttribute('opacity', opacity);
    }
  }
}

function setCircle(
  circle: SVGCircleElement,
  values: { x: number; y: number; r: number },
): void {
  circle.setAttribute('cx', String(values.x));
  circle.setAttribute('cy', String(values.y));
  circle.setAttribute('r', String(values.r));
}

function setSvgVisible(element: SVGElement, visible: boolean): void {
  element.style.display = visible ? '' : 'none';
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}
