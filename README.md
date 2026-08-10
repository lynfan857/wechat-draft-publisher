# WeChat Draft Publisher

WeChat Draft Publisher 是一个 Obsidian 桌面端插件，用来把当前 Markdown 笔记预览、排版、复制并发布到微信公众号草稿箱。

插件目标是做一个轻量的公众号发布预览器：预览是主角，发布设置只在需要时通过右侧抽屉出现。

## 功能

- 在 Obsidian 右侧打开公众号文章预览。
- 编辑当前 Markdown 时实时更新预览正文，并尽量保持预览滚动位置。
- 选择内置公众号排版主题。
- 在发布设置抽屉里调整标题、作者、摘要、原文链接和封面。
- 从正文图片中选择封面，或使用已有微信封面素材 ID。
- 复制完整公众号 HTML；复制前会上传正文图片并替换为微信可访问图片地址。
- 发布为新的微信公众号草稿。
- 更新已经关联的微信公众号草稿。
- 将草稿 ID、内容哈希、主题、更新时间、封面素材 ID 写回笔记 frontmatter。
- 发布前检查标题、摘要、封面、正文图片、草稿状态和 HTML 兼容性。
- 复制发布诊断信息，便于排查微信 API 或图片处理问题。

## 安装

### 手动安装

1. 下载发布包里的 3 个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在你的 Obsidian vault 中创建插件目录：

```text
<vault>/.obsidian/plugins/wechat-draft-publisher/
```

3. 把 3 个文件复制到该目录。
4. 重启 Obsidian。
5. 打开 `设置 -> 第三方插件`，启用 `WeChat Draft Publisher`。

### 开发安装

```bash
npm install
npm run build
```

构建后，将仓库根目录生成的 `main.js`、`manifest.json`、`styles.css` 复制到：

```text
<vault>/.obsidian/plugins/wechat-draft-publisher/
```

每次修改代码并重新构建后，都需要在 Obsidian 里关掉再打开插件，或者重启 Obsidian。

## 使用

打开一篇 Markdown 笔记后，可以通过以下方式打开公众号预览：

- 点击左侧 ribbon 的报纸图标。
- 在命令面板中运行 `Open WeChat preview`。
- 在命令面板中运行 `Preview current note as WeChat article`。

预览面板顶部提供：

- `刷新预览`：重新读取当前笔记并生成预览。
- `发布草稿` / `更新草稿`：发布为新草稿或更新已关联草稿。
- `另存为新草稿`：忽略现有关联，创建新的微信公众号草稿。
- `复制全文`：上传正文图片并复制最终公众号 HTML。
- `主题`：切换公众号排版主题。
- `发布设置`：打开右侧设置抽屉。

## 微信公众号配置

插件使用本机直连微信公众号平台 API，因此需要在公众号后台配置 IP 白名单。

1. 进入微信公众号后台。
2. 打开 `设置与开发 -> 基本配置`。
3. 在插件设置页复制当前公网 IP。
4. 将该 IP 加入公众号后台 IP 白名单。
5. 在插件设置页填写：
   - `AppID`
   - `AppSecret`
   - 默认作者
   - 默认主题
   - 默认封面素材 ID，可选
6. 点击测试连接。

`AppSecret` 使用 Obsidian SecretStorage 保存，不会写入插件的 `data.json`。

## 笔记 Frontmatter

可选输入字段：

```yaml
---
title: 文章标题
author: 作者名
digest: 分享摘要
cover: path/to/cover.png
cover_media_id: existing_wechat_cover_media_id
content_source_url: https://example.com
---
```

发布或更新成功后，插件会写入状态字段：

```yaml
wechat_draft_id: xxx
wechat_content_hash: xxx
wechat_theme: canghe-green
wechat_updated_at: 2026-08-09T00:00:00.000Z
wechat_cover_media_id: xxx
```

## 图片规则

- 支持 Markdown 图片：`![](path/to/image.png)`。
- 支持 Obsidian 图片嵌入：`![[image.png]]`。
- 正文图片在复制或发布时会上传到微信 `media/uploadimg`。
- 封面图片会上传为微信永久素材。
- 建议使用 JPG、PNG、GIF 或 WebP，并避免超过微信图片大小限制。

## 发布包

生成发布包：

```bash
npm run release
```

输出目录：

```text
_release/wechat-draft-publisher/
  main.js
  manifest.json
  styles.css
```

这 3 个文件就是手动安装需要复制的文件。

## 当前限制

- 仅支持 Obsidian 桌面端。
- 微信 API 需要公众号后台 IP 白名单。
- 是否能调用草稿相关接口取决于公众号类型、账号权限和微信平台当前规则。
- 当前是单公众号配置，多账号管理后续再做。
- 本机仍会发起微信 API 请求，请只在可信设备上配置 `AppSecret`。
