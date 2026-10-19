import { defineConfig } from 'vite'

// 개발 시 `npm run dev -w web`로 띄우면 /ws를 로컬 서버(MEDIATOR_PORT)로 프록시한다.
export default defineConfig({
  // GitHub Pages(/tesla-mediator/ 하위 경로)에서도 동작하도록 상대 경로로 빌드
  base: './',
  build: {
    // 테슬라 브라우저는 최신 Chromium 기반
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      input: {
        viewer: 'index.html',
        // 테슬라 브라우저 호환성 자체 테스트 (Pi 없이 정적 호스팅으로 실행)
        selftest: 'selftest.html',
      },
    },
  },
  server: {
    proxy: {
      '/ws': { target: `ws://localhost:${process.env.MEDIATOR_PORT ?? 8443}`, ws: true },
    },
  },
})
