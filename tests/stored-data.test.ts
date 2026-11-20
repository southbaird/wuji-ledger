import { describe, expect, it } from 'vitest';
import { normalizeStoredData, resolveStoredData } from '../src/stored-data';

const cover = 'assets/user/synthetic-cover-sticker.png';
const sample = {
  title: '虚构测试账本',
  records: [{ id: 'example', type: 'item', name: '示例物品', purchaseCost: 100, cover }],
  preferences: { pageAvatarShape: 'cercle', pageAvatarTone: 'ink', colorTheme: 'initial' },
};
describe('safe persistence', () => {
  it('starts empty rather than distributing any personal records', () => {
    expect(normalizeStoredData(undefined)).toMatchObject({ title: '我的小玩意', records: [] });
  });
  it('preserves a sticker and preferences through serialization', () => {
    const first = normalizeStoredData(sample);
    const reopened = normalizeStoredData(JSON.parse(JSON.stringify(first)));
    expect(reopened).toEqual(first);
    expect(reopened.records[0]?.cover).toBe(cover);
  });
  it('uses a valid backup when primary data is corrupt', () => {
    expect(resolveStoredData({ records: [null] }, sample)).toMatchObject({ source: 'backup' });
    expect(resolveStoredData(undefined, sample).data.records[0]?.cover).toBe(cover);
  });
  it('never restores records into an intentionally empty primary', () => {
    expect(resolveStoredData({ records: [], title: '空账本' }, sample)).toMatchObject({ source: 'primary', data: { records: [] } });
  });
  it('rejects non-finite money and malformed records', () => {
    expect(resolveStoredData({ records: [{ ...sample.records[0], purchaseCost: Infinity }] }, sample).source).toBe('backup');
  });
});
