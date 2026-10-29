import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // при разработке запросы /api уходят на локальный API
    proxy: { '/api': 'http://localhost:3000' },
  },
});
