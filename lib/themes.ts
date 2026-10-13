export type ThemeId =
  | 'zinc-claro'
  | 'zinc-oscuro'
  | 'discord'
  | 'obsidian'
  | 'whatsapp'
  | 'telegram'
  | 'claude'
  | 'imessage'
  | 'spotify'
  | 'slack';

export type ThemeTokens = {
  bg: string;
  fg: string;
  mut: string;
  bd: string;
  card: string;
  pri: string;
  pfg: string;
};

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  tokens: ThemeTokens;
};

/** Paletas alineadas con flow.py (TH). */
export const THEMES: ThemeDefinition[] = [
  {
    id: 'zinc-claro',
    label: 'Zinc claro',
    tokens: {
      bg: '#ffffff',
      fg: '#09090b',
      mut: '#71717a',
      bd: '#e4e4e7',
      card: '#f4f4f5',
      pri: '#18181b',
      pfg: '#fafafa',
    },
  },
  {
    id: 'zinc-oscuro',
    label: 'Zinc oscuro',
    tokens: {
      bg: '#09090b',
      fg: '#fafafa',
      mut: '#a1a1aa',
      bd: '#27272a',
      card: '#18181b',
      pri: '#fafafa',
      pfg: '#09090b',
    },
  },
  {
    id: 'discord',
    label: 'Blurple',
    tokens: {
      bg: '#313338',
      fg: '#f2f3f5',
      mut: '#949ba4',
      bd: '#3f4147',
      card: '#2b2d31',
      pri: '#5865f2',
      pfg: '#ffffff',
    },
  },
  {
    id: 'obsidian',
    label: 'Bóveda',
    tokens: {
      bg: '#1e1e1e',
      fg: '#dcddde',
      mut: '#8a8a8a',
      bd: '#333333',
      card: '#262626',
      pri: '#6554d8',
      pfg: '#ffffff',
    },
  },
  {
    id: 'whatsapp',
    label: 'Verde',
    tokens: {
      bg: '#0b141a',
      fg: '#e9edef',
      mut: '#8696a0',
      bd: '#222d34',
      card: '#202c33',
      pri: '#006b57',
      pfg: '#ffffff',
    },
  },
  {
    id: 'telegram',
    label: 'Celeste',
    tokens: {
      bg: '#17212b',
      fg: '#f5f5f5',
      mut: '#8aa4b8',
      bd: '#232e3c',
      card: '#232e3c',
      pri: '#177fab',
      pfg: '#ffffff',
    },
  },
  {
    id: 'claude',
    label: 'Arcilla',
    tokens: {
      bg: '#faf9f5',
      fg: '#141413',
      mut: '#5e5d59',
      bd: '#e5e3d6',
      card: '#f0eee6',
      pri: '#b55238',
      pfg: '#ffffff',
    },
  },
  {
    id: 'imessage',
    label: 'Azul',
    tokens: {
      bg: '#ffffff',
      fg: '#1c1c1e',
      mut: '#636366',
      bd: '#d1d1d6',
      card: '#e9e9eb',
      pri: '#0066cc',
      pfg: '#ffffff',
    },
  },
  {
    id: 'spotify',
    label: 'Lima',
    tokens: {
      bg: '#121212',
      fg: '#ffffff',
      mut: '#b3b3b3',
      bd: '#282828',
      card: '#181818',
      pri: '#1db954',
      pfg: '#121212',
    },
  },
  {
    id: 'slack',
    label: 'Berenjena',
    tokens: {
      bg: '#1a0e1c',
      fg: '#f7f1f8',
      mut: '#d0b6d4',
      bd: '#3e2444',
      card: '#2a162e',
      pri: '#ecb22e',
      pfg: '#1a0e1c',
    },
  },
];

export const DEFAULT_THEME_ID: ThemeId = 'zinc-oscuro';

export const THEME_STORAGE_KEY = '@hermes/theme-id';

export function getThemeById(id: ThemeId): ThemeDefinition {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) {
    return THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
  }
  return theme;
}
