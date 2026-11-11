import { uuidv7 } from '../ids';
import type { Row } from '../schema/rows';
import { emptyTables, type TableData } from '../schema/validate';
import type { BackupBlob } from '../backup/format';

/** Data contoh satu toko elektronik kecil — dipakai untuk tes dan (nanti) seed demo. */
export function buildSample(): { tables: TableData; blobs: BackupBlob[] } {
  const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
  const ts = (m: number) => new Date(T0 + m * 60_000).toISOString();
  let tick = 0;
  const id = () => uuidv7(T0 + tick++);
  const t = emptyTables();

  const bizId = id();
  const std = (extra: Row, minute = 0): Row => ({
    id: id(), business_id: bizId, created_at: ts(minute), updated_at: ts(minute), deleted_at: null, ...extra,
  });
  const add = (table: string, row: Row): Row => { (t[table] as Row[]).push(row); return row; };

  t.businesses!.push({
    id: bizId, name: 'Toko Maju Elektronik', business_type: 'elektronik', address: 'Jl. Raja Ali Haji No. 7, Batam',
    phone: '0778-123456', currency: 'IDR', tax_bp: 0, receipt_footer: 'Terima kasih 🙏', settings: { theme: 'light', lowStockAlert: true },
    created_at: ts(0), updated_at: ts(0), deleted_at: null,
  });

  const owner = add('members', std({ display_name: 'Budi (Pemilik)', role: 'owner', user_id: id(), can_view_reports: true, can_delete: true, is_active: true }));
  add('members', std({ display_name: 'Sari (Kasir)', role: 'staff', user_id: null, can_view_reports: false, can_delete: false, is_active: true }));

  const photo = add('attachments', std({
    owner_table: 'products', owner_id: null, file_name: 'hp.jpg', mime: 'image/jpeg', size_bytes: 0, sha256: '0'.repeat(64) /* placeholder: adapter mengisi dari byte berkas */, storage_key: '/data/user/0/app/files/hp.jpg',
  }));
  const photoBytes = Uint8Array.from({ length: 2048 }, (_, i) => (i * 31 + 7) & 0xff);
  photo.size_bytes = photoBytes.length;

  const catHp = add('product_categories', std({ name: 'Handphone', icon: '📱' }));
  const catAks = add('product_categories', std({ name: 'Aksesoris', icon: '🎧' }));

  const hp = add('products', std({ category_id: catHp.id, name: 'Ponsel Contoh X1', brand: 'Contoh', description: 'Layar 6,5"', unit: 'unit', track_stock: true, track_expiry: false, is_active: true, photo_attachment_id: photo.id }));
  photo.owner_id = hp.id;
  const cas = add('products', std({ category_id: catAks.id, name: 'Casing Silikon', brand: null, description: null, unit: 'pcs', track_stock: true, track_expiry: false, is_active: true, photo_attachment_id: null }));

  const hp128 = add('product_variants', std({ product_id: hp.id, name: '128GB Hitam', sku: 'HP-X1-128-BLK', barcode: '8991234500011', cost_price: 2_100_000, sell_price: 2_499_000, stock_qty_milli: 3000, min_stock_milli: 2000, expiry_date: null, attributes: { storage: '128GB', warna: 'Hitam' } }));
  add('product_variants', std({ product_id: hp.id, name: '256GB Biru', sku: 'HP-X1-256-BLU', barcode: '8991234500028', cost_price: 2_600_000, sell_price: 2_999_000, stock_qty_milli: 0, min_stock_milli: 1000, expiry_date: null, attributes: { storage: '256GB', warna: 'Biru' } }));
  const casV = add('product_variants', std({ product_id: cas.id, name: 'Default', sku: null, barcode: '8991234500035', cost_price: 8_000, sell_price: 25_000, stock_qty_milli: 48_000, min_stock_milli: 10_000, expiry_date: null, attributes: null }));

  const sup = add('suppliers', std({ name: 'PT Distributor Jaya', phone: '021-555-0101', address: 'Jakarta', note: null }));
  const cus = add('customers', std({ name: 'Rina', phone: '0812-0000-1111', address: null, note: 'Pelanggan tetap' }));

  const cash = add('wallets', std({ name: 'Kas Toko', type: 'cash', opening_balance: 5_000_000, balance: 0 }));
  const bank = add('wallets', std({ name: 'BCA Usaha', type: 'bank', opening_balance: 20_000_000, balance: 0 }));

  const fcSale = add('finance_categories', std({ name: 'Penjualan', type: 'income', icon: '🛒', is_system: true }));
  const fcBuy = add('finance_categories', std({ name: 'Pembelian Stok', type: 'expense', icon: '📦', is_system: true }));
  const fcPower = add('finance_categories', std({ name: 'Listrik & Air', type: 'expense', icon: '💡', is_system: false }));

  const po = add('purchases', std({ number: 'PB-2026-0001', supplier_id: sup.id, wallet_id: bank.id, purchased_at: ts(60), subtotal: 8_400_000 + 384_000, discount: 0, total: 8_784_000, paid: 8_784_000, status: 'paid', note: null, created_by: owner.id }, 60));
  add('purchase_items', std({ purchase_id: po.id, variant_id: hp128.id, name_snapshot: 'Ponsel Contoh X1 128GB Hitam', qty_milli: 4000, unit_cost: 2_100_000, line_total: 8_400_000 }, 60));
  add('purchase_items', std({ purchase_id: po.id, variant_id: casV.id, name_snapshot: 'Casing Silikon', qty_milli: 48_000, unit_cost: 8_000, line_total: 384_000 }, 60));
  add('stock_movements', std({ variant_id: hp128.id, type: 'purchase', qty_delta_milli: 4000, unit_cost: 2_100_000, ref_table: 'purchases', ref_id: po.id, occurred_at: ts(60), note: null, created_by: owner.id }, 60));
  add('stock_movements', std({ variant_id: casV.id, type: 'purchase', qty_delta_milli: 48_000, unit_cost: 8_000, ref_table: 'purchases', ref_id: po.id, occurred_at: ts(60), note: null, created_by: owner.id }, 60));
  add('transactions', std({ wallet_id: bank.id, category_id: fcBuy.id, type: 'expense', amount: 8_784_000, occurred_on: '2026-10-01', description: 'Pembelian PB-2026-0001', ref_table: 'purchases', ref_id: po.id, receipt_attachment_id: null, created_by: owner.id }, 60));

  const so = add('sales', std({ number: 'PJ-2026-0001', customer_id: cus.id, wallet_id: cash.id, sold_at: ts(180), subtotal: 2_499_000, discount: 0, tax: 0, total: 2_499_000, paid: 2_000_000, status: 'partial', note: 'DP dulu', created_by: owner.id }, 180));
  add('sale_items', std({ sale_id: so.id, variant_id: hp128.id, name_snapshot: 'Ponsel Contoh X1 128GB Hitam', qty_milli: 1000, unit_price: 2_499_000, cost_price: 2_100_000, discount: 0, line_total: 2_499_000 }, 180));
  add('stock_movements', std({ variant_id: hp128.id, type: 'sale', qty_delta_milli: -1000, unit_cost: 2_100_000, ref_table: 'sales', ref_id: so.id, occurred_at: ts(180), note: null, created_by: owner.id }, 180));
  add('transactions', std({ wallet_id: cash.id, category_id: fcSale.id, type: 'income', amount: 2_000_000, occurred_on: '2026-10-01', description: 'DP penjualan PJ-2026-0001', ref_table: 'sales', ref_id: so.id, receipt_attachment_id: null, created_by: owner.id }, 180));

  const debt = add('debts', std({ kind: 'receivable', party_name: 'Rina', customer_id: cus.id, supplier_id: null, amount: 499_000, paid_amount: 100_000, due_date: '2026-10-15', status: 'partial', ref_table: 'sales', ref_id: so.id, note: null }, 180));
  add('debt_payments', std({ debt_id: debt.id, wallet_id: cash.id, amount: 100_000, paid_on: '2026-10-08', note: 'Cicilan 1' }, 240));

  add('budgets', std({ category_id: fcPower.id, amount_limit: 1_500_000, month: 10, year: 2026 }));
  add('saving_goals', std({ title: 'Etalase baru', target_amount: 12_000_000, current_amount: 3_000_000, target_date: '2027-03-31' }));
  add('recurring_bills', std({ wallet_id: bank.id, category_id: fcPower.id, type: 'expense', amount: 850_000, description: 'Listrik toko', frequency: 'monthly', next_due_date: '2026-11-05', is_active: true }));

  const van = add('assets', std({ code: 'AST-001', name: 'Mobil Box Grand Max', kind: 'vehicle', purchase_date: '2024-02-10', purchase_price: 165_000_000, useful_life_months: 96, salvage_value: 40_000_000, condition: 'baik', status: 'dipinjam', location: 'Gudang', plate_number: 'BP 1234 XY', note: null, photo_attachment_id: null }));
  add('asset_loans', std({ asset_id: van.id, borrower_name: 'Sari', borrower_phone: null, purpose: 'Antar barang', loaned_at: ts(300), due_at: ts(420), returned_at: null, status: 'dipinjam', note: null }, 300));
  add('asset_maintenance', std({ asset_id: van.id, scheduled_on: '2026-11-20', done_on: null, cost: 0, description: 'Servis 40.000 km', status: 'terjadwal' }));

  add('audit_log', std({ member_id: owner.id, action: 'create', table_name: 'sales', record_id: so.id, detail: { total: 2_499_000 }, occurred_at: ts(180) }, 180));

  return { tables: t, blobs: [{ id: photo.id as string, mime: 'image/jpeg', data: photoBytes }] };
}
