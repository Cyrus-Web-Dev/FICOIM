import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: API dev server (npm run dev:api) di port 8787 diteruskan lewat /api -> satu origin, sehingga cookie refresh (SameSite=Strict) bekerja.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { target: 'es2022', sourcemap: false },
});
