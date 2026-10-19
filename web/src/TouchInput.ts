import type { TouchAction } from '@tesla-mediator/shared'

type Send = (action: TouchAction, x: number, y: number) => void

/**
 * canvas 위의 포인터 입력을 CarPlay 좌표(영상 기준 0..1)로 바꿔 보낸다.
 * CarPlay 동글은 단일 터치만 받으므로 첫 번째 포인터만 추적한다.
 */
export class TouchInput {
  private activePointer: number | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly send: Send,
  ) {
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private onDown = (e: PointerEvent) => {
    if (this.activePointer !== null) return
    this.activePointer = e.pointerId
    this.canvas.setPointerCapture(e.pointerId)
    this.emit('down', e)
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.activePointer) this.emit('move', e)
  }

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointer) return
    this.emit('up', e)
    this.activePointer = null
  }

  private emit(action: TouchAction, e: PointerEvent) {
    const p = this.toVideoCoords(e.clientX, e.clientY)
    if (p) this.send(action, p.x, p.y)
  }

  /** object-fit: contain으로 생긴 레터박스를 제외하고 영상 영역 기준으로 정규화 */
  private toVideoCoords(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const vw = this.canvas.width
    const vh = this.canvas.height
    if (!vw || !vh) return null
    const scale = Math.min(rect.width / vw, rect.height / vh)
    const w = vw * scale
    const h = vh * scale
    const left = rect.left + (rect.width - w) / 2
    const top = rect.top + (rect.height - h) / 2
    const x = (clientX - left) / w
    const y = (clientY - top) / h
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  }
}
