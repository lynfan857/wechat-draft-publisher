import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';

import {
  WECHAT_DRAFT_VIEW_TYPE,
  WeChatPreviewView,
} from './previewView';
import { APP_SECRET_KEY, WeChatDraftPublisherSettingTab } from './settings';
import { DEFAULT_THEME_ID, getTheme } from './themes';
import type { UploadedAssetCache, WeChatDraftPublisherSettings } from './types';
import { WeChatApiClient } from './wechatApi';

const DEFAULT_SETTINGS: WeChatDraftPublisherSettings = {
  appId: '',
  defaultAuthor: '',
  defaultThemeId: DEFAULT_THEME_ID,
  defaultCoverMediaId: '',
  showIpWhitelistHelp: true,
  assetCache: [],
};

export default class WeChatDraftPublisherPlugin extends Plugin {
  declare settings: WeChatDraftPublisherSettings;
  wechatApi!: WeChatApiClient;
  private appSecret = '';

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.appSecret = this.app.secretStorage.getSecret(APP_SECRET_KEY) ?? '';
    this.wechatApi = new WeChatApiClient(
      () => this.settings.appId,
      () => this.getAppSecret(),
    );

    this.registerView(
      WECHAT_DRAFT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new WeChatPreviewView(leaf, {
        getSettings: () => this.settings,
        saveSettings: () => this.saveSettings(),
        api: this.wechatApi,
        findUploadCache: (kind, contentHash) => this.findUploadCache(kind, contentHash),
        rememberUploadCache: (entry) => this.rememberUploadCache(entry),
      }),
    );

    this.addRibbonIcon('newspaper', '打开公众号预览', () => {
      void this.activatePreview();
    });

    this.addCommand({
      id: 'open-wechat-preview',
      name: 'Open WeChat preview',
      callback: () => void this.activatePreview(),
    });

    this.addCommand({
      id: 'preview-current-note-as-wechat',
      name: 'Preview current note as WeChat article',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) void this.activatePreview(view.file);
        return true;
      },
    });

    this.addSettingTab(new WeChatDraftPublisherSettingTab(this.app, this));
  }

  override onunload(): void {
    this.app.workspace.detachLeavesOfType(WECHAT_DRAFT_VIEW_TYPE);
  }

  async activatePreview(file?: TFile): Promise<void> {
    const target = file ?? this.app.workspace.getActiveFile();
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(WECHAT_DRAFT_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: WECHAT_DRAFT_VIEW_TYPE, active: true });
    }
    if (!leaf) {
      new Notice('无法打开公众号预览。');
      return;
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof WeChatPreviewView && target instanceof TFile) {
      await leaf.view.setFile(target);
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<WeChatDraftPublisherSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      assetCache: Array.isArray(loaded?.assetCache) ? loaded.assetCache : [],
    };
    if (!getTheme(this.settings.defaultThemeId)) {
      this.settings.defaultThemeId = DEFAULT_THEME_ID;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  hasAppSecret(): boolean {
    return Boolean(this.appSecret);
  }

  async saveAppSecret(value: string): Promise<void> {
    this.appSecret = value;
    this.app.secretStorage.setSecret(APP_SECRET_KEY, value);
  }

  getAppSecret(): string {
    return this.appSecret;
  }

  findUploadCache(kind: UploadedAssetCache['kind'], contentHash: string): UploadedAssetCache | null {
    return this.settings.assetCache.find((entry) => (
      entry.kind === kind
      && entry.contentHash === contentHash
      && Date.now() - Date.parse(entry.uploadedAt) < 1000 * 60 * 60 * 24 * 30
    )) ?? null;
  }

  async rememberUploadCache(entry: UploadedAssetCache): Promise<void> {
    this.settings.assetCache = [
      entry,
      ...this.settings.assetCache.filter((item) => (
        item.kind !== entry.kind || item.contentHash !== entry.contentHash
      )),
    ].slice(0, 300);
    await this.saveSettings();
  }
}
