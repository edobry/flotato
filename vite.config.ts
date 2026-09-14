/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://edobry.github.io/flowtato/ (GitHub Pages project site)
  base: '/flowtato/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
