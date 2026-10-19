import { EventEmitter } from 'node:events'
import { containsKeyframe, type MediatorStatus, type TouchAction } from '@tesla-mediator/shared'
import type { DongleSource } from './DongleSource.js'

/*
 * node-carplay(MIT, https://github.com/rhysmorgan134/node-CarPlay)는 네이티브 usb 모듈에 의존하므로
 * optionalDependency로 두고 실행 시점에 불러온다. 필요한 부분만 최소 타입으로 선언한다.
 */
type CarplayMessage =
  | { type: 'plugged' | 'unplugged' | 'failure' }
  | { type: 'video'; message: { width: number; height: number; data: Uint8Array } }
  | { type: 'audio'; message: { decodeType: number; data?: Int16Array } }
  | {
      type: 'media'
      message: {
        payload?: {
          media?: { MediaSongName?: string; MediaArtistName?: string; MediaAlbumName?: string }
        }
      }
    }
  | { type: 'command'; message: unknown }

interface CarplayNode {
  start(): Promise<void>
  stop(): Promise<void>
  sendKey(action: string): void
  sendTouch(touch: { type: number; x: number; y: number }): void
  onmessage: ((ev: CarplayMessage) => void) | null
}

interface CarplayModule {
  default: new (config: Record<string, unknown>) => CarplayNode
  decodeTypeMap: Record<number, { frequency: number; channel: number }>
  TouchAction: { Down: number; Move: number; Up: number }
}

/** Carlinkit 계열 무선 CarPlay 동글(USB 1314:1520 / 1314:1521) */
export class CarlinkitDongle extends EventEmitter implements DongleSource {
  status: MediatorStatus = { dongle: 'unplugged', phone: 'disconnected', source: 'carlinkit' }
  private carplay: CarplayNode | null = null
  private mod: CarplayModule | null = null

  constructor(private readonly video: { width: number; height: number; fps: number; dpi: number }) {
    super()
  }

  async start(): Promise<void> {
    try {
      this.mod = (await import('node-carplay/node' as string)) as CarplayModule
    } catch (err) {
      throw new Error(
        'node-carplay를 불러오지 못했습니다. Pi에서 `npm install`로 설치했는지 확인하세요 ' +
          '(개발 PC에서는 MEDIATOR_SOURCE=mock 사용).',
        { cause: err },
      )
    }

    const carplay = new this.mod.default({
      width: this.video.width,
      height: this.video.height,
      fps: this.video.fps,
      dpi: this.video.dpi,
      boxName: 'TeslaMediator',
      // TODO: 우핸들 차량이면 hand: 1
    })
    carplay.onmessage = (ev) => this.handle(ev)
    this.carplay = carplay

    // start()는 동글이 꽂힐 때까지 재시도하며 기다리므로 서버 기동을 막지 않도록 await하지 않는다.
    void carplay.start().then(() => this.setStatus({ dongle: 'plugged' }))
  }

  async stop(): Promise<void> {
    await this.carplay?.stop()
    this.setStatus({ dongle: 'unplugged', phone: 'disconnected' })
  }

  sendTouch(action: TouchAction, x: number, y: number): void {
    if (!this.carplay || !this.mod) return
    const type = {
      down: this.mod.TouchAction.Down,
      move: this.mod.TouchAction.Move,
      up: this.mod.TouchAction.Up,
    }[action]
    this.carplay.sendTouch({ type, x, y })
  }

  requestKeyframe(): void {
    this.carplay?.sendKey('frame')
  }

  private handle(ev: CarplayMessage): void {
    switch (ev.type) {
      case 'plugged':
        this.setStatus({ dongle: 'plugged', phone: 'connected' })
        break
      case 'unplugged':
        this.setStatus({ phone: 'disconnected' })
        break
      case 'failure':
        this.setStatus({ dongle: 'failure', phone: 'disconnected' })
        break
      case 'video': {
        const data = new Uint8Array(ev.message.data)
        this.emit('video', {
          width: ev.message.width,
          height: ev.message.height,
          keyframe: containsKeyframe(data),
          data,
        })
        break
      }
      case 'audio': {
        // data가 없는 오디오 메시지는 Siri/통화 시작 같은 제어 명령이다.
        const format = this.mod?.decodeTypeMap[ev.message.decodeType]
        if (!ev.message.data || !format) break
        this.emit('audio', {
          sampleRate: format.frequency,
          channels: format.channel,
          samples: ev.message.data,
        })
        break
      }
      case 'media': {
        const m = ev.message.payload?.media
        if (m)
          this.emit('media', {
            title: m.MediaSongName,
            artist: m.MediaArtistName,
            album: m.MediaAlbumName,
          })
        break
      }
    }
  }

  private setStatus(patch: Partial<MediatorStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }
}
