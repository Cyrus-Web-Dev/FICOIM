import { useEffect, type ReactNode } from 'react';
import { Box, Icon, Txt } from './ui';
import { TABS, useNav, type RouteName } from './nav';
import { DashboardScreen } from './screens/dashboard';
import { PosScreen } from './screens/pos';
import { LabelsScreen } from './screens/labels';
import { StockCountScreen } from './screens/stock-count';
import { ImportScreen } from './screens/import';
import { PartiesScreen } from './screens/parties';
import { NotificationsScreen } from './screens/notifications';
import { ProductDetailScreen, ProductFormScreen, ProductsScreen } from './screens/products';
import { SaleDetailScreen, SalesScreen } from './screens/sales';
import { PurchaseFormScreen, PurchasesScreen } from './screens/purchases';
import { FinanceScreen } from './screens/finance';
import { AssetsScreen } from './screens/assets';
import { ReportsScreen } from './screens/reports';
import { AccountScreen, BackupScreen, MoreScreen, SettingsScreen, TeamScreen } from './screens/settings';

const SCREENS: Record<RouteName, () => ReactNode> = {
  dashboard: DashboardScreen, pos: PosScreen, products: ProductsScreen, productForm: ProductFormScreen, productDetail: ProductDetailScreen, labels: LabelsScreen, stockCount: StockCountScreen, import: ImportScreen, parties: PartiesScreen, notifications: NotificationsScreen,
  sales: SalesScreen, saleDetail: SaleDetailScreen, purchases: PurchasesScreen, purchaseForm: PurchaseFormScreen, finance: FinanceScreen,
  assets: AssetsScreen, reports: ReportsScreen, more: MoreScreen, settings: SettingsScreen, backup: BackupScreen, team: TeamScreen, account: AccountScreen,
};

/** Jembatan tombol "kembali" perangkat (Android): shell mendaftarkan penangan; true = sudah ditangani. */
export interface BackBridge { set(handler: () => boolean): void }

export function Shell({ backBridge }: { backBridge?: BackBridge }) {
  const nav = useNav();
  useEffect(() => { backBridge?.set(() => { if (nav.depth > 1) { nav.back(); return true; } return false; }); }, [nav.depth, nav.back]);
  const Active = SCREENS[nav.route.name];
  return (
    <Box className="flex-1 bg-slate-50">
      <Box className="flex-1"><Active key={`${nav.depth}:${nav.route.name}`} /></Box>
      <Box kind="tabbar" testID="tabbar" className="flex-row border-t border-slate-200 bg-white">
        {TABS.map((t) => {
          const on = nav.root === t.name;
          return (
            <Box key={t.name} kind={on ? 'tab-on' : 'tab'} testID={`tab-${t.name}`} onPress={() => nav.goTab(t.name)} className="flex-1 items-center gap-0.5 py-2">
              <Box kind={on ? 'bar-on' : 'bar'} className="items-center rounded-full px-4 py-1"><Icon name={t.icon} size={22} className={on ? 'text-indigo-700' : 'text-slate-500'} /></Box>
              <Txt className={`text-[11px] ${on ? 'font-bold text-indigo-700' : 'text-slate-500'}`}>{t.label}</Txt>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
