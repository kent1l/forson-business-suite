import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Enable detailed error messages in production for debugging
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  // Preserve error details in production builds
  esbuild: {
    keepNames: true,
    sourcemap: true,
  },
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
  build: {
    // Generate sourcemaps for debugging production issues
    sourcemap: true,
    // Use esbuild minify (faster and keeps names with keepNames option)
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            if (id.includes('date-fns')) {
              return 'vendor-date';
            }
            if (id.includes('react-hot-toast') || id.includes('@headlessui')) {
              return 'vendor-ui';
            }
            return 'vendor-misc';
          }
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
    // Ensure consistent module resolution
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    }
  },
  // Deduplicate React to prevent multiple instances
  resolve: {
    dedupe: ['react', 'react-dom']
  }
}))