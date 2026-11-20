import { isArchived, type LedgerRecord } from './domain';

const SOURCE_SELECTOR = '[data-celtis-archive-draggable]';
const DRAG_DISTANCE = 8;

interface ArchiveDropOptions {
  getRecord(id: string): LedgerRecord | undefined;
  decorate(layer: HTMLElement): void;
  renderArtwork(host: HTMLElement, record: LedgerRecord): void;
  onDrop(recordId: string): void;
}

interface DragSession {
  id: string;
  source: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

/** Local pointer gestures avoid Obsidian's workspace/native drag-and-drop handlers. */
export class ArchiveDropController {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly abort = new AbortController();
  private session?: DragSession;
  private layer?: HTMLElement;
  private zone?: HTMLElement;
  private ghost?: HTMLElement;
  private headline?: HTMLElement;
  private openTimer?: number;
  private suppressClickUntil = 0;

  constructor(private readonly root: HTMLElement, private readonly options: ArchiveDropOptions) {
    this.doc = root.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    const signal = this.abort.signal;
    root.addEventListener('pointerdown', this.onPointerDown, { signal });
    root.addEventListener('click', this.onClick, { capture: true, signal });
    root.addEventListener('dragstart', (event) => {
      if ((event.target as Element | null)?.closest(SOURCE_SELECTOR)) event.preventDefault();
    }, { signal });
    this.doc.addEventListener('pointermove', this.onPointerMove, { capture: true, signal });
    this.doc.addEventListener('pointerup', this.onPointerUp, { capture: true, signal });
    this.doc.addEventListener('pointercancel', () => this.cancel(), { signal });
    this.doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.session) {
        event.preventDefault();
        this.cancel();
      }
    }, { capture: true, signal });
    this.win.addEventListener('blur', () => this.cancel(), { signal });
  }

  dispose(): void {
    this.abort.abort();
    this.cancel();
    if (this.openTimer != null) this.win.clearTimeout(this.openTimer);
  }

  cancel(): void {
    const session = this.session;
    this.session = undefined;
    if (session) {
      session.source.classList.remove('is-archive-dragging');
      if (session.dragging) this.suppressClickUntil = Date.now() + 300;
      if (session.source.hasPointerCapture?.(session.pointerId)) {
        session.source.releasePointerCapture(session.pointerId);
      }
    }
    const layer = this.layer;
    this.layer = undefined;
    this.zone = undefined;
    this.ghost = undefined;
    this.headline = undefined;
    if (layer) {
      layer.classList.add('is-leaving');
      this.win.setTimeout(() => layer.remove(), 180);
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (Date.now() < this.suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Touch keeps normal scrolling and the existing detail/archive action.
    if (event.button !== 0 || event.pointerType === 'touch' || !event.isPrimary) return;
    const source = (event.target as Element | null)?.closest<HTMLElement>(SOURCE_SELECTOR);
    if (!source || !this.root.contains(source)) return;
    const id = source.dataset.celtisArchiveDraggable;
    const record = id ? this.options.getRecord(id) : undefined;
    if (!record || isArchived(record)) return;
    this.cancel();
    this.session = {
      id: record.id, source, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, dragging: false,
    };
    source.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const session = this.session;
    if (!session || event.pointerId !== session.pointerId) return;
    if (!session.dragging) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < DRAG_DISTANCE) return;
      const record = this.options.getRecord(session.id);
      if (!record || isArchived(record)) {
        this.cancel();
        return;
      }
      session.dragging = true;
      session.source.classList.add('is-archive-dragging');
      this.showZone(record);
    }
    event.preventDefault();
    this.ghost?.style.setProperty('transform', `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`);
    const over = this.isOverZone(event.clientX, event.clientY);
    this.zone?.classList.toggle('is-over', over);
    if (this.headline) this.headline.textContent = over ? '松手，填写归档信息' : '拖到这里，快捷归档';
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const session = this.session;
    if (!session || event.pointerId !== session.pointerId) return;
    const shouldOpen = session.dragging && this.isOverZone(event.clientX, event.clientY);
    const id = session.id;
    if (session.dragging) event.preventDefault();
    this.cancel();
    if (shouldOpen) {
      this.openTimer = this.win.setTimeout(() => {
        this.openTimer = undefined;
        const current = this.options.getRecord(id);
        if (!this.abort.signal.aborted && this.root.isConnected && current && !isArchived(current)) {
          this.options.onDrop(id);
        }
      }, 0);
    }
  };

  private isOverZone(x: number, y: number): boolean {
    const rect = this.zone?.getBoundingClientRect();
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  private showZone(record: LedgerRecord): void {
    const layer = this.doc.createElement('div');
    layer.className = 'celtis-asset-ledger-root celtis-ledger-archive-drop-layer';
    this.options.decorate(layer);
    const zone = this.doc.createElement('div');
    zone.className = 'celtis-ledger-archive-drop-zone';
    zone.setAttribute('role', 'region');
    zone.setAttribute('aria-label', '快捷归档投放区');
    const art = this.doc.createElement('div');
    art.className = 'celtis-ledger-archive-drop-art';
    this.options.renderArtwork(art, record);
    zone.append(art);
    const copy = this.doc.createElement('div');
    copy.className = 'celtis-ledger-archive-drop-copy';
    const name = this.doc.createElement('span');
    name.textContent = record.name;
    const headline = this.doc.createElement('strong');
    headline.textContent = '拖到这里，快捷归档';
    headline.setAttribute('role', 'status');
    const help = this.doc.createElement('small');
    help.textContent = '松手后填写卖出价格 · Esc 取消';
    copy.append(name, headline, help);
    zone.append(copy);
    const ghost = this.doc.createElement('div');
    ghost.className = 'celtis-ledger-archive-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    this.options.renderArtwork(ghost, record);
    layer.append(zone, ghost);
    this.doc.body.append(layer);
    this.layer = layer;
    this.zone = zone;
    this.ghost = ghost;
    this.headline = headline;
  }
}
