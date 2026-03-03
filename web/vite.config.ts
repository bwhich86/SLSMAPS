import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT: set base to your repo name for GitHub Pages, e.g. '/lighting-inspections/'
export default defineConfig({
  base: (process.env.VITE_BASE || '/'),
  plugins: [react()],
  server: { port: 5173 }
});
