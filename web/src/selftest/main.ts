/**
 * 테슬라 브라우저 호환성 자체 테스트.
 *
 * Pi 없이 정적 호스팅(GitHub Pages 등)으로 띄워, 실제 뷰어가 쓰는 코드(VideoRenderer, AudioPlayer)가
 * 테슬라 브라우저에서 — 특히 주행 중에 — 동작하는지 확인한다. 결과는 localStorage에 남겨
 * 주차 후 다시 열어 볼 수 있게 한다.
 */
import { containsKeyframe, splitAccessUnits } from '@tesla-mediator/shared'
import { AudioPlayer } from '../AudioPlayer'
import { VideoRenderer } from '../VideoRenderer'
import { drawTimeline, summarize, type Sample } from './timeline'

const FPS = 30
const SAMPLE_WIDTH = 1280
const SAMPLE_HEIGHT = 800
const TONE_HZ = 440
const TONE_GAIN = 0.08
const AUDIO_CHUNK_MS = 50
const DRIVING_KMH = 5
const MAX_SAMPLES = 600
const MAX_LOG = 200
const STORAGE_KEY = 'tesla-mediator:selftest'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

interface Stored {
  samples: Sample[]
  log: { t: number; text: string }[]
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Stored
  } catch {
    // 저장소를 못 쓰는 환경이면 기록 없이 진행
  }
  return { samples: [], log: [] }
}

const store = load()

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 무시
  }
}

// ---------- 이벤트 기록 ----------

const logEl = $<HTMLOListElement>('log')

function renderLogEntry(entry: { t: number; text: string }) {
  const li = document.createElement('li')
  const time = document.createElement('time')
  time.textContent = new Date(entry.t).toLocaleTimeString('ko-KR')
  li.append(time, entry.text)
  logEl.prepend(li)
}

function log(text: string) {
  const entry = { t: Date.now(), text }
  store.log.push(entry)
  if (store.log.length > MAX_LOG) store.log.splice(0, store.log.length - MAX_LOG)
  renderLogEntry(entry)
  save()
}

store.log.forEach(renderLogEntry)

// ---------- 브라우저 기능 ----------

async function checkCapabilities() {
  const caps = $<HTMLUListElement>('caps')
  const add = (label: string, ok: boolean | null) => {
    const li = document.createElement('li')
    li.className = ok === null ? '' : ok ? 'ok' : 'bad'
    li.textContent = `${ok === null ? '•' : ok ? '✓' : '✗'} ${label}`
    caps.append(li)
  }

  add('HTTPS', window.isSecureContext)
  const webcodecs = typeof VideoDecoder !== 'undefined'
  add('WebCodecs', webcodecs)
  if (webcodecs) {
    for (const [name, codec] of [
      ['H.264 Baseline', 'avc1.42e01f'],
      ['H.264 Main', 'avc1.4d401f'],
      ['H.264 High', 'avc1.64001f'],
    ]) {
      const { supported } = await VideoDecoder.isConfigSupported({ codec }).catch(() => ({
        supported: false,
      }))
      add(name, !!supported)
    }
  }
  add('WebAudio', typeof AudioContext !== 'undefined')
  add('위치(속도) 정보', 'geolocation' in navigator)
  add(`화면 ${innerWidth}×${innerHeight} @${devicePixelRatio}x`, null)
  add(`최대 동시 터치 ${navigator.maxTouchPoints}`, null)
  log(`브라우저: ${navigator.userAgent}`)
}

// ---------- ① canvas 영상 (실제 뷰어 코드) ----------

const canvas = $<HTMLCanvasElement>('canvas')
let frames: { data: Uint8Array; keyframe: boolean }[] = []
let frameIndex = 0
let drawnTotal = 0
let drawnThisSecond = 0
let lastDrawAt = 0

function jumpToKeyframe() {
  const next = frames.findIndex((f, i) => i >= frameIndex && f.keyframe)
  frameIndex = next >= 0 ? next : 0
}

const renderer = new VideoRenderer(canvas, {
  onNeedKeyframe: jumpToKeyframe,
  onFirstFrame: () => log('canvas: 첫 프레임 표시'),
  onUnsupported: (codec) => log(`canvas: 이 브라우저는 ${codec} 디코딩을 지원하지 않음`),
  onFrame: () => {
    drawnTotal++
    drawnThisSecond++
    lastDrawAt = performance.now()
  },
})

async function loadFrames() {
  const res = await fetch('./selftest/sample.h264')
  if (!res.ok) throw new Error(`샘플 영상을 불러오지 못함 (${res.status})`)
  const stream = new Uint8Array(await res.arrayBuffer())
  frames = splitAccessUnits(stream).map((data) => ({ data, keyframe: containsKeyframe(data) }))
}

function pushNextFrame() {
  if (!frames.length) return
  const f = frames[frameIndex]
  frameIndex = (frameIndex + 1) % frames.length
  renderer.push({ width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, keyframe: f.keyframe, data: f.data })
}

// ---------- ② <video> (비교용) ----------

const video = $<HTMLVideoElement>('video')
let lastVideoTime = 0
for (const ev of ['play', 'pause', 'waiting', 'stalled', 'error'] as const) {
  video.addEventListener(ev, () => running && log(`video: ${ev}`))
}

// ---------- ③ 소리 (실제 뷰어 코드) ----------

const audio = new AudioPlayer()
let tonePhase = 0
let lastAudioTime = 0
let lastAudioState = ''

function pushTone() {
  const sampleRate = 44100
  const n = Math.round((sampleRate * AUDIO_CHUNK_MS) / 1000)
  const samples = new Int16Array(n * 2)
  for (let i = 0; i < n; i++) {
    const v = Math.sin(tonePhase) * TONE_GAIN * 32767
    samples[i * 2] = samples[i * 2 + 1] = v
    tonePhase += (2 * Math.PI * TONE_HZ) / sampleRate
  }
  tonePhase %= 2 * Math.PI
  audio.push({ sampleRate, channels: 2, samples })
}

// ---------- ④ 터치 ----------

function setupTouchPad() {
  const pad = $<HTMLDivElement>('pad')
  const dots = new Map<number, HTMLSpanElement>()
  const update = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const dot = dots.get(e.pointerId)
    if (dot) {
      dot.style.left = `${x * 100}%`
      dot.style.top = `${y * 100}%`
    }
    $('touch-pos').textContent = `x=${x.toFixed(3)} y=${y.toFixed(3)} (${e.pointerType})`
    $('touch-count').textContent = String(dots.size)
  }
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId)
    const dot = document.createElement('span')
    dot.className = 'dot'
    pad.append(dot)
    dots.set(e.pointerId, dot)
    update(e)
  })
  pad.addEventListener('pointermove', (e) => dots.has(e.pointerId) && update(e))
  const end = (e: PointerEvent) => {
    dots.get(e.pointerId)?.remove()
    dots.delete(e.pointerId)
    $('touch-count').textContent = String(dots.size)
  }
  pad.addEventListener('pointerup', end)
  pad.addEventListener('pointercancel', end)
}

// ---------- 속도 ----------

let speedKmh: number | null = null
let driving = false
let geoWatch: number | null = null

function startGeolocation() {
  if (!('geolocation' in navigator)) return
  geoWatch = navigator.geolocation.watchPosition(
    (pos) => {
      speedKmh = pos.coords.speed === null ? null : pos.coords.speed * 3.6
      const nowDriving = speedKmh !== null && speedKmh > DRIVING_KMH
      if (nowDriving !== driving) {
        driving = nowDriving
        log(driving ? `주행 시작 감지 (${speedKmh!.toFixed(0)} km/h)` : '정차 감지')
      }
    },
    (err) => log(`위치 정보 사용 불가: ${err.message}`),
    { enableHighAccuracy: true },
  )
}

// ---------- 1초마다 측정 ----------

const timelineCanvas = $<HTMLCanvasElement>('timeline')
let running = false
let timers: number[] = []
let lastTickAt = 0
let canvasWasOk = true

function tick() {
  const now = performance.now()
  const gap = now - lastTickAt
  lastTickAt = now
  // 브라우저가 페이지를 멈췄다가 깨운 경우
  if (gap > 2500) log(`타이머가 ${(gap / 1000).toFixed(1)}초 동안 멈춤`)

  const canvasFps = drawnThisSecond
  drawnThisSecond = 0
  const canvasOk = canvasFps >= FPS / 2
  if (canvasOk !== canvasWasOk) {
    log(
      canvasOk ? `canvas: 다시 정상 (${canvasFps} fps)` : `canvas: 멈춤/느려짐 (${canvasFps} fps)`,
    )
    canvasWasOk = canvasOk
  }

  const videoAdvanced = video.currentTime !== lastVideoTime && !video.paused
  lastVideoTime = video.currentTime

  const ctx = audio.context
  const audioAdvanced = ctx ? ctx.currentTime - lastAudioTime > 0.5 : false
  if (ctx) {
    lastAudioTime = ctx.currentTime
    if (ctx.state !== lastAudioState) {
      log(`audio: ${ctx.state}`)
      lastAudioState = ctx.state
    }
  }

  store.samples.push({
    t: Date.now(),
    canvas: canvasOk,
    video: videoAdvanced,
    audio: audioAdvanced,
    speed: speedKmh,
    hidden: document.hidden,
  })
  if (store.samples.length > MAX_SAMPLES)
    store.samples.splice(0, store.samples.length - MAX_SAMPLES)
  save()

  $('canvas-fps').textContent = String(canvasFps)
  $('canvas-count').textContent = String(drawnTotal)
  $('video-state').textContent = video.paused ? '멈춤' : videoAdvanced ? '재생 중' : '진행 안 됨'
  $('video-time').textContent = `${video.currentTime.toFixed(1)}초`
  $('audio-state').textContent = ctx ? ctx.state : '–'
  $('audio-time').textContent = ctx ? `${ctx.currentTime.toFixed(1)}초` : '–'
  redraw()
}

function updateFrameAge() {
  $('canvas-age').textContent = lastDrawAt
    ? `${Math.round(performance.now() - lastDrawAt)} ms 전`
    : '–'
}

function redraw() {
  drawTimeline(timelineCanvas, store.samples, MAX_SAMPLES)
  $('timeline-note').textContent = summarize(store.samples, DRIVING_KMH)
}

async function start() {
  if (running) return
  running = true
  $('start').hidden = true
  $('stop').hidden = false
  log('테스트 시작')

  // 브라우저 정책상 소리와 동영상 재생은 사용자 터치 직후에 시작해야 한다.
  audio.unlock()
  video.play().catch((err) => log(`video: 재생 실패 (${err.name})`))

  try {
    if (!frames.length) await loadFrames()
  } catch (err) {
    log(String(err))
  }

  lastTickAt = performance.now()
  lastVideoTime = video.currentTime
  lastAudioTime = audio.context?.currentTime ?? 0
  startGeolocation()
  timers = [
    window.setInterval(pushNextFrame, 1000 / FPS),
    window.setInterval(pushTone, AUDIO_CHUNK_MS),
    window.setInterval(tick, 1000),
    window.setInterval(updateFrameAge, 200),
  ]
}

function stop() {
  if (!running) return
  running = false
  timers.forEach(clearInterval)
  timers = []
  if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch)
  geoWatch = null
  video.pause()
  void audio.context?.suspend()
  $('start').hidden = false
  $('stop').hidden = true
  log('테스트 종료')
}

$('start').addEventListener('click', start)
$('stop').addEventListener('click', stop)
$('clear').addEventListener('click', () => {
  store.samples = []
  store.log = []
  logEl.replaceChildren()
  save()
  redraw()
})
document.addEventListener('visibilitychange', () => {
  if (running) log(document.hidden ? '페이지가 숨겨짐' : '페이지가 다시 보임')
})
window.addEventListener('resize', redraw)

setupTouchPad()
redraw()
void checkCapabilities()
