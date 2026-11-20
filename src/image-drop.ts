export type DroppedImage =
  | { kind: 'file'; file: File; name: string }
  | { kind: 'url'; url: string; name: string };

const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|avif|heic|heif|gif|bmp|svg)$/i;

function imageFile(file: File): boolean {
  return file.type.startsWith('image/') || (!file.type && IMAGE_EXTENSION.test(file.name));
}

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Read synchronously during drop: browsers hide the payload outside that event. */
export function readDroppedImage(data: DataTransfer, doc: Document): { image?: DroppedImage; count: number } {
  const files = Array.from(data.files).filter(imageFile);
  if (!files.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && imageFile(file)) files.push(file);
    }
  }
  const file = files[0];
  if (file) return {
    image: { kind: 'file', file, name: file.name.replace(/\.[^.]+$/, '').slice(0, 120) },
    count: files.length,
  };
  // Parsing in a detached document never inserts the dragged HTML into the app.
  const html = data.getData('text/html').slice(0, 1_000_000);
  if (html) {
    const Parser = doc.defaultView?.DOMParser ?? DOMParser;
    const parsed = new Parser().parseFromString(html, 'text/html');
    const images = Array.from(parsed.querySelectorAll('img'));
    for (const image of images) {
      const url = httpUrl(image.getAttribute('src') ?? '');
      if (url) return { image: { kind: 'url', url, name: (image.getAttribute('alt') ?? '').trim().slice(0, 120) }, count: images.length };
    }
  }
  for (const line of (data.getData('text/uri-list') || data.getData('text/plain')).split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    const url = httpUrl(line);
    if (url && IMAGE_EXTENSION.test(new URL(url).pathname)) {
      return { image: { kind: 'url', url, name: '' }, count: 1 };
    }
  }
  return { count: 0 };
}

function mayContainImage(data: DataTransfer): boolean {
  const items = Array.from(data.items);
  if (items.some((item) => item.kind === 'file' && (!item.type || item.type.startsWith('image/')))) return true;
  const types = Array.from(data.types);
  return (!items.length && types.includes('Files')) || types.includes('text/html')
    || types.includes('text/uri-list') || types.includes('text/plain');
}

interface ImageDropOptions {
  enabled(): boolean;
  decorate(layer: HTMLElement): void;
  renderIcon(host: HTMLElement): void;
  onDrop(image: DroppedImage): void;
  notify(message: string): void;
}

/** Only intercept external drops over this ledger, never the rest of the vault. */
export class ImageDropController {
  private readonly doc: Document;
  private readonly abort = new AbortController();
  private layer?: HTMLElement;
  private internalDrag = false;
  private cancelled = false;
  private leaveTimer?: number;

  constructor(private readonly root: HTMLElement, private readonly options: ImageDropOptions) {
    this.doc = root.ownerDocument;
    const signal = this.abort.signal;
    this.doc.addEventListener('dragstart', (event) => {
      this.internalDrag = this.root.contains(event.target as Node);
      this.cancelled = false;
      queueMicrotask(() => { if (event.defaultPrevented) this.internalDrag = false; });
    }, { capture: true, signal });
    this.doc.addEventListener('dragenter', this.over, { capture: true, signal });
    this.doc.addEventListener('dragover', this.over, { capture: true, signal });
    this.doc.addEventListener('drop', this.drop, { capture: true, signal });
    this.doc.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget) this.cancelled = false;
      if (!this.layer || (event.relatedTarget && this.root.contains(event.relatedTarget as Node))) return;
      this.doc.defaultView?.clearTimeout(this.leaveTimer);
      this.leaveTimer = this.doc.defaultView?.setTimeout(() => this.cancel(), 80);
    }, { capture: true, signal });
    this.doc.addEventListener('dragend', () => { this.cancel(); this.internalDrag = false; this.cancelled = false; }, { signal });
    this.doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.layer) { this.cancelled = true; this.cancel(); }
    }, { capture: true, signal });
    this.doc.defaultView?.addEventListener('blur', () => this.cancel(), { signal });
  }

  cancel(): void {
    this.doc.defaultView?.clearTimeout(this.leaveTimer);
    this.layer?.remove();
    this.layer = undefined;
    this.root.classList.remove('is-image-drag-over');
  }

  dispose(): void { this.abort.abort(); this.cancel(); }

  private inside(event: DragEvent): boolean {
    return this.root.isConnected && this.options.enabled() && this.root.contains(event.target as Node);
  }

  private readonly over = (event: DragEvent): void => {
    if (event.type === 'dragenter' && !event.relatedTarget) this.cancelled = false;
    if (this.internalDrag || this.cancelled || !event.dataTransfer || !this.inside(event)
      || !mayContainImage(event.dataTransfer)) {
      this.cancel();
      return;
    }
    this.doc.defaultView?.clearTimeout(this.leaveTimer);
    event.preventDefault();
    event.stopImmediatePropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (this.layer) return;
    const layer = this.doc.createElement('div');
    layer.className = 'celtis-asset-ledger-root celtis-ledger-archive-drop-layer is-image-import';
    this.options.decorate(layer);
    const zone = this.doc.createElement('div');
    zone.className = 'celtis-ledger-archive-drop-zone is-over';
    zone.setAttribute('role', 'status');
    const art = this.doc.createElement('div');
    art.className = 'celtis-ledger-archive-drop-art';
    this.options.renderIcon(art);
    const copy = this.doc.createElement('div');
    copy.className = 'celtis-ledger-archive-drop-copy';
    const eyebrow = this.doc.createElement('span');
    eyebrow.textContent = '图片快速添加';
    const title = this.doc.createElement('strong');
    title.textContent = '松手，添加一件物品';
    const help = this.doc.createElement('small');
    help.textContent = '图片自动带入 · 填写名称与价格后保存';
    copy.append(eyebrow, title, help);
    zone.append(art, copy);
    layer.append(zone);
    this.doc.body.append(layer);
    this.root.classList.add('is-image-drag-over');
    this.layer = layer;
  };

  private readonly drop = (event: DragEvent): void => {
    const data = event.dataTransfer;
    if (this.internalDrag || !data || !this.inside(event) || !mayContainImage(data)) { this.cancel(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    const cancelled = this.cancelled;
    this.cancel();
    this.cancelled = false;
    if (cancelled) return;
    const result = readDroppedImage(data, this.doc);
    if (!result.image) {
      this.options.notify('未找到可导入的图片，请拖入图片文件或网页图片；普通网页链接不支持。');
      return;
    }
    if (result.count > 1) this.options.notify('本次先使用第一张图片；每次添加一件物品。');
    this.options.onDrop(result.image);
  };
}
