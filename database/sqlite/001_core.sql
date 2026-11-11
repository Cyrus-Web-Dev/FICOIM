-- GENERATED FILE — JANGAN DIEDIT TANGAN.
-- Sumber: packages/shared/src/schema/tables.ts   |   Regenerasi: npm run gen:sql
-- Dialek: sqlite   |   Versi skema data: 1

-- Jalankan PRAGMA foreign_keys = ON pada SETIAP koneksi (SQLite tidak mengaktifkannya otomatis).
-- Uang = INTEGER Rupiah; qty = INTEGER milli; waktu = TEXT ISO-8601 UTC (…Z); bool = 0/1; json = TEXT.

CREATE TABLE "businesses" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "business_type" TEXT NOT NULL DEFAULT 'lainnya',
  "address" TEXT,
  "phone" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'IDR',
  "tax_bp" INTEGER NOT NULL DEFAULT 0,
  "receipt_footer" TEXT,
  "settings" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_businesses_business_type" CHECK ("business_type" IN ('elektronik', 'non_elektronik', 'perabotan', 'fashion', 'makanan_minuman', 'lainnya')),
  CONSTRAINT "ck_businesses_tax_bp_min" CHECK ("tax_bp" >= 0),
  CONSTRAINT "ck_businesses_tax_bp_max" CHECK ("tax_bp" <= 10000)
);

CREATE TABLE "members" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "display_name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'staff',
  "user_id" TEXT,
  "can_view_reports" INTEGER NOT NULL DEFAULT 0,
  "can_delete" INTEGER NOT NULL DEFAULT 0,
  "is_active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_members_role" CHECK ("role" IN ('owner', 'manager', 'staff')),
  CONSTRAINT "ck_members_can_view_reports_bool" CHECK ("can_view_reports" IN (0, 1)),
  CONSTRAINT "ck_members_can_delete_bool" CHECK ("can_delete" IN (0, 1)),
  CONSTRAINT "ck_members_is_active_bool" CHECK ("is_active" IN (0, 1))
);
CREATE INDEX "ix_members_sync" ON "members" ("business_id", "updated_at");

CREATE TABLE "attachments" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "owner_table" TEXT,
  "owner_id" TEXT,
  "file_name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storage_key" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_attachments_size_bytes_min" CHECK ("size_bytes" >= 0)
);
CREATE INDEX "ix_attachments_sync" ON "attachments" ("business_id", "updated_at");
CREATE INDEX "ix_attachments_owner" ON "attachments" ("owner_table", "owner_id");

CREATE TABLE "product_categories" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT
);
CREATE UNIQUE INDEX "ux_product_categories_name" ON "product_categories" ("business_id", "name") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_product_categories_sync" ON "product_categories" ("business_id", "updated_at");

CREATE TABLE "products" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "category_id" TEXT REFERENCES "product_categories"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "description" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'pcs',
  "track_stock" INTEGER NOT NULL DEFAULT 1,
  "track_expiry" INTEGER NOT NULL DEFAULT 0,
  "is_active" INTEGER NOT NULL DEFAULT 1,
  "photo_attachment_id" TEXT REFERENCES "attachments"("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_products_track_stock_bool" CHECK ("track_stock" IN (0, 1)),
  CONSTRAINT "ck_products_track_expiry_bool" CHECK ("track_expiry" IN (0, 1)),
  CONSTRAINT "ck_products_is_active_bool" CHECK ("is_active" IN (0, 1))
);
CREATE INDEX "ix_products_sync" ON "products" ("business_id", "updated_at");
CREATE INDEX "ix_products_name" ON "products" ("business_id", "name");
CREATE INDEX "ix_products_category" ON "products" ("category_id");

CREATE TABLE "product_variants" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL DEFAULT 'Default',
  "sku" TEXT,
  "barcode" TEXT,
  "cost_price" INTEGER NOT NULL DEFAULT 0,
  "sell_price" INTEGER NOT NULL DEFAULT 0,
  "stock_qty_milli" INTEGER NOT NULL DEFAULT 0,
  "min_stock_milli" INTEGER NOT NULL DEFAULT 0,
  "expiry_date" TEXT,
  "attributes" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_product_variants_cost_price_min" CHECK ("cost_price" >= 0),
  CONSTRAINT "ck_product_variants_sell_price_min" CHECK ("sell_price" >= 0),
  CONSTRAINT "ck_product_variants_min_stock_milli_min" CHECK ("min_stock_milli" >= 0)
);
CREATE UNIQUE INDEX "ux_variants_sku" ON "product_variants" ("business_id", "sku") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "ux_variants_barcode" ON "product_variants" ("business_id", "barcode") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_product_variants_sync" ON "product_variants" ("business_id", "updated_at");
CREATE INDEX "ix_variants_product" ON "product_variants" ("product_id");

CREATE TABLE "suppliers" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "note" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT
);
CREATE INDEX "ix_suppliers_sync" ON "suppliers" ("business_id", "updated_at");

CREATE TABLE "customers" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "note" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT
);
CREATE INDEX "ix_customers_sync" ON "customers" ("business_id", "updated_at");

CREATE TABLE "wallets" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'cash',
  "opening_balance" INTEGER NOT NULL DEFAULT 0,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_wallets_type" CHECK ("type" IN ('cash', 'bank', 'ewallet', 'other'))
);
CREATE UNIQUE INDEX "ux_wallets_name" ON "wallets" ("business_id", "name") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_wallets_sync" ON "wallets" ("business_id", "updated_at");

CREATE TABLE "finance_categories" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "icon" TEXT,
  "is_system" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_finance_categories_type" CHECK ("type" IN ('income', 'expense')),
  CONSTRAINT "ck_finance_categories_is_system_bool" CHECK ("is_system" IN (0, 1))
);
CREATE UNIQUE INDEX "ux_fin_categories_name" ON "finance_categories" ("business_id", "type", "name") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_finance_categories_sync" ON "finance_categories" ("business_id", "updated_at");

CREATE TABLE "sales" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "number" TEXT NOT NULL,
  "customer_id" TEXT REFERENCES "customers"("id") ON DELETE SET NULL,
  "wallet_id" TEXT REFERENCES "wallets"("id") ON DELETE SET NULL,
  "sold_at" TEXT NOT NULL,
  "subtotal" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "tax" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "paid" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'paid',
  "note" TEXT,
  "created_by" TEXT REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_sales_subtotal_min" CHECK ("subtotal" >= 0),
  CONSTRAINT "ck_sales_discount_min" CHECK ("discount" >= 0),
  CONSTRAINT "ck_sales_tax_min" CHECK ("tax" >= 0),
  CONSTRAINT "ck_sales_total_min" CHECK ("total" >= 0),
  CONSTRAINT "ck_sales_paid_min" CHECK ("paid" >= 0),
  CONSTRAINT "ck_sales_status" CHECK ("status" IN ('paid', 'partial', 'unpaid', 'void'))
);
CREATE UNIQUE INDEX "ux_sales_number" ON "sales" ("business_id", "number") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_sales_sync" ON "sales" ("business_id", "updated_at");
CREATE INDEX "ix_sales_date" ON "sales" ("business_id", "sold_at");

CREATE TABLE "sale_items" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "sale_id" TEXT NOT NULL REFERENCES "sales"("id") ON DELETE CASCADE,
  "variant_id" TEXT NOT NULL REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "name_snapshot" TEXT NOT NULL,
  "qty_milli" INTEGER NOT NULL,
  "unit_price" INTEGER NOT NULL,
  "cost_price" INTEGER NOT NULL DEFAULT 0,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "line_total" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_sale_items_qty_milli_min" CHECK ("qty_milli" >= 1),
  CONSTRAINT "ck_sale_items_unit_price_min" CHECK ("unit_price" >= 0),
  CONSTRAINT "ck_sale_items_cost_price_min" CHECK ("cost_price" >= 0),
  CONSTRAINT "ck_sale_items_discount_min" CHECK ("discount" >= 0),
  CONSTRAINT "ck_sale_items_line_total_min" CHECK ("line_total" >= 0)
);
CREATE INDEX "ix_sale_items_sync" ON "sale_items" ("business_id", "updated_at");
CREATE INDEX "ix_sale_items_sale" ON "sale_items" ("sale_id");
CREATE INDEX "ix_sale_items_variant" ON "sale_items" ("variant_id");

CREATE TABLE "purchases" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "number" TEXT NOT NULL,
  "supplier_id" TEXT REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "wallet_id" TEXT REFERENCES "wallets"("id") ON DELETE SET NULL,
  "purchased_at" TEXT NOT NULL,
  "subtotal" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "paid" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'paid',
  "note" TEXT,
  "created_by" TEXT REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_purchases_subtotal_min" CHECK ("subtotal" >= 0),
  CONSTRAINT "ck_purchases_discount_min" CHECK ("discount" >= 0),
  CONSTRAINT "ck_purchases_total_min" CHECK ("total" >= 0),
  CONSTRAINT "ck_purchases_paid_min" CHECK ("paid" >= 0),
  CONSTRAINT "ck_purchases_status" CHECK ("status" IN ('paid', 'partial', 'unpaid', 'void'))
);
CREATE UNIQUE INDEX "ux_purchases_number" ON "purchases" ("business_id", "number") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_purchases_sync" ON "purchases" ("business_id", "updated_at");
CREATE INDEX "ix_purchases_date" ON "purchases" ("business_id", "purchased_at");

CREATE TABLE "purchase_items" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "purchase_id" TEXT NOT NULL REFERENCES "purchases"("id") ON DELETE CASCADE,
  "variant_id" TEXT NOT NULL REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "name_snapshot" TEXT NOT NULL,
  "qty_milli" INTEGER NOT NULL,
  "unit_cost" INTEGER NOT NULL,
  "line_total" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_purchase_items_qty_milli_min" CHECK ("qty_milli" >= 1),
  CONSTRAINT "ck_purchase_items_unit_cost_min" CHECK ("unit_cost" >= 0),
  CONSTRAINT "ck_purchase_items_line_total_min" CHECK ("line_total" >= 0)
);
CREATE INDEX "ix_purchase_items_sync" ON "purchase_items" ("business_id", "updated_at");
CREATE INDEX "ix_purchase_items_purchase" ON "purchase_items" ("purchase_id");

CREATE TABLE "stock_movements" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "variant_id" TEXT NOT NULL REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL,
  "qty_delta_milli" INTEGER NOT NULL,
  "unit_cost" INTEGER,
  "ref_table" TEXT,
  "ref_id" TEXT,
  "occurred_at" TEXT NOT NULL,
  "note" TEXT,
  "created_by" TEXT REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_stock_movements_type" CHECK ("type" IN ('initial', 'purchase', 'sale', 'return_in', 'return_out', 'adjustment', 'opname', 'damage')),
  CONSTRAINT "ck_stock_movements_unit_cost_min" CHECK ("unit_cost" >= 0)
);
CREATE INDEX "ix_stock_movements_sync" ON "stock_movements" ("business_id", "updated_at");
CREATE INDEX "ix_stock_variant_time" ON "stock_movements" ("variant_id", "occurred_at");
CREATE INDEX "ix_stock_ref" ON "stock_movements" ("ref_table", "ref_id");

CREATE TABLE "transactions" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "wallet_id" TEXT NOT NULL REFERENCES "wallets"("id") ON DELETE RESTRICT,
  "category_id" TEXT NOT NULL REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "occurred_on" TEXT NOT NULL,
  "description" TEXT,
  "ref_table" TEXT,
  "ref_id" TEXT,
  "receipt_attachment_id" TEXT REFERENCES "attachments"("id") ON DELETE SET NULL,
  "created_by" TEXT REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_transactions_type" CHECK ("type" IN ('income', 'expense')),
  CONSTRAINT "ck_transactions_amount_min" CHECK ("amount" >= 1)
);
CREATE INDEX "ix_transactions_sync" ON "transactions" ("business_id", "updated_at");
CREATE INDEX "ix_tx_date" ON "transactions" ("business_id", "occurred_on");
CREATE INDEX "ix_tx_wallet" ON "transactions" ("wallet_id");
CREATE INDEX "ix_tx_ref" ON "transactions" ("ref_table", "ref_id");

CREATE TABLE "budgets" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "category_id" TEXT NOT NULL REFERENCES "finance_categories"("id") ON DELETE CASCADE,
  "amount_limit" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_budgets_amount_limit_min" CHECK ("amount_limit" >= 1),
  CONSTRAINT "ck_budgets_month_min" CHECK ("month" >= 1),
  CONSTRAINT "ck_budgets_month_max" CHECK ("month" <= 12),
  CONSTRAINT "ck_budgets_year_min" CHECK ("year" >= 2000),
  CONSTRAINT "ck_budgets_year_max" CHECK ("year" <= 2200)
);
CREATE UNIQUE INDEX "ux_budgets_period" ON "budgets" ("business_id", "category_id", "month", "year") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_budgets_sync" ON "budgets" ("business_id", "updated_at");

CREATE TABLE "saving_goals" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "target_amount" INTEGER NOT NULL,
  "current_amount" INTEGER NOT NULL DEFAULT 0,
  "target_date" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_saving_goals_target_amount_min" CHECK ("target_amount" >= 1),
  CONSTRAINT "ck_saving_goals_current_amount_min" CHECK ("current_amount" >= 0)
);
CREATE INDEX "ix_saving_goals_sync" ON "saving_goals" ("business_id", "updated_at");

CREATE TABLE "recurring_bills" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "wallet_id" TEXT NOT NULL REFERENCES "wallets"("id") ON DELETE RESTRICT,
  "category_id" TEXT NOT NULL REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "description" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'monthly',
  "next_due_date" TEXT NOT NULL,
  "is_active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_recurring_bills_type" CHECK ("type" IN ('income', 'expense')),
  CONSTRAINT "ck_recurring_bills_amount_min" CHECK ("amount" >= 1),
  CONSTRAINT "ck_recurring_bills_frequency" CHECK ("frequency" IN ('weekly', 'monthly', 'yearly')),
  CONSTRAINT "ck_recurring_bills_is_active_bool" CHECK ("is_active" IN (0, 1))
);
CREATE INDEX "ix_recurring_bills_sync" ON "recurring_bills" ("business_id", "updated_at");
CREATE INDEX "ix_bills_due" ON "recurring_bills" ("business_id", "next_due_date");

CREATE TABLE "debts" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "party_name" TEXT NOT NULL,
  "customer_id" TEXT REFERENCES "customers"("id") ON DELETE SET NULL,
  "supplier_id" TEXT REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "amount" INTEGER NOT NULL,
  "paid_amount" INTEGER NOT NULL DEFAULT 0,
  "due_date" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "ref_table" TEXT,
  "ref_id" TEXT,
  "note" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_debts_kind" CHECK ("kind" IN ('receivable', 'payable')),
  CONSTRAINT "ck_debts_amount_min" CHECK ("amount" >= 1),
  CONSTRAINT "ck_debts_paid_amount_min" CHECK ("paid_amount" >= 0),
  CONSTRAINT "ck_debts_status" CHECK ("status" IN ('open', 'partial', 'settled'))
);
CREATE INDEX "ix_debts_sync" ON "debts" ("business_id", "updated_at");
CREATE INDEX "ix_debts_status" ON "debts" ("business_id", "status");

CREATE TABLE "debt_payments" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "debt_id" TEXT NOT NULL REFERENCES "debts"("id") ON DELETE CASCADE,
  "wallet_id" TEXT REFERENCES "wallets"("id") ON DELETE SET NULL,
  "amount" INTEGER NOT NULL,
  "paid_on" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_debt_payments_amount_min" CHECK ("amount" >= 1)
);
CREATE INDEX "ix_debt_payments_sync" ON "debt_payments" ("business_id", "updated_at");
CREATE INDEX "ix_debt_payments_debt" ON "debt_payments" ("debt_id");

CREATE TABLE "assets" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'equipment',
  "purchase_date" TEXT,
  "purchase_price" INTEGER NOT NULL DEFAULT 0,
  "useful_life_months" INTEGER,
  "salvage_value" INTEGER NOT NULL DEFAULT 0,
  "condition" TEXT NOT NULL DEFAULT 'baik',
  "status" TEXT NOT NULL DEFAULT 'tersedia',
  "location" TEXT,
  "plate_number" TEXT,
  "note" TEXT,
  "photo_attachment_id" TEXT REFERENCES "attachments"("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_assets_kind" CHECK ("kind" IN ('vehicle', 'building', 'furniture', 'equipment', 'other')),
  CONSTRAINT "ck_assets_purchase_price_min" CHECK ("purchase_price" >= 0),
  CONSTRAINT "ck_assets_useful_life_months_min" CHECK ("useful_life_months" >= 1),
  CONSTRAINT "ck_assets_salvage_value_min" CHECK ("salvage_value" >= 0),
  CONSTRAINT "ck_assets_condition" CHECK ("condition" IN ('baik', 'perlu_perawatan', 'rusak')),
  CONSTRAINT "ck_assets_status" CHECK ("status" IN ('tersedia', 'dipinjam', 'maintenance', 'rusak'))
);
CREATE UNIQUE INDEX "ux_assets_code" ON "assets" ("business_id", "code") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_assets_sync" ON "assets" ("business_id", "updated_at");

CREATE TABLE "asset_loans" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "asset_id" TEXT NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "borrower_name" TEXT NOT NULL,
  "borrower_phone" TEXT,
  "purpose" TEXT,
  "loaned_at" TEXT NOT NULL,
  "due_at" TEXT,
  "returned_at" TEXT,
  "status" TEXT NOT NULL DEFAULT 'dipinjam',
  "note" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_asset_loans_status" CHECK ("status" IN ('dipinjam', 'kembali'))
);
CREATE INDEX "ix_asset_loans_sync" ON "asset_loans" ("business_id", "updated_at");
CREATE INDEX "ix_loans_asset" ON "asset_loans" ("asset_id");

CREATE TABLE "asset_maintenance" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "asset_id" TEXT NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "scheduled_on" TEXT NOT NULL,
  "done_on" TEXT,
  "cost" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'terjadwal',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  CONSTRAINT "ck_asset_maintenance_cost_min" CHECK ("cost" >= 0),
  CONSTRAINT "ck_asset_maintenance_status" CHECK ("status" IN ('terjadwal', 'selesai', 'batal'))
);
CREATE INDEX "ix_asset_maintenance_sync" ON "asset_maintenance" ("business_id", "updated_at");
CREATE INDEX "ix_maint_asset" ON "asset_maintenance" ("asset_id");
CREATE INDEX "ix_maint_due" ON "asset_maintenance" ("business_id", "scheduled_on");

CREATE TABLE "audit_log" (
  "id" TEXT PRIMARY KEY,
  "business_id" TEXT NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "member_id" TEXT REFERENCES "members"("id") ON DELETE SET NULL,
  "action" TEXT NOT NULL,
  "table_name" TEXT NOT NULL,
  "record_id" TEXT,
  "detail" TEXT,
  "occurred_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT
);
CREATE INDEX "ix_audit_log_sync" ON "audit_log" ("business_id", "updated_at");
CREATE INDEX "ix_audit_time" ON "audit_log" ("business_id", "occurred_at");

PRAGMA user_version = 1;
