import test from 'node:test';
import assert from 'node:assert/strict';
import { addVariant, adjustStock, createProduct, deleteProduct, findByCode, listProducts, stockCard, updateProduct, updateVariant } from '../src/index';
import { bootstrap, code, count, mk, n, q1, stockOf } from './helpers';

test('createProduct: banyak varian, stok awal tercatat di buku besar, SKU/barcode dinormalisasi', async () => {
  const { ctx, db } = await bootstrap();
  const r = await createProduct(ctx, {
    name: 'Kaos Polos', unit: 'pcs',
    variants: [
      { name: 'Merah / L', sku: ' KP-M-L ', barcode: '', costPrice: 30_000, sellPrice: 59_000, openingQtyMilli: 12_000, minStockMilli: 3000, attributes: { warna: 'Merah', ukuran: 'L' } },
      { name: 'Biru / M', sku: 'KP-B-M', costPrice: 30_000, sellPrice: 59_000, openingQtyMilli: 0 },
    ],
  });
  assert.equal(r.variantIds.length, 2);
  assert.equal(await stockOf(db, r.variantIds[0]!), 12_000);
  const v = await q1(db, 'SELECT sku, barcode, attributes FROM product_variants WHERE id = ?', [r.variantIds[0]]);
  assert.equal(v.sku, 'KP-M-L'); assert.equal(v.barcode, null); assert.deepEqual(JSON.parse(String(v.attributes)), { warna: 'Merah', ukuran: 'L' });
  const mv = await stockCard(ctx, r.variantIds[0]!);
  assert.deepEqual(mv.map((m) => [m.type, m.deltaMilli, m.unitCost]), [['initial', 12_000, 30_000]]);
  assert.equal((await listProducts(ctx)).length, 2);
});

test('SKU & barcode unik; pesan menyebut produk yang bentrok; kembar dalam satu input ditolak', async () => {
  const { ctx } = await bootstrap();
  await createProduct(ctx, { name: 'Kabel USB', variants: [{ sku: 'KB-1', barcode: '899001', sellPrice: 10_000 }] });
  try { await createProduct(ctx, { name: 'Kabel Lain', variants: [{ sku: 'KB-1' }] }); assert.fail(); }
  catch (e) { assert.match((e as Error).message, /SKU "KB-1".*Kabel USB/); }
  assert.equal(await code(createProduct(ctx, { name: 'X', variants: [{ barcode: '899001' }] })), 'CONFLICT');
  assert.equal(await code(createProduct(ctx, { name: 'Y', variants: [{ sku: 'A' }, { name: 'v2', sku: 'A' }] })), 'CONFLICT');
  assert.equal(await code(createProduct(ctx, { name: '' })), 'VALIDATION');
  assert.equal(await code(createProduct(ctx, { name: 'Z', variants: [{ sellPrice: -1 }] })), 'VALIDATION');
  assert.equal(await code(createProduct(ctx, { name: 'Z', variants: [{ sellPrice: 1.5 }] })), 'VALIDATION');
  assert.equal(await code(createProduct(ctx, { name: 'Z', categoryId: '00000000-0000-7000-8000-000000000000' })), 'NOT_FOUND');
});

test('gagal di tengah (varian ke-2 bentrok) membatalkan produk & varian ke-1', async () => {
  const { ctx, db } = await bootstrap();
  await createProduct(ctx, { name: 'Ada', variants: [{ sku: 'DUP' }] });
  const before = await count(db, 'products');
  assert.equal(await code(createProduct(ctx, { name: 'Baru', variants: [{ sku: 'OK1', openingQtyMilli: 5000 }, { name: 'b', sku: 'DUP' }] })), 'CONFLICT');
  assert.equal(await count(db, 'products'), before);
  assert.equal(await count(db, 'stock_movements'), 0);
});

test('produk non-stok (jasa) mengabaikan stok awal', async () => {
  const { ctx, db } = await bootstrap();
  const r = await createProduct(ctx, { name: 'Jasa Servis', trackStock: false, variants: [{ sellPrice: 50_000, openingQtyMilli: 9000 }] });
  assert.equal(await stockOf(db, r.variantIds[0]!), 0);
  assert.equal(await count(db, 'stock_movements'), 0);
});

test('pencarian: nama, varian, SKU, barcode; karakter % dan _ dianggap huruf biasa; filter stok menipis', async () => {
  const { ctx } = await bootstrap();
  await createProduct(ctx, { name: 'Kaos 100% Katun', variants: [{ sku: 'K-100', barcode: '111', openingQtyMilli: 1000, minStockMilli: 5000 }] });
  await createProduct(ctx, { name: 'Celana_Panjang', variants: [{ sku: 'C-1', barcode: '222', openingQtyMilli: 20_000, minStockMilli: 5000 }] });
  await createProduct(ctx, { name: 'Topi', variants: [{ barcode: '333' }] });
  assert.deepEqual((await listProducts(ctx, { search: '100%' })).map((p) => p.productName), ['Kaos 100% Katun']);
  assert.deepEqual((await listProducts(ctx, { search: '%' })).map((p) => p.productName), ['Kaos 100% Katun']);
  assert.deepEqual((await listProducts(ctx, { search: '_' })).map((p) => p.productName), ['Celana_Panjang']);
  assert.deepEqual((await listProducts(ctx, { search: 'k-100' })).map((p) => p.productName), ['Kaos 100% Katun']);
  assert.deepEqual((await listProducts(ctx, { search: '222' })).map((p) => p.productName), ['Celana_Panjang']);
  assert.deepEqual((await listProducts(ctx, { lowStockOnly: true })).map((p) => p.productName), ['Kaos 100% Katun']);
  assert.equal((await findByCode(ctx, '333'))?.productName, 'Topi');
  assert.equal((await findByCode(ctx, 'C-1'))?.productName, 'Celana_Panjang');
  assert.equal(await findByCode(ctx, 'tidak-ada'), null);
  assert.equal((await listProducts(ctx, { limit: 2 })).length, 2);
});

test('updateVariant / updateProduct / addVariant / deleteProduct', async () => {
  const { ctx, db } = await bootstrap();
  const a = await createProduct(ctx, { name: 'A', variants: [{ sku: 'SA', costPrice: 100, sellPrice: 200 }] });
  const b = await createProduct(ctx, { name: 'B', variants: [{ sku: 'SB' }] });
  await updateVariant(ctx, a.variantIds[0]!, { sku: 'SA', sellPrice: 250 }); // SKU sendiri tidak dianggap bentrok
  assert.equal(n((await q1(db, 'SELECT sell_price p FROM product_variants WHERE id = ?', [a.variantIds[0]])).p), 250);
  assert.equal(await code(updateVariant(ctx, a.variantIds[0]!, { sku: 'SB' })), 'CONFLICT');
  assert.equal(await code(updateVariant(ctx, 'tidak-ada', { sellPrice: 1 })), 'NOT_FOUND');
  await updateProduct(ctx, a.productId, { name: 'A2', isActive: false });
  assert.equal((await listProducts(ctx)).length, 1);
  assert.equal((await listProducts(ctx, { includeInactive: true })).length, 2);
  const v2 = await addVariant(ctx, b.productId, { name: 'XL', sku: 'SB-XL', openingQtyMilli: 3000, costPrice: 10 });
  assert.equal(await stockOf(db, v2), 3000);
  await deleteProduct(ctx, b.productId);
  assert.equal((await listProducts(ctx, { includeInactive: true })).length, 1);
  // SKU yang sudah diarsipkan boleh dipakai lagi
  await createProduct(ctx, { name: 'B baru', variants: [{ sku: 'SB' }] });
});

test('adjustStock: opname (set) dan penyesuaian (delta), tercatat di kartu stok', async () => {
  const { ctx, db } = await bootstrap();
  const v = await mk(ctx, 'Baterai', 5000, 9000, 10);
  assert.deepEqual(await adjustStock(ctx, { variantId: v, mode: 'set', qtyMilli: 7000, note: 'hitung fisik' }), { before: 10_000, after: 7000 });
  assert.deepEqual(await adjustStock(ctx, { variantId: v, mode: 'delta', qtyMilli: -2000, reason: 'damage' }), { before: 7000, after: 5000 });
  assert.deepEqual(await adjustStock(ctx, { variantId: v, mode: 'set', qtyMilli: 5000 }), { before: 5000, after: 5000 }); // tanpa perubahan -> tanpa mutasi
  assert.equal(await stockOf(db, v), 5000);
  assert.deepEqual((await stockCard(ctx, v)).map((m) => [m.type, m.deltaMilli]), [['damage', -2000], ['opname', -3000], ['initial', 10_000]]);
  assert.equal(await code(adjustStock(ctx, { variantId: v, mode: 'delta', qtyMilli: -9000 })), 'INSUFFICIENT_STOCK');
  assert.equal(await stockOf(db, v), 5000);
  assert.equal(await code(adjustStock(ctx, { variantId: v, mode: 'set', qtyMilli: -1 })), 'VALIDATION');
});
