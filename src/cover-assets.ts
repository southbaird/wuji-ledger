import type { LedgerRecord } from './domain';
import { isGeneratedStickerPath } from './sticker-layout';

export const MAX_COVER_IMAGE_BYTES = 100 * 1024 * 1024;
export const SUPPORTED_COVER_IMAGE_MESSAGE =
  '仅支持 PNG、JPEG、HEIC、WEBP 或 AVIF 图片。';

export interface CoverImageKind {
  extension: 'png' | 'jpg' | 'webp' | 'avif' | 'heic' | 'heif';
  mimeType: string;
}

export interface ReusableCoverOption {
  path: string;
  recordNames: string[];
  recordCount: number;
  isSticker: boolean;
}

export function getCoverImageKindFromSignature(
  buffer: ArrayBuffer,
): CoverImageKind | undefined {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64));
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP') {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  if (readAscii(bytes, 4, 4) === 'ftyp') {
    const brands = readAscii(bytes, 8, bytes.length - 8);
    if (/(?:avif|avis)/.test(brands)) {
      return { extension: 'avif', mimeType: 'image/avif' };
    }
    if (/(?:heic|heix|hevc|hevx|heim|heis)/.test(brands)) {
      return { extension: 'heic', mimeType: 'image/heic' };
    }
    if (/(?:mif1|msf1)/.test(brands)) {
      return { extension: 'heif', mimeType: 'image/heif' };
    }
  }
  return undefined;
}

export function sanitizeCoverFileStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '').normalize('NFKC');
  return stem
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function isImportedCoverPath(path: string | undefined): boolean {
  return /^assets\/user\/[^/]+-\d{10,}-[a-f0-9]{8}-cover\.(?:png|jpe?g|webp|avif|heic|heif)$/i
    .test(path?.trim() ?? '');
}

export function isManagedCoverAssetPath(path: string | undefined): boolean {
  return isGeneratedStickerPath(path) || isImportedCoverPath(path);
}

export function getReusableCoverOptions(
  records: readonly LedgerRecord[],
): ReusableCoverOption[] {
  const options = new Map<string, ReusableCoverOption>();
  for (const record of records) {
    const path = record.cover?.trim();
    if (!path) {
      continue;
    }
    const existing = options.get(path);
    if (existing) {
      existing.recordCount += 1;
      if (!existing.recordNames.includes(record.name)) {
        existing.recordNames.push(record.name);
      }
      continue;
    }
    options.set(path, {
      path,
      recordNames: [record.name],
      recordCount: 1,
      isSticker: isGeneratedStickerPath(path),
    });
  }
  return [...options.values()];
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  const end = Math.min(bytes.length, start + length);
  let value = '';
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
}
