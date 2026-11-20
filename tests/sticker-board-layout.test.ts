import { describe, expect, it } from 'vitest';

import { getStickerBoardPose } from '../src/sticker-layout';

describe('sticker board layout', () => {
  it('keeps each sticker pose stable while varying the collection', () => {
    const first = getStickerBoardPose('item-atk-a9');
    const repeated = getStickerBoardPose('item-atk-a9');
    const second = getStickerBoardPose('item-sony-a7');

    expect(repeated).toEqual(first);
    expect(second).not.toEqual(first);
    expect(first.rotationDeg).toBeGreaterThanOrEqual(-5);
    expect(first.rotationDeg).toBeLessThanOrEqual(5);
    expect(first.offsetX).toBeGreaterThanOrEqual(-10);
    expect(first.offsetX).toBeLessThanOrEqual(10);
    expect(first.offsetY).toBeGreaterThanOrEqual(-10);
    expect(first.offsetY).toBeLessThanOrEqual(10);
    expect(first.scale).toBeGreaterThanOrEqual(0.9);
    expect(first.scale).toBeLessThanOrEqual(1.08);
  });
});
