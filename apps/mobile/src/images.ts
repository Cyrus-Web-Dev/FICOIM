import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

const MAX_SIDE = 1280;
const HARD_LIMIT = 1_400_000; // di bawah batas 1,5 MB milik mesin bisnis

/** Ambil foto (kamera) / pilih dari galeri, lalu kecilkan: sisi terpanjang ≤ 1280 px, JPEG. null bila dibatalkan. */
export async function pickImage(source: 'camera' | 'library'): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Izin kamera ditolak. Aktifkan di Pengaturan HP untuk memotret.');
  }
  const opts = { mediaTypes: ['images'] as ['images'], quality: 0.9, allowsEditing: false, exif: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = r.canceled ? null : r.assets[0];
  if (!asset) return null;

  const shrink = async (compress: number) => {
    const ctx = ImageManipulator.manipulate(asset.uri);
    ctx.resize(asset.width >= asset.height ? { width: Math.min(MAX_SIDE, asset.width) } : { height: Math.min(MAX_SIDE, asset.height) });
    const saved = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress });
    return new File(saved.uri).bytes();
  };
  let bytes = await shrink(0.75);
  if (bytes.length > HARD_LIMIT) bytes = await shrink(0.5);
  if (bytes.length > HARD_LIMIT) throw new Error('Foto terlalu besar. Pilih foto lain atau ambil ulang.');
  return { bytes, fileName: `foto-${Date.now()}.jpg` };
}
