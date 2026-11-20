import {
  FileSystemAdapter,
  Platform,
  TFile,
  normalizePath,
  requestUrl,
  type App,
  type PluginManifest,
  type RequestUrlResponse,
} from 'obsidian';
import {
  MAX_COVER_IMAGE_BYTES,
  SUPPORTED_COVER_IMAGE_MESSAGE,
  getCoverImageKindFromSignature,
  sanitizeCoverFileStem,
  type CoverImageKind,
} from './cover-assets';

class RemoteImageTooLargeError extends Error {}

let helperInstalled = false;

/** Only detect an explicitly user-installed helper; never download or install it. */
export async function initializeAppleSticker(app: App, manifest: PluginManifest): Promise<void> {
  helperInstalled = false;
  if (!Platform.isDesktopApp || !Platform.isMacOS) return;
  const directory = normalizePath(manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`);
  try {
    helperInstalled = await app.vault.adapter.exists(`${directory}/native/wuji-cutout`);
  } catch {
    helperInstalled = false;
  }
}

export function canUseAppleStickerUI(): boolean {
  return Platform.isDesktopApp && Platform.isMacOS && helperInstalled;
}

export async function createAppleStickerFromUrl(
  app: App,
  manifest: PluginManifest,
  sourceUrl: string,
): Promise<string> {
  if (!canUseAppleStickerUI()) {
    throw new Error('Apple 本地抠图仅支持 macOS 14 或更高版本的 Obsidian 桌面版。');
  }

  const url = parseRemoteImageUrl(sourceUrl);
  await checkRemoteImageSize(url);

  let response: RequestUrlResponse;
  try {
    response = await requestUrl({
      url: url.href,
      method: 'GET',
      throw: false,
    });
  } catch {
    throw new Error('下载图片失败，请检查链接和网络后重试。');
  }

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `图片链接无法访问（HTTP ${response.status}），请使用无需登录、可直接打开的图片链接。`,
      );
    }
    throw new Error(`下载图片失败（HTTP ${response.status}），请检查链接是否可直接访问。`);
  }

  assertAdvertisedImageSize(response.headers);
  if (response.arrayBuffer.byteLength <= 0) {
    throw new Error('图片链接返回了空文件，请换一个图片直链。');
  }
  if (response.arrayBuffer.byteLength > MAX_COVER_IMAGE_BYTES) {
    throw new Error('远程图片超过 100 MB，请先缩小图片后再制作贴纸。');
  }

  const contentType = normalizeContentType(getResponseHeader(response.headers, 'content-type'));
  const imageKind = identifyRemoteImage(response.arrayBuffer, contentType, url.pathname);
  const fileName = buildRemoteFileName(url.pathname, imageKind.extension);
  const file = new File([response.arrayBuffer], fileName, { type: imageKind.mimeType });
  return createAppleSticker(app, manifest, file);
}

export async function createAppleStickerFromCover(
  app: App,
  manifest: PluginManifest,
  source: string,
): Promise<string> {
  if (/^https?:\/\//i.test(source.trim())) {
    return createAppleStickerFromUrl(app, manifest, source);
  }
  if (!canUseAppleStickerUI()) {
    throw new Error('Apple 本地抠图仅支持 macOS 14 或更高版本的 Obsidian 桌面版。');
  }

  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error('当前 vault 不是桌面文件系统，无法读取现有封面。');
  }
  const sourcePath = resolveLocalCoverPath(app, manifest, source);
  const stat = await adapter.stat(sourcePath);
  if (!stat || stat.type !== 'file') {
    throw new Error('找不到当前封面文件，请检查内置文件名或 vault 图片路径。');
  }
  if (stat.size <= 0) {
    throw new Error('当前封面文件为空，请换一张图片重试。');
  }
  if (stat.size > MAX_COVER_IMAGE_BYTES) {
    throw new Error('当前封面超过 100 MB，请先缩小图片后再制作贴纸。');
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await adapter.readBinary(sourcePath);
  } catch {
    throw new Error('读取当前封面失败，请检查文件是否仍然存在。');
  }
  if (buffer.byteLength <= 0) {
    throw new Error('当前封面文件为空，请换一张图片重试。');
  }
  if (buffer.byteLength > MAX_COVER_IMAGE_BYTES) {
    throw new Error('当前封面超过 100 MB，请先缩小图片后再制作贴纸。');
  }

  const imageKind = identifyRemoteImage(buffer, undefined, sourcePath);
  const encodedName = sourcePath.split('/').pop() ?? 'local-cover';
  const stem = sanitizeCoverFileStem(encodedName) || 'local-cover';
  const file = new File([buffer], `${stem}.${imageKind.extension}`, {
    type: imageKind.mimeType,
  });
  return createAppleSticker(app, manifest, file);
}

export async function createAppleSticker(
  app: App,
  manifest: PluginManifest,
  file: File,
): Promise<string> {
  if (!canUseAppleStickerUI()) {
    throw new Error('Apple 本地抠图仅支持 macOS 14 或更高版本的 Obsidian 桌面版。');
  }
  if (file.size <= 0) {
    throw new Error('选择的图片为空，请换一张图片重试。');
  }
  if (file.size > MAX_COVER_IMAGE_BYTES) {
    throw new Error('图片超过 100 MB，请先缩小图片后再制作贴纸。');
  }

  const inputBuffer = await file.arrayBuffer();
  const inputKind = getCoverImageKindFromSignature(inputBuffer);
  if (!inputKind) {
    throw new Error(SUPPORTED_COVER_IMAGE_MESSAGE);
  }

  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error('当前 vault 不是桌面文件系统，无法调用 Apple 本地抠图。');
  }

  const pluginDirectory = normalizePath(
    manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`,
  );
  const helperPath = normalizePath(`${pluginDirectory}/native/wuji-cutout`);
  if (!(await adapter.exists(helperPath))) {
    throw new Error('请按公开仓库中的说明手动安装可选 Mac 抠图组件；普通封面不受影响。');
  }

  const runtimeRequire = getRuntimeRequire();
  if (!runtimeRequire) {
    throw new Error('当前 Obsidian 运行环境无法启动 Apple 抠图组件。');
  }
  const fileSystem = runtimeRequire('node:fs') as typeof import('node:fs');
  const operatingSystem = runtimeRequire('node:os') as typeof import('node:os');
  const nodePath = runtimeRequire('node:path') as typeof import('node:path');

  const userAssets = normalizePath(`${pluginDirectory}/assets/user`);
  await ensureDirectory(adapter, userAssets);
  const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const baseName = sanitizeCoverFileStem(file.name);
  const outputName = `${baseName || 'image'}-${unique}-sticker.png`;
  const outputPath = normalizePath(`${userAssets}/${outputName}`);

  let completed = false;
  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = await fileSystem.promises.mkdtemp(
      nodePath.join(operatingSystem.tmpdir(), 'wuji-cutout-'),
    );
    await fileSystem.promises.chmod(temporaryDirectory, 0o700);
    const sourceFullPath = nodePath.join(
      temporaryDirectory,
      `input.${inputKind.extension}`,
    );
    const outputFullPath = nodePath.join(temporaryDirectory, 'sticker.png');
    await fileSystem.promises.writeFile(sourceFullPath, new Uint8Array(inputBuffer), {
      mode: 0o600,
    });
    const helperFullPath = adapter.getFullPath(helperPath);
    await runHelper(helperFullPath, sourceFullPath, outputFullPath);

    const outputBytes = await fileSystem.promises.readFile(outputFullPath);
    if (outputBytes.byteLength < 256 || outputBytes.byteLength > MAX_COVER_IMAGE_BYTES) {
      throw new Error('Apple 抠图没有生成有效图片，请换一张主体更清晰的照片。');
    }
    const outputBuffer = Uint8Array.from(outputBytes).buffer;
    const outputKind = getCoverImageKindFromSignature(outputBuffer);
    if (outputKind?.extension !== 'png') {
      throw new Error('Apple 抠图没有生成有效的透明 PNG，请换一张照片重试。');
    }
    await adapter.writeBinary(outputPath, outputBuffer);
    const output = await adapter.stat(outputPath);
    if (!output || output.type !== 'file' || output.size !== outputBytes.byteLength) {
      throw new Error('保存贴纸失败，请检查 iCloud 或磁盘状态后重试。');
    }
    completed = true;
    return `assets/user/${outputName}`;
  } finally {
    if (temporaryDirectory) {
      await fileSystem.promises.rm(temporaryDirectory, { recursive: true, force: true }).catch(
        (error: unknown) => {
          console.error('物迹账本 could not clean its local temporary files', error);
        },
      );
    }
    if (!completed) {
      await removeIfExists(adapter, outputPath);
    }
  }
}

function parseRemoteImageUrl(sourceUrl: string): URL {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    throw new Error('图片链接为空，请先粘贴一个可直接访问的图片链接。');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('图片链接格式不正确，请使用完整的 http 或 https 链接。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('图片链接仅支持 http 或 https。');
  }
  if (url.username || url.password) {
    throw new Error('图片链接不能包含账号或密码，请使用可直接访问的公开图片链接。');
  }
  return url;
}

function resolveLocalCoverPath(
  app: App,
  manifest: PluginManifest,
  source: string,
): string {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('当前封面为空，请先填写图片链接或本地图片路径。');
  }
  if (
    trimmed.includes('\0')
    || trimmed.includes('\\')
    || trimmed.startsWith('/')
    || trimmed.startsWith('~')
    || /^[a-zA-Z]:/.test(trimmed)
    || trimmed.split('/').includes('..')
    || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    throw new Error('当前封面不是可读取的 vault 图片路径或内置素材文件名。');
  }

  const pluginDirectory = normalizePath(
    manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`,
  );
  const normalizedSource = normalizePath(trimmed);
  if (app.vault.getAbstractFileByPath(normalizedSource) instanceof TFile) {
    return normalizedSource;
  }
  if (trimmed.startsWith('assets/')) {
    return normalizePath(`${pluginDirectory}/${trimmed}`);
  }
  if (trimmed.includes('/')) {
    return normalizePath(trimmed);
  }
  return normalizePath(`${pluginDirectory}/assets/${trimmed}`);
}

async function checkRemoteImageSize(url: URL): Promise<void> {
  try {
    const response = await requestUrl({
      url: url.href,
      method: 'HEAD',
      throw: false,
    });
    if (response.status >= 200 && response.status < 400) {
      assertAdvertisedImageSize(response.headers);
    }
  } catch (error) {
    if (error instanceof RemoteImageTooLargeError) {
      throw error;
    }
    // Some image hosts do not implement HEAD. The GET response is still checked below.
  }
}

function assertAdvertisedImageSize(headers: Record<string, string>): void {
  const rawLength = getResponseHeader(headers, 'content-length')?.trim();
  if (!rawLength || !/^\d+$/.test(rawLength)) {
    return;
  }
  const advertisedLength = Number(rawLength);
  if (advertisedLength > MAX_COVER_IMAGE_BYTES) {
    throw new RemoteImageTooLargeError(
      '远程图片超过 100 MB，请先缩小图片后再制作贴纸。',
    );
  }
}

function getResponseHeader(
  headers: Record<string, string>,
  requestedName: string,
): string | undefined {
  const expected = requestedName.toLocaleLowerCase('en-US');
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLocaleLowerCase('en-US') === expected) {
      return value;
    }
  }
  return undefined;
}

function normalizeContentType(value: string | undefined): string | undefined {
  const mimeType = value?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
  return mimeType || undefined;
}

function identifyRemoteImage(
  buffer: ArrayBuffer,
  contentType: string | undefined,
  _pathname: string,
): CoverImageKind {
  const bySignature = getCoverImageKindFromSignature(buffer);

  if (contentType && !contentType.startsWith('image/') && !isGenericBinaryMime(contentType)) {
    throw new Error(
      `链接返回的不是图片（${contentType}），请使用可直接打开图片文件的链接。`,
    );
  }
  if (bySignature) {
    return bySignature;
  }
  throw new Error(SUPPORTED_COVER_IMAGE_MESSAGE);
}

function isGenericBinaryMime(mimeType: string): boolean {
  return (
    mimeType === 'application/octet-stream' ||
    mimeType === 'binary/octet-stream' ||
    mimeType === 'application/x-binary'
  );
}

function buildRemoteFileName(pathname: string, extension: string): string {
  const encodedName = pathname.split('/').filter(Boolean).pop() ?? 'remote-image';
  let decodedName = encodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    // Keep the URL-encoded name when it contains malformed escape sequences.
  }
  const stem = sanitizeCoverFileStem(decodedName) || 'remote-image';
  return `${stem}.${extension}`;
}

async function runHelper(
  executable: string,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const runtimeRequire = getRuntimeRequire();
  if (!runtimeRequire) {
    throw new Error('当前 Obsidian 运行环境无法启动 Apple 抠图组件。');
  }
  const childProcess = runtimeRequire('node:child_process') as typeof import('node:child_process');

  await new Promise<void>((resolve, reject) => {
    childProcess.execFile(
      executable,
      [inputPath, outputPath],
      {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const detail = stderr.trim();
        reject(new Error(toFriendlyError(detail || error.message)));
      },
    );
  });
}

function getRuntimeRequire(): NodeJS.Require | undefined {
  if (typeof require === 'function') {
    return require;
  }
  return (window as typeof globalThis & { require?: NodeJS.Require }).require;
}

async function ensureDirectory(adapter: FileSystemAdapter, path: string): Promise<void> {
  const segments = normalizePath(path).split('/');
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

async function removeIfExists(adapter: FileSystemAdapter, path: string): Promise<void> {
  if (await adapter.exists(path)) {
    await adapter.remove(path);
  }
}

function toFriendlyError(detail: string): string {
  if (detail.includes('requires macOS 14')) {
    return 'Apple 本地抠图需要 macOS 14 或更高版本；原封面没有改变。';
  }
  if (detail.includes('could not find a foreground subject')) {
    return '没有识别到清晰主体，请换一张主体更突出、背景更简单的照片。';
  }
  if (detail.includes('does not exist')) {
    return '读取所选图片失败，请重新选择图片。';
  }
  return `Apple 本地抠图失败：${detail}`;
}
