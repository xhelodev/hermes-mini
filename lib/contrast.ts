import type { ThemeTokens } from './themes';

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  const num = parseInt(value, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const MIN_CONTRAST = 4.5;

export function assertThemeContrast(tokens: ThemeTokens): void {
  const pairs: [string, string, string][] = [
    ['fg', tokens.fg, tokens.bg],
    ['pfg', tokens.pfg, tokens.pri],
    ['mut', tokens.mut, tokens.bg],
  ];
  for (const [name, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_CONTRAST) {
      throw new Error(
        `Contraste insuficiente en ${name}: ${ratio.toFixed(2)}:1 (mínimo ${MIN_CONTRAST}:1)`,
      );
    }
  }
}

export function allThemesMeetContrast(
  themes: { id: string; tokens: ThemeTokens }[],
): boolean {
  try {
    themes.forEach((t) => assertThemeContrast(t.tokens));
    return true;
  } catch {
    return false;
  }
}
