import type { AudioPacket, MediatorStatus, TouchAction, VideoPacket } from '@tesla-mediator/shared'

export interface DongleEvents {
  video: (packet: VideoPacket) => void
  audio: (packet: AudioPacket) => void
  status: (status: MediatorStatus) => void
  media: (info: { title?: string; artist?: string; album?: string }) => void
}

/**
 * CarPlay 화면/소리의 공급원. 실제 동글(CarlinkitDongle)과 개발용 목업(MockDongle)이 구현한다.
 */
export interface DongleSource {
  readonly status: MediatorStatus
  start(): Promise<void>
  stop(): Promise<void>
  /** x, y: 0..1 정규화 좌표 */
  sendTouch(action: TouchAction, x: number, y: number): void
  /** 새 뷰어가 붙었을 때 디코딩을 바로 시작할 수 있도록 IDR 프레임을 요청 */
  requestKeyframe(): void
  on<E extends keyof DongleEvents>(event: E, listener: DongleEvents[E]): this
  off<E extends keyof DongleEvents>(event: E, listener: DongleEvents[E]): this
}
