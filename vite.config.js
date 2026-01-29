import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Production optimizations
    sourcemap: false,        // Disable sourcemaps in production for security
    minify: 'esbuild',       // Fast minification
    target: 'es2020',        // Modern browser target
    chunkSizeWarningLimit: 1000, // Increase warning limit for trading app bundles
    rollupOptions: {
      output: {
        // Optimize chunk splitting
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'charts': ['recharts'],
          'icons': ['lucide-react']
        }
      }
    }
  },
  server: {
    // Development proxy to backend
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
