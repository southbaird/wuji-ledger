export type StickerShape = 'tall' | 'portrait' | 'standard' | 'wide' | 'ultrawide';

export interface StickerBoardPose {
  rotationDeg: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export function getStickerBoardPose(seed: string): StickerBoardPose {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967295;
  };

  return {
    rotationDeg: Number((-5 + next() * 10).toFixed(2)),
    offsetX: Math.round(-10 + next() * 20),
    offsetY: Math.round(-10 + next() * 20),
    scale: Number((0.9 + next() * 0.18).toFixed(3)),
  };
}

export function isGeneratedStickerPath(path: string | undefined): boolean {
  return /^assets\/user\/[^/]+-sticker\.png$/i.test(path?.trim() ?? '');
}

export function getStickerShape(width: number, height: number): StickerShape {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'standard';
  }

  const ratio = width / height;
  if (ratio < 0.65) {
    return 'tall';
  }
  if (ratio < 1) {
    return 'portrait';
  }
  if (ratio < 1.65) {
    return 'standard';
  }
  if (ratio < 2.25) {
    return 'wide';
  }
  return 'ultrawide';
}
