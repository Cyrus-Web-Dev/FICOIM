import { col, table, type TableDef } from './defs';

// ---------- Enum (dipakai juga oleh UI) ----------
export const BUSINESS_TYPES = ['elektronik', 'non_elektronik', 'perabotan', 'fashion', 'makanan_minuman', 'lainnya'] as const;
export const MEMBER_ROLES = ['owner', 'manager', 'staff'] as const;
export const WALLET_TYPES = ['cash', 'bank', 'ewallet', 'other'] as const;
export const FLOW_TYPES = ['income', 'expense'] as const;
export const PAYMENT_STATUS = ['paid', 'partial', 'unpaid', 'void'] as const;
export const STOCK_MOVE_TYPES = ['initial', 'purchase', 'sale', 'return_in', 'return_out', 'adjustment', 'opname', 'damage'] as const;
export const FREQUENCIES = ['weekly', 'monthly', 'yearly'] as const;
export const DEBT_KINDS = ['receivable', 'payable'] as const;
export const DEBT_STATUS = ['open', 'partial', 'settled'] as const;
export const ASSET_KINDS = ['vehicle', 'building', 'furniture', 'equipment', 'other'] as const;
export const ASSET_CONDITIONS = ['baik', 'perlu_perawatan', 'rusak'] as const;
export const ASSET_STATUS = ['tersedia', 'dipinjam', 'maintenance', 'rusak'] as const;
export const LOAN_STATUS = ['dipinjam', 'kembali'] as const;
export const MAINT_STATUS = ['terjadwal', 'selesai', 'batal'] as const;

const money = { min: 0 } as const;

/**
 * URUTAN = urutan aman untuk restore (induk sebelum anak).
 * Tabel autentikasi (app_users, refresh_tokens, dst) sengaja TIDAK ada di sini:
 * kredensial tidak pernah masuk file backup.
 */
export const TABLES: TableDef[] = [
  table('businesses', [
    col('name', 'text'),
    col('business_type', 'text', { enum: BUSINESS_TYPES, def: 'lainnya' }),
    col('address', 'text', { null: true }),
    col('phone', 'text', { null: true }),
    col('currency', 'text', { def: 'IDR' }),
    col('tax_bp', 'int', { def: 0, min: 0, max: 10000 }),
    col('receipt_footer', 'text', { null: true }),
    col('settings', 'json', { null: true }),
  ], {}, true),

  // Daftar orang di bisnis (tanpa kredensial). user_id = tautan ke akun login di server; dikosongkan saat ekspor.
  table('members', [
    col('display_name', 'text'),
    col('role', 'text', { enum: MEMBER_ROLES, def: 'staff' }),
    col('user_id', 'uuid', { null: true }),
    col('can_view_reports', 'bool', { def: false }),
    col('can_delete', 'bool', { def: false }),
    col('is_active', 'bool', { def: true }),
  ]),

  // Metadata berkas (foto produk, struk, aset). Byte-nya dibawa terpisah di backup sebagai "blob".
  table('attachments', [
    col('owner_table', 'text', { null: true }),
    col('owner_id', 'uuid', { null: true }),
    col('file_name', 'text'),
    col('mime', 'text'),
    col('size_bytes', 'int', { min: 0 }),
    col('sha256', 'text'),
    col('storage_key', 'text', { null: true }), // lokasi di perangkat/server; dikosongkan saat ekspor
  ], { indexes: { ix_attachments_owner: ['owner_table', 'owner_id'] } }),

  table('product_categories', [
    col('name', 'text'),
    col('icon', 'text', { null: true }),
  ], { uniques: { ux_product_categories_name: ['business_id', 'name'] } }),

  table('products', [
    col('category_id', 'uuid', { null: true, ref: ['product_categories', 'set null'] }),
    col('name', 'text'),
    col('brand', 'text', { null: true }),
    col('description', 'text', { null: true }),
    col('unit', 'text', { def: 'pcs' }),
    col('track_stock', 'bool', { def: true }),
    col('track_expiry', 'bool', { def: false }),
    col('is_active', 'bool', { def: true }),
    col('photo_attachment_id', 'uuid', { null: true, ref: ['attachments', 'set null'] }),
  ], { indexes: { ix_products_name: ['business_id', 'name'], ix_products_category: ['category_id'] } }),

  // Setiap produk minimal punya 1 varian ("Default"). Fashion: "Merah / L"; elektronik: "128GB Hitam".
  table('product_variants', [
    col('product_id', 'uuid', { ref: ['products', 'cascade'] }),
    col('name', 'text', { def: 'Default' }),
    col('sku', 'text', { null: true }),
    col('barcode', 'text', { null: true }),
    col('cost_price', 'bigint', { def: 0, ...money }),
    col('sell_price', 'bigint', { def: 0, ...money }),
    col('stock_qty_milli', 'bigint', { def: 0 }), // CACHE dari stock_movements; dihitung ulang setelah restore
    col('min_stock_milli', 'bigint', { def: 0, ...money }),
    col('expiry_date', 'date', { null: true }),
    col('attributes', 'json', { null: true }),
  ], {
    uniques: { ux_variants_sku: ['business_id', 'sku'], ux_variants_barcode: ['business_id', 'barcode'] },
    indexes: { ix_variants_product: ['product_id'] },
  }),

  table('suppliers', [
    col('name', 'text'), col('phone', 'text', { null: true }),
    col('address', 'text', { null: true }), col('note', 'text', { null: true }),
  ]),

  table('customers', [
    col('name', 'text'), col('phone', 'text', { null: true }),
    col('address', 'text', { null: true }), col('note', 'text', { null: true }),
  ]),

  table('wallets', [
    col('name', 'text'),
    col('type', 'text', { enum: WALLET_TYPES, def: 'cash' }),
    col('opening_balance', 'bigint', { def: 0 }),
    col('balance', 'bigint', { def: 0 }), // CACHE; dihitung ulang setelah restore
  ], { uniques: { ux_wallets_name: ['business_id', 'name'] } }),

  table('finance_categories', [
    col('name', 'text'),
    col('type', 'text', { enum: ['income', 'expense'] }),
    col('icon', 'text', { null: true }),
    col('is_system', 'bool', { def: false }), // mis. "Penjualan", "Pembelian Stok"
  ], { uniques: { ux_fin_categories_name: ['business_id', 'type', 'name'] } }),

  table('sales', [
    col('number', 'text'),
    col('customer_id', 'uuid', { null: true, ref: ['customers', 'set null'] }),
    col('wallet_id', 'uuid', { null: true, ref: ['wallets', 'set null'] }),
    col('sold_at', 'timestamp'),
    col('subtotal', 'bigint', money),
    col('discount', 'bigint', { def: 0, ...money }),
    col('tax', 'bigint', { def: 0, ...money }),
    col('total', 'bigint', money),
    col('paid', 'bigint', { def: 0, ...money }),
    col('status', 'text', { enum: PAYMENT_STATUS, def: 'paid' }),
    col('note', 'text', { null: true }),
    col('created_by', 'uuid', { null: true, ref: ['members', 'set null'] }),
  ], {
    uniques: { ux_sales_number: ['business_id', 'number'] },
    indexes: { ix_sales_date: ['business_id', 'sold_at'] },
  }),

  table('sale_items', [
    col('sale_id', 'uuid', { ref: ['sales', 'cascade'] }),
    col('variant_id', 'uuid', { ref: 'product_variants' }),
    col('name_snapshot', 'text'),
    col('qty_milli', 'bigint', { min: 1 }),
    col('unit_price', 'bigint', money),
    col('cost_price', 'bigint', { def: 0, ...money }), // modal saat terjual -> untuk laba
    col('discount', 'bigint', { def: 0, ...money }),
    col('line_total', 'bigint', money),
  ], { indexes: { ix_sale_items_sale: ['sale_id'], ix_sale_items_variant: ['variant_id'] } }),

  table('purchases', [
    col('number', 'text'),
    col('supplier_id', 'uuid', { null: true, ref: ['suppliers', 'set null'] }),
    col('wallet_id', 'uuid', { null: true, ref: ['wallets', 'set null'] }),
    col('purchased_at', 'timestamp'),
    col('subtotal', 'bigint', money),
    col('discount', 'bigint', { def: 0, ...money }),
    col('total', 'bigint', money),
    col('paid', 'bigint', { def: 0, ...money }),
    col('status', 'text', { enum: PAYMENT_STATUS, def: 'paid' }),
    col('note', 'text', { null: true }),
    col('created_by', 'uuid', { null: true, ref: ['members', 'set null'] }),
  ], {
    uniques: { ux_purchases_number: ['business_id', 'number'] },
    indexes: { ix_purchases_date: ['business_id', 'purchased_at'] },
  }),

  table('purchase_items', [
    col('purchase_id', 'uuid', { ref: ['purchases', 'cascade'] }),
    col('variant_id', 'uuid', { ref: 'product_variants' }),
    col('name_snapshot', 'text'),
    col('qty_milli', 'bigint', { min: 1 }),
    col('unit_cost', 'bigint', money),
    col('line_total', 'bigint', money),
  ], { indexes: { ix_purchase_items_purchase: ['purchase_id'] } }),

  // Buku besar stok: satu-satunya sumber kebenaran jumlah stok.
  table('stock_movements', [
    col('variant_id', 'uuid', { ref: 'product_variants' }),
    col('type', 'text', { enum: STOCK_MOVE_TYPES }),
    col('qty_delta_milli', 'bigint'), // bertanda: + masuk, - keluar
    col('unit_cost', 'bigint', { null: true, ...money }),
    col('ref_table', 'text', { null: true }),
    col('ref_id', 'uuid', { null: true }),
    col('occurred_at', 'timestamp'),
    col('note', 'text', { null: true }),
    col('created_by', 'uuid', { null: true, ref: ['members', 'set null'] }),
  ], { indexes: { ix_stock_variant_time: ['variant_id', 'occurred_at'], ix_stock_ref: ['ref_table', 'ref_id'] } }),

  table('transactions', [
    col('wallet_id', 'uuid', { ref: 'wallets' }),
    col('category_id', 'uuid', { ref: 'finance_categories' }),
    col('type', 'text', { enum: FLOW_TYPES }),
    col('amount', 'bigint', { min: 1 }),
    col('occurred_on', 'date'),
    col('description', 'text', { null: true }),
    col('ref_table', 'text', { null: true }), // mis. 'sales' -> transaksi otomatis dari penjualan
    col('ref_id', 'uuid', { null: true }),
    col('receipt_attachment_id', 'uuid', { null: true, ref: ['attachments', 'set null'] }),
    col('created_by', 'uuid', { null: true, ref: ['members', 'set null'] }),
  ], { indexes: { ix_tx_date: ['business_id', 'occurred_on'], ix_tx_wallet: ['wallet_id'], ix_tx_ref: ['ref_table', 'ref_id'] } }),

  table('budgets', [
    col('category_id', 'uuid', { ref: ['finance_categories', 'cascade'] }),
    col('amount_limit', 'bigint', { min: 1 }),
    col('month', 'int', { min: 1, max: 12 }),
    col('year', 'int', { min: 2000, max: 2200 }),
  ], { uniques: { ux_budgets_period: ['business_id', 'category_id', 'month', 'year'] } }),

  table('saving_goals', [
    col('title', 'text'),
    col('target_amount', 'bigint', { min: 1 }),
    col('current_amount', 'bigint', { def: 0, ...money }),
    col('target_date', 'date', { null: true }),
  ]),

  table('recurring_bills', [
    col('wallet_id', 'uuid', { ref: 'wallets' }),
    col('category_id', 'uuid', { ref: 'finance_categories' }),
    col('type', 'text', { enum: FLOW_TYPES }),
    col('amount', 'bigint', { min: 1 }),
    col('description', 'text', { null: true }),
    col('frequency', 'text', { enum: FREQUENCIES, def: 'monthly' }),
    col('next_due_date', 'date'),
    col('is_active', 'bool', { def: true }),
  ], { indexes: { ix_bills_due: ['business_id', 'next_due_date'] } }),

  // Hutang / piutang (dari penjualan atau pembelian kredit, atau manual).
  table('debts', [
    col('kind', 'text', { enum: DEBT_KINDS }),
    col('party_name', 'text'),
    col('customer_id', 'uuid', { null: true, ref: ['customers', 'set null'] }),
    col('supplier_id', 'uuid', { null: true, ref: ['suppliers', 'set null'] }),
    col('amount', 'bigint', { min: 1 }),
    col('paid_amount', 'bigint', { def: 0, ...money }),
    col('due_date', 'date', { null: true }),
    col('status', 'text', { enum: DEBT_STATUS, def: 'open' }),
    col('ref_table', 'text', { null: true }),
    col('ref_id', 'uuid', { null: true }),
    col('note', 'text', { null: true }),
  ], { indexes: { ix_debts_status: ['business_id', 'status'] } }),

  table('debt_payments', [
    col('debt_id', 'uuid', { ref: ['debts', 'cascade'] }),
    col('wallet_id', 'uuid', { null: true, ref: ['wallets', 'set null'] }),
    col('amount', 'bigint', { min: 1 }),
    col('paid_on', 'date'),
    col('note', 'text', { null: true }),
  ], { indexes: { ix_debt_payments_debt: ['debt_id'] } }),

  // Pengganti tabel kendaraan, bangunan, perabotan, alat di sistem inventaris lama.
  table('assets', [
    col('code', 'text', { null: true }),
    col('name', 'text'),
    col('kind', 'text', { enum: ASSET_KINDS, def: 'equipment' }),
    col('purchase_date', 'date', { null: true }),
    col('purchase_price', 'bigint', { def: 0, ...money }),
    col('useful_life_months', 'int', { null: true, min: 1 }),
    col('salvage_value', 'bigint', { def: 0, ...money }),
    col('condition', 'text', { enum: ASSET_CONDITIONS, def: 'baik' }),
    col('status', 'text', { enum: ASSET_STATUS, def: 'tersedia' }),
    col('location', 'text', { null: true }),
    col('plate_number', 'text', { null: true }),
    col('note', 'text', { null: true }),
    col('photo_attachment_id', 'uuid', { null: true, ref: ['attachments', 'set null'] }),
  ], { uniques: { ux_assets_code: ['business_id', 'code'] } }),

  table('asset_loans', [
    col('asset_id', 'uuid', { ref: 'assets' }),
    col('borrower_name', 'text'),
    col('borrower_phone', 'text', { null: true }),
    col('purpose', 'text', { null: true }),
    col('loaned_at', 'timestamp'),
    col('due_at', 'timestamp', { null: true }),
    col('returned_at', 'timestamp', { null: true }),
    col('status', 'text', { enum: LOAN_STATUS, def: 'dipinjam' }),
    col('note', 'text', { null: true }),
  ], { indexes: { ix_loans_asset: ['asset_id'] } }),

  table('asset_maintenance', [
    col('asset_id', 'uuid', { ref: 'assets' }),
    col('scheduled_on', 'date'),
    col('done_on', 'date', { null: true }),
    col('cost', 'bigint', { def: 0, ...money }),
    col('description', 'text', { null: true }),
    col('status', 'text', { enum: MAINT_STATUS, def: 'terjadwal' }),
  ], { indexes: { ix_maint_asset: ['asset_id'], ix_maint_due: ['business_id', 'scheduled_on'] } }),

  table('audit_log', [
    col('member_id', 'uuid', { null: true, ref: ['members', 'set null'] }),
    col('action', 'text'),
    col('table_name', 'text'),
    col('record_id', 'uuid', { null: true }),
    col('detail', 'json', { null: true }),
    col('occurred_at', 'timestamp'),
  ], { indexes: { ix_audit_time: ['business_id', 'occurred_at'] } }),
];

export const TABLE_ORDER: readonly string[] = TABLES.map((t) => t.name);
export const TABLE_BY_NAME: Readonly<Record<string, TableDef>> = Object.fromEntries(TABLES.map((t) => [t.name, t]));

/** Versi skema data. Naikkan setiap kali kolom/tabel berubah, lalu tambahkan migrasi di backup/migrations.ts. */
export const SCHEMA_VERSION = 1;
