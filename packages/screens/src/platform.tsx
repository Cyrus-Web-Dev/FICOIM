import { createContext, useContext, type ReactNode } from 'react';
import type { Backend, StoredSession } from '@ficoim/client';

/** Layanan yang berbeda per platform. Diinjeksi oleh aplikasi (web/mobile). */
export interface PlatformServices {
  os: 'web' | 'ios' | 'android';
  confirm(title: string, message: string, o?: { confirmLabel?: string; destructive?: boolean }): Promise<boolean>;
  notify(message: string, kind?: 'ok' | 'error'): void;
  /** Web: unduh berkas. Mobile: buka lembar bagikan/simpan. */
  saveBackup(file: { bytes: Uint8Array; fileName: string }): Promise<void>;
  /** Simpan/bagikan berkas apa pun (laporan Excel, gambar label). Web: unduh; HP: lembar bagikan OS. */
  saveFile(file: { bytes: Uint8Array; fileName: string; mime: string }): Promise<void>;
  /** Pilih berkas .ficoim; null bila dibatalkan. */
  pickBackup(): Promise<Uint8Array | null>;
  /** Pilih berkas data (CSV/Excel) untuk impor. null bila dibatalkan. */
  pickDataFile?: () => Promise<{ bytes: Uint8Array; fileName: string } | null>;
  /** Bagikan teks (struk): web = menu bagikan peramban/salin; HP = lembar bagikan OS. */
  shareText(title: string, text: string): Promise<void>;
  /** Salin teks ke papan klip (web). */
  copyText?: (text: string) => Promise<void>;
  /** Web saja: cetak lembar label (elemen .label-sheet di layar) dengan ukuran kertas sesuai pilihan. */
  printLabels?: (size: 'a4' | '50x30' | '40x30') => void;
  /** Web saja: cetak struk lewat dialog cetak peramban. */
  printReceipt?: (title: string, text: string) => void;
  /**
   * Ambil/pilih foto dan KECILKAN (maks sisi 1280 px, JPEG ≤ ± 300 KB) sebelum diunggah. null bila dibatalkan.
   * 'camera' hanya bermakna di HP/peramban HP; bila tidak ada kamera, platform boleh membuka pemilih berkas.
   */
  pickImage?: (source: 'camera' | 'library') => Promise<{ bytes: Uint8Array; fileName: string } | null>;
  /** Hanya mobile: pindai barcode dengan kamera. null bila dibatalkan. */
  scanBarcode?: () => Promise<string | null>;
}

/** Hal-hal khusus mode remote (web): akun, 2FA, tim. Pada mode lokal (mobile) tidak ada. */
export interface AccountApi {
  session: StoredSession;
  logout(): Promise<void>;
  changePassword(oldPw: string, newPw: string): Promise<void>;
  totpStart(): Promise<{ base32: string; otpauthUri: string }>;
  totpConfirm(code: string): Promise<void>;
  totpDisable(password: string, code: string): Promise<void>;
}

export interface AppContextValue {
  backend: Backend;
  platform: PlatformServices;
  account: AccountApi | null;
  /** Zona waktu bisnis (menit dari UTC) & pajak (bp): dimuat sekali, disegarkan lewat refreshBusiness(). */
  tz: number;
  taxBp: number;
  businessName: string;
  refreshBusiness(): Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ value, children }: { value: AppContextValue; children?: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp dipakai di luar <AppProvider>.');
  return v;
}
