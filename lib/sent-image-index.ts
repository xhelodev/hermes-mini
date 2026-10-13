import type { HermesMessage } from '@/lib/hermes/map';

export type StoredImage = {
  fingerprint: string;
  uri: string;
};

export function imageFingerprint(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash, 33) ^ value.charCodeAt(i);
  }
  return `${(hash >>> 0).toString(16)}:${value.length}`;
}

export function applyStoredImages(messages: HermesMessage[], stored: StoredImage[]): HermesMessage[] {
  const byFingerprint = new Map(stored.map((item) => [item.fingerprint, item.uri]));
  const claimed = new Set<string>();
  const next = messages.map((message) => ({
    ...message,
    attachments: message.attachments.map((item) => {
      if (!item.url) return item;
      const local = byFingerprint.get(imageFingerprint(item.url));
      if (!local) return item;
      claimed.add(local);
      return { ...item, url: local };
    }),
  }));

  const unused = stored.filter((item) => !claimed.has(item.uri));
  if (unused.length === 0) return next;

  const slots: { messageIndex: number; attachmentIndex: number }[] = [];
  next.forEach((message, messageIndex) => {
    message.attachments.forEach((item, attachmentIndex) => {
      if (item.kind !== 'image') return;
      if (item.url && claimed.has(item.url)) return;
      slots.push({ messageIndex, attachmentIndex });
    });
  });

  const count = Math.min(unused.length, slots.length);
  for (let i = 0; i < count; i += 1) {
    const slot = slots[slots.length - count + i];
    const file = unused[unused.length - count + i];
    if (!slot || !file) continue;
    const message = next[slot.messageIndex];
    if (!message) continue;
    next[slot.messageIndex] = {
      ...message,
      attachments: message.attachments.map((item, index) =>
        index === slot.attachmentIndex ? { ...item, url: file.uri } : item,
      ),
    };
  }
  return next;
}
