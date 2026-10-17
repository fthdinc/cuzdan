/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Include the lazily loaded pdf.js worker (.mjs) so PDF import works offline.
      workbox: { globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest}'] },
      manifest: {
        name: 'Cüzdan',
        short_name: 'Cüzdan',
        lang: 'tr',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  test: { environment: 'node' },
})
