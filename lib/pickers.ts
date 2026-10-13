import * as ImagePicker from 'expo-image-picker';

export type PickedMedia = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  base64: string | null;
  kind: 'image';
};

export class PickerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PickerError';
  }
}

function fromImageAsset(asset: ImagePicker.ImagePickerAsset): PickedMedia {
  return {
    uri: asset.uri,
    name: asset.fileName || 'foto.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
    base64: asset.base64 ?? null,
    kind: 'image',
  };
}

async function ensureCamera(): Promise<void> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new PickerError('Necesitamos permiso para usar la cámara.');
  }
}

async function ensureLibrary(): Promise<void> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new PickerError('Necesitamos permiso para ver tus fotos.');
  }
}

const FULL_IMAGE: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 1,
  base64: false,
  allowsEditing: false,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
};

export async function pickCameraImage(): Promise<PickedMedia | null> {
  await ensureCamera();
  const result = await ImagePicker.launchCameraAsync(FULL_IMAGE);
  if (result.canceled || !result.assets[0]) return null;
  return fromImageAsset(result.assets[0]);
}

export async function pickLibraryImage(): Promise<PickedMedia | null> {
  await ensureLibrary();
  const result = await ImagePicker.launchImageLibraryAsync(FULL_IMAGE);
  if (result.canceled || !result.assets[0]) return null;
  return fromImageAsset(result.assets[0]);
}
