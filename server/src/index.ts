import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  WS_PATH,
  encodeAudioPacket,
  encodeVideoPacket,
  parseViewerMessage,
  type ServerMessage,
} from '@tesla-mediator/shared'
import { config } from './config.js'
import { staticHandler } from './http.js'
import { CarlinkitDongle } from './dongle/CarlinkitDongle.js'
import { MockDongle } from './dongle/MockDongle.js'
import type { DongleSource } from './dongle/DongleSource.js'

/** 브라우저가 영상을 못 따라오면 프레임을 버려 지연이 쌓이지 않게 한다. */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024

const dongle: DongleSource =
  config.source === 'mock'
    ? new MockDongle(config.mockSample, config.video)
    : new CarlinkitDongle(config.video)

const useTls = existsSync(config.tls.cert) && existsSync(config.tls.key)
const handler = staticHandler(config.webRoot)
const server = useTls
  ? https.createServer(
      { cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) },
      handler,
    )
  : http.createServer(handler)

const wss = new WebSocketServer({ server, path: WS_PATH })
/** 키프레임을 받기 전의 뷰어에게는 P프레임을 보내지 않는다(디코딩 불가). */
const waitingForKeyframe = new WeakSet<WebSocket>()

function sendJson(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastJson(msg: ServerMessage) {
  for (const ws of wss.clients) sendJson(ws, msg)
}

wss.on('connection', (ws, req) => {
  console.log(`viewer connected: ${req.socket.remoteAddress}`)
  waitingForKeyframe.add(ws)
  sendJson(ws, { type: 'status', status: dongle.status })
  dongle.requestKeyframe()

  ws.on('message', (data, isBinary) => {
    if (isBinary) return
    const msg = parseViewerMessage(data.toString())
    if (!msg) return
    switch (msg.type) {
      case 'hello':
        console.log(`viewer viewport ${msg.viewport.width}x${msg.viewport.height}`)
        break
      case 'touch':
        dongle.sendTouch(msg.action, msg.x, msg.y)
        break
      case 'requestKeyframe':
        waitingForKeyframe.add(ws)
        dongle.requestKeyframe()
        break
    }
  })

  ws.on('close', () => console.log('viewer disconnected'))
})

dongle.on('video', (packet) => {
  const frame = encodeVideoPacket(packet)
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN) continue
    if (waitingForKeyframe.has(ws)) {
      if (!packet.keyframe) continue
      waitingForKeyframe.delete(ws)
    }
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      // 밀린 상태에서 프레임을 버리면 참조가 깨지므로 다음 키프레임부터 다시 보낸다.
      waitingForKeyframe.add(ws)
      dongle.requestKeyframe()
      continue
    }
    ws.send(frame)
  }
})

dongle.on('audio', (packet) => {
  const frame = encodeAudioPacket(packet)
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(frame)
})

dongle.on('status', (status) => {
  console.log(`status: dongle=${status.dongle} phone=${status.phone}`)
  broadcastJson({ type: 'status', status })
})

dongle.on('media', (info) => broadcastJson({ type: 'media', ...info }))

server.listen(config.port, config.host, async () => {
  const scheme = useTls ? 'https' : 'http'
  console.log(
    `Tesla Mediator listening on ${scheme}://${config.host}:${config.port} (source=${config.source})`,
  )
  if (!useTls)
    console.log(
      'TLS 인증서가 없어 HTTP로 실행합니다. 테슬라에서는 HTTPS가 필요합니다 (docs/network.md).',
    )
  try {
    await dongle.start()
  } catch (err) {
    console.error(err)
    process.exitCode = 1
    server.close()
  }
})

async function shutdown() {
  await dongle.stop().catch(() => {})
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
