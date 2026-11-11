import { useState } from 'react';
import { fmtDate, formatRupiah, type PartyKind, type PartyStatsView } from '@ficoim/client';
import { Box, Btn, Field, Sheet, Txt } from '../ui';
import { Async, Card, Chips, FormError, Screen, type Tint } from '../kit';
import { useAction, useAsync, useDebounced } from '../hooks';
import { useApp } from '../platform';

const AVATAR: { bg: string; fg: string }[] = [
  { bg: 'bg-indigo-100', fg: 'text-indigo-700' }, { bg: 'bg-emerald-100', fg: 'text-emerald-700' }, { bg: 'bg-amber-100', fg: 'text-amber-700' },
  { bg: 'bg-rose-100', fg: 'text-rose-700' }, { bg: 'bg-sky-100', fg: 'text-sky-700' },
];
const avatarOf = (name: string) => AVATAR[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length]!;
export type { Tint };

/** Pelanggan & pemasok: ringkasan transaksi, piutang/hutang, ubah, hapus, dan kirim pengingat tagihan. */
export function PartiesScreen() {
  const { backend } = useApp();
  const [kind, setKind] = useState<PartyKind>('customer');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const state = useAsync(() => backend.listPartyStats(kind, dq), [kind, dq]);
  const [sheet, setSheet] = useState<PartyStatsView | 'new' | null>(null);
  const owed = kind === 'customer' ? 'Piutang' : 'Hutang';
  return (
    <Screen title="Pelanggan & Pemasok" right={<Btn label="+ Baru" onPress={() => setSheet('new')} testID="party-new" />}>
      <Chips options={[{ value: 'customer', label: 'Pelanggan' }, { value: 'supplier', label: 'Pemasok' }]} value={kind} onChange={(k) => { setKind(k); setQ(''); }} testID="party-kind" />
      <Field value={q} onChangeText={setQ} placeholder="Cari nama" testID="party-search" autoCapitalize="none" />
      <Async state={state} empty={(d) => d.length === 0}>
        {(list) => (
          <Box className="gap-2">
            {list.map((p) => {
              const av = avatarOf(p.name);
              return (
                <Card key={p.id} testID="party-row" onPress={() => setSheet(p)} className="flex-row items-center gap-3">
                  <Box className={`h-11 w-11 items-center justify-center rounded-full ${av.bg}`}><Txt className={`text-lg font-bold ${av.fg}`}>{[...p.name][0]?.toUpperCase()}</Txt></Box>
                  <Box className="flex-1">
                    <Txt className="text-base font-semibold text-slate-900" numberOfLines={1}>{p.name}</Txt>
                    <Txt className="text-xs text-slate-500" numberOfLines={1}>{p.docCount > 0 ? `${p.docCount} transaksi · ${fmtDate(p.lastAt!)}` : (p.phone ?? 'Belum ada transaksi')}</Txt>
                  </Box>
                  <Box className="items-end">
                    {p.outstanding > 0 ? <Txt className="text-sm font-bold text-amber-600">{owed} {formatRupiah(p.outstanding)}</Txt> : <Txt className="text-sm font-semibold text-slate-700">{formatRupiah(p.totalAmount)}</Txt>}
                    <Txt className="text-[11px] text-slate-400">{p.outstanding > 0 ? `dari ${formatRupiah(p.totalAmount)}` : 'total transaksi'}</Txt>
                  </Box>
                </Card>
              );
            })}
          </Box>
        )}
      </Async>
      {sheet ? <PartySheet kind={kind} party={sheet === 'new' ? null : sheet} onClose={(changed) => { setSheet(null); if (changed) state.reload(); }} /> : null}
    </Screen>
  );
}

function PartySheet({ kind, party, onClose }: { kind: PartyKind; party: PartyStatsView | null; onClose: (changed: boolean) => void }) {
  const { backend, platform, businessName } = useApp();
  const act = useAction();
  const [name, setName] = useState(party?.name ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [note, setNote] = useState(party?.note ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const label = kind === 'customer' ? 'pelanggan' : 'pemasok';
  const save = () => act.run(async () => {
    const body = { name, phone: phone || null, address: address || null, note: note || null };
    if (party) await backend.updateParty(kind, party.id, body);
    else if (kind === 'customer') await backend.createCustomer(body);
    else await backend.createSupplier(body);
    platform.notify(party ? 'Perubahan disimpan' : `${label[0]!.toUpperCase()}${label.slice(1)} ditambahkan`);
    onClose(true);
  });
  const remind = () => act.run(async () => {
    const msg = `Halo ${party!.name}, kami dari ${businessName || 'toko kami'} mengingatkan masih ada sisa pembayaran ${formatRupiah(party!.outstanding)}. Mohon konfirmasinya, terima kasih 🙏`;
    await platform.shareText('Pengingat pembayaran', msg);
  });
  return (
    <Sheet visible title={party ? party.name : `${kind === 'customer' ? 'Pelanggan' : 'Pemasok'} baru`} onClose={() => onClose(false)}>
      {party && party.docCount > 0 ? (
        <Card className="gap-1" testID="party-stats">
          <Txt className="text-sm text-slate-600">{party.docCount} transaksi · total {formatRupiah(party.totalAmount)}</Txt>
          {party.outstanding > 0 ? <Txt className="text-base font-bold text-amber-600">{kind === 'customer' ? 'Piutang' : 'Hutang'} {formatRupiah(party.outstanding)}</Txt> : <Txt className="text-sm font-semibold text-emerald-600">Lunas semua</Txt>}
        </Card>
      ) : null}
      <Field label="Nama" value={name} onChangeText={setName} testID="party-name" />
      <Field label="Telepon (opsional)" value={phone} onChangeText={setPhone} keyboard="phone" testID="party-phone" />
      <Field label="Alamat (opsional)" value={address} onChangeText={setAddress} testID="party-address" />
      <Field label="Catatan (opsional)" value={note} onChangeText={setNote} testID="party-note" />
      <FormError message={act.error} />
      <Btn label="Simpan" onPress={save} loading={act.busy} testID="party-save" />
      {party && kind === 'customer' && party.outstanding > 0 ? <Btn label="📤 Kirim pengingat piutang" variant="secondary" onPress={remind} testID="party-remind" /> : null}
      {party ? (
        confirmDel
          ? <Btn label={`Ya, hapus ${label} ini`} variant="danger" testID="party-delete-confirm" onPress={() => act.run(async () => { await backend.deleteParty(kind, party.id); platform.notify('Dihapus'); onClose(true); })} />
          : <Btn label="Hapus" variant="ghost" testID="party-delete" onPress={() => setConfirmDel(true)} />
      ) : null}
    </Sheet>
  );
}
