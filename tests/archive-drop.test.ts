// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveDropController } from '../src/archive-drop';
import type { LedgerRecord } from '../src/domain';

function pointer(target: EventTarget, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, ...extra,
  }));
}

describe('archive drag session', () => {
  let controller: ArchiveDropController;
  let root: HTMLDivElement;
  let card: HTMLButtonElement;
  let records: LedgerRecord[];
  let onDrop = vi.fn<(recordId: string) => void>();
  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    card = document.createElement('button');
    card.dataset.celtisArchiveDraggable = 'phone';
    root.append(card);
    document.body.append(root);
    records = [{ id: 'phone', name: '手机', type: 'item', purchaseCost: 100 }];
    onDrop = vi.fn();
    controller = new ArchiveDropController(root, {
      getRecord: (id) => records.find((record) => record.id === id),
      onDrop, decorate: () => {}, renderArtwork: () => {},
    });
  });
  afterEach(() => {
    controller.dispose();
    vi.runAllTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function start(): HTMLElement {
    pointer(card, 'pointerdown', 20, 20);
    pointer(document, 'pointermove', 40, 50);
    const zone = document.querySelector<HTMLElement>('.celtis-ledger-archive-drop-zone')!;
    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 500, 400, 150));
    return zone;
  }
  it('reveals the tray after a deliberate drag and opens the form once on release inside', () => {
    const zone = start();
    pointer(document, 'pointermove', 250, 550);
    expect(zone.textContent).toContain('松手，填写归档信息');
    expect(onDrop).not.toHaveBeenCalled();
    pointer(document, 'pointerup', 250, 550);
    pointer(document, 'pointerup', 250, 550);
    vi.advanceTimersByTime(200);
    expect(onDrop).toHaveBeenCalledExactlyOnceWith('phone');
    expect(document.querySelector('.celtis-ledger-archive-drop-layer')).toBeNull();
    expect(records[0]?.archiveDate).toBeUndefined();
  });
  it.each(['outside', 'pointercancel', 'Escape', 'blur'])('cancels without opening a form after %s', (action) => {
    start();
    if (action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (action === 'blur') window.dispatchEvent(new Event('blur'));
    else pointer(document, action === 'outside' ? 'pointerup' : action, 20, 20);
    vi.advanceTimersByTime(200);
    expect(document.querySelector('.celtis-ledger-archive-drop-layer')).toBeNull();
    expect(card.classList.contains('is-archive-dragging')).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });
  it('preserves ordinary clicks and small pointer movements', () => {
    const click = vi.fn();
    card.addEventListener('click', click);
    pointer(card, 'pointerdown', 20, 20);
    pointer(document, 'pointermove', 23, 22);
    pointer(document, 'pointerup', 23, 22);
    card.click();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('.celtis-ledger-archive-drop-layer')).toBeNull();
  });
  it('does not intercept touch scrolling, right click, or another pointer', () => {
    pointer(card, 'pointerdown', 20, 20, { pointerType: 'touch' });
    pointer(document, 'pointermove', 250, 550, { pointerType: 'touch' });
    pointer(card, 'pointerdown', 20, 20, { button: 2 });
    pointer(document, 'pointermove', 250, 550);
    expect(document.querySelector('.celtis-ledger-archive-drop-layer')).toBeNull();
    start();
    pointer(document, 'pointerup', 250, 550, { pointerId: 2 });
    vi.advanceTimersByTime(200);
    expect(onDrop).not.toHaveBeenCalled();
  });
  it('does not open a stale record or an already archived item', () => {
    start();
    records[0]!.archiveDate = '2026-09-12';
    pointer(document, 'pointerup', 250, 550);
    vi.advanceTimersByTime(200);
    expect(onDrop).not.toHaveBeenCalled();
    pointer(card, 'pointerdown', 20, 20);
    pointer(document, 'pointermove', 40, 50);
    expect(document.querySelector('.celtis-ledger-archive-drop-zone')).toBeNull();
  });
  it('cancels a queued form opening when the view closes', () => {
    start();
    pointer(document, 'pointerup', 250, 550);
    controller.dispose();
    vi.advanceTimersByTime(200);
    expect(document.querySelector('.celtis-ledger-archive-drop-layer')).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
  });
  it('suppresses the trailing click after dragging but allows later clicks', () => {
    const click = vi.fn();
    card.addEventListener('click', click);
    start();
    controller.cancel();
    card.click();
    expect(click).not.toHaveBeenCalled();
    vi.advanceTimersByTime(310);
    card.click();
    expect(click).toHaveBeenCalledOnce();
  });
});
