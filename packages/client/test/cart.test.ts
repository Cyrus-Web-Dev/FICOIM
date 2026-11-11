import test from 'node:test';
import assert from 'node:assert/strict';
import { addToCart, emptyCart, setLineDiscount, setLinePrice, setOrderDiscount, setQty, stockWarnings, toSaleInput, totals, subtotalOf } from '../src/cart';
import { LocalBackend } from '../src/local';
import { nodeRuntime } from '@ficoim/shared/backup/runtime-node';
import { newDb } from '../../core/test/helpers';
import type { VariantView } from '@ficoim/core';

const V = (o: Partial<VariantView> & { id: string }): VariantView => ({ productId: 'p', productName: 'Produk', categoryId: null, categoryName: null, variantName: 'Default', sku: null, barcode: null, unit: 'pcs', costPrice: 0, sellPrice: 10_000, stockQtyMilli: 10_000, minStockMilli: 0, trackStock: true, expiryDate: null, isActive: true, ...o });

test('keranjang: tambah menggabung baris sama; ubah qty; qty 0 menghapus; pecahan', () => {
  let c = addToCart(emptyCart(), V({ id: 'a' }));
  c = addToCart(c, V({ id: 'a' }));
  assert.equal(c.lines.length, 1); assert.equal(c.lines[0]!.qtyMilli, 2000);
  c = addToCart(c, V({ id: 'b', productName: 'Kopi', variantName: '250g', unit: 'kg', sellPrice: 120_000 }), 1500);
  assert.equal(c.lines[1]!.name, 'Kopi 250g');
  assert.equal(subtotalOf(c), 2 * 10_000 + 180_000);
  c = setQty(c, 0, 0);
  assert.deepEqual(c.lines.map((l) => l.variantId), ['b']);
  assert.equal(setQty(c, 0, -5).lines.length, 0);
  // harga berbeda (nego) tidak digabung dengan baris harga normal
  let d = addToCart(emptyCart(), V({ id: 'a' })); d = setLinePrice(d, 0, 9000); d = addToCart(d, V({ id: 'a' }));
  assert.equal(d.lines.length, 2);
});

test('diskon dibatasi: item <= harga baris, pesanan <= subtotal; peringatan stok per varian (gabungan baris)', () => {
  let c = addToCart(emptyCart(), V({ id: 'a', sellPrice: 5000 }), 2000);
  c = setLineDiscount(c, 0, 999_999); assert.equal(c.lines[0]!.discount, 10_000);
  c = setLineDiscount(c, 0, 0); c = setOrderDiscount(c, 1_000_000); assert.equal(c.discount, 10_000);
  const w = addToCart(addToCart(emptyCart(), V({ id: 'x', stockQtyMilli: 3000, productName: 'Langka' }), 2000), V({ id: 'x', stockQtyMilli: 3000, productName: 'Langka' }), 2000);
  assert.deepEqual(stockWarnings(w), ['Langka: stok 3, diminta 4']);
  assert.deepEqual(stockWarnings(addToCart(emptyCart(), V({ id: 'j', trackStock: false, stockQtyMilli: 0 }), 5000)), []); // jasa tidak dicek
});

test('PRATINJAU = HASIL SERVER: total keranjang identik dengan createSale untuk 300 keranjang acak (PPN, diskon, qty pecahan)', async () => {
  const be = new LocalBackend({ db: newDb(), runtime: nodeRuntime, appVersion: 't' });
  await be.createBusiness({ name: 'Uji', businessType: 'lainnya', ownerName: 'Budi' });
  await be.updateBusiness({ taxBp: 1100 });
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push((await be.createProduct({ name: `P${i}`, variants: [{ costPrice: 100 * (i + 1), sellPrice: [1500, 9999, 12_345, 777, 250_000, 33_333][i], openingQtyMilli: 10_000_000 }] })).variantIds[0] as string);
  let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const taxBp = (await be.business()).taxBp;
  for (let k = 0; k < 300; k++) {
    let cart = emptyCart();
    for (let j = 0, n = 1 + rnd(4); j < n; j++) {
      const pick = ids[rnd(6)];
      const v = (await be.listProducts({ limit: 100 })).find((x) => x.id === pick)!;
      cart = addToCart(cart, v, 1 + rnd(7500)); // qty milli acak (0,001 .. 7,5)
      if (rnd(3) === 0) cart = setLineDiscount(cart, cart.lines.length - 1, rnd(2000));
    }
    if (rnd(3) === 0) cart = setOrderDiscount(cart, rnd(5000));
    const preview = totals(cart, taxBp);
    const real = await be.createSale(toSaleInput(cart, {}));
    assert.deepEqual([preview.subtotal, preview.discount, preview.tax, preview.total], [real.subtotal, real.discount, real.tax, real.total], `keranjang #${k}`);
  }
});
