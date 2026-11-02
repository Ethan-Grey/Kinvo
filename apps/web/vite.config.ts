/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Update the installed app automatically when a new version is deployed.
      registerType: 'autoUpdate',
      // Adds phone notification handling to the generated service worker.
      workbox: { importScripts: ['push-sw.js'] },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'theme-init.js', 'push-sw.js'],
      manifest: {
        name: 'Kinvo',
        short_name: 'Kinvo',
        description: 'A private lending ledger for families.',
        lang: 'en-NZ',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#2C0735',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
