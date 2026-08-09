import { App, Component, MarkdownRenderer } from 'obsidian';

import { getTheme } from './themes';
import type { ThemePalette, WeChatSnapshot, WeChatTheme } from './types';

export interface RenderOptions {
  themeId: string;
  imageUrls?: Map<string, string>;
}

export interface HtmlAuditIssue {
  level: 'warn' | 'error';
  title: string;
  detail: string;
}

export interface SanitizedHtmlResult {
  html: string;
  byteLength: number;
  issues: HtmlAuditIssue[];
}

const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

const ALLOWED_ATTRIBUTES = new Set(['href', 'src', 'alt', 'title', 'style', 'width', 'height']);
const RISKY_STYLE_PATTERN = /(?:position\s*:\s*(?:fixed|absolute|sticky)|display\s*:\s*grid|var\s*\(|@media|@keyframes|animation\s*:|transition\s*:|url\s*\()/i;
const MAX_SAFE_HTML_BYTES = 900 * 1024;
const MAX_SAFE_CODE_CHARS = 4000;

function setStyles(element: HTMLElement, values: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, values);
}

function stripUnsafeNodes(root: HTMLElement): void {
  for (const element of Array.from(
    root.querySelectorAll('script,style,iframe,object,embed,form,button,input,textarea,select'),
  )) {
    element.remove();
  }
}

function normalizeLinks(root: HTMLElement): void {
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a'))) {
    const href = anchor.getAttribute('href') ?? '';
    if (!/^(https?:|mailto:)/i.test(href)) {
      anchor.removeAttribute('href');
    }
    setStyles(anchor, {
      color: 'inherit',
      textDecoration: 'none',
      borderBottom: '1px solid currentColor',
    });
  }
}

function decorateCodeBlock(pre: HTMLElement, palette: ThemePalette): void {
  const code = pre.querySelector<HTMLElement>('code');
  setStyles(pre, {
    display: 'block',
    margin: '18px 0',
    padding: '14px 14px',
    borderRadius: '8px',
    color: palette.codeText,
    backgroundColor: palette.codeBackground,
    fontSize: '13px',
    lineHeight: '1.7',
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });
  if (code) {
    setStyles(code, {
      color: palette.codeText,
      backgroundColor: 'transparent',
      fontFamily: 'Menlo, Consolas, Monaco, monospace',
      fontSize: '13px',
    });
  }
}

function decorateTable(table: HTMLTableElement, palette: ThemePalette): void {
  setStyles(table, {
    width: '100%',
    margin: '18px 0',
    borderCollapse: 'collapse',
    fontSize: '14px',
    lineHeight: '1.6',
  });
  for (const cell of Array.from(table.querySelectorAll<HTMLElement>('th,td'))) {
    setStyles(cell, {
      padding: '8px 10px',
      border: `1px solid ${palette.border}`,
      verticalAlign: 'top',
    });
  }
  for (const head of Array.from(table.querySelectorAll<HTMLElement>('th'))) {
    setStyles(head, {
      color: palette.accentDark,
      backgroundColor: palette.accentSoft,
      fontWeight: '700',
    });
  }
}

function applyWechatTheme(root: HTMLElement, theme: WeChatTheme): void {
  const { palette } = theme;
  stripUnsafeNodes(root);
  normalizeLinks(root);

  setStyles(root, {
    display: 'block',
    boxSizing: 'border-box',
    padding: '8px 8px',
    color: palette.text,
    backgroundColor: palette.surface,
    fontFamily: 'Optima-Regular, PingFang SC, Microsoft YaHei, sans-serif',
    fontSize: '16px',
    lineHeight: '1.8',
    letterSpacing: '0',
    overflowWrap: 'break-word',
  });

  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'h1') {
      setStyles(element, {
        display: 'inline-block',
        maxWidth: '100%',
        margin: '10px 0 18px',
        padding: '7px 24px',
        borderBottomRightRadius: '28px',
        color: '#ffffff',
        backgroundColor: palette.accent,
        fontSize: '22px',
        fontWeight: '700',
        lineHeight: '1.45',
      });
    } else if (tag === 'h2') {
      setStyles(element, {
        margin: '30px 0 14px',
        padding: '0 0 8px',
        borderBottom: `3px solid ${palette.accent}`,
        color: palette.accentDark,
        fontSize: '20px',
        fontWeight: '700',
        lineHeight: '1.45',
      });
    } else if (tag === 'h3') {
      setStyles(element, {
        margin: '24px 0 10px',
        paddingLeft: '10px',
        borderLeft: `4px solid ${palette.accent}`,
        color: palette.accentDark,
        fontSize: '17px',
        fontWeight: '700',
        lineHeight: '1.5',
      });
    } else if (tag === 'p') {
      setStyles(element, {
        margin: '18px 0',
        color: palette.text,
        fontSize: '16px',
        lineHeight: '1.9',
      });
    } else if (tag === 'blockquote') {
      setStyles(element, {
        margin: '20px 0',
        padding: '12px 14px',
        borderLeft: `4px solid ${palette.accent}`,
        borderRadius: '6px',
        color: palette.text,
        backgroundColor: palette.accentSoft,
      });
    } else if (tag === 'ul' || tag === 'ol') {
      setStyles(element, {
        margin: '16px 0',
        paddingLeft: '24px',
        color: palette.text,
      });
    } else if (tag === 'li') {
      setStyles(element, {
        margin: '7px 0',
        lineHeight: '1.8',
      });
    } else if (tag === 'strong') {
      setStyles(element, {
        color: palette.accentDark,
        fontWeight: '700',
      });
    } else if (tag === 'code' && element.parentElement?.tagName.toLowerCase() !== 'pre') {
      setStyles(element, {
        padding: '2px 5px',
        borderRadius: '4px',
        color: palette.accentDark,
        backgroundColor: palette.accentSoft,
        fontFamily: 'Menlo, Consolas, Monaco, monospace',
        fontSize: '0.9em',
      });
    } else if (tag === 'hr') {
      setStyles(element, {
        height: '1px',
        margin: '28px 0',
        border: '0',
        backgroundColor: palette.border,
      });
    } else if (tag === 'img') {
      setStyles(element, {
        display: 'block',
        maxWidth: '100%',
        height: 'auto',
        margin: '18px auto',
        borderRadius: '6px',
      });
    }
  }

  for (const pre of Array.from(root.querySelectorAll<HTMLElement>('pre'))) {
    decorateCodeBlock(pre, palette);
  }
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table'))) {
    decorateTable(table, palette);
  }
}

function renderHeader(snapshot: WeChatSnapshot, theme: WeChatTheme): HTMLElement {
  const header = createDiv();
  setStyles(header, {
    marginBottom: '18px',
    paddingBottom: '14px',
    borderBottom: `1px solid ${theme.palette.border}`,
  });
  header.createEl('h1', { text: snapshot.title });
  const meta = header.createDiv();
  setStyles(meta, {
    marginTop: '10px',
    color: theme.palette.muted,
    fontSize: '13px',
    lineHeight: '1.6',
  });
  const parts = [snapshot.author, snapshot.digest].filter(Boolean);
  meta.setText(parts.join(' · '));
  return header;
}

export async function renderWeChatArticle(
  app: App,
  component: Component,
  snapshot: WeChatSnapshot,
  container: HTMLElement,
  options: RenderOptions,
): Promise<void> {
  const theme = getTheme(options.themeId);
  container.empty();
  container.style.setProperty('--wechat-draft-accent', theme.color);
  const article = container.createDiv({ cls: 'wechat-draft-article' });
  article.appendChild(renderHeader(snapshot, theme));
  const content = article.createDiv();
  await MarkdownRenderer.render(
    app,
    markdownWithImageUrls(snapshot, options.imageUrls),
    content,
    snapshot.sourcePath,
    component,
  );
  applyWechatTheme(article, theme);
}

function markdownWithImageUrls(snapshot: WeChatSnapshot, imageUrls?: Map<string, string>): string {
  let markdown = snapshot.markdown;
  markdown = markdown.replace(/!\[\[([^\]]+)]]/g, (full, inner: string) => {
    const target = inner.split('|', 1)[0]?.trim() ?? '';
    const asset = snapshot.assets.find((item) => item.originalUrl === target);
    if (!asset) return full;
    const replacement = imageUrls?.get(asset.contentHash) ?? asset.previewUrl;
    return `![](${replacement})`;
  });
  for (const asset of snapshot.assets) {
    const replacement = imageUrls?.get(asset.contentHash) ?? asset.previewUrl;
    markdown = markdown.split(asset.originalUrl).join(replacement);
  }
  return markdown;
}

export function sanitizeWeChatArticle(root: HTMLElement): SanitizedHtmlResult {
  const clone = root.cloneNode(true) as HTMLElement;
  const issues: HtmlAuditIssue[] = [];

  for (const unsafe of Array.from(
    clone.querySelectorAll('script,style,iframe,object,embed,form,button,input,textarea,select'),
  )) {
    issues.push({
      level: 'warn',
      title: '已移除不兼容标签',
      detail: `<${unsafe.tagName.toLowerCase()}> 不适合发布到微信公众号正文。`,
    });
    unsafe.remove();
  }

  const elements = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  for (const element of elements) {
    normalizeElementForWeChat(element, issues);
  }

  for (const pre of Array.from(clone.querySelectorAll<HTMLElement>('pre'))) {
    if ((pre.textContent ?? '').length > MAX_SAFE_CODE_CHARS) {
      issues.push({
        level: 'warn',
        title: '代码块过长',
        detail: '超长代码块在微信编辑器中可能影响排版，建议拆分或改为图片。',
      });
    }
  }

  const html = new XMLSerializer().serializeToString(clone);
  const byteLength = new TextEncoder().encode(html).byteLength;
  if (byteLength > MAX_SAFE_HTML_BYTES) {
    issues.push({
      level: 'warn',
      title: '正文 HTML 较大',
      detail: `当前约 ${Math.round(byteLength / 1024)} KB，微信编辑器可能保存较慢。`,
    });
  }

  return {
    html,
    byteLength,
    issues: dedupeHtmlAuditIssues(issues),
  };
}

export function serializeWeChatArticle(root: HTMLElement): string {
  return sanitizeWeChatArticle(root).html;
}

function normalizeElementForWeChat(element: HTMLElement, issues: HtmlAuditIssue[]): void {
  const tag = element.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    issues.push({
      level: 'warn',
      title: '已转换不兼容标签',
      detail: `<${tag}> 已按普通段落容器处理。`,
    });
    const replacement = document.createElement('section');
    while (element.firstChild) replacement.appendChild(element.firstChild);
    for (const attribute of Array.from(element.attributes)) {
      replacement.setAttribute(attribute.name, attribute.value);
    }
    element.replaceWith(replacement);
    normalizeElementForWeChat(replacement, issues);
    return;
  }

  for (const attribute of Array.from(element.attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(attribute.name)) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (attribute.name === 'style' && RISKY_STYLE_PATTERN.test(attribute.value)) {
      issues.push({
        level: 'warn',
        title: '样式兼容性提示',
        detail: `${tag} 中存在微信可能忽略的复杂 CSS。`,
      });
    }
  }

  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute('href') ?? '';
    if (!href) {
      element.removeAttribute('href');
    } else if (!/^(https:|mailto:)/i.test(href)) {
      issues.push({
        level: 'warn',
        title: '已移除不兼容链接',
        detail: `微信正文只保留 https/mailto 链接：${href}`,
      });
      element.removeAttribute('href');
    }
  }

  if (element instanceof HTMLImageElement) {
    const src = element.getAttribute('src') ?? '';
    if (!/^https?:\/\//i.test(src)) {
      issues.push({
        level: 'error',
        title: '图片尚未上传',
        detail: element.alt ? `图片未变成微信可访问链接：${element.alt}` : '图片未变成微信可访问链接。',
      });
      const replacement = createSpan();
      replacement.setText(element.alt ? `图片：${element.alt}` : '图片暂未上传');
      setStyles(replacement, {
        display: 'block',
        margin: '18px 0',
        color: '#888888',
        fontSize: '13px',
        textAlign: 'center',
      });
      element.replaceWith(replacement);
    }
  }
}

function dedupeHtmlAuditIssues(issues: HtmlAuditIssue[]): HtmlAuditIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.level}:${issue.title}:${issue.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function legacySerializeWeChatArticle(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const elements = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (!['href', 'src', 'alt', 'title', 'style', 'width', 'height'].includes(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) element.removeAttribute('href');
    }
    if (element instanceof HTMLImageElement) {
      const src = element.getAttribute('src') ?? '';
      if (!/^https?:|^app:|^file:/i.test(src)) {
        const replacement = createSpan();
        replacement.setText(element.alt ? `图片：${element.alt}` : '图片暂未上传');
        setStyles(replacement, {
          display: 'block',
          margin: '18px 0',
          color: '#888888',
          fontSize: '13px',
          textAlign: 'center',
        });
        element.replaceWith(replacement);
      }
    }
  }
  return new XMLSerializer().serializeToString(clone);
}
