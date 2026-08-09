import type { WeChatTheme } from '../types';
import { blueNoteTheme } from './blueNote';
import { cangheGreenTheme } from './cangheGreen';
import { inkMinimalTheme } from './inkMinimal';
import { redWhiteTheme } from './redWhite';

export const DEFAULT_THEME_ID = cangheGreenTheme.id;

export const WECHAT_THEMES: WeChatTheme[] = [
  cangheGreenTheme,
  inkMinimalTheme,
  redWhiteTheme,
  blueNoteTheme,
];

export function getTheme(themeId: string): WeChatTheme {
  return WECHAT_THEMES.find((theme) => theme.id === themeId) ?? cangheGreenTheme;
}
