/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Offline single-player. The manifest is hand-written in public/ and linked from
    // every entry; the worker is registered by src/update.ts from the main entry only.
    VitePWA({
      manifest: false,
      injectRegister: null,
      // The worker waits instead of taking over at once; src/update.ts picks the moment.
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The board, pad and room need the Worker, so they stay online-only.
        globIgnores: ['board/**', 'pad/**', 'room/**', 'assets/{board,pad,room,protocol}-*.js', 'qr*.svg'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/(board|pad|room)\//],
        cleanupOutdatedCaches: true,
        // Control the page from the first visit, so the first run's engine chunk is already served by the worker.
        clientsClaim: true,
      },
    }),
  ],
  // Served from https://edobry.github.io/flotato/ (GitHub Pages project site)
  base: '/flotato/',
  // The commit each run reports to the board; GitHub Actions sets GITHUB_SHA.
  define: { __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)) },
  build: {
    rollupOptions: {
      input: { main: 'index.html', board: 'board/index.html', pad: 'pad/index.html', room: 'room/index.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
