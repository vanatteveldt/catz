import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5179,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3009',
    },
  },
})
