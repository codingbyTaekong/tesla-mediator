import { codecStringFromSps, findSps, type VideoPacket } from '@tesla-mediator/shared'

export interface VideoRendererEvents {
  /** 디코더가 깨져서 키프레임부터 다시 받아야 할 때 */
  onNeedKeyframe: () => void
  /** 첫 프레임이 실제로 그려졌을 때 */
  onFirstFrame: () => void
  /** 브라우저가 이 H.264 프로파일을 디코딩하지 못할 때 */
  onUnsupported: (codec: string) => void
}

/**
 * H.264 → WebCodecs VideoDecoder → <canvas>.
 * 테슬라 브라우저는 주행 중 <video> 재생을 막지만 canvas 그리기는 막지 않는다.
 */
export class VideoRenderer {
  private decoder: VideoDecoder | null = null
  /** 구성했거나 구성 중인 디코더의 codec/해상도 */
  private configKey = ''
  private needKeyframe = true
  private drewFrame = false
  private timestamp = 0
  private readonly ctx: CanvasRenderingContext2D

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: VideoRendererEvents,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) throw new Error('canvas 2d context를 만들 수 없습니다')
    this.ctx = ctx
  }

  static isSupported(): boolean {
    return typeof VideoDecoder !== 'undefined'
  }

  push(packet: VideoPacket): void {
    if (packet.keyframe) this.configureFrom(packet)
    if (!this.decoder || this.decoder.state !== 'configured') return
    if (this.needKeyframe && !packet.keyframe) return
    this.needKeyframe = false

    // 지연이 쌓이면 키프레임까지 건너뛴다.
    if (this.decoder.decodeQueueSize > 3 && !packet.keyframe) {
      this.needKeyframe = true
      this.events.onNeedKeyframe()
      return
    }

    this.timestamp += 1
    this.decoder.decode(
      new EncodedVideoChunk({
        type: packet.keyframe ? 'key' : 'delta',
        timestamp: this.timestamp,
        data: packet.data,
      }),
    )
  }

  /** 영상이 끊겼다가 다시 오면 첫 프레임 이벤트를 다시 받기 위해 호출 */
  reset(): void {
    this.drewFrame = false
    this.needKeyframe = true
  }

  private configureFrom(packet: VideoPacket): void {
    const sps = findSps(packet.data)
    if (!sps) return
    const codec = codecStringFromSps(sps)
    const key = `${codec}/${packet.width}x${packet.height}`
    if (key === this.configKey) return
    this.configKey = key

    this.decoder?.close()
    this.decoder = null
    this.needKeyframe = true

    // description을 주지 않으면 Annex B(start code) 형식으로 디코딩한다.
    const config: VideoDecoderConfig = { codec, optimizeForLatency: true }
    void VideoDecoder.isConfigSupported(config).then(({ supported }) => {
      if (this.configKey !== key) return // 확인하는 동안 스트림이 바뀜
      if (!supported) {
        this.events.onUnsupported(codec)
        return
      }
      this.canvas.width = packet.width
      this.canvas.height = packet.height
      this.decoder = this.createDecoder()
      this.decoder.configure(config)
      // 확인하는 동안 키프레임이 지나갔으므로 다시 요청한다.
      this.events.onNeedKeyframe()
    })
  }

  private createDecoder(): VideoDecoder {
    return new VideoDecoder({
      output: (frame) => {
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height)
        frame.close()
        if (!this.drewFrame) {
          this.drewFrame = true
          this.events.onFirstFrame()
        }
      },
      error: (err) => {
        console.error('VideoDecoder error', err)
        this.decoder = null
        this.configKey = ''
        this.needKeyframe = true
        this.events.onNeedKeyframe()
      },
    })
  }

  close(): void {
    this.decoder?.close()
    this.decoder = null
    this.configKey = ''
  }
}
