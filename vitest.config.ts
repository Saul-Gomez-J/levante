import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, 'src/renderer/'),
      '@main/': path.resolve(__dirname, 'src/main/'),
      '@preload/': path.resolve(__dirname, 'src/preload/'),
    },
  },
})
