import type { AudioPacket } from '@tesla-mediator/shared'

/** 네트워크 지터를 흡수하기 위한 재생 지연 */
const JITTER_SEC = 0.08
/** 이보다 밀리면 버퍼를 비우고 다시 맞춘다 */
const MAX_LAG_SEC = 0.5

/**
 * PCM 조각을 AudioBuffer로 이어 붙여 재생한다.
 * 브라우저 정책상 사용자 터치 이후에만 소리가 나므로 unlock()을 터치 이벤트에서 호출해야 한다.
 *
 * TODO: AudioWorklet + 링버퍼로 바꿔 지연과 끊김을 줄이기.
 * TODO: 주행 중 테슬라 브라우저의 오디오 정책 실차 확인. 막히면 Pi→차량 블루투스 A2DP로 대체 (docs/architecture.md).
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null
  private playhead = 0

  unlock(): void {
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' })
    void this.ctx.resume()
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
