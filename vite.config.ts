import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

// The dashboard builds into public/, which the API serves via ServeStaticModule.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    // Helmet's CSP is script-src 'self'; the preload polyfill would be inlined.
    modulePreload: { polyfill: false },
  },
  // `vite dev` serves the UI; the API stays on :3000.
  server: {
    proxy: Object.fromEntries(
      ['/auth', '/companies', '/applications', '/health'].map((p) => [
        p,
        'http://localhost:3000',
      ]),
    ),
  },
});
