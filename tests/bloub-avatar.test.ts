import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BLOUB_MOTION_STATES,
  createBloubAvatar,
  createBloubVariant,
  resolveDistinctBloubSeed,
} from '../src/bloub-avatar';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const avatarSource = readFileSync(new URL('../src/bloub-avatar.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const buildSource = readFileSync(new URL('../esbuild.config.mjs', import.meta.url), 'utf8');

const SHAPES = [
  'capsule',
  'cercle',
  'galet',
  'goutte',
  'hexagone',
  'nuage',
  'squircle',
  'triangle',
] as const;

const EXPRESSIONS = [
  'attentif',
  'blase',
  'colere',
  'confus',
  'curieux',
  'effraye',
  'excite',
  'fier',
  'heureux',
  'hilare',
  'mefiant',
  'neutre',
  'somnolent',
  'surpris',
  'timide',
  'triste',
] as const;

const THEME_TONES = ['ink', 'primary', 'secondary'] as const;

function sourceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Could not locate source range: ${start} -> ${end}`);
  }
  return source.slice(from, to);
}

function sampledVariants() {
  return Array.from({ length: 4_096 }, (_, seed) =>
    createBloubVariant(seed, seed % 47));
}

describe('Bloub random combinations', () => {
  it('can lock one avatar to the circular shape without changing the random generator', () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const avatar = createBloubAvatar({
        seed,
        epochMs: 0,
        shape: 'cercle',
      });

      expect(avatar.variant.shapeId).toBe('cercle');
      avatar.dispose();
    }

    expect(new Set(sampledVariants().map(({ shapeId }) => shapeId)).size).toBe(8);
  });

  it('keeps a fixed ink tone while explicit rerolls choose a different expression', () => {
    for (let seed = 0; seed < 256; seed += 1) {
      const previous = createBloubVariant(seed, seed % 11).expressionId;
      const rerollSeed = resolveDistinctBloubSeed(seed, previous);
      const next = createBloubAvatar({
        seed: rerollSeed,
        epochMs: 0,
        shape: 'cercle',
        tone: 'ink',
      });

      expect(next.variant.shapeId).toBe('cercle');
      expect(next.variant.tone).toBe('ink');
      expect(next.variant.expressionId).not.toBe(previous);
      next.dispose();
    }
  });

  it('can reach all 8 shapes and all 16 expressions', () => {
    const variants = sampledVariants();

    expect([...new Set(variants.map(({ shapeId }) => shapeId))].sort()).toEqual(SHAPES);
    expect([...new Set(variants.map(({ expressionId }) => expressionId))].sort())
      .toEqual(EXPRESSIONS);
  });

  it('uses only the product theme primary, secondary and ink tones', () => {
    const variants = sampledVariants();

    expect([...new Set(variants.map(({ tone }) => tone))].sort()).toEqual(THEME_TONES);
    expect(avatarSource).not.toMatch(/\b(?:COLORS|COLOR_BY_ID)\b/);

    const mainPalette = sourceBetween(
      styles,
      '.celtis-bloub-avatar {',
      '.celtis-ledger-page-icon {',
    );
    expect(mainPalette).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(mainPalette).toContain('var(--celtis-pink)');
    expect(mainPalette).toContain('var(--celtis-blue)');
    expect(mainPalette).toContain('var(--celtis-ink)');
  });

  it('pins pocket-dashboard Bloub colors to the higher-priority widget theme palette', () => {
    const widgetPalette = sourceBetween(
      styles,
      '.celtis-ledger-widget-root\n  .celtis-bloub-avatar[data-bloub-tone="primary"] {',
      '.celtis-ledger-widget-shell {',
    );

    expect(widgetPalette).toContain('var(--celtis-widget-accent)');
    expect(widgetPalette).toContain('var(--celtis-widget-blue)');
    expect(widgetPalette).toContain('var(--celtis-widget-ink)');
    expect(widgetPalette.match(/\.celtis-ledger-widget-root/g)).toHaveLength(3);
  });

  it('keeps the Bloub hero visible and in full color across all three widget themes', () => {
    const cream = sourceBetween(
      styles,
      '.celtis-ledger-widget-hero-art {',
      '.celtis-ledger-widget-root.is-theme-minimal .celtis-ledger-widget-hero-art {',
    );
    const minimal = sourceBetween(
      styles,
      '.celtis-ledger-widget-root.is-theme-minimal .celtis-ledger-widget-hero-art {',
      '.celtis-ledger-widget-root.is-theme-midnight .celtis-ledger-widget-hero-art {',
    );
    const midnight = sourceBetween(
      styles,
      '.celtis-ledger-widget-root.is-theme-midnight .celtis-ledger-widget-hero-art {',
      '.celtis-ledger-widget-glance-strip,',
    );

    expect(cream).toContain('opacity: 0.5');
    expect(minimal).toContain('opacity: 0.42');
    expect(midnight).toContain('opacity: 0.46');
    expect(`${cream}\n${minimal}\n${midnight}`).not.toMatch(/grayscale|filter\s*:/);
  });

  it('always changes expression between adjacent automatic rounds', () => {
    for (let seed = 0; seed < 128; seed += 1) {
      for (let bucket = 0; bucket < 64; bucket += 1) {
        const current = createBloubVariant(seed, bucket);
        const next = createBloubVariant(seed, bucket + 1);
        expect(
          next.expressionId,
          `seed ${seed}, round ${bucket} -> ${bucket + 1}`,
        ).not.toBe(current.expressionId);
      }
    }
  });

  it('returns the same complete combination for a fixed seed and round', () => {
    const expected = createBloubVariant(0x5eed_a11, 37);

    for (let repeat = 0; repeat < 20; repeat += 1) {
      expect(createBloubVariant(0x5eed_a11, 37)).toEqual(expected);
    }
  });

  it('restricts motion to compact states without rainbow orbit or comet trails', () => {
    expect(BLOUB_MOTION_STATES).toEqual([
      'thinking',
      'wink',
      'wide',
      'alert',
      'notify',
      'exclaim',
    ]);
    expect(BLOUB_MOTION_STATES).not.toContain('orbit');
    expect(BLOUB_MOTION_STATES).not.toContain('comet');
  });
});

describe('Bloub product integration', () => {
  it('keeps expression rerolls separate from persisted shape and color choices', () => {
    const ledgerView = sourceBetween(mainSource, 'class AssetLedgerView', 'class AssetWidgetView');
    const header = sourceBetween(
      ledgerView,
      'private renderHeader(root: HTMLElement, recordCount: number): void {',
      'private renderColorThemeControl',
    );
    const widgetView = sourceBetween(mainSource, 'class AssetWidgetView', 'class BloubShapePickerModal');

    expect(header).toContain('const selectedShape = this.plugin.data.preferences.pageAvatarShape');
    expect(header).toContain('const selectedTone = this.plugin.data.preferences.pageAvatarTone');
    expect(header).toContain('shape: selectedShape');
    expect(header).toContain('tone: selectedTone');
    expect(header).toContain("this.plugin.rerollBloub('ledger-brand')");
    expect(header).toContain('new BloubShapePickerModal(this.app, this.plugin).open()');
    expect(header.indexOf("this.plugin.rerollBloub('ledger-brand')"))
      .toBeLessThan(header.indexOf('new BloubShapePickerModal'));
    expect(widgetView).not.toContain('shape:');
  });

  it('shows the main page mark without a square card frame', () => {
    const pageMark = sourceBetween(
      styles,
      ') .celtis-ledger-page-icon {',
      ') .celtis-ledger-title {',
    );

    expect(pageMark).toContain('border: 0;');
    expect(pageMark).toContain('border-radius: 50%;');
    expect(pageMark).toContain('background: transparent;');
    expect(pageMark).toContain('box-shadow: none;');
    expect(pageMark).toContain('overflow: visible;');
    expect(pageMark).toContain('width: 72px;');
    expect(pageMark).toContain('height: 72px;');

    const pageMarkHover = sourceBetween(
      styles,
      '.celtis-ledger-page-icon:hover {',
      '.celtis-ledger-page-icon:active {',
    );
    expect(pageMarkHover).toContain('background: transparent;');
    expect(pageMarkHover).not.toContain('var(--celtis-surface-hover)');
  });

  it('reveals the appearance trigger on hover or focus while keeping touch access', () => {
    const trigger = sourceBetween(
      styles,
      '.celtis-asset-ledger-root button.celtis-ledger-shape-trigger {',
      '.celtis-asset-ledger-root button.celtis-ledger-shape-trigger svg {',
    );
    const reveal = sourceBetween(
      styles,
      '.celtis-ledger-page-icon-control:is(:hover, :focus-within)',
      '.celtis-asset-ledger-root button.celtis-ledger-shape-trigger:active {',
    );

    expect(trigger).toContain('opacity: 0;');
    expect(trigger).toContain('pointer-events: none;');
    expect(styles).toMatch(
      /button\.celtis-ledger-shape-trigger::before\s*\{[\s\S]*?inset: -10px;/,
    );
    expect(reveal).toContain('opacity: 1;');
    expect(reveal).toContain('pointer-events: auto;');
    expect(styles).toContain(
      '@media (hover: none), (pointer: coarse), (any-pointer: coarse)',
    );
  });

  it('mounts Bloub only in the title and pocket dashboard, not the two summaries', () => {
    const ledgerView = sourceBetween(mainSource, 'class AssetLedgerView', 'class AssetWidgetView');
    const widgetView = sourceBetween(mainSource, 'class AssetWidgetView', 'class BloubShapePickerModal');

    expect(ledgerView).toContain("this.attachBloub(avatar, 'ledger-brand'");
    expect(ledgerView).not.toContain('ledger-active-summary');
    expect(ledgerView).not.toContain('ledger-archived-summary');
    expect(ledgerView).toContain("artIcon: 'package'");
    expect(ledgerView).toContain("artIcon: 'archive'");
    expect(widgetView).toContain("this.attachBloub(avatar, 'widget-brand'");
    expect(widgetView).toContain("this.attachBloub(art, 'widget-hero'");
  });

  it('keeps the shape picker and host summary icons, without unlicensed raster artwork', () => {
    expect(mainSource).not.toContain('AppearancePickerModal');
    expect(mainSource).not.toContain('openAppearancePicker');
    expect(mainSource).not.toContain('refreshAppearance');
    expect(mainSource).not.toMatch(/assets\/appearance\//);
    expect(mainSource).toContain('class BloubShapePickerModal extends Modal');
    expect(mainSource).not.toMatch(/assets\/(?:active|archive)-summary\.gif/);
    expect(mainSource).not.toMatch(/https?:\/\/(?:bloub\.vercel\.app|github\.com\/jeremy-prt\/bloub)/);

    expect(mainSource).toContain('setIcon(art, options.artIcon)');
    expect(mainSource).not.toContain('summary-static.png');
  });

  it('offers draft shape and color choices, saves them together, and disposes previews', () => {
    const picker = sourceBetween(
      mainSource,
      'class BloubShapePickerModal extends Modal',
      'class RecordEditorModal extends Modal',
    );

    expect(picker).toContain('for (const [index, option] of BLOUB_SHAPE_OPTIONS.entries())');
    expect(picker).toContain('for (const option of BLOUB_TONE_OPTIONS)');
    expect(picker).toContain('tone: this.selectedTone');
    expect(picker).toContain('shape: this.selectedShape');
    expect(picker).toContain('pageAvatarShape: this.selectedShape');
    expect(picker).toContain('pageAvatarTone: this.selectedTone');
    expect(picker).toContain("createActionButton(actions, 'check', '保存头像'");
    expect(picker).toMatch(/override onClose\(\): void \{[\s\S]*?preview\.controller\?\.dispose\(\)/);
  });

  it.each([
    ['main ledger', 'class AssetLedgerView', 'class AssetWidgetView'],
    ['pocket dashboard', 'class AssetWidgetView', 'class BloubShapePickerModal'],
  ])('reuses one controller per slot while redrawing the %s', (_label, start, end) => {
    const view = sourceBetween(mainSource, start, end);
    const attach = sourceBetween(view, 'private attachBloub', 'private disposeBloubControllers');

    expect(view).toContain(
      'private readonly bloubControllers = new Map<string, BloubAvatarController>()',
    );
    expect(attach).toContain('let controller = this.bloubControllers.get(slot)');
    expect(attach).toContain('if (!controller)');
    expect(attach).toContain('this.bloubControllers.set(slot, controller)');
    expect(attach).toContain('controller.attach(host)');
  });

  it('restores the current variant data and accessible name when attaching to a redrawn host', () => {
    const attach = sourceBetween(
      avatarSource,
      'attach(host: HTMLElement): void {',
      'reroll(seed: number, epochMs: number): void {',
    );
    const applyVariant = sourceBetween(
      avatarSource,
      'private applyVariant(host: HTMLElement, variant: BloubVariant): void {',
      'function rawVariant',
    );

    expect(attach.indexOf('this.applyVariant(host, this.currentVariant)'))
      .toBeGreaterThan(attach.indexOf('host.replaceChildren(this.scene.svg)'));
    expect(applyVariant).toContain('host.dataset.bloubTone = variant.tone');
    expect(applyVariant).toContain('host.dataset.bloubShape = variant.shapeId');
    expect(applyVariant).toContain('host.dataset.bloubExpression = variant.expressionId');
    expect(applyVariant).toContain("button.setAttr('aria-label'");
    expect(applyVariant).toContain("button.setAttr('title'");
  });

  it('freezes the reduced-motion round across redraws and only clears it on an explicit reroll', () => {
    const reducedMotionRender = sourceBetween(
      avatarSource,
      'if (this.media?.matches) {',
      'const elapsed = Math.max(0, (Date.now() - this.epochMs) / 1000);',
    );
    const reroll = sourceBetween(
      avatarSource,
      'reroll(seed: number, epochMs: number): void {',
      'dispose(): void {',
    );

    expect(avatarSource).toContain('private reducedMotionBucket?: number');
    expect(reducedMotionRender).toContain(
      'const bucket = this.reducedMotionBucket ?? this.getElapsedBucket()',
    );
    expect(reducedMotionRender).toContain('this.reducedMotionBucket = bucket');
    expect(reducedMotionRender).not.toContain('Date.now()');
    expect(reroll).toContain('this.reducedMotionBucket = undefined');
  });

  it('unbinds visibility events from the document that originally registered them', () => {
    const attach = sourceBetween(
      avatarSource,
      'attach(host: HTMLElement): void {',
      'reroll(seed: number, epochMs: number): void {',
    );
    const startEnvironment = sourceBetween(
      avatarSource,
      'private startEnvironment(): void {',
      'private stopEnvironment(): void {',
    );
    const stopEnvironment = sourceBetween(
      avatarSource,
      'private stopEnvironment(): void {',
      'private shouldAnimate(): boolean {',
    );

    expect(avatarSource).toContain('private environmentDocument?: Document');
    expect(attach.indexOf('this.stopEnvironment()'))
      .toBeLessThan(attach.indexOf('this.host = host'));
    expect(startEnvironment).toContain('this.environmentDocument = host.ownerDocument');
    expect(startEnvironment).toContain(
      "this.environmentDocument.addEventListener('visibilitychange', this.onVisibilityChange)",
    );
    expect(stopEnvironment).toContain('this.environmentDocument?.removeEventListener(');
    expect(stopEnvironment).toContain('this.environmentDocument = undefined');
    expect(stopEnvironment).not.toContain('this.host?.ownerDocument.removeEventListener');
  });

  it('honours reduced motion and cleans every animation lifecycle boundary', () => {
    expect(avatarSource).toContain("view.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(avatarSource).toContain('&& !this.media?.matches');
    expect(avatarSource).toMatch(/if \(this\.media\?\.matches\)[\s\S]*?'idle'/);
    expect(avatarSource).toContain('this.view.cancelAnimationFrame(this.frameRequest)');
    expect(avatarSource).toContain('this.observer?.disconnect()');
    expect(avatarSource).toContain("'visibilitychange',\n      this.onVisibilityChange");
    expect(avatarSource).toContain(
      "this.media.removeEventListener('change', this.onMotionPreferenceChange)",
    );
    expect(mainSource.match(/override async onClose\(\): Promise<void>[\s\S]{0,700}?this\.disposeBloubControllers\(\)/g))
      .toHaveLength(2);
    expect(mainSource).toMatch(/override onunload\(\): void[\s\S]{0,300}?controller\.dispose\(\)/);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.celtis-bloub-body-fill/,
    );
  });

  it('ships the upstream MIT license in the source and bundled notices', () => {
    const licenseUrl = new URL('../assets/appearance/LICENSE-bloub.txt', import.meta.url);
    const license = readFileSync(licenseUrl, 'utf8');

    expect(statSync(licenseUrl).isFile()).toBe(true);
    expect(license).toContain('MIT License');
    expect(license).toContain('Copyright (c) 2026 Jérémy Perret');
    expect(buildSource).toContain('assets/appearance/LICENSE-bloub.txt');
    expect(buildSource).toContain('banner: { js: notice }');
  });
});
