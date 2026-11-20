import {
  getItemCost,
  getLedgerSummary,
  getRecordCost,
  isArchived,
  type DayInput,
  type LedgerRecord,
  type LedgerRecordType,
  type LedgerSummary,
} from './domain';
import type { LedgerColorTheme } from './product-theme';

export interface RecordShareModel {
  id: string;
  name: string;
  type: LedgerRecordType;
  state: 'owned' | 'archived';
  cover?: string;
  purchasePrice: number;
  salePrice: number | null;
  days: number | null;
  dailyCost: number;
}

export type LedgerShareScope = 'all' | 'owned' | 'archived';

export interface LedgerShareModel {
  title: string;
  generatedOn: string;
  scope: LedgerShareScope;
  counts: {
    total: number;
    owned: number;
    archived: number;
  };
  summary: LedgerSummary;
  records: RecordShareModel[];
}

export interface CopyPngOptions {
  clipboard?: {
    write(items: unknown[]): Promise<void>;
  };
  createClipboardItem?: (payload: Record<'image/png', Blob>) => unknown;
}

export interface SharePngOptions {
  navigator?: Pick<Navigator, 'share' | 'canShare'>;
  copy?: (blob: Blob) => Promise<void>;
}

export type SharePngResult = 'shared' | 'copied';

type CoverImageResolver = (cover: string) => Promise<Blob | undefined>;

interface SharePalette {
  canvas: string;
  gridDot: string;
  background: string;
  backgroundDeep: string;
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  secondary: string;
  line: string;
}

const SHARE_PALETTES: Record<LedgerColorTheme, SharePalette> = {
  initial: {
    canvas: '#f1f3f4',
    gridDot: 'rgba(84, 91, 96, 0.14)',
    background: '#f6dfe8',
    backgroundDeep: '#8f2f54',
    paper: '#fffafb',
    ink: '#5e2940',
    muted: '#896f7a',
    accent: '#a83961',
    secondary: '#8eb7d6',
    line: '#e8bdcc',
  },
  almond: {
    canvas: '#f3efe8',
    gridDot: 'rgba(165, 80, 63, 0.15)',
    background: '#f0ddd4',
    backgroundDeep: '#7b4538',
    paper: '#fffaf5',
    ink: '#603b31',
    muted: '#877069',
    accent: '#a5503f',
    secondary: '#9caf9d',
    line: '#dfb9aa',
  },
  celadon: {
    canvas: '#eef3f1',
    gridDot: 'rgba(47, 107, 104, 0.15)',
    background: '#dcece8',
    backgroundDeep: '#285f5d',
    paper: '#fafffd',
    ink: '#285451',
    muted: '#657e7b',
    accent: '#2f6b68',
    secondary: '#d99a62',
    line: '#acd2ca',
  },
  midnight: {
    canvas: '#171a1e',
    gridDot: 'rgba(120, 183, 201, 0.18)',
    background: '#29273a',
    backgroundDeep: '#171724',
    paper: '#f5f2ff',
    ink: '#4c4169',
    muted: '#746c88',
    accent: '#8063b6',
    secondary: '#69a4b5',
    line: '#b6a5dc',
  },
};

const POSTER_FONT = '"Wuji Smiley Sans", "PingFang SC", "Noto Sans SC", sans-serif';

export function getLedgerShareScopeLabel(scope: LedgerShareScope): string {
  return scope === 'all' ? '全部' : scope === 'owned' ? '物品' : '归档';
}

export function buildRecordShareModel(
  record: LedgerRecord,
  records: readonly LedgerRecord[],
  now: DayInput = new Date(),
): RecordShareModel {
  const cost = getRecordCost(record, now, records);
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    state: isArchived(record) ? 'archived' : 'owned',
    cover: record.cover?.trim() || undefined,
    purchasePrice: record.purchaseCost,
    salePrice: record.saleIncome ?? null,
    days: cost.days,
    dailyCost: record.type === 'item'
      ? getItemCost(record, records, now).daily
      : cost.daily,
  };
}

export function buildLedgerShareModel(
  title: string,
  records: readonly LedgerRecord[],
  now: DayInput = new Date(),
  scope: LedgerShareScope = 'all',
): LedgerShareModel {
  const scopedRecords = records.filter((record) => (
    scope === 'all'
      || (scope === 'owned' && !isArchived(record))
      || (scope === 'archived' && isArchived(record))
  ));
  const models = scopedRecords.map((record) => buildRecordShareModel(record, records, now));
  return {
    title: title.trim() || '我的物迹',
    generatedOn: typeof now === 'string' ? now : toLocalDate(now),
    scope,
    counts: {
      total: models.length,
      owned: models.filter((record) => record.state === 'owned').length,
      archived: models.filter((record) => record.state === 'archived').length,
    },
    summary: getLedgerSummary(scopedRecords, now),
    records: models,
  };
}

export async function copyPngBlob(blob: Blob, options: CopyPngOptions = {}): Promise<void> {
  if (blob.type !== 'image/png') {
    throw new TypeError('Clipboard image must be encoded as PNG');
  }
  const createClipboardItem = options.createClipboardItem
    ?? ((payload: Record<'image/png', Blob>) => new ClipboardItem(payload));
  const item = createClipboardItem({ 'image/png': blob });
  if (options.clipboard) {
    await options.clipboard.write([item]);
    return;
  }
  if (!navigator.clipboard?.write) {
    throw new Error('当前设备不支持复制图片到剪贴板');
  }
  await navigator.clipboard.write([item as ClipboardItem]);
}

export async function sharePngBlob(
  blob: Blob,
  fileName: string,
  title: string,
  options: SharePngOptions = {},
): Promise<SharePngResult> {
  if (blob.type !== 'image/png') {
    throw new TypeError('Shared image must be encoded as PNG');
  }
  const host = options.navigator ?? navigator;
  const file = new File([blob], sanitizeFileName(fileName), { type: 'image/png' });
  const payload: ShareData = { files: [file], title };
  if (typeof host.share === 'function' && (!host.canShare || host.canShare(payload))) {
    await host.share(payload);
    return 'shared';
  }
  await (options.copy ?? copyPngBlob)(blob);
  return 'copied';
}

export async function imageBlobToPng(blob: Blob): Promise<Blob> {
  const image = await decodeImage(blob);
  const width = Math.max(1, image.naturalWidth);
  const height = Math.max(1, image.naturalHeight);
  const canvas = createCanvas(width, height);
  const context = getCanvasContext(canvas);
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvasToPng(canvas);
}

export async function renderRecordSharePoster(
  model: RecordShareModel,
  theme: LedgerColorTheme,
  resolveCover: CoverImageResolver,
): Promise<Blob> {
  await loadPosterFont();
  const palette = SHARE_PALETTES[theme];
  const canvas = createCanvas(1200, 1400);
  const context = getCanvasContext(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);

  const art = { x: 150, y: 55, width: 900, height: 790 };
  const cover = model.cover ? await resolveCover(model.cover) : undefined;
  if (cover) {
    try {
      const image = await decodeImage(cover);
      drawFloatingImage(context, image, art.x, art.y, art.width, art.height, palette);
    } catch {
      drawFallbackArtwork(context, art.x, art.y, art.width, art.height, model.type, palette);
    }
  } else {
    drawFallbackArtwork(context, art.x, art.y, art.width, art.height, model.type, palette);
  }

  drawStickerText(context, model.name, 600, 925, 72, palette.ink, 1000);
  const facts = [
    ['买入价格', formatMoney(model.purchasePrice)],
    ['卖出价格', model.salePrice == null ? '未卖出' : formatMoney(model.salePrice)],
    ['使用天数', model.days == null ? '未设置' : `${model.days} 天`],
  ] as const;
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    drawStickerText(
      context,
      `${fact[0]}  ${fact[1]}`,
      600,
      1070 + index * 105,
      42,
      index === 1 ? palette.accent : palette.ink,
      980,
    );
  }
  return canvasToPng(canvas);
}

export async function renderLedgerSharePoster(
  model: LedgerShareModel,
  theme: LedgerColorTheme,
  resolveCover: CoverImageResolver,
): Promise<Blob> {
  await loadPosterFont();
  const palette = SHARE_PALETTES[theme];
  const columns = 4;
  const rows = Math.max(1, Math.ceil(model.records.length / columns));
  const width = 1600;
  const headerHeight = 500;
  const cardHeight = 318;
  const height = headerHeight + rows * cardHeight + 150;
  const canvas = createCanvas(width, height);
  const context = getCanvasContext(canvas);
  drawLedgerCanvasBackground(context, width, height, palette);

  drawStickerText(context, model.title, 92, 110, 74, palette.ink, 1120, 'left');
  drawStickerText(context, '我的物迹', 92, 188, 30, palette.muted, 500, 'left');
  drawPill(
    context,
    `${getLedgerShareScopeLabel(model.scope)} · ${model.counts.total} 条`,
    1260,
    88,
    palette.paper,
    palette.ink,
    28,
  );

  const summaries: ReadonlyArray<readonly [string, string]> = model.scope === 'archived'
    ? [
        ['归档记录', `${model.counts.archived} 件`],
        ['主物品', `${model.summary.archivedItems} 件`],
        ['归档日成本', `${formatNumber(model.summary.archivedDaily)} 元/天`],
        ['归档净值', formatMoney(model.summary.archivedValue)],
      ]
    : model.scope === 'owned'
      ? [
          ['正在使用', `${model.counts.owned} 件`],
          ['主物品', `${model.summary.activeItems} 件`],
          ['每日成本', `${formatNumber(model.summary.activeDaily)} 元/天`],
          ['在用总值', formatMoney(model.summary.activeValue)],
        ]
      : [
          ['正在使用', `${model.counts.owned} 件`],
          ['已经归档', `${model.counts.archived} 件`],
          ['每日成本', `${formatNumber(model.summary.activeDaily)} 元/天`],
          ['在用总值', formatMoney(model.summary.activeValue)],
        ];
  for (let index = 0; index < summaries.length; index += 1) {
    const x = 78 + index * 367;
    drawSummaryTile(context, x, 260, 338, 150, summaries[index]![0], summaries[index]![1], palette);
  }

  if (model.records.length === 0) {
    drawStickerText(context, '还没有记录，从第一件小玩意开始吧', 800, 620, 48, palette.paper, 1300);
  }

  for (let index = 0; index < model.records.length; index += 1) {
    const record = model.records[index]!;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = 78 + column * 367;
    const y = headerHeight + row * cardHeight;
    await drawLedgerRecordCard(context, record, x, y, 338, 286, palette, resolveCover);
  }

  drawStickerText(
    context,
    `生成于 ${model.generatedOn.replace(/-/g, '/')} · 图片仅包含当前台账数据`,
    800,
    height - 72,
    25,
    palette.muted,
    1300,
  );
  return canvasToPng(canvas);
}

async function drawLedgerRecordCard(
  context: CanvasRenderingContext2D,
  record: RecordShareModel,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: SharePalette,
  resolveCover: CoverImageResolver,
): Promise<void> {
  drawRoundedRect(context, x, y, width, height, 34);
  context.fillStyle = palette.paper;
  context.shadowColor = withAlpha(palette.backgroundDeep, 0.16);
  context.shadowBlur = 18;
  context.shadowOffsetY = 9;
  context.fill();
  context.shadowColor = 'transparent';

  const imageArea = { x: x + 20, y: y + 18, width: 112, height: 112 };
  const blob = record.cover ? await resolveCover(record.cover) : undefined;
  if (blob) {
    try {
      const image = await decodeImage(blob);
      drawImageSticker(
        context,
        image,
        imageArea.x,
        imageArea.y,
        imageArea.width,
        imageArea.height,
        palette,
        7,
      );
    } catch {
      drawFallbackArtwork(
        context,
        imageArea.x,
        imageArea.y,
        imageArea.width,
        imageArea.height,
        record.type,
        palette,
      );
    }
  } else {
    drawFallbackArtwork(
      context,
      imageArea.x,
      imageArea.y,
      imageArea.width,
      imageArea.height,
      record.type,
      palette,
    );
  }

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = palette.ink;
  context.font = `700 29px ${POSTER_FONT}`;
  drawFittedText(context, record.name, x + 150, y + 46, width - 168);
  context.fillStyle = palette.muted;
  context.font = `500 22px ${POSTER_FONT}`;
  context.fillText(record.state === 'archived' ? '已归档' : '拥有中', x + 150, y + 88);

  drawThinLine(context, x + 20, y + 148, x + width - 20, y + 148, palette.line);
  const facts = [
    `买入 ${formatMoney(record.purchasePrice)}`,
    `卖出 ${record.salePrice == null ? '未卖出' : formatMoney(record.salePrice)}`,
    `使用 ${record.days == null ? '未设置' : `${record.days} 天`}`,
    `${formatNumber(record.dailyCost)} 元/天`,
  ];
  context.font = `600 21px ${POSTER_FONT}`;
  context.fillStyle = palette.ink;
  context.fillText(facts[0]!, x + 24, y + 184);
  context.fillText(facts[1]!, x + 176, y + 184);
  context.fillText(facts[2]!, x + 24, y + 232);
  context.fillStyle = palette.accent;
  context.fillText(facts[3]!, x + 176, y + 232);
}

function drawLedgerCanvasBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: SharePalette,
): void {
  context.fillStyle = palette.canvas;
  context.fillRect(0, 0, width, height);
  context.fillStyle = palette.gridDot;
  for (let y = 24; y < height; y += 40) {
    for (let x = 24; x < width; x += 40) {
      context.beginPath();
      context.arc(x, y, 1.8, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function drawImageSticker(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: SharePalette,
  outline = 14,
): void {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  context.save();
  context.shadowColor = withAlpha(palette.backgroundDeep, 0.25);
  context.shadowBlur = outline * 1.8;
  context.shadowOffsetY = outline * 0.7;
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  context.shadowColor = 'transparent';
  context.globalCompositeOperation = 'destination-over';
  context.strokeStyle = palette.paper;
  context.lineWidth = outline * 2;
  drawRoundedRect(context, drawX, drawY, drawWidth, drawHeight, Math.min(38, outline * 2));
  context.stroke();
  context.restore();
}

function drawFloatingImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: SharePalette,
): void {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  context.save();
  context.shadowColor = withAlpha(palette.backgroundDeep, 0.28);
  context.shadowBlur = 30;
  context.shadowOffsetY = 16;
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  context.restore();
}

function drawFallbackArtwork(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  type: LedgerRecordType,
  palette: SharePalette,
): void {
  const size = Math.min(width, height) * 0.72;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  context.save();
  context.translate(centerX, centerY);
  context.rotate(-0.05);
  drawRoundedRect(context, -size / 2, -size / 2, size, size, size * 0.28);
  context.fillStyle = palette.background;
  context.strokeStyle = palette.paper;
  context.lineWidth = Math.max(6, size * 0.055);
  context.shadowColor = withAlpha(palette.backgroundDeep, 0.2);
  context.shadowBlur = Math.max(8, size * 0.08);
  context.shadowOffsetY = Math.max(4, size * 0.035);
  context.fill();
  context.stroke();
  context.shadowColor = 'transparent';
  context.fillStyle = palette.ink;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `800 ${Math.max(32, size * 0.36)}px ${POSTER_FONT}`;
  context.fillText(type === 'item' ? '物' : '配', 0, size * 0.02);
  context.restore();
}

function drawStickerText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  maxWidth: number,
  align: CanvasTextAlign = 'center',
): void {
  context.save();
  context.textAlign = align;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.font = `800 ${size}px ${POSTER_FONT}`;
  const fitted = fitTextSize(context, text, size, maxWidth);
  context.font = `800 ${fitted}px ${POSTER_FONT}`;
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(10, fitted * 0.22);
  context.shadowColor = 'rgba(38, 26, 32, 0.18)';
  context.shadowBlur = 15;
  context.shadowOffsetY = 7;
  context.strokeText(text, x, y, maxWidth);
  context.shadowColor = 'transparent';
  context.fillStyle = color;
  context.fillText(text, x, y, maxWidth);
  context.restore();
}

function drawSummaryTile(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  palette: SharePalette,
): void {
  drawRoundedRect(context, x, y, width, height, 34);
  context.fillStyle = withAlpha(palette.paper, 0.94);
  context.fill();
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = palette.muted;
  context.font = `600 24px ${POSTER_FONT}`;
  context.fillText(label, x + 26, y + 43);
  context.fillStyle = palette.ink;
  context.font = `800 38px ${POSTER_FONT}`;
  drawFittedText(context, value, x + 26, y + 104, width - 52);
}

function drawPill(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  background: string,
  foreground: string,
  fontSize: number,
): void {
  context.save();
  context.font = `700 ${fontSize}px ${POSTER_FONT}`;
  const width = context.measureText(text).width + 54;
  const height = fontSize + 30;
  drawRoundedRect(context, x, y, width, height, height / 2);
  context.fillStyle = background;
  context.fill();
  context.fillStyle = foreground;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, x + width / 2, y + height / 2 + 1);
  context.restore();
}

function drawThinLine(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: string,
): void {
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  const match = /(\d+(?:\.\d+)?)px/.exec(context.font);
  const currentSize = match ? Number(match[1]) : 28;
  const fitted = fitTextSize(context, text, currentSize, maxWidth);
  context.font = context.font.replace(/\d+(?:\.\d+)?px/, `${fitted}px`);
  context.fillText(text, x, y, maxWidth);
}

function fitTextSize(
  context: CanvasRenderingContext2D,
  text: string,
  initialSize: number,
  maxWidth: number,
): number {
  let size = initialSize;
  while (size > 17 && context.measureText(text).width > maxWidth) {
    size -= 2;
    context.font = context.font.replace(/\d+(?:\.\d+)?px/, `${size}px`);
  }
  return size;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = createEl('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前设备无法生成分享图片');
  }
  return context;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('分享图片生成失败'));
      }
    }, 'image/png');
  });
}

function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片格式无法解码'));
    };
    image.src = url;
  });
}

async function loadPosterFont(): Promise<void> {
  try {
    await activeDocument.fonts?.load(`700 48px ${POSTER_FONT}`);
  } catch {
    // The bundled font is decorative; system CJK fonts remain a complete fallback.
  }
}

function sanitizeFileName(value: string): string {
  const base = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return `${base.replace(/\.png$/i, '') || 'wuji-ledger-share'}.png`;
}

function withAlpha(color: string, alpha: number): string {
  if (!/^#[\da-f]{6}$/i.test(color)) {
    return color;
  }
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}¥${formatNumber(Math.abs(value))}`;
}

function toLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
