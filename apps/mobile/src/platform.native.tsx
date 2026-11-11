import { useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import type { PlatformServices } from '@ficoim/screens';
import { pickBackupFile, pickDataFile, shareBackup, shareFile } from './files';
import { scanBarcode } from './scanner';
import { pickImage } from './images';

let showToast: ((m: string, kind: 'ok' | 'error') => void) | null = null;

/** Dipasang SEKALI di akar aplikasi. */
export function ToastHost() {
  const [t, setT] = useState<{ m: string; kind: 'ok' | 'error' } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    showToast = (m, kind) => { setT({ m, kind }); if (timer) clearTimeout(timer); timer = setTimeout(() => setT(null), 3500); };
    return () => { showToast = null; if (timer) clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 90, alignItems: 'center' }}>
      <View style={{ backgroundColor: t.kind === 'error' ? '#e11d48' : '#0f172a', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 }}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>{t.m}</Text>
      </View>
    </View>
  );
}

export function createNativePlatform(os: 'ios' | 'android'): PlatformServices {
  return {
    os,
    confirm: (title, message, o) => new Promise<boolean>((resolve) => {
      Alert.alert(title, message, [
        { text: 'Batal', style: 'cancel', onPress: () => resolve(false) },
        { text: o?.confirmLabel ?? 'Ya', style: o?.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    }),
    notify: (message, kind = 'ok') => showToast?.(message, kind),
    saveBackup: shareBackup,
    saveFile: shareFile,
    pickBackup: pickBackupFile,
    pickDataFile,
    shareText: async (title, text) => { await Share.share({ title, message: text }); },
    pickImage,
    scanBarcode,
  };
}
