// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageDropController, readDroppedImage } from '../src/image-drop';

function transfer(files: File[] = [], strings: Record<string, string> = {}): DataTransfer {
  return {
    files, items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    types: [...(files.length ? ['Files'] : []), ...Object.keys(strings)],
    getData: (type: string) => strings[type] ?? '', dropEffect: 'none',
  } as unknown as DataTransfer;
}
function drag(target: EventTarget, type: string, data: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: data });
  target.dispatchEvent(event);
  return event;
}

describe('image drop payload', () => {
  it('uses the actual file in preference to a browser URL and preserves its name', () => {
    const file = new File(['image'], '我的相机.jpg', { type: 'image/jpeg' });
    expect(readDroppedImage(transfer([file], { 'text/uri-list': 'https://example.com/page' }), document))
      .toEqual({ image: { kind: 'file', file, name: '我的相机' }, count: 1 });
  });
  it('accepts image files without a MIME type and reports multiple images', () => {
    const first = new File(['image'], '相机.HEIC');
    const second = new File(['image'], '镜头.png');
    const result = readDroppedImage(transfer([first, second]), document);
    expect(result.count).toBe(2);
    expect(result.image).toMatchObject({ kind: 'file', file: first });
  });
  it('extracts a web image and alt text without inserting its HTML into the app', () => {
    const result = readDroppedImage(transfer([], {
      'text/html': '<a href="https://example.com/product"><img src="https://cdn.example.com/render?id=3" alt="新相机" onload="alert(1)"></a>',
      'text/uri-list': 'https://example.com/product',
    }), document);
    expect(result.image).toEqual({ kind: 'url', url: 'https://cdn.example.com/render?id=3', name: '新相机' });
    expect(document.querySelector('img')).toBeNull();
  });
  it('accepts a direct image URL with query parameters and URI comments', () => {
    expect(readDroppedImage(transfer([], { 'text/uri-list': '# Comment\r\nhttps://example.com/camera.webp?width=600' }), document).image)
      .toEqual({ kind: 'url', url: 'https://example.com/camera.webp?width=600', name: '' });
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com/a.png', 'blob:https://example.com/a'])('rejects unsafe or nonportable sources: %s', (url) => {
    expect(readDroppedImage(transfer([], { 'text/html': `<img src="${url}">` }), document).image).toBeUndefined();
  });
  it('does not treat normal text, a PDF or a product-page link as an image', () => {
    expect(readDroppedImage(transfer([new File(['pdf'], 'report.pdf', { type: 'application/pdf' })]), document).image).toBeUndefined();
    expect(readDroppedImage(transfer([], { 'text/plain': '一段普通文字' }), document).image).toBeUndefined();
    expect(readDroppedImage(transfer([], { 'text/uri-list': 'https://example.com/product' }), document).image).toBeUndefined();
  });
});

describe('external image receiving area', () => {
  let root: HTMLElement;
  let child: HTMLElement;
  let controller: ImageDropController;
  const onDrop = vi.fn();
  const notify = vi.fn();
  const enabled = vi.fn(() => true);
  const data = () => transfer([new File(['image'], '相机.png', { type: 'image/png' })]);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    enabled.mockReturnValue(true);
    root = document.createElement('div');
    child = document.createElement('img');
    root.append(child);
    document.body.append(root);
    controller = new ImageDropController(root, { enabled, decorate: () => {}, renderIcon: () => {}, onDrop, notify });
  });
  afterEach(() => { controller.dispose(); document.body.replaceChildren(); vi.useRealTimers(); });
  it('shows a tray for an external file and opens one form on drop, before any host handler', () => {
    const host = vi.fn();
    root.addEventListener('drop', host);
    const event = drag(child, 'dragover', data());
    expect(event.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain('松手，添加一件物品');
    expect(onDrop).not.toHaveBeenCalled();
    drag(child, 'drop', data());
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop.mock.calls[0]?.[0]).toMatchObject({ kind: 'file', name: '相机' });
    expect(host).not.toHaveBeenCalled();
    expect(document.querySelector('.is-image-import')).toBeNull();
  });
  it('supports protected file metadata during hover without reading bytes early', () => {
    const protectedData = { files: [], items: [{ kind: 'file', type: '' }], types: ['Files'] } as unknown as DataTransfer;
    expect(drag(child, 'dragover', protectedData).defaultPrevented).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
  });
  it('cancels on leaving and does not intercept another pane', () => {
    drag(child, 'dragover', data());
    drag(child, 'dragleave', data());
    vi.advanceTimersByTime(100);
    expect(document.querySelector('.is-image-import')).toBeNull();
    expect(drag(document.body, 'drop', data()).defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });
  it('does not flicker when moving between child elements', () => {
    drag(child, 'dragover', data());
    const tray = document.querySelector('.is-image-import');
    drag(child, 'dragleave', data());
    drag(root, 'dragover', data());
    vi.advanceTimersByTime(100);
    expect(document.querySelector('.is-image-import')).toBe(tray);
  });
  it('ignores local card drags, disabled views and known non-image files', () => {
    drag(child, 'dragstart', data());
    expect(drag(child, 'dragover', data()).defaultPrevented).toBe(false);
    drag(child, 'dragend', data());
    enabled.mockReturnValue(false);
    expect(drag(child, 'drop', data()).defaultPrevented).toBe(false);
    enabled.mockReturnValue(true);
    expect(drag(child, 'dragover', transfer([new File(['pdf'], 'test.pdf', { type: 'application/pdf' })])).defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });
  it('cancels with Escape without poisoning the next external drag', () => {
    drag(child, 'dragover', data());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    drag(child, 'drop', data());
    expect(onDrop).not.toHaveBeenCalled();
    drag(child, 'dragenter', data());
    drag(child, 'drop', data());
    expect(onDrop).toHaveBeenCalledOnce();
  });
  it('reports invalid web drops without opening an empty record', () => {
    drag(child, 'drop', transfer([], { 'text/uri-list': 'https://example.com/product' }));
    expect(notify).toHaveBeenCalledOnce();
    expect(onDrop).not.toHaveBeenCalled();
  });
  it('disposes the overlay and every event handler', () => {
    drag(child, 'dragover', data());
    controller.dispose();
    expect(document.querySelector('.is-image-import')).toBeNull();
    expect(drag(child, 'drop', data()).defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
