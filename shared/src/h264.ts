/**
 * H.264 Annex B 유틸리티. 서버(목업 소스의 프레임 분할, 키프레임 판별)와
 * 뷰어(WebCodecs codec 문자열 생성) 양쪽에서 쓴다.
 */

export const NalType = {
  NonIdrSlice: 1,
  IdrSlice: 5,
  Sei: 6,
  Sps: 7,
  Pps: 8,
  Aud: 9,
} as const

export interface NalUnit {
  type: number
  /** start code를 제외한 NAL 바이트 (헤더 포함) */
  data: Uint8Array
}

/** start code(00 00 01 / 00 00 00 01) 기준으로 NAL 단위로 나눈다. */
export function splitNalUnits(buf: Uint8Array): NalUnit[] {
  const starts: { at: number; len: number }[] = []
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) {
        starts.push({ at: i, len: 3 })
        i += 2
      } else if (buf[i + 2] === 0 && buf[i + 3] === 1) {
        starts.push({ at: i, len: 4 })
        i += 3
      }
    }
  }

  const nals: NalUnit[] = []
  for (let n = 0; n < starts.length; n++) {
    const begin = starts[n].at + starts[n].len
    const end = n + 1 < starts.length ? starts[n + 1].at : buf.length
    if (end > begin) {
      const data = buf.subarray(begin, end)
      nals.push({ type: data[0] & 0x1f, data })
    }
  }
  return nals
}

export function containsKeyframe(buf: Uint8Array): boolean {
  return splitNalUnits(buf).some((n) => n.type === NalType.IdrSlice)
}

/** SPS로부터 WebCodecs codec 문자열(avc1.PPCCLL)을 만든다. */
export function codecStringFromSps(sps: Uint8Array): string {
  const hex = (b: number) => b.toString(16).padStart(2, '0')
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`
}

export function findSps(buf: Uint8Array): Uint8Array | null {
  return splitNalUnits(buf).find((n) => n.type === NalType.Sps)?.data ?? null
}

const START_CODE = new Uint8Array([0, 0, 0, 1])

/**
 * 연속된 Annex B 스트림(예: ffmpeg로 만든 .h264 파일)을 access unit(프레임) 단위로 묶는다.
 * 실제 동글은 이미 프레임 단위로 보내주므로 목업 소스에서만 쓴다.
 */
export function splitAccessUnits(stream: Uint8Array): Uint8Array[] {
  const units: NalUnit[][] = []
  let current: NalUnit[] = []
  let hasVcl = false

  for (const nal of splitNalUnits(stream)) {
    const isVcl = nal.type === NalType.NonIdrSlice || nal.type === NalType.IdrSlice
    // first_mb_in_slice == 0 이면 ue(v) 첫 비트가 1 → 새 픽처의 첫 슬라이스
    const firstSliceOfPicture = isVcl && (nal.data[1] & 0x80) !== 0
    const startsNewUnit =
      hasVcl &&
      (firstSliceOfPicture ||
        nal.type === NalType.Aud ||
        nal.type === NalType.Sps ||
        nal.type === NalType.Pps ||
        nal.type === NalType.Sei)

    if (startsNewUnit) {
      units.push(current)
      current = []
      hasVcl = false
    }
    current.push(nal)
    hasVcl ||= isVcl
  }
  if (current.length) units.push(current)

  return units.map((nals) => {
    const size = nals.reduce((s, n) => s + START_CODE.length + n.data.length, 0)
    const out = new Uint8Array(size)
    let off = 0
    for (const n of nals) {
      out.set(START_CODE, off)
      out.set(n.data, off + START_CODE.length)
      off += START_CODE.length + n.data.length
    }
    return out
  })
}
