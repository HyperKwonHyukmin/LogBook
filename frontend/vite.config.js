import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 개발 서버(5180)는 /api 를 백엔드(9095)로 넘긴다. 운영은 백엔드가 dist 를 같은 출처로 서빙.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, proxy: { '/api': 'http://localhost:9095' } },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.js'], globals: true },
});
