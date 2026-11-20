// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type WujiLedgerPlugin from '../src/main';
import { ArchiveRecordModal, RecordEditorModal } from '../src/main';
import { applyArchiveDraft } from '../src/quick-archive';
import type { LedgerRecord } from '../src/domain';

// The host owns modal mounting, while all form logic below is the production code.
vi.mock('obsidian', () => ({
  App: class {}, Plugin: class {}, ItemView: class {}, Menu: class {}, TFile: class {}, WorkspaceLeaf: class {},
  Notice: class {}, Platform: {}, normalizePath: (path: string) => path, requestUrl: vi.fn(), setIcon: vi.fn(),
  Modal: class {
    modalEl = document.createElement('div');
    contentEl = document.createElement('div');
    closed = false;
    constructor() { this.modalEl.append(this.contentEl); }
    open() { document.body.append(this.modalEl); (this as unknown as { onOpen(): void }).onOpen(); }
    close() { this.closed = true; (this as unknown as { onClose(): void }).onClose(); this.modalEl.remove(); }
  },
}));

interface ElementOptions { cls?: string; text?: string; attr?: Record<string, string>; }
function createEl(this: HTMLElement, tag: string, options: ElementOptions = {}): HTMLElement {
  const el = document.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
  this.append(el);
  return el;
}

describe('ledger confirmation forms', () => {
  let modal: ArchiveRecordModal | RecordEditorModal;
  let records: LedgerRecord[];
  const plugin = { applyColorTheme: () => {}, getAssetUrl: (path: string) => path } as unknown as WujiLedgerPlugin;
  beforeEach(() => {
    Object.assign(HTMLElement.prototype, {
      createEl,
      createDiv(this: HTMLElement, options: ElementOptions) { return createEl.call(this, 'div', options); },
      createSpan(this: HTMLElement, options: ElementOptions) { return createEl.call(this, 'span', options); },
      addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
      removeClass(this: HTMLElement, ...names: string[]) { this.classList.remove(...names); },
      toggleClass(this: HTMLElement, name: string, value: boolean) { this.classList.toggle(name, value); },
      setAttr(this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); },
      setText(this: HTMLElement, text: string) { this.textContent = text; },
      empty(this: HTMLElement) { this.replaceChildren(); },
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    records = [
      { id: 'phone', type: 'item', name: '测试手机', purchaseCost: 100, purchaseDate: '2020-01-01', notes: '保留备注' },
      { id: 'case', type: 'accessory', name: '测试配件', purchaseCost: 10, linkedItemId: 'phone' },
    ];
  });
  afterEach(() => {
    modal?.close();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  function open(onConfirm: (date: string, sale?: number) => Promise<void>, afterConfirm?: () => void): void {
    modal = new ArchiveRecordModal({} as App, plugin, records[0]!, () => records, onConfirm, afterConfirm);
    modal.open();
  }
  function price(value: string): HTMLInputElement {
    const input = modal.contentEl.querySelector<HTMLInputElement>('[aria-label="卖出价格"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    return input;
  }
  function button(text: string): HTMLButtonElement {
    return [...modal.contentEl.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(text))!;
  }
  it('previews price and commits once with Enter, closes, then refreshes', async () => {
    const afterConfirm = vi.fn(() => expect(modal.modalEl.isConnected).toBe(false));
    const persist = vi.fn(async (archiveDate: string, saleIncome?: number) => {
      records[0] = applyArchiveDraft(records[0]!, records, { archiveDate, saleIncome: String(saleIncome) });
    });
    open(persist, afterConfirm);
    expect(modal.contentEl.textContent).toContain('1 个关联配件保留现有状态');
    const input = price('75');
    expect(modal.contentEl.textContent).toContain('¥25');
    expect(persist).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(afterConfirm).toHaveBeenCalledOnce());
    expect(persist).toHaveBeenCalledOnce();
    expect(records[0]).toMatchObject({ saleIncome: 75, notes: '保留备注' });
    expect(records[0]?.archiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(records[1]?.archiveDate).toBeUndefined();
  });
  it('cancels without saving typed values', () => {
    const persist = vi.fn();
    open(persist);
    price('75');
    button('取消').click();
    expect(persist).not.toHaveBeenCalled();
    expect(records[0]?.saleIncome).toBeUndefined();
    expect(modal.modalEl.isConnected).toBe(false);
  });
  it('rejects a negative price inline and keeps the form open', () => {
    const persist = vi.fn();
    open(persist);
    price('-1');
    button('确认归档').click();
    expect(persist).not.toHaveBeenCalled();
    expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('大于或等于 0');
    expect(modal.modalEl.isConnected).toBe(true);
  });
  it('keeps entered values and allows retry after a persistence failure', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('磁盘写入失败')).mockResolvedValueOnce(undefined);
    const afterConfirm = vi.fn();
    open(persist, afterConfirm);
    const input = price('60');
    button('确认归档').click();
    await vi.waitFor(() => expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('磁盘写入失败'));
    expect(modal.modalEl.isConnected).toBe(true);
    expect(input.value).toBe('60');
    expect(input.disabled).toBe(false);
    expect(afterConfirm).not.toHaveBeenCalled();
    button('确认归档').click();
    await vi.waitFor(() => expect(afterConfirm).toHaveBeenCalledOnce());
    expect(persist).toHaveBeenCalledTimes(2);
  });

  function imagePlugin(importImage: () => Promise<string>) {
    return {
      applyColorTheme: () => {}, getAssetUrl: (path: string) => path,
      app: {}, manifest: {}, data: { records },
      importCoverImage: vi.fn(importImage), discardManagedCoverAsset: vi.fn(async () => {}),
      registerCoverSession: () => () => {}, openExistingCoverPicker: vi.fn(), activateView: vi.fn(),
      upsertRecord: vi.fn(async (_record: LedgerRecord, options: { onPersisted(): void }) => options.onPersisted()),
    };
  }
  const importedPath = 'assets/user/camera-1787648701323-acde1234-cover.png';
  const droppedFile = () => ({ kind: 'file' as const, file: new File(['image'], '相机.png', { type: 'image/png' }), name: '相机' });
  it('prefills an image-drop form, blocks saving during import and keeps the imported cover after confirmation', async () => {
    let resolve!: (value: string) => void;
    const host = imagePlugin(() => new Promise((done) => { resolve = done; }));
    modal = new RecordEditorModal({} as App, host as unknown as WujiLedgerPlugin, 'item', { droppedImage: droppedFile() });
    modal.open();
    expect(modal.contentEl.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('相机');
    button('添加物品').click();
    expect(host.upsertRecord).not.toHaveBeenCalled();
    resolve(importedPath);
    await vi.waitFor(() => expect(modal.contentEl.querySelector<HTMLInputElement>('.celtis-ledger-cover-input input')?.value).toBe(importedPath));
    button('添加物品').click();
    await vi.waitFor(() => expect(host.activateView).toHaveBeenCalledOnce());
    expect(host.upsertRecord.mock.calls[0]?.[0]).toMatchObject({ name: '相机', cover: importedPath, type: 'item' });
    expect(host.discardManagedCoverAsset).not.toHaveBeenCalled();
    expect(modal.modalEl.isConnected).toBe(false);
  });
  it('discards an unsaved image if the user cancels while importing it', async () => {
    let resolve!: (value: string) => void;
    const host = imagePlugin(() => new Promise((done) => { resolve = done; }));
    modal = new RecordEditorModal({} as App, host as unknown as WujiLedgerPlugin, 'item', { droppedImage: droppedFile() });
    modal.open();
    button('取消').click();
    resolve(importedPath);
    await vi.waitFor(() => expect(host.discardManagedCoverAsset).toHaveBeenCalledExactlyOnceWith(importedPath));
    expect(host.upsertRecord).not.toHaveBeenCalled();
  });
  it('discards a completed import on cancel without creating a record', async () => {
    const host = imagePlugin(async () => importedPath);
    modal = new RecordEditorModal({} as App, host as unknown as WujiLedgerPlugin, 'item', { droppedImage: droppedFile() });
    modal.open();
    await vi.waitFor(() => expect(modal.contentEl.querySelector<HTMLInputElement>('.celtis-ledger-cover-input input')?.value).toBe(importedPath));
    button('取消').click();
    expect(host.discardManagedCoverAsset).toHaveBeenCalledExactlyOnceWith(importedPath);
    expect(host.upsertRecord).not.toHaveBeenCalled();
  });
  it('prefills a web-image URL and never imports or deletes it on cancel', () => {
    const host = imagePlugin(async () => importedPath);
    modal = new RecordEditorModal({} as App, host as unknown as WujiLedgerPlugin, 'item', {
      droppedImage: { kind: 'url', url: 'https://example.com/camera.webp', name: '网页相机' },
    });
    modal.open();
    expect(modal.contentEl.querySelector<HTMLInputElement>('.celtis-ledger-cover-input input')?.value).toBe('https://example.com/camera.webp');
    button('取消').click();
    expect(host.importCoverImage).not.toHaveBeenCalled();
    expect(host.discardManagedCoverAsset).not.toHaveBeenCalled();
    expect(host.upsertRecord).not.toHaveBeenCalled();
  });
});
