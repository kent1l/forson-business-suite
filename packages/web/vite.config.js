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
  // Proxy API requests to the backend. Use VITE_PROXY_TARGET to allow
  // switching between host-local backend (http://localhost:3001) and the
  // docker-compose service hostname (http://backend:3001) when running
  // the frontend inside Docker.
  target: process.env.VITE_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})