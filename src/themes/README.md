# Theme Development

Each WeChat article theme is a small TypeScript module exporting a `WeChatTheme`.

To add a theme:

1. Create a file in this directory, for example `warmEditorial.ts`.
2. Export a `WeChatTheme` object with a stable `id`, user-facing `label`, swatch `color`, and `palette`.
3. Import it in `registry.ts`.
4. Add it to `WECHAT_THEMES`.

The renderer currently uses the shared palette-driven layout in `src/renderer.ts`.
Future versions can extend `WeChatTheme` with per-element style hooks when the palette is no longer enough.
