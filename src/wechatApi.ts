import { requestUrl, type RequestUrlParam } from 'obsidian';

import type { WeChatAsset, WeChatDraftPayload, WeChatDraftResult } from './types';

interface AccessTokenState {
  token: string;
  expiresAt: number;
}

interface WeChatApiErrorBody {
  errcode?: number;
  errmsg?: string;
}

interface AccessTokenResponse extends WeChatApiErrorBody {
  access_token?: string;
  expires_in?: number;
}

interface UploadImageResponse extends WeChatApiErrorBody {
  url?: string;
}

interface UploadMaterialResponse extends WeChatApiErrorBody {
  media_id?: string;
}

interface DraftResponse extends WeChatApiErrorBody {
  media_id?: string;
}

export class WeChatApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'WeChatApiError';
  }
}

export class WeChatApiClient {
  private tokenState: AccessTokenState | null = null;

  constructor(
    private readonly getAppId: () => string,
    private readonly getAppSecret: () => string,
  ) {}

  async getCurrentPublicIp(): Promise<string> {
    const response = await requestUrl({
      url: 'https://api.ipify.org?format=json',
      throw: false,
    });
    if (response.status >= 400) throw new Error(`公网 IP 检测失败：HTTP ${response.status}`);
    const json = response.json as { ip?: string };
    if (!json.ip) throw new Error('公网 IP 检测没有返回 IP。');
    return json.ip;
  }

  async testConnection(): Promise<void> {
    await this.getAccessToken(true);
  }

  async uploadArticleImage(asset: WeChatAsset): Promise<string> {
    const accessToken = await this.getAccessToken();
    const response = await this.multipartRequest<UploadImageResponse>({
      url: `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`,
      fileField: 'media',
      asset,
    });
    if (!response.url) throw new WeChatApiError('微信没有返回正文图片 URL。', response.errcode);
    return response.url;
  }

  async uploadCoverMaterial(asset: WeChatAsset): Promise<string> {
    const accessToken = await this.getAccessToken();
    const response = await this.multipartRequest<UploadMaterialResponse>({
      url: `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=image`,
      fileField: 'media',
      asset,
    });
    if (!response.media_id) throw new WeChatApiError('微信没有返回封面素材 media_id。', response.errcode);
    return response.media_id;
  }

  async addDraft(payload: WeChatDraftPayload): Promise<WeChatDraftResult> {
    const response = await this.wechatJson<DraftResponse>('https://api.weixin.qq.com/cgi-bin/draft/add', {
      articles: [toWeChatArticle(payload)],
    });
    if (!response.media_id) throw new WeChatApiError('微信没有返回草稿 media_id。', response.errcode);
    return { mediaId: response.media_id };
  }

  async updateDraft(mediaId: string, payload: WeChatDraftPayload): Promise<WeChatDraftResult> {
    await this.wechatJson<DraftResponse>('https://api.weixin.qq.com/cgi-bin/draft/update', {
      media_id: mediaId,
      index: 0,
      articles: toWeChatArticle(payload),
    });
    return { mediaId };
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.tokenState && this.tokenState.expiresAt > now + 60_000) {
      return this.tokenState.token;
    }
    const appId = this.getAppId().trim();
    const secret = this.getAppSecret().trim();
    if (!appId || !secret) throw new Error('请先在插件设置中填写 AppID 和 AppSecret。');
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', secret);
    const response = await requestUrl({ url: url.toString(), throw: false });
    const payload = response.json as AccessTokenResponse;
    this.assertWechatOk(payload, response.status, '获取 access_token 失败');
    if (!payload.access_token) throw new Error('微信没有返回 access_token。');
    this.tokenState = {
      token: payload.access_token,
      expiresAt: now + Math.max(60, payload.expires_in ?? 7200) * 1000,
    };
    return payload.access_token;
  }

  private async wechatJson<T extends WeChatApiErrorBody>(
    baseUrl: string,
    body: unknown,
    retried = false,
  ): Promise<T> {
    const accessToken = await this.getAccessToken(retried);
    const url = new URL(baseUrl);
    url.searchParams.set('access_token', accessToken);
    const response = await requestUrl({
      url: url.toString(),
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify(body),
      throw: false,
    });
    const payload = response.json as T;
    if (isTokenExpired(payload) && !retried) {
      return this.wechatJson<T>(baseUrl, body, true);
    }
    this.assertWechatOk(payload, response.status, '微信草稿接口请求失败');
    return payload;
  }

  private async multipartRequest<T extends WeChatApiErrorBody>(options: {
    url: string;
    fileField: string;
    asset: WeChatAsset;
  }): Promise<T> {
    const boundary = `----wechat-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const body = buildMultipartBody(boundary, options.fileField, options.asset);
    const request: RequestUrlParam = {
      url: options.url,
      method: 'POST',
      contentType: `multipart/form-data; boundary=${boundary}`,
      body,
      throw: false,
    };
    const response = await requestUrl(request);
    const payload = response.json as T;
    this.assertWechatOk(payload, response.status, '微信素材上传失败');
    return payload;
  }

  private assertWechatOk(payload: WeChatApiErrorBody, status: number, fallback: string): void {
    if (status >= 400) throw new WeChatApiError(`${fallback}：HTTP ${status}`);
    if (payload.errcode && payload.errcode !== 0) {
      throw new WeChatApiError(formatWechatError(payload.errcode, payload.errmsg, fallback), payload.errcode);
    }
  }
}

function toWeChatArticle(payload: WeChatDraftPayload): Record<string, unknown> {
  return {
    title: payload.title,
    thumb_media_id: payload.thumbMediaId,
    author: payload.author ?? '',
    digest: payload.digest ?? '',
    show_cover_pic: 0,
    content: payload.content,
    content_source_url: payload.contentSourceUrl ?? '',
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
}

function isTokenExpired(payload: WeChatApiErrorBody): boolean {
  return payload.errcode === 40001 || payload.errcode === 42001 || payload.errcode === 40014;
}

function formatWechatError(code: number, message: string | undefined, fallback: string): string {
  if (code === 40164) {
    return `${fallback}：当前公网 IP 不在微信公众号 IP 白名单中。请在公众号后台“设置与开发 -> 基本配置”添加本机公网 IP。`;
  }
  if (code === 40013) return `${fallback}：AppID 无效。`;
  if (code === 40125 || code === 40001) return `${fallback}：AppSecret 或 access_token 无效。`;
  return `${fallback}：${message || `微信错误码 ${code}`}`;
}

function buildMultipartBody(boundary: string, fieldName: string, asset: WeChatAsset): ArrayBuffer {
  const encoder = new TextEncoder();
  const header = encoder.encode([
    `--${boundary}`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${escapeFilename(asset.fileName)}"`,
    `Content-Type: ${asset.mimeType}`,
    '',
    '',
  ].join('\r\n'));
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
  const fileBytes = new Uint8Array(asset.body);
  const body = new Uint8Array(header.byteLength + fileBytes.byteLength + footer.byteLength);
  body.set(header, 0);
  body.set(fileBytes, header.byteLength);
  body.set(footer, header.byteLength + fileBytes.byteLength);
  return body.buffer;
}

function escapeFilename(fileName: string): string {
  return fileName.replace(/["\r\n]/g, '_');
}
