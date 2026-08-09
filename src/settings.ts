import { App, PluginSettingTab, Setting } from 'obsidian';

import type WeChatDraftPublisherPlugin from './main';
import { WECHAT_THEMES } from './themes';

export const APP_SECRET_KEY = 'wechat-draft-publisher-app-secret';

export class WeChatDraftPublisherSettingTab extends PluginSettingTab {
  private connectionMessage = '';

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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName('AppSecret')
      .setDesc('只保存在 Obsidian SecretStorage 中，不写入 data.json。')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder(this.plugin.hasAppSecret() ? '已保存，输入新值后点保存' : '输入 AppSecret');
      })
      .addButton((button) => {
        button
          .setButtonText('保存 AppSecret')
          .onClick(async () => {
            const input = button.buttonEl.parentElement?.querySelector('input');
            const value = input instanceof HTMLInputElement ? input.value.trim() : '';
            if (!value) {
              this.connectionMessage = 'AppSecret 输入框为空，没有覆盖已保存的值。';
              this.display();
              return;
            }
            await this.plugin.saveAppSecret(value);
            if (input instanceof HTMLInputElement) input.value = '';
            this.connectionMessage = 'AppSecret 已保存。';
            this.display();
          });
      });

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName('默认封面素材 ID')
      .setDesc('后续发布接口阶段使用。当前阶段先保留配置入口。')
      .addText((text) => {
        text
          .setPlaceholder('media_id')
          .setValue(this.plugin.settings.defaultCoverMediaId)
          .onChange(async (value) => {
            this.plugin.settings.defaultCoverMediaId = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('当前公网 IP')
      .setDesc('本地直连微信 API 时，需要把这个 IP 加到微信公众号后台 IP 白名单。')
      .addButton((button) => {
        button
          .setButtonText('检测并复制')
          .onClick(async () => {
            try {
              const ip = await this.plugin.wechatApi.getCurrentPublicIp();
              await navigator.clipboard.writeText(ip);
              button.setButtonText(`已复制 ${ip}`);
            } catch (error) {
              button.setButtonText(error instanceof Error ? error.message : '检测失败');
            }
          });
      });

    new Setting(containerEl)
      .setName('测试连接')
      .setDesc('尝试获取 access_token，用于检查 AppID、AppSecret 和 IP 白名单。')
      .addButton((button) => {
        button
          .setButtonText('测试')
          .setCta()
          .onClick(async () => {
            button.setButtonText('测试中...');
            try {
              await this.plugin.wechatApi.testConnection();
              this.connectionMessage = '连接正常。';
              button.setButtonText('连接正常');
            } catch (error) {
              button.setButtonText('连接失败');
              this.connectionMessage = error instanceof Error ? error.message : '测试连接失败。';
              this.display();
            }
          });
      });

    const note = containerEl.createDiv({ cls: 'wechat-draft-settings-note' });
    note.createEl('strong', { text: '微信 API 提示' });
    note.createEl('p', {
      text: '发布草稿时需要获取 access_token。第一版会采用本地直连微信 API，因此需要把当前电脑公网 IP 加入微信公众号后台 IP 白名单。',
    });
    if (this.connectionMessage) {
      note.createEl('p', { text: this.connectionMessage });
    }
  }
}
