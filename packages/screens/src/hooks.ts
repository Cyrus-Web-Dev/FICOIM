import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@ficoim/client';

export interface AsyncState<T> { data: T | undefined; error: string | null; loading: boolean; reload: () => void }

/** Memuat data async; hasil usang (permintaan lama yang selesai belakangan) diabaikan; reload() memuat ulang. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    fn().then(
      (d) => { if (id === seq.current) { setData(d); setError(null); setLoading(false); } },
      (e) => { if (id === seq.current) { setError(errorMessage(e)); setLoading(false); } },
    );
    return () => { seq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Menjalankan aksi async dengan status sibuk/galat; mencegah klik ganda. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true; setBusy(true); setError(null);
    try { return await fn(); }
    catch (e) { setError(errorMessage(e)); return undefined; }
    finally { busyRef.current = false; setBusy(false); }
  }, []);
  return { busy, error, run, clearError: () => setError(null) };
}
