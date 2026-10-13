import { assertThemeContrast } from '@/lib/contrast';
import { THEMES, getThemeById } from '@/lib/themes';

describe('temas Hermes', () => {
  it('define seis paletas con ids estables', () => {
    expect(THEMES).toHaveLength(6);
    expect(THEMES.map((t) => t.label)).toEqual([
      'Zinc claro',
      'Zinc oscuro',
      'Discord',
      'Obsidian',
      'WhatsApp',
      'Telegram',
    ]);
  });

  it('cumple contraste mínimo 4.5:1 en texto principal, botón y texto secundario', () => {
    THEMES.forEach((theme) => {
      expect(() => assertThemeContrast(theme.tokens)).not.toThrow();
    });
  });

  it('resuelve tema por id', () => {
    expect(getThemeById('telegram').label).toBe('Telegram');
  });
});
