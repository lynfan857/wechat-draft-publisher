# WeChat Draft Publisher

一个 Obsidian 桌面端插件，用来把当前 Markdown 笔记预览为微信公众号文章，并发布到微信公众号草稿箱。

## 功能

- 预览当前 Markdown 笔记的公众号排版效果
- 选择内置排版主题
- 复制公众号 HTML
- 发布为新的微信公众号草稿
- 更新已经关联的微信公众号草稿
- 上传正文图片到微信
- 上传封面图片到微信永久素材
- 将草稿 ID、主题、更新时间写回笔记 frontmatter
- 发布前检查标题、摘要、封面、正文图片和 HTML 兼容性

## 安装

### 手动安装

1. 下载发布包里的这 3 个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在你的 Obsidian vault 中创建目录：

```text
<vault>/.obsidian/plugins/wechat-draft-publisher/
```

3. 把 3 个文件复制到该目录。
4. 重启 Obsidian，进入 `设置 -> 第三方插件`。
5. 启用 `WeChat Draft Publisher`。

### 开发安装

```bash
npm install
npm run build
```

然后复制 `main.js`、`manifest.json`、`styles.css` 到 vault 的插件目录。

## 微信公众号配置

第一版使用本机直连微信公众平台 API，因此需要在微信公众号后台配置 IP 白名单。

1. 进入微信公众号后台。
2. 打开 `设置与开发 -> 基本配置`。
3. 复制插件设置页显示的“当前公网 IP”。
4. 将该 IP 加入公众号后台的 IP 白名单。
5. 在插件设置页填写：
   - `AppID`
   - `AppSecret`
   - 默认作者
   - 默认主题
   - 默认封面素材 ID，可选
6. 点击“测试连接”。

如果公网 IP 变化，需要重新把新的 IP 加入微信公众号后台白名单。

## 笔记 frontmatter

可选输入字段：

```yaml
title: 文章标题
author: 作者名
digest: 分享摘要
cover: path/to/cover.png
content_source_url: https://example.com
```

发布成功后插件会写入这些状态字段：

```yaml
wechat_draft_id: xxx
wechat_content_hash: xxx
wechat_theme: canghe-green
wechat_updated_at: 2026-08-09T00:00:00.000Z
wechat_cover_media_id: xxx
```

## 图片规则

- 支持 Markdown 图片：`![](path/to/image.png)`
- 支持 Obsidian 图片嵌入：`![[image.png]]`
- 正文图片发布时会上传到微信 `media/uploadimg`
- 封面图会上传为微信永久素材
- 建议使用 JPG、PNG，避免超大图片

## 发布包

刷新发布文件：

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

这 3 个文件就是别人手动安装需要的文件。

## 当前限制

- 只支持 Obsidian 桌面端。
- AppSecret 保存在 Obsidian SecretStorage 中，但本机仍然能发起微信 API 请求，请不要在不可信设备上配置。
- 微信 API 需要公众号后台 IP 白名单。
- 订阅号是否能正常调用草稿相关接口，取决于账号权限和微信公众平台当前规则。
- 目前是单公众号配置，多账号管理后续再做。
