import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { emptyCart, type Cart } from '@ficoim/client';

interface CartValue { cart: Cart; setCart: (c: Cart | ((p: Cart) => Cart)) => void; clear: () => void }
const Ctx = createContext<CartValue | null>(null);

/** Keranjang di tingkat aplikasi: tidak hilang saat kasir berpindah tab/layar. */
export function CartProvider({ children }: { children?: ReactNode }) {
  const [cart, setCart] = useState<Cart>(emptyCart());
  const value = useMemo<CartValue>(() => ({ cart, setCart, clear: () => setCart(emptyCart()) }), [cart]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart dipakai di luar <CartProvider>.');
  return v;
}
