export interface Sample {
  /** epoch ms */
  t: number
  canvas: boolean
  video: boolean
  audio: boolean
  /** km/h, 위치 정보가 없으면 null */
  speed: number | null
  hidden: boolean
}

const ROWS: { label: string; pick: (s: Sample) => boolean | null }[] = [
  { label: 'canvas', pick: (s) => s.canvas },
  { label: 'video', pick: (s) => s.video },
  { label: '소리', pick: (s) => s.audio },
]

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** 최근 maxSamples초를 행(canvas/video/소리/주행)별 칸으로 그린다. */
export function drawTimeline(canvas: HTMLCanvasElement, samples: Sample[], maxSamples: number) {
  const dpr = devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const labelW = 64
  const rows = ROWS.length + 1
  const rowH = h / rows
  const cellW = (w - labelW) / maxSamples
  const recent = samples.slice(-maxSamples)
  const offset = maxSamples - recent.length
  const colors = { ok: css('--ok'), bad: css('--bad'), off: css('--off'), accent: css('--accent') }

  ctx.font = '14px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = css('--muted')
  ROWS.forEach((r, i) => ctx.fillText(r.label, 0, rowH * (i + 0.5)))
  ctx.fillText('주행', 0, rowH * (ROWS.length + 0.5))

  // 칸 사이에 1px 틈을 둬서 빈 구간이 구분되게
  const gap = cellW > 3 ? 1 : 0
  recent.forEach((s, i) => {
    const x = labelW + (offset + i) * cellW
    ROWS.forEach((r, row) => {
      const v = r.pick(s)
      ctx.fillStyle = v === null ? colors.off : v ? colors.ok : colors.bad
      ctx.fillRect(x, rowH * row + 3, cellW - gap, rowH - 6)
    })
    const moving = s.speed !== null && s.speed > 5
    ctx.fillStyle = moving ? colors.accent : colors.off
    ctx.fillRect(x, rowH * ROWS.length + 3, cellW - gap, rowH - 6)
  })
}

export function summarize(samples: Sample[], drivingKmh: number): string {
  if (!samples.length) return '아직 기록이 없습니다.'
  const pct = (list: Sample[], key: 'canvas' | 'video' | 'audio') =>
    list.length ? `${Math.round((list.filter((s) => s[key]).length / list.length) * 100)}%` : '–'
  const moving = samples.filter((s) => s.speed !== null && s.speed > drivingKmh)
  const parked = samples.filter((s) => !(s.speed !== null && s.speed > drivingKmh))
  const line = (name: string, list: Sample[]) =>
    `${name} ${list.length}초 — canvas ${pct(list, 'canvas')}, video ${pct(list, 'video')}, 소리 ${pct(list, 'audio')}`
  const hasSpeed = samples.some((s) => s.speed !== null)
  return hasSpeed
    ? `${line('주행', moving)} · ${line('정차', parked)}`
    : `${line('전체', samples)} (위치 정보가 없어 주행/정차를 구분하지 못함)`
}
