import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJsonPath = resolve(process.cwd(), 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

const appVersion = process.env.VITE_APP_VERSION || packageJson.version || '0.0.0'
const appCommitSha = process.env.VITE_APP_COMMIT_SHA || 'local'
const appBuildDate = process.env.VITE_APP_BUILD_DATE || new Date().toISOString()

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT_SHA__: JSON.stringify(appCommitSha),
    __APP_BUILD_DATE__: JSON.stringify(appBuildDate),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      protocol: 'ws',
      host: 'localhost'
    },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://forson_backend_dev:3001',
        changeOrigin: true,
        secure: false
      }
    },
  },
})
