-- GENERATED FILE — JANGAN DIEDIT TANGAN.
-- Sumber: packages/shared/src/schema/tables.ts   |   Regenerasi: npm run gen:sql
-- Dialek: postgres   |   Versi skema data: 1

-- Uang = BIGINT Rupiah; qty = BIGINT milli (1000 = 1 satuan); waktu = timestamptz (UTC).
-- Isolasi antar-bisnis (multi-tenant) dipaksa oleh Row-Level Security: tiap transaksi wajib
--   SET LOCAL app.business_id = '<uuid bisnis>';  Role aplikasi TIDAK boleh superuser / BYPASSRLS.

CREATE TABLE "businesses" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "business_type" text NOT NULL DEFAULT 'lainnya',
  "address" text,
  "phone" text,
  "currency" text NOT NULL DEFAULT 'IDR',
  "tax_bp" integer NOT NULL DEFAULT 0,
  "receipt_footer" text,
  "settings" jsonb,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_businesses_business_type" CHECK ("business_type" IN ('elektronik', 'non_elektronik', 'perabotan', 'fashion', 'makanan_minuman', 'lainnya')),
  CONSTRAINT "ck_businesses_tax_bp_min" CHECK ("tax_bp" >= 0),
  CONSTRAINT "ck_businesses_tax_bp_max" CHECK ("tax_bp" <= 10000)
);

CREATE TABLE "members" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "display_name" text NOT NULL,
  "role" text NOT NULL DEFAULT 'staff',
  "user_id" uuid,
  "can_view_reports" boolean NOT NULL DEFAULT false,
  "can_delete" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_members_role" CHECK ("role" IN ('owner', 'manager', 'staff'))
);
CREATE INDEX "ix_members_sync" ON "members" ("business_id", "updated_at");

CREATE TABLE "attachments" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "owner_table" text,
  "owner_id" uuid,
  "file_name" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "storage_key" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_attachments_size_bytes_min" CHECK ("size_bytes" >= 0)
);
CREATE INDEX "ix_attachments_sync" ON "attachments" ("business_id", "updated_at");
CREATE INDEX "ix_attachments_owner" ON "attachments" ("owner_table", "owner_id");

CREATE TABLE "product_categories" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "icon" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
CREATE UNIQUE INDEX "ux_product_categories_name" ON "product_categories" ("business_id", "name") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_product_categories_sync" ON "product_categories" ("business_id", "updated_at");

CREATE TABLE "products" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "category_id" uuid REFERENCES "product_categories"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "brand" text,
  "description" text,
  "unit" text NOT NULL DEFAULT 'pcs',
  "track_stock" boolean NOT NULL DEFAULT true,
  "track_expiry" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "photo_attachment_id" uuid REFERENCES "attachments"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
CREATE INDEX "ix_products_sync" ON "products" ("business_id", "updated_at");
CREATE INDEX "ix_products_name" ON "products" ("business_id", "name");
CREATE INDEX "ix_products_category" ON "products" ("category_id");

CREATE TABLE "product_variants" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "name" text NOT NULL DEFAULT 'Default',
  "sku" text,
  "barcode" text,
  "cost_price" bigint NOT NULL DEFAULT 0,
  "sell_price" bigint NOT NULL DEFAULT 0,
  "stock_qty_milli" bigint NOT NULL DEFAULT 0,
  "min_stock_milli" bigint NOT NULL DEFAULT 0,
  "expiry_date" date,
  "attributes" jsonb,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_product_variants_cost_price_min" CHECK ("cost_price" >= 0),
  CONSTRAINT "ck_product_variants_sell_price_min" CHECK ("sell_price" >= 0),
  CONSTRAINT "ck_product_variants_min_stock_milli_min" CHECK ("min_stock_milli" >= 0)
);
CREATE UNIQUE INDEX "ux_variants_sku" ON "product_variants" ("business_id", "sku") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "ux_variants_barcode" ON "product_variants" ("business_id", "barcode") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_product_variants_sync" ON "product_variants" ("business_id", "updated_at");
CREATE INDEX "ix_variants_product" ON "product_variants" ("product_id");

CREATE TABLE "suppliers" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "phone" text,
  "address" text,
  "note" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
CREATE INDEX "ix_suppliers_sync" ON "suppliers" ("business_id", "updated_at");

CREATE TABLE "customers" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "phone" text,
  "address" text,
  "note" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
CREATE INDEX "ix_customers_sync" ON "customers" ("business_id", "updated_at");

CREATE TABLE "wallets" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL DEFAULT 'cash',
  "opening_balance" bigint NOT NULL DEFAULT 0,
  "balance" bigint NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_wallets_type" CHECK ("type" IN ('cash', 'bank', 'ewallet', 'other'))
);
CREATE UNIQUE INDEX "ux_wallets_name" ON "wallets" ("business_id", "name") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_wallets_sync" ON "wallets" ("business_id", "updated_at");

CREATE TABLE "finance_categories" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "icon" text,
  "is_system" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_finance_categories_type" CHECK ("type" IN ('income', 'expense'))
);
CREATE UNIQUE INDEX "ux_fin_categories_name" ON "finance_categories" ("business_id", "type", "name") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_finance_categories_sync" ON "finance_categories" ("business_id", "updated_at");

CREATE TABLE "sales" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "wallet_id" uuid REFERENCES "wallets"("id") ON DELETE SET NULL,
  "sold_at" timestamptz NOT NULL,
  "subtotal" bigint NOT NULL,
  "discount" bigint NOT NULL DEFAULT 0,
  "tax" bigint NOT NULL DEFAULT 0,
  "total" bigint NOT NULL,
  "paid" bigint NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'paid',
  "note" text,
  "created_by" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
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
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "sale_id" uuid NOT NULL REFERENCES "sales"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "name_snapshot" text NOT NULL,
  "qty_milli" bigint NOT NULL,
  "unit_price" bigint NOT NULL,
  "cost_price" bigint NOT NULL DEFAULT 0,
  "discount" bigint NOT NULL DEFAULT 0,
  "line_total" bigint NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
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
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "number" text NOT NULL,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "wallet_id" uuid REFERENCES "wallets"("id") ON DELETE SET NULL,
  "purchased_at" timestamptz NOT NULL,
  "subtotal" bigint NOT NULL,
  "discount" bigint NOT NULL DEFAULT 0,
  "total" bigint NOT NULL,
  "paid" bigint NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'paid',
  "note" text,
  "created_by" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
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
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "purchase_id" uuid NOT NULL REFERENCES "purchases"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "name_snapshot" text NOT NULL,
  "qty_milli" bigint NOT NULL,
  "unit_cost" bigint NOT NULL,
  "line_total" bigint NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_purchase_items_qty_milli_min" CHECK ("qty_milli" >= 1),
  CONSTRAINT "ck_purchase_items_unit_cost_min" CHECK ("unit_cost" >= 0),
  CONSTRAINT "ck_purchase_items_line_total_min" CHECK ("line_total" >= 0)
);
CREATE INDEX "ix_purchase_items_sync" ON "purchase_items" ("business_id", "updated_at");
CREATE INDEX "ix_purchase_items_purchase" ON "purchase_items" ("purchase_id");

CREATE TABLE "stock_movements" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  "type" text NOT NULL,
  "qty_delta_milli" bigint NOT NULL,
  "unit_cost" bigint,
  "ref_table" text,
  "ref_id" uuid,
  "occurred_at" timestamptz NOT NULL,
  "note" text,
  "created_by" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_stock_movements_type" CHECK ("type" IN ('initial', 'purchase', 'sale', 'return_in', 'return_out', 'adjustment', 'opname', 'damage')),
  CONSTRAINT "ck_stock_movements_unit_cost_min" CHECK ("unit_cost" >= 0)
);
CREATE INDEX "ix_stock_movements_sync" ON "stock_movements" ("business_id", "updated_at");
CREATE INDEX "ix_stock_variant_time" ON "stock_movements" ("variant_id", "occurred_at");
CREATE INDEX "ix_stock_ref" ON "stock_movements" ("ref_table", "ref_id");

CREATE TABLE "transactions" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "wallet_id" uuid NOT NULL REFERENCES "wallets"("id") ON DELETE RESTRICT,
  "category_id" uuid NOT NULL REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
  "type" text NOT NULL,
  "amount" bigint NOT NULL,
  "occurred_on" date NOT NULL,
  "description" text,
  "ref_table" text,
  "ref_id" uuid,
  "receipt_attachment_id" uuid REFERENCES "attachments"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_transactions_type" CHECK ("type" IN ('income', 'expense')),
  CONSTRAINT "ck_transactions_amount_min" CHECK ("amount" >= 1)
);
CREATE INDEX "ix_transactions_sync" ON "transactions" ("business_id", "updated_at");
CREATE INDEX "ix_tx_date" ON "transactions" ("business_id", "occurred_on");
CREATE INDEX "ix_tx_wallet" ON "transactions" ("wallet_id");
CREATE INDEX "ix_tx_ref" ON "transactions" ("ref_table", "ref_id");

CREATE TABLE "budgets" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "finance_categories"("id") ON DELETE CASCADE,
  "amount_limit" bigint NOT NULL,
  "month" integer NOT NULL,
  "year" integer NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_budgets_amount_limit_min" CHECK ("amount_limit" >= 1),
  CONSTRAINT "ck_budgets_month_min" CHECK ("month" >= 1),
  CONSTRAINT "ck_budgets_month_max" CHECK ("month" <= 12),
  CONSTRAINT "ck_budgets_year_min" CHECK ("year" >= 2000),
  CONSTRAINT "ck_budgets_year_max" CHECK ("year" <= 2200)
);
CREATE UNIQUE INDEX "ux_budgets_period" ON "budgets" ("business_id", "category_id", "month", "year") WHERE "deleted_at" IS NULL;
CREATE INDEX "ix_budgets_sync" ON "budgets" ("business_id", "updated_at");

CREATE TABLE "saving_goals" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "target_amount" bigint NOT NULL,
  "current_amount" bigint NOT NULL DEFAULT 0,
  "target_date" date,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_saving_goals_target_amount_min" CHECK ("target_amount" >= 1),
  CONSTRAINT "ck_saving_goals_current_amount_min" CHECK ("current_amount" >= 0)
);
CREATE INDEX "ix_saving_goals_sync" ON "saving_goals" ("business_id", "updated_at");

CREATE TABLE "recurring_bills" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "wallet_id" uuid NOT NULL REFERENCES "wallets"("id") ON DELETE RESTRICT,
  "category_id" uuid NOT NULL REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
  "type" text NOT NULL,
  "amount" bigint NOT NULL,
  "description" text,
  "frequency" text NOT NULL DEFAULT 'monthly',
  "next_due_date" date NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_recurring_bills_type" CHECK ("type" IN ('income', 'expense')),
  CONSTRAINT "ck_recurring_bills_amount_min" CHECK ("amount" >= 1),
  CONSTRAINT "ck_recurring_bills_frequency" CHECK ("frequency" IN ('weekly', 'monthly', 'yearly'))
);
CREATE INDEX "ix_recurring_bills_sync" ON "recurring_bills" ("business_id", "updated_at");
CREATE INDEX "ix_bills_due" ON "recurring_bills" ("business_id", "next_due_date");

CREATE TABLE "debts" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "party_name" text NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "amount" bigint NOT NULL,
  "paid_amount" bigint NOT NULL DEFAULT 0,
  "due_date" date,
  "status" text NOT NULL DEFAULT 'open',
  "ref_table" text,
  "ref_id" uuid,
  "note" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_debts_kind" CHECK ("kind" IN ('receivable', 'payable')),
  CONSTRAINT "ck_debts_amount_min" CHECK ("amount" >= 1),
  CONSTRAINT "ck_debts_paid_amount_min" CHECK ("paid_amount" >= 0),
  CONSTRAINT "ck_debts_status" CHECK ("status" IN ('open', 'partial', 'settled'))
);
CREATE INDEX "ix_debts_sync" ON "debts" ("business_id", "updated_at");
CREATE INDEX "ix_debts_status" ON "debts" ("business_id", "status");

CREATE TABLE "debt_payments" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "debt_id" uuid NOT NULL REFERENCES "debts"("id") ON DELETE CASCADE,
  "wallet_id" uuid REFERENCES "wallets"("id") ON DELETE SET NULL,
  "amount" bigint NOT NULL,
  "paid_on" date NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_debt_payments_amount_min" CHECK ("amount" >= 1)
);
CREATE INDEX "ix_debt_payments_sync" ON "debt_payments" ("business_id", "updated_at");
CREATE INDEX "ix_debt_payments_debt" ON "debt_payments" ("debt_id");

CREATE TABLE "assets" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "code" text,
  "name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'equipment',
  "purchase_date" date,
  "purchase_price" bigint NOT NULL DEFAULT 0,
  "useful_life_months" integer,
  "salvage_value" bigint NOT NULL DEFAULT 0,
  "condition" text NOT NULL DEFAULT 'baik',
  "status" text NOT NULL DEFAULT 'tersedia',
  "location" text,
  "plate_number" text,
  "note" text,
  "photo_attachment_id" uuid REFERENCES "attachments"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
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
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "borrower_name" text NOT NULL,
  "borrower_phone" text,
  "purpose" text,
  "loaned_at" timestamptz NOT NULL,
  "due_at" timestamptz,
  "returned_at" timestamptz,
  "status" text NOT NULL DEFAULT 'dipinjam',
  "note" text,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_asset_loans_status" CHECK ("status" IN ('dipinjam', 'kembali'))
);
CREATE INDEX "ix_asset_loans_sync" ON "asset_loans" ("business_id", "updated_at");
CREATE INDEX "ix_loans_asset" ON "asset_loans" ("asset_id");

CREATE TABLE "asset_maintenance" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE RESTRICT,
  "scheduled_on" date NOT NULL,
  "done_on" date,
  "cost" bigint NOT NULL DEFAULT 0,
  "description" text,
  "status" text NOT NULL DEFAULT 'terjadwal',
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "ck_asset_maintenance_cost_min" CHECK ("cost" >= 0),
  CONSTRAINT "ck_asset_maintenance_status" CHECK ("status" IN ('terjadwal', 'selesai', 'batal'))
);
CREATE INDEX "ix_asset_maintenance_sync" ON "asset_maintenance" ("business_id", "updated_at");
CREATE INDEX "ix_maint_asset" ON "asset_maintenance" ("asset_id");
CREATE INDEX "ix_maint_due" ON "asset_maintenance" ("business_id", "scheduled_on");

CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "member_id" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "table_name" text NOT NULL,
  "record_id" uuid,
  "detail" jsonb,
  "occurred_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
CREATE INDEX "ix_audit_log_sync" ON "audit_log" ("business_id", "updated_at");
CREATE INDEX "ix_audit_time" ON "audit_log" ("business_id", "occurred_at");

-- ===== Row-Level Security =====
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "businesses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "businesses" USING ("id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "members" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attachments" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "product_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "product_categories" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "products" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "product_variants" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "suppliers" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "customers" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "wallets" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "finance_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "finance_categories" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sales" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "sale_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sale_items" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "purchases" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "purchase_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "purchase_items" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "stock_movements" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "transactions" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "budgets" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "saving_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saving_goals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "saving_goals" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "recurring_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_bills" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "recurring_bills" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "debts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "debts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "debts" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "debt_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "debt_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "debt_payments" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "assets" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "asset_loans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_loans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "asset_loans" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "asset_maintenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_maintenance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "asset_maintenance" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_log" USING ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("business_id" = NULLIF(current_setting('app.business_id', true), '')::uuid);
