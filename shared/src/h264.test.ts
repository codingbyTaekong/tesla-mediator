import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codecStringFromSps, containsKeyframe, splitAccessUnits, splitNalUnits } from './h264.js'
import { BinaryKind, decodeBinary, encodeVideoPacket, parseViewerMessage } from './protocol.js'

const SC4 = [0, 0, 0, 1]
const SC3 = [0, 0, 1]
const SPS = [0x67, 0x42, 0xc0, 0x1f, 0xaa]
const PPS = [0x68, 0xce, 0x3c]
/** 첫 바이트 상위 비트 1 → first_mb_in_slice == 0 */
const IDR = [0x65, 0x88, 0x01]
const P = [0x41, 0x9a, 0x02]

test('splitNalUnits handles 3- and 4-byte start codes', () => {
  const nals = splitNalUnits(new Uint8Array([...SC4, ...SPS, ...SC3, ...PPS, ...SC4, ...IDR]))
  assert.deepEqual(
    nals.map((n) => n.type),
    [7, 8, 5],
  )
  assert.deepEqual([...nals[1].data], PPS)
})

test('splitAccessUnits groups SPS/PPS with the IDR slice', () => {
  const stream = new Uint8Array([
    ...SC4,
    ...SPS,
    ...SC4,
    ...PPS,
    ...SC4,
    ...IDR,
    ...SC4,
    ...P,
    ...SC4,
    ...P,
  ])
  const units = splitAccessUnits(stream)
  assert.equal(units.length, 3)
  assert.ok(containsKeyframe(units[0]))
  assert.ok(!containsKeyframe(units[1]))
  assert.equal(codecStringFromSps(new Uint8Array(SPS)), 'avc1.42c01f')
})

test('video packets round-trip', () => {
  const data = new Uint8Array([...SC4, ...IDR])
  const decoded = decodeBinary(
    encodeVideoPacket({ width: 1280, height: 800, keyframe: true, data }),
  )
  assert.equal(decoded?.kind, BinaryKind.Video)
  assert.ok(decoded?.kind === BinaryKind.Video && decoded.keyframe && decoded.width === 1280)
  assert.deepEqual(decoded && 'data' in decoded ? [...decoded.data] : null, [...data])
})

test('touch messages are validated and clamped', () => {
  assert.deepEqual(parseViewerMessage('{"type":"touch","action":"down","x":1.5,"y":-1}'), {
    type: 'touch',
    action: 'down',
    x: 1,
    y: 0,
  })
  assert.equal(parseViewerMessage('{"type":"touch","action":"tap","x":0,"y":0}'), null)
  assert.equal(parseViewerMessage('not json'), null)
})
