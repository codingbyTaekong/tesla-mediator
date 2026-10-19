import type { AudioPacket } from '@tesla-mediator/shared'

/** 네트워크 지터를 흡수하기 위한 재생 지연 */
const JITTER_SEC = 0.08
/** 이보다 밀리면 버퍼를 비우고 다시 맞춘다 */
const MAX_LAG_SEC = 0.5

/**
 * PCM 조각을 AudioBuffer로 이어 붙여 재생한다.
 * 브라우저 자동재생 정책에 따라 사용자 터치 전에는 막힐 수 있으므로, unlock()을 페이지 로드 때 한 번 시도하고
 * 막혀 있으면 터치 이벤트에서 다시 호출한다. 상태가 바뀌면 onStateChange로 알린다.
 * Model Y 실차에서 주행 중 재생 확인됨 (docs/architecture.md).
 *
 * TODO: AudioWorklet + 링버퍼로 바꿔 지연과 끊김을 줄이기.
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null
  private playhead = 0

  constructor(private readonly onStateChange?: (state: AudioContextState) => void) {}

  /** 아직 unlock()하지 않았으면 null */
  get context(): AudioContext | null {
    return this.ctx
  }

  get running(): boolean {
    return this.ctx?.state === 'running'
  }

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      ctx.addEventListener('statechange', () => this.onStateChange?.(ctx.state))
      this.ctx = ctx
      this.onStateChange?.(ctx.state)
    }
    // 정책상 막혀 있으면 resume()은 터치가 있을 때까지 끝나지 않는다. 기다리지 않는다.
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  push(packet: AudioPacket): void {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return

    const frames = Math.floor(packet.samples.length / packet.channels)
    if (!frames) return
    const buffer = ctx.createBuffer(packet.channels, frames, packet.sampleRate)
    for (let ch = 0; ch < packet.channels; ch++) {
      const out = buffer.getChannelData(ch)
      for (let i = 0; i < frames; i++) out[i] = packet.samples[i * packet.channels + ch] / 32768
    }

    const now = ctx.currentTime
    if (this.playhead < now || this.playhead - now > MAX_LAG_SEC) this.playhead = now + JITTER_SEC

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start(this.playhead)
    this.playhead += buffer.duration
  }
}
