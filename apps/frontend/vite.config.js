import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-time proxy so the Vite dev server (e.g. :5173) can talk to the
// panel backend (:3001) without CORS wrangling. In production the backend
// itself serves this app's built files directly (see backend/src/server.js),
// so no proxy is needed there.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
