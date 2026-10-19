/**
 * 서버(Raspberry Pi) ↔ 뷰어(Tesla 브라우저) WebSocket 프로토콜.
 *
 * - 바이너리 프레임: 영상/오디오 (서버 → 뷰어). 첫 바이트가 종류(BinaryKind).
 * - 텍스트 프레임: JSON 제어 메시지 (양방향).
 *
 * 자세한 설명은 docs/protocol.md 참고.
 */

export const WS_PATH = '/ws'

export enum BinaryKind {
  Video = 1,
  Audio = 2,
}

/** [kind u8][flags u8][width u16][height u16] + H.264 Annex B access unit */
export const VIDEO_HEADER_BYTES = 6
/** [kind u8][channels u8][sampleRate u32] + Int16 LE PCM (interleaved) */
export const AUDIO_HEADER_BYTES = 6

export const VideoFlags = {
  Keyframe: 1 << 0,
} as const

export interface VideoPacket {
  width: number
  height: number
  keyframe: boolean
  /** H.264 Annex B 바이트열 (start code 포함) */
  data: Uint8Array
}

export interface AudioPacket {
  sampleRate: number
  channels: number
  /** interleaved 16-bit PCM */
  samples: Int16Array
}

export function encodeVideoPacket(p: VideoPacket): Uint8Array {
  const out = new Uint8Array(VIDEO_HEADER_BYTES + p.data.byteLength)
  const view = new DataView(out.buffer)
  view.setUint8(0, BinaryKind.Video)
  view.setUint8(1, p.keyframe ? VideoFlags.Keyframe : 0)
  view.setUint16(2, p.width, true)
  view.setUint16(4, p.height, true)
  out.set(p.data, VIDEO_HEADER_BYTES)
  return out
}

export function encodeAudioPacket(p: AudioPacket): Uint8Array {
  const pcm = new Uint8Array(p.samples.buffer, p.samples.byteOffset, p.samples.byteLength)
  const out = new Uint8Array(AUDIO_HEADER_BYTES + pcm.byteLength)
  const view = new DataView(out.buffer)
  view.setUint8(0, BinaryKind.Audio)
  view.setUint8(1, p.channels)
  view.setUint32(2, p.sampleRate, true)
  out.set(pcm, AUDIO_HEADER_BYTES)
  return out
}

export type DecodedBinary =
  ({ kind: BinaryKind.Video } & VideoPacket) | ({ kind: BinaryKind.Audio } & AudioPacket)

export function decodeBinary(buf: ArrayBuffer | Uint8Array): DecodedBinary | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (bytes.byteLength < 1) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kind = view.getUint8(0)

  if (kind === BinaryKind.Video && bytes.byteLength >= VIDEO_HEADER_BYTES) {
    return {
      kind,
      keyframe: (view.getUint8(1) & VideoFlags.Keyframe) !== 0,
      width: view.getUint16(2, true),
      height: view.getUint16(4, true),
      data: bytes.subarray(VIDEO_HEADER_BYTES),
    }
  }

  if (kind === BinaryKind.Audio && bytes.byteLength >= AUDIO_HEADER_BYTES) {
    // Int16Array는 2바이트 정렬이 필요하므로 복사한다.
    const pcm = bytes.slice(AUDIO_HEADER_BYTES)
    return {
      kind,
      channels: view.getUint8(1),
      sampleRate: view.getUint32(2, true),
      samples: new Int16Array(pcm.buffer, 0, pcm.byteLength >> 1),
    }
  }

  return null
}

export type TouchAction = 'down' | 'move' | 'up'

/** 상태: 동글이 USB에 꽂혔는지, 아이폰이 CarPlay로 연결됐는지 */
export interface MediatorStatus {
  dongle: 'plugged' | 'unplugged' | 'failure'
  phone: 'connected' | 'disconnected'
  source: 'carlinkit' | 'mock'
}

/** 뷰어 → 서버 */
export type ViewerMessage =
  /** 접속 직후 1회. 뷰어 화면 크기(디버깅/해상도 튜닝용) */
  | { type: 'hello'; viewport: { width: number; height: number } }
  /** x, y는 영상 기준 0..1 정규화 좌표 */
  | { type: 'touch'; action: TouchAction; x: number; y: number }
  /** 디코더 초기화 등으로 키프레임이 필요할 때 */
  | { type: 'requestKeyframe' }

/** 서버 → 뷰어 */
export type ServerMessage =
  | { type: 'status'; status: MediatorStatus }
  | { type: 'media'; title?: string; artist?: string; album?: string }

export function parseViewerMessage(text: string): ViewerMessage | null {
  try {
    const msg = JSON.parse(text) as ViewerMessage
    switch (msg?.type) {
      case 'hello':
      case 'requestKeyframe':
        return msg
      case 'touch':
        if (
          (msg.action === 'down' || msg.action === 'move' || msg.action === 'up') &&
          Number.isFinite(msg.x) &&
          Number.isFinite(msg.y)
        ) {
          return { ...msg, x: clamp01(msg.x), y: clamp01(msg.y) }
        }
        return null
      default:
        return null
    }
  } catch {
    return null
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
