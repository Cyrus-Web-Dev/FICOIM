import { lineTotal, percentBp } from '@ficoim/shared';
import type * as C from '@ficoim/core';

/**
 * Keranjang kasir — logika murni (tanpa UI). Angka di sini hanya PRATINJAU: server/mesin bisnis selalu menghitung ulang
 * total dari harga & qty dengan rumus yang sama (lineTotal, percentBp), dan tes membuktikan keduanya identik.
 */
export interface CartLine {
  variantId: string; name: string; unit: string;
  qtyMilli: number; unitPrice: number; discount: number;
  trackStock: boolean; stockQtyMilli: number;
}
export interface Cart { lines: CartLine[]; discount: number }
export const emptyCart = (): Cart => ({ lines: [], discount: 0 });

export const labelOf = (v: { productName: string; variantName: string }): string => (v.variantName === 'Default' ? v.productName : `${v.productName} ${v.variantName}`);

export function addToCart(cart: Cart, v: C.VariantView, qtyMilli = 1000): Cart {
  const i = cart.lines.findIndex((l) => l.variantId === v.id && l.unitPrice === v.sellPrice && l.discount === 0);
  if (i >= 0) return setQty(cart, i, (cart.lines[i] as CartLine).qtyMilli + qtyMilli);
  return { ...cart, lines: [...cart.lines, { variantId: v.id, name: labelOf(v), unit: v.unit, qtyMilli, unitPrice: v.sellPrice, discount: 0, trackStock: v.trackStock, stockQtyMilli: v.stockQtyMilli }] };
}

/** qty <= 0 menghapus baris. */
export function setQty(cart: Cart, index: number, qtyMilli: number): Cart {
  if (qtyMilli <= 0) return { ...cart, lines: cart.lines.filter((_, i) => i !== index) };
  return { ...cart, lines: cart.lines.map((l, i) => (i === index ? { ...l, qtyMilli } : l)) };
}

export function setLinePrice(cart: Cart, index: number, unitPrice: number): Cart {
  return { ...cart, lines: cart.lines.map((l, i) => (i === index ? { ...l, unitPrice: Math.max(0, unitPrice) } : l)) };
}

export function setLineDiscount(cart: Cart, index: number, discount: number): Cart {
  return { ...cart, lines: cart.lines.map((l, i) => (i === index ? { ...l, discount: Math.max(0, Math.min(discount, lineTotal(l.qtyMilli, l.unitPrice))) } : l)) };
}

export function setOrderDiscount(cart: Cart, discount: number): Cart {
  return { ...cart, discount: Math.max(0, Math.min(discount, subtotalOf(cart))) };
}

export const lineSum = (l: CartLine): number => lineTotal(l.qtyMilli, l.unitPrice) - l.discount;
export const subtotalOf = (cart: Cart): number => cart.lines.reduce((s, l) => s + lineSum(l), 0);

export interface CartTotals { subtotal: number; discount: number; tax: number; total: number; itemCount: number }

export function totals(cart: Cart, taxBp: number): CartTotals {
  const subtotal = subtotalOf(cart);
  const discount = Math.min(cart.discount, subtotal);
  const tax = percentBp(subtotal - discount, taxBp);
  return { subtotal, discount, tax, total: subtotal - discount + tax, itemCount: cart.lines.length };
}

/** Peringatan stok untuk ditampilkan sebelum bayar (penolakan akhir tetap oleh mesin bisnis). */
export function stockWarnings(cart: Cart): string[] {
  const need = new Map<string, { need: number; have: number; name: string }>();
  for (const l of cart.lines) if (l.trackStock) {
    const cur = need.get(l.variantId) ?? { need: 0, have: l.stockQtyMilli, name: l.name };
    cur.need += l.qtyMilli; need.set(l.variantId, cur);
  }
  return [...need.values()].filter((x) => x.need > x.have).map((x) => `${x.name}: stok ${x.have / 1000}, diminta ${x.need / 1000}`);
}

export function toSaleInput(cart: Cart, o: { customerId?: string | null; walletId?: string | null; paid?: number; dueDate?: string | null; note?: string | null }): C.SaleInput {
  return {
    items: cart.lines.map((l) => ({ variantId: l.variantId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, discount: l.discount })),
    discount: totals(cart, 0).discount, customerId: o.customerId ?? null, walletId: o.walletId ?? null, paid: o.paid, dueDate: o.dueDate ?? null, note: o.note ?? null,
  };
}
