import {
  Notice,
  Platform,
  setIcon,
  type App,
  type PluginManifest,
} from 'obsidian';

import type { LedgerRecord } from './domain';
import {
  canUseAppleStickerUI,
  createAppleStickerFromCover,
} from './mac-sticker';
import { getStickerShape, isGeneratedStickerPath } from './sticker-layout';

export type StickerPreparationResult =
  | 'converted'
  | 'failed'
  | 'cancelled'
  | 'changed'
  | 'busy'
  | 'skipped';

export interface CoverToolsController {
  importImage(file: File): Promise<void>;
  prepareRemoteCoverSticker(): Promise<StickerPreparationResult>;
  beginSave(savedCover: string): boolean;
  finishSave(success: boolean): void;
  dispose(): void;
}

export interface CoverToolsPlugin {
  app: App;
  manifest: PluginManifest;
  data: { records: LedgerRecord[] };
  getAssetUrl(path: string): string;
  importCoverImage(file: File): Promise<string>;
  discardManagedCoverAsset(path: string): Promise<void>;
  registerCoverSession(dispose: () => void): () => void;
  openExistingCoverPicker(onSelect: (path: string) => void): void;
}

export function renderCoverTools(
  root: HTMLElement,
  cover: HTMLInputElement,
  clearCover: HTMLButtonElement,
  plugin: CoverToolsPlugin,
): CoverToolsController {
  const tools = root.createDiv({ cls: 'celtis-ledger-cover-tools' });
  const source = tools.createDiv({
    cls: 'celtis-ledger-cover-source',
    attr: { 'aria-live': 'polite' },
  });
  const preview = source.createDiv({ cls: 'celtis-ledger-cover-preview' });
  const previewFallback = preview.createSpan({ cls: 'celtis-ledger-cover-preview-fallback' });
  setIcon(previewFallback, 'image');
  const image = preview.createEl('img', { attr: { alt: '当前封面预览' } });
  const sourceCopy = source.createDiv({ cls: 'celtis-ledger-cover-source-copy' });
  const sourceTitle = sourceCopy.createEl('strong');
  const sourceDetail = sourceCopy.createSpan();

  let previewTimer: number | undefined;
  let pendingManagedCover: string | undefined;
  let disposed = false;
  let importBusy = false;
  let stickerBusy = false;
  let activeSave: { pendingManagedCover?: string } | undefined;
  let prepareRemoteCoverSticker = async (): Promise<StickerPreparationResult> => 'skipped';

  const sourceDescription = (path: string): string => {
    if (/^https?:\/\//i.test(path)) {
      try {
        return new URL(path).hostname;
      } catch {
        return '请继续输入完整的图片链接';
      }
    }
    if (/^assets\/user\//i.test(path)) {
      return '保存在本地插件资源中';
    }
    return 'vault 路径或内置素材';
  };

  const resetPreviewState = (): void => {
    source.removeClass('is-loading', 'is-loaded', 'is-error');
  };

  const loadPreview = (path: string): void => {
    if (path !== cover.value.trim()) {
      return;
    }
    image.dataset.coverPath = path;
    image.src = plugin.getAssetUrl(path);
  };

  const syncPreview = (immediate = false): void => {
    if (previewTimer != null) {
      window.clearTimeout(previewTimer);
      previewTimer = undefined;
    }
    const path = cover.value.trim();
    const isStickerCover = isGeneratedStickerPath(path);
    source.toggleClass('is-sticker-cover', isStickerCover);
    if (isStickerCover) {
      source.dataset.stickerShape = 'standard';
    } else {
      delete source.dataset.stickerShape;
    }
    cover.setAttr('title', path);
    clearCover.toggleAttribute('hidden', !path);
    source.toggleAttribute('hidden', !path);
    resetPreviewState();
    if (!path) {
      image.dataset.coverPath = '';
      image.removeAttribute('src');
      image.hidden = true;
      return;
    }

    source.addClass('is-loading');
    sourceTitle.setText('正在加载图片预览');
    sourceDetail.setText(sourceDescription(path));
    setIcon(previewFallback, 'image');
    image.hidden = true;
    previewTimer = window.setTimeout(() => {
      previewTimer = undefined;
      loadPreview(path);
    }, immediate ? 0 : 220);
  };

  image.addEventListener('error', () => {
    if (image.dataset.coverPath !== cover.value.trim()) {
      return;
    }
    image.hidden = true;
    resetPreviewState();
    source.addClass('is-error');
    sourceTitle.setText('无法预览这张图片');
    sourceDetail.setText(
      /^https?:\/\//i.test(cover.value.trim())
        ? '请检查它是否为可直接访问的图片链接。'
        : '请检查文件名或 vault 路径。',
    );
    setIcon(previewFallback, 'image-off');
  });
  image.addEventListener('load', () => {
    if (image.dataset.coverPath !== cover.value.trim()) {
      return;
    }
    image.hidden = false;
    if (isGeneratedStickerPath(cover.value.trim())) {
      source.dataset.stickerShape = getStickerShape(image.naturalWidth, image.naturalHeight);
    }
    resetPreviewState();
    source.addClass('is-loaded');
    sourceTitle.setText(
      /^https?:\/\//i.test(cover.value.trim()) ? '图片链接已载入' : '本地封面已载入',
    );
    sourceDetail.setText(sourceDescription(cover.value.trim()));
  });
  cover.addEventListener('input', () => syncPreview(false));
  cover.addEventListener('change', () => syncPreview(true));

  const controls = tools.createDiv({ cls: 'celtis-ledger-sticker-controls' });
  const actions = controls.createDiv({ cls: 'celtis-ledger-sticker-actions' });
  const fileInput = controls.createEl('input', {
    cls: 'celtis-ledger-sticker-file',
    attr: {
      type: 'file',
      accept: 'image/png,image/jpeg,image/heic,image/heif,image/webp,image/avif',
      tabindex: '-1',
    },
  });
  const chooseImage = createCoverActionButton(
    actions,
    'image-plus',
    Platform.isMobileApp ? '从相册或文件选择' : '选择本地图片',
    () => fileInput.click(),
  );
  const reuseImage = createCoverActionButton(
    actions,
    'images',
    '复用台账图片',
    () => {
      if (importBusy || stickerBusy) {
        return;
      }
      plugin.openExistingCoverPicker((path) => {
        if (disposed) {
          return;
        }
        replaceCover(path, false);
        status.setText('已复用台账中的图片；保存后生效。');
      });
    },
  );
  const status = controls.createSpan({
    cls: 'celtis-ledger-sticker-status',
    text: getCoverPlatformMessage(),
  });

  const discardPendingManagedCover = (): void => {
    if (!pendingManagedCover) {
      return;
    }
    const discarded = pendingManagedCover;
    pendingManagedCover = undefined;
    void plugin.discardManagedCoverAsset(discarded).catch((error) => {
      console.error('物迹账本 could not discard a pending cover', error);
    });
  };

  function replaceCover(path: string, ownedByForm: boolean): void {
    const previousPending = pendingManagedCover;
    pendingManagedCover = ownedByForm ? path : undefined;
    cover.value = path;
    cover.dispatchEvent(new Event('input', { bubbles: true }));
    cover.dispatchEvent(new Event('change', { bubbles: true }));
    if (previousPending && previousPending !== path) {
      void plugin.discardManagedCoverAsset(previousPending).catch((error) => {
        console.error('物迹账本 could not replace a pending cover', error);
      });
    }
  }

  clearCover.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (pendingManagedCover && cover.value.trim() === pendingManagedCover) {
      discardPendingManagedCover();
    }
    cover.value = '';
    cover.dispatchEvent(new Event('input', { bubbles: true }));
    cover.dispatchEvent(new Event('change', { bubbles: true }));
    status.setText(getCoverPlatformMessage());
    cover.focus({ preventScroll: true });
  });

  const allCommonControls = [chooseImage, reuseImage, fileInput, cover, clearCover];

  const importLocalImage = async (file: File): Promise<void> => {
    if (disposed) {
      return;
    }
    if (importBusy || stickerBusy) {
      new Notice('另一张图片仍在处理，请完成后再试');
      return;
    }
    importBusy = true;
    const previousDisabled = disableControls(allCommonControls);
    chooseImage.setAttr('aria-busy', 'true');
    status.setText('正在本地保存图片…');
    try {
      const path = await plugin.importCoverImage(file);
      if (disposed) {
        await plugin.discardManagedCoverAsset(path);
        return;
      }
      replaceCover(path, true);
      status.setText(
        Platform.isIosApp
          ? '图片已在 iPhone/iPad 本地保存；若粘贴的是系统已抠好的主体，透明背景会保留。'
          : '图片已在本地保存；保存记录后会作为新封面。',
      );
    } catch (error) {
      if (!disposed) {
        const message = error instanceof Error ? error.message : '导入图片失败，请重试。';
        status.setText('图片未导入；当前封面保持不变。');
        new Notice(message);
      }
    } finally {
      importBusy = false;
      chooseImage.removeAttribute('aria-busy');
      if (!disposed) {
        restoreControls(previousDisabled);
      }
    }
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) {
      void importLocalImage(file);
    }
  });

  cover.addEventListener('paste', (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }
    const files: File[] = [];
    for (const item of Array.from(clipboard.items)) {
      if (item.kind !== 'file') {
        continue;
      }
      const file = item.getAsFile();
      if (file?.type.toLocaleLowerCase('en-US').startsWith('image/')) {
        files.push(file);
      }
    }
    if (files.length === 0) {
      for (const file of Array.from(clipboard.files)) {
        if (file.type.toLocaleLowerCase('en-US').startsWith('image/')) {
          files.push(file);
        }
      }
    }
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (files.length > 1) {
      new Notice('每次只会使用第一张粘贴的图片');
    }
    void importLocalImage(files[0]!);
  });

  if (canUseAppleStickerUI()) {
    const createFromCurrent = createCoverActionButton(
      actions,
      'sparkles',
      '将当前封面转为贴纸',
      async () => {
        const currentCover = cover.value.trim();
        const isRemote = /^https?:\/\//i.test(currentCover);
        await runSticker(
          () => createAppleStickerFromCover(plugin.app, plugin.manifest, currentCover),
          createFromCurrent,
          isRemote ? '正在下载并制作…' : '正在制作贴纸…',
          isRemote
            ? '正在下载链接图片，并用 Apple Vision 识别主体…'
            : '正在读取当前封面，并用 Apple Vision 识别主体…',
          currentCover,
          currentCover,
        );
      },
    );
    createFromCurrent.removeClass('is-soft');
    createFromCurrent.addClass('is-sticker', 'is-link-sticker');
    const currentButtonLabel = createFromCurrent.querySelector<HTMLElement>(
      '.celtis-ledger-button-label',
    );

    const syncStickerActions = (): void => {
      const currentCover = cover.value.trim();
      const hasRemoteCover = /^https?:\/\//i.test(currentCover);
      const hasConvertibleCover = Boolean(currentCover) && !isGeneratedStickerPath(currentCover);
      createFromCurrent.toggleAttribute('hidden', !hasConvertibleCover);
      currentButtonLabel?.setText(
        hasRemoteCover ? '将链接转为贴纸' : '将当前封面转为贴纸',
      );
    };

    let activeStickerTask: {
      sourceKey: string;
      promise: Promise<StickerPreparationResult>;
    } | undefined;

    const runSticker = async (
      factory: () => Promise<string>,
      activeButton: HTMLButtonElement,
      busyLabel: string,
      busyStatus: string,
      expectedCover?: string,
      sourceKey = expectedCover ?? '',
    ): Promise<StickerPreparationResult> => {
      if (importBusy) {
        new Notice('图片仍在导入，请完成后再制作贴纸');
        return 'busy';
      }
      if (activeStickerTask) {
        if (sourceKey && activeStickerTask.sourceKey === sourceKey) {
          return activeStickerTask.promise;
        }
        new Notice('另一张贴纸仍在生成，请完成后再试');
        return 'busy';
      }

      stickerBusy = true;
      const disabledControls = [...allCommonControls, createFromCurrent];
      const previousDisabled = disableControls(disabledControls);
      activeButton.setAttr('aria-busy', 'true');
      activeButton.querySelector<HTMLElement>('.celtis-ledger-button-label')?.setText(busyLabel);
      status.setText(busyStatus);

      let taskPromise!: Promise<StickerPreparationResult>;
      taskPromise = (async (): Promise<StickerPreparationResult> => {
        try {
          const path = await factory();
          if (disposed) {
            await plugin.discardManagedCoverAsset(path);
            return 'cancelled';
          }
          if (expectedCover != null && cover.value.trim() !== expectedCover) {
            await plugin.discardManagedCoverAsset(path);
            status.setText('封面已变化，刚生成的贴纸没有替换当前封面。');
            return 'changed';
          }

          replaceCover(path, true);
          status.setText('贴纸已生成；保存后会作为新封面。');
          return 'converted';
        } catch (error) {
          if (disposed) {
            return 'cancelled';
          }
          const message = error instanceof Error ? error.message : 'Apple 本地抠图失败，请重试。';
          status.setText('贴纸未生成；当前封面保持不变。');
          new Notice(message);
          return 'failed';
        } finally {
          activeStickerTask = undefined;
          stickerBusy = false;
          activeButton.removeAttribute('aria-busy');
          if (!disposed) {
            restoreControls(previousDisabled);
            syncStickerActions();
          }
        }
      })();
      activeStickerTask = { sourceKey, promise: taskPromise };
      return taskPromise;
    };

    prepareRemoteCoverSticker = async (): Promise<StickerPreparationResult> => {
      const currentCover = cover.value.trim();
      if (disposed) {
        return 'cancelled';
      }
      if (!/^https?:\/\//i.test(currentCover) || isGeneratedStickerPath(currentCover)) {
        return 'skipped';
      }
      return runSticker(
        () => createAppleStickerFromCover(plugin.app, plugin.manifest, currentCover),
        createFromCurrent,
        '正在自动制作…',
        '保存前正在 Mac 本地自动制作贴纸；失败会保留原链接…',
        currentCover,
        currentCover,
      );
    };

    cover.addEventListener('input', syncStickerActions);
    cover.addEventListener('change', syncStickerActions);
    syncStickerActions();
  }

  syncPreview(true);

  let unregisterCoverSession = (): void => undefined;
  const controller: CoverToolsController = {
    importImage: importLocalImage,
    prepareRemoteCoverSticker: () => prepareRemoteCoverSticker(),
    beginSave(savedCover: string): boolean {
      if (disposed) {
        return false;
      }
      if (importBusy) {
        new Notice('图片仍在导入，请完成后再保存');
        return false;
      }
      if (stickerBusy) {
        new Notice('贴纸仍在生成，请完成后再保存');
        return false;
      }
      if (activeSave) {
        return false;
      }
      activeSave = {
        pendingManagedCover:
          savedCover.trim() === pendingManagedCover ? pendingManagedCover : undefined,
      };
      return true;
    },
    finishSave(success: boolean): void {
      const savedPendingCover = activeSave?.pendingManagedCover;
      activeSave = undefined;
      if (success && savedPendingCover && pendingManagedCover === savedPendingCover) {
        pendingManagedCover = undefined;
      }
      if (disposed) {
        discardPendingManagedCover();
      }
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      unregisterCoverSession();
      if (previewTimer != null) {
        window.clearTimeout(previewTimer);
        previewTimer = undefined;
      }
      if (
        activeSave?.pendingManagedCover
        && activeSave.pendingManagedCover === pendingManagedCover
      ) {
        return;
      }
      discardPendingManagedCover();
    },
  };
  unregisterCoverSession = plugin.registerCoverSession(() => controller.dispose());
  return controller;
}

function createCoverActionButton(
  root: HTMLElement,
  icon: string,
  label: string,
  callback: () => void | Promise<void>,
): HTMLButtonElement {
  const button = root.createEl('button', {
    cls: 'celtis-ledger-button is-soft',
    attr: { type: 'button' },
  });
  const iconElement = button.createSpan({ cls: 'celtis-ledger-button-icon' });
  setIcon(iconElement, icon);
  button.createSpan({ cls: 'celtis-ledger-button-label', text: label });
  button.addEventListener('click', () => {
    try {
      const result = callback();
      if (result) {
        void result.catch((error) => {
          console.error(`物迹账本 cover action "${label}" failed`, error);
        });
      }
    } catch (error) {
      console.error(`物迹账本 cover action "${label}" failed`, error);
    }
  });
  return button;
}

function disableControls(controls: readonly HTMLElement[]): Map<HTMLElement, boolean> {
  const states = new Map<HTMLElement, boolean>();
  for (const control of controls) {
    states.set(control, control.hasAttribute('disabled'));
    control.setAttribute('disabled', 'true');
  }
  return states;
}

function restoreControls(states: ReadonlyMap<HTMLElement, boolean>): void {
  for (const [control, wasDisabled] of states) {
    if (!wasDisabled) {
      control.removeAttribute('disabled');
    }
  }
}

function getCoverPlatformMessage(): string {
  if (canUseAppleStickerUI()) {
    return 'Apple Vision 贴纸仅在 Mac 本地处理，不会上传图片';
  }
  if (Platform.isIosApp) {
    return 'iPhone/iPad 可选图或粘贴“照片”中已抠好的主体；自动抠图仅支持 Mac';
  }
  if (Platform.isMobileApp) {
    return '移动端可选择或粘贴普通封面；自动抠图仅支持 Mac';
  }
  if (Platform.isMacOS) {
    return '自动抠图需手动安装可选 Mac 组件';
  }
  return '当前设备可选择或粘贴普通封面；转为贴纸仅支持 Mac';
}
