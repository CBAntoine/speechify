import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  // The Android app bundles the build; source maps would only make it bigger.
  build: { target: 'es2022', sourcemap: mode !== 'android' },
  server: { port: 5199 },
  preview: { port: 5199 },
}));
