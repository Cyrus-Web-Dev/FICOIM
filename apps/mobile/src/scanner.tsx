import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

let pending: ((v: string | null) => void) | null = null;
let open: ((v: boolean) => void) | null = null;

/** Membuka kamera pemindai; resolve dengan isi barcode, atau null bila dibatalkan. */
export function scanBarcode(): Promise<string | null> {
  return new Promise((resolve) => { pending?.(null); pending = resolve; open?.(true); });
}

/** Dipasang SEKALI di akar aplikasi. */
export function ScannerHost() {
  const [visible, setVisible] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const done = useRef(false);
  useEffect(() => { open = (v) => { done.current = false; setVisible(v); }; return () => { open = null; }; }, []);
  useEffect(() => { if (visible && perm && !perm.granted && perm.canAskAgain) void requestPerm(); }, [visible, perm]);

  const finish = (value: string | null) => {
    if (done.current) return; // onBarcodeScanned dipanggil berulang untuk kode yang sama
    done.current = true; setVisible(false);
    const r = pending; pending = null; r?.(value);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => finish(null)}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {perm?.granted ? (
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
            onBarcodeScanned={(e: { data: string }) => finish(e.data)} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontSize: 16 }}>Izin kamera diperlukan untuk memindai barcode. Aktifkan di Pengaturan perangkat.</Text>
          </View>
        )}
        <Pressable onPress={() => finish(null)} style={{ padding: 20, backgroundColor: '#111', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Batal</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
