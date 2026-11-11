import { BUSINESS_TYPES } from '@ficoim/shared';

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface Preset {
  label: string;
  productCategories: { name: string; icon: string }[];
  units: string[];
  trackExpiry: boolean;
  variantHint: string;
}

export const PRESETS: Record<BusinessType, Preset> = {
  elektronik: {
    label: 'Elektronik',
    productCategories: [
      { name: 'Handphone & Tablet', icon: '📱' }, { name: 'Laptop & Komputer', icon: '💻' },
      { name: 'Aksesoris', icon: '🎧' }, { name: 'Peralatan Elektronik Rumah', icon: '📺' }, { name: 'Sparepart', icon: '🔧' },
    ],
    units: ['unit', 'pcs', 'set'], trackExpiry: false, variantHint: 'Kapasitas / Warna',
  },
  non_elektronik: {
    label: 'Non-elektronik',
    productCategories: [
      { name: 'Alat Tulis', icon: '✏️' }, { name: 'Kebutuhan Rumah', icon: '🏠' }, { name: 'Mainan', icon: '🧸' }, { name: 'Otomotif', icon: '🛞' },
    ],
    units: ['pcs', 'lusin', 'pak', 'set'], trackExpiry: false, variantHint: 'Ukuran / Tipe',
  },
  perabotan: {
    label: 'Perabotan',
    productCategories: [
      { name: 'Meja & Kursi', icon: '🪑' }, { name: 'Lemari & Rak', icon: '🗄️' }, { name: 'Peralatan Dapur', icon: '🍳' }, { name: 'Dekorasi', icon: '🖼️' },
    ],
    units: ['pcs', 'set', 'unit'], trackExpiry: false, variantHint: 'Ukuran / Bahan / Warna',
  },
  fashion: {
    label: 'Fashion',
    productCategories: [
      { name: 'Pakaian Pria', icon: '👔' }, { name: 'Pakaian Wanita', icon: '👗' }, { name: 'Pakaian Anak', icon: '🧒' },
      { name: 'Sepatu & Sandal', icon: '👟' }, { name: 'Tas & Aksesoris', icon: '👜' },
    ],
    units: ['pcs', 'pasang', 'lusin'], trackExpiry: false, variantHint: 'Ukuran / Warna',
  },
  makanan_minuman: {
    label: 'Makanan & Minuman',
    productCategories: [
      { name: 'Makanan', icon: '🍛' }, { name: 'Minuman', icon: '🥤' }, { name: 'Camilan', icon: '🍪' }, { name: 'Bahan Baku', icon: '🧂' },
    ],
    units: ['porsi', 'pcs', 'gelas', 'kg', 'liter', 'bungkus'], trackExpiry: true, variantHint: 'Ukuran / Level',
  },
  lainnya: {
    label: 'Lainnya',
    productCategories: [{ name: 'Umum', icon: '📦' }],
    units: ['pcs', 'unit', 'kg'], trackExpiry: false, variantHint: 'Varian',
  },
};

/** Kategori keuangan bawaan. is_system = dipakai otomatis oleh sistem dan tidak dihitung sebagai biaya operasional. */
export const SYSTEM_CATEGORY = {
  SALES: 'Penjualan',
  RECEIVABLE_PAID: 'Pelunasan Piutang',
  PURCHASE: 'Pembelian Stok',
  PAYABLE_PAID: 'Pembayaran Hutang',
  TRANSFER_IN: 'Transfer Masuk',
  TRANSFER_OUT: 'Transfer Keluar',
} as const;

export const DEFAULT_FINANCE_CATEGORIES: { name: string; type: 'income' | 'expense'; icon: string; system: boolean }[] = [
  { name: SYSTEM_CATEGORY.SALES, type: 'income', icon: '🛒', system: true },
  { name: SYSTEM_CATEGORY.RECEIVABLE_PAID, type: 'income', icon: '💵', system: true },
  { name: SYSTEM_CATEGORY.TRANSFER_IN, type: 'income', icon: '↘️', system: true },
  { name: 'Pemasukan Lain', type: 'income', icon: '➕', system: false },
  { name: SYSTEM_CATEGORY.PURCHASE, type: 'expense', icon: '📦', system: true },
  { name: SYSTEM_CATEGORY.PAYABLE_PAID, type: 'expense', icon: '🧾', system: true },
  { name: SYSTEM_CATEGORY.TRANSFER_OUT, type: 'expense', icon: '↗️', system: true },
  { name: 'Gaji', type: 'expense', icon: '👥', system: false },
  { name: 'Sewa', type: 'expense', icon: '🏪', system: false },
  { name: 'Listrik & Air', type: 'expense', icon: '💡', system: false },
  { name: 'Transportasi', type: 'expense', icon: '🚚', system: false },
  { name: 'Pemasaran', type: 'expense', icon: '📣', system: false },
  { name: 'Perawatan Aset', type: 'expense', icon: '🛠️', system: false },
  { name: 'Lainnya', type: 'expense', icon: '🧩', system: false },
];
