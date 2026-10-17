import { strings } from '@/lib/i18n';

export const SWIPE_ACTIONS = ['delete', 'archive', 'pin', 'rename', 'fork', 'none'] as const;

export type SwipeActionId = (typeof SWIPE_ACTIONS)[number];

export type SwipeDirection = 'left' | 'right';

export type SwipeConfig = Record<SwipeDirection, SwipeActionId>;

export const DEFAULT_SWIPE_CONFIG: SwipeConfig = {
  left: 'delete',
  right: 'pin',
};

export const SWIPE_CONFIG_STORAGE_KEY = '@hermes/swipe-actions';

function resolveAction(value: unknown, fallback: SwipeActionId): SwipeActionId {
  return SWIPE_ACTIONS.find((id) => id === value) ?? fallback;
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

export function swipeActionLabel(id: SwipeActionId, pinned = false, archived = false): string {
  const labels = strings().swipe.actions;
  if (id === 'pin' && pinned) return labels.unpin;
  if (id === 'archive' && archived) return labels.unarchive;
  return labels[id] ?? labels.none;
}
