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
const soundHint = document.querySelector<HTMLDivElement>('#sound-hint')!

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

const audio = new AudioPlayer((state) => {
  soundHint.hidden = state === 'running'
})
const video = new VideoRenderer(canvas, {
  onNeedKeyframe: () => send({ type: 'requestKeyframe' }),
  onFirstFrame: () => {
    showingVideo = true
    overlay.hidden = true
  },
  onUnsupported: (codec) => showOverlay(`이 브라우저가 영상 형식(${codec})을 디코딩하지 못합니다.`),
})
new TouchInput(canvas, (action, x, y) => send({ type: 'touch', action, x, y }))
// 테슬라 화면에서 필요한 조작을 "브라우저 아이콘 한 번 탭"으로 줄이기 위해 버튼 없이 시작한다.
// 소리는 자동재생 정책이 허용하면 바로, 아니면 첫 터치 때 켜진다.
audio.unlock()
window.addEventListener('pointerdown', () => audio.unlock())

// 후진 카메라 등으로 브라우저가 내려갔다 돌아오면 디코더가 회수됐을 수 있으므로 키프레임부터 다시 받는다.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  send({ type: 'requestKeyframe' })
  audio.unlock()
})

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
