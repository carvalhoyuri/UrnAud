import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { proxy: { '/api': 'http://127.0.0.1:8000', '/geo': 'http://127.0.0.1:8000' } },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('echarts') || id.includes('zrender')) return 'echarts'
          if (id.includes('maplibre-gl')) return 'maplibre'
        },
      },
    },
  },
})
