import {
  BinaryKind,
  WS_PATH,
  decodeBinary,
  type MediatorStatus,
  type ServerMessage,
  type ViewerMessage,
} from '@tesla-mediator/shared'
import { AudioPlayer } from './AudioPlayer'
import { TouchInput } from './TouchInput'
import { VideoRenderer } from './VideoRenderer'

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!
const overlay = document.querySelector<HTMLDivElement>('#overlay')!
const statusText = document.querySelector<HTMLParagraphElement>('#status')!

const RECONNECT_MS = 1000

let ws: WebSocket | null = null
let showingVideo = false

function send(msg: ViewerMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function showOverlay(text: string) {
  statusText.textContent = text
  overlay.hidden = false
}

function describe(status: MediatorStatus): string {
  if (status.dongle === 'failure') return '동글 오류가 발생했습니다. 동글을 다시 꽂아 주세요.'
  if (status.dongle === 'unplugged') return 'CarPlay 동글을 찾는 중…'
  if (status.phone === 'disconnected') return '아이폰을 기다리는 중… (설정 › 일반 › CarPlay)'
  return '화면을 받는 중…'
}

if (!VideoRenderer.isSupported()) {
  showOverlay(
    window.isSecureContext
      ? '이 브라우저는 WebCodecs를 지원하지 않습니다.'
      : 'HTTPS로 접속해야 합니다 (docs/network.md 참고).',
  )
  throw new Error('WebCodecs unavailable')
}

const audio = new AudioPlayer()
const video = new VideoRenderer(canvas, {
  onNeedKeyframe: () => send({ type: 'requestKeyframe' }),
  onFirstFrame: () => {
    showingVideo = true
    overlay.hidden = true
  },
  onUnsupported: (codec) => showOverlay(`이 브라우저가 영상 형식(${codec})을 디코딩하지 못합니다.`),
})
new TouchInput(canvas, (action, x, y) => send({ type: 'touch', action, x, y }))
// 오디오 자동재생 정책: 첫 터치 때 AudioContext를 연다.
window.addEventListener('pointerdown', () => audio.unlock())

function stopVideo() {
  showingVideo = false
  video.reset()
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${scheme}://${location.host}${WS_PATH}`)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    send({ type: 'hello', viewport: { width: innerWidth, height: innerHeight } })
  }

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      const msg = JSON.parse(ev.data) as ServerMessage
      if (msg.type === 'status') {
        if (msg.status.phone !== 'connected') stopVideo()
        if (!showingVideo) showOverlay(describe(msg.status))
      } else if (msg.type === 'media') {
        document.title = msg.title ? `${msg.title} — Tesla Mediator` : 'Tesla Mediator'
      }
      return
    }

    const packet = decodeBinary(ev.data as ArrayBuffer)
    if (packet?.kind === BinaryKind.Video) {
      video.push(packet)
    } else if (packet?.kind === BinaryKind.Audio) {
      audio.push(packet)
    }
  }

  ws.onclose = () => {
    stopVideo()
    showOverlay('Pi와 연결이 끊겼습니다. 다시 연결하는 중…')
    setTimeout(connect, RECONNECT_MS)
  }
}

connect()
