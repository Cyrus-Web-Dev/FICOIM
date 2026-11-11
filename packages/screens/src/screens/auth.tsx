import { useState, type ReactNode } from 'react';
import { BUSINESS_TYPES } from '@ficoim/shared';
import { ApiError } from '@ficoim/client';
import { Backdrop, Box, Btn, Field, Reveal, Scroll, Txt } from '../ui';
import { Chips, FormError, MoneyField } from '../kit';
import { useAction } from '../hooks';
import { useApp } from '../platform';

export const BUSINESS_TYPE_LABEL: Record<(typeof BUSINESS_TYPES)[number], string> = {
  elektronik: 'Elektronik', non_elektronik: 'Non-elektronik', perabotan: 'Perabotan', fashion: 'Fashion', makanan_minuman: 'Makanan & Minuman', lainnya: 'Lainnya',
};
const TYPE_OPTIONS = BUSINESS_TYPES.map((t) => ({ value: t, label: BUSINESS_TYPE_LABEL[t] }));

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <Backdrop className="flex-1 bg-slate-50">
      <Scroll className="flex-1" contentClassName="p-6">
        <Box className="mx-auto w-full max-w-md gap-4">
          <Reveal className="items-center gap-1 py-4"><Txt className="text-4xl font-extrabold text-indigo-700">FICOIM</Txt><Txt className="text-slate-500">Keuangan & Inventaris UMKM</Txt></Reveal>
          <Reveal index={1}>
            <Box kind="hero" className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <Txt className="text-xl font-bold text-slate-900">{title}</Txt>
              {subtitle ? <Txt className="text-sm text-slate-500">{subtitle}</Txt> : null}
              {children}
            </Box>
          </Reveal>
        </Box>
      </Scroll>
    </Backdrop>
  );
}

export function LoginScreen({ onLogin, onGoRegister }: { onLogin: (i: { email: string; password: string; totp?: string }) => Promise<void>; onGoRegister: () => void }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [totp, setTotp] = useState(''); const [needTotp, setNeedTotp] = useState(false);
  const act = useAction();
  const submit = () => act.run(async () => {
    try { await onLogin({ email: email.trim(), password: pw, totp: needTotp ? totp.trim() : undefined }); }
    catch (e) { if (e instanceof ApiError && e.code === 'TOTP_REQUIRED') { setNeedTotp(true); return; } throw e; }
  });
  return (
    <AuthLayout title="Masuk">
      <Field label="Email" value={email} onChangeText={setEmail} keyboard="email" autoCapitalize="none" testID="login-email" />
      <Field label="Kata sandi" value={pw} onChangeText={setPw} secure testID="login-password" onSubmit={needTotp ? undefined : submit} />
      {needTotp ? <Field label="Kode verifikasi 2 langkah (6 digit)" value={totp} onChangeText={setTotp} keyboard="numeric" testID="login-totp" onSubmit={submit} autoFocus /> : null}
      <FormError message={act.error} />
      <Btn label="Masuk" onPress={submit} loading={act.busy} disabled={!email || !pw} testID="login-submit" />
      <Btn label="Daftar bisnis baru" variant="ghost" onPress={onGoRegister} testID="goto-register" />
    </AuthLayout>
  );
}

export function RegisterScreen({ onRegister, onGoLogin }: {
  onRegister: (i: { email: string; password: string; displayName: string; businessName: string; businessType: string; openingCash?: number }) => Promise<void>; onGoLogin: () => void;
}) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [biz, setBiz] = useState(''); const [type, setType] = useState<(typeof BUSINESS_TYPES)[number]>('lainnya'); const [cash, setCash] = useState<number | null>(null);
  const act = useAction();
  const ok = name.trim() && email.trim() && pw.length >= 8 && biz.trim();
  return (
    <AuthLayout title="Daftar" subtitle="Buat akun pemilik dan bisnis pertama Anda.">
      <Field label="Nama Anda" value={name} onChangeText={setName} testID="reg-name" autoCapitalize="words" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboard="email" autoCapitalize="none" testID="reg-email" />
      <Field label="Kata sandi (min. 8 karakter, campur huruf & angka)" value={pw} onChangeText={setPw} secure testID="reg-password" />
      <Field label="Nama bisnis" value={biz} onChangeText={setBiz} testID="reg-business" autoCapitalize="words" />
      <Txt className="text-sm text-slate-600">Jenis usaha</Txt>
      <Chips options={TYPE_OPTIONS} value={type} onChange={setType} testID="reg-type" />
      <MoneyField label="Kas awal (opsional)" value={cash} onChange={setCash} testID="reg-cash" />
      <FormError message={act.error} />
      <Btn label="Buat akun & bisnis" loading={act.busy} disabled={!ok} testID="reg-submit"
        onPress={() => act.run(() => onRegister({ email: email.trim(), password: pw, displayName: name.trim(), businessName: biz.trim(), businessType: type, openingCash: cash ?? 0 }))} />
      <Btn label="Sudah punya akun? Masuk" variant="ghost" onPress={onGoLogin} />
    </AuthLayout>
  );
}

/** Pemasangan pertama di HP: buat bisnis baru ATAU pulihkan dari backup (HP lain / web). */
export function OnboardingScreen({ onCreate, onImport, pickBackup }: {
  onCreate: (i: { name: string; businessType: string; ownerName: string; openingCash?: number }) => Promise<void>;
  onImport: (bytes: Uint8Array, password: string) => Promise<void>;
  pickBackup: () => Promise<Uint8Array | null>;
}) {
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [owner, setOwner] = useState(''); const [biz, setBiz] = useState(''); const [type, setType] = useState<(typeof BUSINESS_TYPES)[number]>('lainnya'); const [cash, setCash] = useState<number | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null); const [pw, setPw] = useState('');
  const act = useAction();
  return (
    <AuthLayout title="Selamat datang" subtitle="Data disimpan di perangkat ini dan tetap bisa dipakai tanpa internet.">
      <Chips options={[{ value: 'create', label: 'Bisnis baru' }, { value: 'import', label: 'Pulihkan backup' }]} value={mode} onChange={setMode} testID="onb-mode" />
      {mode === 'create' ? (
        <>
          <Field label="Nama Anda" value={owner} onChangeText={setOwner} testID="onb-owner" autoCapitalize="words" />
          <Field label="Nama bisnis" value={biz} onChangeText={setBiz} testID="onb-business" autoCapitalize="words" />
          <Txt className="text-sm text-slate-600">Jenis usaha</Txt>
          <Chips options={TYPE_OPTIONS} value={type} onChange={setType} />
          <MoneyField label="Kas awal (opsional)" value={cash} onChange={setCash} />
          <FormError message={act.error} />
          <Btn label="Mulai" loading={act.busy} disabled={!owner.trim() || !biz.trim()} testID="onb-create"
            onPress={() => act.run(() => onCreate({ name: biz.trim(), businessType: type, ownerName: owner.trim(), openingCash: cash ?? 0 }))} />
        </>
      ) : (
        <>
          <Txt className="text-sm text-slate-600">Pilih berkas backup (.ficoim) dari HP lain atau dari versi web, lalu masukkan kata sandi backup.</Txt>
          <Btn label={bytes ? `Berkas dipilih (${Math.round(bytes.length / 1024)} KB)` : 'Pilih berkas backup'} variant="secondary" onPress={() => act.run(async () => { const b = await pickBackup(); if (b) setBytes(b); })} testID="onb-pick" />
          <Field label="Kata sandi backup" value={pw} onChangeText={setPw} secure testID="onb-password" />
          <FormError message={act.error} />
          <Btn label="Pulihkan" loading={act.busy} disabled={!bytes || !pw} testID="onb-import" onPress={() => act.run(() => onImport(bytes as Uint8Array, pw))} />
        </>
      )}
    </AuthLayout>
  );
}

/** Dipakai di Pengaturan -> pengguna sadar kapan mode lokal/remote. */
export function useModeLabel(): string { return useApp().backend.mode === 'local' ? 'Data tersimpan di perangkat ini' : 'Data tersimpan di server'; }
