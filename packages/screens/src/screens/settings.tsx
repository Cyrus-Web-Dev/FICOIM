import { useState } from 'react';
import { checkBackupPassword } from '@ficoim/shared';
import { type BusinessView, type MemberView, type RestoreReport } from '@ficoim/client';
import { Box, Btn, Field, Icon, Sheet, ThemeToggle, Txt, type IconName } from '../ui';
import { Async, Card, Chips, FormError, IconBubble, Row, Screen, Section, Toggle, type Tint } from '../kit';
import { useAction, useAsync } from '../hooks';
import { useApp } from '../platform';
import { PhotoField } from '../photos';
import { useNav, type RouteName } from '../nav';

// ================================================================== menu "Lainnya"
export function MoreScreen() {
  const { account, backend, businessName } = useApp();
  const nav = useNav();
  const item = (icon: IconName, tint: Tint, title: string, to: RouteName, sub?: string) => (
    <Card key={to} testID={`more-${to}`} onPress={() => nav.push(to)} className="flex-row items-center gap-3">
      <IconBubble icon={icon} tint={tint} size={36} />
      <Box className="flex-1"><Txt className="text-base font-semibold text-slate-900">{title}</Txt>{sub ? <Txt className="text-xs text-slate-500">{sub}</Txt> : null}</Box>
      <Icon name="chevron" size={18} className="text-slate-400" />
    </Card>
  );
  return (
    <Screen title="Lainnya">
      <Box className="flex-row items-center justify-between gap-2">
        <Txt className="flex-1 text-sm text-slate-500">{businessName} · {backend.mode === 'local' ? 'Data tersimpan di perangkat ini' : 'Data tersimpan di server'}</Txt>
        <ThemeToggle />
      </Box>
      {item('trendUp', 'indigo', 'Riwayat penjualan', 'sales')}
      {item('inbox', 'sky', 'Pembelian stok', 'purchases')}
      {item('users', 'indigo', 'Pelanggan & Pemasok', 'parties', 'Riwayat, piutang, dan hutang per pihak')}
      {item('inbox', 'emerald', 'Impor produk', 'import', 'Dari Excel atau CSV')}
      {item('box', 'sky', 'Stok opname massal', 'stockCount', 'Hitung fisik lewat Excel')}
      {item('tag', 'amber', 'Aset', 'assets')}
      {item('chart', 'emerald', 'Laporan', 'reports')}
      {item('download', 'indigo', 'Backup & pulihkan', 'backup', 'Pindahkan data antara HP dan web')}
      {item('sliders', 'sky', 'Pengaturan bisnis', 'settings')}
      {account ? item('users', 'emerald', 'Tim', 'team') : null}
      {account ? item('shield', 'rose', 'Akun & keamanan', 'account') : null}
    </Screen>
  );
}

// ================================================================== pengaturan bisnis
export function SettingsScreen() {
  const { backend } = useApp();
  const state = useAsync(() => backend.business(), []);
  return <Screen title="Pengaturan bisnis"><Async state={state}>{(b) => <SettingsForm biz={b} />}</Async></Screen>;
}

function SettingsForm({ biz }: { biz: BusinessView }) {
  const { backend, platform, refreshBusiness } = useApp();
  const [name, setName] = useState(biz.name); const [phone, setPhone] = useState(biz.phone ?? ''); const [address, setAddress] = useState(biz.address ?? '');
  const [tax, setTax] = useState(biz.taxBp ? String(biz.taxBp / 100).replace('.', ',') : '0'); const [neg, setNeg] = useState(biz.allowNegativeStock); const [tz, setTz] = useState(String(biz.tzOffsetMinutes));
  const [footer, setFooter] = useState(biz.receiptFooter ?? ''); const [logo, setLogo] = useState<string | null>(biz.logoAttachmentId); const [cols, setCols] = useState(String(biz.receiptCols));
  const act = useAction();
  const save = () => act.run(async () => {
    const pct = Number(tax.replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Pajak harus antara 0 dan 100 persen.');
    await backend.updateBusiness({ name, phone: phone || null, address: address || null, taxBp: Math.round(pct * 100), allowNegativeStock: neg, tzOffsetMinutes: Number(tz), receiptFooter: footer || null, receiptCols: Number(cols), ...(logo !== biz.logoAttachmentId ? { logoAttachmentId: logo } : {}) });
    await refreshBusiness();
    platform.notify('Pengaturan disimpan');
  });
  return (
    <>
      <Field label="Nama bisnis" value={name} onChangeText={setName} testID="st-name" />
      <Field label="Telepon" value={phone} onChangeText={setPhone} keyboard="phone" />
      <Field label="Alamat" value={address} onChangeText={setAddress} multiline />
      <Field label="PPN / pajak penjualan (%) — 0 bila tidak ada" value={tax} onChangeText={setTax} keyboard="decimal" testID="st-tax" />
      <Section title="Struk">
        <PhotoField label="Logo toko (tampil di struk)" value={logo} onChange={setLogo} testID="st-logo" icon="image" />
        <Field label="Catatan kaki struk (opsional)" value={footer} onChangeText={setFooter} testID="st-footer" />
        <Txt className="text-sm text-slate-600">Lebar kertas struk teks</Txt>
        <Chips options={[{ value: '32', label: '58 mm' }, { value: '42', label: '80 mm' }]} value={cols} onChange={setCols} testID="st-cols" />
      </Section>
      <Txt className="text-sm text-slate-600">Zona waktu</Txt>
      <Chips options={[{ value: '420', label: 'WIB' }, { value: '480', label: 'WITA' }, { value: '540', label: 'WIT' }]} value={tz} onChange={setTz} />
      <Toggle label="Izinkan stok minus (jual sebelum barang dicatat masuk)" value={neg} onChange={setNeg} testID="st-neg" />
      <FormError message={act.error} />
      <Btn label="Simpan" onPress={save} loading={act.busy} testID="st-save" />
    </>
  );
}

// ================================================================== backup & pulihkan
export function BackupScreen() {
  const { backend, platform, refreshBusiness } = useApp();
  // --- buat
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [ack, setAck] = useState(false);
  const mk = useAction();
  const check = checkBackupPassword(pw);
  const canMake = check.ok && pw === pw2 && ack;
  const make = () => mk.run(async () => { const f = await backend.exportBackup(pw); await platform.saveBackup(f); platform.notify(`Backup dibuat: ${f.fileName}`); setPw(''); setPw2(''); setAck(false); });
  // --- pulihkan
  const [bytes, setBytes] = useState<Uint8Array | null>(null); const [rpw, setRpw] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge'); const [copyMode, setCopyMode] = useState(false); const [collision, setCollision] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const rs = useAction();
  const restore = () => rs.run(async () => {
    if (!bytes) return;
    const msg = mode === 'replace' ? 'Seluruh data bisnis saat ini akan DIGANTI isi backup. Backup pengaman dibuat otomatis lebih dulu.' : 'Data dari backup akan digabung ke data saat ini (yang lebih baru menang).';
    if (!(await platform.confirm(mode === 'replace' ? 'Timpa semua data?' : 'Gabungkan data?', msg, { destructive: mode === 'replace', confirmLabel: 'Lanjutkan' }))) return;
    try {
      const r = await backend.restoreBackup({ password: rpw, mode, bytes, regenerateIds: copyMode });
      setReport(r); setBytes(null); setRpw(''); setCollision(false); await refreshBusiness();
      platform.notify('Data berhasil dipulihkan');
    } catch (e) {
      if ((e as { details?: { code?: string } }).details?.code === 'ID_COLLISION') setCollision(true);
      throw e;
    }
  });
  return (
    <Screen title="Backup & pulihkan">
      <Section title="Buat backup">
        <Card className="gap-2">
          <Txt className="text-sm text-slate-600">Satu berkas terenkripsi (.ficoim) berisi seluruh data bisnis. Bisa dibuka di HP maupun web dengan kata sandi yang sama.</Txt>
          <Field label="Kata sandi backup (min. 10 karakter, campur huruf/angka)" value={pw} onChangeText={setPw} secure testID="bk-pw" />
          {pw ? <Txt testID="bk-strength" className={check.ok ? 'text-sm text-emerald-600' : 'text-sm text-amber-700'}>{check.ok ? `Kuat (${check.score}/4)` : check.issues.join(' ')}</Txt> : null}
          <Field label="Ulangi kata sandi" value={pw2} onChangeText={setPw2} secure testID="bk-pw2" />
          {pw2 && pw !== pw2 ? <Txt className="text-sm text-rose-600">Kata sandi tidak sama.</Txt> : null}
          <Toggle label="Saya paham: kata sandi ini TIDAK bisa dipulihkan. Jika lupa, backup tidak dapat dibuka." value={ack} onChange={setAck} testID="bk-ack" />
          <FormError message={mk.error} />
          {mk.busy ? <Txt className="text-sm text-slate-500">Mengenkripsi… bisa beberapa detik di perangkat.</Txt> : null}
          <Btn label="Buat & simpan backup" onPress={make} loading={mk.busy} disabled={!canMake} testID="bk-make" />
        </Card>
      </Section>

      <Section title="Pulihkan dari backup">
        <Card className="gap-2">
          <Btn label={bytes ? `Berkas dipilih (${Math.round(bytes.length / 1024)} KB)` : 'Pilih berkas .ficoim'} variant="secondary" testID="rs-pick" onPress={() => rs.run(async () => { const b = await platform.pickBackup(); if (b) { setBytes(b); setReport(null); } })} />
          <Field label="Kata sandi backup" value={rpw} onChangeText={setRpw} secure testID="rs-pw" />
          <Chips options={[{ value: 'merge', label: 'Gabung (aman)' }, { value: 'replace', label: 'Timpa semua' }]} value={mode} onChange={setMode} testID="rs-mode" />
          {collision ? (<><Txt className="text-sm text-amber-700">Data backup ini milik bisnis lain di sistem yang sama. Pulihkan sebagai salinan baru?</Txt><Toggle label="Pulihkan sebagai salinan baru" value={copyMode} onChange={setCopyMode} testID="rs-copy" /></>) : null}
          <FormError message={rs.error} />
          <Btn label="Pulihkan" variant={mode === 'replace' ? 'danger' : 'primary'} onPress={restore} loading={rs.busy} disabled={!bytes || !rpw} testID="rs-go" />
        </Card>
        {report ? (
          <Card testID="rs-report" className="gap-1">
            <Txt className="font-bold text-emerald-700">Pemulihan selesai</Txt>
            <Txt className="text-sm text-slate-600">Ditambahkan {report.inserted} · diperbarui {report.updated} · dilewati {report.skipped}{report.remapped ? ` · digabung ${report.remapped}` : ''}{report.renumbered ? ` · nomor diubah ${report.renumbered}` : ''}</Txt>
          </Card>
        ) : null}
      </Section>
    </Screen>
  );
}

// ================================================================== tim (web, pemilik)
const ROLE_LABEL: Record<string, string> = { owner: 'Pemilik', manager: 'Manajer', staff: 'Kasir/Staf' };

export function TeamScreen() {
  const { backend } = useApp();
  const state = useAsync(() => backend.listMembers(), []);
  const [sheet, setSheet] = useState<'add' | MemberView | null>(null);
  const close = (r?: boolean) => { setSheet(null); if (r) state.reload(); };
  return (
    <Screen title="Tim" right={<Btn label="+ Anggota" onPress={() => setSheet('add')} testID="add-member" />}>
      <Async state={state}>
        {(list) => (
          <Box className="gap-2">
            {list.map((m) => <Row key={m.id} testID="member-row" title={m.displayName} sub={`${ROLE_LABEL[m.role] ?? m.role}${m.isActive ? '' : ' · nonaktif'}${m.canViewReports ? ' · lihat laporan' : ''}`} onPress={m.role === 'owner' ? undefined : () => setSheet(m)} />)}
          </Box>
        )}
      </Async>
      {sheet === 'add' ? <AddMemberSheet onClose={close} /> : null}
      {sheet && sheet !== 'add' ? <EditMemberSheet m={sheet} onClose={close} /> : null}
    </Screen>
  );
}

function AddMemberSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [role, setRole] = useState('staff'); const [rep, setRep] = useState(false);
  const act = useAction();
  return (
    <Sheet visible title="Tambah anggota" onClose={() => onClose()}>
      <Field label="Nama" value={name} onChangeText={setName} testID="mb-name" />
      <Field label="Email (untuk masuk)" value={email} onChangeText={setEmail} keyboard="email" autoCapitalize="none" testID="mb-email" />
      <Field label="Kata sandi awal (berikan ke anggota)" value={pw} onChangeText={setPw} secure testID="mb-pw" />
      <Chips options={[{ value: 'staff', label: 'Kasir/Staf' }, { value: 'manager', label: 'Manajer' }]} value={role} onChange={setRole} />
      <Toggle label="Boleh melihat laporan" value={rep} onChange={setRep} />
      <FormError message={act.error} />
      <Btn label="Tambah" loading={act.busy} disabled={!name.trim() || !email.trim() || pw.length < 8} testID="mb-save" onPress={() => act.run(async () => { await backend.createMember({ email: email.trim(), password: pw, displayName: name.trim(), role, canViewReports: rep }); onClose(true); })} />
    </Sheet>
  );
}

function EditMemberSheet({ m, onClose }: { m: MemberView; onClose: (r?: boolean) => void }) {
  const { backend } = useApp();
  const [role, setRole] = useState(m.role); const [active, setActive] = useState(m.isActive); const [rep, setRep] = useState(m.canViewReports); const [del, setDel] = useState(m.canDelete);
  const act = useAction();
  return (
    <Sheet visible title={m.displayName} onClose={() => onClose()}>
      <Chips options={[{ value: 'staff', label: 'Kasir/Staf' }, { value: 'manager', label: 'Manajer' }]} value={role} onChange={setRole} />
      <Toggle label="Aktif" value={active} onChange={setActive} />
      <Toggle label="Boleh melihat laporan" value={rep} onChange={setRep} />
      <Toggle label="Boleh menghapus data" value={del} onChange={setDel} />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} testID="me-save" onPress={() => act.run(async () => { await backend.updateMember(m.id, { role, isActive: active, canViewReports: rep, canDelete: del }); onClose(true); })} />
    </Sheet>
  );
}

// ================================================================== akun & 2FA (web)
export function AccountScreen() {
  const { account, platform } = useApp();
  const [enabled, setEnabled] = useState(account?.session.user.totpEnabled ?? false);
  const [setup, setSetup] = useState<{ base32: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState(''); const [pwSheet, setPwSheet] = useState(false); const [offSheet, setOffSheet] = useState(false);
  const act = useAction();
  if (!account) return <Screen title="Akun"><Txt>Fitur akun hanya tersedia di versi web.</Txt></Screen>;
  return (
    <Screen title="Akun & keamanan">
      <Card className="gap-1"><Txt className="font-bold">{account.session.user.displayName}</Txt><Txt className="text-slate-600">{account.session.user.email}</Txt><Txt className="text-xs text-slate-500">Peran: {ROLE_LABEL[account.session.role] ?? account.session.role}</Txt></Card>
      <Section title="Verifikasi 2 langkah (2FA)">
        {enabled ? (
          <Card className="gap-2"><Txt className="text-emerald-700">✅ Aktif. Login meminta kode dari aplikasi authenticator.</Txt><Btn label="Nonaktifkan" variant="danger" onPress={() => setOffSheet(true)} /></Card>
        ) : setup ? (
          <Card className="gap-2" testID="totp-setup">
            <Txt className="text-sm text-slate-600">1. Buka aplikasi authenticator (Google Authenticator, Authy, dll.) lalu tambahkan akun dengan kunci rahasia berikut:</Txt>
            <Txt testID="totp-secret" className="break-all text-lg font-bold">{setup.base32}</Txt>
            <Txt className="text-sm text-slate-600">2. Masukkan kode 6 digit yang tampil untuk mengonfirmasi.</Txt>
            <Field label="Kode 6 digit" value={code} onChangeText={setCode} keyboard="numeric" testID="totp-code" />
            <FormError message={act.error} />
            <Btn label="Aktifkan 2FA" loading={act.busy} disabled={code.length !== 6} testID="totp-confirm" onPress={() => act.run(async () => { await account.totpConfirm(code); setEnabled(true); setSetup(null); setCode(''); platform.notify('2FA aktif'); })} />
          </Card>
        ) : (
          <Card className="gap-2"><Txt className="text-slate-600">Lindungi akun dengan kode sekali pakai selain kata sandi.</Txt><FormError message={act.error} /><Btn label="Aktifkan 2FA" loading={act.busy} testID="totp-start" onPress={() => act.run(async () => setSetup(await account.totpStart()))} /></Card>
        )}
      </Section>
      <Btn label="Ganti kata sandi" variant="secondary" onPress={() => setPwSheet(true)} testID="open-change-pw" />
      <Btn label="Keluar" variant="danger" onPress={() => account.logout()} testID="logout" />
      {pwSheet ? <ChangePwSheet onClose={() => setPwSheet(false)} /> : null}
      {offSheet ? <DisableSheet onClose={(r) => { setOffSheet(false); if (r) setEnabled(false); }} /> : null}
    </Screen>
  );
}

function ChangePwSheet({ onClose }: { onClose: () => void }) {
  const { account, platform } = useApp();
  const [o, setO] = useState(''); const [n, setN] = useState('');
  const act = useAction();
  return (
    <Sheet visible title="Ganti kata sandi" onClose={onClose}>
      <Txt className="text-sm text-slate-600">Semua perangkat akan keluar dan harus masuk ulang.</Txt>
      <Field label="Kata sandi lama" value={o} onChangeText={setO} secure testID="cp-old" />
      <Field label="Kata sandi baru" value={n} onChangeText={setN} secure testID="cp-new" />
      <FormError message={act.error} />
      <Btn label="Simpan" loading={act.busy} disabled={!o || n.length < 8} testID="cp-save" onPress={() => act.run(async () => { await account?.changePassword(o, n); platform.notify('Kata sandi diganti. Silakan masuk lagi.'); await account?.logout(); })} />
    </Sheet>
  );
}

function DisableSheet({ onClose }: { onClose: (r?: boolean) => void }) {
  const { account } = useApp();
  const [pw, setPw] = useState(''); const [code, setCode] = useState('');
  const act = useAction();
  return (
    <Sheet visible title="Nonaktifkan 2FA" onClose={() => onClose()}>
      <Field label="Kata sandi" value={pw} onChangeText={setPw} secure />
      <Field label="Kode 6 digit" value={code} onChangeText={setCode} keyboard="numeric" />
      <FormError message={act.error} />
      <Btn label="Nonaktifkan" variant="danger" loading={act.busy} disabled={!pw || code.length !== 6} onPress={() => act.run(async () => { await account?.totpDisable(pw, code); onClose(true); })} />
    </Sheet>
  );
}

