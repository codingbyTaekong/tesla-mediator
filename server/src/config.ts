import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function num(name: string, fallback: number): number {
  const v = process.env[name]
  return v ? Number(v) : fallback
}

export const config = {
  /** 'carlinkit' = 실제 USB 동글, 'mock' = 샘플 영상 재생 (개발용) */
  source: (process.env.MEDIATOR_SOURCE ?? 'carlinkit') as 'carlinkit' | 'mock',
  host: process.env.MEDIATOR_HOST ?? '0.0.0.0',
  port: num('MEDIATOR_PORT', 8443),

  /**
   * CarPlay가 렌더링할 해상도. 테슬라 브라우저 뷰포트 비율(약 16:10)에 맞춘다.
   * 너무 크면 Pi/동글의 인코딩 지연이 늘어난다.
   */
  video: {
    width: num('MEDIATOR_WIDTH', 1280),
    height: num('MEDIATOR_HEIGHT', 800),
    fps: num('MEDIATOR_FPS', 30),
    dpi: num('MEDIATOR_DPI', 160),
  },

  /** 둘 다 있으면 HTTPS로, 없으면 HTTP로 뜬다 (WebCodecs는 HTTPS 또는 localhost 필요) */
  tls: {
    cert: process.env.MEDIATOR_TLS_CERT ?? path.join(root, 'certs/fullchain.pem'),
    key: process.env.MEDIATOR_TLS_KEY ?? path.join(root, 'certs/privkey.pem'),
  },

  webRoot: process.env.MEDIATOR_WEB_ROOT ?? path.join(root, 'web/dist'),
  mockSample: process.env.MEDIATOR_MOCK_SAMPLE ?? path.join(root, 'server/samples/test.h264'),
}

export type Config = typeof config
