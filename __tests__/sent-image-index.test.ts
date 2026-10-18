import { applyStoredImages, imageFingerprint } from '@/lib/sent-image-index';
import type { HermesMessage } from '@/lib/hermes/map';

function message(id: string, url: string | null): HermesMessage {
  return {
    id,
    role: 'user',
    text: 'mirá',
    reasoning: '',
    toolName: null,
    attachments: [{ kind: 'image', label: 'Imagen', url }],
    finishReason: null,
    steer: false,
  };
}

describe('fotos guardadas', () => {
  it('usa la copia local cuando el servidor devuelve la misma imagen', () => {
    const remote = 'data:image/jpeg;base64,abc';
    const messages = applyStoredImages([message('m1', remote)], [
      { fingerprint: imageFingerprint(remote), uri: 'file:///sent-images/a.jpg' },
    ]);
    expect(messages[0]?.attachments[0]?.url).toBe('file:///sent-images/a.jpg');
  });

  it('asigna la copia más nueva a la última foto si el servidor la recomprime', () => {
    const messages = applyStoredImages(
      [message('old', 'data:image/jpeg;base64,vieja'), message('new', 'data:image/jpeg;base64,nueva')],
      [{ fingerprint: 'no-coincide', uri: 'file:///sent-images/nueva.jpg' }],
    );
    expect(messages[0]?.attachments[0]?.url).toBe('data:image/jpeg;base64,vieja');
    expect(messages[1]?.attachments[0]?.url).toBe('file:///sent-images/nueva.jpg');
  });
});
