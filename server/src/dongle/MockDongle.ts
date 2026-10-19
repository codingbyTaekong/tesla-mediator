import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import {
  containsKeyframe,
  splitAccessUnits,
  type MediatorStatus,
  type TouchAction,
} from '@tesla-mediator/shared'
import type { DongleSource } from './DongleSource.js'

/**
 * 동글 없이 개발하기 위한 소스. Annex B .h264 파일을 프레임 단위로 반복 재생한다.
 * 샘플은 `npm run sample -w server`로 만든다.
 */
export class MockDongle extends EventEmitter implements DongleSource {
  status: MediatorStatus = { dongle: 'unplugged', phone: 'disconnected', source: 'mock' }
  private timer: NodeJS.Timeout | null = null
  private frames: { data: Uint8Array; keyframe: boolean }[] = []
  private index = 0

  constructor(
    private readonly samplePath: string,
    private readonly video: { width: number; height: number; fps: number },
  ) {
    super()
  }

  async start(): Promise<void> {
    const stream = new Uint8Array(await readFile(this.samplePath))
    this.frames = splitAccessUnits(stream).map((data) => ({
      data,
      keyframe: containsKeyframe(data),
    }))
    if (!this.frames.length) throw new Error(`H.264 프레임을 찾지 못했습니다: ${this.samplePath}`)

    this.setStatus({ dongle: 'plugged', phone: 'connected' })
    this.emit('media', { title: '테스트 패턴', artist: 'MockDongle' })
    this.timer = setInterval(() => this.tick(), 1000 / this.video.fps)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.setStatus({ dongle: 'unplugged', phone: 'disconnected' })
  }

  sendTouch(action: TouchAction, x: number, y: number): void {
    console.log(`[mock] touch ${action} x=${x.toFixed(3)} y=${y.toFixed(3)}`)
  }

  requestKeyframe(): void {
    // 다음 키프레임으로 건너뛰어 새 뷰어가 바로 디코딩을 시작하게 한다.
    const next = this.frames.findIndex((f, i) => i >= this.index && f.keyframe)
    this.index = next >= 0 ? next : 0
  }

  private tick(): void {
    const frame = this.frames[this.index]
    this.index = (this.index + 1) % this.frames.length
    this.emit('video', {
      width: this.video.width,
      height: this.video.height,
      keyframe: frame.keyframe,
      data: frame.data,
    })
  }

  private setStatus(patch: Partial<MediatorStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }
}
