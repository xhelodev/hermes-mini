import { DEFAULT_SWIPE_CONFIG, resolveSwipeConfig, swipeActionLabel } from '@/lib/swipe-actions';

describe('resolveSwipeConfig', () => {
  it('usa borrar a la izquierda y fijar a la derecha por defecto', () => {
    expect(resolveSwipeConfig(null)).toEqual({ left: 'delete', right: 'pin' });
    expect(resolveSwipeConfig('no es json')).toEqual(DEFAULT_SWIPE_CONFIG);
  });

  it('respeta acciones guardadas y descarta las desconocidas', () => {
    expect(resolveSwipeConfig(JSON.stringify({ left: 'rename', right: 'fork' }))).toEqual({
      left: 'rename',
      right: 'fork',
    });
    expect(resolveSwipeConfig(JSON.stringify({ left: 'archive', right: 'none' }))).toEqual({
      left: 'delete',
      right: 'none',
    });
  });
});

describe('swipeActionLabel', () => {
  it('cambia el texto de fijar si ya está fijada', () => {
    expect(swipeActionLabel('pin')).toBe('Fijar');
    expect(swipeActionLabel('pin', true)).toBe('Quitar');
    expect(swipeActionLabel('fork')).toBe('Ramificar');
  });
});
