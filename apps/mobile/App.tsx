import './global.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LocalApp, registerUI, type BackBridge } from '@ficoim/screens';
import { LocalBackend } from '@ficoim/client/local';
import { universalRuntime } from '@ficoim/shared/backup/runtime-universal';
import { nativeUI } from './src/ui.native';
import { ToastHost, createNativePlatform } from './src/platform.native';
import { ScannerHost } from './src/scanner';
import { openDatabase } from './src/db';
import { fileBlobStore, writeSafetyBackup } from './src/files';

const APP_VERSION = '0.1.0';
registerUI(nativeUI); // sebelum render pertama (registerUI gagal cepat bila ada primitif yang kurang)

export default function App() {
  const [backend, setBackend] = useState<LocalBackend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handler = useRef<(() => boolean) | null>(null);
  const backBridge = useMemo<BackBridge>(() => ({ set: (h) => { handler.current = h; } }), []);
  const platform = useMemo(() => createNativePlatform(Platform.OS === 'ios' ? 'ios' : 'android'), []);

  useEffect(() => {
    let cancelled = false;
    openDatabase().then(
      (db) => { if (!cancelled) setBackend(new LocalBackend({ db, runtime: universalRuntime, appVersion: APP_VERSION, safetySink: writeSafetyBackup, blobStore: fileBlobStore() })); },
      (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Gagal membuka database.'); },
    );
    return () => { cancelled = true; };
  }, []);

  // Tombol "kembali" Android: ditangani navigasi dalam aplikasi lebih dulu; bila sudah di akar, biarkan OS menutup aplikasi.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => handler.current?.() ?? false);
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <StatusBar style="dark" />
        {error ? (
          <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}><Text style={{ color: '#be123c', fontSize: 16 }}>{error}</Text></View>
        ) : backend ? (
          <LocalApp backend={backend} platform={platform} backBridge={backBridge} />
        ) : null}
        <ToastHost />
        <ScannerHost />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
