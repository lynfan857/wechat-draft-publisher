import type { WeChatDraftFrontmatter } from './types';

export const WECHAT_DRAFT_ID_KEY = 'wechat_draft_id';
export const WECHAT_CONTENT_HASH_KEY = 'wechat_content_hash';
export const WECHAT_THEME_KEY = 'wechat_theme';
export const WECHAT_UPDATED_AT_KEY = 'wechat_updated_at';
export const WECHAT_COVER_MEDIA_ID_KEY = 'wechat_cover_media_id';

function readString(frontmatter: Record<string, unknown> | undefined, key: string): string {
  const value = frontmatter?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function readWeChatDraftFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
): WeChatDraftFrontmatter | null {
  const draftId = readString(frontmatter, WECHAT_DRAFT_ID_KEY);
  if (!draftId) return null;
  return {
    draftId,
    contentHash: readString(frontmatter, WECHAT_CONTENT_HASH_KEY),
    themeId: readString(frontmatter, WECHAT_THEME_KEY),
    updatedAt: readString(frontmatter, WECHAT_UPDATED_AT_KEY),
    coverMediaId: readString(frontmatter, WECHAT_COVER_MEDIA_ID_KEY),
  };
}

export function writeWeChatDraftFrontmatter(
  frontmatter: Record<string, unknown>,
  state: WeChatDraftFrontmatter,
): void {
  frontmatter[WECHAT_DRAFT_ID_KEY] = state.draftId;
  frontmatter[WECHAT_CONTENT_HASH_KEY] = state.contentHash;
  frontmatter[WECHAT_THEME_KEY] = state.themeId;
  frontmatter[WECHAT_UPDATED_AT_KEY] = state.updatedAt;
  if (state.coverMediaId) {
    frontmatter[WECHAT_COVER_MEDIA_ID_KEY] = state.coverMediaId;
  } else {
    delete frontmatter[WECHAT_COVER_MEDIA_ID_KEY];
  }
}
