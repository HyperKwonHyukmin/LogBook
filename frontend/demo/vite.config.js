import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 설명회 데모 빌드 — `node demo/build.mjs` 가 부른다(직접 쓰지 않는다).
 * 파일 하나(file://)로 열려야 하므로 코드 나누기를 끄고, 글꼴·그림은 모두 data: 로 넣는다.
 * Pretendard 는 92조각 동적 부분 집합 대신 통짜 woff2 하나(2MB)를 쓴다 — 조각을 다 넣으면 더 크다.
 */
const full = fileURLToPath(new URL('../node_modules/pretendard/dist/web/variable/pretendardvariable.css', import.meta.url));

export default defineConfig({
  // 기준 폴더는 frontend — Tailwind 가 src 의 화면 코드까지 훑어 클래스를 만든다(demo 만 보면 앱 스타일이 빠진다)
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: [{ find: 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css', replacement: full }] },
  build: {
    outDir: fileURLToPath(new URL('../node_modules/.demo-build', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 10000,
    rollupOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)), output: { codeSplitting: false } },
  },
});
