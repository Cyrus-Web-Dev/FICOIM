import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { exportBackup, getBusiness, memoryBlobStore, readImage, restoreBackup, saveImage, updateBusiness, loadCtx } from '../src/index';
import { bootstrap, code, memberCtx, newDb, q1 } from './helpers';

const jpeg = (seed: number) => Uint8Array.from({ length: 80 }, (_, i) => (i < 3 ? [0xff, 0xd8, 0xff][i]! : (i * 5 + seed) & 255));

test('logo & lebar struk: pasang, ganti (logo lama dibuang), hapus; validasi; hanya yang berhak; ikut backup', async () => {
  const w = await bootstrap(), blobs = memoryBlobStore(), deps = { blobStore: blobs, runtime: nodeRuntime };
  assert.deepEqual([(await getBusiness(w.ctx)).logoAttachmentId, (await getBusiness(w.ctx)).receiptCols], [null, 32]);
  const a = await saveImage(w.ctx, deps, { bytes: jpeg(1) }), b = await saveImage(w.ctx, deps, { bytes: jpeg(2) });
  await updateBusiness(w.ctx, { logoAttachmentId: a.id, receiptCols: 42 });
  let biz = await getBusiness(w.ctx);
  assert.deepEqual([biz.logoAttachmentId, biz.receiptCols], [a.id, 42]);
  await updateBusiness(w.ctx, { name: 'Toko Baru' });                              // bidang lain tidak menyentuh logo
  assert.equal((await getBusiness(w.ctx)).logoAttachmentId, a.id);
  await updateBusiness(w.ctx, { logoAttachmentId: b.id });
  assert.notEqual((await q1(w.db, 'SELECT deleted_at d FROM attachments WHERE id = ?', [a.id])).d, null);
  assert.equal(await code(readImage(w.ctx, blobs, a.id)), 'NOT_FOUND');
  assert.equal((await getBusiness(w.ctx)).receiptCols, 42);                         // lebar tidak ikut berubah
  assert.equal(await code(updateBusiness(w.ctx, { receiptCols: 50 })), 'VALIDATION');
  assert.equal(await code(updateBusiness(w.ctx, { logoAttachmentId: '018f0000-0000-7000-8000-000000000000' })), 'NOT_FOUND');
  assert.equal(await code(updateBusiness(await memberCtx(w, 'staff'), { receiptCols: 32 })), 'FORBIDDEN');

  // ikut backup ke perangkat lain
  const file = await exportBackup(w.ctx, { password: 'Toko-Maju-2026!', runtime: nodeRuntime, source: { platform: 'server', appVersion: 't' }, kdf: { logN: 14, r: 8, p: 1 }, blobStore: blobs });
  const db2 = newDb(), store2 = memoryBlobStore();
  await restoreBackup(db2, file, { password: 'Toko-Maju-2026!', runtime: nodeRuntime, mode: 'replace', blobStore: store2 });
  const ctx2 = await loadCtx(db2, w.businessId, w.ownerId);
  biz = await getBusiness(ctx2);
  assert.deepEqual([biz.logoAttachmentId, biz.receiptCols], [b.id, 42]);
  assert.deepEqual((await readImage(ctx2, store2, b.id)).bytes, jpeg(2));

  await updateBusiness(w.ctx, { logoAttachmentId: null });
  assert.equal((await getBusiness(w.ctx)).logoAttachmentId, null);
});
