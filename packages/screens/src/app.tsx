import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, RemoteBackend, errorMessage, type Backend, type StoredSession } from '@ficoim/client';
import type { LocalBackend } from '@ficoim/client/local';
import { Box } from './ui';
import { AppProvider, type AccountApi, type PlatformServices } from './platform';
import { NavProvider } from './nav';
import { CartProvider } from './cart-store';
import { ErrorBox, Loading } from './kit';
import { Shell, type BackBridge } from './shell';
import { LoginScreen, OnboardingScreen, RegisterScreen } from './screens/auth';

export interface ExpiryBus { emit(): void; on(f: () => void): () => void }
/** Menghubungkan ApiClient.onSessionExpired -> UI (kembali ke layar masuk). */
export function createExpiryBus(): ExpiryBus {
  let cb: (() => void) | null = null;
  return { emit: () => cb?.(), on: (f) => { cb = f; return () => { if (cb === f) cb = null; }; } };
}

interface MainProps { backend: Backend; platform: PlatformServices; account: AccountApi | null; backBridge?: BackBridge }

function Main({ backend, platform, account, backBridge }: MainProps) {
  const [info, setInfo] = useState<{ tz: number; taxBp: number; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { const b = await backend.business(); setInfo({ tz: b.tzOffsetMinutes, taxBp: b.taxBp, name: b.name }); }, [backend]);
  useEffect(() => { load().catch((e) => setErr(errorMessage(e))); }, [load]);
  if (err) return <Box className="flex-1 p-4"><ErrorBox message={err} onRetry={() => { setErr(null); load().catch((e) => setErr(errorMessage(e))); }} /></Box>;
  if (!info) return <Loading />;
  return (
    <AppProvider value={{ backend, platform, account, tz: info.tz, taxBp: info.taxBp, businessName: info.name, refreshBusiness: load }}>
      <CartProvider><NavProvider><Shell backBridge={backBridge} /></NavProvider></CartProvider>
    </AppProvider>
  );
}

// ====================================================================== WEB (server)
export function RemoteApp({ api, platform, expiry, backBridge }: { api: ApiClient; platform: PlatformServices; expiry: ExpiryBus; backBridge?: BackBridge }) {
  const backend = useMemo(() => new RemoteBackend(api), [api]);
  const [state, setState] = useState<'loading' | 'login' | 'register' | 'main'>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    const off = expiry.on(() => { setSession(null); setState('login'); });
    api.restoreSession().then((s) => { if (s) { setSession(s); setState('main'); } else setState('login'); }, () => setState('login'));
    return off;
  }, [api, expiry]);

  const account = useMemo<AccountApi | null>(() => session ? {
    session,
    logout: async () => { await api.logout(); setSession(null); setState('login'); },
    changePassword: async (o, n) => { await api.changePassword(o, n); },
    totpStart: () => api.totpStart(),
    totpConfirm: async (c) => { await api.totpConfirm(c); },
    totpDisable: async (p, c) => { await api.totpDisable(p, c); },
  } : null, [api, session]);

  if (state === 'loading') return <Loading />;
  if (state === 'login') return <LoginScreen onLogin={async (i) => { const s = await api.login(i); setSession(s); setState('main'); }} onGoRegister={() => setState('register')} />;
  if (state === 'register') return <RegisterScreen onRegister={async (i) => { const s = await api.register(i); setSession(s); setState('main'); }} onGoLogin={() => setState('login')} />;
  return <Main backend={backend} platform={platform} account={account} backBridge={backBridge} />;
}

// ====================================================================== MOBILE (lokal, offline-first)
export function LocalApp({ backend, platform, backBridge }: { backend: LocalBackend; platform: PlatformServices; backBridge?: BackBridge }) {
  const [state, setState] = useState<'loading' | 'onboarding' | 'main' | 'error'>('loading');
  const [err, setErr] = useState('');
  useEffect(() => { backend.hasBusiness().then((h) => setState(h ? 'main' : 'onboarding'), (e) => { setErr(errorMessage(e)); setState('error'); }); }, [backend]);
  if (state === 'loading') return <Loading />;
  if (state === 'error') return <Box className="flex-1 p-4"><ErrorBox message={err} /></Box>;
  if (state === 'onboarding') {
    return (
      <OnboardingScreen pickBackup={() => platform.pickBackup()}
        onCreate={async (i) => { await backend.createBusiness({ name: i.name, businessType: i.businessType as Parameters<LocalBackend['createBusiness']>[0]['businessType'], ownerName: i.ownerName, openingCash: i.openingCash }); setState('main'); }}
        onImport={async (bytes, pw) => { await backend.importBackup(bytes, pw); setState('main'); }} />
    );
  }
  return <Main backend={backend} platform={platform} account={null} backBridge={backBridge} />;
}
