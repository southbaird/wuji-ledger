import { describe, expect, it } from 'vitest';

import {
  getCoverImageKindFromSignature,
  getReusableCoverOptions,
  isImportedCoverPath,
  isManagedCoverAssetPath,
  sanitizeCoverFileStem,
} from '../src/cover-assets';
import type { LedgerRecord } from '../src/domain';

function asciiBuffer(value: string): ArrayBuffer {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0))).buffer;
}

describe('cover image validation', () => {
  it('identifies every supported cover format from bytes rather than file names', () => {
    expect(getCoverImageKindFromSignature(Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).buffer)?.extension).toBe('png');
    expect(getCoverImageKindFromSignature(Uint8Array.from([0xff, 0xd8, 0xff]).buffer)?.extension)
      .toBe('jpg');
    expect(getCoverImageKindFromSignature(asciiBuffer('RIFF0000WEBP'))?.extension).toBe('webp');
    expect(getCoverImageKindFromSignature(asciiBuffer('0000ftypavif0000'))?.extension).toBe('avif');
    expect(getCoverImageKindFromSignature(asciiBuffer('0000ftypheic0000'))?.extension).toBe('heic');
    expect(getCoverImageKindFromSignature(asciiBuffer('0000ftypmif10000'))?.extension).toBe('heif');
  });

  it('rejects unsupported or disguised files', () => {
    expect(getCoverImageKindFromSignature(asciiBuffer('<svg></svg>'))).toBeUndefined();
    expect(getCoverImageKindFromSignature(asciiBuffer('GIF89a'))).toBeUndefined();
    expect(getCoverImageKindFromSignature(asciiBuffer('not an image'))).toBeUndefined();
  });

  it('creates readable, bounded file stems', () => {
    expect(sanitizeCoverFileStem('  示例 的 测试物品.webp')).toBe('示例-的-测试物品');
    expect(sanitizeCoverFileStem('../../unsafe?.png')).toBe('unsafe');
    expect(sanitizeCoverFileStem(`${'a'.repeat(80)}.jpg`)).toHaveLength(48);
  });
});

describe('managed cover paths', () => {
  it('accepts only strict imported covers and generated stickers', () => {
    const imported = 'assets/user/mac-studio-1787648701323-acde1234-cover.png';
    const sticker = 'assets/user/mac-studio-1787648701323-acde1234-sticker.png';

    expect(isImportedCoverPath(imported)).toBe(true);
    expect(isManagedCoverAssetPath(imported)).toBe(true);
    expect(isManagedCoverAssetPath(sticker)).toBe(true);
    expect(isImportedCoverPath('assets/user/../data.json')).toBe(false);
    expect(isImportedCoverPath('assets/user/nested/image-1787648701323-acde1234-cover.png'))
      .toBe(false);
    expect(isManagedCoverAssetPath('assets/user/arbitrary.png')).toBe(false);
  });
});

describe('existing cover reuse', () => {
  it('deduplicates shared paths and keeps archived records available', () => {
    const records: LedgerRecord[] = [
      {
        id: 'item-a',
        type: 'item',
        name: 'Mac Studio',
        purchaseCost: 1,
        cover: 'assets/user/shared-1787648701323-acde1234-cover.png',
      },
      {
        id: 'item-b',
        type: 'item',
        name: 'Mac Studio 已归档',
        purchaseCost: 1,
        archiveDate: '2026-08-01',
        cover: 'assets/user/shared-1787648701323-acde1234-cover.png',
      },
      {
        id: 'item-c',
        type: 'item',
        name: '无封面',
        purchaseCost: 1,
        cover: '   ',
      },
    ];

    expect(getReusableCoverOptions(records)).toEqual([
      {
        path: 'assets/user/shared-1787648701323-acde1234-cover.png',
        recordNames: ['Mac Studio', 'Mac Studio 已归档'],
        recordCount: 2,
        isSticker: false,
      },
    ]);
  });
});
