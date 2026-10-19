import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.h264': 'video/h264',
}

/** web/dist를 서빙하는 최소 정적 파일 핸들러 */
export function staticHandler(webRoot: string) {
  const root = path.resolve(webRoot)
  return async (req: IncomingMessage, res: ServerResponse) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    let file = path.resolve(root, '.' + urlPath)
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
      await stat(file)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('찾을 수 없습니다. 먼저 `npm run build`로 web을 빌드하세요.')
      return
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    createReadStream(file).pipe(res)
  }
}
