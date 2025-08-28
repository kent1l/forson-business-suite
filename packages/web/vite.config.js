import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost'
    },
    proxy: {
      '/api': {
  // For local development (frontend served by Vite) proxy API requests to the
  // backend running on localhost. When running inside Docker, the compose
  // config uses service names (e.g. `backend`), but the Vite dev server runs
  // on the host and should target localhost:3001.
  target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})