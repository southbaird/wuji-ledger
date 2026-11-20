import { setIcon } from 'obsidian';

import { applyLedgerColorTheme, normalizeLedgerColorTheme } from './product-theme';

export interface DateControl {
  readonly input: HTMLInputElement;
  readonly value: string;
  focus(): void;
  setValue(value: string): void;
  dispose(): void;
}

interface DateControlOptions {
  label: string;
  value?: string;
  allowClear?: boolean;
}

let activePopover: DatePopover | undefined;

export function createDateControl(
  root: HTMLElement,
  options: DateControlOptions,
): DateControl {
  const host = root.createDiv({ cls: 'celtis-ledger-date-control' });
  const input = host.createEl('input', {
    cls: 'celtis-ledger-date-value',
    attr: { type: 'hidden', value: normalizeISODate(options.value ?? '') },
  });
  const trigger = host.createEl('button', {
    cls: 'celtis-ledger-date-trigger',
    attr: {
      type: 'button',
      'aria-label': `${options.label}，打开日期选择`,
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    },
  });
  setIcon(trigger.createSpan({ cls: 'celtis-ledger-date-icon' }), 'calendar-days');
  const display = trigger.createSpan({ cls: 'celtis-ledger-date-display' });
  setIcon(trigger.createSpan({ cls: 'celtis-ledger-date-chevron' }), 'chevron-down');

  const updateDisplay = (): void => {
    display.setText(input.value ? formatDisplayDate(input.value) : '年 / 月 / 日');
    trigger.toggleClass('is-empty', !input.value);
  };

  const setValue = (value: string): void => {
    input.value = normalizeISODate(value);
    updateDisplay();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const close = (restoreFocus = false): void => {
    if (activePopover?.anchor === trigger) {
      activePopover.close(restoreFocus);
    }
  };

  trigger.addEventListener('click', () => {
    if (activePopover?.anchor === trigger) {
      activePopover.close(true);
      return;
    }

    activePopover?.close(false);
    activePopover = new DatePopover(trigger, {
      label: options.label,
      value: input.value,
      allowClear: options.allowClear !== false,
      onSelect: setValue,
    });
    activePopover.open();
  });

  host.addEventListener('celtis-date-dispose', () => close(false));
  updateDisplay();

  return {
    input,
    get value(): string {
      return input.value;
    },
    focus(): void {
      trigger.focus({ preventScroll: true });
    },
    setValue,
    dispose(): void {
      close(false);
    },
  };
}

export function disposeDateControls(root: ParentNode): void {
  for (const control of root.querySelectorAll<HTMLElement>('.celtis-ledger-date-control')) {
    control.dispatchEvent(new Event('celtis-date-dispose'));
  }
}

interface DatePopoverOptions {
  label: string;
  value: string;
  allowClear: boolean;
  onSelect: (value: string) => void;
}

class DatePopover {
  readonly anchor: HTMLButtonElement;
  private readonly options: DatePopoverOptions;
  private readonly root: HTMLDivElement;
  private readonly abortController = new AbortController();
  private readonly doc: Document;
  private readonly win: Window;
  private readonly portalHost: HTMLElement;
  private viewYear: number;
  private viewMonth: number;

  constructor(anchor: HTMLButtonElement, options: DatePopoverOptions) {
    this.anchor = anchor;
    this.options = options;
    this.doc = anchor.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    this.portalHost = anchor.closest<HTMLElement>('.modal-container') ?? this.doc.body;
    const basis = parseISODate(options.value) ?? parseISODate(todayInShanghai()) ?? new Date();
    this.viewYear = basis.getFullYear();
    this.viewMonth = basis.getMonth();
    this.root = this.doc.createElement('div');
    this.root.className = 'celtis-asset-ledger-root celtis-ledger-date-popover';
    applyLedgerColorTheme(
      this.root,
      normalizeLedgerColorTheme(
        anchor.closest<HTMLElement>('.celtis-asset-ledger-root')?.dataset.celtisTheme,
      ),
    );
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.setAttribute('aria-label', `${options.label}日期选择`);
  }

  open(): void {
    this.portalHost.appendChild(this.root);
    this.anchor.setAttribute('aria-expanded', 'true');
    this.render();
    this.position();

    const signal = this.abortController.signal;
    this.win.setTimeout(() => {
      if (signal.aborted) {
        return;
      }
      this.doc.addEventListener('pointerdown', this.onDocumentPointerDown, {
        capture: true,
        signal,
      });
    }, 0);
    this.doc.addEventListener('keydown', this.onDocumentKeyDown, { signal });
    this.win.addEventListener('resize', this.onViewportChange, { signal });
    this.doc.addEventListener('scroll', this.onViewportChange, { capture: true, signal });

    this.win.requestAnimationFrame(() => {
      const preferred = this.root.querySelector<HTMLButtonElement>(
        '.celtis-ledger-calendar-day.is-selected, .celtis-ledger-calendar-day.is-today, .celtis-ledger-calendar-day:not(.is-outside)',
      );
      preferred?.focus({ preventScroll: true });
    });
  }

  close(restoreFocus: boolean): void {
    this.abortController.abort();
    this.root.remove();
    this.anchor.setAttribute('aria-expanded', 'false');
    if (activePopover === this) {
      activePopover = undefined;
    }
    if (restoreFocus && this.anchor.isConnected) {
      this.anchor.focus({ preventScroll: true });
    }
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    const NodeConstructor = this.doc.defaultView?.Node;
    if (!NodeConstructor || !(target instanceof NodeConstructor)
      || (!this.root.contains(target) && !this.anchor.contains(target))) {
      this.close(false);
    }
  };

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
    }
  };

  private readonly onViewportChange = (): void => {
    this.position();
  };

  private render(): void {
    this.root.replaceChildren();
    const header = this.root.createDiv({ cls: 'celtis-ledger-calendar-header' });
    this.createIconButton(header, 'chevron-left', '上一个月', () => {
      this.changeMonth(-1);
    });

    const selectors = header.createDiv({ cls: 'celtis-ledger-calendar-selectors' });
    const month = selectors.createEl('select', { attr: { 'aria-label': '月份' } });
    for (let index = 0; index < 12; index += 1) {
      month.createEl('option', {
        text: `${index + 1} 月`,
        attr: { value: String(index) },
      });
    }
    month.value = String(this.viewMonth);
    month.addEventListener('change', () => {
      this.viewMonth = Number(month.value);
      this.render();
      this.position();
    });

    const year = selectors.createEl('select', { attr: { 'aria-label': '年份' } });
    const currentYear = Number(todayInShanghai().slice(0, 4));
    const startYear = Math.min(this.viewYear, currentYear - 40);
    const endYear = Math.max(this.viewYear, currentYear + 10);
    for (let value = endYear; value >= startYear; value -= 1) {
      year.createEl('option', {
        text: `${value} 年`,
        attr: { value: String(value) },
      });
    }
    year.value = String(this.viewYear);
    year.addEventListener('change', () => {
      this.viewYear = Number(year.value);
      this.render();
      this.position();
    });

    this.createIconButton(header, 'chevron-right', '下一个月', () => {
      this.changeMonth(1);
    });

    const weekdays = this.root.createDiv({ cls: 'celtis-ledger-calendar-weekdays' });
    for (const weekday of ['日', '一', '二', '三', '四', '五', '六']) {
      weekdays.createSpan({ text: weekday });
    }

    const grid = this.root.createDiv({ cls: 'celtis-ledger-calendar-grid' });
    const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1, 12);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(1 - firstOfMonth.getDay());
    const selected = this.options.value;
    const today = todayInShanghai();

    for (let offset = 0; offset < 42; offset += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + offset);
      const iso = formatISODate(date);
      const day = grid.createEl('button', {
        cls: 'celtis-ledger-calendar-day',
        text: String(date.getDate()),
        attr: {
          type: 'button',
          'data-date': iso,
          'aria-label': formatAccessibleDate(date),
          tabindex: iso === selected || (!selected && iso === today) ? '0' : '-1',
        },
      });
      day.toggleClass('is-outside', date.getMonth() !== this.viewMonth);
      day.toggleClass('is-today', iso === today);
      day.toggleClass('is-selected', iso === selected);
      if (iso === selected) {
        day.setAttribute('aria-current', 'date');
      }
      day.addEventListener('click', () => {
        this.options.onSelect(iso);
        this.close(true);
      });
      day.addEventListener('keydown', (event) => this.onDayKeyDown(event, iso));
    }

    const footer = this.root.createDiv({ cls: 'celtis-ledger-calendar-footer' });
    const todayButton = footer.createEl('button', {
      cls: 'celtis-ledger-calendar-text-button',
      text: '今天',
      attr: { type: 'button' },
    });
    todayButton.addEventListener('click', () => {
      this.options.onSelect(today);
      this.close(true);
    });
    if (this.options.allowClear) {
      const clear = footer.createEl('button', {
        cls: 'celtis-ledger-calendar-text-button is-muted',
        text: '清除',
        attr: { type: 'button' },
      });
      clear.addEventListener('click', () => {
        this.options.onSelect('');
        this.close(true);
      });
    }
  }

  private onDayKeyDown(event: KeyboardEvent, iso: string): void {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = deltas[event.key];
    if (delta == null) {
      return;
    }
    event.preventDefault();
    const current = parseISODate(iso);
    if (!current) {
      return;
    }
    current.setDate(current.getDate() + delta);
    const target = formatISODate(current);
    if (current.getMonth() !== this.viewMonth || current.getFullYear() !== this.viewYear) {
      this.viewMonth = current.getMonth();
      this.viewYear = current.getFullYear();
      this.render();
      this.position();
    }
    this.root.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus({
      preventScroll: true,
    });
  }

  private createIconButton(
    root: HTMLElement,
    icon: string,
    label: string,
    callback: () => void,
  ): void {
    const button = root.createEl('button', {
      cls: 'celtis-ledger-calendar-nav',
      attr: { type: 'button', 'aria-label': label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener('click', callback);
  }

  private changeMonth(delta: number): void {
    const next = new Date(this.viewYear, this.viewMonth + delta, 1, 12);
    this.viewYear = next.getFullYear();
    this.viewMonth = next.getMonth();
    this.render();
    this.position();
  }

  private position(): void {
    const anchor = this.anchor.getBoundingClientRect();
    const popover = this.root.getBoundingClientRect();
    const gutter = 10;
    const viewportPadding = 10;
    const availableBelow = this.win.innerHeight - anchor.bottom - gutter - viewportPadding;
    const top = availableBelow >= popover.height
      ? anchor.bottom + gutter
      : Math.max(viewportPadding, anchor.top - popover.height - gutter);
    const left = Math.min(
      Math.max(viewportPadding, anchor.left),
      Math.max(viewportPadding, this.win.innerWidth - popover.width - viewportPadding),
    );
    this.root.style.setProperty('--celtis-popover-top', `${Math.round(top)}px`);
    this.root.style.setProperty('--celtis-popover-left', `${Math.round(left)}px`);
  }
}

function normalizeISODate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function parseISODate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return undefined;
  }
  return date;
}

function formatISODate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
  return value.replace(/-/g, '/');
}

function formatAccessibleDate(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}
