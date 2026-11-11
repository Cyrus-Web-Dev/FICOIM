import { createRoot } from 'react-dom/client';
import { ApiClient, memoryTokenStore } from '@ficoim/client';
import { RemoteApp, createExpiryBus, registerUI } from '@ficoim/screens';
import { webUI } from './ui.web';
import { createWebPlatform } from './platform.web';
import { motionAllowed } from './motion';
import { applyTheme } from './theme';
import './styles.css';

registerUI(webUI);
applyTheme(); // sebelum render pertama: tanpa kedipan terang→gelap
if (motionAllowed()) document.documentElement.dataset.motion = 'on';
const expiry = createExpiryBus();
// Token akses hanya di memori (bukan localStorage); sesi dipulihkan lewat cookie refresh HttpOnly saat halaman dimuat ulang.
const api = new ApiClient({ baseUrl: (window as unknown as { FICOIM_API?: string }).FICOIM_API ?? '/api', tokens: memoryTokenStore(), client: 'web', onSessionExpired: expiry.emit });

const root = document.getElementById('root');
if (!root) throw new Error('Elemen #root tidak ditemukan');
createRoot(root).render(
  <div className="rn h-full bg-slate-50">
  <RemoteApp api={api} platform={createWebPlatform()} expiry={expiry} />
</div>,
);
