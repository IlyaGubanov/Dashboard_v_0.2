import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // при разработке запросы /api уходят на локальный API (127.0.0.1: на Windows localhost сначала идёт в IPv6, а API слушает IPv4)
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3000' },
  },
});
