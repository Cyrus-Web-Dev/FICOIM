import { uuidv7, type Row } from '@ficoim/shared';
import { insertRow, type Db } from '../db';
import type { Ctx } from '../ctx';
import { stdRow } from '../ctx';
import { requireInt, requireText, optText, oneOf } from '../util';
import { BUSINESS_TYPES } from '@ficoim/shared';
import { DEFAULT_FINANCE_CATEGORIES, PRESETS, type BusinessType } from '../presets';
import { audit } from './audit';

export interface CreateBusinessInput {
  name: string;
  businessType: BusinessType;
  ownerName: string;
  address?: string | null;
  phone?: string | null;
  /** Kas awal toko (Rupiah). */
  openingCash?: number;
  tzOffsetMinutes?: number;
}

export interface CreatedBusiness { businessId: string; ownerMemberId: string; defaultWalletId: string }

/** Onboarding: membuat bisnis + pemilik + dompet kas + kategori bawaan sesuai jenis usaha. */
export async function createBusiness(
  db: Db, input: CreateBusinessInput, opts: { now?: () => Date; newId?: () => string; businessId?: string } = {},
): Promise<CreatedBusiness> {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => uuidv7(now().getTime()));
  const name = requireText(input.name, 'Nama bisnis', 120);
  const type = oneOf(input.businessType, BUSINESS_TYPES, 'Jenis usaha');
  const ownerName = requireText(input.ownerName, 'Nama pemilik', 120);
  const openingCash = input.openingCash === undefined ? 0 : requireInt(input.openingCash, 'Kas awal', 0);
  const tz = input.tzOffsetMinutes ?? 420;
  const t = now().toISOString();

  return db.transaction(async (tx) => {
    const businessId = opts.businessId ?? newId();
    const biz: Row = {
      id: businessId, name, business_type: type, address: optText(input.address, 'Alamat'), phone: optText(input.phone, 'Telepon', 40),
      currency: 'IDR', tax_bp: 0, receipt_footer: 'Terima kasih 🙏',
      settings: { allowNegativeStock: false, tzOffsetMinutes: tz, trackExpiryDefault: PRESETS[type].trackExpiry },
      created_at: t, updated_at: t, deleted_at: null,
    };
    await insertRow(tx, 'businesses', biz);

    const ctx: Ctx = {
      db: tx, businessId, now, newId, tzOffsetMinutes: tz, allowNegativeStock: false, taxBp: 0,
      actor: { memberId: null, role: 'owner', canViewReports: true, canDelete: true },
    };
    const owner = stdRow(ctx, { display_name: ownerName, role: 'owner', user_id: null, can_view_reports: true, can_delete: true, is_active: true });
    await insertRow(tx, 'members', owner);
    ctx.actor.memberId = owner.id as string;

    const wallet = stdRow(ctx, { name: 'Kas Toko', type: 'cash', opening_balance: openingCash, balance: openingCash });
    await insertRow(tx, 'wallets', wallet);

    for (const c of DEFAULT_FINANCE_CATEGORIES)
      await insertRow(tx, 'finance_categories', stdRow(ctx, { name: c.name, type: c.type, icon: c.icon, is_system: c.system }));
    for (const c of PRESETS[type].productCategories)
      await insertRow(tx, 'product_categories', stdRow(ctx, { name: c.name, icon: c.icon }));

    await audit(ctx, 'create', 'businesses', businessId, { name, type });
    return { businessId, ownerMemberId: owner.id as string, defaultWalletId: wallet.id as string };
  });
}
