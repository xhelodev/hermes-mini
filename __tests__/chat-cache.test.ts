import { createSessionCache } from '@/lib/chat-cache';

describe('createSessionCache', () => {
  it('guarda por conexión y no mezcla clientes distintos', () => {
    const cache = createSessionCache<string>();
    const a = {};
    const b = {};
    cache.set(a, 's1', 'hola');
    expect(cache.get(a, 's1')).toBe('hola');
    expect(cache.get(b, 's1')).toBeUndefined();
  });

  it('descarta la conversación usada hace más tiempo al pasar el límite', () => {
    const cache = createSessionCache<number>(2);
    const owner = {};
    cache.set(owner, 's1', 1);
    cache.set(owner, 's2', 2);
    cache.get(owner, 's1');
    cache.set(owner, 's3', 3);
    expect(cache.get(owner, 's2')).toBeUndefined();
    expect(cache.get(owner, 's1')).toBe(1);
    expect(cache.get(owner, 's3')).toBe(3);
  });

  it('reemplaza la entrada al volver a guardar la misma sesión', () => {
    const cache = createSessionCache<string>(2);
    const owner = {};
    cache.set(owner, 's1', 'viejo');
    cache.set(owner, 's1', 'nuevo');
    cache.set(owner, 's2', 'otro');
    expect(cache.get(owner, 's1')).toBe('nuevo');
    expect(cache.get(owner, 's2')).toBe('otro');
  });
});
