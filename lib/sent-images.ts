import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { imageDataUrl } from '@/lib/format';
import { PickerError } from '@/lib/pickers';
import { type StoredImage } from '@/lib/sent-image-index';
import { strings } from '@/lib/i18n';

const KEY = '@hermes/sent-images';
const ROOT = 'sent-images';

type Index = Record<string, StoredImage[]>;

function asStored(value: unknown): StoredImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.fingerprint !== 'string' || typeof record.uri !== 'string') return [];
    if (!record.fingerprint || !record.uri) return [];
    return [{ fingerprint: record.fingerprint, uri: record.uri }];
  });
}

async function readIndex(): Promise<Index> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const index: Index = {};
    for (const [sessionId, files] of Object.entries(parsed as Record<string, unknown>)) {
      index[sessionId] = asStored(files);
    }
    return index;
  } catch {
    return {};
  }
}

export async function loadSentImages(sessionId: string): Promise<StoredImage[]> {
  const index = await readIndex();
  return index[sessionId] ?? [];
}

export async function rememberSentImage(
  sessionId: string,
  fingerprint: string,
  uri: string,
): Promise<void> {
  const index = await readIndex();
  const current = index[sessionId] ?? [];
  if (current.some((item) => item.uri === uri)) return;
  index[sessionId] = [...current, { fingerprint, uri }];
  await AsyncStorage.setItem(KEY, JSON.stringify(index));
}

function folderName(sessionId: string): string {
  const clean = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return clean || 'session';
}

function extensionFor(name: string, mimeType: string): string {
  const fromName = name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
  return 'jpg';
}

function sessionFolder(sessionId: string): Directory {
  const folder = new Directory(Paths.document, ROOT, folderName(sessionId));
  folder.create({ intermediates: true, idempotent: true });
  return folder;
}

function newImageFile(sessionId: string, name: string, mimeType: string): File {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(name, mimeType)}`;
  return new File(sessionFolder(sessionId), filename);
}

async function uploadPreview(uri: string): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  const preview = await rendered.saveAsync({
    compress: 0.5,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!preview.base64) {
    throw new PickerError(strings().attach.prepareFailed);
  }
  return imageDataUrl('image/jpeg', preview.base64);
}

export async function saveOutgoingImage(
  sessionId: string,
  source: { uri: string; name: string; mimeType: string },
): Promise<{ uri: string; size: number | null; dataUrl: string }> {
  try {
    const dest = newImageFile(sessionId, source.name, source.mimeType);
    const data = /^data:[^;,]+;base64,([\s\S]*)$/.exec(source.uri);
    if (data?.[1]) {
      dest.create();
      dest.write(data[1], { encoding: 'base64' });
    } else {
      await new File(source.uri).copy(dest);
    }
    return {
      uri: dest.uri,
      size: dest.size > 0 ? dest.size : null,
      dataUrl: await uploadPreview(dest.uri),
    };
  } catch (error) {
    if (error instanceof PickerError) throw error;
    throw new PickerError(strings().attach.saveFailed);
  }
}

export function discardSentImage(uri: string): void {
  if (!uri.includes(`/${ROOT}/`)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The chat can drop the chip even if the file stays behind.
  }
}
