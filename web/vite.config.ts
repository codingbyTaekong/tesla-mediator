import { defineConfig } from 'vite'

// 개발 시 `npm run dev -w web`로 띄우면 /ws를 로컬 서버(MEDIATOR_PORT)로 프록시한다.
export default defineConfig({
  build: {
    // 테슬라 브라우저는 최신 Chromium 기반
    target: 'es2022',
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/ws': { target: `ws://localhost:${process.env.MEDIATOR_PORT ?? 8443}`, ws: true },
    },
  },
})
