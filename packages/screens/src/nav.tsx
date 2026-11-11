import type { IconName } from './ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type RouteName =
  | 'dashboard' | 'pos' | 'products' | 'productForm' | 'productDetail'
  | 'labels' | 'stockCount' | 'import' | 'parties' | 'notifications' | 'sales' | 'saleDetail' | 'purchases' | 'purchaseForm' | 'finance' | 'assets' | 'reports' | 'more' | 'settings' | 'backup' | 'team' | 'account';

export interface Route { name: RouteName; params?: Record<string, unknown> }
export const TABS: { name: RouteName; label: string; icon: IconName }[] = [
  { name: 'dashboard', label: 'Beranda', icon: 'home' }, { name: 'pos', label: 'Kasir', icon: 'receipt' }, { name: 'products', label: 'Produk', icon: 'package' },
  { name: 'finance', label: 'Keuangan', icon: 'wallet' }, { name: 'more', label: 'Lainnya', icon: 'more' },
];

interface NavValue { route: Route; root: RouteName; depth: number; push(name: RouteName, params?: Record<string, unknown>): void; back(): void; goTab(name: RouteName): void }
const Ctx = createContext<NavValue | null>(null);

/** Navigasi tumpukan sederhana (tanpa pustaka): tab mengganti akar, push menumpuk, back membuang. */
export function NavProvider({ initial = 'dashboard', children }: { initial?: RouteName; children?: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: initial }]);
  const push = useCallback((name: RouteName, params?: Record<string, unknown>) => setStack((s) => [...s, { name, params }]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const goTab = useCallback((name: RouteName) => setStack([{ name }]), []);
  const value = useMemo<NavValue>(() => ({ route: stack[stack.length - 1] as Route, root: (stack[0] as Route).name, depth: stack.length, push, back, goTab }), [stack, push, back, goTab]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav(): NavValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNav dipakai di luar <NavProvider>.');
  return v;
}
