import {
  App,
  ItemView,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  requestUrl,
  setIcon,
  type DataAdapter,
} from 'obsidian';

import {
  createBloubAvatar,
  createBloubSeed,
  resolveDistinctBloubSeed,
  type BloubAvatarController,
  type BloubShape,
  type BloubTone,
} from './bloub-avatar';
import {
  BLOUB_SHAPE_OPTIONS,
  BLOUB_TONE_OPTIONS,
  type PageAvatarShape,
  type PageAvatarTone,
} from './appearance';
import {
  MAX_COVER_IMAGE_BYTES,
  SUPPORTED_COVER_IMAGE_MESSAGE,
  getCoverImageKindFromSignature,
  getReusableCoverOptions,
  isManagedCoverAssetPath,
  sanitizeCoverFileStem,
  type ReusableCoverOption,
} from './cover-assets';
import {
  createDateControl,
  disposeDateControls,
  type DateControl,
} from './date-picker';
import { getArchiveCardVariant } from './archive-presentation';
import { ArchiveDropController } from './archive-drop';
import { ImageDropController, type DroppedImage } from './image-drop';
import { applyArchiveDraft } from './quick-archive';
import { renderCoverTools as renderCoverToolsV2 } from './cover-tools';
import {
  canUseAppleStickerUI,
  initializeAppleSticker,
} from './mac-sticker';

import {
  getEffectivePurchaseDate,
  getItemCost,
  getLedgerSummary,
  getLinkedAccessories,
  getRecordCost,
  isArchived,
  isArchiveDateBeforePurchase,
  resolvePurchaseDateForSave,
  type DayInput,
  type LedgerRecord,
  type LedgerRecordType,
} from './domain';
import {
  getLedgerInsights,
  type LedgerInsights,
  type PurchaseYearEntry,
} from './insights';
import {
  buildInlineEditGroups,
  type InlineEditGrouping,
} from './inline-edit';
import {
  LEDGER_ONBOARDING_STEPS,
  shouldShowLedgerOnboarding,
} from './onboarding';
import {
  WIDGET_LAYOUT_OPTIONS,
  WIDGET_THEME_OPTIONS,
  getMobileWidgetModel,
  type MobileWidgetItem,
  type WidgetLayout,
  type WidgetTheme,
} from './mobile-widget';
import {
  MOBILE_SUMMARY_MARKER,
  isManagedMobileSummary,
} from './mobile-summary';
import {
  LEDGER_COLOR_THEME_OPTIONS,
  applyLedgerColorTheme,
  getLedgerColorThemeOption,
  type LedgerColorTheme,
} from './product-theme';
import {
  hasStoredDataEnvelope,
  resolveStoredData,
  type LedgerPreferences,
  type SortMode,
  type StoredLedgerData,
  type ViewMode,
} from './stored-data';
import {
  getStickerBoardPose,
  getStickerShape,
  isGeneratedStickerPath,
} from './sticker-layout';
import {
  getStickerCollectionRecords,
  getStickerDetailModel,
  type StickerCollectionFilter,
} from './sticker-gallery';
import {
  buildLedgerShareModel,
  buildRecordShareModel,
  copyPngBlob,
  getLedgerShareScopeLabel,
  imageBlobToPng,
  renderLedgerSharePoster,
  renderRecordSharePoster,
  sharePngBlob,
  type LedgerShareScope,
} from './share-image';

const VIEW_TYPE = 'celtis-asset-ledger-view';
const WIDGET_VIEW_TYPE = 'celtis-asset-ledger-widget-view';
const DATA_BACKUP_FILENAME = 'data.backup.json';
const MOBILE_SUMMARY_FOLDER = '物迹账本';
const MOBILE_SUMMARY_PATH = `${MOBILE_SUMMARY_FOLDER}/随身摘要.md`;
const LEGACY_MOBILE_SUMMARY_PATH = 'Celtis Asset Ledger/随身摘要.md';

const DIRECTION_CONTRACT = `
THESIS: A relationship-first possession ledger, not a generic KPI dashboard; every number resolves to an item, its accessories, and its lived time.
OWN-WORLD: Notion's warm paper canvas translated through Cupertino precision—white object cards, rose active field, blue archive field, real product cutouts, and compact native controls.
STORY: Scan what is owned, understand daily cost, follow accessory relationships, then edit or archive without leaving Obsidian.
FIRST VIEWPORT: A living title Bloub and controls above two summary cards; the active object gallery carries the main visual weight.
FORM: Operate-mode relationship ledger; pinned Notion reference with Obsidian-native drawer staging; no concept seed was required.
`;

type StatusFilter = 'all' | 'active' | 'archived';

interface RegisteredBloubAvatar {
  slot: string;
  controller: BloubAvatarController;
}

interface BloubSlotState {
  seed: number;
  epochMs: number;
}

interface RecordFormRefs {
  name: HTMLInputElement;
  purchaseDate: DateControl;
  purchaseCost: HTMLInputElement;
  saleIncome: HTMLInputElement;
  archiveDate: DateControl;
  linkedItemId?: HTMLSelectElement;
  cover: HTMLInputElement;
  notes: HTMLTextAreaElement;
  importImage(file: File): Promise<void>;
  prepareRemoteCoverSticker(): Promise<StickerPreparationResult>;
  beginSave(savedCover?: string): boolean;
  finishSave(success: boolean): void;
  dispose(): void;
}

interface RecordFormOptions {
  explainAccessoryDateInheritance?: boolean;
  inheritedPurchaseDate?: string;
  autoStickerFromRemoteOnSave?: boolean;
}

type StickerPreparationResult =
  | 'converted'
  | 'failed'
  | 'cancelled'
  | 'changed'
  | 'busy'
  | 'skipped';

interface UpsertRecordOptions {
  onPersisted?: () => void;
  refreshInheritedPurchaseDate?: boolean;
  requireActiveLinkedItem?: boolean;
  refresh?: boolean;
}

interface CreateRecordOptions {
  linkedItemId?: string;
  droppedImage?: DroppedImage;
}

interface SharePoster {
  blob: Blob;
  title: string;
  fileName: string;
}

type ShareImageTarget =
  | { kind: 'ledger' }
  | { kind: 'record'; recordId: string };

export default class WujiLedgerPlugin extends Plugin {
  data!: StoredLedgerData;
  private mutationQueue: Promise<void> = Promise.resolve();
  private colorThemeSelectionVersion = 0;
  private appliedColorTheme: LedgerColorTheme | undefined;
  private readonly coverSessions = new Set<() => void>();
  private readonly bloubAvatars = new Set<RegisteredBloubAvatar>();
  private readonly bloubSlots = new Map<string, BloubSlotState>();

  override async onload(): Promise<void> {
    await initializeAppleSticker(this.app, this.manifest);
    const loaded: unknown = await this.loadData();
    const backup = hasStoredDataEnvelope(loaded) ? undefined : await this.loadDataBackup();
    const resolution = resolveStoredData(loaded, backup);
    this.data = resolution.data;
    this.appliedColorTheme = this.data.preferences.colorTheme;

    if (resolution.source === 'backup') {
      await this.saveData(this.createDataSnapshot(this.data));
      new Notice('资产台账已从本地备份恢复，贴纸封面保持不变。');
    } else if (resolution.source === 'default' && loaded == null) {
      await this.saveData(this.createDataSnapshot(this.data));
    } else if (resolution.source === 'default') {
      console.error('物迹账本 loaded invalid data and kept the source file untouched');
      new Notice('资产台账数据结构异常，原文件未被覆盖。');
    }

    if (resolution.source !== 'default' || loaded == null) {
      await this.saveDataBackup(this.data);
    }
    this.app.workspace.onLayoutReady(() => {
      void this.migrateLegacyMobileSummary()
        .then(() => this.refreshManagedMobileSummary())
        .catch((error) => {
          console.error('物迹账本 could not initialize its mobile summary', error);
        });
    });

    this.registerView(VIEW_TYPE, (leaf) => new AssetLedgerView(leaf, this));
    this.registerView(WIDGET_VIEW_TYPE, (leaf) => new AssetWidgetView(leaf, this));

    this.addRibbonIcon('package-open', '打开资产台账', () => {
      void this.activateView().catch((error) => {
        console.error('物迹账本 could not open its view', error);
      });
    });

    if (Platform.isMobileApp) {
      this.addRibbonIcon('layout-dashboard', '打开资产随身看板', () => {
        void this.activateWidgetView().catch((error) => {
          console.error('物迹账本 could not open its pocket dashboard', error);
        });
      });
    }

    this.addCommand({
      id: 'open-wuji-ledger',
      name: '打开资产台账',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'open-wuji-ledger-widget',
      name: '资产台账：打开随身看板',
      callback: () => this.activateWidgetView(),
    });

    this.addCommand({
      id: 'update-wuji-ledger-widget-summary',
      name: '资产台账：更新并打开手机摘要',
      callback: () => this.updateMobileSummary(true),
    });

    const openWidgetFromProtocol = (): void => {
      void this.activateWidgetView().catch((error) => {
        console.error('物迹账本 protocol link could not open its pocket dashboard', error);
      });
    };
    this.registerObsidianProtocolHandler('wuji-ledger-widget', openWidgetFromProtocol);
    // Keep existing mobile shortcuts functional after upgrading from the former private build.
    this.registerObsidianProtocolHandler('celtis-asset-widget', openWidgetFromProtocol);

    this.addCommand({
      id: 'add-wuji-ledger-item',
      name: '资产台账：添加物品',
      callback: () => this.openCreateModal('item'),
    });

    this.addCommand({
      id: 'add-wuji-ledger-accessory',
      name: '资产台账：添加配件',
      callback: () => this.openCreateModal('accessory'),
    });

    this.addCommand({
      id: 'show-wuji-ledger-onboarding',
      name: '资产台账：查看使用指引',
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view instanceof AssetLedgerView) {
          leaf.view.startOnboarding();
        }
      },
    });
  }

  override onunload(): void {
    for (const registration of [...this.bloubAvatars]) {
      registration.controller.dispose();
    }
    this.bloubAvatars.clear();
    this.bloubSlots.clear();
    for (const dispose of [...this.coverSessions]) {
      dispose();
    }
    this.coverSessions.clear();
  }

  registerCoverSession(dispose: () => void): () => void {
    this.coverSessions.add(dispose);
    return () => this.coverSessions.delete(dispose);
  }

  createBloubController(
    slot: string,
    options: {
      tone?: BloubTone;
      shape?: BloubShape;
      decorative?: boolean;
      label?: string;
    } = {},
  ): BloubAvatarController {
    const state = this.getBloubSlotState(slot);
    const controller = createBloubAvatar({
      seed: state.seed,
      epochMs: state.epochMs,
      ...options,
    });
    this.bloubAvatars.add({ slot, controller });
    return controller;
  }

  releaseBloubController(controller: BloubAvatarController): void {
    for (const registration of this.bloubAvatars) {
      if (registration.controller === controller) {
        this.bloubAvatars.delete(registration);
        break;
      }
    }
    controller.dispose();
  }

  rerollBloub(slot: string): void {
    const previousExpression = [...this.bloubAvatars]
      .find((registration) => registration.slot === slot)
      ?.controller.variant.expressionId;
    const randomSeed = createBloubSeed();
    const state = {
      seed: previousExpression
        ? resolveDistinctBloubSeed(randomSeed, previousExpression)
        : randomSeed,
      epochMs: Date.now(),
    };
    this.bloubSlots.set(slot, state);
    for (const registration of this.bloubAvatars) {
      if (registration.slot === slot) {
        registration.controller.reroll(state.seed, state.epochMs);
      }
    }
  }

  private getBloubSlotState(slot: string): BloubSlotState {
    const current = this.bloubSlots.get(slot);
    if (current) {
      return current;
    }
    const seed = createBloubSeed();
    // Stagger the autonomous cycles so the five visible avatars do not all
    // change expression at once. Every view using the same slot stays in sync.
    const state = {
      seed,
      epochMs: Date.now() - (seed % 9000),
    };
    this.bloubSlots.set(slot, state);
    return state;
  }

  get colorTheme(): LedgerColorTheme {
    return this.appliedColorTheme ?? this.data.preferences.colorTheme;
  }

  applyColorTheme(element: HTMLElement): void {
    applyLedgerColorTheme(element, this.colorTheme);
  }

  async selectColorTheme(theme: LedgerColorTheme): Promise<void> {
    const selectionVersion = ++this.colorThemeSelectionVersion;
    this.appliedColorTheme = theme;
    this.applyColorThemeToOpenRoots(theme);
    try {
      await this.updatePreferences({ colorTheme: theme }, false);
      if (selectionVersion === this.colorThemeSelectionVersion) {
        this.appliedColorTheme = this.data.preferences.colorTheme;
        this.applyColorThemeToOpenRoots(this.colorTheme);
      }
    } catch (error) {
      if (selectionVersion === this.colorThemeSelectionVersion) {
        this.appliedColorTheme = this.data.preferences.colorTheme;
        this.applyColorThemeToOpenRoots(this.colorTheme);
      }
      throw error;
    }
  }

  private applyColorThemeToOpenRoots(theme: LedgerColorTheme): void {
    const option = getLedgerColorThemeOption(theme);
    const documents = new Set<Document>([
      this.app.workspace.containerEl.ownerDocument,
    ]);
    try {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof AssetLedgerView) {
          documents.add(leaf.view.contentEl.ownerDocument);
        }
      }
    } catch (error) {
      console.error('物迹账本 could not enumerate themed view windows', error);
    }

    for (const doc of documents) {
      for (const root of doc.querySelectorAll<HTMLElement>(
        '.celtis-asset-ledger-root:not(.celtis-ledger-widget-root)',
      )) {
        applyLedgerColorTheme(root, theme);
        for (const trigger of root.querySelectorAll<HTMLElement>(
          '.celtis-ledger-theme-trigger',
        )) {
          trigger.setAttr('aria-label', `切换台账主题，当前为${option.label}`);
          trigger.setAttr('title', `当前主题：${option.label}`);
          trigger.querySelector<HTMLElement>('.celtis-ledger-theme-name')?.setText(option.label);
          const palette = trigger.querySelector<HTMLElement>(
            '.celtis-ledger-theme-current-palette',
          );
          if (palette) {
            palette.dataset.theme = theme;
          }
        }
      }
    }
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0 && existing[0]) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async activateWidgetView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(WIDGET_VIEW_TYPE);
    if (existing.length > 0 && existing[0]) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: WIDGET_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async activateRecord(recordId: string): Promise<void> {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf?.view instanceof AssetLedgerView) {
      leaf.view.showRecord(recordId);
    }
  }

  async updateMobileSummary(openAfter = true): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(MOBILE_SUMMARY_PATH);
    if (existing && !(existing instanceof TFile)) {
      const message = `无法创建 ${MOBILE_SUMMARY_PATH}：同名文件夹已存在。`;
      new Notice(message);
      throw new Error(message);
    }

    let file = existing;
    const content = this.buildMobileSummaryMarkdown();
    if (file instanceof TFile) {
      const previous = await this.app.vault.cachedRead(file);
      if (!isManagedMobileSummary(previous)) {
        const message = `${MOBILE_SUMMARY_PATH} 不是插件维护的文件，已停止覆盖。`;
        new Notice(message);
        throw new Error(message);
      }
      await this.app.vault.modify(file, content);
    } else {
      const folder = this.app.vault.getAbstractFileByPath(MOBILE_SUMMARY_FOLDER);
      if (folder instanceof TFile) {
        const message = `无法创建手机摘要：${MOBILE_SUMMARY_FOLDER} 已被同名文件占用。`;
        new Notice(message);
        throw new Error(message);
      }
      if (!folder) {
        await this.app.vault.createFolder(MOBILE_SUMMARY_FOLDER);
      }
      file = await this.app.vault.create(MOBILE_SUMMARY_PATH, content);
    }

    if (openAfter) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
      await this.app.workspace.revealLeaf(leaf);
      new Notice('手机摘要已更新，可在 iOS 的 Obsidian“查看笔记”小组件中选择它。');
    }
  }

  openCreateModal(type: LedgerRecordType, options: CreateRecordOptions = {}): void {
    new RecordEditorModal(this.app, this, type, options).open();
  }

  openExistingCoverPicker(onSelect: (path: string) => void): void {
    new ExistingCoverPickerModal(this.app, this, onSelect).open();
  }

  async upsertRecord(
    record: LedgerRecord,
    options: UpsertRecordOptions = {},
  ): Promise<void> {
    let replacedManagedCover: string | undefined;
    await this.enqueueMutation((current) => {
      let nextRecord = record;
      if (options.refreshInheritedPurchaseDate && record.type === 'accessory') {
        nextRecord = {
          ...record,
          purchaseDate: resolvePurchaseDateForSave(
            'create',
            { ...record, purchaseDate: undefined },
            current.records,
          ),
        };
      }

      if (options.requireActiveLinkedItem && nextRecord.type === 'accessory' && nextRecord.linkedItemId) {
        const linkedItem = current.records.find(
          (candidate) => candidate.id === nextRecord.linkedItemId
            && candidate.type === 'item'
            && !isArchived(candidate),
        );
        if (!linkedItem) {
          const message = '联动物品已发生变化，请重新打开表单后再选择';
          new Notice(message);
          throw new Error(message);
        }
      }

      const index = current.records.findIndex((candidate) => candidate.id === nextRecord.id);
      const records = [...current.records];

      if (index >= 0) {
        const previousCover = records[index]?.cover;
        replacedManagedCover = previousCover !== nextRecord.cover
          && isManagedCoverAssetPath(previousCover)
          ? previousCover
          : undefined;
        records[index] = nextRecord;
      } else {
        records.push(nextRecord);
      }

      assertValidProspectiveDates(nextRecord, records);

      return { ...current, records };
    }, async () => {
      try {
        options.onPersisted?.();
      } finally {
        if (
          replacedManagedCover
          && !this.data.records.some((candidate) => candidate.cover === replacedManagedCover)
        ) {
          await this.discardManagedCoverAsset(replacedManagedCover);
        }
      }
    }, false);
    if (options.refresh ?? true) {
      this.refreshDataViews();
    }
  }

  async patchRecord(
    recordId: string,
    patch: (current: LedgerRecord) => LedgerRecord,
    refresh = true,
  ): Promise<void> {
    await this.enqueueMutation((current) => {
      const index = current.records.findIndex((candidate) => candidate.id === recordId);
      if (index < 0) {
        const message = '记录已发生变化，请刷新资产台账后重试';
        new Notice(message);
        throw new Error(message);
      }

      const records = [...current.records];
      const nextRecord = patch(records[index]!);
      records[index] = { ...nextRecord, id: recordId };
      assertValidProspectiveDates(records[index], records);
      return { ...current, records };
    }, undefined, false);
    if (refresh) {
      this.refreshDataViews();
    }
  }

  async updatePreferences(
    preferences: Partial<LedgerPreferences>,
    refresh = false,
  ): Promise<void> {
    await this.enqueueMutation((current) => ({
      ...current,
      preferences: { ...current.preferences, ...preferences },
    }), undefined, refresh);
  }

  async updateTitle(title: string): Promise<void> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      new Notice('台账名称不能为空');
      throw new Error('Ledger title cannot be empty');
    }
    await this.enqueueMutation((current) => ({
      ...current,
      title: normalizedTitle,
    }));
  }

  getAssetUrl(path: string): string {
    if (/^(https?:|app:|data:|blob:)/i.test(path)) {
      return path;
    }

    const pluginDirectory = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const normalized = normalizePath(path);
    const vaultFile = this.app.vault.getAbstractFileByPath(normalized);
    const vaultPath = vaultFile instanceof TFile
      ? normalized
      : path.startsWith('assets/')
        ? `${pluginDirectory}/${path}`
        : path.includes('/')
          ? path
          : `${pluginDirectory}/assets/${path}`;
    return this.app.vault.adapter.getResourcePath(vaultPath);
  }

  async copyRecordCover(record: LedgerRecord): Promise<void> {
    const cover = record.cover?.trim();
    if (!cover) {
      throw new Error('这条记录还没有可复制的图片');
    }
    const source = await this.readCoverImageBlob(cover);
    if (!source) {
      throw new Error('图片读取失败，请检查原图是否仍然存在');
    }
    await copyPngBlob(await imageBlobToPng(source));
    new Notice(`${record.name} 的图片已复制`);
  }

  async createRecordSharePoster(recordId: string): Promise<SharePoster> {
    const record = this.data.records.find((candidate) => candidate.id === recordId);
    if (!record) {
      throw new Error('这条记录已不存在');
    }
    const now = todayInShanghai();
    const model = buildRecordShareModel(record, this.data.records, now);
    const blob = await renderRecordSharePoster(
      model,
      this.colorTheme,
      (cover) => this.readCoverImageBlob(cover),
    );
    return {
      blob,
      title: `${record.name} · ${this.data.title}`,
      fileName: `${record.name}-物迹卡片.png`,
    };
  }

  async createLedgerSharePoster(scope: LedgerShareScope = 'all'): Promise<SharePoster> {
    const now = todayInShanghai();
    const model = buildLedgerShareModel(this.data.title, this.data.records, now, scope);
    const blob = await renderLedgerSharePoster(
      model,
      this.colorTheme,
      (cover) => this.readCoverImageBlob(cover),
    );
    const scopeLabel = scope === 'all' ? '台账全览' : getLedgerShareScopeLabel(scope);
    return {
      blob,
      title: `${this.data.title} · ${scopeLabel}`,
      fileName: `${this.data.title}-${scopeLabel}.png`,
    };
  }

  private async readCoverImageBlob(path: string): Promise<Blob | undefined> {
    const source = path.trim();
    if (!source) {
      return undefined;
    }
    try {
      let buffer: ArrayBuffer;
      if (/^https?:/i.test(source)) {
        buffer = (await requestUrl({ url: source })).arrayBuffer;
      } else if (/^(?:data:|blob:|app:)/i.test(source)) {
        // Local browser resources cannot be read by requestUrl's HTTP transport.
        const response = await window.fetch(source);
        if (!response.ok) {
          throw new Error(`图片读取失败：${response.status}`);
        }
        buffer = await response.arrayBuffer();
      } else {
        const pluginDirectory = normalizePath(
          this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
        );
        const normalized = normalizePath(source);
        const vaultFile = this.app.vault.getAbstractFileByPath(normalized);
        const vaultPath = vaultFile instanceof TFile
          ? normalized
          : source.startsWith('assets/')
            ? normalizePath(`${pluginDirectory}/${source}`)
            : source.includes('/')
              ? normalized
              : normalizePath(`${pluginDirectory}/assets/${source}`);
        buffer = await this.app.vault.adapter.readBinary(vaultPath);
      }
      const kind = getCoverImageKindFromSignature(buffer);
      return kind ? new Blob([buffer], { type: kind.mimeType }) : undefined;
    } catch (error) {
      console.error(`物迹账本 could not read cover image "${source}"`, error);
      return undefined;
    }
  }

  async importCoverImage(file: File): Promise<string> {
    if (file.size <= 0) {
      throw new Error('选择的图片为空，请换一张图片重试。');
    }
    if (file.size > MAX_COVER_IMAGE_BYTES) {
      throw new Error('图片超过 100 MB，请先缩小后再导入。');
    }

    const buffer = await file.arrayBuffer();
    const kind = getCoverImageKindFromSignature(buffer);
    if (!kind) {
      throw new Error(SUPPORTED_COVER_IMAGE_MESSAGE);
    }

    const pluginDirectory = normalizePath(
      this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
    );
    const userAssets = normalizePath(`${pluginDirectory}/assets/user`);
    await ensureAdapterDirectory(this.app.vault.adapter, userAssets);
    const token = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    const stem = sanitizeCoverFileStem(file.name) || 'pasted-image';
    const fileName = `${stem}-${Date.now()}-${token}-cover.${kind.extension}`;
    const vaultPath = normalizePath(`${userAssets}/${fileName}`);

    let completed = false;
    try {
      await this.app.vault.adapter.writeBinary(vaultPath, buffer);
      const stat = await this.app.vault.adapter.stat(vaultPath);
      if (!stat || stat.type !== 'file' || stat.size !== buffer.byteLength) {
        throw new Error('保存本地封面失败，请检查 iCloud 或存储空间后重试。');
      }
      completed = true;
      return `assets/user/${fileName}`;
    } finally {
      if (!completed && await this.app.vault.adapter.exists(vaultPath)) {
        await this.app.vault.adapter.remove(vaultPath).catch(() => undefined);
      }
    }
  }

  async discardManagedCoverAsset(path: string): Promise<void> {
    if (
      !isManagedCoverAssetPath(path)
      || this.data.records.some((candidate) => candidate.cover?.trim() === path.trim())
    ) {
      return;
    }
    const pluginDirectory = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const vaultPath = normalizePath(`${pluginDirectory}/${path.trim()}`);
    if (await this.app.vault.adapter.exists(vaultPath)) {
      await this.app.vault.adapter.remove(vaultPath);
    }
  }

  async discardGeneratedSticker(path: string): Promise<void> {
    await this.discardManagedCoverAsset(path);
  }

  private buildMobileSummaryMarkdown(): string {
    const model = getMobileWidgetModel(this.data.records, todayInShanghai());
    const lines = [
      '---',
      'wuji_ledger_managed: true',
      'cssclasses:',
      '  - wuji-ledger-summary-note',
      '---',
      MOBILE_SUMMARY_MARKER,
      '',
      `# ${this.data.title} · 随身摘要`,
      '',
      `> 更新于 ${formatDate(todayInShanghai())}。本页由 物迹账本 在 Obsidian 打开时维护。`,
      '',
    ];

    if (model.isEmpty) {
      lines.push(
        '还没有资产记录。打开随身看板后，可从“添加物品”开始。',
        '',
        '[打开资产随身看板](obsidian://wuji-ledger-widget)',
        '',
      );
      return lines.join('\n');
    }

    lines.push(
      `- **每日成本**：${formatNumber(model.summary.activeDaily)} 元/天`,
      `- **正在使用**：${model.summary.activeItems} 件 · ${formatMoney(model.summary.activeValue)}`,
      `- **归档/卖出**：${model.summary.archivedItems} 件 · ${formatMoney(model.summary.archivedValue)}`,
    );

    if (model.highestDailyCost) {
      lines.push(
        `- **日成本最高**：${model.highestDailyCost.name} · ${formatNumber(model.highestDailyCost.daily)} 元/天`,
      );
    }
    if (model.recentPurchase) {
      lines.push(
        `- **最近购买**：${model.recentPurchase.name} · ${formatDate(model.recentPurchase.purchaseDate!)}`,
      );
    }

    lines.push('', '[打开资产随身看板](obsidian://wuji-ledger-widget)', '');
    return lines.join('\n');
  }

  private async migrateLegacyMobileSummary(): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(MOBILE_SUMMARY_PATH)) {
      return;
    }
    const legacy = this.app.vault.getAbstractFileByPath(LEGACY_MOBILE_SUMMARY_PATH);
    if (!(legacy instanceof TFile)) {
      return;
    }
    try {
      const previous = await this.app.vault.cachedRead(legacy);
      if (!isManagedMobileSummary(previous)) {
        return;
      }
      const folder = this.app.vault.getAbstractFileByPath(MOBILE_SUMMARY_FOLDER);
      if (folder instanceof TFile) {
        return;
      }
      if (!folder) {
        await this.app.vault.createFolder(MOBILE_SUMMARY_FOLDER);
      }
      await this.app.vault.rename(legacy, MOBILE_SUMMARY_PATH);
    } catch (error) {
      console.error('物迹账本 could not migrate its legacy mobile summary', error);
    }
  }

  private async refreshManagedMobileSummary(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(MOBILE_SUMMARY_PATH);
    if (!(file instanceof TFile)) {
      return;
    }
    try {
      const previous = await this.app.vault.cachedRead(file);
      if (isManagedMobileSummary(previous)) {
        await this.app.vault.modify(file, this.buildMobileSummaryMarkdown());
      }
    } catch (error) {
      console.error('物迹账本 could not refresh its mobile summary', error);
    }
  }

  private createDataSnapshot(data: StoredLedgerData): StoredLedgerData {
    return JSON.parse(JSON.stringify(data)) as StoredLedgerData;
  }

  private getDataBackupPath(): string {
    const pluginDirectory = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return normalizePath(`${pluginDirectory}/${DATA_BACKUP_FILENAME}`);
  }

  private async loadDataBackup(): Promise<unknown> {
    const path = this.getDataBackupPath();
    try {
      if (!await this.app.vault.adapter.exists(path)) {
        return undefined;
      }
      return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
    } catch (error) {
      console.error('物迹账本 could not read its data backup', error);
      return undefined;
    }
  }

  private async saveDataBackup(data: StoredLedgerData): Promise<void> {
    try {
      await this.app.vault.adapter.write(
        this.getDataBackupPath(),
        JSON.stringify(this.createDataSnapshot(data), null, 2),
      );
    } catch (error) {
      console.error('物迹账本 could not update its data backup', error);
    }
  }

  private enqueueMutation(
    update: (current: StoredLedgerData) => StoredLedgerData,
    onPersisted?: () => void | Promise<void>,
    refresh = true,
  ): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const nextData = update(this.data);
      const snapshot = this.createDataSnapshot(nextData);
      try {
        await this.saveData(snapshot);
      } catch (error) {
        console.error('物迹账本 could not save data', error);
        new Notice('资产台账保存失败，旧数据仍保留。请检查 iCloud 或磁盘状态。');
        throw error;
      }

      this.data = nextData;
      await this.saveDataBackup(snapshot);
      try {
        await onPersisted?.();
      } catch (error) {
        console.error('物迹账本 post-save cleanup failed', error);
      }
      if (refresh) {
        this.refreshViews();
      }
      await this.refreshManagedMobileSummary();
    });

    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  refreshViews(): void {
    let ledgerLeaves: WorkspaceLeaf[];
    let widgetLeaves: WorkspaceLeaf[];
    try {
      ledgerLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
      widgetLeaves = this.app.workspace.getLeavesOfType(WIDGET_VIEW_TYPE);
    } catch (error) {
      console.error('物迹账本 could not enumerate its views', error);
      return;
    }

    for (const leaf of ledgerLeaves) {
      if (leaf.view instanceof AssetLedgerView) {
        try {
          leaf.view.render();
        } catch (error) {
          console.error('物迹账本 could not refresh a view', error);
        }
      }
    }
    for (const leaf of widgetLeaves) {
      if (leaf.view instanceof AssetWidgetView) {
        try {
          leaf.view.render();
        } catch (error) {
          console.error('物迹账本 could not refresh its pocket dashboard', error);
        }
      }
    }
  }

  refreshDataViews(): void {
    let ledgerLeaves: WorkspaceLeaf[];
    let widgetLeaves: WorkspaceLeaf[];
    try {
      ledgerLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
      widgetLeaves = this.app.workspace.getLeavesOfType(WIDGET_VIEW_TYPE);
    } catch (error) {
      console.error('物迹账本 could not enumerate its data views', error);
      return;
    }

    for (const leaf of ledgerLeaves) {
      if (leaf.view instanceof AssetLedgerView) {
        try {
          leaf.view.refreshData();
        } catch (error) {
          console.error('物迹账本 could not refresh ledger data', error);
        }
      }
    }
    for (const leaf of widgetLeaves) {
      if (leaf.view instanceof AssetWidgetView) {
        try {
          leaf.view.render();
        } catch (error) {
          console.error('物迹账本 could not refresh its pocket dashboard data', error);
        }
      }
    }
  }
}

class AssetLedgerView extends ItemView {
  private query = '';
  private statusFilter: StatusFilter = 'all';
  private viewMode: ViewMode;
  private sortMode: SortMode;
  private stickerFilter: StickerCollectionFilter = 'all';
  private selectedRecordId?: string;
  private searchTimer?: number;
  private drawerOverlay?: HTMLElement;
  private drawerOpener?: HTMLElement;
  private drawerCloseTimer?: number;
  private activeMenu?: Menu;
  private onboardingFrame?: number;
  private onboardingDispose?: () => void;
  private viewTabsEl?: HTMLElement;
  private galleryPanelEl?: HTMLElement;
  private tablePanelEl?: HTMLElement;
  private accessorySectionEl?: HTMLElement;
  private activeItemCountEl?: HTMLElement;
  private shellEl?: HTMLElement;
  private layoutEl?: HTMLElement;
  private galleryItemCount = 0;
  private tableItemCount = 0;
  private archiveDrop?: ArchiveDropController;
  private imageDrop?: ImageDropController;
  private readonly bloubControllers = new Map<string, BloubAvatarController>();
  private readonly bloubControllerOptions = new Map<string, string>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WujiLedgerPlugin) {
    super(leaf);
    this.viewMode = plugin.data.preferences.viewMode;
    this.sortMode = plugin.data.preferences.sortMode;
  }

  override getViewType(): string {
    return VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.plugin.data.title;
  }

  override getIcon(): string {
    return 'package-open';
  }

  override async onOpen(): Promise<void> {
    this.archiveDrop = new ArchiveDropController(this.contentEl, {
      getRecord: (id) => this.plugin.data.records.find((record) => record.id === id),
      decorate: (layer) => this.plugin.applyColorTheme(layer),
      renderArtwork: (host, record) => {
        this.renderRecordThumbnail(host, record.cover, record.type === 'item' ? 'package' : 'wrench');
      },
      onDrop: (id) => this.openQuickArchive(id),
    });
    this.imageDrop = new ImageDropController(this.contentEl, {
      enabled: () => !this.drawerOverlay && !this.contentEl.ownerDocument.querySelector('.modal-container'),
      decorate: (layer) => this.plugin.applyColorTheme(layer),
      renderIcon: (host) => setIcon(host, 'image-plus'),
      onDrop: (droppedImage) => this.plugin.openCreateModal('item', { droppedImage }),
      notify: (message) => { new Notice(message); },
    });
    this.render();
  }

  override async onClose(): Promise<void> {
    this.archiveDrop?.dispose();
    this.archiveDrop = undefined;
    this.imageDrop?.dispose();
    this.imageDrop = undefined;
    if (this.searchTimer != null) {
      window.clearTimeout(this.searchTimer);
    }
    if (this.drawerCloseTimer != null) {
      window.clearTimeout(this.drawerCloseTimer);
    }
    if (this.onboardingFrame != null) {
      window.cancelAnimationFrame(this.onboardingFrame);
      this.onboardingFrame = undefined;
    }
    this.onboardingDispose?.();
    this.onboardingDispose = undefined;
    this.activeMenu?.hide();
    this.activeMenu = undefined;
    this.disposeBloubControllers();
    disposeRecordForms(this.contentEl);
    disposeDateControls(this.contentEl);
  }

  render(): void {
    const root = this.contentEl;
    this.archiveDrop?.cancel();
    this.imageDrop?.cancel();
    if (this.onboardingFrame != null) {
      window.cancelAnimationFrame(this.onboardingFrame);
      this.onboardingFrame = undefined;
    }
    this.onboardingDispose?.();
    this.onboardingDispose = undefined;
    this.activeMenu?.hide();
    this.activeMenu = undefined;
    disposeRecordForms(root);
    disposeDateControls(root);
    if (this.drawerCloseTimer != null) {
      window.clearTimeout(this.drawerCloseTimer);
      this.drawerCloseTimer = undefined;
    }
    this.drawerOverlay = undefined;
    this.viewTabsEl = undefined;
    this.galleryPanelEl = undefined;
    this.tablePanelEl = undefined;
    this.accessorySectionEl = undefined;
    this.activeItemCountEl = undefined;
    this.shellEl = undefined;
    this.layoutEl = undefined;
    root.empty();
    root.addClass('celtis-asset-ledger-root');
    this.plugin.applyColorTheme(root);
    root.appendChild(root.ownerDocument.createComment(DIRECTION_CONTRACT));

    const shell = root.createDiv({ cls: 'celtis-ledger-shell' });
    this.shellEl = shell;
    const records = this.plugin.data.records;

    this.renderHeader(shell, records.length);
    this.renderToolbar(shell);
    this.renderDataLayout(shell);

    if (shouldShowLedgerOnboarding(
      records.length,
      this.plugin.data.preferences.onboardingCompleted,
    )) {
      this.queueOnboarding();
    }
  }

  refreshData(): void {
    const shell = this.shellEl?.isConnected
      ? this.shellEl
      : this.contentEl.querySelector<HTMLElement>('.celtis-ledger-shell');
    const previousLayout = this.layoutEl?.isConnected
      ? this.layoutEl
      : shell?.querySelector<HTMLElement>('.celtis-ledger-layout');
    if (!shell || !previousLayout) {
      this.render();
      return;
    }

    const records = this.plugin.data.records;
    this.updateRecordCount(records.length);
    this.renderDataLayout(shell, previousLayout);
  }

  private updateRecordCount(recordCount: number): void {
    this.contentEl.querySelector<HTMLElement>('.celtis-ledger-subtitle')
      ?.setText(`本地资产台账 · ${recordCount} 条记录`);
  }

  private renderDataLayout(shell: HTMLElement, previousLayout?: HTMLElement): void {
    this.archiveDrop?.cancel();
    this.imageDrop?.cancel();
    if (previousLayout) {
      disposeRecordForms(previousLayout);
      disposeDateControls(previousLayout);
    }
    this.viewTabsEl = undefined;
    this.galleryPanelEl = undefined;
    this.tablePanelEl = undefined;
    this.accessorySectionEl = undefined;
    this.activeItemCountEl = undefined;
    this.galleryItemCount = 0;
    this.tableItemCount = 0;

    const records = this.plugin.data.records;
    const now = todayInShanghai();
    const summary = getLedgerSummary(records, now);
    const layout = shell.ownerDocument.createElement('div');
    layout.className = 'celtis-ledger-layout';
    if (previousLayout) {
      previousLayout.replaceWith(layout);
    } else {
      shell.appendChild(layout);
    }
    this.layoutEl = layout;

    this.renderSidebar(layout, summary, records, now);

    const main = layout.createEl('main', { cls: 'celtis-ledger-main' });
    if (this.statusFilter !== 'archived') {
      this.renderActiveItems(main, records, now);
      this.renderAccessoryBoard(main, records, now);
      this.syncViewModeUi();
    }
    if (this.statusFilter !== 'active') {
      this.renderArchive(main, records, now);
    }
    this.renderStickerCollection(main, records, now);

    if (!previousLayout && this.selectedRecordId) {
      const selected = records.find((record) => record.id === this.selectedRecordId);
      if (selected) {
        this.renderDrawer(this.contentEl, selected, now);
      } else {
        this.selectedRecordId = undefined;
      }
    }
  }

  private attachBloub(
    host: HTMLElement,
    slot: string,
    options: {
      tone?: BloubTone;
      shape?: BloubShape;
      decorative?: boolean;
      label?: string;
    } = {},
  ): BloubAvatarController {
    let controller = this.bloubControllers.get(slot);
    const optionKey = JSON.stringify(options);
    if (controller && this.bloubControllerOptions.get(slot) !== optionKey) {
      this.plugin.releaseBloubController(controller);
      this.bloubControllers.delete(slot);
      controller = undefined;
    }
    if (!controller) {
      controller = this.plugin.createBloubController(slot, options);
      this.bloubControllers.set(slot, controller);
      this.bloubControllerOptions.set(slot, optionKey);
    }
    controller.attach(host);
    return controller;
  }

  private disposeBloubControllers(): void {
    for (const controller of this.bloubControllers.values()) {
      this.plugin.releaseBloubController(controller);
    }
    this.bloubControllers.clear();
    this.bloubControllerOptions.clear();
  }

  private renderHeader(root: HTMLElement, recordCount: number): void {
    const header = root.createEl('header', { cls: 'celtis-ledger-header' });
    const brand = header.createDiv({ cls: 'celtis-ledger-brand' });
    const iconControl = brand.createDiv({ cls: 'celtis-ledger-page-icon-control' });
    const selectedShape = this.plugin.data.preferences.pageAvatarShape;
    const selectedShapeLabel = BLOUB_SHAPE_OPTIONS.find(
      (option) => option.id === selectedShape,
    )?.label ?? '圆形';
    const selectedTone = this.plugin.data.preferences.pageAvatarTone;
    const selectedToneLabel = BLOUB_TONE_OPTIONS.find(
      (option) => option.id === selectedTone,
    )?.label ?? '墨黑';
    const iconButton = iconControl.createEl('button', {
      cls: 'celtis-ledger-page-icon',
      attr: {
        type: 'button',
        'aria-label': `${selectedShapeLabel}、${selectedToneLabel} Bloub 表情，点击换一个表情和动作`,
        title: '点击换一个表情和动作',
      },
    });
    iconButton.dataset.bloubInteractive = 'true';
    const avatar = iconButton.createSpan({
      cls: 'celtis-ledger-page-icon-avatar',
    });
    this.attachBloub(avatar, 'ledger-brand', {
      tone: selectedTone,
      shape: selectedShape,
      label: `随机动态 Bloub 表情（${selectedToneLabel}）`,
    });
    iconButton.addEventListener('click', () => this.plugin.rerollBloub('ledger-brand'));

    const shapeButton = iconControl.createEl('button', {
      cls: 'celtis-ledger-shape-trigger',
      attr: {
        type: 'button',
        'aria-label': `定制头像形状和颜色，当前为${selectedShapeLabel}、${selectedToneLabel}`,
        'aria-haspopup': 'dialog',
        title: '定制头像形状和颜色',
      },
    });
    setIcon(shapeButton, 'shapes');
    shapeButton.addEventListener('click', () => {
      new BloubShapePickerModal(this.app, this.plugin).open();
    });

    const copy = brand.createDiv();
    const titleHost = copy.createDiv({ cls: 'celtis-ledger-title-editor' });
    const titleButton = titleHost.createEl('button', {
      cls: 'celtis-ledger-title-button',
      attr: {
        type: 'button',
        'aria-label': `修改台账名称，当前为${this.plugin.data.title}`,
        title: '点击修改名称',
      },
    });
    titleButton.createEl('h1', {
      cls: 'celtis-ledger-title',
      text: this.plugin.data.title,
    });
    setIcon(titleButton.createSpan({ cls: 'celtis-ledger-title-edit-icon' }), 'pencil-line');
    titleButton.addEventListener('click', () => {
      titleButton.hidden = true;
      const input = titleHost.createEl('input', {
        cls: 'celtis-ledger-title-input',
        attr: {
          type: 'text',
          maxlength: '80',
          value: this.plugin.data.title,
          'aria-label': '台账名称',
        },
      });
      let finished = false;
      const finish = async (save: boolean): Promise<void> => {
        if (finished) {
          return;
        }
        finished = true;
        const nextTitle = input.value.trim();
        if (!save || !nextTitle || nextTitle === this.plugin.data.title) {
          if (save && !nextTitle) {
            new Notice('台账名称不能为空');
          }
          input.remove();
          titleButton.hidden = false;
          titleButton.focus({ preventScroll: true });
          return;
        }

        input.disabled = true;
        try {
          await this.plugin.updateTitle(nextTitle);
          new Notice('台账名称已更新');
        } catch {
          finished = false;
          input.disabled = false;
          input.focus({ preventScroll: true });
          input.select();
        }
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          void finish(false);
        }
      });
      input.addEventListener('blur', () => void finish(true));
      input.focus({ preventScroll: true });
      input.select();
    });
    copy.createEl('p', {
      cls: 'celtis-ledger-subtitle',
      text: `本地资产台账 · ${recordCount} 条记录`,
    });

    const status = header.createDiv({ cls: 'celtis-ledger-header-status' });
    this.renderColorThemeControl(status);
    const shareAll = createActionButton(status, 'share-2', '分享全部', () => {
      new ShareImageModal(this.app, this.plugin, { kind: 'ledger' }).open();
    });
    shareAll.addClass('celtis-ledger-share-entry');
    shareAll.disabled = recordCount === 0;
    shareAll.setAttr(
      'aria-label',
      recordCount === 0 ? '暂无记录可分享' : '生成并分享整本台账图片',
    );
    const pocket = status.createEl('button', {
      cls: 'celtis-ledger-guide-entry is-pocket-entry',
      attr: {
        type: 'button',
        'aria-label': '打开适合手机查看的资产随身看板',
        title: '打开随身看板',
      },
    });
    setIcon(pocket.createSpan(), 'layout-dashboard');
    pocket.createSpan({ text: '随身看板' });
    pocket.addEventListener('click', () => {
      void this.plugin.activateWidgetView().catch((error) => {
        console.error('物迹账本 could not open its pocket dashboard', error);
      });
    });
    if (recordCount === 0) {
      const guide = status.createEl('button', {
        cls: 'celtis-ledger-guide-entry',
        attr: {
          type: 'button',
          'aria-label': '查看资产台账使用指引',
          title: '查看使用指引',
        },
      });
      setIcon(guide.createSpan(), 'circle-help');
      guide.createSpan({ text: '使用指引' });
      guide.addEventListener('click', () => this.startOnboarding());
    }
    const localBadge = status.createSpan({ cls: 'celtis-ledger-badge', text: '仅存本地' });
    localBadge.setAttr('title', '数据保存在此 Obsidian vault 的插件目录中');
  }

  private renderColorThemeControl(root: HTMLElement): void {
    const host = root.createDiv({ cls: 'celtis-ledger-theme-control' });
    const trigger = host.createEl('button', {
      cls: 'celtis-ledger-theme-trigger',
      attr: {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
      },
    });
    setIcon(trigger.createSpan({ cls: 'celtis-ledger-theme-icon' }), 'palette');
    trigger.createSpan({ cls: 'celtis-ledger-theme-name' });
    trigger.createSpan({ cls: 'celtis-ledger-theme-current-palette' });
    setIcon(trigger.createSpan({ cls: 'celtis-ledger-theme-chevron' }), 'chevron-down');

    const paintTrigger = (theme: LedgerColorTheme): void => {
      const option = getLedgerColorThemeOption(theme);
      trigger.setAttr('aria-label', `切换台账主题，当前为${option.label}`);
      trigger.setAttr('title', `当前主题：${option.label}`);
      trigger.querySelector<HTMLElement>('.celtis-ledger-theme-name')?.setText(option.label);
      const palette = trigger.querySelector<HTMLElement>(
        '.celtis-ledger-theme-current-palette',
      );
      if (palette) {
        this.renderThemePalette(palette, theme);
      }
    };
    paintTrigger(this.plugin.colorTheme);

    trigger.addEventListener('click', () => {
      if (this.activeMenu && host.hasClass('is-open')) {
        this.activeMenu.hide();
        return;
      }

      this.activeMenu?.hide();
      const currentTheme = this.plugin.colorTheme;
      const menu = new Menu()
        .setUseNativeMenu(false)
        .setParentElement(host);
      for (const option of LEDGER_COLOR_THEME_OPTIONS) {
        menu.addItem((item) => item
          .setTitle(this.createThemeMenuTitle(trigger.ownerDocument, option))
          .setChecked(option.id === currentTheme)
          .onClick(() => {
            paintTrigger(option.id);
            void this.plugin.selectColorTheme(option.id).catch((error) => {
              console.error('物迹账本 could not save its color theme', error);
              paintTrigger(this.plugin.colorTheme);
              new Notice('主题保存失败，已恢复原来的配色。');
            });
          }));
      }

      this.activeMenu = menu;
      host.addClass('is-open');
      trigger.setAttr('aria-expanded', 'true');
      menu.onHide(() => {
        host.removeClass('is-open');
        trigger.setAttr('aria-expanded', 'false');
        if (this.activeMenu === menu) {
          this.activeMenu = undefined;
        }
      });

      const rect = trigger.getBoundingClientRect();
      menu.showAtPosition({
        x: rect.left,
        y: rect.bottom + 5,
        width: rect.width,
        overlap: true,
        left: false,
      }, trigger.ownerDocument);
    });
  }

  private createThemeMenuTitle(
    doc: Document,
    option: (typeof LEDGER_COLOR_THEME_OPTIONS)[number],
  ): DocumentFragment {
    const fragment = doc.createDocumentFragment();
    const palette = doc.createElement('span');
    palette.className = 'celtis-ledger-theme-menu-palette';
    this.renderThemePalette(palette, option.id);
    fragment.appendChild(palette);

    const label = doc.createElement('span');
    label.className = 'celtis-ledger-theme-menu-label';
    label.textContent = option.label;
    label.setAttribute('aria-label', `${option.label}，${option.paletteLabel}`);
    label.setAttribute('title', option.description);
    fragment.appendChild(label);
    return fragment;
  }

  private renderThemePalette(root: HTMLElement, theme: LedgerColorTheme): void {
    root.empty();
    root.setAttr('aria-hidden', 'true');
    root.dataset.theme = theme;
    for (const tone of ['primary', 'secondary', 'canvas'] as const) {
      root.createSpan({ cls: `celtis-ledger-theme-swatch is-${tone}` });
    }
  }

  private renderToolbar(root: HTMLElement): void {
    const toolbar = root.createDiv({ cls: 'celtis-ledger-toolbar' });
    const searchWrap = toolbar.createDiv({ cls: 'celtis-ledger-search' });
    setIcon(searchWrap.createSpan({ cls: 'celtis-ledger-search-icon' }), 'search');
    const search = searchWrap.createEl('input', {
      attr: {
        type: 'search',
        placeholder: '搜索物品、配件或备注…',
        'aria-label': '搜索资产台账',
        value: this.query,
      },
    });

    search.addEventListener('input', () => {
      this.query = search.value;
      if (this.searchTimer != null) {
        window.clearTimeout(this.searchTimer);
      }
      this.searchTimer = window.setTimeout(() => {
        this.render();
        const next = this.contentEl.querySelector<HTMLInputElement>('.celtis-ledger-search input');
        next?.focus();
        next?.setSelectionRange(this.query.length, this.query.length);
      }, 90);
    });

    this.renderMenuControl<StatusFilter>(toolbar, '筛选状态', [
      { value: 'all', label: '全部状态', icon: 'layers-3' },
      { value: 'active', label: '正在使用', icon: 'sparkles' },
      { value: 'archived', label: '归档/卖出', icon: 'archive' },
    ], this.statusFilter, (value) => {
      this.statusFilter = value;
      this.render();
    });

    this.renderMenuControl<SortMode>(toolbar, '排序方式', [
      {
        value: 'purchase-desc',
        label: '最近购买',
        icon: 'clock-3',
        accessibleLabel: '按最近购买时间排序',
      },
      {
        value: 'value-desc',
        label: '价值从高到低',
        icon: 'arrow-down-10',
        accessibleLabel: '按总价值从高到低排序',
      },
      {
        value: 'daily-desc',
        label: '每日成本从高到低',
        icon: 'gauge',
        accessibleLabel: '按每日成本从高到低排序',
      },
      {
        value: 'name-asc',
        label: '名称升序',
        icon: 'arrow-down-az',
        accessibleLabel: '按名称升序排序',
      },
    ], this.sortMode, (value) => {
      this.sortMode = value;
      void this.plugin.updatePreferences({ sortMode: value }).catch((error) => {
        console.error('物迹账本 could not save the sort preference', error);
      });
      this.render();
    });

    createIconButton(toolbar, 'refresh-cw', '刷新计算', () => this.render());
  }

  private renderMenuControl<T extends string>(
    root: HTMLElement,
    label: string,
    options: ReadonlyArray<{
      value: T;
      label: string;
      icon: string;
      accessibleLabel?: string;
    }>,
    value: T,
    onSelect: (value: T) => void,
  ): void {
    const host = root.createDiv({ cls: 'celtis-ledger-menu-control' });
    const selected = options.find((option) => option.value === value) ?? options[0];
    if (!selected) {
      return;
    }
    const trigger = host.createEl('button', {
      cls: 'celtis-ledger-menu-trigger',
      attr: {
        type: 'button',
        'aria-label': `${label}，当前${selected.label}`,
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
      },
    });
    setIcon(trigger.createSpan({ cls: 'celtis-ledger-menu-leading' }), selected.icon);
    trigger.createSpan({ cls: 'celtis-ledger-menu-value', text: selected.label });
    setIcon(trigger.createSpan({ cls: 'celtis-ledger-menu-chevron' }), 'chevron-down');

    trigger.addEventListener('click', () => {
      if (this.activeMenu && host.hasClass('is-open')) {
        this.activeMenu.hide();
        return;
      }
      this.activeMenu?.hide();
      const menu = new Menu()
        .setUseNativeMenu(false)
        .setParentElement(host);
      for (const option of options) {
        menu.addItem((item) => {
          const title = trigger.ownerDocument.createDocumentFragment();
          const menuLabel = trigger.ownerDocument.createElement('span');
          menuLabel.className = 'celtis-ledger-control-menu-label';
          menuLabel.textContent = option.label;
          menuLabel.setAttribute('aria-label', option.accessibleLabel ?? option.label);
          title.appendChild(menuLabel);
          return item
            .setTitle(title)
            .setIcon(option.icon)
            .setChecked(option.value === value)
            .onClick(() => onSelect(option.value));
        });
      }
      this.activeMenu = menu;
      host.addClass('is-open');
      trigger.setAttr('aria-expanded', 'true');
      menu.onHide(() => {
        host.removeClass('is-open');
        trigger.setAttr('aria-expanded', 'false');
        if (this.activeMenu === menu) {
          this.activeMenu = undefined;
        }
      });
      const rect = trigger.getBoundingClientRect();
      menu.showAtPosition({
        x: rect.left,
        y: rect.bottom + 5,
        width: rect.width,
        overlap: true,
        left: false,
      }, trigger.ownerDocument);
    });
  }

  startOnboarding(): void {
    if (this.onboardingFrame != null) {
      window.cancelAnimationFrame(this.onboardingFrame);
      this.onboardingFrame = undefined;
    }
    this.activeMenu?.hide();
    this.activeMenu = undefined;
    if (this.statusFilter === 'archived') {
      this.statusFilter = 'all';
      this.render();
    }
    if (this.selectedRecordId) {
      void this.closeDrawer();
    }
    this.onboardingDispose?.();
    this.onboardingDispose = undefined;
    this.showOnboarding();
  }

  private queueOnboarding(): void {
    this.onboardingFrame = window.requestAnimationFrame(() => {
      this.onboardingFrame = undefined;
      if (
        this.contentEl.isConnected
        && shouldShowLedgerOnboarding(
          this.plugin.data.records.length,
          this.plugin.data.preferences.onboardingCompleted,
        )
      ) {
        this.showOnboarding();
      }
    });
  }

  private showOnboarding(): void {
    if (this.onboardingDispose || LEDGER_ONBOARDING_STEPS.length === 0) {
      return;
    }

    const doc = this.contentEl.ownerDocument;
    const view = doc.defaultView;
    if (!view) {
      return;
    }
    const opener = doc.activeElement?.instanceOf(HTMLElement) ? doc.activeElement : undefined;
    const layer = doc.body.createDiv({
      cls: 'celtis-asset-ledger-root celtis-ledger-onboarding-layer',
      attr: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'celtis-ledger-onboarding-title',
        'aria-describedby': 'celtis-ledger-onboarding-description',
      },
    });
    this.plugin.applyColorTheme(layer);
    const spotlight = layer.createDiv({ cls: 'celtis-ledger-onboarding-spotlight' });
    const coachmark = layer.createDiv({ cls: 'celtis-ledger-onboarding-card' });
    const top = coachmark.createDiv({ cls: 'celtis-ledger-onboarding-top' });
    const progress = top.createSpan({
      cls: 'celtis-ledger-onboarding-progress',
      attr: { 'aria-live': 'polite' },
    });
    const skip = top.createEl('button', {
      cls: 'celtis-ledger-onboarding-skip',
      text: '跳过',
      attr: { type: 'button' },
    });
    const stepIcon = coachmark.createSpan({ cls: 'celtis-ledger-onboarding-step-icon' });
    const title = coachmark.createEl('h2', {
      cls: 'celtis-ledger-onboarding-title',
      attr: { id: 'celtis-ledger-onboarding-title' },
    });
    const description = coachmark.createEl('p', {
      cls: 'celtis-ledger-onboarding-description',
      attr: { id: 'celtis-ledger-onboarding-description' },
    });
    const actions = coachmark.createDiv({ cls: 'celtis-ledger-onboarding-actions' });
    const previous = actions.createEl('button', {
      cls: 'celtis-ledger-onboarding-previous',
      text: '上一步',
      attr: { type: 'button' },
    });
    const next = actions.createEl('button', {
      cls: 'celtis-ledger-onboarding-next',
      attr: { type: 'button' },
    });
    const nextLabel = next.createSpan();
    const nextIcon = next.createSpan();
    setIcon(nextIcon, 'arrow-right');

    let stepIndex = 0;
    let target: HTMLElement | undefined;
    let positionFrame: number | undefined;
    let disposed = false;
    const scrollRoot = this.contentEl.closest<HTMLElement>('.view-content');

    const position = (): void => {
      if (disposed || !target?.isConnected) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const spotlightGap = 8;
      spotlight.style.width = `${Math.max(0, rect.width + spotlightGap * 2)}px`;
      spotlight.style.height = `${Math.max(0, rect.height + spotlightGap * 2)}px`;
      spotlight.style.transform = `translate3d(${rect.left - spotlightGap}px, ${rect.top - spotlightGap}px, 0)`;

      const viewportWidth = view.innerWidth;
      const viewportHeight = view.innerHeight;
      const edge = 16;
      const cardRect = coachmark.getBoundingClientRect();
      const cardWidth = Math.min(cardRect.width, viewportWidth - edge * 2);
      const left = Math.min(
        Math.max(rect.left, edge),
        Math.max(edge, viewportWidth - cardWidth - edge),
      );
      const below = rect.bottom + 18;
      const above = rect.top - cardRect.height - 18;
      const cardTop = below + cardRect.height <= viewportHeight - edge
        ? below
        : Math.max(edge, above);
      coachmark.style.transform = `translate3d(${left}px, ${cardTop}px, 0)`;
    };

    const schedulePosition = (): void => {
      if (positionFrame != null) {
        view.cancelAnimationFrame(positionFrame);
      }
      positionFrame = view.requestAnimationFrame(() => {
        positionFrame = undefined;
        position();
      });
    };

    const cleanup = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (positionFrame != null) {
        view.cancelAnimationFrame(positionFrame);
      }
      view.removeEventListener('resize', schedulePosition);
      scrollRoot?.removeEventListener('scroll', schedulePosition);
      doc.removeEventListener('keydown', onKeyDown, true);
      layer.remove();
      if (this.onboardingDispose === cleanup) {
        this.onboardingDispose = undefined;
      }
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };

    const finish = async (startRecording: boolean): Promise<void> => {
      cleanup();
      try {
        await this.plugin.updatePreferences({ onboardingCompleted: true }, false);
        if (startRecording) {
          this.plugin.openCreateModal('item');
        }
      } catch (error) {
        console.error('物迹账本 could not save onboarding progress', error);
      }
    };

    const setStep = (nextIndex: number): void => {
      stepIndex = Math.max(0, Math.min(LEDGER_ONBOARDING_STEPS.length - 1, nextIndex));
      const step = LEDGER_ONBOARDING_STEPS[stepIndex]!;
      target = this.contentEl.querySelector<HTMLElement>(
        `[data-celtis-tour-target="${step.id}"]`,
      ) ?? undefined;
      if (!target) {
        const availableIndex = LEDGER_ONBOARDING_STEPS.findIndex(({ id }) => (
          this.contentEl.querySelector(`[data-celtis-tour-target="${id}"]`)
        ));
        if (availableIndex < 0) {
          cleanup();
          new Notice('使用指引暂时无法定位，请重新打开台账后再试');
          return;
        }
        stepIndex = availableIndex;
        target = this.contentEl.querySelector<HTMLElement>(
          `[data-celtis-tour-target="${LEDGER_ONBOARDING_STEPS[stepIndex]!.id}"]`,
        ) ?? undefined;
      }

      progress.setText(`${stepIndex + 1} / ${LEDGER_ONBOARDING_STEPS.length}`);
      stepIcon.empty();
      setIcon(stepIcon, LEDGER_ONBOARDING_STEPS[stepIndex]!.icon);
      title.setText(LEDGER_ONBOARDING_STEPS[stepIndex]!.title);
      description.setText(LEDGER_ONBOARDING_STEPS[stepIndex]!.description);
      previous.disabled = stepIndex === 0;
      nextLabel.setText(
        stepIndex === LEDGER_ONBOARDING_STEPS.length - 1 ? '开始记录' : '下一步',
      );
      next.setAttr(
        'aria-label',
        stepIndex === LEDGER_ONBOARDING_STEPS.length - 1
          ? '完成使用指引并添加第一件物品'
          : `前往第 ${stepIndex + 2} 步`,
      );
      const reduceMotion = view.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
      schedulePosition();
      next.focus({ preventScroll: true });
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void finish(false);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (stepIndex === LEDGER_ONBOARDING_STEPS.length - 1) {
          void finish(true);
        } else {
          setStep(stepIndex + 1);
        }
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setStep(stepIndex - 1);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = [skip, previous, next].filter((button) => !button.disabled);
      const currentIndex = focusable.indexOf(doc.activeElement as HTMLButtonElement);
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };

    skip.addEventListener('click', () => void finish(false));
    previous.addEventListener('click', () => setStep(stepIndex - 1));
    next.addEventListener('click', () => {
      if (stepIndex === LEDGER_ONBOARDING_STEPS.length - 1) {
        void finish(true);
      } else {
        setStep(stepIndex + 1);
      }
    });
    view.addEventListener('resize', schedulePosition);
    scrollRoot?.addEventListener('scroll', schedulePosition, { passive: true });
    doc.addEventListener('keydown', onKeyDown, true);
    this.onboardingDispose = cleanup;
    setStep(0);
  }

  private renderSidebar(
    root: HTMLElement,
    summary: ReturnType<typeof getLedgerSummary>,
    records: LedgerRecord[],
    now: DayInput,
  ): void {
    const sidebar = root.createEl('aside', { cls: 'celtis-ledger-sidebar' });
    const quick = sidebar.createDiv({ cls: 'celtis-ledger-quick-actions' });
    const addItem = createActionButton(
      quick,
      'barcode',
      '添加物品',
      () => this.plugin.openCreateModal('item'),
      true,
    );
    addItem.dataset.celtisTourTarget = 'add-item';
    const addAccessory = createActionButton(
      quick,
      'wrench',
      '添加配件',
      () => this.plugin.openCreateModal('accessory'),
    );
    addAccessory.dataset.celtisTourTarget = 'add-accessory';

    this.renderSummaryCard(sidebar, {
      tone: 'active',
      icon: 'sparkles',
      title: '正在使用',
      artIcon: 'package',
      metrics: [
        ['每日成本', `${formatNumber(summary.activeDaily)} 元/天`],
        ['总价值', formatMoney(summary.activeValue)],
      ],
      onClick: () => {
        this.statusFilter = 'active';
        this.render();
      },
    });

    this.renderSummaryCard(sidebar, {
      tone: 'archived',
      icon: 'archive',
      title: '归档/卖出',
      artIcon: 'archive',
      metrics: [
        ['每日成本', `${formatNumber(summary.archivedDaily)} 元/天`],
        ['已报废', formatMoney(summary.archivedValue)],
      ],
      onClick: () => {
        this.statusFilter = 'archived';
        this.render();
      },
    });

    this.renderInsights(sidebar, getLedgerInsights(records, now));
  }

  private renderSummaryCard(
    root: HTMLElement,
    options: {
      tone: 'active' | 'archived';
      icon: string;
      title: string;
      artIcon: string;
      metrics: Array<[string, string]>;
      onClick: () => void;
    },
  ): void {
    const card = root.createEl('section', {
      cls: `celtis-ledger-summary is-${options.tone}`,
      attr: { 'aria-label': `${options.title}摘要` },
    });
    const filter = card.createEl('button', {
      cls: 'celtis-ledger-summary-filter',
      attr: { type: 'button', 'aria-label': `筛选${options.title}` },
    });
    filter.addEventListener('click', options.onClick);

    const title = filter.createDiv({ cls: 'celtis-ledger-summary-title' });
    setIcon(title.createSpan(), options.icon);
    title.createEl('h2', { text: options.title });

    const art = card.createSpan({ cls: 'celtis-ledger-summary-art' });
    art.setAttribute('aria-hidden', 'true');
    setIcon(art, options.artIcon);

    const metrics = filter.createDiv({ cls: 'celtis-ledger-summary-metrics' });
    for (const [label, value] of options.metrics) {
      const metric = metrics.createDiv();
      metric.createSpan({ text: label });
      metric.createEl('strong', { text: value });
    }
  }

  private renderInsights(root: HTMLElement, insights: LedgerInsights): void {
    const panel = root.createEl('section', {
      cls: 'celtis-ledger-insights',
      attr: { 'aria-label': '资产统计' },
    });
    const header = panel.createDiv({ cls: 'celtis-ledger-insights-header' });
    const title = header.createDiv();
    setIcon(title.createSpan(), 'chart-no-axes-combined');
    title.createEl('h2', { text: '资产统计' });
    header.createSpan({ cls: 'celtis-ledger-badge', text: '自动更新' });

    const content = panel.createDiv({ cls: 'celtis-ledger-insights-content' });
    const valueChart = content.createDiv({ cls: 'celtis-ledger-insight-block is-value' });
    const valueHeading = valueChart.createDiv({ cls: 'celtis-ledger-insight-heading' });
    valueHeading.createEl('h3', { text: '整套价值构成' });
    valueHeading.createSpan({ text: 'Top 5' });

    const valueRows = valueChart.createDiv({ cls: 'celtis-ledger-value-ranking' });
    if (insights.valueTop5.length === 0) {
      valueRows.createSpan({ cls: 'celtis-ledger-insight-empty', text: '暂无在用物品数据' });
    } else {
      for (const entry of insights.valueTop5) {
        const row = valueRows.createEl('button', {
          cls: 'celtis-ledger-value-row',
          attr: {
            type: 'button',
            'aria-label': `${entry.name}，整套价值 ${formatMoney(entry.value)}，占比 ${formatNumber(entry.sharePercent)}%`,
          },
        });
        row.addEventListener('click', () => this.openDrawer(entry.itemId));
        const copy = row.createDiv({ cls: 'celtis-ledger-value-row-copy' });
        copy.createSpan({ text: entry.name });
        const metric = copy.createSpan();
        metric.createEl('strong', { text: formatMoney(entry.value) });
        metric.createEl('small', { text: `${formatNumber(entry.sharePercent)}%` });
        row.createEl('progress', {
          attr: {
            max: '100',
            value: String(Math.max(0, Math.min(100, entry.sharePercent))),
            'aria-hidden': 'true',
          },
        });
      }
    }

    const yearsBlock = content.createDiv({ cls: 'celtis-ledger-insight-block is-years' });
    const yearsHeading = yearsBlock.createDiv({ cls: 'celtis-ledger-insight-heading' });
    yearsHeading.createEl('h3', { text: '购买年份分布' });
    yearsHeading.createSpan({ text: '物品件数' });
    renderPurchaseYearChart(yearsBlock, insights.purchaseYears);

    const facts = content.createDiv({ cls: 'celtis-ledger-insight-facts' });
    const highestDaily = insights.highlights.highestDaily;
    if (highestDaily) {
      const fact = facts.createEl('button', {
        cls: 'celtis-ledger-insight-fact',
        attr: {
          type: 'button',
          'aria-label': highestDaily.explanation,
        },
      });
      fact.addEventListener('click', () => this.openDrawer(highestDaily.itemId));
      setIcon(fact.createSpan(), 'gauge');
      const copy = fact.createDiv();
      copy.createSpan({ text: '日成本最高' });
      copy.createEl('strong', { text: highestDaily.name });
      copy.createEl('small', { text: `${formatNumber(highestDaily.metric)} 元/天` });
    }

    const longestHeld = insights.highlights.longestHeld;
    if (longestHeld) {
      const fact = facts.createEl('button', {
        cls: 'celtis-ledger-insight-fact',
        attr: {
          type: 'button',
          'aria-label': longestHeld.explanation,
        },
      });
      fact.addEventListener('click', () => this.openDrawer(longestHeld.itemId));
      setIcon(fact.createSpan(), 'history');
      const copy = fact.createDiv();
      copy.createSpan({ text: '持有最久' });
      copy.createEl('strong', { text: longestHeld.name });
      copy.createEl('small', { text: `${formatNumber(longestHeld.metric)} 天` });
    }
  }

  private renderActiveItems(root: HTMLElement, records: LedgerRecord[], now: DayInput): void {
    const allActiveItems = sortRecords(
      records.filter((record) => record.type === 'item' && !isArchived(record)),
      this.sortMode,
      records,
      now,
    );
    const activeItems = allActiveItems.filter((record) => matchesQuery(record, this.query));
    const inlineGrouping = buildInlineEditGroups(records, allActiveItems, this.query);
    this.galleryItemCount = activeItems.length;
    this.tableItemCount = inlineGrouping.groups.length;

    const section = root.createEl('section', { cls: 'celtis-ledger-section' });
    const { tools, count } = this.renderSectionHeader(
      section,
      'barcode',
      '物品',
      `${this.viewMode === 'table' ? this.tableItemCount : this.galleryItemCount} 件`,
    );
    this.activeItemCountEl = count;
    if (activeItems.length > 0 && !Platform.isMobile) {
      tools.createSpan({
        cls: 'celtis-ledger-drag-hint',
        text: '拖图片添加 · 拖卡片归档',
      });
    }
    const tabs = tools.createDiv({ cls: 'celtis-ledger-tabs', attr: { role: 'tablist' } });
    this.viewTabsEl = tabs;
    tabs.dataset.celtisTourTarget = 'view-mode';
    this.renderViewTab(tabs, 'gallery', '画廊', 'layout-grid');
    this.renderViewTab(tabs, 'table', '自用编辑', 'pencil-line');

    const galleryPanel = section.createDiv({
      cls: 'celtis-ledger-view-panel is-gallery',
      attr: { role: 'tabpanel', 'aria-label': '物品画廊' },
    });
    this.galleryPanelEl = galleryPanel;
    if (activeItems.length === 0) {
      renderEmpty(
        galleryPanel,
        'package-search',
        '没有符合条件的在用物品',
        '试试清除搜索，或添加一件新物品。',
      );
    } else {
      const gallery = galleryPanel.createDiv({ cls: 'celtis-ledger-gallery' });
      for (const item of activeItems) {
        this.renderItemCard(gallery, item, records, now);
      }
    }

    const tablePanel = section.createDiv({
      cls: 'celtis-ledger-view-panel is-table',
      attr: { role: 'tabpanel', 'aria-label': '物品自用编辑' },
    });
    this.tablePanelEl = tablePanel;
    if (inlineGrouping.groups.length === 0 && inlineGrouping.otherAccessories.length === 0) {
      renderEmpty(
        tablePanel,
        'package-search',
        '没有符合条件的在用物品',
        '试试清除搜索，或添加一件新物品。',
      );
    } else {
      this.renderEditTable(tablePanel, inlineGrouping, records, now);
    }
  }

  private renderViewTab(root: HTMLElement, mode: ViewMode, label: string, icon: string): void {
    const button = root.createEl('button', {
      cls: this.viewMode === mode ? 'celtis-ledger-tab is-active' : 'celtis-ledger-tab',
      attr: {
        type: 'button',
        role: 'tab',
        'aria-selected': String(this.viewMode === mode),
      },
    });
    button.dataset.viewMode = mode;
    const iconElement = button.createSpan({ cls: 'celtis-ledger-tab-icon' });
    setIcon(iconElement, icon);
    button.createSpan({ cls: 'celtis-ledger-tab-label', text: label });
    button.addEventListener('click', () => {
      if (mode === this.viewMode) {
        return;
      }
      this.viewMode = mode;
      this.syncViewModeUi();
      void this.plugin.updatePreferences({ viewMode: mode }).catch((error) => {
        console.error('物迹账本 could not save the view preference', error);
      });
    });
  }

  private syncViewModeUi(): void {
    const dragHint = this.viewTabsEl?.parentElement?.querySelector<HTMLElement>('.celtis-ledger-drag-hint');
    if (dragHint) dragHint.hidden = this.viewMode !== 'gallery';
    for (const button of this.viewTabsEl?.querySelectorAll<HTMLButtonElement>(
      '.celtis-ledger-tab[data-view-mode]',
    ) ?? []) {
      const isActive = button.dataset.viewMode === this.viewMode;
      button.toggleClass('is-active', isActive);
      button.setAttr('aria-selected', String(isActive));
    }

    if (this.galleryPanelEl) {
      this.galleryPanelEl.hidden = this.viewMode !== 'gallery';
    }
    if (this.tablePanelEl) {
      this.tablePanelEl.hidden = this.viewMode !== 'table';
    }
    if (this.accessorySectionEl) {
      this.accessorySectionEl.hidden = this.viewMode === 'table';
    }
    this.activeItemCountEl?.setText(
      `${this.viewMode === 'table' ? this.tableItemCount : this.galleryItemCount} 件`,
    );
  }

  private renderItemCard(
    root: HTMLElement,
    item: LedgerRecord,
    records: LedgerRecord[],
    now: DayInput,
  ): void {
    const cost = getItemCost(item, records, now);
    const accessoryCount = getLinkedAccessories(item.id, records).length;
    const relationLabel = accessoryCount > 0
      ? `，关联 ${accessoryCount} 个配件`
      : '';
    const card = root.createEl('button', {
      cls: 'celtis-ledger-item-card',
      attr: {
        type: 'button',
        'aria-label': `查看物品 ${item.name}${relationLabel}`,
        'data-celtis-record-id': item.id,
      },
    });
    card.addEventListener('click', () => this.openDrawer(item.id));
    this.enableQuickArchive(card, item);

    const media = card.createDiv({ cls: 'celtis-ledger-item-cover' });
    const isStickerCover = isGeneratedStickerPath(item.cover);
    if (isStickerCover) {
      media.addClass('is-sticker-cover');
      media.dataset.stickerShape = 'standard';
    }
    const placeholder = media.createDiv({ cls: 'celtis-ledger-item-placeholder' });
    setIcon(placeholder, 'package');
    if (item.cover) {
      const image = media.createEl('img', {
        cls: 'is-pending',
        attr: {
          alt: `${item.name} 封面`,
          loading: 'lazy',
          draggable: 'false',
        },
      });
      const revealImage = (): void => {
        if (isStickerCover) {
          media.dataset.stickerShape = getStickerShape(image.naturalWidth, image.naturalHeight);
        }
        image.removeClass('is-pending');
        placeholder.hidden = true;
      };
      image.addEventListener('load', revealImage);
      image.addEventListener('error', () => {
        image.hidden = true;
        placeholder.hidden = false;
      });
      image.src = this.plugin.getAssetUrl(item.cover);
      if (image.complete && image.naturalWidth > 0) {
        revealImage();
      }
    }

    const body = card.createDiv({ cls: 'celtis-ledger-item-body' });
    const name = body.createDiv({ cls: 'celtis-ledger-item-name' });
    setIcon(name.createSpan(), 'file-text');
    name.createEl('strong', { text: item.name });
    const metadata = body.createDiv({ cls: 'celtis-ledger-item-meta' });
    metadata.createDiv({
      cls: 'celtis-ledger-item-date',
      text: item.purchaseDate ? formatDate(item.purchaseDate) : '未填写购买日期',
    });
    if (accessoryCount > 0) {
      renderAccessoryCount(metadata, accessoryCount);
    }
    renderMetricRow(body, '价值', formatMoney(cost.value), 'celtis-ledger-item-metric');
    renderMetricRow(body, '每日成本', `${formatNumber(cost.daily)} 元`, 'celtis-ledger-item-daily');
  }

  private renderEditTable(
    root: HTMLElement,
    grouping: InlineEditGrouping,
    records: LedgerRecord[],
    now: DayInput,
  ): void {
    const wrap = root.createDiv({ cls: 'celtis-ledger-table-wrap' });
    const table = wrap.createEl('table', { cls: 'celtis-ledger-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const heading of ['名称', '购买日期', '买入费用', '关系', '总价值', '每日成本', '操作']) {
      head.createEl('th', { text: heading });
    }

    const body = table.createEl('tbody');
    for (const group of grouping.groups) {
      const activeLinkedCount = getLinkedAccessories(group.item.id, records)
        .filter((accessory) => !isArchived(accessory)).length;
      this.renderInlineEditRow(body, group.item, records, now, {
        relation: `${activeLinkedCount} 个配件`,
      });

      group.accessories.forEach((accessory, index) => {
        this.renderInlineEditRow(body, accessory, records, now, {
          parent: group.item,
          relation: '配件',
          isLastChild: index === group.accessories.length - 1,
        });
      });
    }

    if (grouping.otherAccessories.length > 0) {
      const divider = body.createEl('tr', { cls: 'celtis-ledger-inline-group-heading' });
      divider.createEl('td', {
        text: `其他配件 · ${grouping.otherAccessories.length}`,
        attr: { colspan: '7' },
      });
      const itemsById = new Map(
        records.filter((record) => record.type === 'item').map((record) => [record.id, record]),
      );
      grouping.otherAccessories.forEach((accessory, index) => {
        const parent = accessory.linkedItemId
          ? itemsById.get(accessory.linkedItemId)
          : undefined;
        this.renderInlineEditRow(body, accessory, records, now, {
          parent,
          relation: parent ? `关联 ${parent.name}` : '未关联',
          isLastChild: index === grouping.otherAccessories.length - 1,
        });
      });
    }
  }

  private renderInlineEditRow(
    body: HTMLTableSectionElement,
    record: LedgerRecord,
    records: LedgerRecord[],
    now: DayInput,
    options: {
      parent?: LedgerRecord;
      relation: string;
      isLastChild?: boolean;
    },
  ): void {
    const isAccessory = record.type === 'accessory';
    const row = body.createEl('tr', {
      cls: isAccessory
        ? 'celtis-ledger-inline-row is-accessory'
        : 'celtis-ledger-inline-row is-item',
      attr: {
        'data-celtis-record-id': record.id,
        'data-depth': isAccessory ? '1' : '0',
      },
    });
    row.toggleClass('is-last-child', Boolean(options.isLastChild));

    const nameCell = row.createEl('td');
    const nameWrap = nameCell.createDiv({
      cls: isAccessory
        ? 'celtis-ledger-inline-name is-child'
        : 'celtis-ledger-inline-name',
    });
    if (isAccessory) {
      nameWrap.createSpan({ cls: 'celtis-ledger-tree-branch', attr: { 'aria-hidden': 'true' } });
    }
    if (!isAccessory) {
      this.renderRecordThumbnail(nameWrap, record.cover, 'package')
        .addClass('is-inline-item');
    }
    const nameInput = nameWrap.createEl('input', {
      cls: 'celtis-ledger-inline-input is-name',
      attr: {
        type: 'text',
        maxlength: '120',
        value: record.name,
        'aria-label': `${isAccessory ? '配件' : '物品'}名称`,
      },
    });

    const dateCell = row.createEl('td');
    const dateWrap = dateCell.createDiv({ cls: 'celtis-ledger-inline-date' });
    const dateControl = createDateControl(dateWrap, {
      label: `${record.name}购买日期`,
      value: record.purchaseDate,
    });
    if (isAccessory && !record.purchaseDate) {
      const effectiveDate = getEffectivePurchaseDate(record, records);
      dateWrap.createSpan({
        cls: 'celtis-ledger-inline-inherited-date',
        text: effectiveDate ? `沿用 ${formatDate(effectiveDate)}` : '未设置日期',
      });
    }

    const costCell = row.createEl('td');
    const costInput = costCell.createEl('input', {
      cls: 'celtis-ledger-inline-input is-cost',
      attr: {
        type: 'number',
        min: '0',
        step: '0.01',
        value: String(record.purchaseCost),
        inputmode: 'decimal',
        'aria-label': `${record.name}买入费用`,
      },
    });

    const relationCell = row.createEl('td');
    relationCell.createSpan({
      cls: isAccessory
        ? 'celtis-ledger-inline-relation is-accessory'
        : 'celtis-ledger-inline-relation',
      text: options.relation,
    });

    const recordCost = getRecordCost(record, now, records);
    const itemCost = record.type === 'item' ? getItemCost(record, records, now) : undefined;
    row.createEl('td').createEl('output', {
      cls: 'celtis-ledger-inline-output',
      text: formatMoney(itemCost?.value ?? recordCost.net),
    });
    row.createEl('td').createEl('output', {
      cls: 'celtis-ledger-inline-output is-daily',
      text: `${formatNumber(itemCost?.daily ?? recordCost.daily)} 元`,
    });

    const actionCell = row.createEl('td');
    const actions = actionCell.createDiv({ cls: 'celtis-ledger-inline-actions' });
    const status = actions.createSpan({
      cls: 'celtis-ledger-inline-status',
      attr: { 'aria-live': 'polite' },
    });
    const saveButton = actions.createEl('button', {
      cls: 'celtis-ledger-inline-action is-save',
      attr: {
        type: 'button',
        'aria-label': `保存${record.name}`,
        title: '保存这一行',
        disabled: 'true',
      },
    });
    setIcon(saveButton, 'check');
    const detailButton = actions.createEl('button', {
      cls: 'celtis-ledger-inline-action',
      attr: {
        type: 'button',
        'aria-label': `打开${record.name}更多设置`,
        title: '更多设置',
      },
    });
    setIcon(detailButton, 'ellipsis');
    detailButton.addEventListener('click', () => this.openDrawer(record.id));

    let restoring = false;
    let saving = false;
    const isDirty = (): boolean => nameInput.value.trim() !== record.name
      || dateControl.value !== (record.purchaseDate ?? '')
      || costInput.value !== String(record.purchaseCost);
    const syncDirtyState = (): void => {
      if (restoring || saving) {
        return;
      }
      const dirty = isDirty();
      row.toggleClass('is-dirty', dirty);
      saveButton.disabled = !dirty;
      status.setText(dirty ? '已修改' : '');
    };
    nameInput.addEventListener('input', syncDirtyState);
    costInput.addEventListener('input', syncDirtyState);
    dateControl.input.addEventListener('change', syncDirtyState);

    const reset = (): void => {
      if (saving) {
        return;
      }
      restoring = true;
      nameInput.value = record.name;
      costInput.value = String(record.purchaseCost);
      dateControl.setValue(record.purchaseDate ?? '');
      restoring = false;
      syncDirtyState();
      nameInput.focus({ preventScroll: true });
      nameInput.select();
    };

    const save = async (): Promise<void> => {
      if (saving || !isDirty()) {
        return;
      }
      const name = nameInput.value.trim();
      if (!name) {
        new Notice('名称不能为空');
        nameInput.focus({ preventScroll: true });
        return;
      }
      const purchaseCost = Number(costInput.value);
      if (!Number.isFinite(purchaseCost) || purchaseCost < 0) {
        new Notice('买入费用必须是大于或等于 0 的数字');
        costInput.focus({ preventScroll: true });
        return;
      }

      saving = true;
      row.addClass('is-saving');
      status.setText('正在保存');
      for (const control of row.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) {
        control.disabled = true;
      }
      try {
        await this.plugin.patchRecord(record.id, (current) => ({
          ...current,
          name,
          purchaseDate: dateControl.value || undefined,
          purchaseCost,
        }));
        new Notice(`${name} 已保存`);
      } catch {
        saving = false;
        row.removeClass('is-saving');
        status.setText('保存失败');
        nameInput.disabled = false;
        costInput.disabled = false;
        detailButton.disabled = false;
        for (const button of dateWrap.querySelectorAll<HTMLButtonElement>('button')) {
          button.disabled = false;
        }
        saveButton.disabled = false;
      }
    };
    saveButton.addEventListener('click', () => void save());
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        reset();
      }
    });
  }

  private renderRecordThumbnail(
    root: HTMLElement,
    cover: string | undefined,
    fallbackIcon: string,
  ): HTMLElement {
    const thumbnail = root.createSpan({ cls: 'celtis-ledger-record-thumbnail' });
    const fallback = thumbnail.createSpan({ cls: 'celtis-ledger-record-thumbnail-fallback' });
    setIcon(fallback, fallbackIcon);
    if (!cover) {
      return thumbnail;
    }

    thumbnail.toggleClass('is-sticker', isGeneratedStickerPath(cover));
    const image = thumbnail.createEl('img', {
      attr: { alt: '', loading: 'lazy', draggable: 'false' },
    });
    const syncLoadedImage = (): void => {
      if (thumbnail.hasClass('is-sticker')) {
        thumbnail.dataset.stickerShape = getStickerShape(
          image.naturalWidth,
          image.naturalHeight,
        );
      }
      fallback.hidden = true;
    };
    image.addEventListener('load', syncLoadedImage);
    image.addEventListener('error', () => image.remove());
    image.src = this.plugin.getAssetUrl(cover);
    if (image.complete && image.naturalWidth > 0) {
      syncLoadedImage();
    }
    return thumbnail;
  }

  private renderAccessoryBoard(root: HTMLElement, records: LedgerRecord[], now: DayInput): void {
    const accessories = records.filter(
      (record) => record.type === 'accessory' && !isArchived(record) && matchesQuery(record, this.query),
    );

    const section = root.createEl('section', { cls: 'celtis-ledger-section' });
    this.accessorySectionEl = section;
    this.renderSectionHeader(section, 'wrench', '配件', `${accessories.length} 件`);

    if (accessories.length === 0) {
      renderEmpty(section, 'cable', '没有符合条件的在用配件', '配件可以独立存在，也可以关联到一件物品。');
      return;
    }

    const itemsById = new Map(
      records.filter((record) => record.type === 'item').map((record) => [record.id, record]),
    );
    const groups = new Map<string, LedgerRecord[]>();
    for (const accessory of accessories) {
      const key = accessory.linkedItemId && itemsById.has(accessory.linkedItemId)
        ? accessory.linkedItemId
        : '__unlinked__';
      const group = groups.get(key) ?? [];
      group.push(accessory);
      groups.set(key, group);
    }

    const board = section.createDiv({ cls: 'celtis-ledger-board' });
    for (const [itemId, group] of groups) {
      const linkedItem = itemId === '__unlinked__' ? undefined : itemsById.get(itemId);
      const column = board.createDiv({ cls: 'celtis-ledger-board-column' });
      const header = column.createDiv({ cls: 'celtis-ledger-board-column-header' });
      if (linkedItem) {
        this.renderRecordThumbnail(header, linkedItem.cover, 'package')
          .addClass('is-board-item');
      } else {
        const fallback = header.createSpan({ cls: 'celtis-ledger-board-column-fallback' });
        setIcon(fallback, 'unlink');
      }
      const headerCopy = header.createDiv();
      headerCopy.createEl('strong', { text: linkedItem?.name ?? '未关联物品' });
      headerCopy.createSpan({ text: `${group.length} 个配件` });

      for (const accessory of group) {
        const cost = getRecordCost(accessory, now, records);
        const effectivePurchaseDate = getEffectivePurchaseDate(accessory, records);
        const card = column.createEl('button', {
          cls: 'celtis-ledger-accessory-card',
          attr: {
            type: 'button',
            'aria-label': `查看配件 ${accessory.name}`,
            'data-celtis-record-id': accessory.id,
          },
        });
        card.addEventListener('click', () => this.openDrawer(accessory.id));
        this.enableQuickArchive(card, accessory);
        card.createEl('strong', { text: accessory.name });
        renderMetricRow(card, '价值', formatMoney(cost.net), 'celtis-ledger-item-metric');
        renderMetricRow(card, '每日成本', `${formatNumber(cost.daily)} 元`, 'celtis-ledger-item-daily');
        if (!accessory.purchaseDate && effectivePurchaseDate) {
          card.createSpan({
            cls: 'celtis-ledger-badge is-inherited-date',
            text: `沿用主商品日期 · ${formatDate(effectivePurchaseDate)}`,
          });
        } else if (!accessory.purchaseDate) {
          card.createSpan({ cls: 'celtis-ledger-badge', text: '未设日期 · 暂不计日成本' });
        }
      }
    }
  }

  private renderArchive(root: HTMLElement, records: LedgerRecord[], now: DayInput): void {
    const archivedItems = sortRecords(
      records.filter((record) => record.type === 'item' && isArchived(record) && matchesQuery(record, this.query)),
      this.sortMode,
      records,
      now,
    );
    const archivedAccessories = records.filter(
      (record) => record.type === 'accessory' && isArchived(record) && matchesQuery(record, this.query),
    );

    const section = root.createEl('section', { cls: 'celtis-ledger-section is-archive' });
    this.renderSectionHeader(
      section,
      'archive',
      '归档',
      `${archivedItems.length} 件物品 · ${archivedAccessories.length} 个配件`,
    );

    section.createEl('h3', { cls: 'celtis-ledger-archive-heading', text: '物品已归档' });
    const itemGrid = section.createDiv({ cls: 'celtis-ledger-archive-grid' });
    if (archivedItems.length === 0) {
      renderInlineEmpty(itemGrid, '没有符合条件的归档物品');
    } else {
      for (const item of archivedItems) {
        this.renderArchiveCard(itemGrid, item, records, now);
      }
    }

    section.createEl('h3', { cls: 'celtis-ledger-archive-heading', text: '配件已归档' });
    const accessoryGrid = section.createDiv({ cls: 'celtis-ledger-archive-grid' });
    if (archivedAccessories.length === 0) {
      renderInlineEmpty(accessoryGrid, '没有符合条件的归档配件');
    } else {
      for (const accessory of archivedAccessories) {
        this.renderArchiveCard(accessoryGrid, accessory, records, now);
      }
    }
  }

  private renderStickerCollection(
    root: HTMLElement,
    records: LedgerRecord[],
    now: DayInput,
  ): void {
    const section = root.createEl('section', {
      cls: 'celtis-ledger-section is-sticker-collection',
    });
    const candidates = sortRecords(
      records.filter((record) => matchesQuery(record, this.query)),
      this.sortMode,
      records,
      now,
    );
    const header = this.renderSectionHeader(section, 'images', '贴纸', '0 张');
    const filters = header.tools.createDiv({
      cls: 'celtis-ledger-sticker-filters',
      attr: { role: 'tablist', 'aria-label': '贴纸分类' },
    });
    const options: Array<{ value: StickerCollectionFilter; label: string }> = [
      { value: 'all', label: '全部' },
      { value: 'owned', label: '拥有' },
      { value: 'archived', label: '归档' },
    ];
    const buttons: HTMLButtonElement[] = [];
    const board = section.createDiv({ cls: 'celtis-ledger-sticker-board' });
    const grid = board.createDiv({ cls: 'celtis-ledger-sticker-grid' });
    const syncFilters = (): void => {
      for (const button of buttons) {
        const active = button.dataset.stickerFilter === this.stickerFilter;
        button.toggleClass('is-active', active);
        button.setAttr('aria-selected', String(active));
      }
    };
    const renderGrid = (): void => {
      grid.empty();
      const available = getStickerCollectionRecords(candidates, this.stickerFilter);
      header.count.setText(`${available.length} 张`);
      if (available.length === 0) {
        renderInlineEmpty(grid, '这个分类里还没有贴纸');
        return;
      }
      for (const record of available) {
        this.renderStickerCollectionCard(grid, record, records, now);
      }
    };

    for (const option of options) {
      const button = filters.createEl('button', {
        cls: this.stickerFilter === option.value
          ? 'celtis-ledger-sticker-filter is-active'
          : 'celtis-ledger-sticker-filter',
        attr: {
          type: 'button',
          role: 'tab',
          'aria-selected': String(this.stickerFilter === option.value),
        },
        text: option.label,
      });
      button.dataset.stickerFilter = option.value;
      button.addEventListener('click', () => {
        if (this.stickerFilter === option.value) {
          return;
        }
        this.stickerFilter = option.value;
        syncFilters();
        renderGrid();
      });
      buttons.push(button);
    }
    renderGrid();
  }

  private renderStickerCollectionCard(
    root: HTMLElement,
    record: LedgerRecord,
    records: LedgerRecord[],
    now: DayInput,
  ): void {
    const card = root.createEl('button', {
      cls: 'celtis-ledger-sticker-card',
      attr: {
        type: 'button',
        'aria-label': `查看 ${record.name} 贴纸详情`,
        title: `${record.name} · 点击查看`,
        'data-sticker-status': isArchived(record) ? 'archived' : 'owned',
      },
    });
    const pose = getStickerBoardPose(record.id);
    card.style.setProperty('--celtis-sticker-rotate', `${pose.rotationDeg}deg`);
    card.style.setProperty('--celtis-sticker-x', `${pose.offsetX}px`);
    card.style.setProperty('--celtis-sticker-y', `${pose.offsetY}px`);
    card.style.setProperty('--celtis-sticker-scale', String(pose.scale));
    renderStickerArtwork(card, record, this.plugin);
    if (!isArchived(record)) this.enableQuickArchive(card, record);
    card.addEventListener('click', () => {
      new StickerDetailModal(this.app, this.plugin, record, records, now).open();
    });
  }

  private renderArchiveCard(
    root: HTMLElement,
    record: LedgerRecord,
    records: LedgerRecord[],
    now: DayInput,
  ): void {
    const variant = getArchiveCardVariant(record);
    const base = getRecordCost(record, now, records);
    const daily = record.type === 'item' ? getItemCost(record, records, now).daily : base.daily;
    const accessoryCount = record.type === 'item'
      ? getLinkedAccessories(record.id, records).length
      : undefined;
    const relationLabel = accessoryCount != null && accessoryCount > 0
      ? `，关联 ${accessoryCount} 个配件`
      : '';
    const card = root.createEl('button', {
      cls: 'celtis-ledger-archive-card',
      attr: {
        type: 'button',
        'aria-label': accessoryCount == null
          ? `查看归档配件 ${record.name}`
          : `查看归档物品 ${record.name}${relationLabel}`,
        'data-celtis-record-id': record.id,
      },
    });
    card.addEventListener('click', () => this.openDrawer(record.id));
    if (variant === 'media') {
      card.addClass('has-cover');
      this.renderRecordThumbnail(
        card,
        record.cover,
        record.type === 'item' ? 'package' : 'wrench',
      ).addClass('is-archive-cover');
    } else {
      card.addClass('is-classic');
    }
    const copy = card.createDiv({ cls: 'celtis-ledger-archive-copy' });
    const name = copy.createDiv({ cls: 'celtis-ledger-item-name' });
    if (variant === 'classic') {
      setIcon(name.createSpan(), record.type === 'item' ? 'package' : 'wrench');
    }
    name.createEl('strong', { text: record.name });
    if (accessoryCount != null) {
      renderAccessoryCount(copy, accessoryCount);
    }
    renderMetricRow(copy, '已使用', base.days == null ? '未设置日期' : `${base.days} 天`, 'celtis-ledger-item-metric');
    renderMetricRow(copy, '每日成本', `${formatNumber(daily)} 元`, 'celtis-ledger-item-daily');
  }

  private renderSectionHeader(
    root: HTMLElement,
    icon: string,
    title: string,
    count: string,
  ): { tools: HTMLElement; count: HTMLElement } {
    const header = root.createDiv({ cls: 'celtis-ledger-section-header' });
    const heading = header.createDiv({ cls: 'celtis-ledger-section-title' });
    setIcon(heading.createSpan(), icon);
    heading.createEl('h2', { text: title });
    const countEl = heading.createSpan({ cls: 'celtis-ledger-badge', text: count });
    return {
      tools: header.createDiv({ cls: 'celtis-ledger-section-tools' }),
      count: countEl,
    };
  }

  private enableQuickArchive(card: HTMLButtonElement, record: LedgerRecord): void {
    card.draggable = false;
    card.dataset.celtisArchiveDraggable = record.id;
    card.setAttribute('aria-description', '拖到快捷归档区，或右键选择快捷归档');
    const showMenu = (event?: MouseEvent): void => {
      this.activeMenu?.hide();
      const menu = new Menu();
      this.activeMenu = menu;
      menu.addItem((item) => item.setTitle('快捷归档 / 卖出').setIcon('archive')
        .onClick(() => this.openQuickArchive(record.id)));
      if (event) menu.showAtMouseEvent(event);
      else {
        const rect = card.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left + 20, y: rect.top + 40 });
      }
    };
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showMenu(event);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        showMenu();
      }
    });
  }

  private openQuickArchive(recordId: string): void {
    const record = this.plugin.data.records.find((candidate) => candidate.id === recordId);
    if (!record || isArchived(record)) {
      new Notice('记录状态已变化，请查看最新台账');
      return;
    }
    new ArchiveRecordModal(
      this.app,
      this.plugin,
      record,
      () => this.plugin.data.records,
      async (archiveDate, saleIncome) => {
        await this.plugin.patchRecord(recordId, (current) => applyArchiveDraft(
          current,
          this.plugin.data.records,
          { archiveDate, saleIncome: saleIncome == null ? '' : String(saleIncome) },
        ), false);
      },
      () => {
        this.plugin.refreshDataViews();
        new Notice(`${this.plugin.data.records.find((candidate) => candidate.id === recordId)?.name ?? record.name} 已归档`);
      },
    ).open();
  }

  private openDrawer(recordId: string): void {
    const record = this.plugin.data.records.find((candidate) => candidate.id === recordId);
    if (!record) {
      new Notice('这条记录已不存在');
      return;
    }

    const active = this.contentEl.ownerDocument.activeElement;
    if (
      active?.instanceOf(HTMLElement)
      && this.contentEl.contains(active)
      && !this.drawerOverlay?.contains(active)
    ) {
      this.drawerOpener = active;
    }

    if (this.drawerCloseTimer != null) {
      window.clearTimeout(this.drawerCloseTimer);
      this.drawerCloseTimer = undefined;
    }
    if (this.drawerOverlay) {
      disposeRecordForms(this.drawerOverlay);
      disposeDateControls(this.drawerOverlay);
      this.drawerOverlay.remove();
      this.drawerOverlay = undefined;
    }
    this.selectedRecordId = recordId;
    this.renderDrawer(this.contentEl, record, todayInShanghai());
  }

  showRecord(recordId: string): void {
    this.openDrawer(recordId);
  }

  private closeDrawer(): Promise<void> {
    const recordId = this.selectedRecordId;
    this.selectedRecordId = undefined;
    const overlay = this.drawerOverlay;
    if (!overlay) {
      this.restoreDrawerFocus(recordId);
      return Promise.resolve();
    }

    this.drawerOverlay = undefined;
    overlay.removeClass('is-open');
    overlay.addClass('is-closing');
    overlay.setAttr('aria-hidden', 'true');

    return new Promise((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) {
          return;
        }
        finished = true;
        if (this.drawerCloseTimer != null) {
          window.clearTimeout(this.drawerCloseTimer);
          this.drawerCloseTimer = undefined;
        }
        disposeDateControls(overlay);
        disposeRecordForms(overlay);
        overlay.remove();
        this.restoreDrawerFocus(recordId);
        resolve();
      };
      const drawer = overlay.querySelector<HTMLElement>('.celtis-ledger-drawer');
      drawer?.addEventListener('transitionend', (event) => {
        if (event.target === drawer && event.propertyName === 'transform') {
          finish();
        }
      }, { once: true });
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
      }
      this.drawerCloseTimer = window.setTimeout(finish, 380);
    });
  }

  private restoreDrawerFocus(recordId?: string): void {
    window.requestAnimationFrame(() => {
      if (this.selectedRecordId || this.drawerOverlay) {
        return;
      }
      if (this.drawerOpener?.isConnected) {
        this.drawerOpener.focus({ preventScroll: true });
        this.drawerOpener = undefined;
        return;
      }
      const opener = recordId
        ? Array.from(
          this.contentEl.querySelectorAll<HTMLElement>('[data-celtis-record-id]'),
        ).find((element) => element.dataset.celtisRecordId === recordId)
        : undefined;
      const fallback = this.contentEl.querySelector<HTMLInputElement>(
        '.celtis-ledger-search input',
      );
      (opener ?? fallback)?.focus({ preventScroll: true });
      this.drawerOpener = undefined;
    });
  }

  private renderDrawer(root: HTMLElement, record: LedgerRecord, now: DayInput): void {
    const overlay = root.createDiv({
      cls: 'celtis-ledger-drawer-overlay',
      attr: { role: 'presentation', 'aria-hidden': 'false' },
    });
    this.drawerOverlay = overlay;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        void this.closeDrawer();
      }
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        void this.closeDrawer();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(
          drawer.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
          drawer.focus();
          return;
        }

        const active = drawer.ownerDocument.activeElement;
        const focusIsOutside = !active || !drawer.contains(active);
        if (active === drawer || focusIsOutside) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    const drawer = overlay.createEl('aside', {
      cls: 'celtis-ledger-drawer',
      attr: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': `${record.name} 详情`,
        tabindex: '-1',
      },
    });
    window.requestAnimationFrame(() => {
      if (
        !overlay.isConnected
        || this.drawerOverlay !== overlay
        || this.selectedRecordId !== record.id
      ) {
        return;
      }
      overlay.addClass('is-open');
      drawer.focus({ preventScroll: true });
    });

    const header = drawer.createDiv({ cls: 'celtis-ledger-drawer-header' });
    const title = header.createDiv();
    title.createSpan({
      cls: 'celtis-ledger-badge',
      text: record.type === 'item' ? '物品' : '配件',
    });
    title.createEl('h2', { text: record.name });
    createIconButton(header, 'x', '关闭详情', () => { void this.closeDrawer(); });

    const body = drawer.createDiv({ cls: 'celtis-ledger-drawer-body' });
    this.renderDetailMetrics(body, record, now);

    // Existing accessories must keep their relationship even when the parent
    // item has been archived. The editor therefore lists every item and marks
    // archived choices explicitly; the create modal remains active-items only.
    const items = this.plugin.data.records.filter((candidate) => candidate.type === 'item');
    const inheritedPurchaseDate = record.type === 'accessory' && !record.purchaseDate
      ? getEffectivePurchaseDate(record, this.plugin.data.records)
      : undefined;
    const form = renderRecordFields(body, record, items, this.plugin, {
      inheritedPurchaseDate,
    });
    let detailFormDirty = false;
    const markDetailFormDirty = (): void => {
      detailFormDirty = true;
    };
    body.addEventListener('input', markDetailFormDirty);
    body.addEventListener('change', markDetailFormDirty);

    if (record.type === 'item') {
      const linked = getLinkedAccessories(record.id, this.plugin.data.records);
      const relation = body.createDiv({ cls: 'celtis-ledger-linked-list' });
      relation.createEl('h3', { text: `联动配件 · ${linked.length}` });
      if (linked.length === 0) {
        relation.createEl('p', { text: '目前没有关联配件。' });
      } else {
        const chips = relation.createDiv();
        for (const accessory of linked) {
          const chip = chips.createEl('button', {
            cls: 'celtis-ledger-badge',
            attr: { type: 'button' },
            text: accessory.name,
          });
          chip.addEventListener('click', () => this.openDrawer(accessory.id));
        }
      }
      if (!isArchived(record)) {
        const linkedActions = relation.createDiv({ cls: 'celtis-ledger-linked-actions' });
        createActionButton(linkedActions, 'wrench', '添加配件', () => {
          if (detailFormDirty) {
            new Notice('请先保存当前修改，再添加配件');
            return;
          }
          this.plugin.openCreateModal('accessory', { linkedItemId: record.id });
        });
      }
    }

    const footer = drawer.createDiv({ cls: 'celtis-ledger-drawer-footer' });
    createCancelButton(footer, () => this.closeDrawer());

    if (record.cover?.trim()) {
      createActionButton(footer, 'copy', '复制原图', async () => {
        try {
          await this.plugin.copyRecordCover(record);
        } catch (error) {
          console.error('物迹账本 could not copy the record cover', error);
          new Notice(error instanceof Error ? error.message : '复制图片失败');
        }
      });
    }
    createActionButton(footer, 'share-2', '分享卡片', () => {
      new ShareImageModal(this.app, this.plugin, { kind: 'record', recordId: record.id }).open();
    });

    if (isArchived(record)) {
      createActionButton(footer, 'archive-restore', '取消归档', () => {
        new RestoreRecordModal(this.app, this.plugin, record, async (clearSaleIncome) => {
          await this.plugin.patchRecord(record.id, (current) => ({
            ...current,
            archiveDate: undefined,
            saleIncome: clearSaleIncome ? undefined : current.saleIncome,
          }), false);
          await this.closeDrawer();
          this.plugin.refreshDataViews();
          const latestName = this.plugin.data.records.find(
            (candidate) => candidate.id === record.id,
          )?.name ?? record.name;
          new Notice(`${latestName} 已恢复为正在使用`);
        }).open();
      });
    } else {
      createActionButton(footer, 'archive', '归档/卖出', () => {
        new ArchiveRecordModal(
          this.app,
          this.plugin,
          record,
          () => this.plugin.data.records,
          async (archiveDate, saleIncome) => {
            await this.plugin.patchRecord(record.id, (current) => ({
              ...current,
              archiveDate,
              saleIncome,
            }), false);
            await this.closeDrawer();
            this.plugin.refreshDataViews();
            const latestName = this.plugin.data.records.find(
              (candidate) => candidate.id === record.id,
            )?.name ?? record.name;
            new Notice(`${latestName} 已归档`);
          },
        ).open();
      });
    }

    const saveButton = createActionButton(footer, 'check', '保存修改', async () => {
      const updated = collectRecordForm(record, form, this.plugin.data.records);
      if (!updated) {
        return;
      }
      if (!form.beginSave(updated.cover)) {
        return;
      }
      saveButton.disabled = true;
      saveButton.setAttr('aria-busy', 'true');
      try {
        await this.plugin.upsertRecord(updated, {
          onPersisted: () => form.finishSave(true),
          refresh: false,
        });
      } catch {
        form.finishSave(false);
        saveButton.disabled = false;
        saveButton.removeAttribute('aria-busy');
        return;
      }
      if (
        this.selectedRecordId === record.id
        && this.drawerOverlay === overlay
      ) {
        await this.closeDrawer();
      }
      this.plugin.refreshDataViews();
      new Notice(`${updated.name} 已保存`);
    }, true);
  }

  private renderDetailMetrics(root: HTMLElement, record: LedgerRecord, now: DayInput): void {
    const metrics = root.createDiv({ cls: 'celtis-ledger-detail-metrics' });
    const base = getRecordCost(record, now, this.plugin.data.records);

    if (record.type === 'item') {
      const cost = getItemCost(record, this.plugin.data.records, now);
      renderDetailMetric(metrics, '整套价值', formatMoney(cost.value));
      renderDetailMetric(metrics, '每日成本', `${formatNumber(cost.daily)} 元`);
      renderDetailMetric(metrics, '使用时间', base.days == null ? '未设置' : `${base.days} 天`);
      renderDetailMetric(metrics, '联动配件', `${getLinkedAccessories(record.id, this.plugin.data.records).length} 个`);
    } else {
      const item = this.plugin.data.records.find((candidate) => candidate.id === record.linkedItemId);
      renderDetailMetric(metrics, '实际花费', formatMoney(base.net));
      renderDetailMetric(metrics, '每日成本', `${formatNumber(base.daily)} 元`);
      renderDetailMetric(metrics, '使用时间', base.days == null ? '未设置' : `${base.days} 天`);
      renderDetailMetric(metrics, '联动物品', item?.name ?? '未关联');
    }
  }
}

class StickerDetailModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: WujiLedgerPlugin,
    private readonly record: LedgerRecord,
    private readonly records: readonly LedgerRecord[],
    private readonly now: DayInput,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.containerEl.addClass('celtis-ledger-sticker-detail-layer');
    this.modalEl.addClass(
      'celtis-asset-ledger-root',
      'celtis-ledger-modal-shell',
      'celtis-ledger-sticker-detail-shell',
    );
    this.plugin.applyColorTheme(this.modalEl);
    this.contentEl.addClass('celtis-ledger-modal', 'celtis-ledger-sticker-detail');

    const model = getStickerDetailModel(this.record, this.records, this.now);
    const hero = this.contentEl.createDiv({ cls: 'celtis-ledger-sticker-detail-hero' });
    const artwork = hero.createDiv({ cls: 'celtis-ledger-sticker-detail-art' });
    renderStickerArtwork(artwork, this.record, this.plugin);
    const copy = hero.createDiv({ cls: 'celtis-ledger-sticker-detail-copy' });
    copy.createEl('h2', {
      cls: 'celtis-ledger-sticker-detail-name',
      text: model.name,
    });
    const facts = copy.createDiv({ cls: 'celtis-ledger-sticker-detail-facts' });
    renderStickerFact(facts, '买入价格', formatMoney(model.purchasePrice));
    renderStickerFact(
      facts,
      '卖出价格',
      model.salePrice == null ? '未卖出' : formatMoney(model.salePrice),
    );
    renderStickerFact(
      facts,
      '使用天数',
      model.days == null ? '未设置日期' : `${model.days} 天`,
    );
  }

  override onClose(): void {
    this.containerEl.removeClass('celtis-ledger-sticker-detail-layer');
    this.contentEl.empty();
  }
}

class ShareImageModal extends Modal {
  private poster?: Blob;
  private posterUrl?: string;
  private posterTitle = '物迹分享图片';
  private posterFileName = '物迹分享图片.png';
  private ledgerScope: LedgerShareScope = 'all';
  private generationVersion = 0;

  constructor(
    app: App,
    private readonly plugin: WujiLedgerPlugin,
    private readonly target: ShareImageTarget,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.containerEl.addClass('celtis-ledger-share-layer');
    this.modalEl.addClass(
      'celtis-asset-ledger-root',
      'celtis-ledger-modal-shell',
      'celtis-ledger-share-shell',
    );
    this.plugin.applyColorTheme(this.modalEl);
    this.contentEl.addClass('celtis-ledger-modal', 'celtis-ledger-share-modal');
    this.modalEl.setAttr(
      'aria-label',
      this.target.kind === 'ledger' ? '分享整本台账' : '分享物迹卡片',
    );

    const stage = this.contentEl.createDiv({ cls: 'celtis-ledger-share-stage' });
    let scopeControl: HTMLElement | undefined;
    if (this.target.kind === 'ledger') {
      scopeControl = stage.createDiv({
        cls: 'celtis-ledger-share-scope',
        attr: { role: 'tablist', 'aria-label': '分享范围' },
      });
    } else {
      stage.addClass('is-record-share');
    }
    const preview = stage.createDiv({
      cls: 'celtis-ledger-share-preview',
      attr: {
        'aria-live': 'polite',
        'aria-busy': 'true',
      },
    });
    const loading = preview.createDiv({ cls: 'celtis-ledger-share-loading' });
    setIcon(loading.createSpan(), 'loader-circle');
    loading.createSpan({ text: '正在排版分享图片…' });

    const caption = this.contentEl.createDiv({
      cls: 'celtis-ledger-share-caption',
      text: this.target.kind === 'ledger' ? '整本台账' : '物迹卡片',
      attr: { 'aria-live': 'polite' },
    });
    const actions = this.contentEl.createDiv({ cls: 'celtis-ledger-share-actions' });
    createCancelButton(actions, () => this.close());
    const copyButton = createActionButton(actions, 'copy', '复制图片', async () => {
      if (!this.poster) {
        return;
      }
      try {
        await copyPngBlob(this.poster);
        new Notice('图片已复制，可以直接粘贴到聊天或笔记中');
      } catch (error) {
        console.error('物迹账本 could not copy the share poster', error);
        new Notice(error instanceof Error ? error.message : '复制图片失败');
      }
    });
    const shareButton = createActionButton(actions, 'share-2', '系统分享', async () => {
      if (!this.poster) {
        return;
      }
      try {
        const result = await sharePngBlob(this.poster, this.posterFileName, this.posterTitle);
        if (result === 'copied') {
          new Notice('当前设备没有系统分享面板，图片已改为复制');
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('物迹账本 could not share the poster', error);
        new Notice(error instanceof Error ? error.message : '分享图片失败');
      }
    }, true);
    copyButton.disabled = true;
    shareButton.disabled = true;

    if (scopeControl) {
      this.renderLedgerScopeControl(scopeControl, () => {
        void this.generatePoster(preview, caption, copyButton, shareButton);
      });
    }

    void this.generatePoster(preview, caption, copyButton, shareButton);
  }

  override onClose(): void {
    this.generationVersion += 1;
    this.containerEl.removeClass('celtis-ledger-share-layer');
    if (this.posterUrl) {
      URL.revokeObjectURL(this.posterUrl);
      this.posterUrl = undefined;
    }
    this.poster = undefined;
    this.contentEl.empty();
  }

  private async generatePoster(
    preview: HTMLElement,
    caption: HTMLElement,
    copyButton: HTMLButtonElement,
    shareButton: HTMLButtonElement,
  ): Promise<void> {
    const generationVersion = ++this.generationVersion;
    this.poster = undefined;
    copyButton.disabled = true;
    shareButton.disabled = true;
    preview.addClass('is-updating');
    preview.setAttr('aria-busy', 'true');
    try {
      const result = this.target.kind === 'ledger'
        ? await this.plugin.createLedgerSharePoster(this.ledgerScope)
        : await this.plugin.createRecordSharePoster(this.target.recordId);
      if (!this.contentEl.isConnected || generationVersion !== this.generationVersion) {
        return;
      }
      this.poster = result.blob;
      this.posterTitle = result.title;
      this.posterFileName = result.fileName;
      caption.setText(result.title);
      if (this.posterUrl) {
        URL.revokeObjectURL(this.posterUrl);
      }
      this.posterUrl = URL.createObjectURL(result.blob);
      preview.empty();
      preview.removeClass('is-error');
      preview.removeClass('is-updating');
      preview.createEl('img', {
        attr: {
          src: this.posterUrl,
          alt: `${result.title} 分享图片预览`,
          draggable: 'false',
        },
      });
      preview.setAttr('aria-busy', 'false');
      copyButton.disabled = false;
      shareButton.disabled = false;
    } catch (error) {
      console.error('物迹账本 could not generate the share poster', error);
      if (!this.contentEl.isConnected || generationVersion !== this.generationVersion) {
        return;
      }
      preview.empty();
      preview.removeClass('is-updating');
      preview.addClass('is-error');
      setIcon(preview.createSpan(), 'image-off');
      preview.createEl('strong', { text: '分享图片生成失败' });
      preview.createEl('p', {
        text: error instanceof Error ? error.message : '请稍后再试',
      });
      caption.setText('');
      preview.setAttr('aria-busy', 'false');
    }
  }

  private renderLedgerScopeControl(root: HTMLElement, onChange: () => void): void {
    const records = this.plugin.data.records;
    const ownedCount = records.filter((record) => !isArchived(record)).length;
    const archivedCount = records.length - ownedCount;
    const options: Array<{
      value: LedgerShareScope;
      label: string;
      icon: string;
      count: number;
    }> = [
      { value: 'all', label: '全部', icon: 'layout-grid', count: records.length },
      { value: 'owned', label: '物品', icon: 'package', count: ownedCount },
      { value: 'archived', label: '归档', icon: 'archive', count: archivedCount },
    ];
    const buttons: HTMLButtonElement[] = [];
    const syncSelection = (): void => {
      for (const button of buttons) {
        const selected = button.dataset.shareScope === this.ledgerScope;
        button.toggleClass('is-active', selected);
        button.setAttr('aria-selected', String(selected));
      }
    };

    for (const option of options) {
      const button = root.createEl('button', {
        cls: this.ledgerScope === option.value
          ? 'celtis-ledger-share-scope-option is-active'
          : 'celtis-ledger-share-scope-option',
        attr: {
          type: 'button',
          role: 'tab',
          'aria-selected': String(this.ledgerScope === option.value),
          'aria-label': `${option.label}，${option.count} 条记录`,
        },
      });
      button.dataset.shareScope = option.value;
      setIcon(button.createSpan({ cls: 'celtis-ledger-share-scope-icon' }), option.icon);
      const copy = button.createSpan({ cls: 'celtis-ledger-share-scope-copy' });
      copy.createSpan({ text: option.label });
      copy.createEl('small', { text: String(option.count) });
      button.addEventListener('click', () => {
        if (this.ledgerScope === option.value) {
          return;
        }
        this.ledgerScope = option.value;
        syncSelection();
        onChange();
      });
      buttons.push(button);
    }
  }
}

class AssetWidgetView extends ItemView {
  private layout: WidgetLayout;
  private theme: WidgetTheme;
  private readonly bloubControllers = new Map<string, BloubAvatarController>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WujiLedgerPlugin) {
    super(leaf);
    this.layout = plugin.data.preferences.widgetLayout;
    this.theme = plugin.data.preferences.widgetTheme;
  }

  override getViewType(): string {
    return WIDGET_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return '资产随身看板';
  }

  override getIcon(): string {
    return 'layout-dashboard';
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  override async onClose(): Promise<void> {
    this.disposeBloubControllers();
    this.contentEl.empty();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('celtis-asset-ledger-root', 'celtis-ledger-widget-root');
    for (const option of WIDGET_THEME_OPTIONS) {
      root.removeClass(`is-theme-${option.id}`);
    }
    for (const option of WIDGET_LAYOUT_OPTIONS) {
      root.removeClass(`is-layout-${option.id}`);
    }
    root.addClass(`is-theme-${this.theme}`, `is-layout-${this.layout}`);

    const shell = root.createDiv({ cls: 'celtis-ledger-widget-shell' });
    this.renderHeader(shell);
    this.renderPreferences(shell);

    const model = getMobileWidgetModel(this.plugin.data.records, todayInShanghai());
    const content = shell.createEl('main', {
      cls: 'celtis-ledger-widget-content',
      attr: { 'aria-live': 'polite' },
    });
    if (model.isEmpty) {
      this.renderEmptyState(content);
    } else if (this.layout === 'glance') {
      this.renderGlance(content, model);
    } else if (this.layout === 'collection') {
      this.renderCollection(content, model.collectionItems);
    } else {
      this.renderOverview(content, model);
    }
    this.renderActions(shell);
  }

  private attachBloub(
    host: HTMLElement,
    slot: string,
    options: {
      tone?: BloubTone;
      shape?: BloubShape;
      decorative?: boolean;
      label?: string;
    } = {},
  ): BloubAvatarController {
    let controller = this.bloubControllers.get(slot);
    if (!controller) {
      controller = this.plugin.createBloubController(slot, options);
      this.bloubControllers.set(slot, controller);
    }
    controller.attach(host);
    return controller;
  }

  private disposeBloubControllers(): void {
    for (const controller of this.bloubControllers.values()) {
      this.plugin.releaseBloubController(controller);
    }
    this.bloubControllers.clear();
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createEl('header', { cls: 'celtis-ledger-widget-header' });
    const brand = header.createDiv({ cls: 'celtis-ledger-widget-brand' });
    const avatarButton = brand.createEl('button', {
      cls: 'celtis-ledger-widget-page-icon',
      attr: {
        type: 'button',
        'aria-label': '随身看板随机动态 Bloub 表情，点击换一个',
        title: '点击换一个表情',
      },
    });
    avatarButton.dataset.bloubInteractive = 'true';
    const avatar = avatarButton.createSpan({
      cls: 'celtis-ledger-widget-page-icon-avatar',
    });
    this.attachBloub(avatar, 'widget-brand', {
      label: '随身看板随机动态 Bloub 表情',
    });
    avatarButton.addEventListener('click', () => this.plugin.rerollBloub('widget-brand'));
    const copy = brand.createDiv();
    copy.createEl('h1', { text: '资产随身看板' });
    copy.createEl('p', { text: `${this.plugin.data.title} · 仅存本地` });

    const full = header.createEl('button', {
      cls: 'celtis-ledger-widget-header-action',
      attr: {
        type: 'button',
        'aria-label': '打开完整资产台账',
        title: '完整台账',
      },
    });
    setIcon(full.createSpan(), 'expand');
    full.createSpan({ text: '完整台账' });
    full.addEventListener('click', () => {
      void this.plugin.activateView().catch((error) => {
        console.error('物迹账本 could not open its full view', error);
      });
    });
  }

  private renderPreferences(root: HTMLElement): void {
    const preferences = root.createDiv({ cls: 'celtis-ledger-widget-preferences' });
    this.renderChoiceGroup(
      preferences,
      '内容',
      WIDGET_LAYOUT_OPTIONS,
      this.layout,
      (layout) => this.selectLayout(layout),
    );
    this.renderChoiceGroup(
      preferences,
      '风格',
      WIDGET_THEME_OPTIONS,
      this.theme,
      (theme) => this.selectTheme(theme),
    );
  }

  private renderChoiceGroup<T extends string>(
    root: HTMLElement,
    label: string,
    options: readonly {
      id: T;
      label: string;
      icon: string;
      description: string;
    }[],
    selected: T,
    onSelect: (value: T) => void,
  ): void {
    const group = root.createDiv({ cls: 'celtis-ledger-widget-choice-group' });
    group.createSpan({ cls: 'celtis-ledger-widget-choice-label', text: label });
    const choices = group.createDiv({
      cls: 'celtis-ledger-widget-choices',
      attr: { role: 'group', 'aria-label': `${label}选择` },
    });
    for (const option of options) {
      const button = choices.createEl('button', {
        cls: option.id === selected
          ? 'celtis-ledger-widget-choice is-selected'
          : 'celtis-ledger-widget-choice',
        attr: {
          type: 'button',
          'aria-pressed': String(option.id === selected),
          'aria-label': `${option.label}：${option.description}`,
          title: option.description,
        },
      });
      setIcon(button.createSpan(), option.icon);
      button.createSpan({ text: option.label });
      button.addEventListener('click', () => onSelect(option.id));
    }
  }

  private selectLayout(layout: WidgetLayout): void {
    if (layout === this.layout) {
      return;
    }
    const previous = this.layout;
    this.layout = layout;
    this.render();
    void this.plugin.updatePreferences({ widgetLayout: layout }, false).catch((error) => {
      console.error('物迹账本 could not save its widget layout', error);
      this.layout = previous;
      this.render();
      new Notice('随身看板布局保存失败，已恢复原设置。');
    });
  }

  private selectTheme(theme: WidgetTheme): void {
    if (theme === this.theme) {
      return;
    }
    const previous = this.theme;
    this.theme = theme;
    this.render();
    void this.plugin.updatePreferences({ widgetTheme: theme }, false).catch((error) => {
      console.error('物迹账本 could not save its widget theme', error);
      this.theme = previous;
      this.render();
      new Notice('随身看板风格保存失败，已恢复原设置。');
    });
  }

  private renderEmptyState(root: HTMLElement): void {
    const empty = root.createDiv({ cls: 'celtis-ledger-widget-empty' });
    const icon = empty.createSpan({ cls: 'celtis-ledger-widget-empty-icon' });
    setIcon(icon, 'package-plus');
    empty.createEl('h2', { text: '从第一件小玩意开始' });
    empty.createEl('p', {
      text: '记录购买日期和费用后，随身看板会自动计算每日成本、资产总值和最近购买。',
    });
    const start = empty.createEl('button', {
      cls: 'celtis-ledger-widget-primary-action',
      attr: { type: 'button' },
    });
    setIcon(start.createSpan(), 'plus');
    start.createSpan({ text: '添加第一件物品' });
    start.addEventListener('click', () => this.plugin.openCreateModal('item'));
  }

  private renderGlance(
    root: HTMLElement,
    model: ReturnType<typeof getMobileWidgetModel>,
  ): void {
    const hero = this.renderHero(root, model.summary.activeDaily, model.summary.activeValue);
    hero.addClass('is-glance');
    const strip = root.createDiv({ cls: 'celtis-ledger-widget-glance-strip' });
    this.renderCompactMetric(strip, '正在使用', `${model.summary.activeItems} 件`, 'sparkles');
    this.renderCompactMetric(strip, '已经归档', `${model.summary.archivedItems} 件`, 'archive');
  }

  private renderOverview(
    root: HTMLElement,
    model: ReturnType<typeof getMobileWidgetModel>,
  ): void {
    this.renderHero(root, model.summary.activeDaily, model.summary.activeValue);
    const metrics = root.createDiv({ cls: 'celtis-ledger-widget-metric-grid' });
    this.renderCompactMetric(metrics, '正在使用', `${model.summary.activeItems} 件`, 'sparkles');
    this.renderCompactMetric(metrics, '在用总值', formatMoney(model.summary.activeValue), 'wallet-cards');
    this.renderCompactMetric(metrics, '已归档', formatMoney(model.summary.archivedValue), 'archive');

    const highlights = root.createDiv({ cls: 'celtis-ledger-widget-highlights' });
    if (model.highestDailyCost) {
      this.renderHighlight(
        highlights,
        '日成本最高',
        model.highestDailyCost,
        `${formatNumber(model.highestDailyCost.daily)} 元/天`,
        'gauge',
      );
    }
    if (model.recentPurchase) {
      this.renderHighlight(
        highlights,
        '最近购买',
        model.recentPurchase,
        formatDate(model.recentPurchase.purchaseDate!),
        'clock-3',
      );
    }
  }

  private renderHero(root: HTMLElement, daily: number, value: number): HTMLElement {
    const hero = root.createDiv({ cls: 'celtis-ledger-widget-hero' });
    const eyebrow = hero.createDiv({ cls: 'celtis-ledger-widget-eyebrow' });
    setIcon(eyebrow.createSpan(), 'sparkles');
    eyebrow.createSpan({ text: '今天的一瞥' });
    hero.createEl('small', { text: '正在使用 · 每日成本' });
    hero.createEl('strong', { text: `${formatNumber(daily)} 元/天` });
    const valueLine = hero.createDiv({ cls: 'celtis-ledger-widget-hero-value' });
    valueLine.createSpan({ text: '在用总值' });
    valueLine.createEl('b', { text: formatMoney(value) });
    const art = hero.createDiv({ cls: 'celtis-ledger-widget-hero-art' });
    this.attachBloub(art, 'widget-hero', {
      tone: 'primary',
      decorative: true,
    });
    return hero;
  }

  private renderCompactMetric(
    root: HTMLElement,
    label: string,
    value: string,
    icon: string,
  ): void {
    const metric = root.createDiv({ cls: 'celtis-ledger-widget-metric' });
    const iconEl = metric.createSpan({ cls: 'celtis-ledger-widget-metric-icon' });
    setIcon(iconEl, icon);
    const copy = metric.createDiv();
    copy.createSpan({ text: label });
    copy.createEl('strong', { text: value });
  }

  private renderHighlight(
    root: HTMLElement,
    label: string,
    item: MobileWidgetItem,
    value: string,
    icon: string,
  ): void {
    const card = root.createEl('button', {
      cls: 'celtis-ledger-widget-highlight',
      attr: { type: 'button', 'aria-label': `打开 ${item.name}` },
    });
    const leading = card.createSpan({ cls: 'celtis-ledger-widget-highlight-icon' });
    setIcon(leading, icon);
    const copy = card.createDiv();
    copy.createSpan({ text: label });
    copy.createEl('strong', { text: item.name });
    card.createEl('b', { text: value });
    const arrow = card.createSpan({ cls: 'celtis-ledger-widget-highlight-arrow' });
    setIcon(arrow, 'chevron-right');
    card.addEventListener('click', () => {
      void this.plugin.activateRecord(item.id).catch((error) => {
        console.error('物迹账本 could not open a highlighted item', error);
      });
    });
  }

  private renderCollection(root: HTMLElement, items: readonly MobileWidgetItem[]): void {
    const heading = root.createDiv({ cls: 'celtis-ledger-widget-collection-heading' });
    const copy = heading.createDiv();
    copy.createEl('h2', { text: '我的收藏' });
    copy.createEl('p', { text: '按整套价值展示前 5 件正在使用的物品' });
    heading.createSpan({ text: `${items.length} 件` });

    const grid = root.createDiv({ cls: 'celtis-ledger-widget-collection' });
    for (const item of items) {
      const card = grid.createEl('button', {
        cls: 'celtis-ledger-widget-collection-card',
        attr: { type: 'button', 'aria-label': `打开 ${item.name}` },
      });
      this.renderCollectionCover(card, item);
      const details = card.createDiv({ cls: 'celtis-ledger-widget-collection-copy' });
      details.createEl('strong', { text: item.name });
      details.createSpan({ text: `${formatNumber(item.daily)} 元/天` });
      if (item.accessoryCount > 0) {
        details.createEl('small', { text: `${item.accessoryCount} 个配件` });
      }
      card.addEventListener('click', () => {
        void this.plugin.activateRecord(item.id).catch((error) => {
          console.error('物迹账本 could not open a collection item', error);
        });
      });
    }
  }

  private renderCollectionCover(root: HTMLElement, item: MobileWidgetItem): void {
    const cover = root.createSpan({ cls: 'celtis-ledger-widget-collection-cover' });
    const fallback = cover.createSpan();
    setIcon(fallback, 'package');
    if (!item.cover) {
      return;
    }
    cover.toggleClass('is-sticker', isGeneratedStickerPath(item.cover));
    const image = cover.createEl('img', {
      cls: 'is-pending',
      attr: { alt: '', loading: 'lazy', draggable: 'false' },
    });
    const reveal = (): void => {
      if (cover.hasClass('is-sticker')) {
        cover.dataset.stickerShape = getStickerShape(image.naturalWidth, image.naturalHeight);
      }
      image.removeClass('is-pending');
      fallback.hidden = true;
    };
    image.addEventListener('load', reveal);
    image.addEventListener('error', () => image.remove());
    image.src = this.plugin.getAssetUrl(item.cover);
    if (image.complete && image.naturalWidth > 0) {
      reveal();
    }
  }

  private renderActions(root: HTMLElement): void {
    const actions = root.createDiv({ cls: 'celtis-ledger-widget-actions' });
    const addItem = actions.createEl('button', {
      cls: 'celtis-ledger-widget-primary-action',
      attr: { type: 'button' },
    });
    setIcon(addItem.createSpan(), 'plus');
    addItem.createSpan({ text: '添加物品' });
    addItem.addEventListener('click', () => this.plugin.openCreateModal('item'));

    const addAccessory = actions.createEl('button', {
      cls: 'celtis-ledger-widget-secondary-action',
      attr: { type: 'button' },
    });
    setIcon(addAccessory.createSpan(), 'wrench');
    addAccessory.createSpan({ text: '添加配件' });
    addAccessory.addEventListener('click', () => this.plugin.openCreateModal('accessory'));

    const summary = actions.createEl('button', {
      cls: 'celtis-ledger-widget-secondary-action is-summary',
      attr: { type: 'button' },
    });
    setIcon(summary.createSpan(), 'file-text');
    summary.createSpan({ text: '手机摘要' });
    summary.addEventListener('click', () => {
      void this.plugin.updateMobileSummary(true).catch((error) => {
        console.error('物迹账本 could not update its mobile summary', error);
      });
    });
  }
}

class BloubShapePickerModal extends Modal {
  private readonly shapePreviews: Array<{
    host: HTMLElement;
    shape: PageAvatarShape;
    index: number;
    controller?: BloubAvatarController;
  }> = [];
  private draftPreviewHost?: HTMLElement;
  private draftPreviewController?: BloubAvatarController;
  private selectedShape: PageAvatarShape;
  private selectedTone: PageAvatarTone;
  private saving = false;

  constructor(
    app: App,
    private readonly plugin: WujiLedgerPlugin,
  ) {
    super(app);
    this.selectedShape = plugin.data.preferences.pageAvatarShape;
    this.selectedTone = plugin.data.preferences.pageAvatarTone;
  }

  override onOpen(): void {
    this.modalEl.addClass(
      'celtis-asset-ledger-root',
      'celtis-ledger-modal-shell',
      'celtis-ledger-shape-modal-shell',
    );
    this.plugin.applyColorTheme(this.modalEl);
    this.contentEl.addClass('celtis-ledger-modal', 'celtis-ledger-shape-modal');
    this.contentEl.createEl('h2', { text: '定制头像' });
    this.contentEl.createEl('p', {
      cls: 'celtis-ledger-field-help',
      text: '点击页面上的大头像只会更换表情和动作；颜色与形状只在这里修改。',
    });

    const previewPanel = this.contentEl.createDiv({ cls: 'celtis-ledger-avatar-preview-panel' });
    this.draftPreviewHost = previewPanel.createSpan({
      cls: 'celtis-ledger-avatar-preview',
      attr: { 'aria-hidden': 'true' },
    });
    const previewCopy = previewPanel.createDiv({ cls: 'celtis-ledger-avatar-preview-copy' });
    previewCopy.createEl('strong', { text: '头像预览' });
    previewCopy.createSpan({ text: '保存后会同步到台账左上角' });
    this.refreshDraftPreview();

    this.contentEl.createEl('h3', {
      cls: 'celtis-ledger-avatar-option-title',
      text: '颜色',
    });
    const toneGrid = this.contentEl.createDiv({
      cls: 'celtis-ledger-tone-grid',
      attr: { role: 'listbox', 'aria-label': '头像颜色' },
    });
    for (const option of BLOUB_TONE_OPTIONS) {
      const selected = option.id === this.selectedTone;
      const button = toneGrid.createEl('button', {
        cls: selected
          ? 'celtis-ledger-tone-option is-selected'
          : 'celtis-ledger-tone-option',
        attr: {
          type: 'button',
          role: 'option',
          'aria-label': `${option.label}，${option.description}`,
          'aria-selected': String(selected),
        },
      });
      button.dataset.tone = option.id;
      button.createSpan({
        cls: `celtis-ledger-tone-swatch is-${option.id}`,
        attr: { 'aria-hidden': 'true' },
      });
      const label = button.createSpan({ cls: 'celtis-ledger-tone-label' });
      label.createEl('strong', { text: option.label });
      label.createSpan({ text: option.description });
      const check = button.createSpan({ cls: 'celtis-ledger-tone-check' });
      setIcon(check, 'check');
      button.addEventListener('click', () => {
        if (this.saving) {
          return;
        }
        this.selectedTone = option.id;
        this.updateSelectedOptions(toneGrid, 'tone', option.id);
        this.refreshDraftPreview();
        this.refreshShapePreviews();
      });
    }

    this.contentEl.createEl('h3', {
      cls: 'celtis-ledger-avatar-option-title',
      text: '形状',
    });
    const shapeGrid = this.contentEl.createDiv({
      cls: 'celtis-ledger-shape-grid',
      attr: { role: 'listbox', 'aria-label': '头像形状' },
    });

    for (const [index, option] of BLOUB_SHAPE_OPTIONS.entries()) {
      const selected = option.id === this.selectedShape;
      const button = shapeGrid.createEl('button', {
        cls: selected
          ? 'celtis-ledger-shape-option is-selected'
          : 'celtis-ledger-shape-option',
        attr: {
          type: 'button',
          role: 'option',
          'aria-label': option.label,
          'aria-selected': String(selected),
        },
      });
      button.dataset.shape = option.id;
      const preview = button.createSpan({ cls: 'celtis-ledger-shape-preview' });
      this.shapePreviews.push({ host: preview, shape: option.id, index });

      const label = button.createSpan({ cls: 'celtis-ledger-shape-label' });
      label.createSpan({ text: option.label });
      const check = label.createSpan({ cls: 'celtis-ledger-shape-check' });
      setIcon(check, 'check');

      button.addEventListener('click', () => {
        if (this.saving) {
          return;
        }
        this.selectedShape = option.id;
        this.updateSelectedOptions(shapeGrid, 'shape', option.id);
        this.refreshDraftPreview();
      });
    }
    this.refreshShapePreviews();

    const actions = this.contentEl.createDiv({ cls: 'celtis-ledger-modal-actions' });
    createCancelButton(actions, () => this.close());
    createActionButton(actions, 'check', '保存头像', async () => {
      await this.saveAppearance(actions);
    }, true);
  }

  override onClose(): void {
    this.draftPreviewController?.dispose();
    this.draftPreviewController = undefined;
    for (const preview of this.shapePreviews) {
      preview.controller?.dispose();
    }
    this.shapePreviews.length = 0;
    this.contentEl.empty();
  }

  private refreshDraftPreview(): void {
    if (!this.draftPreviewHost) {
      return;
    }
    this.draftPreviewController?.dispose();
    this.draftPreviewController = createBloubAvatar({
      seed: 0x51f15e,
      epochMs: Date.now() - 1_700,
      tone: this.selectedTone,
      shape: this.selectedShape,
      decorative: true,
    });
    this.draftPreviewController.attach(this.draftPreviewHost);
  }

  private refreshShapePreviews(): void {
    for (const preview of this.shapePreviews) {
      preview.controller?.dispose();
      preview.controller = createBloubAvatar({
        seed: 0x51f15e,
        epochMs: Date.now() - 1_700 - preview.index * 90,
        tone: this.selectedTone,
        shape: preview.shape,
        decorative: true,
      });
      preview.controller.attach(preview.host);
    }
  }

  private updateSelectedOptions(
    grid: HTMLElement,
    dataKey: 'shape' | 'tone',
    value: string,
  ): void {
    for (const option of grid.querySelectorAll<HTMLButtonElement>('button')) {
      const selected = option.dataset[dataKey] === value;
      option.classList.toggle('is-selected', selected);
      option.setAttr('aria-selected', String(selected));
    }
  }

  private async saveAppearance(actions: HTMLElement): Promise<void> {
    if (this.saving) {
      return;
    }
    const shapeChanged = this.selectedShape !== this.plugin.data.preferences.pageAvatarShape;
    const toneChanged = this.selectedTone !== this.plugin.data.preferences.pageAvatarTone;
    if (!shapeChanged && !toneChanged) {
      this.close();
      return;
    }

    this.saving = true;
    setActionGroupBusy(actions, true);
    try {
      await this.plugin.updatePreferences({
        pageAvatarShape: this.selectedShape,
        pageAvatarTone: this.selectedTone,
      }, true);
      this.close();
    } catch (error) {
      console.error('物迹账本 could not save the avatar appearance', error);
      new Notice('头像样式保存失败，请重试');
      this.saving = false;
      setActionGroupBusy(actions, false);
    }
  }
}

class ExistingCoverPickerModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: WujiLedgerPlugin,
    private readonly onSelect: (path: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass(
      'celtis-asset-ledger-root',
      'celtis-ledger-modal-shell',
      'celtis-ledger-cover-library-shell',
    );
    this.plugin.applyColorTheme(this.modalEl);
    this.contentEl.addClass('celtis-ledger-modal', 'celtis-ledger-cover-library');
    this.contentEl.createEl('h2', { text: '从台账中选择封面' });
    this.contentEl.createEl('p', {
      cls: 'celtis-ledger-field-help',
      text: '直接复用已有图片，不会重复占用 iCloud 空间。',
    });

    const options = getReusableCoverOptions(this.plugin.data.records);
    if (options.length === 0) {
      const empty = this.contentEl.createDiv({ cls: 'celtis-ledger-cover-library-empty' });
      const icon = empty.createSpan();
      setIcon(icon, 'images');
      empty.createEl('strong', { text: '还没有可复用的封面' });
      empty.createSpan({ text: '先给任意物品添加一张图片即可。' });
      return;
    }

    const grid = this.contentEl.createDiv({
      cls: 'celtis-ledger-cover-library-grid',
      attr: { role: 'list', 'aria-label': '已有封面图片' },
    });
    for (const option of options) {
      this.renderOption(grid, option);
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private renderOption(root: HTMLElement, option: ReusableCoverOption): void {
    const button = root.createEl('button', {
      cls: option.isSticker
        ? 'celtis-ledger-cover-library-option is-sticker'
        : 'celtis-ledger-cover-library-option',
      attr: {
        type: 'button',
        role: 'listitem',
        'aria-label': `复用 ${option.recordNames.join('、')} 的封面`,
      },
    });
    const thumbnail = button.createSpan({ cls: 'celtis-ledger-cover-library-thumbnail' });
    const fallback = thumbnail.createSpan({ cls: 'celtis-ledger-cover-library-fallback' });
    setIcon(fallback, option.isSticker ? 'sparkles' : 'image');
    const image = thumbnail.createEl('img', {
      attr: { alt: '', loading: 'lazy', draggable: 'false' },
    });
    image.addEventListener('load', () => {
      fallback.hidden = true;
      button.removeClass('is-image-error');
    });
    image.addEventListener('error', () => {
      image.remove();
      button.addClass('is-image-error');
      fallback.hidden = false;
      setIcon(fallback, 'image-off');
    });
    image.src = this.plugin.getAssetUrl(option.path);

    const copy = button.createSpan({ cls: 'celtis-ledger-cover-library-copy' });
    copy.createEl('strong', { text: option.recordNames[0] ?? '已有封面' });
    const reusedBy = option.recordCount > 1
      ? `${option.recordCount} 条记录共用`
      : option.isSticker
        ? '本地贴纸'
        : /^https?:\/\//i.test(option.path)
          ? '网络图片'
          : '本地图片';
    copy.createSpan({ text: reusedBy });

    const check = button.createSpan({ cls: 'celtis-ledger-cover-library-check' });
    setIcon(check, 'check');
    button.addEventListener('click', () => {
      this.onSelect(option.path);
      this.close();
    });
  }
}

export class RecordEditorModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: WujiLedgerPlugin,
    private readonly type: LedgerRecordType,
    private readonly options: CreateRecordOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass(
      'celtis-asset-ledger-root',
      'celtis-ledger-modal-shell',
      'is-record-editor',
    );
    this.plugin.applyColorTheme(this.modalEl);
    this.contentEl.addClass('celtis-ledger-modal');
    this.contentEl.createEl('h2', {
      text: this.type === 'item' ? '添加物品' : '添加配件',
    });
    this.contentEl.createEl('p', {
      cls: 'celtis-ledger-field-help',
      text: this.type === 'item'
        ? '先记录购买信息；日成本会从购买当天开始自动计算。'
        : '配件可关联到一件物品，也可以暂时保持未关联。',
    });

    const items = this.plugin.data.records.filter(
      (record) => record.type === 'item' && !isArchived(record),
    );
    const linkedItem = this.type === 'accessory'
      ? items.find((record) => record.id === this.options.linkedItemId)
      : undefined;
    const draft: LedgerRecord = {
      id: createRecordId(this.type),
      type: this.type,
      name: this.options.droppedImage?.name ?? '',
      purchaseDate: this.type === 'item' ? todayInShanghai() : undefined,
      purchaseCost: 0,
      linkedItemId: linkedItem?.id,
      cover: this.options.droppedImage?.kind === 'url' ? this.options.droppedImage.url : undefined,
    };
    const form = renderRecordFields(this.contentEl, draft, items, this.plugin, {
      explainAccessoryDateInheritance: this.type === 'accessory',
      autoStickerFromRemoteOnSave: this.type === 'item',
    });
    if (this.options.droppedImage?.kind === 'file') {
      // The form owns the temporary file, so cancel/import failure uses the same cleanup as paste.
      void form.importImage(this.options.droppedImage.file);
    }

    let autoInheritedPurchaseDate: string | undefined;
    let applyingInheritedPurchaseDate = false;
    if (this.type === 'accessory' && form.linkedItemId) {
      const syncInheritedPurchaseDate = (): void => {
        const current = form.purchaseDate.value;
        if (current && current !== autoInheritedPurchaseDate) {
          return;
        }

        const linkedItemId = form.linkedItemId?.value || undefined;
        const next = resolvePurchaseDateForSave(
          'create',
          { ...draft, purchaseDate: undefined, linkedItemId },
          items,
        );
        applyingInheritedPurchaseDate = true;
        autoInheritedPurchaseDate = next;
        form.purchaseDate.setValue(next ?? '');
        applyingInheritedPurchaseDate = false;
      };

      form.purchaseDate.input.addEventListener('change', () => {
        if (!applyingInheritedPurchaseDate) {
          autoInheritedPurchaseDate = undefined;
        }
      });
      form.linkedItemId.addEventListener('change', syncInheritedPurchaseDate);
      syncInheritedPurchaseDate();
    }

    const actions = this.contentEl.createDiv({ cls: 'celtis-ledger-modal-actions' });
    createCancelButton(actions, () => this.close());
    let submitting = false;
    const saveButton = createActionButton(
      actions,
      'plus',
      this.type === 'item' ? '添加物品' : '添加配件',
      async () => {
        if (submitting) {
          return;
        }
        const currentRecords = this.plugin.data.records;
        const shouldUseInheritedPurchaseDate = this.type === 'accessory'
          && (!form.purchaseDate.value || form.purchaseDate.value === autoInheritedPurchaseDate);
        if (this.type === 'accessory') {
          const linkedItemId = form.linkedItemId?.value || undefined;
          const currentLinkedItem = linkedItemId
            ? currentRecords.find(
              (candidate) => candidate.id === linkedItemId
                && candidate.type === 'item'
                && !isArchived(candidate),
            )
            : undefined;
          if (linkedItemId && !currentLinkedItem) {
            new Notice('联动物品已发生变化，请重新打开表单后再选择');
            return;
          }

          if (shouldUseInheritedPurchaseDate) {
            const inherited = resolvePurchaseDateForSave(
              'create',
              { ...draft, purchaseDate: undefined, linkedItemId },
              currentRecords,
            );
            applyingInheritedPurchaseDate = true;
            autoInheritedPurchaseDate = inherited;
            form.purchaseDate.setValue(inherited ?? '');
            applyingInheritedPurchaseDate = false;
          }
        }
        let record = collectRecordForm(draft, form, currentRecords);
        if (!record) {
          return;
        }
        submitting = true;
        saveButton.disabled = true;
        saveButton.setAttr('aria-busy', 'true');

        if (this.type === 'item' && /^https?:\/\//i.test(record.cover?.trim() ?? '')) {
          const preparation = await form.prepareRemoteCoverSticker();
          if (
            preparation === 'cancelled'
            || preparation === 'changed'
            || preparation === 'busy'
          ) {
            submitting = false;
            saveButton.disabled = false;
            saveButton.removeAttribute('aria-busy');
            return;
          }

          record = collectRecordForm(draft, form, this.plugin.data.records);
          if (!record) {
            submitting = false;
            saveButton.disabled = false;
            saveButton.removeAttribute('aria-busy');
            return;
          }
        }

        if (!form.beginSave(record.cover)) {
          submitting = false;
          saveButton.disabled = false;
          saveButton.removeAttribute('aria-busy');
          return;
        }
        try {
          await this.plugin.upsertRecord(record, {
            onPersisted: () => form.finishSave(true),
            refreshInheritedPurchaseDate: shouldUseInheritedPurchaseDate,
            requireActiveLinkedItem: this.type === 'accessory',
          });
        } catch {
          form.finishSave(false);
          submitting = false;
          saveButton.disabled = false;
          saveButton.removeAttribute('aria-busy');
          return;
        }
        await closeModalAfterConfirm(this);
        await this.plugin.activateView();
        new Notice(`${record.name} 已添加`);
      },
      true,
    );

    window.requestAnimationFrame(() => {
      this.contentEl.scrollTop = 0;
      form.name.focus({ preventScroll: true });
      if (this.options.droppedImage) form.name.select();
    });
  }

  override onClose(): void {
    disposeRecordForms(this.contentEl);
    disposeDateControls(this.contentEl);
    this.contentEl.empty();
  }
}

export class ArchiveRecordModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: WujiLedgerPlugin,
    private readonly record: LedgerRecord,
    private readonly getRecords: () => readonly LedgerRecord[],
    private readonly onConfirm: (archiveDate: string, saleIncome?: number) => Promise<void>,
    private readonly afterConfirm?: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass('celtis-asset-ledger-root', 'celtis-ledger-modal-shell', 'is-compact', 'is-quick-archive');
    this.plugin.applyColorTheme(this.modalEl);
    this.contentEl.addClass('celtis-ledger-modal');
    const hero = this.contentEl.createDiv({ cls: 'celtis-ledger-quick-archive-hero' });
    renderStickerArtwork(hero.createDiv({ cls: 'celtis-ledger-quick-archive-art' }), this.record, this.plugin);
    const heading = hero.createDiv();
    heading.createSpan({ cls: 'celtis-ledger-quick-archive-eyebrow', text: '快捷归档' });
    heading.createEl('h2', { text: this.record.name });
    heading.createSpan({ cls: 'celtis-ledger-field-help', text: `买入 ${formatMoney(this.record.purchaseCost)}` });

    const saleField = createField(this.contentEl, '卖出价格');
    const sale = saleField.createEl('input', {
      cls: 'celtis-ledger-quick-archive-price',
      attr: { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', placeholder: '¥  没有卖出可留空', 'aria-label': '卖出价格' },
    });
    sale.value = this.record.saleIncome == null ? '' : String(this.record.saleIncome);

    const dateField = createField(this.contentEl, '归档日期', true);
    const date = createDateControl(dateField, {
      label: '归档日期',
      value: todayInShanghai(),
      allowClear: false,
    });
    const estimate = this.contentEl.createDiv({ cls: 'celtis-ledger-quick-archive-estimate', attr: { 'aria-live': 'polite' } });
    const errorMessage = this.contentEl.createDiv({ cls: 'celtis-ledger-quick-archive-error', attr: { role: 'alert' } });
    errorMessage.hidden = true;
    const updateEstimate = (): void => {
      estimate.empty();
      try {
        const records = this.getRecords();
        const current = records.find((candidate) => candidate.id === this.record.id);
        if (!current) throw new Error('记录已不存在，请关闭窗口');
        if (sale.validity.badInput) throw new Error('请输入有效的卖出价格');
        const preview = applyArchiveDraft(current, records, { archiveDate: date.value, saleIncome: sale.value });
        const cost = getRecordCost(preview, date.value, records);
        renderMetricRow(estimate, current.type === 'item' ? '本体实际花费' : '实际花费', formatMoney(cost.net), 'celtis-ledger-item-metric');
        renderMetricRow(estimate, '使用天数', cost.days == null ? '未设置购买日期' : `${cost.days} 天`, 'celtis-ledger-item-metric');
        errorMessage.hidden = true;
      } catch (error) {
        errorMessage.setText(error instanceof Error ? error.message : '请检查归档信息');
        errorMessage.hidden = false;
      }
    };
    sale.addEventListener('input', updateEstimate);
    date.input.addEventListener('change', updateEstimate);
    updateEstimate();
    const accessoryCount = this.record.type === 'item' ? getLinkedAccessories(this.record.id, this.getRecords()).length : 0;
    this.contentEl.createEl('p', {
      cls: 'celtis-ledger-field-help celtis-ledger-quick-archive-help',
      text: accessoryCount > 0
        ? `仅归档这件物品，${accessoryCount} 个关联配件保留现有状态。归档后仍可查看或恢复。`
        : '归档后仍可查看或恢复；未卖出时，价格可以留空。',
    });

    const actions = this.contentEl.createDiv({ cls: 'celtis-ledger-modal-actions' });
    let submitting = false;
    createCancelButton(actions, () => this.close());
    const confirm = createActionButton(actions, 'archive', '确认归档', async () => {
      if (submitting) {
        return;
      }
      const records = this.getRecords();
      try {
        const current = records.find((candidate) => candidate.id === this.record.id);
        if (!current) throw new Error('记录已不存在，请关闭窗口');
        if (sale.validity.badInput) throw new Error('请输入有效的卖出价格');
        const archived = applyArchiveDraft(current, records, { archiveDate: date.value, saleIncome: sale.value });
        submitting = true;
        sale.disabled = true;
        setActionGroupBusy(this.contentEl, true);
        errorMessage.hidden = true;
        await this.onConfirm(archived.archiveDate!, archived.saleIncome);
        await closeModalAfterConfirm(this);
        this.afterConfirm?.();
      } catch (error) {
        submitting = false;
        sale.disabled = false;
        setActionGroupBusy(this.contentEl, false);
        errorMessage.setText(error instanceof Error ? error.message : '保存失败，请重试');
        errorMessage.hidden = false;
      }
    }, true);
    sale.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        confirm.click();
      }
    });
    this.contentEl.ownerDocument.defaultView?.requestAnimationFrame(() => {
      if (sale.isConnected) {
        sale.focus({ preventScroll: true });
        sale.select();
      }
    });
  }

  override onClose(): void {
    disposeRecordForms(this.contentEl);
    disposeDateControls(this.contentEl);
    this.contentEl.empty();
  }
}

class RestoreRecordModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: WujiLedgerPlugin,
    private readonly record: LedgerRecord,
    private readonly onConfirm: (clearSaleIncome: boolean) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass('celtis-asset-ledger-root', 'celtis-ledger-modal-shell', 'is-compact');
    this.plugin.applyColorTheme(this.modalEl);
    this.contentEl.addClass('celtis-ledger-modal');
    this.contentEl.createEl('h2', { text: `取消归档 ${this.record.name}` });
    this.contentEl.createEl('p', {
      cls: 'celtis-ledger-field-help',
      text: this.record.saleIncome
        ? `这条记录仍有 ${formatMoney(this.record.saleIncome)} 卖出收入。你可以保留交易数据，或恢复时一并清空。`
        : '记录会恢复为正在使用，购买信息保持不变。',
    });

    const actions = this.contentEl.createDiv({ cls: 'celtis-ledger-modal-actions' });
    let submitting = false;
    createCancelButton(actions, () => this.close());
    const restore = async (clearSaleIncome: boolean): Promise<void> => {
      if (submitting) {
        return;
      }
      submitting = true;
      setActionGroupBusy(actions, true);
      try {
        await this.onConfirm(clearSaleIncome);
        await closeModalAfterConfirm(this);
      } catch (error) {
        submitting = false;
        setActionGroupBusy(actions, false);
        throw error;
      }
    };
    if (this.record.saleIncome) {
      createActionButton(actions, 'eraser', '恢复并清空卖出收入', () => restore(true));
    }
    createActionButton(actions, 'archive-restore', '仅恢复状态', () => restore(false), true);
  }

  override onClose(): void {
    disposeRecordForms(this.contentEl);
    disposeDateControls(this.contentEl);
    this.contentEl.empty();
  }
}

function renderRecordFields(
  root: HTMLElement,
  record: LedgerRecord,
  items: LedgerRecord[],
  plugin: WujiLedgerPlugin,
  options: RecordFormOptions = {},
): RecordFormRefs {
  const form = root.createDiv({ cls: 'celtis-ledger-form-grid' });

  const nameField = createField(form, record.type === 'item' ? '物品名称' : '配件名称', true);
  nameField.addClass('is-wide');
  const name = nameField.createEl('input', {
    attr: { type: 'text', value: record.name, placeholder: '例如：Mac Studio M4 Max' },
  });

  const purchaseDateField = createField(form, '购买日期');
  const purchaseDate = createDateControl(purchaseDateField, {
    label: '购买日期',
    value: record.purchaseDate,
  });
  let inheritedDateHelp: HTMLElement | undefined;
  if (record.type === 'accessory' && options.explainAccessoryDateInheritance) {
    purchaseDateField.createSpan({
      cls: 'celtis-ledger-field-help',
      text: '留空时，会采用联动物品的购买日期。',
    });
  } else if (record.type === 'accessory') {
    inheritedDateHelp = purchaseDateField.createSpan({
      cls: 'celtis-ledger-field-help',
    });
  }

  const purchaseCostField = createField(form, '买入费用', true);
  const purchaseCost = purchaseCostField.createEl('input', {
    attr: {
      type: 'number',
      min: '0',
      step: '0.01',
      value: String(record.purchaseCost),
      inputmode: 'decimal',
    },
  });

  const saleIncomeField = createField(form, '卖出收入');
  const saleIncome = saleIncomeField.createEl('input', {
    attr: {
      type: 'number',
      min: '0',
      step: '0.01',
      value: record.saleIncome == null ? '' : String(record.saleIncome),
      placeholder: '未出售可留空',
      inputmode: 'decimal',
    },
  });

  const archiveDateField = createField(form, '归档日期');
  const archiveDate = createDateControl(archiveDateField, {
    label: '归档日期',
    value: record.archiveDate,
  });

  let linkedItemId: HTMLSelectElement | undefined;
  if (record.type === 'accessory') {
    const linkedField = createField(form, '联动物品');
    linkedItemId = linkedField.createEl('select', { attr: { 'aria-label': '选择联动物品' } });
    linkedItemId.createEl('option', { attr: { value: '' }, text: '未关联物品' });
    for (const item of items) {
      linkedItemId.createEl('option', {
        attr: { value: item.id },
        text: isArchived(item) ? `${item.name}（已归档）` : item.name,
      });
    }
    if (record.linkedItemId && !items.some((item) => item.id === record.linkedItemId)) {
      linkedItemId.createEl('option', {
        attr: { value: record.linkedItemId },
        text: '原联动物品已不存在（保留关联）',
      });
    }
    linkedItemId.value = record.linkedItemId ?? '';

    if (inheritedDateHelp) {
      const syncInheritedDateHelp = (): void => {
        const ownDate = purchaseDate.value;
        if (ownDate) {
          inheritedDateHelp.setText(
            `已设置单独日期 ${formatDate(ownDate)}；该日期会优先用于计算。`,
          );
          inheritedDateHelp.removeClass('is-inherited-date');
          return;
        }

        const linkedItem = items.find((item) => item.id === linkedItemId?.value);
        const inheritedDate = linkedItem?.purchaseDate?.trim()
          || (linkedItemId?.value === record.linkedItemId
            ? options.inheritedPurchaseDate
            : undefined);
        if (inheritedDate) {
          inheritedDateHelp.setText(
            `未单独设置；当前按主商品日期 ${formatDate(inheritedDate)} 计算。`,
          );
          inheritedDateHelp.addClass('is-inherited-date');
        } else {
          inheritedDateHelp.setText(
            '未单独设置；当前主商品也没有购买日期，暂不计日成本。',
          );
          inheritedDateHelp.removeClass('is-inherited-date');
        }
      };
      linkedItemId.addEventListener('change', syncInheritedDateHelp);
      purchaseDate.input.addEventListener('change', syncInheritedDateHelp);
      syncInheritedDateHelp();
    }
  }

  const coverField = form.createDiv({ cls: 'celtis-ledger-field is-wide' });
  const coverInputId = `celtis-cover-${record.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const coverHelpId = `${coverInputId}-help`;
  coverField.createEl('label', {
    text: '封面图片',
    attr: { for: coverInputId },
  });
  const coverInput = coverField.createDiv({ cls: 'celtis-ledger-cover-input' });
  const coverInputIcon = coverInput.createSpan({ cls: 'celtis-ledger-cover-input-icon' });
  setIcon(coverInputIcon, 'link-2');
  const cover = coverInput.createEl('input', {
    attr: {
      id: coverInputId,
      type: 'text',
      value: record.cover ?? '',
      placeholder: '粘贴图片、图片链接或 vault 路径',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-describedby': coverHelpId,
    },
  });
  const clearCover = coverInput.createEl('button', {
    cls: 'celtis-ledger-cover-clear',
    attr: {
      type: 'button',
      'aria-label': '清除封面',
      title: '清除封面',
    },
  });
  setIcon(clearCover, 'x');
  coverField.createSpan({
    cls: 'celtis-ledger-field-help',
    attr: { id: coverHelpId },
    text: canUseAppleStickerUI()
      ? options.autoStickerFromRemoteOnSave
        ? '可粘贴图片或 https 直链，也可选择本地图片。新增物品保存时会在 Mac 本地自动制作贴纸；失败则保留原封面。'
        : '可粘贴图片或 https 直链，也可选择本地图片、复用台账图片；转为贴纸仅支持 Mac。'
      : Platform.isIosApp
        ? '可粘贴图片、照片 App 中已抠好的主体或 https 直链，也可从相册选择；iPhone/iPad 不支持在插件内自动抠图。'
        : '可粘贴图片或链接，也可选择本地图片或复用封面。',
  });
  const coverTools = renderCoverToolsV2(coverField, cover, clearCover, plugin);

  const notesField = createField(form, '备注');
  notesField.addClass('is-wide');
  const notes = notesField.createEl('textarea', {
    attr: { rows: '4', placeholder: '型号、购买渠道、保修或使用感受…' },
    text: record.notes ?? '',
  });

  let saveInFlight = false;
  let formDisposed = false;
  const disabledControls = new Map<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    boolean
  >();
  const beginSave = (savedCover = ''): boolean => {
    if (saveInFlight || formDisposed || !coverTools.beginSave(savedCover)) {
      return false;
    }
    saveInFlight = true;
    form.addClass('is-saving');
    form.setAttr('aria-busy', 'true');
    for (const control of form.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('button, input, select, textarea')) {
      disabledControls.set(control, control.disabled);
      control.disabled = true;
    }
    return true;
  };
  const finishSave = (success: boolean): void => {
    if (!saveInFlight) {
      return;
    }
    saveInFlight = false;
    coverTools.finishSave(success);
    if (!success && !formDisposed) {
      form.removeClass('is-saving');
      form.removeAttribute('aria-busy');
      for (const [control, wasDisabled] of disabledControls) {
        control.disabled = wasDisabled;
      }
    }
    disabledControls.clear();
  };
  const dispose = (): void => {
    if (formDisposed) {
      return;
    }
    formDisposed = true;
    purchaseDate.dispose();
    archiveDate.dispose();
    coverTools.dispose();
  };
  form.addEventListener('celtis-form-dispose', dispose);

  return {
    name,
    purchaseDate,
    purchaseCost,
    saleIncome,
    archiveDate,
    linkedItemId,
    cover,
    notes,
    importImage: (file) => coverTools.importImage(file),
    prepareRemoteCoverSticker: () => coverTools.prepareRemoteCoverSticker(),
    beginSave,
    finishSave,
    dispose,
  };
}

function disposeRecordForms(root: ParentNode): void {
  for (const form of root.querySelectorAll<HTMLElement>('.celtis-ledger-form-grid')) {
    form.dispatchEvent(new CustomEvent('celtis-form-dispose'));
  }
}

function closeModalAfterConfirm(modal: Modal): Promise<void> {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    modal.close();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      modal.close();
      resolve();
    };
    modal.modalEl.addEventListener('transitionend', (event) => {
      if (event.target === modal.modalEl && event.propertyName === 'transform') {
        finish();
      }
    }, { once: true });
    modal.modalEl.addClass('is-confirm-closing');
    window.setTimeout(finish, 280);
  });
}

function assertValidProspectiveDates(
  record: LedgerRecord,
  records: readonly LedgerRecord[],
): void {
  if (isArchiveDateBeforePurchase(record, record.archiveDate, records)) {
    const message = '归档日期不能早于购买日期';
    new Notice(message);
    throw new Error(message);
  }

  if (record.type !== 'item') {
    return;
  }

  const invalidAccessory = records.find(
    (candidate) => candidate.type === 'accessory'
      && candidate.linkedItemId === record.id
      && !candidate.purchaseDate?.trim()
      && isArchiveDateBeforePurchase(candidate, candidate.archiveDate, records),
  );
  if (invalidAccessory) {
    const message = `购买日期晚于配件「${invalidAccessory.name}」的归档日期，请先调整配件日期`;
    new Notice(message);
    throw new Error(message);
  }
}

function collectRecordForm(
  original: LedgerRecord,
  form: RecordFormRefs,
  records: readonly LedgerRecord[],
): LedgerRecord | null {
  const name = form.name.value.trim();
  if (!name) {
    new Notice('请填写名称');
    form.name.focus();
    return null;
  }

  const purchaseCost = Number(form.purchaseCost.value);
  if (!Number.isFinite(purchaseCost) || purchaseCost < 0) {
    new Notice('买入费用必须是大于或等于 0 的数字');
    form.purchaseCost.focus();
    return null;
  }

  const saleIncome = parseOptionalNumber(form.saleIncome.value, '卖出收入');
  if (form.saleIncome.value.trim() && saleIncome == null) {
    form.saleIncome.focus();
    return null;
  }

  const purchaseDate = form.purchaseDate.value || undefined;
  const archiveDate = form.archiveDate.value || undefined;
  const candidate: LedgerRecord = {
    ...original,
    name,
    purchaseDate,
    purchaseCost,
    saleIncome,
    archiveDate,
    linkedItemId: original.type === 'accessory'
      ? form.linkedItemId?.value || undefined
      : undefined,
    cover: form.cover.value.trim() || undefined,
    notes: form.notes.value.trim() || undefined,
  };
  if (isArchiveDateBeforePurchase(candidate, archiveDate, records)) {
    new Notice('归档日期不能早于购买日期');
    form.archiveDate.focus();
    return null;
  }

  return candidate;
}

function renderDetailMetric(root: HTMLElement, label: string, value: string): void {
  const metric = root.createDiv({ cls: 'celtis-ledger-detail-metric' });
  metric.createSpan({ text: label });
  metric.createEl('strong', { text: value });
}

function renderStickerFact(root: HTMLElement, label: string, value: string): void {
  const fact = root.createDiv({ cls: 'celtis-ledger-sticker-detail-fact' });
  fact.createSpan({ text: label });
  fact.createEl('strong', { text: value });
}

function renderStickerArtwork(
  root: HTMLElement,
  record: LedgerRecord,
  plugin: WujiLedgerPlugin,
): HTMLElement {
  const artwork = root.createDiv({ cls: 'celtis-ledger-sticker-art' });
  const generated = isGeneratedStickerPath(record.cover);
  artwork.toggleClass('is-generated-sticker', generated);
  if (generated) {
    artwork.dataset.stickerShape = 'standard';
  }
  const fallback = artwork.createSpan({ cls: 'celtis-ledger-sticker-art-fallback' });
  setIcon(fallback, record.type === 'item' ? 'package' : 'wrench');
  if (!record.cover?.trim()) {
    artwork.addClass('is-missing');
    return artwork;
  }

  const image = artwork.createEl('img', {
    cls: 'is-pending',
    attr: {
      alt: `${record.name} 贴纸`,
      loading: 'lazy',
      draggable: 'false',
    },
  });
  const reveal = (): void => {
    if (generated) {
      artwork.dataset.stickerShape = getStickerShape(image.naturalWidth, image.naturalHeight);
    }
    image.removeClass('is-pending');
    fallback.hidden = true;
  };
  image.addEventListener('load', reveal);
  image.addEventListener('error', () => {
    image.remove();
    artwork.addClass('is-missing');
    fallback.hidden = false;
  });
  image.src = plugin.getAssetUrl(record.cover);
  if (image.complete && image.naturalWidth > 0) {
    reveal();
  }
  return artwork;
}

function renderAccessoryCount(root: HTMLElement, count: number): void {
  if (count <= 0) {
    return;
  }
  const metadata = root.createDiv({ cls: 'celtis-ledger-item-accessories' });
  const icon = metadata.createSpan({ attr: { 'aria-hidden': 'true' } });
  setIcon(icon, 'wrench');
  metadata.createSpan({ text: `${count} 个配件` });
}

function renderMetricRow(root: HTMLElement, label: string, value: string, className: string): void {
  const row = root.createDiv({ cls: className });
  row.createSpan({ text: `${label}：` });
  row.createEl('strong', { text: value });
}

function createField(root: HTMLElement, label: string, required = false): HTMLElement {
  const field = root.createEl('label', { cls: 'celtis-ledger-field' });
  field.createSpan({ text: required ? `${label} *` : label });
  return field;
}

function createIconButton(
  root: HTMLElement,
  icon: string,
  label: string,
  callback: () => void,
): HTMLButtonElement {
  const button = root.createEl('button', {
    cls: 'celtis-ledger-icon-button',
    attr: { type: 'button', 'aria-label': label, title: label },
  });
  setIcon(button, icon);
  button.addEventListener('click', callback);
  return button;
}

function createActionButton(
  root: HTMLElement,
  icon: string,
  label: string,
  callback: () => void | Promise<void>,
  primary = false,
): HTMLButtonElement {
  const button = root.createEl('button', {
    cls: primary ? 'celtis-ledger-button is-primary' : 'celtis-ledger-button is-soft',
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
          console.error(`物迹账本 action "${label}" failed`, error);
        });
      }
    } catch (error) {
      console.error(`物迹账本 action "${label}" failed`, error);
    }
  });
  return button;
}

function createCancelButton(
  root: HTMLElement,
  callback: () => void | Promise<void>,
): HTMLButtonElement {
  const button = createActionButton(root, 'x', '取消', callback);
  button.removeClass('is-soft');
  button.addClass('is-neutral');
  return button;
}

function setActionGroupBusy(root: HTMLElement, busy: boolean): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = busy;
    if (busy) {
      button.setAttr('aria-busy', 'true');
    } else {
      button.removeAttribute('aria-busy');
    }
  }
}

function renderPurchaseYearChart(
  root: HTMLElement,
  entries: readonly PurchaseYearEntry[],
): void {
  if (entries.length === 0) {
    root.createSpan({ cls: 'celtis-ledger-insight-empty', text: '暂无购买日期数据' });
    return;
  }

  const visible = entries.slice(-6);
  const totalCount = entries.reduce((total, entry) => total + entry.count, 0);
  const totalCost = entries.reduce((total, entry) => total + entry.totalCost, 0);
  const maxCount = Math.max(1, ...visible.map((entry) => entry.count));
  const width = 240;
  const height = 104;
  const plotTop = 18;
  const plotBottom = 77;
  const slot = width / visible.length;
  const barWidth = Math.min(28, slot * 0.52);
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = root.ownerDocument.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'celtis-ledger-year-chart');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    visible
      .map((entry) => `${entry.year} 年 ${entry.count} 件，买入 ${formatMoney(entry.totalCost)}`)
      .join('；'),
  );

  visible.forEach((entry, index) => {
    const center = slot * index + slot / 2;
    const availableHeight = plotBottom - plotTop;
    const barHeight = Math.max(6, (entry.count / maxCount) * availableHeight);
    const bar = root.ownerDocument.createElementNS(svgNamespace, 'rect');
    bar.setAttribute('class', 'celtis-ledger-year-bar');
    bar.setAttribute('x', String(center - barWidth / 2));
    bar.setAttribute('y', String(plotBottom - barHeight));
    bar.setAttribute('width', String(barWidth));
    bar.setAttribute('height', String(barHeight));
    bar.setAttribute('rx', '5');
    const barTitle = root.ownerDocument.createElementNS(svgNamespace, 'title');
    barTitle.textContent = `${entry.year} 年：${entry.count} 件，买入 ${formatMoney(entry.totalCost)}`;
    bar.appendChild(barTitle);
    svg.appendChild(bar);

    const count = root.ownerDocument.createElementNS(svgNamespace, 'text');
    count.setAttribute('class', 'celtis-ledger-year-count');
    count.setAttribute('x', String(center));
    count.setAttribute('y', String(Math.max(12, plotBottom - barHeight - 5)));
    count.setAttribute('text-anchor', 'middle');
    count.textContent = String(entry.count);
    svg.appendChild(count);

    const year = root.ownerDocument.createElementNS(svgNamespace, 'text');
    year.setAttribute('class', 'celtis-ledger-year-label');
    year.setAttribute('x', String(center));
    year.setAttribute('y', '96');
    year.setAttribute('text-anchor', 'middle');
    year.textContent = String(entry.year).slice(-2);
    svg.appendChild(year);
  });

  root.appendChild(svg);
  const caption = root.createDiv({ cls: 'celtis-ledger-year-caption' });
  caption.createSpan({ text: `共 ${totalCount} 件` });
  caption.createSpan({ text: `累计买入 ${formatMoney(totalCost)}` });
}

function renderEmpty(root: HTMLElement, icon: string, title: string, detail: string): void {
  const empty = root.createDiv({ cls: 'celtis-ledger-empty' });
  setIcon(empty.createDiv(), icon);
  empty.createEl('strong', { text: title });
  empty.createEl('p', { text: detail });
}

function renderInlineEmpty(root: HTMLElement, text: string): void {
  root.createDiv({ cls: 'celtis-ledger-empty is-inline', text });
}

function matchesQuery(record: LedgerRecord, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) {
    return true;
  }

  return [record.name, record.notes ?? '']
    .join('\n')
    .toLocaleLowerCase('zh-CN')
    .includes(normalized);
}

function sortRecords(
  records: LedgerRecord[],
  mode: SortMode,
  allRecords: LedgerRecord[],
  now: DayInput,
): LedgerRecord[] {
  const copy = [...records];
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  copy.sort((left, right) => {
    if (mode === 'name-asc') {
      return collator.compare(left.name, right.name);
    }
    if (mode === 'purchase-desc') {
      return (getEffectivePurchaseDate(right, allRecords) ?? '').localeCompare(
        getEffectivePurchaseDate(left, allRecords) ?? '',
      );
    }
    if (mode === 'value-desc') {
      const leftValue = left.type === 'item'
        ? getItemCost(left, allRecords, now).value
        : getRecordCost(left, now, allRecords).net;
      const rightValue = right.type === 'item'
        ? getItemCost(right, allRecords, now).value
        : getRecordCost(right, now, allRecords).net;
      return rightValue - leftValue;
    }
    const leftDaily = left.type === 'item'
      ? getItemCost(left, allRecords, now).daily
      : getRecordCost(left, now, allRecords).daily;
    const rightDaily = right.type === 'item'
      ? getItemCost(right, allRecords, now).daily
      : getRecordCost(right, now, allRecords).daily;
    return rightDaily - leftDaily;
  });
  return copy;
}

function parseOptionalNumber(value: string, label: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    new Notice(`${label}必须是大于或等于 0 的数字`);
    return undefined;
  }
  return parsed;
}

async function ensureAdapterDirectory(adapter: DataAdapter, path: string): Promise<void> {
  const segments = normalizePath(path).split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (await adapter.exists(current)) {
      continue;
    }
    try {
      await adapter.mkdir(current);
    } catch (error) {
      if (!await adapter.exists(current)) {
        throw error;
      }
    }
  }
}

function createRecordId(type: LedgerRecordType): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${type}-${suffix}`;
}

function todayInShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatDate(value: string): string {
  return value.replace(/-/g, '/');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}¥${formatNumber(Math.abs(value))}`;
}
