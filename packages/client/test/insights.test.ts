import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, deltaPct, fillDays, type DaySales } from '../src/insights';

const days = (from: string, totals: number[]): DaySales[] => fillDays(from, new Date(Date.parse(from + 'T00:00:00Z') + (totals.length - 1) * 86400000).toISOString().slice(0, 10), totals.map((t, i) => ({ date: new Date(Date.parse(from + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10), total: t, count: t ? 1 : 0 })));

test('fillDays: melengkapi hari kosong dengan 0 dan menjaga urutan; deltaPct', () => {
  const f = fillDays('2026-11-01', '2026-11-05', [{ date: '2026-11-02', total: 100, count: 1 }, { date: '2026-11-05', total: 50, count: 2 }]);
  assert.deepEqual(f.map((d) => d.total), [0, 100, 0, 0, 50]);
  assert.equal(f.length, 5);
  assert.equal(fillDays('2026-12-30', '2027-01-02', []).length, 4);   // melintasi tahun
  assert.equal(deltaPct(150, 100), 50); assert.equal(deltaPct(50, 100), -50); assert.equal(deltaPct(10, 0), null); assert.equal(deltaPct(0, 100), -100);
});

test('wawasan: kenaikan/penurunan vs kemarin, minggu vs minggu, urutan peringatan dulu, batas jumlah', () => {
  const up = buildInsights({ days: days('2026-10-12', [...Array(28).fill(100_000), 150_000]) });
  assert.equal(up[0]!.id, 'vs-yesterday'); assert.equal(up[0]!.tone, 'good'); assert.match(up[0]!.text, /naik 50%/);
  const down = buildInsights({ days: days('2026-10-12', [...Array(28).fill(100_000), 40_000]) });
  assert.equal(down[0]!.tone, 'warn'); assert.match(down[0]!.text, /turun 60%/);
  const noSalesYet = buildInsights({ days: days('2026-10-12', [...Array(28).fill(100_000), 0]) });
  assert.ok(!noSalesYet.some((x) => x.id === 'vs-yesterday'));              // hari baru mulai: tidak dihakimi "turun 100%"
  const week = buildInsights({ days: days('2026-10-12', [...Array(21).fill(100_000), ...Array(7).fill(150_000)]) });
  assert.ok(week.some((x) => x.id === 'week' && /naik 50%/.test(x.text)));
  const mixed = buildInsights({
    days: days('2026-10-12', Array(29).fill(100_000)), stock: { safe: 5, low: 2, out: 3 }, cash: { cashIn: 100, cashOut: 500 }, overdueReceivable: 250_000,
    top: [{ name: 'Kabel', revenue: 900_000, qtyMilli: 36_000 }], categories: [{ category: 'Aksesoris', revenue: 800_000, marginPct: 9.5 }, { category: 'HP', revenue: 100_000, marginPct: 40 }],
  }, 10);
  const tones = mixed.map((x) => x.tone);
  assert.deepEqual(tones, [...tones].sort((a, b) => ({ warn: 0, good: 1, info: 2 }[a] - { warn: 0, good: 1, info: 2 }[b])));
  for (const id of ['thin-margin', 'out', 'cash', 'overdue', 'top']) assert.ok(mixed.some((x) => x.id === id), id);
  assert.match(mixed.find((x) => x.id === 'thin-margin')!.text, /Aksesoris hanya 9,5%/);
  assert.ok(!mixed.some((x) => x.id === 'low'));                               // "habis" menggantikan "menipis"
  assert.equal(buildInsights({ days: days('2026-10-12', Array(29).fill(100_000)), stock: { safe: 0, low: 1, out: 1 }, cash: { cashIn: 1, cashOut: 9 }, overdueReceivable: 5 }, 2).length, 2);
});

test('hari terbaik: muncul hanya bila jelas lebih tinggi dari rata-rata; data kosong tidak menghasilkan wawasan', () => {
  // 28 hari mulai Senin 2026-10-05; hari Sabtu 4x lebih besar
  const base = days('2026-10-05', Array.from({ length: 28 }, (_, i) => (i % 7 === 5 ? 400_000 : 100_000)));
  const best = buildInsights({ days: base }, 10).find((x) => x.id === 'best-day');
  assert.ok(best && /Sabtu/.test(best.text));
  assert.ok(!buildInsights({ days: days('2026-10-05', Array(28).fill(100_000)) }, 10).some((x) => x.id === 'best-day'));
  assert.deepEqual(buildInsights({ days: [] }), []);
  assert.deepEqual(buildInsights({ days: days('2026-10-05', Array(28).fill(0)) }), []);
});

import { formatDelta } from '../src/insights';
test('formatDelta & lonjakan ekstrem tidak menampilkan persentase tak masuk akal', () => {
  assert.equal(formatDelta(12), '+12%'); assert.equal(formatDelta(-20), '−20%'); assert.equal(formatDelta(1929), '>+300%'); assert.equal(formatDelta(-900), '>−300%'); assert.equal(formatDelta(0), '+0%');
  const t = buildInsights({ days: days('2026-10-12', [...Array(28).fill(10_000), 3_800_000]) });
  assert.match(t.find((x) => x.id === 'vs-yesterday')!.text, /melonjak/);
  assert.ok(!t.some((x) => /1929|\d{4}%/.test(x.text)));
});
