import { createHash } from 'crypto';
import path from 'path';
import { App, requestUrl, TFile } from 'obsidian';

import type {
  NotePublishMetadata,
  WeChatAsset,
  WeChatDraftPublisherSettings,
  WeChatPublishWarning,
  WeChatSnapshot,
} from './types';

const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_WECHAT_IMAGE_BYTES = 10 * 1024 * 1024;

function valueFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = frontmatter?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return markdown;
  const after = markdown.indexOf('\n', end + 4);
  return after < 0 ? '' : markdown.slice(after + 1);
}

function firstMarkdownHeading(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

function firstParagraph(markdown: string): string {
  const cleaned = markdown
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[[^\]]+]\([^)]+\)/g, '$1')
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find(Boolean);
  return cleaned?.slice(0, 120) ?? '';
}

function hashSnapshot(value: Omit<WeChatSnapshot, 'contentHash'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashBytes(value: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(value)).digest('hex');
}

function imageMimeTypeFromBytes(body: ArrayBuffer): string | null {
  const bytes = new Uint8Array(body);
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
  ) return 'image/gif';
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

function markdownImageTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
    const target = (match[1] ?? '').replace(/^<|>$/g, '').trim();
    if (target) targets.push(target);
  }
  for (const match of markdown.matchAll(/!\[\[([^\]]+)]]/g)) {
    const target = (match[1] ?? '').split('|', 1)[0]?.trim();
    if (target) targets.push(target);
  }
  return targets;
}

function normalizeImagePath(value: string): string {
  return decodeURIComponent(value)
    .split('#', 1)[0]
    .trim();
}

async function readLocalImageAsset(
  app: App,
  sourceFile: TFile,
  originalUrl: string,
  warnings: WeChatPublishWarning[],
): Promise<WeChatAsset | null> {
  const cleanPath = normalizeImagePath(originalUrl);
  const target = app.metadataCache.getFirstLinkpathDest(cleanPath, sourceFile.path);
  if (!(target instanceof TFile)) {
    warnings.push({
      code: 'image-not-found',
      message: `图片未找到：${originalUrl}`,
      blocking: true,
    });
    return null;
  }
  const mimeType = IMAGE_EXTENSION_TO_MIME[target.extension.toLowerCase()];
  if (!mimeType) {
    warnings.push({
      code: 'image-type',
      message: `图片格式不支持：${target.path}`,
      blocking: true,
    });
    return null;
  }
  const body = await app.vault.readBinary(target);
  if (!body.byteLength || body.byteLength > MAX_WECHAT_IMAGE_BYTES) {
    warnings.push({
      code: 'image-size',
      message: `图片超过微信 10MB 限制：${target.path}`,
      blocking: true,
    });
    return null;
  }
  const detected = imageMimeTypeFromBytes(body);
  if (!detected) {
    warnings.push({
      code: 'image-type',
      message: `图片真实格式无法识别：${target.path}`,
      blocking: true,
    });
    return null;
  }
  return {
    originalUrl,
    previewUrl: app.vault.getResourcePath(target),
    fileName: path.posix.basename(target.path),
    mimeType: detected,
    contentHash: hashBytes(body),
    body,
    byteLength: body.byteLength,
  };
}

async function readRemoteImageAsset(
  originalUrl: string,
  warnings: WeChatPublishWarning[],
): Promise<WeChatAsset | null> {
  if (!/^https?:\/\//i.test(originalUrl)) return null;
  const response = await requestUrl({ url: originalUrl, throw: false });
  if (response.status < 200 || response.status >= 300) {
    warnings.push({
      code: 'remote-image',
      message: `远程图片读取失败：${originalUrl}（HTTP ${response.status}）`,
      blocking: true,
    });
    return null;
  }
  const body = response.arrayBuffer;
  if (!body.byteLength || body.byteLength > MAX_WECHAT_IMAGE_BYTES) {
    warnings.push({
      code: 'image-size',
      message: `远程图片超过微信 10MB 限制：${originalUrl}`,
      blocking: true,
    });
    return null;
  }
  const mimeType = imageMimeTypeFromBytes(body);
  if (!mimeType) {
    warnings.push({
      code: 'image-type',
      message: `远程图片格式无法识别：${originalUrl}`,
      blocking: true,
    });
    return null;
  }
  const currentName = path.posix.basename(new URL(originalUrl).pathname) || 'remote-image';
  const expectedExtension = IMAGE_MIME_TO_EXTENSION[mimeType] ?? 'png';
  const ext = path.posix.extname(currentName);
  const fileName = IMAGE_EXTENSION_TO_MIME[ext.slice(1).toLowerCase()] === mimeType
    ? currentName
    : `${ext ? currentName.slice(0, -ext.length) : currentName}.${expectedExtension}`;
  return {
    originalUrl,
    previewUrl: originalUrl,
    fileName,
    mimeType,
    contentHash: hashBytes(body),
    body,
    byteLength: body.byteLength,
  };
}

async function collectAssets(
  app: App,
  file: TFile,
  markdown: string,
  cover: string,
  warnings: WeChatPublishWarning[],
): Promise<WeChatAsset[]> {
  const assets = new Map<string, WeChatAsset>();
  const targets = [...markdownImageTargets(markdown), ...(cover ? [cover] : [])];
  for (const target of targets) {
    if (assets.has(target)) continue;
    const asset = /^https?:\/\//i.test(target)
      ? await readRemoteImageAsset(target, warnings)
      : await readLocalImageAsset(app, file, target, warnings);
    if (asset) assets.set(target, asset);
  }
  return [...assets.values()];
}

export function metadataFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): NotePublishMetadata {
  return {
    title: valueFromFrontmatter(frontmatter, 'title', '标题'),
    author: valueFromFrontmatter(frontmatter, 'author', '作者'),
    digest: valueFromFrontmatter(frontmatter, 'digest', '摘要'),
    cover: valueFromFrontmatter(frontmatter, 'cover', '封面'),
    coverMediaId: valueFromFrontmatter(frontmatter, 'cover_media_id', '封面素材ID'),
    contentSourceUrl: valueFromFrontmatter(frontmatter, 'content_source_url', '原文地址'),
  };
}

export async function buildSnapshot(
  app: App,
  file: TFile,
  settings: WeChatDraftPublisherSettings,
): Promise<WeChatSnapshot> {
  const raw = await app.vault.cachedRead(file);
  const markdown = stripFrontmatter(raw).trim();
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const metadata = metadataFromFrontmatter(frontmatter);
  const warnings: WeChatPublishWarning[] = [];
  const assets = await collectAssets(app, file, markdown, metadata.cover, warnings);
  const coverAsset = metadata.cover
    ? assets.find((asset) => asset.originalUrl === metadata.cover)
    : null;
  const prepared: Omit<WeChatSnapshot, 'contentHash'> = {
    sourcePath: file.path,
    title: metadata.title || firstMarkdownHeading(markdown) || file.basename,
    author: metadata.author || settings.defaultAuthor,
    digest: metadata.digest || firstParagraph(markdown),
    cover: metadata.cover,
    coverMediaId: metadata.coverMediaId,
    contentSourceUrl: metadata.contentSourceUrl,
    markdown,
    assets,
    coverAssetHash: coverAsset?.contentHash ?? '',
    warnings,
  };
  return {
    ...prepared,
    contentHash: hashSnapshot(prepared),
  };
}

export function applySnapshotMetadata(
  snapshot: WeChatSnapshot,
  values: Pick<WeChatSnapshot, 'title' | 'author' | 'digest' | 'cover' | 'coverMediaId' | 'contentSourceUrl'>,
): WeChatSnapshot {
  const cover = values.cover.trim();
  const coverAsset = cover
    ? snapshot.assets.find((asset) => asset.originalUrl === cover)
    : null;
  const prepared: Omit<WeChatSnapshot, 'contentHash'> = {
    ...snapshot,
    title: values.title.trim(),
    author: values.author.trim(),
    digest: values.digest.trim(),
    cover,
    coverMediaId: values.coverMediaId.trim(),
    contentSourceUrl: values.contentSourceUrl.trim(),
    coverAssetHash: coverAsset?.contentHash ?? '',
  };
  return {
    ...prepared,
    contentHash: hashSnapshot(prepared),
  };
}
