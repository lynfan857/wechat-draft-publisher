export interface WeChatDraftPublisherSettings {
  appId: string;
  defaultAuthor: string;
  defaultThemeId: string;
  defaultCoverMediaId: string;
  showIpWhitelistHelp: boolean;
  assetCache: UploadedAssetCache[];
}

export interface NotePublishMetadata {
  title: string;
  author: string;
  digest: string;
  cover: string;
  contentSourceUrl: string;
}

export interface WeChatSnapshot {
  sourcePath: string;
  title: string;
  author: string;
  digest: string;
  cover: string;
  contentSourceUrl: string;
  markdown: string;
  contentHash: string;
  assets: WeChatAsset[];
  coverAssetHash: string;
  warnings: WeChatPublishWarning[];
}

export interface WeChatAsset {
  originalUrl: string;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  body: ArrayBuffer;
  byteLength: number;
}

export interface WeChatPublishWarning {
  code: string;
  message: string;
  blocking: boolean;
}

export interface UploadedAssetCache {
  contentHash: string;
  kind: 'content-image' | 'cover';
  url?: string;
  mediaId?: string;
  uploadedAt: string;
}

export interface WeChatDraftFrontmatter {
  draftId: string;
  contentHash: string;
  themeId: string;
  updatedAt: string;
  coverMediaId: string;
}

export interface WeChatDraftPayload {
  title: string;
  author?: string;
  digest?: string;
  content: string;
  thumbMediaId: string;
  contentSourceUrl?: string;
}

export interface WeChatDraftResult {
  mediaId: string;
}

export interface WeChatTheme {
  id: string;
  label: string;
  color: string;
  palette: ThemePalette;
}

export interface ThemePalette {
  accent: string;
  accentDark: string;
  accentSoft: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
  codeBackground: string;
  codeText: string;
}
