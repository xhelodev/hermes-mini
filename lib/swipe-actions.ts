export const SWIPE_ACTIONS = [
  { id: 'delete', label: 'Borrar' },
  { id: 'pin', label: 'Fijar' },
  { id: 'rename', label: 'Renombrar' },
  { id: 'fork', label: 'Ramificar' },
  { id: 'none', label: 'Nada' },
] as const;

export type SwipeActionId = (typeof SWIPE_ACTIONS)[number]['id'];

export type SwipeDirection = 'left' | 'right';

export type SwipeConfig = Record<SwipeDirection, SwipeActionId>;

export const DEFAULT_SWIPE_CONFIG: SwipeConfig = {
  left: 'delete',
  right: 'pin',
};

export const SWIPE_CONFIG_STORAGE_KEY = '@hermes/swipe-actions';

function resolveAction(value: unknown, fallback: SwipeActionId): SwipeActionId {
  return SWIPE_ACTIONS.find((item) => item.id === value)?.id ?? fallback;
}

export function resolveSwipeConfig(stored: string | null | undefined): SwipeConfig {
  if (!stored) return DEFAULT_SWIPE_CONFIG;
  try {
    const parsed = JSON.parse(stored) as Partial<Record<SwipeDirection, unknown>>;
    return {
      left: resolveAction(parsed?.left, DEFAULT_SWIPE_CONFIG.left),
      right: resolveAction(parsed?.right, DEFAULT_SWIPE_CONFIG.right),
    };
  } catch {
    return DEFAULT_SWIPE_CONFIG;
  }
}

export function swipeActionLabel(id: SwipeActionId, pinned = false): string {
  if (id === 'pin') return pinned ? 'Quitar' : 'Fijar';
  return SWIPE_ACTIONS.find((item) => item.id === id)?.label ?? 'Nada';
}
