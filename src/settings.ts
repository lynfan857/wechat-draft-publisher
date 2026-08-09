import { App, Notice, PluginSettingTab, Setting } from 'obsidian';

import type WeChatDraftPublisherPlugin from './main';
import { WECHAT_THEMES } from './themes';

export const APP_SECRET_KEY = 'wechat-draft-publisher-app-secret';

export class WeChatDraftPublisherSettingTab extends PluginSettingTab {
  private connectionMessage = '';
  private connectionLevel: 'info' | 'ok' | 'error' = 'info';
  private currentPublicIp = '';

  constructor(
    app: App,
    private readonly plugin: WeChatDraftPublisherPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'WeChat Draft Publisher' });
    containerEl.createDiv({
      cls: 'wechat-draft-settings-note',
      text: '把 Obsidian 笔记预览、排版并发布到微信公众号草稿箱。',
    });

    this.renderWechatSection(containerEl);
    this.renderDefaultsSection(containerEl);
    this.renderAdvancedSection(containerEl);
    this.renderApiHelp(containerEl);
  }

  private createSection(parent: HTMLElement, title: string, desc?: string): HTMLElement {
    const section = parent.createDiv({ cls: 'wechat-draft-settings-section' });
    section.createEl('h3', { text: title });
    if (desc) section.createEl('p', { text: desc });
    return section;
  }

  private renderWechatSection(parent: HTMLElement): void {
    const section = this.createSection(
      parent,
      '微信公众号',
      '填写公众号后台“设置与开发 -> 基本配置”里的 AppID/AppSecret，并确认当前公网 IP 已加入白名单。',
    );

    new Setting(section)
      .setName('AppID')
      .setDesc('微信公众号后台“设置与开发 -> 基本配置”里的 AppID。')
      .addText((text) => {
        text
          .setPlaceholder('wx...')
          .setValue(this.plugin.settings.appId)
          .onChange(async (value) => {
            this.plugin.settings.appId = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName('AppSecret')
      .setDesc('只保存在 Obsidian SecretStorage 中，不写入 data.json。输入新值后必须点击保存才会覆盖。')
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder(this.plugin.hasAppSecret() ? '已保存，输入新值后点保存' : '输入 AppSecret');
      })
      .addButton((button) => {
        button
          .setButtonText('保存 AppSecret')
          .onClick(async () => {
            const input = button.buttonEl.parentElement?.querySelector('input');
            const value = input instanceof HTMLInputElement ? input.value.trim() : '';
            if (!value) {
              this.connectionLevel = 'info';
              this.connectionMessage = 'AppSecret 输入框为空，没有覆盖已保存的值。';
              this.display();
              return;
            }
            await this.plugin.saveAppSecret(value);
            if (input instanceof HTMLInputElement) input.value = '';
            this.connectionLevel = 'ok';
            this.connectionMessage = 'AppSecret 已保存。';
            this.display();
          });
      });

    new Setting(section)
      .setName('当前公网 IP')
      .setDesc(this.currentPublicIp
        ? `已检测到：${this.currentPublicIp}`
        : '本机直连微信 API 时，需要把这个 IP 加到微信公众号后台 IP 白名单。')
      .addButton((button) => {
        button
          .setButtonText('复制当前 IP')
          .onClick(async () => {
            button.setButtonText('检测中...');
            try {
              const ip = await this.plugin.wechatApi.getCurrentPublicIp();
              this.currentPublicIp = ip;
              await navigator.clipboard.writeText(ip);
              this.connectionLevel = 'ok';
              this.connectionMessage = `已复制当前公网 IP：${ip}`;
              this.display();
            } catch (error) {
              this.connectionLevel = 'error';
              this.connectionMessage = error instanceof Error ? error.message : '公网 IP 检测失败。';
              this.display();
            }
          });
      })
      .addButton((button) => {
        button
          .setButtonText('打开公众号后台')
          .onClick(() => {
            window.open('https://mp.weixin.qq.com/', '_blank');
          });
      });

    new Setting(section)
      .setName('测试连接')
      .setDesc('尝试获取 access_token，用于检查 AppID、AppSecret 和 IP 白名单。')
      .addButton((button) => {
        button
          .setButtonText('测试连接')
          .setCta()
          .onClick(async () => {
            button.setButtonText('测试中...');
            try {
              await this.plugin.wechatApi.testConnection();
              this.connectionLevel = 'ok';
              this.connectionMessage = `连接正常。最近测试：${new Date().toLocaleString()}`;
              this.display();
            } catch (error) {
              this.connectionLevel = 'error';
              this.connectionMessage = error instanceof Error ? error.message : '测试连接失败。';
              this.display();
            }
          });
      });

    if (this.connectionMessage) {
      section.createDiv({
        cls: `wechat-draft-settings-status is-${this.connectionLevel}`,
        text: this.connectionMessage,
      });
    }
  }

  private renderDefaultsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, '默认发布信息');

    new Setting(section)
      .setName('默认作者')
      .setDesc('当前笔记没有 author frontmatter 时使用。')
      .addText((text) => {
        text
          .setPlaceholder('作者名')
          .setValue(this.plugin.settings.defaultAuthor)
          .onChange(async (value) => {
            this.plugin.settings.defaultAuthor = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName('默认主题')
      .setDesc('打开预览时默认使用的公众号排版主题。')
      .addDropdown((dropdown) => {
        for (const theme of WECHAT_THEMES) {
          dropdown.addOption(theme.id, theme.label);
        }
        dropdown
          .setValue(this.plugin.settings.defaultThemeId)
          .onChange(async (value) => {
            this.plugin.settings.defaultThemeId = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName('默认封面素材 ID')
      .setDesc('当当前笔记没有封面图片，也没有 cover_media_id 时使用。')
      .addText((text) => {
        text
          .setPlaceholder('media_id')
          .setValue(this.plugin.settings.defaultCoverMediaId)
          .onChange(async (value) => {
            this.plugin.settings.defaultCoverMediaId = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }

  private renderAdvancedSection(parent: HTMLElement): void {
    const section = this.createSection(parent, '高级');

    new Setting(section)
      .setName('上传缓存')
      .setDesc(`当前缓存 ${this.plugin.settings.assetCache.length} 条。清除后会重新上传正文图片和封面素材。`)
      .addButton((button) => {
        button
          .setButtonText('清除上传缓存')
          .onClick(async () => {
            this.plugin.settings.assetCache = [];
            await this.plugin.saveSettings();
            new Notice('上传缓存已清除。');
            this.display();
          });
      });

    new Setting(section)
      .setName('诊断信息')
      .setDesc('复制不含 AppSecret 的基础诊断信息，用于排查安装和发布问题。')
      .addButton((button) => {
        button
          .setButtonText('复制诊断信息')
          .onClick(async () => {
            await navigator.clipboard.writeText(JSON.stringify({
              pluginVersion: this.plugin.manifest.version,
              appIdConfigured: Boolean(this.plugin.settings.appId.trim()),
              appSecretConfigured: this.plugin.hasAppSecret(),
              defaultThemeId: this.plugin.settings.defaultThemeId,
              defaultAuthorConfigured: Boolean(this.plugin.settings.defaultAuthor.trim()),
              defaultCoverMediaIdConfigured: Boolean(this.plugin.settings.defaultCoverMediaId.trim()),
              assetCacheCount: this.plugin.settings.assetCache.length,
              currentPublicIp: this.currentPublicIp || undefined,
            }, null, 2));
            new Notice('诊断信息已复制。');
          });
      });
  }

  private renderApiHelp(parent: HTMLElement): void {
    const note = parent.createDiv({ cls: 'wechat-draft-settings-note' });
    note.createEl('strong', { text: '微信 API 提示' });
    note.createEl('p', {
      text: '发布草稿时需要获取 access_token。第一版采用本地直连微信 API，因此需要把当前电脑公网 IP 加入微信公众号后台 IP 白名单。',
    });
  }
}
