import {
  Component,
  ItemView,
  Notice,
  setIcon,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';

import { readWeChatDraftFrontmatter, writeWeChatDraftFrontmatter } from './frontmatter';
import { renderWeChatArticle, sanitizeWeChatArticle } from './renderer';
import type { SanitizedHtmlResult } from './renderer';
import { buildSnapshot, applySnapshotMetadata } from './snapshot';
import { getTheme, WECHAT_THEMES } from './themes';
import type {
  UploadedAssetCache,
  WeChatAsset,
  WeChatDraftPublisherSettings,
  WeChatDraftFrontmatter,
  WeChatSnapshot,
} from './types';
import { WeChatApiError, type WeChatApiClient } from './wechatApi';

export const WECHAT_DRAFT_VIEW_TYPE = 'wechat-draft-publisher-preview';
type CoverMode = 'first-image' | 'image' | 'media-id';
type PublishCheckLevel = 'ok' | 'warn' | 'error';
type WorkbenchStatusLevel = 'idle' | 'ok' | 'warn' | 'error' | 'busy';

interface PublishCheckAction {
  label: string;
  run: () => void;
}

interface PublishCheckIssue {
  level: PublishCheckLevel;
  title: string;
  detail: string;
  actions?: PublishCheckAction[];
}

interface WorkbenchStatus {
  level: WorkbenchStatusLevel;
  icon: string;
  label: string;
  detail: string;
}

interface HtmlAuditState {
  source: 'copy' | 'publish';
  publicationHash: string;
  result: SanitizedHtmlResult;
}

interface PublishLogEntry {
  time: string;
  step: string;
  detail?: string;
}

export interface PreviewViewDeps {
  getSettings: () => WeChatDraftPublisherSettings;
  saveSettings: () => Promise<void>;
  api: WeChatApiClient;
  findUploadCache: (kind: UploadedAssetCache['kind'], contentHash: string) => UploadedAssetCache | null;
  rememberUploadCache: (entry: UploadedAssetCache) => Promise<void>;
}

export class WeChatPreviewView extends ItemView {
  private file: TFile | null = null;
  private snapshot: WeChatSnapshot | null = null;
  private titleValue = '';
  private authorValue = '';
  private digestValue = '';
  private coverValue = '';
  private coverMediaIdValue = '';
  private coverMode: CoverMode = 'first-image';
  private coverEditorOpen = false;
  private contentSourceUrlValue = '';
  private themeId = '';
  private loading = false;
  private operation: string | null = null;
  private error: string | null = null;
  private publishResult: { level: 'ok' | 'error'; message: string; detail?: string } | null = null;
  private lastHtmlAudit: HtmlAuditState | null = null;
  private publishLog: PublishLogEntry[] = [];
  private settingsDrawerOpen = false;
  private articleEl: HTMLElement | null = null;
  private checksEl: HTMLElement | null = null;
  private renderComponent: Component | null = null;
  private documentClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: PreviewViewDeps,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return WECHAT_DRAFT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return '公众号预览';
  }

  override getIcon(): string {
    return 'newspaper';
  }

  override async onOpen(): Promise<void> {
    this.containerEl.addClass('wechat-draft-view');
    this.themeId = this.deps.getSettings().defaultThemeId;
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        void this.setFile(file);
      }
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const active = this.app.workspace.getActiveFile();
      if (active instanceof TFile && active.extension === 'md') {
        void this.setFile(active);
      }
    }));
    await this.setFile(this.app.workspace.getActiveFile());
  }

  override async onClose(): Promise<void> {
    this.renderComponent?.unload();
    this.renderComponent = null;
  }

  async setFile(file: TFile | null): Promise<void> {
    if (file && file.extension !== 'md') return;
    if (this.file?.path === file?.path && this.snapshot) return;
    this.file = file;
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      if (!this.file) {
        this.snapshot = null;
        return;
      }
      const snapshot = await buildSnapshot(this.app, this.file, this.deps.getSettings());
      this.snapshot = snapshot;
      this.titleValue = snapshot.title;
      this.authorValue = snapshot.author;
      this.digestValue = snapshot.digest;
      this.coverValue = snapshot.cover;
      this.coverMediaIdValue = snapshot.coverMediaId;
      this.coverMode = snapshot.coverMediaId ? 'media-id' : snapshot.cover ? 'image' : 'first-image';
      this.contentSourceUrlValue = snapshot.contentSourceUrl;
    } catch (error) {
      this.error = error instanceof Error ? error.message : '公众号预览生成失败。';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private preparedSnapshot(): WeChatSnapshot | null {
    if (!this.snapshot) return null;
    return applySnapshotMetadata(this.snapshot, {
      title: this.titleValue,
      author: this.authorValue,
      digest: this.digestValue,
      cover: this.coverMode === 'image' ? this.coverValue : '',
      coverMediaId: this.coverMode === 'media-id' ? this.coverMediaIdValue : '',
      contentSourceUrl: this.contentSourceUrlValue,
    });
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('wechat-draft-view');
    contentEl.style.setProperty('--wechat-draft-accent', getTheme(this.themeId).color);
    this.renderHeader(contentEl);

    if (this.loading) {
      contentEl.createDiv({ cls: 'wechat-draft-empty', text: '正在生成公众号预览...' });
      return;
    }
    if (this.error) {
      contentEl.createDiv({ cls: 'wechat-draft-error', text: this.error });
      return;
    }
    if (!this.file || !this.snapshot) {
      contentEl.createDiv({ cls: 'wechat-draft-empty', text: '打开一篇 Markdown 笔记后即可预览公众号排版。' });
      return;
    }

    this.renderToolbar(contentEl);
    const workbench = contentEl.createDiv({ cls: `wechat-draft-workbench${this.settingsDrawerOpen ? ' is-drawer-open' : ''}` });
    const preview = workbench.createDiv({ cls: 'wechat-draft-preview-panel' });
    this.renderPreview(preview);
    this.renderSettingsDrawer(workbench);
  }

  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: 'wechat-draft-header' });
    const brand = header.createDiv({ cls: 'wechat-draft-brand' });
    brand.createEl('h2', { text: '公众号发布' });
    brand.createSpan({ text: this.file ? this.file.path : '未选择笔记' });

    const status = this.workbenchStatus();
    const statusEl = header.createDiv({ cls: `wechat-draft-header-status is-${status.level}` });
    const icon = statusEl.createSpan();
    setIcon(icon, status.icon);
    const copy = statusEl.createDiv();
    copy.createEl('strong', { text: status.label });
    copy.createSpan({ text: status.detail });
  }

  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: 'wechat-draft-toolbar' });
    const refresh = toolbar.createEl('button', { text: '刷新预览', attr: { type: 'button' } });
    refresh.disabled = Boolean(this.operation);
    refresh.onclick = () => void this.reload();

    const primaryAction = this.primaryPublishAction();
    const publish = toolbar.createEl('button', {
      cls: 'mod-cta',
      text: primaryAction.label,
      attr: { type: 'button' },
    });
    publish.disabled = Boolean(this.operation) || primaryAction.disabled;
    publish.onclick = () => void this.publish(false);

    const publishNew = toolbar.createEl('button', { text: '另存为新草稿', attr: { type: 'button' } });
    publishNew.disabled = Boolean(this.operation);
    publishNew.onclick = () => void this.publish(true);

    const copy = toolbar.createEl('button', { text: '复制全文', attr: { type: 'button' } });
    copy.disabled = Boolean(this.operation);
    copy.onclick = () => void this.copyToClipboard();

    const currentTheme = getTheme(this.themeId);
    const themeSelect = toolbar.createDiv({ cls: 'wechat-draft-theme-select' });
    const trigger = themeSelect.createEl('button', {
      cls: 'wechat-draft-theme-trigger',
      attr: { type: 'button', 'aria-label': '选择公众号主题', 'aria-haspopup': 'listbox' },
    });
    const triggerLabel = trigger.createSpan({ cls: 'wechat-draft-theme-trigger-label' });
    triggerLabel.createSpan({ cls: 'wechat-draft-theme-swatch', attr: { style: `--swatch: ${currentTheme.color}` } });
    triggerLabel.createSpan({ text: currentTheme.label });
    trigger.createSpan({ cls: 'wechat-draft-theme-caret', text: '▾' });

    const panel = themeSelect.createDiv({ cls: 'wechat-draft-theme-panel', attr: { role: 'listbox' } });
    panel.style.display = 'none';
    for (const theme of WECHAT_THEMES) {
      const item = panel.createDiv({
        cls: `wechat-draft-theme-item${theme.id === this.themeId ? ' is-selected' : ''}`,
        attr: { role: 'option', 'data-theme-id': theme.id, tabindex: '0' },
      });
      item.createSpan({ cls: 'wechat-draft-theme-swatch', attr: { style: `--swatch: ${theme.color}` } });
      const textWrap = item.createDiv({ cls: 'wechat-draft-theme-item-text' });
      textWrap.createDiv({ cls: 'wechat-draft-theme-item-name', text: theme.label });
      textWrap.createDiv({ cls: 'wechat-draft-theme-item-desc', text: theme.description });
      item.createSpan({ cls: 'wechat-draft-theme-check', text: '✓' });

      const pick = () => {
        this.themeId = theme.id;
        this.deps.getSettings().defaultThemeId = this.themeId;
        void this.deps.saveSettings().then(() => this.render());
      };
      item.onclick = pick;
      item.onkeydown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          pick();
        }
      };
    }

    const setPanelOpen = (open: boolean) => {
      panel.style.display = open ? 'block' : 'none';
      themeSelect.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (!open && this.documentClickHandler) {
        document.removeEventListener('click', this.documentClickHandler);
        this.documentClickHandler = null;
      }
    };
    trigger.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      const open = panel.style.display === 'none';
      setPanelOpen(open);
      if (open) {
        // 点击面板外部时关闭；使用自清理监听，避免重渲染导致累积。
        const handler = (e: MouseEvent) => {
          if (!themeSelect.contains(e.target as Node)) {
            setPanelOpen(false);
          }
        };
        this.documentClickHandler = handler;
        document.addEventListener('click', handler);
      }
    };
    themeSelect.onclick = (event: MouseEvent) => event.stopPropagation();

    const settings = toolbar.createEl('button', { text: this.settingsDrawerOpen ? '收起设置' : '发布设置', attr: { type: 'button' } });
    settings.onclick = () => {
      this.settingsDrawerOpen = !this.settingsDrawerOpen;
      this.render();
    };

    const status = this.workbenchStatus();
    const state = toolbar.createDiv({ cls: `wechat-draft-state is-${status.level}` });
    const icon = state.createSpan();
    setIcon(icon, status.icon);
    state.createSpan({ text: status.label });
  }

  private renderSettingsDrawer(parent: HTMLElement): void {
    if (!this.settingsDrawerOpen) return;
    const scrim = parent.createDiv({ cls: 'wechat-draft-drawer-scrim' });
    scrim.onclick = () => {
      this.settingsDrawerOpen = false;
      this.render();
    };

    const drawer = parent.createDiv({ cls: 'wechat-draft-settings-drawer' });
    const head = drawer.createDiv({ cls: 'wechat-draft-settings-drawer-head' });
    const title = head.createDiv();
    title.createEl('h3', { text: '发布设置' });
    title.createSpan({ text: '调整标题、封面、检查项和诊断信息。' });
    const close = head.createEl('button', { text: '收起', attr: { type: 'button' } });
    close.onclick = () => {
      this.settingsDrawerOpen = false;
      this.render();
    };

    const body = drawer.createDiv({ cls: 'wechat-draft-settings-drawer-body' });
    this.renderMetadataEditor(body);
    this.renderPublishResult(body);
    this.renderPublishChecks(body);
  }

  private renderMetadataEditor(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: 'wechat-draft-publish-settings' });
    const head = section.createDiv({ cls: 'wechat-draft-section-head' });
    head.createEl('h3', { text: '基础信息' });
    const save = head.createEl('button', { text: '保存到笔记属性', attr: { type: 'button' } });
    save.disabled = Boolean(this.operation);
    save.onclick = () => void this.savePublishMetadata();

    const meta = section.createDiv({ cls: 'wechat-draft-meta' });
    this.renderInput(meta, '标题', this.titleValue, (value) => {
      this.titleValue = value;
      void this.updatePreviewOnly();
    });
    this.renderInput(meta, '作者', this.authorValue, (value) => {
      this.authorValue = value;
      void this.updatePreviewOnly();
    });
    this.renderInput(meta, '摘要', this.digestValue, (value) => {
      this.digestValue = value;
      void this.updatePreviewOnly();
    });
    this.renderInput(meta, '原文链接', this.contentSourceUrlValue, (value) => {
      this.contentSourceUrlValue = value;
    });
    this.renderCoverPicker(section);
  }

  private renderCoverPicker(parent: HTMLElement): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const section = parent.createDiv({ cls: 'wechat-draft-cover' });
    const head = section.createDiv({ cls: 'wechat-draft-cover-head' });
    head.createEl('h4', { text: '封面' });
    head.createSpan({ text: this.coverSummary(snapshot) });

    const summary = section.createDiv({ cls: 'wechat-draft-cover-summary' });
    const preview = this.currentCoverAsset(snapshot);
    if (preview) {
      summary.createEl('img', { attr: { src: preview.previewUrl, alt: preview.fileName } });
    } else {
      const fallback = summary.createDiv({ cls: 'wechat-draft-cover-placeholder' });
      setIcon(fallback, this.coverMode === 'media-id' ? 'image' : 'image-off');
    }
    const copy = summary.createDiv();
    copy.createEl('strong', { text: this.coverSummaryTitle(snapshot) });
    copy.createSpan({ text: this.coverSummaryDetail(snapshot) });
    const change = summary.createEl('button', {
      text: this.coverEditorOpen ? '收起' : '更换',
      attr: { type: 'button' },
    });
    change.disabled = Boolean(this.operation);
    change.onclick = () => {
      this.coverEditorOpen = !this.coverEditorOpen;
      this.render();
    };

    if (!this.coverEditorOpen) return;

    const modes = section.createDiv({ cls: 'wechat-draft-cover-modes' });
    this.renderCoverMode(modes, 'first-image', '使用正文第一张图', '适合大多数文章，发布时会上传为微信永久素材。');
    this.renderCoverMode(modes, 'image', '使用指定图片', '从当前笔记检测到的图片里选择一张。');
    this.renderCoverMode(modes, 'media-id', '使用已有微信素材 media_id', '适合已经在公众号后台上传过封面的情况。');

    if (this.coverMode === 'image') {
      const grid = section.createDiv({ cls: 'wechat-draft-cover-grid' });
      if (snapshot.assets.length === 0) {
        grid.createDiv({ cls: 'wechat-draft-cover-empty', text: '当前笔记还没有检测到图片。' });
      }
      for (const asset of snapshot.assets) {
        const item = grid.createEl('button', {
          cls: `wechat-draft-cover-card${asset.originalUrl === this.coverValue ? ' is-selected' : ''}`,
          attr: { type: 'button' },
        });
        item.disabled = Boolean(this.operation);
        item.onclick = () => {
          this.coverMode = 'image';
          this.coverValue = asset.originalUrl;
          this.render();
        };
        item.createEl('img', { attr: { src: asset.previewUrl, alt: asset.fileName } });
        const copy = item.createDiv();
        copy.createEl('strong', { text: asset.fileName });
        copy.createSpan({ text: `${formatBytes(asset.byteLength)} · ${asset.mimeType}` });
      }
    }

    if (this.coverMode === 'media-id') {
      this.renderInput(section, '微信素材 media_id', this.coverMediaIdValue, (value) => {
        this.coverMediaIdValue = value.trim();
      });
    }
  }

  private renderCoverMode(
    parent: HTMLElement,
    value: CoverMode,
    title: string,
    detail: string,
  ): void {
    const row = parent.createEl('label', { cls: `wechat-draft-cover-mode${this.coverMode === value ? ' is-selected' : ''}` });
    const input = row.createEl('input', { attr: { type: 'radio', name: 'wechat-cover-mode', value } });
    input.checked = this.coverMode === value;
    input.disabled = Boolean(this.operation);
    input.onchange = () => {
      this.coverMode = value;
      if (value === 'first-image') {
        this.coverValue = '';
        this.coverMediaIdValue = '';
      } else if (value === 'image') {
        this.coverMediaIdValue = '';
        this.coverValue = this.coverValue || this.snapshot?.assets[0]?.originalUrl || '';
      } else {
        this.coverValue = '';
      }
      this.render();
    };
    const copy = row.createDiv();
    copy.createEl('strong', { text: title });
    copy.createSpan({ text: detail });
  }

  private coverSummary(snapshot: WeChatSnapshot): string {
    if (this.coverMode === 'media-id') {
      return this.coverMediaIdValue.trim() ? '将使用已有微信素材' : '需要填写 media_id';
    }
    if (this.coverMode === 'image') {
      const coverAsset = snapshot.assets.find((asset) => asset.originalUrl === this.coverValue.trim());
      return coverAsset ? `将使用 ${coverAsset.fileName}` : '需要选择一张图片';
    }
    return snapshot.assets[0] ? `将使用正文第一张图：${snapshot.assets[0].fileName}` : '正文没有图片，将尝试使用默认封面素材 ID';
  }

  private currentCoverAsset(snapshot: WeChatSnapshot): WeChatAsset | null {
    if (this.coverMode === 'media-id') return null;
    if (this.coverMode === 'image') {
      return snapshot.assets.find((asset) => asset.originalUrl === this.coverValue.trim()) ?? null;
    }
    return snapshot.assets[0] ?? null;
  }

  private coverSummaryTitle(snapshot: WeChatSnapshot): string {
    const asset = this.currentCoverAsset(snapshot);
    if (asset) return asset.fileName;
    if (this.coverMode === 'media-id') return this.coverMediaIdValue.trim() ? '微信素材 media_id' : '未填写 media_id';
    return '未选择封面图片';
  }

  private coverSummaryDetail(snapshot: WeChatSnapshot): string {
    const asset = this.currentCoverAsset(snapshot);
    if (asset) return `${formatBytes(asset.byteLength)} · 发布时会上传为封面素材`;
    if (this.coverMode === 'media-id') {
      return this.coverMediaIdValue.trim()
        ? '发布时会使用已上传素材，不再上传封面图片'
        : '填写公众号后台已有图片素材的 media_id';
    }
    return this.deps.getSettings().defaultCoverMediaId.trim()
      ? '当前笔记没有图片，将使用设置页默认封面素材 ID'
      : '发布前需要选择图片或填写 media_id';
  }

  private renderPublishChecks(parent: HTMLElement): void {
    this.checksEl = parent.createDiv();
    this.renderPublishChecksContent(this.checksEl);
  }

  private renderPublishChecksContent(parent: HTMLElement): void {
    const snapshot = this.preparedSnapshot();
    if (!snapshot) return;
    const panel = parent.createDiv({ cls: 'wechat-draft-checks' });
    const head = panel.createDiv({ cls: 'wechat-draft-checks-head' });
    head.createEl('h3', { text: '发布检查' });
    const issues = this.publishIssues(snapshot);
    head.createSpan({
      cls: issues.some((issue) => issue.level === 'error') ? 'is-error' : 'is-ok',
      text: issues.some((issue) => issue.level === 'error')
        ? `${issues.filter((issue) => issue.level === 'error').length} 项需处理`
        : '检查通过',
    });
    const list = panel.createDiv({ cls: 'wechat-draft-check-list' });
    for (const issue of issues) {
      const row = list.createDiv({ cls: `wechat-draft-check-item is-${issue.level}` });
      const icon = row.createSpan();
      setIcon(icon, issue.level === 'ok' ? 'circle-check' : issue.level === 'warn' ? 'triangle-alert' : 'circle-alert');
      const copy = row.createDiv();
      copy.createEl('strong', { text: issue.title });
      copy.createSpan({ text: issue.detail });
      if (issue.actions?.length) {
        const actions = copy.createDiv({ cls: 'wechat-draft-check-actions' });
        for (const action of issue.actions) {
          const button = actions.createEl('button', { text: action.label, attr: { type: 'button' } });
          button.disabled = Boolean(this.operation);
          button.onclick = () => action.run();
        }
      }
    }
  }

  private refreshPublishChecks(): void {
    if (!this.checksEl?.isConnected) return;
    this.checksEl.empty();
    this.renderPublishChecksContent(this.checksEl);
  }

  private publishIssues(snapshot: WeChatSnapshot): PublishCheckIssue[] {
    const issues: PublishCheckIssue[] = [];
    const draft = this.currentDraftState();
    const coverAsset = this.chooseCoverAsset(snapshot);
    const coverMediaId = snapshot.coverMediaId.trim() || this.deps.getSettings().defaultCoverMediaId.trim();
    const publicationHash = this.publicationHash(snapshot);

    for (const warning of snapshot.warnings) {
      issues.push({
        level: warning.blocking ? 'error' : 'warn',
        title: '图片检查',
        detail: warning.message,
      });
    }

    issues.push(snapshot.title.trim()
      ? { level: 'ok', title: '标题', detail: snapshot.title.trim() }
      : {
        level: 'error',
        title: '标题缺失',
        detail: '发布前必须填写文章标题。',
        actions: this.suggestTitle()
          ? [{ label: '使用笔记标题', run: () => this.useSuggestedTitle() }]
          : undefined,
      });

    issues.push(snapshot.digest.trim()
      ? {
        level: snapshot.digest.length > 120 ? 'warn' : 'ok',
        title: '摘要',
        detail: snapshot.digest.length > 120 ? '摘要超过 120 字，微信可能截断显示。' : snapshot.digest,
        actions: snapshot.digest.length > 120
          ? [{ label: '截断到 120 字', run: () => this.useTrimmedDigest() }]
          : undefined,
      }
      : {
        level: 'warn',
        title: '摘要为空',
        detail: '可以发布，但分享卡片吸引力会变弱。',
        actions: this.suggestDigest()
          ? [{ label: '使用正文首段', run: () => this.useSuggestedDigest() }]
          : undefined,
      });

    issues.push(coverAsset || coverMediaId
      ? {
        level: 'ok',
        title: '封面',
        detail: coverAsset
          ? `将上传并使用 ${coverAsset.fileName}`
          : snapshot.coverMediaId.trim()
            ? '将使用当前笔记填写的微信素材 media_id。'
            : '将使用设置页默认封面素材 ID。',
      }
      : {
        level: 'error',
        title: '封面缺失',
        detail: '请选择正文图片作为封面，或填写微信素材 media_id。',
        actions: this.coverMissingActions(snapshot),
      });

    issues.push(snapshot.assets.length > 0
      ? { level: 'ok', title: '正文图片', detail: `检测到 ${snapshot.assets.length} 张图片，总计 ${formatBytes(snapshot.assets.reduce((sum, asset) => sum + asset.byteLength, 0))}。` }
      : { level: 'warn', title: '正文无图片', detail: '可以发布，但文章视觉表现会比较弱。' });

    if (!draft) {
      issues.push({ level: 'ok', title: '草稿状态', detail: '当前笔记还未关联公众号草稿，将创建新草稿。' });
    } else if (draft.contentHash === publicationHash) {
      issues.push({ level: 'ok', title: '草稿状态', detail: `已关联草稿，最近同步于 ${formatDateTime(draft.updatedAt)}。` });
    } else {
      issues.push({
        level: 'warn',
        title: '草稿状态',
        detail: '当前内容或主题有更新，建议点击“更新草稿”。',
        actions: [
          { label: '更新草稿', run: () => void this.publish(false) },
          { label: '另存为新草稿', run: () => void this.publish(true) },
        ],
      });
    }

    const copyAudit = this.lastHtmlAudit?.source === 'copy'
      && this.lastHtmlAudit.publicationHash === publicationHash
      ? this.lastHtmlAudit.result
      : null;
    const publishAudit = this.lastHtmlAudit?.source === 'publish'
      && this.lastHtmlAudit.publicationHash === publicationHash
      ? this.lastHtmlAudit.result
      : null;
    if (!publishAudit) {
      issues.push({
        level: 'ok',
        title: 'HTML 兼容性',
        detail: '发布时会上传图片并自动移除高风险标签和不兼容属性。',
      });
    } else {
      const htmlErrors = publishAudit.issues.filter((issue) => issue.level === 'error');
      const htmlWarnings = publishAudit.issues.filter((issue) => issue.level === 'warn');
      if (htmlErrors.length > 0) {
        issues.push({
          level: 'error',
          title: 'HTML 兼容性',
          detail: htmlErrors[0].detail,
        });
      } else if (htmlWarnings.length > 0) {
        issues.push({
          level: 'warn',
          title: 'HTML 兼容性',
          detail: `${htmlWarnings.length} 个提示，最终 HTML ${formatBytes(publishAudit.byteLength)}。`,
        });
      } else {
        issues.push({
          level: 'ok',
          title: 'HTML 兼容性',
          detail: `未发现兼容性问题，最终 HTML ${formatBytes(publishAudit.byteLength)}。`,
        });
      }
    }

    if (copyAudit?.issues.length) {
      issues.push({
        level: 'warn',
        title: '复制全文',
        detail: `上次复制产生 ${copyAudit.issues.length} 个兼容性提示；不影响发布草稿。`,
      });
    }

    return issues;
  }

  private coverMissingActions(snapshot: WeChatSnapshot): PublishCheckAction[] {
    const actions: PublishCheckAction[] = [];
    if (snapshot.assets.length > 0) {
      actions.push({
        label: '使用正文第一张图',
        run: () => {
          this.coverMode = 'first-image';
          this.coverValue = '';
          this.coverMediaIdValue = '';
          this.render();
        },
      });
      actions.push({
        label: '选择指定图片',
        run: () => {
          this.coverMode = 'image';
          this.coverValue = snapshot.assets[0]?.originalUrl ?? '';
          this.coverMediaIdValue = '';
          this.render();
        },
      });
    }
    actions.push({
      label: '填写 media_id',
      run: () => {
        this.coverMode = 'media-id';
        this.coverValue = '';
        this.render();
      },
    });
    return actions;
  }

  private suggestTitle(): string {
    return this.snapshot?.title.trim() || this.file?.basename.trim() || '';
  }

  private useSuggestedTitle(): void {
    const title = this.suggestTitle();
    if (!title) {
      new Notice('没有找到可用的笔记标题。');
      return;
    }
    this.titleValue = title;
    this.render();
  }

  private suggestDigest(): string {
    const markdown = this.snapshot?.markdown ?? '';
    const cleaned = markdown
      .replace(/^#{1,6}\s+.+$/gm, '')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/!\[\[[^\]]+]]/g, '')
      .replace(/\[[^\]]+]\([^)]+\)/g, '$1')
      .split(/\n{2,}/)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .find(Boolean);
    return cleaned?.slice(0, 120) ?? '';
  }

  private useSuggestedDigest(): void {
    const digest = this.suggestDigest();
    if (!digest) {
      new Notice('没有找到可用的正文首段。');
      return;
    }
    this.digestValue = digest;
    this.render();
  }

  private useTrimmedDigest(): void {
    this.digestValue = this.digestValue.trim().slice(0, 120);
    this.render();
  }

  private renderInput(
    parent: HTMLElement,
    label: string,
    value: string,
    onChange: (value: string) => void,
  ): void {
    const row = parent.createEl('label', { cls: 'wechat-draft-meta-row' });
    row.createSpan({ text: label });
    const input = row.createEl('input', { attr: { type: 'text' } });
    input.value = value;
    input.oninput = () => {
      onChange(input.value);
      this.refreshPublishChecks();
    };
  }

  private renderPreview(parent: HTMLElement): void {
    const body = parent.createDiv({ cls: 'wechat-draft-body' });
    const canvas = body.createDiv({ cls: 'wechat-draft-canvas' });
    this.articleEl = canvas.createDiv();
    void this.updatePreviewOnly();
  }

  private renderPublishResult(parent: HTMLElement): void {
    if (!this.publishResult) return;
    const result = parent.createDiv({ cls: `wechat-draft-result is-${this.publishResult.level}` });
    const icon = result.createSpan();
    setIcon(icon, this.publishResult.level === 'ok' ? 'circle-check' : 'circle-alert');
    const copy = result.createDiv();
    copy.createEl('strong', { text: this.publishResult.message });
    if (this.publishResult.detail) copy.createSpan({ text: this.publishResult.detail });
    if (this.publishLog.length > 0) {
      const actions = copy.createDiv({ cls: 'wechat-draft-result-actions' });
      const diagnostics = actions.createEl('button', { text: '复制诊断信息', attr: { type: 'button' } });
      diagnostics.onclick = () => void this.copyPublishDiagnostics();
    }
  }

  private async updatePreviewOnly(): Promise<void> {
    const snapshot = this.preparedSnapshot();
    if (!snapshot || !this.articleEl?.isConnected) return;
    this.renderComponent?.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();
    await renderWeChatArticle(this.app, this.renderComponent, snapshot, this.articleEl, {
      themeId: this.themeId,
    });
  }

  private resetPublishLog(step: string, detail?: string): void {
    this.publishLog = [];
    this.addPublishLog(step, detail);
  }

  private addPublishLog(step: string, detail?: string): void {
    this.publishLog.push({
      time: new Date().toISOString(),
      step,
      detail,
    });
  }

  private async copyPublishDiagnostics(): Promise<void> {
    const snapshot = this.preparedSnapshot();
    await navigator.clipboard.writeText(JSON.stringify({
      sourcePath: this.file?.path,
      title: snapshot?.title,
      themeId: this.themeId,
      draftId: this.currentDraftState()?.draftId,
      publishResult: this.publishResult,
      imageCount: snapshot?.assets.length ?? 0,
      assetCacheCount: this.deps.getSettings().assetCache.length,
      log: this.publishLog,
    }, null, 2));
    new Notice('诊断信息已复制。');
  }

  private async retryOperation<T>(
    label: string,
    run: () => Promise<T>,
    maxAttempts = 2,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (attempt > 1) this.addPublishLog(`${label} 重试`, `第 ${attempt}/${maxAttempts} 次`);
        return await run();
      } catch (error) {
        lastError = error;
        const message = errorMessage(error);
        this.addPublishLog(`${label} 失败`, `第 ${attempt}/${maxAttempts} 次：${message}`);
        if (error instanceof WeChatApiError && error.code) break;
        if (attempt < maxAttempts) await sleep(700 * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${label} 失败。`);
  }

  private async copyToClipboard(): Promise<void> {
    const snapshot = this.preparedSnapshot();
    if (!snapshot) return;
    this.resetPublishLog('开始复制全文', snapshot.sourcePath);
    this.operation = '正在准备复制...';
    this.error = null;
    this.publishResult = null;
    this.render();
    const host = document.body.createDiv();
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    const component = new Component();
    component.load();
    try {
      const imageUrls = await this.uploadContentImages(snapshot);
      this.addPublishLog('正文图片处理完成', `${imageUrls.size}/${snapshot.assets.filter((asset) => snapshot.markdown.includes(asset.originalUrl)).length} 张`);
      this.operation = '正在复制全文...';
      this.render();
      await renderWeChatArticle(this.app, component, snapshot, host, {
        themeId: this.themeId,
        imageUrls,
      });
      const article = host.querySelector<HTMLElement>('.wechat-draft-article');
      if (!article) throw new Error('没有可复制的公众号正文。');
      const sanitized = sanitizeWeChatArticle(article);
      this.lastHtmlAudit = {
        source: 'copy',
        publicationHash: this.publicationHash(snapshot),
        result: sanitized,
      };
      await writeHtmlToClipboard(sanitized.html);
      this.addPublishLog('HTML 已复制到剪贴板', formatBytes(sanitized.byteLength));
      const message = sanitized.issues.length > 0
        ? `全文已复制，存在 ${sanitized.issues.length} 个兼容性提示。`
        : '全文已复制，图片已处理。';
      this.publishResult = {
        level: 'ok',
        message: '全文已复制。',
        detail: `正文图片 ${imageUrls.size} 张，HTML ${formatBytes(sanitized.byteLength)}。`,
      };
      new Notice(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '复制失败。';
      this.addPublishLog('复制失败', detail);
      this.publishResult = {
        level: 'error',
        message: '复制失败。',
        detail,
      };
      new Notice(detail);
    } finally {
      component.unload();
      host.remove();
      this.operation = null;
      this.render();
    }
  }

  private async savePublishMetadata(): Promise<void> {
    if (!this.file) return;
    const title = this.titleValue.trim();
    const author = this.authorValue.trim();
    const digest = this.digestValue.trim();
    const cover = this.coverMode === 'image' ? this.coverValue.trim() : '';
    const coverMediaId = this.coverMode === 'media-id' ? this.coverMediaIdValue.trim() : '';
    const contentSourceUrl = this.contentSourceUrlValue.trim();
    await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
      writeOptionalFrontmatter(frontmatter, 'title', title);
      writeOptionalFrontmatter(frontmatter, 'author', author);
      writeOptionalFrontmatter(frontmatter, 'digest', digest);
      writeOptionalFrontmatter(frontmatter, 'cover', cover);
      writeOptionalFrontmatter(frontmatter, 'cover_media_id', coverMediaId);
      writeOptionalFrontmatter(frontmatter, 'content_source_url', contentSourceUrl);
    });
    this.publishResult = { level: 'ok', message: '发布设置已保存。' };
    await this.reload();
  }

  private currentDraftState(): WeChatDraftFrontmatter | null {
    if (!this.file) return null;
    return readWeChatDraftFrontmatter(
      this.app.metadataCache.getFileCache(this.file)?.frontmatter,
    );
  }

  private primaryPublishAction(): { label: string; disabled: boolean } {
    const snapshot = this.preparedSnapshot();
    const draft = this.currentDraftState();
    if (!snapshot) return { label: '发布到草稿箱', disabled: true };
    if (!draft) return { label: '发布到草稿箱', disabled: false };
    return draft.contentHash === this.publicationHash(snapshot)
      ? { label: '草稿已是最新', disabled: true }
      : { label: '更新草稿', disabled: false };
  }

  private workbenchStatus(): WorkbenchStatus {
    if (this.operation) {
      return {
        level: 'busy',
        icon: 'loader-circle',
        label: this.operation,
        detail: '正在处理发布任务，请保持 Obsidian 打开。',
      };
    }
    if (this.loading) {
      return {
        level: 'busy',
        icon: 'loader-circle',
        label: '正在生成预览',
        detail: '解析当前笔记、图片和发布属性。',
      };
    }
    if (this.error) {
      return {
        level: 'error',
        icon: 'circle-alert',
        label: '预览失败',
        detail: this.error,
      };
    }
    const snapshot = this.preparedSnapshot();
    const draft = this.currentDraftState();
    if (!snapshot) {
      return {
        level: 'idle',
        icon: 'file-text',
        label: '等待预览',
        detail: '打开一篇 Markdown 笔记后开始。',
      };
    }
    if (!draft) {
      return {
        level: 'idle',
        icon: 'circle-dot',
        label: '尚未发布',
        detail: '将创建新的公众号草稿。',
      };
    }
    const publicationHash = this.publicationHash(snapshot);
    return draft.contentHash === publicationHash
      ? {
        level: 'ok',
        icon: 'circle-check',
        label: '草稿已是最新',
        detail: `最近同步 ${formatDateTime(draft.updatedAt)}。`,
      }
      : {
        level: 'warn',
        icon: 'triangle-alert',
        label: '有更新待同步',
        detail: '当前内容或主题已变化。',
      };
  }

  private statusLabel(): string {
    return this.workbenchStatus().label;
  }

  private publicationHash(snapshot: WeChatSnapshot): string {
    return `${snapshot.contentHash}:${this.themeId}`;
  }

  private async publish(asNew: boolean): Promise<void> {
    if (!this.file) return;
    const snapshot = this.preparedSnapshot();
    if (!snapshot) return;
    if (!snapshot.title.trim()) {
      new Notice('请先填写文章标题。');
      return;
    }
    const blockingIssue = this.publishIssues(snapshot).find((issue) => issue.level === 'error');
    if (blockingIssue) {
      new Notice(`${blockingIssue.title}：${blockingIssue.detail}`);
      return;
    }
    this.resetPublishLog(asNew ? '开始另存为新草稿' : '开始发布草稿', snapshot.sourcePath);
    this.operation = '正在准备发布...';
    this.error = null;
    this.publishResult = null;
    this.render();
    const host = document.body.createDiv();
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    const component = new Component();
    component.load();
    try {
      const imageUrls = await this.uploadContentImages(snapshot);
      this.addPublishLog('正文图片处理完成', `${imageUrls.size}/${snapshot.assets.filter((asset) => snapshot.markdown.includes(asset.originalUrl)).length} 张`);
      this.operation = '正在生成公众号正文...';
      this.render();
      await renderWeChatArticle(this.app, component, snapshot, host, {
        themeId: this.themeId,
        imageUrls,
      });
      const article = host.querySelector<HTMLElement>('.wechat-draft-article');
      if (!article) throw new Error('没有可发布的公众号正文。');
      const sanitized = sanitizeWeChatArticle(article);
      this.addPublishLog('HTML 已生成', formatBytes(sanitized.byteLength));
      const contentHash = this.publicationHash(snapshot);
      this.lastHtmlAudit = {
        source: 'publish',
        publicationHash: contentHash,
        result: sanitized,
      };
      const htmlError = sanitized.issues.find((issue) => issue.level === 'error');
      if (htmlError) {
        throw new Error(`${htmlError.title}：${htmlError.detail}`);
      }
      const content = sanitized.html;
      const thumbMediaId = await this.resolveCoverMediaId(snapshot);
      this.addPublishLog('封面素材就绪', thumbMediaId);
      const payload = {
        title: snapshot.title,
        ...(snapshot.author ? { author: snapshot.author } : {}),
        ...(snapshot.digest ? { digest: snapshot.digest } : {}),
        ...(snapshot.contentSourceUrl ? { contentSourceUrl: snapshot.contentSourceUrl } : {}),
        content,
        thumbMediaId,
      };
      const existing = asNew ? null : this.currentDraftState();
      this.operation = existing ? '正在更新公众号草稿...' : '正在创建公众号草稿...';
      this.render();
      this.addPublishLog(existing ? '请求更新草稿' : '请求创建草稿', existing?.draftId);
      const result = existing
        ? await this.deps.api.updateDraft(existing.draftId, payload)
        : await this.deps.api.addDraft(payload);
      this.addPublishLog('微信草稿接口成功', result.mediaId);
      const updatedAt = new Date().toISOString();
      await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
        writeWeChatDraftFrontmatter(frontmatter, {
          draftId: result.mediaId,
          contentHash,
          themeId: this.themeId,
          updatedAt,
          coverMediaId: thumbMediaId,
        });
      });
      const message = existing ? '公众号草稿已更新。' : '已发布到公众号草稿箱。';
      this.publishResult = {
        level: 'ok',
        message,
        detail: `草稿 ID：${result.mediaId}。正文图片 ${imageUrls.size} 张，封面已就绪。HTML ${formatBytes(sanitized.byteLength)}。`,
      };
      new Notice(message);
      await this.reload();
    } catch (error) {
      const detail = error instanceof Error ? error.message : '公众号草稿发布失败。';
      this.addPublishLog('发布失败', detail);
      this.publishResult = {
        level: 'error',
        message: '公众号草稿发布失败。',
        detail,
      };
      new Notice(detail);
    } finally {
      component.unload();
      host.remove();
      this.operation = null;
      this.render();
    }
  }

  private async uploadContentImages(snapshot: WeChatSnapshot): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    const assets = snapshot.assets.filter((asset) => snapshot.markdown.includes(asset.originalUrl));
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const cached = this.deps.findUploadCache('content-image', asset.contentHash);
      if (cached?.url) {
        this.addPublishLog('正文图片缓存命中', `${asset.fileName} -> ${cached.url}`);
        urls.set(asset.contentHash, cached.url);
        continue;
      }
      this.operation = `正在上传正文图片 ${index + 1}/${assets.length}...`;
      this.render();
      this.addPublishLog('开始上传正文图片', `${index + 1}/${assets.length} ${asset.fileName} ${formatBytes(asset.byteLength)}`);
      const url = await this.retryOperation(
        `上传正文图片 ${asset.fileName}`,
        () => this.deps.api.uploadArticleImage(asset),
        3,
      ).catch((error) => {
        throw new Error(`正文图片上传失败：${asset.fileName}。${errorMessage(error)}`);
      });
      this.addPublishLog('正文图片上传成功', `${asset.fileName} -> ${url}`);
      urls.set(asset.contentHash, url);
      await this.deps.rememberUploadCache({
        kind: 'content-image',
        contentHash: asset.contentHash,
        url,
        uploadedAt: new Date().toISOString(),
      });
    }
    return urls;
  }

  private async resolveCoverMediaId(snapshot: WeChatSnapshot): Promise<string> {
    const settings = this.deps.getSettings();
    if (snapshot.coverMediaId.trim()) return snapshot.coverMediaId.trim();
    const coverAsset = this.chooseCoverAsset(snapshot);
    if (!coverAsset) {
      if (settings.defaultCoverMediaId.trim()) {
        this.addPublishLog('使用默认封面素材 ID', settings.defaultCoverMediaId.trim());
        return settings.defaultCoverMediaId.trim();
      }
      throw new Error('没有可用封面。请设置 cover frontmatter、使用正文图片，或在设置页填写默认封面素材 ID。');
    }
    const cached = this.deps.findUploadCache('cover', coverAsset.contentHash);
    if (cached?.mediaId) {
      this.addPublishLog('封面素材缓存命中', `${coverAsset.fileName} -> ${cached.mediaId}`);
      return cached.mediaId;
    }
    this.operation = '正在上传封面素材...';
    this.render();
    this.addPublishLog('开始上传封面素材', `${coverAsset.fileName} ${formatBytes(coverAsset.byteLength)}`);
    const mediaId = await this.retryOperation(
      `上传封面素材 ${coverAsset.fileName}`,
      () => this.deps.api.uploadCoverMaterial(coverAsset),
      3,
    ).catch((error) => {
      throw new Error(`封面素材上传失败：${coverAsset.fileName}。${errorMessage(error)}`);
    });
    this.addPublishLog('封面素材上传成功', `${coverAsset.fileName} -> ${mediaId}`);
    await this.deps.rememberUploadCache({
      kind: 'cover',
      contentHash: coverAsset.contentHash,
      mediaId,
      uploadedAt: new Date().toISOString(),
    });
    return mediaId;
  }

  private chooseCoverAsset(snapshot: WeChatSnapshot): WeChatAsset | null {
    if (snapshot.coverMediaId.trim()) return null;
    if (snapshot.coverAssetHash) {
      const cover = snapshot.assets.find((asset) => asset.contentHash === snapshot.coverAssetHash);
      if (cover) return cover;
    }
    return snapshot.assets[0] ?? null;
  }
}

function formatDateTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value || '未知时间';
  return new Date(time).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function writeOptionalFrontmatter(frontmatter: Record<string, unknown>, key: string, value: string): void {
  if (value) frontmatter[key] = value;
  else delete frontmatter[key];
}

async function writeHtmlToClipboard(html: string): Promise<void> {
  const clipboard = navigator.clipboard;
  const itemCtor = window.ClipboardItem;
  if (clipboard?.write && itemCtor) {
    await clipboard.write([
      new itemCtor({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(html);
}
